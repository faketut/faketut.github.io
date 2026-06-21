---
title: "BFS in 50 lines: reachability analysis on a DuckDB call graph"
date: 2026-06-27 09:00:00
tags:
  - taint-flow-auditor
  - security
  - gitlab
  - duckdb
  - python
  - call-graph
  - bfs
categories:
  - engineering
  - security
---

*Post 3 of 6 in the "Taint-Flow Auditor" series.*

In {% post_link taint-02-orbit-leverage "post 2" %} we showed that GitLab
Orbit hands you the interprocedural call graph as a DuckDB table. This
post is about the analysis we built on top — a sanitizer-aware taint
reachability BFS in about fifty lines.

Three components, in order of how much code they own:

1. **Per-Definition AST classifier** — `source` / `sink` / `sanitizer`?
2. **BFS over Orbit's edges** — with a `sanitized` bit carried along the path.
3. **YAML catalog** — extensible without touching Python.

## The data we start with

After `orbit index .`, two SQL queries give us everything we need:

```sql
-- (1) Every Python function/method/class in scope
SELECT d.id, d.fqn, d.name, d.definition_type,
       d.file_path, d.start_line, d.end_line
FROM gl_definition d
JOIN gl_file f USING (project_id, path)
WHERE lower(f.language) = 'python'
```

```sql
-- (2) Every interprocedural call edge
SELECT source_id, target_id
FROM gl_edge
WHERE relationship_kind = 'CALLS'
  AND source_kind = 'Definition'
  AND target_kind = 'Definition'
```

That's it for graph data. The first query gives us nodes (and source
line ranges so we can read the bodies). The second gives us directed edges.

## Step 1 — Classify each Definition

For each `Definition`, we read its source slice from disk and parse it
once. We're not doing dataflow inside the function — we just want three
booleans: is this a source, a sink, a sanitizer? An `ast.NodeVisitor`
collects three things from the body:

```python
@dataclass
class DefScan:
    decorators: list[str]           # ["app.route", "auth.required", ...]
    attribute_reads: set[str]        # {"request.args.get", "self.cfg", ...}
    calls: list[CallSite]            # [(callee, line, non_literal_first_arg)]
```

Then the catalog turns those into labels. Slightly simplified:

```python
def classify(defn, scan, catalog):
    is_source = (
        any(d in catalog.source_decorators for d in scan.decorators)
        or any(a.startswith(p) for a in scan.attribute_reads
                              for p in catalog.source_attribute_reads)
        or any(c.callee in catalog.source_calls for c in scan.calls)
    )
    sink_hits = [
        (c.callee, c.line)
        for c in scan.calls
        if c.callee in catalog.sink_calls
        and not (c.callee.endswith(".execute") and not c.non_literal_first_arg)
    ]
    has_sanitizer = any(c.callee in catalog.sanitizer_calls for c in scan.calls)
    return is_source, sink_hits, has_sanitizer
```

Two things worth flagging:

- The `cursor.execute` special case. If the first arg is a string literal,
  it can't be SQLi — skip it. This single predicate is what stops the
  scanner flagging every ORM call in the codebase. AST is doing the bare
  minimum to **refine** Orbit's coarser "this function reaches that
  function" signal.
- Prefix matching on attribute reads. `request.args` in the catalog
  matches `request.args.get(...)` in code. The catalog stays declarative;
  Python AST does the matching.

## Step 2 — BFS over the call graph

Here's the actual loop, minus the dataclass plumbing:

```python
for src in sources:
    queue = deque([(src.id, (src.id,), src.has_sanitizer)])
    best_depth = {}

    while queue:
        cur_id, path, sanitized = queue.popleft()
        cur = nodes[cur_id]

        # Did we land on a sink?
        for pattern, line in cur.sink_hits:
            sev = catalog.severity_for(pattern)
            if sanitized and sev != "low":
                sev = "low"   # demote, don't drop
            emit_finding(src, cur, pattern, line, sev, path)

        if len(path) >= MAX_PATH_LEN:
            continue
        if best_depth.get(cur_id, 1 << 30) <= len(path):
            continue
        best_depth[cur_id] = len(path)

        for nxt in edges.get(cur_id, ()):
            if nxt in path:        # no cycles
                continue
            queue.append((
                nxt,
                path + (nxt,),
                sanitized or nodes[nxt].has_sanitizer,   # carry the bit
            ))
```

