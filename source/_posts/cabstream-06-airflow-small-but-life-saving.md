---
title: "Airflow DAG Details That Look Pointless — Until They Save the Run"
date: 2026-05-13 09:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

After enough years with Airflow you realize: the stable DAGs aren't the ones with the cleanest operator choices, they're the ones full of tiny "looks unnecessary" details. This project's DAG only has five tasks, but four of those details are in it.

## 1. Per-run download directory, keyed by `run_id`

```python
def _run_dir(run_id: str) -> str:
    """Per-run download directory, isolates concurrent runs / retries."""
    safe = run_id.replace(":", "-").replace("+", "-")
    return os.path.join(DOWNLOAD_ROOT, safe)
```

Why not just `/tmp/nyc_taxi_data`?

- **Two concurrent backfills** would clobber each other's files
- **A retry** would mix half-finished files into the new run
- Even with `max_active_runs=1`, scheduler timing windows make overlap non-zero

`run_id` contains `:` and `+` (from `manual__2026-05-22T10:30:00+00:00`) — legal on Linux but a footgun for any downstream shell, so sanitize it.

## 2. Size check right after download

```python
size = os.path.getsize(local_path)
if size < 1_000_000:
    raise RuntimeError(f"Suspiciously small download: {local_path} ({size} bytes)")
```

NYC TLC's CDN occasionally responds with `200 OK` and an HTML error page (classic soft failure). `requests.raise_for_status()` doesn't catch this — status is 200, only the body is wrong.

The `< 1MB` threshold is derived from "even the smallest month compressed is tens of MB". Crude, but infinitely better than silently uploading garbage to GCS and getting a cryptic `CREATE EXTERNAL TABLE` schema error an hour later.

## 3. `trigger_rule="all_done"` on cleanup

```python
cleanup_task = PythonOperator(
    task_id="cleanup_download_dir",
    python_callable=cleanup_download_dir,
    trigger_rule="all_done",
)
```

The default `all_success` means cleanup is **skipped** on failure. `/tmp` fills up. A few weeks later the VM disk is full.

`all_done` runs cleanup whether upstream succeeded or failed. The single most overlooked line in single-VM Airflow setups.

Pair it with idempotent cleanup:

```python
def cleanup_download_dir(**context) -> None:
    target_dir = _run_dir(context["run_id"])
    shutil.rmtree(target_dir, ignore_errors=True)
```

`ignore_errors=True` means "directory already gone" is not an error. Covered by `test_cleanup_is_idempotent`.

## 4. All config from env vars, no environment branches

```python
PROJECT_ID = os.environ["GCP_PROJECT_ID"]  # fail fast if unset
BUCKET_NAME = os.environ.get("CABSTREAM_BUCKET", f"{PROJECT_ID}_data_lake")
BIGQUERY_DATASET = os.environ.get("CABSTREAM_DATASET", "nyc_taxi_data")
```

Three notes:

- `PROJECT_ID` uses `os.environ[...]` — **the module fails to import** if it's missing, instead of crashing halfway through a run
- Bucket and dataset have defaults but can be overridden, so the same code runs in test
- There is no `if env == "prod":` branch anywhere; environment differences are entirely env-var driven

## A blunt checklist

When writing a new DAG, run through this:

- [ ] Is the temp directory isolated by `run_id`?
- [ ] Does each external dependency have the cheapest possible sanity check (size, row count, required field)?
- [ ] Is cleanup `all_done` and idempotent?
- [ ] Is config read from env vars, failing loudly on missing required ones?

Four boxes ticked = the DAG will mostly leave you alone for six months.

> File: [nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py](nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py)
