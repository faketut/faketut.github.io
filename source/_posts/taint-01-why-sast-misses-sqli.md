---
title: "Why your SAST tool can't see this SQL injection"
date: 2026-06-20 09:00:00
tags:
  - taint-flow-auditor
  - security
  - sast
  - sqli
  - python
  - gitlab
categories:
  - engineering
  - security
---

*Post 1 of 6 in the "Taint-Flow Auditor" series — a security tool built on
the GitLab Knowledge Graph for the Transcend Hackathon.*

---

Here is a three-file Flask app. One of these files contains a SQL injection.
Read all three before you keep going.

**`views.py`**

```python
from flask import Flask, request
from db import run_search

app = Flask(__name__)

@app.route("/search")
def search():
    q = request.args.get("q", "")
    rows = run_search(q)
    return {"rows": rows}
```

**`db.py`**

```python
import sqlite3

def _connect():
    return sqlite3.connect(":memory:")

def build_query(q: str) -> str:
    return "SELECT id, title FROM items WHERE title LIKE '%" + q + "%'"

def run_query(sql: str):
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute(sql)
    return cursor.fetchall()

def run_search(q: str):
    sql = build_query(q)
    return run_query(sql)
```

**`cmd.py`** — not relevant here, but you'll see why it matters in a minute.

Where's the bug? Easy: `cursor.execute(sql)` in `run_query`, where `sql` is
built by string concatenation in `build_query`, fed by `q` from
`request.args.get`. Classic SQLi. Three function hops between source and
sink.

Now run the most popular open-source Python SAST tools.

## Bandit

```
$ bandit -r .
>> Issue: [B608:hardcoded_sql_expressions] Possible SQL injection vector
   Location: db.py:11
   sql = "SELECT id, title FROM items WHERE title LIKE '%" + q + "%'"
```

Bandit catches the **string concatenation** in `build_query`. That's a
heuristic — it has no idea whether `q` is actually user input, or whether
the resulting string ever reaches a database driver. If `build_query` were
called only by a unit test, it would still fire.

## Semgrep with the python.sqli ruleset

```
$ semgrep --config p/python.sqli .
findings: 0
```

Semgrep's curated SQLi rules look for the *combined* pattern: a
`cursor.execute(...)` whose first argument is a non-literal **in the same
function**. In our code, `cursor.execute(sql)` and the concatenation live
in different functions. The pattern doesn't match. Silence.

## CodeQL with the Python security pack

CodeQL is the gold standard for AST-based dataflow. It would find this
one — but the cost is steep: you have to build a separate database (`codeql
database create`), tune the queries, and the analysis takes minutes on a
project of any size. It is also locked to specific languages and emits
results that need its own interpretation tooling.

## Why this happens

It's structural. Pattern matchers operate on one of:

1. **A single line** (grep, ripgrep, Bandit's lower-severity checks).
2. **A single AST** (Semgrep, Bandit's higher-severity checks).
3. **A single file's flow** (most "local dataflow" analyzers).

The SQLi above crosses **three function boundaries** and **two files**. To
catch it without false positives, you need to answer:

> "Is there a sequence of function calls that connects *this* function
> reading untrusted input to *that* function calling a dangerous API?"

That's a question about the **call graph** of the entire program. None of
the tools above carry one.

## What would a call graph let us do?

If we had a graph where each function was a node and each function call
was a directed edge, we could:

1. Find all functions that read `request.args` (the *sources*).
2. Find all functions that call `cursor.execute` with a non-literal
   (the *sinks*).
3. BFS from each source over the call graph. If the BFS reaches a sink,
   emit a finding. Print the path.

That's the whole algorithm. The hard part isn't the analysis — it's
building the call graph in the first place. Doing it well across Python's
dynamic dispatch, JavaScript's modules, Go's interface satisfaction, and a
dozen other languages is **a multi-year compiler project** per language.

Which is why nobody open-sourced it for security analysis.

## Until now

GitLab Orbit indexes 11+ languages into a single graph schema, with one
`Definition` row per function/class/method and one `Definition CALLS
Definition` edge per function call — name-resolved, import-tracked,
incremental. One command:

```
$ orbit index .
$ orbit sql "SELECT count(*) FROM gl_edge WHERE relationship_kind='CALLS'"
```

In **the next post** we'll dig into exactly what Orbit gives us for free,
and the order-of-magnitude this saved compared to writing it ourselves.
After that we'll walk the actual BFS code — it's about fifty lines.

If you want to skip ahead: the tool is **Taint-Flow Auditor**, MIT-licensed,
on the [GitLab AI Catalog](https://gitlab.com/explore/ai-catalog/agents/1011619/)
and at <https://github.com/faketut/Taint-Flow-Auditor>.

---

*Next: {% post_link taint-02-orbit-leverage "What we didn't have to build — 11 languages of parsers, name resolution, and import graphs" %}.*
