---
title: "Roadmap: from function-level to argument-level taint"
date: 2026-07-18 09:00:00
tags:
  - taint-flow-auditor
  - security
  - gitlab
  - roadmap
  - llm
categories:
  - engineering
  - security
---

*Post 6 of 6 in the "Taint-Flow Auditor" series.*

We shipped v1 in a weekend. It's Python-only, function-level reachability,
sanitizer-aware, with a YAML-extensible catalog. It is genuinely useful as
it stands — but it is honest about what it cannot do.

This post is about the four things v2 should do, and — the important part —
why each of them is a small extension on top of GitLab Orbit's existing
graph, not a from-scratch project.

## Where v1 stops

The README has a "Known limitations" section. Three items matter for v2:

1. **Python only.** The AST classifier knows about `@app.route`,
   `request.args`, `cursor.execute` — all Python idioms. Other languages
   need their own classifiers.
2. **Function-level reachability.** When we say `views.search →
   db.run_search → db.run_query → cursor.execute` is a path, we mean *the
   functions are reachable from each other*, not that *the specific
   argument from `views.search` flows into the specific call to
   `cursor.execute`*. If `views.search` reads `request.args.get("q")` but
   the path to `cursor.execute` carries some other argument, we'd still
   flag it.
3. **Sanitizer awareness is presence-based.** If *any* function on the
   path calls `shlex.quote`, we demote. We don't check whether the
   sanitized variable is actually the one that reaches the sink.

Each of these is fixable. Each of the fixes is interesting.

## v2.1 — JavaScript and TypeScript

This is the cheapest extension by far. Orbit already indexes
`JavaScript`, `TypeScript`, and the call edges resolve across `import` /
`require` / re-exports. All we need is a new AST classifier in
`src/taint_auditor/analyzer_js.py` that knows the JS/TS equivalents:

| Concept | Python (v1) | JavaScript (v2.1) |
|---|---|---|
| Web source | `@app.route` decorator, `request.args` | `app.get('/foo', (req, res) => …)`, `req.body`, `req.query` |
| SQL sink | `cursor.execute` (non-literal) | `db.query` (non-template-literal), `knex.raw`, `sequelize.query` |
| Shell sink | `subprocess.run(..., shell=True)` | `child_process.exec`, `execSync` |
| FS sink | `open(path)` | `fs.readFile(path)`, `fs.createReadStream` |
| Sanitizer | `shlex.quote`, `html.escape` | `lodash.escape`, `DOMPurify.sanitize`, `mysql.escape` |

Orbit handles `import { db } from './db'` vs `const db = require('./db')`
vs `import * as db from './db'` identically — same `gl_edge` rows out the
other end. The new classifier needs ~300 lines plus YAML catalogs for the
JS ecosystem.

**Estimated effort:** one week, one engineer.

## v2.2 — Per-argument taint tracking

This is the structural upgrade. v1 says "function A is reachable from
function B"; v2.2 says "argument X of function A is reachable from
argument Y of function B." Concretely, we want to refuse to flag this:

```python
def run_query(sql, log_label):
    log.info(log_label)
    cursor.execute(sql)

def some_view():
    run_query("SELECT 1", request.args.get("label"))
    #          ^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^
    #          literal     tainted, but only flows
    #          (safe)      to log.info, not to execute
```

Today's scanner flags this because *some* untrusted input reaches
`run_query` and `run_query` calls `cursor.execute`. v2.2 wouldn't —
because the tainted argument (`log_label`) is not the one that flows to
`execute`.

The implementation outline:

1. For each `Definition`, build a small intra-procedural dataflow lattice:
   parameters → local variables → return values → call arguments at each
   call site. This is one pass over the AST. SSA-form helps but isn't
   required.
2. At each call site `f(a, b, c)`, record which formal parameter slot of
   the callee each actual argument maps to. Orbit already gives us the
   call edges; we're annotating them.
3. The BFS becomes a BFS over `(definition_id, tainted_param_index)`
   pairs. When the BFS enters a function via the call edge, it switches
   to the parameter slot that was passed the tainted value.