Four design points are worth pulling out, because the whole "is this a
real analysis or a toy?" question lives in these four lines:

### 1. Carry the `sanitized` bit along the path

Once a BFS path crosses any node that calls a sanitizer (e.g.
`shlex.quote`), every downstream finding from that path is demoted to
LOW. The bit is per-path, not per-node — the same `do_safe_ping` function
demoting a path doesn't demote *other* paths through it that don't pass
through its caller's sanitization.

This is what lets the tool distinguish:

```python
def do_ping(host):
    subprocess.run(f"ping {host}", shell=True)        # HIGH

def do_safe_ping(host):
    safe = shlex.quote(host)
    subprocess.run(f"ping {safe}", shell=True)        # LOW
```

Same sink (`subprocess.run`). Same source (`request.args` upstream).
**Same file.** Difference: one calls `shlex.quote`, the other doesn't.
A regex matcher cannot tell these two apart. The BFS can.

### 2. Demote, don't drop

The temptation, when you detect a sanitizer, is to suppress the finding.
Don't. Sanitizers can be wrong (`shlex.quote` doesn't help if the input
is later eval'd). Sanitizers can be missing on some branches. Sanitizers
can be applied to the wrong variable. *Surface the path, downgrade the
severity.* That's a real security workflow — security review filters by
severity; suppression hides things from security review.

### 3. `best_depth` prunes redundant work

Without `best_depth`, BFS over a dense call graph explodes. With it, we
visit each node at most once per shorter path that reaches it. We still
emit all sink-hits along the way, but we don't re-explore the subtree
from longer paths. In practice this keeps the analysis under a second
even on repos with thousands of definitions.

### 4. Path-in-finding for de-duplication

Each finding carries the full call path (`views.search → db.run_search →
db.run_query`) and de-duplicates on a content hash of
`(source, sink, sink-pattern, path)`. Two different routes that reach
the same sink via the same intermediate functions deserve **one** finding,
not two. Two different sinks reachable from the same source deserve two.

## Step 3 — The YAML catalog

Sources, sinks, and sanitizers live in three YAML files, not in Python:

```yaml
# catalog/sinks.yaml
sinks:
  - pattern: cursor.execute
    kind: call
    severity: high
    arg_predicate: not_string_literal
    fix: "Use a parameterised query: cursor.execute(sql, (param,))"

  - pattern: subprocess.run
    kind: call
    severity: high
    fix: "Pass arguments as a list, not a string, and set shell=False."
```

This matters because **the catalog is the only thing most users will
ever want to change**. Someone running this on a Django codebase wants
to add Django's request shortcuts as sources. Someone with a custom ORM
wants to add their query method as a sink. They should not have to learn
Python AST to do that. They edit a YAML file, and the scanner picks it up
on the next run.

Catalog-driven extensibility is the right boundary for a tool like this.
The Python is the engine; the YAML is the policy.

## What the BFS actually returns

On the [demo app](https://github.com/faketut/Taint-Flow-Auditor/tree/main/examples/demo-app)
in our repo:

```
HIGH    cmd.py:9   sink=subprocess.run
        source: views.ping  (reads request.args)
        path:   views.ping -> cmd.do_ping
        fix:    Pass arguments as a list, not a string, and set shell=False.

HIGH    db.py:20   sink=cursor.execute
        source: views.search  (reads request.args)
        path:   views.search -> db.run_search -> db.run_query
        fix:    Use a parameterised query: cursor.execute(sql, (param,))

MEDIUM  files.py:6 sink=open
        source: views.export  (reads request.args)
        path:   views.export -> files.read_export

LOW     cmd.py:21  sink=subprocess.run
        source: views.healthy_ping  (reads request.args)
        path:   views.healthy_ping -> cmd.do_safe_ping
        note:   path crosses a known sanitizer (severity demoted)
```

Four findings, two of which share `cmd.py` but differ by a single call
to `shlex.quote`. The path under each finding is the BFS trace —
something a regex matcher cannot give you because it never had a graph
to trace through.

In **the next post** we'll talk about what happens when we point the
scanner at its own source code. It is exactly as awkward as it sounds,
and exactly as important.

---

*Previous: {% post_link taint-02-orbit-leverage "What we didn't have to build" %}*
*Next: {% post_link taint-04-honest-tools "Honest tools are trustworthy tools — when we pointed our scanner at itself" %}*
