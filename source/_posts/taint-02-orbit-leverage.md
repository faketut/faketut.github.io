---
title: "What we didn't have to build"
date: 2026-06-20 15:00:00
tags:
  - taint-flow-auditor
  - security
  - gitlab
  - gitlab-orbit
  - knowledge-graph
  - duckdb
  - python
categories:
  - engineering
  - security
---

*Post 2 of 6 in the "Taint-Flow Auditor" series.*

In {% post_link taint-01-why-sast-misses-sqli "post 1" %} we showed why
pattern matchers miss SQL injections that cross function boundaries: they
don't carry a call graph. The fix is conceptually trivial — BFS over an
interprocedural call graph from sources to sinks. The reason nobody
open-sourced this for security analysis is that building the call graph is
**a multi-year compiler project per language**.

Until you let GitLab Orbit do it.

This post is about what we *didn't* have to build, because Orbit already
shipped it. It's the most important post in the series — if you take one
thing away, take this: **Orbit is roughly 80% of the work in this project**.
We just walked the graph it produced.

## What `orbit index .` actually does

One command, in any directory with a `.git`:

```
$ orbit index .
  Found 6 files, 5 parseable (python: 5)
parse + graph [████████████████████████████████████████] 5/5
resolve       [████████████████████████████████████████] 5/5
{
  "repository": "demo-app",
  "graph": {
    "directories": 1,
    "files": 6,
    "definitions": 12,
    "imported_symbols": 11,
    "relationships": 49
  },
  "database_path": "/Users/you/.orbit/graph.duckdb"
}
```

That `relationships: 49` includes the only number that matters for our
purposes: the count of `Definition CALLS Definition` edges. Every function
call across this six-file demo, name-resolved, in 48 milliseconds, written
into a DuckDB file we can read from any language with a SQL client.

## What's actually in the graph

The schema is documented at
<https://docs.gitlab.com/orbit/local/schema/>, but here's the shape that
matters for security analysis, expressed as the five tables we touch:

| Table | What it stores |
|---|---|
| `_orbit_manifest` | One row per indexed repo: `project_id`, `repo_path`, `status` |
| `gl_file` | One row per source file: `path`, `language` |
| `gl_definition` | One row per function/class/method: `id`, `fqn`, `name`, `definition_type`, `file_path`, `start_line`, `end_line` |
| `gl_imported_symbol` | Per-file import edges — used by the resolver to disambiguate `from db import run_search` |
| `gl_edge` | Cross-definition edges: `source_id`, `target_id`, `source_kind`, `target_kind`, `relationship_kind` |

The killer query is one line:

```sql
SELECT source_id, target_id
FROM gl_edge
WHERE relationship_kind = 'CALLS'
  AND source_kind = 'Definition'
  AND target_kind = 'Definition'
```

That's the adjacency list of the interprocedural call graph for the
entire repository. Already resolved across files. Already resolved across
import aliases. Already resolved across re-exports.

## The eleven languages we got for free

Orbit currently indexes:

> Ruby · Java · Kotlin · Python · TypeScript · JavaScript · Rust · Go ·
> C# · C · C++ · PHP · Bash/Shell · Elixir

Pause on this. Each of those languages required someone to write:

- A tolerant parser (tree-sitter or hand-rolled)
- A symbol table walker
- A name resolver (handling `from x import y as z`, `package x.y.z`,
  Rust's `pub use`, Ruby's `include`, etc.)
- An import graph (handling Python's relative imports, TypeScript's
  module resolution algorithm, Go's vendor directories, etc.)
- A call site detector that distinguishes `foo()` (the function call) from
  `foo` (the reference) from `obj.foo()` (the method call on a typed
  receiver) from `foo.bar.baz()` (a chain)

Doing this **once**, for **one** language, is a senior-eng quarter at
minimum. Doing it for eleven languages well enough to be the substrate
for code intelligence at GitLab's scale is **tens of thousands of lines of
parser frontend** and years of cumulative work.

## What the same project would have cost without Orbit

Concretely, if we had to build only the Python piece ourselves from scratch:

1. **Parser**: ~2 weeks. CPython's AST module gives us a head start but
   doesn't handle syntax errors gracefully, doesn't track byte offsets
   well, and dies on partial files.
2. **Name resolution**: ~1 month. Python's scoping is subtle — closures,
   class bodies as scopes, comprehensions, walrus operator, `nonlocal`,
   `global`, `__init__.py` re-exports, conditional imports.
3. **Import graph**: ~2 weeks. Relative imports, namespace packages,
   `__init__.py` star-imports, `importlib.import_module` (give up here).
4. **Call edges with type-aware method resolution**: ~1 month for an
   honest cut, *years* to do it well.

That's roughly **3 months of one engineer's full-time work** to reach a
prototype that handles Python *only*. Multiply by 11 languages and the
arithmetic falls apart: nobody on a hackathon team has 33 engineer-months.

With Orbit: `orbit index .` runs in 48 ms.

## What we wrote on top

The entire reachability engine is one Python package, roughly **700 lines
of code**. It has three pieces:

1. **A read-only DuckDB client** (`src/taint_auditor/orbit.py`, ~100
   LoC). Opens `~/.orbit/graph.duckdb` with `duckdb.connect(read_only=True)`
   so we never block a concurrent indexer. Pulls Python definitions and
   call edges with the SQL above. Re-hydrates source content from disk
   on the line ranges Orbit gives us.

2. **An AST classifier** (`src/taint_auditor/analyzer.py`, ~300 LoC).
   For each `Definition`, parse its source slice and check three things:
   does it carry an `@app.route` decorator? Does it call
   `cursor.execute(x)` where `x` isn't a string literal? Does it call
   `shlex.quote`? Three boolean predicates per node → `source` / `sink` /
   `sanitizer` labels. AST is doing very little work here — Orbit's
   already done the hard parts of "what is reachable from where."

3. **A BFS over the call graph** (also `analyzer.py`, ~150 LoC). For each
   source node, BFS outward over `(caller, callee)` edges. Carry a
   `sanitized` bit forward. When we reach a sink, emit a finding. Cap
   depth at 8 to keep things tractable. De-duplicate on a content hash of
   `(source, sink, sink-pattern, path)`. That's the whole algorithm.

The remaining ~150 LoC is the catalog loader (YAML → predicate registry),
the SARIF renderer, and the CLI.

**Roughly**: the security tool is 700 LoC. The graph that makes the
700 LoC possible is on the order of 100,000 LoC of Rust in the Orbit
codebase. We are the visible 0.7%.

## Why this matters for the hackathon, and why it matters for you

For the hackathon: the *interesting* judging question shouldn't be "did
you write a parser?" It should be "what could you build *now that you
don't have to*?" Orbit reframes what a single engineer or a hackathon
team can ship in a weekend.

For you: if you've been mentally filing "interprocedural reachability
analysis" under "things only Snyk and Veracode can afford to build," it's
worth re-checking that assumption. The graph already exists. The query
language is SQL. The hard part is now the catalog — *what counts as a
source, sink, or sanitizer in your codebase*, which is domain knowledge
that doesn't belong in a compiler in the first place.

In **the next post** we'll walk the actual fifty lines of BFS code, the
sanitizer-aware severity demotion, and why the YAML-driven catalog
matters.

---

*Previous: {% post_link taint-01-why-sast-misses-sqli "Why your SAST tool can't see this SQL injection" %}*
*Next: {% post_link taint-03-bfs-on-call-graph "BFS in 50 lines — reachability analysis on a DuckDB call graph" %}*