This is closer to "real" interprocedural taint tracking. It still doesn't
handle complex flows (mutations through aliased objects, taint flowing
through return values into the *next* caller's locals, etc.) — that's
v3.0 territory — but it eliminates the most common false-positive
class without leaving the Orbit graph.

**Estimated effort:** two to three weeks, one engineer. Most of the
work is on the intra-procedural dataflow lattice.

## v2.3 — Auto-fix MRs

For a subset of finding patterns, the fix is mechanical:

| Sink pattern | Mechanical fix |
|---|---|
| `cursor.execute("SELECT ... " + x)` | `cursor.execute("SELECT ... ?", (x,))` |
| `subprocess.run(f"... {x}", shell=True)` | `subprocess.run([..., x], shell=False)` |
| `open(user_path)` | `open(safe_join(BASE, user_path))` after adding `safe_join` |

For these, we already emit a one-line `fix:` field in each Finding. v2.3
turns that into an actual code change: when running in CI on an MR, the
auditor opens a *suggested* commit on the MR with the diff applied,
linked to the discussion it posted. The reviewer accepts or rejects.

This is the place where the auditor stops being a security tool and
starts being a security *agent*. The pattern is well-trodden — it's what
Dependabot does for vulnerable dependencies. We have all the pieces:
SARIF output, fix templates, MR API access via `gitlab_post.py`. The
gap is the templating engine that takes a SARIF region + fix template
and produces a textually correct diff.

**Estimated effort:** two weeks per supported sink pattern, with the
first being the most expensive. Six patterns is a month of work.

## v2.4 — IDE-side incremental graph

Orbit's index is incremental. Re-indexing after a one-file edit is
sub-second. We can plug this into a VS Code extension that re-runs the
BFS on the changed function and flags new findings as you type — the
same pattern as TypeScript's language server, but for taint paths
instead of types.

The agent already integrates with Duo Chat (post 5). The IDE extension
is the *non-conversational* surface: a squiggle under the line that
introduces a new sink, with the path in the hover-card. Same engine,
same findings, faster feedback loop.

**Estimated effort:** three weeks, includes packaging.

## Why this whole roadmap is small

If you had to write each of these without Orbit, every item on this list
would be the *entire project*:

- v2.1 requires a JS parser, a TS type-checker, a module resolver — *if*
  you want call edges that don't lie. Months of work per language.
- v2.2 requires a robust per-function CFG and SSA builder, per
  language. Years of work to do across the languages Orbit covers.
- v2.4 requires a language server with incremental indexing. Years.

What Orbit changes is that all of those are now small extensions of
something that already exists. v2.1 reuses Orbit's existing JS indexing.
v2.2 reuses Orbit's existing call graph and adds one pass of local
dataflow. v2.4 reuses Orbit's existing incremental indexer.

A small team can credibly plan a year of this roadmap. Without Orbit,
the same team would still be writing a Python parser.

## The standing offer

Taint-Flow Auditor is MIT-licensed and lives at
<https://github.com/faketut/Taint-Flow-Auditor>. The catalog is the
easiest place to contribute — add a sink pattern for your framework,
open a PR, you're done. The classifier extensions (v2.1) are the
next-easiest. The dataflow lattice (v2.2) is the most interesting
project for someone who wants to learn a little compiler theory in a
real codebase.

If you build on it, tell us. If you find a false positive, file an
issue — we won't suppress it, we'll fix the predicate.

## Wrapping up the series

Six posts in:

1. {% post_link taint-01-why-sast-misses-sqli "Why your SAST tool can't see this SQL injection" %}
2. {% post_link taint-02-orbit-leverage "What we didn't have to build" %}
3. {% post_link taint-03-bfs-on-call-graph "BFS in 50 lines: reachability analysis on a DuckDB call graph" %}
4. {% post_link taint-04-honest-tools "Honest tools are trustworthy tools" %}
5. {% post_link taint-05-duo-agent-walkthrough "Publishing a Duo agent to the GitLab AI Catalog" %}
6. Roadmap (this post)

The thread running through all of them is the same: *the hard part of
security tooling is the call graph, and the call graph is now a
solved problem.* What we built was a small thing on top of someone
else's much bigger thing. That's the right shape for hackathon
projects. It's also the right shape for a lot of things that aren't
hackathon projects.

Thanks for reading.

---

*Previous: {% post_link taint-05-duo-agent-walkthrough "Publishing a Duo agent to the GitLab AI Catalog" %}*
