---
title: "Tuition I Paid on This Pipeline"
date: 2026-05-15 09:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

Not a how-to. Just the war stories behind every "why is this written so weirdly?" line in the repo. Lined up, they all have the same shape: the shortcut costs hours of debugging, a few re-runs, and an occasional data loss.

## 1. NYC TLC's CDN returns 200 + HTML error pages

First version:

```python
r = requests.get(url, stream=True)
r.raise_for_status()
with open(local_path, "wb") as f:
    f.write(r.content)
```

One day the CDN hiccuped: a specific URL returned `200 OK` with a maintenance banner HTML in the body. `raise_for_status()` was perfectly happy. Result:

- A 16 KB "parquet" landed in GCS
- `CREATE EXTERNAL TABLE` failed with "Parquet magic bytes not found"
- Two hours of debugging before I realized the download itself was bad

Fix ([nyc_taxi_pipeline.py](https://github.com/faketut/CabStream-ETL/blob/main/nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py)):

```python
size = os.path.getsize(local_path)
if size < 1_000_000:
    raise RuntimeError(f"Suspiciously small download: {local_path} ({size} bytes)")
```

**Lesson**: every external download needs the cheapest possible sanity check — size, row count, first bytes.

## 2. `terraform destroy` once nuked the BigQuery dataset

Routine dev-env cleanup, reflexive `terraform destroy` — and the dataset (and all dbt-materialized results) went with it. 30 minutes to rebuild.

In prod, that's not a 30-minute story.

That incident is what produced the [three-layer Terraform guards]({% post_link cabstream-03-terraform-anti-delete %}): `prevent_destroy` + `allow_destroy` variable + `force_destroy=false` by default.

**Lesson**: deliberate friction on destructive paths beats trusting your memory.

## The other four stories live in their own posts

- Cleanup got skipped and the disk filled up silently → `trigger_rule="all_done"` and idempotent cleanup: {% post_link cabstream-06-airflow-small-but-life-saving %}
- The SA started as `roles/owner` → least privilege on day one: {% post_link cabstream-04-remote-state-sa-firewall %}
- Local tfstate almost forced a full rebuild → remote state on day one: {% post_link cabstream-03-terraform-anti-delete %}
- Unvalidated `params` silently misassembled URLs → validate DAG params like user input: {% post_link cabstream-07-manual-trigger-params %}

The "looks unnecessary" effort worth investing in a data pipeline: size checks, `all_done` cleanup, `prevent_destroy`, least privilege, remote state, params validation. One by one — your future self thanks you in six months.
