---
title: "`go test -coverpkg`: Why Cross-Package Tests Show 0% Coverage"
date: 2026-05-04 09:00:00
tags:
  - minikv
  - lsm
  - go
  - distributed-systems
categories:
  - engineering
  - storage
---

> If your tests live in a different package than the code they
> exercise, Go's default coverage tool will tell you the code has
> zero coverage. The fix is one flag, but it took me an embarrassing
> amount of time to find.

This is a short tooling post. It exists because I hit this exact bug
in MiniKV and search engines weren't much help.

## The symptom

Repo layout:

```
kv/         ← engine code
  kv.go
  wal.go
  ...
tests/      ← integration tests
  kv_test.go
```

The tests are good. They import `minikv/kv`, build real `*kv.KV`
instances, drive them, assert. Running them:

```bash
$ go test -cover ./...
ok      minikv/kv         0.001s  coverage: 0.0% of statements      ← !
ok      minikv/tests      4.123s  coverage: [no statements]
```

`minikv/kv` shows 0.0%. The `tests/` package itself shows "no
statements" (it's all `_test.go` files). The actual coverage I want
to measure — *how much of `kv` is exercised* — is not visible.

## Why it happens

`go test -cover ./...` instruments each package's *own* test binary
to record coverage of code *in the same package*. For `minikv/kv`,
the only tests in the package are ones living in `kv/*_test.go`
files. The `tests/` package's tests don't count as exercising `kv`,
because from `kv`'s test binary's perspective they aren't running.

This is a perfectly sensible default for unit-tested code. It is a
trap for repos that deliberately separate integration tests into a
sibling package.

## The fix

Add `-coverpkg`:

```bash
$ go test -coverpkg=./... -cover ./...
ok      minikv/kv         0.001s  coverage: 78.2% of statements in ./...
ok      minikv/tests      4.123s  coverage: 41.1% of statements in ./...
```

`-coverpkg=./...` tells the coverage instrumentation to track *every
package matching this pattern* across *every test binary*. Now the
`tests/` package's test binary records hits in `minikv/kv` and the
percentage reflects reality.

The cost is real but small:

- Every test binary is now instrumented for every package, so build
  size and test runtime grow. For a small repo, unnoticeable. For a
  big monorepo, the percentage hit is non-trivial.
- The per-package number now means "fraction of this package
  exercised by *any* test in the run", not "...by this package's own
  tests". That's the number you usually want anyway.

## Full coverage pipeline

The recipe I use for MiniKV:

```bash
go test -race -count=1 \
    -covermode=atomic \
    -coverprofile=/tmp/cover.out \
    -coverpkg=./... \
    ./... -timeout 180s

go tool cover -func=/tmp/cover.out | tail -20
go tool cover -func=/tmp/cover.out | grep total
go tool cover -html=/tmp/cover.out -o /tmp/cover.html
```

Notes:

- `-covermode=atomic` is required when combined with `-race`. The
  default `set` mode is not safe under concurrent execution.
- `-count=1` disables the test-result cache. With caching on, running
  the same suite twice in a row can yield "cached" results that don't
  regenerate the profile.
- The `total` line at the bottom is your top-level number. Mine sits
  at around 64.7%.

## The "what to test next" trick

`go tool cover -func` prints per-function coverage. Sort it and look
for the 0%-coverage entries:

```bash
go tool cover -func=/tmp/cover.out | awk '$NF=="0.0%"'
```

That list is your TODO. Be careful: some entries are intentionally
0% (CLI `main`, generated protobuf String/Descriptor methods). The
ones worth caring about are exported functions you wrote yourself.

In my case, the 0%-coverage list surfaced the FSM `Restore` path —
which led to writing
[`TestFSMSnapshotRestoreRoundTrip`](../kv/raftnode/fsm_test.go) and
moving raft-node coverage from 24% to 57%.

## The zsh footgun while we're at it

This is unrelated to coverage but I tripped over it in the same
session:

```bash
$ go test ... && echo === && go tool cover ...
zsh: == not found
```

`zsh` interprets a bare `===` as an attempt to invoke a command named
`==`. Quote it:

```bash
$ go test ... && echo '===' && go tool cover ...
```

Or use literally anything else as a separator: `echo done`,
`echo ----`. Two minutes of "why is my command silently exiting?"
diagnosed.

## Take-away

- If your tests live in a different package, add `-coverpkg=./...`.
- Use `-covermode=atomic` with `-race`.
- Use the 0%-function list as a TODO, not as a verdict.
- Don't type `===` into zsh.
