---
title: "A 30-Line Reverse Proxy With `httputil.ReverseProxy` (And the Pitfalls)"
date: 2026-05-04 21:00:00
tags:
  - minikv
  - lsm
  - go
  - distributed-systems
categories:
  - engineering
  - storage
---

> Go's stdlib ships a production-grade reverse proxy. Most uses of it
> are simple. The pitfalls are not where you'd expect.

This is a short tutorial post. It distils the working implementation
from MiniKV's [`kv/raftnode/http.go`](../kv/raftnode/http.go) into a
generic mini-recipe with annotations.

## The minimum

```go
target, _ := url.Parse("http://leader.internal:8081")
proxy := httputil.NewSingleHostReverseProxy(target)
http.HandleFunc("/v1/", proxy.ServeHTTP)
```

Three lines. The proxy:

- rewrites the request's `URL.Scheme` and `URL.Host` to `target`,
- preserves the path and query,
- copies headers (with the standard hop-by-hop filters applied),
- streams the body in both directions.

For most "forward this request to another HTTP service" needs that's
all you need. The pitfalls only show up when you start having
opinions about errors, timeouts, or request shape.

## Pitfall 1: the default `ErrorHandler` is silent-ish

If the upstream is down or the body stream breaks mid-response, the
default behaviour is to log to the proxy's `ErrorLog` and write a 502.
You don't get to choose the message or add headers. Override it:

```go
proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
    http.Error(w, "upstream failed: "+err.Error(), http.StatusBadGateway)
}
```

In MiniKV this matters because the upstream is "the current raft
leader, which may have just crashed" — we want the client to see a
useful 502, not an empty one.

## Pitfall 2: a bare `:port` is not a URL

```go
url.Parse(":8081")   // returns &URL{Scheme:"", Opaque:":8081"} — useless
```

If your config stores HTTP addresses operator-style (often `:8081`
for "bind on all interfaces"), normalise first:

```go
func normalizeHTTPURL(s string) string {
    if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
        return s
    }
    if strings.HasPrefix(s, ":") {
        return "http://127.0.0.1" + s
    }
    return "http://" + s
}
```

This is the kind of glue that doesn't appear in tutorials but does
appear in every real codebase.

## Pitfall 3: `NewSingleHostReverseProxy` does not retry

If the upstream connection drops, you get a 502 — period. Some users
expect the proxy to retry idempotent methods. It does not.

This is the *right* default for most cases (silent retries hide
problems), but if your protocol genuinely is idempotent and you want
retries, wrap the call site:

```go
for i := 0; i < maxRetries; i++ {
    rec := httptest.NewRecorder()
    proxy.ServeHTTP(rec, r)
    if rec.Code != http.StatusBadGateway {
        copyTo(w, rec)
        return
    }
    // back off, refresh target, retry
}
```

Note that `r.Body` is consumed by the first attempt; you need
`r.GetBody` (set by `http.NewRequest` for replayable bodies) or to
buffer the body yourself before the loop.

## Pitfall 4: hop detection

A reverse proxy chain that loops will quietly burn CPU until
something times out. Mark the hop:

```go
r.Header.Set("X-MyService-Forwarded", "1")
```

And at the top of the handler:

```go
if r.Header.Get("X-MyService-Forwarded") == "1" {
    http.Error(w, "forwarding loop", http.StatusLoopDetected)
    return
}
```

MiniKV sets `X-MiniKV-Forwarded` but doesn't act on it yet — it's
preparation for a future where the cluster could grow to the point
where two-hop forwards become possible.

## Pitfall 5: per-request `Director` vs constructor

`NewSingleHostReverseProxy` uses a default `Director` that rewrites
`URL.Scheme`, `URL.Host`, and `URL.Path` (it joins the target's path
prefix). If you want different routing logic — e.g. choose the
upstream per-request based on a header — wrap the constructor's
director:

```go
proxy := &httputil.ReverseProxy{
    Director: func(req *http.Request) {
        upstream := pickUpstream(req)
        req.URL.Scheme = upstream.Scheme
        req.URL.Host = upstream.Host
        req.Host = upstream.Host
    },
}
```

Setting `req.Host` is critical: many upstreams route on the `Host`
header, and the default director does *not* update it.

## Pitfall 6: streaming bodies and flushing

For SSE / NDJSON / WebSocket upgrades you want immediate flushing:

```go
proxy.FlushInterval = -1   // flush every write
```

The default (`0`) waits for the response to finish before flushing,
which makes a streaming endpoint look hung.

MiniKV's NDJSON `/v1/replicate/stream` does its own streaming and
doesn't go through the proxy, but if it ever did, this would be the
knob.

## The MiniKV concrete code

For reference, the whole proxy in MiniKV's raft mode:

```go
func proxyToLeader(w http.ResponseWriter, r *http.Request, node *Node) bool {
    leaderHTTP := node.LeaderHTTP()
    if leaderHTTP == "" {
        return false
    }
    target, err := url.Parse(normalizeHTTPURL(leaderHTTP))
    if err != nil {
        return false
    }
    proxy := httputil.NewSingleHostReverseProxy(target)
    proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
        http.Error(w, "leader forward failed: "+err.Error(), http.StatusBadGateway)
    }
    r.Header.Set("X-MiniKV-Forwarded", "1")
    proxy.ServeHTTP(w, r)
    return true
}
```

Twelve lines, including the bail-out for "no upstream known". This
is what 90% of reverse-proxy uses should look like.

## When *not* to use `httputil.ReverseProxy`

- **TLS termination with weird ALPN negotiation**: use a proper L7
  proxy (Envoy, HAProxy, Caddy).
- **gRPC**: use a gRPC interceptor or a dedicated gRPC proxy.
  `httputil.ReverseProxy` works for gRPC over HTTP/2 in some setups
  but trailers and streaming get fiddly.
- **High-throughput edge proxy**: still works, but you'll want to
  tune `Transport.MaxIdleConnsPerHost`, `ResponseHeaderTimeout`, etc.
  At that point you're really configuring a Go HTTP server, not a
  proxy.

For "this internal Go service needs to forward some requests to
another internal Go service", `httputil.ReverseProxy` is exactly the
right tool. Just configure the error handler.
