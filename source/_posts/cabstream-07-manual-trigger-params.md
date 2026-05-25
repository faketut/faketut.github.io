---
title: "Manual Trigger + `params`: Treating Airflow as a Programmable Batch CLI"
date: 2026-05-13 15:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

Tutorials almost always set `schedule_interval` to `@daily` or a cron expression. This project's DAG looks like this instead:

```python
with DAG(
    dag_id="nyc_taxi_pipeline",
    schedule_interval=None,                # no auto-scheduling
    start_date=datetime(2023, 1, 1),
    catchup=False,
    params={"months": DEFAULT_MONTHS},     # overridable at trigger time
) as dag:
    ...
```

"Manual trigger + params" looks counter-cultural. In backfill-heavy workloads it's the most pleasant pattern I've found.

## What running it looks like

UI: click "Trigger DAG with config", then:

```json
{"months": ["2023-05", "2023-06"]}
```

Or CLI:

```bash
airflow dags trigger nyc_taxi_pipeline \
  --conf '{"months": ["2023-05", "2023-06"]}'
```

The task reads it like this:

```python
def download_taxi_data(**context) -> str:
    params = context.get("params") or {}
    months = params.get("months") or DEFAULT_MONTHS
    ...
```

## Why not `@monthly` + `catchup=True`

The mainstream pattern is to schedule it monthly and let `catchup` backfill. That has hidden costs:

1. **Backfills explode**: scheduler may launch 6 concurrent runs, then BigQuery rate-limits you
2. **"Just January and May, skip the rest" is awkward** — `catchup` only knows ranges
3. **`execution_date` semantics are heavy**; even after Airflow 2.x renamed it `logical_date`, it confuses newcomers

Make "which months" an explicit parameter and all three problems vanish.

## When this pattern fits

- Upstream is **discrete files** (monthly, versioned), not an event stream
- Tasks are **idempotent**, so re-runs are safe (this project uses `CREATE OR REPLACE`)
- The team is small and **no external system depends on the DAG running "on time"**

Flip side: if the business needs "today's report by 9 AM", go back to cron + SLA.

## Two supporting pieces

**Piece 1: a working default**

```python
DEFAULT_MONTHS = ["2023-01", "2023-02", "2023-03"]
```

Triggering without params still gives a smoke-test run. Hugely friendly for new maintainers.

**Piece 2: validate the params**

```python
def _year_month(month: str) -> tuple[str, str]:
    parts = month.split("-", 1)
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        raise ValueError(f"Expected YYYY-MM, got {month!r}")
    return parts[0], parts[1]
```

The Airflow UI form is untyped. The first time a user types `"2023-1"`, fail fast with a clear message.

## One-liner

> When your DAG's shape is "one run = process one discrete batch of inputs", `schedule_interval=None` + `params` is simpler than cron + `catchup`, and it unifies backfill and routine runs through the same surface.

> File: [nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py](nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py)
