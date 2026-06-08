---
layout: post
title: "How I Made a Quant Paper Reproducible in `make all` Under a Minute"
date: 2026-06-27
tags: [reproducibility, python, uv, typst, tooling, quant]
---

The QMJ-TSX project has a hard constraint baked into the design: a
fresh clone, on a normal laptop, with no subscriptions, should
regenerate every number in the paper — and the paper PDF itself — in
under a minute. This post is about how the project meets that
constraint and why it was worth treating reproducibility as a *design
parameter* rather than a politeness.

## The acceptance test

```bash
git clone https://github.com/faketut/qmj-tsx
cd qmj-tsx
uv sync
make all
```

If, at the end of `make all`, `paper/main.pdf` exists and its
headline numbers match the version on GitHub, the project is
working. That is the acceptance test, and CI enforces it. Everything
below is in service of keeping that loop short and unambiguous.

## The four pieces

### 1. `uv` for the Python environment

`uv` replaces `pip + venv + pip-tools` with a single fast resolver.
`uv sync` reads `pyproject.toml` and `uv.lock`, builds a hermetic
venv, and is done in seconds on a warm cache. There is no
`requirements.txt`, no Conda, no Docker. Two reasons this matters:

- A reader who is bouncing off your repo will *not* install Conda or
  Docker to read your paper. They will close the tab.
- A locked resolver means the numbers I report today will still
  resolve to the same library versions in two years. That is the
  whole point of a lock file.

### 2. `make` as the command surface

The `Makefile` is the canonical entry point:

| Target          | Produces                                                       |
| --------------- | -------------------------------------------------------------- |
| `make data`     | Cached parquets: prices, AQR benchmarks, Ken French FF5+UMD    |
| `make signals`  | paper-Q monthly panel                                          |
| `make backtest` | Long–short returns + summary                                   |
| `make robust`   | Headline sweep, sector-exclusion, per-component horse race     |
| `make figures`  | `paper/figures/cumret.pdf`                                     |
| `make paper`    | `paper/main.pdf` (via Typst)                                   |
| `make all`      | All of the above                                               |
| `make test`     | Unit + invariant tests                                         |

`make` is not glamorous, but it is the lowest-common-denominator
build tool. Everyone has it. Targets compose. Failed targets stop
the pipeline at the failure site, which is exactly what you want
for a research build.

### 3. A typed CLI surface, not notebook cells

Underneath `make`, every step is a `qmj` subcommand:

```bash
qmj data prices                   # yfinance monthly parquets
qmj data benchmarks               # AQR QMJ/BAB-Canada
qmj data ken-french               # FF5-DEV + UMD-DEV
qmj replicate                     # AQR QMJ-CAN baseline + FF5 cross-check
qmj signals paper-q               # price-based Quality panel
qmj backtest                      # long–short portfolio + summary
qmj robust                        # weighting × buckets × subperiod × cost sweep
qmj figure cumret                 # cumulative-return figure
```

The CLI exists so that *every* number in the paper has a
deterministic, single-command provenance. The number for the
post-COVID Sharpe came from `qmj robust`, not from a notebook cell I
ran in some order I can no longer remember. Notebooks are great for
exploration and terrible for archival. Promote anything you intend
to *cite* into a CLI command.

### 4. Parquet caches under `data/`

Raw downloads (yfinance prices, AQR CSVs, Ken French ZIPs) land in
`data/raw/` and are gitignored. Processed monthly panels are
parquet under `data/processed/`. Steps downstream of `data` are
fully offline. Two practical wins:

- `make all` after `make data` runs in seconds because nothing
  re-hits the network.
- A future reader whose internet is broken (or whose data source
  has rotted) can still reproduce everything from the released
  parquet bundle.

## The paper compiles too

The paper is in Typst (`paper/main.typ` + `paper/sections/*.typ` +
`paper/tables/*.typ`). `make paper` runs `typst compile` on it and
produces `paper/main.pdf`. There is no separate "build the paper"
ritual disconnected from "build the numbers." The same `make all`
that regenerates the backtest also re-compiles the paper that cites
the backtest. (More on the Typst choice in a
[later post](2026-07-11-typst-instead-of-latex.md).)

## What this buys you

Three things that compound:

1. **Reviewers and readers can verify you.** Anyone who suspects a
   number can reproduce it without asking me a single question.
   That is — and this is the dirty secret of empirical finance — far
   from the default.
2. **Future-you can extend without archaeology.** Six months from
   now, when I want to add a new robustness cell, I add a CLI
   subcommand and a `make` target. I do not re-derive what `paper-Q`
   was.
3. **The repo is its own demo.** A hiring manager reading the
   README sees the acceptance test and either runs it or doesn't.
   Either way the bar is concrete.

## What I would skip if you're starting from scratch

- **Don't bother with Docker** for a project this size. `uv` plus
  pinned Python in `pyproject.toml` is enough.
- **Don't ship notebooks as primary deliverables.** Ship a CLI and a
  `make` target. A notebook can be a *demo* of the CLI; it cannot be
  the canonical source of any number that ends up in your paper.
- **Don't over-engineer the data layer.** Parquet files in a flat
  `data/processed/` directory, named after what produced them. No
  database. No DVC. You can graduate to those when the dataset
  outgrows a laptop.

The whole pipeline is maybe 1,500 lines of Python plus a hundred
lines of Typst. The point isn't that the project is small — it's
that reproducibility doesn't *require* it to be large.

---

*Repo: [github.com/faketut/qmj-tsx](https://github.com/faketut/qmj-tsx).
The acceptance test is `make all` after `uv sync`.*
