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

Not a how-to. Just the war stories behind every "why is this written so weirdly?" line in the repo.

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

Fix ([nyc_taxi_pipeline.py](nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py)):

```python
size = os.path.getsize(local_path)
if size < 1_000_000:
    raise RuntimeError(f"Suspiciously small download: {local_path} ({size} bytes)")
```

**Lesson**: every external download needs the cheapest possible sanity check — size, row count, first bytes.

## 2. Cleanup got skipped; the disk filled up silently

Cleanup originally used the default `trigger_rule="all_success"`. One week the DAG failed a few times in a row, cleanup was skipped each time, `/tmp` quietly grew until the Airflow webserver couldn't start.

Fix:

```python
cleanup_task = PythonOperator(
    task_id="cleanup_download_dir",
    python_callable=cleanup_download_dir,
    trigger_rule="all_done",
)
```

Plus `ignore_errors=True` in the cleanup function to stay idempotent.

**Lesson**: on a single-VM Airflow, cleanup must run unconditionally.

## 3. `terraform destroy` once nuked the BigQuery dataset

Routine dev-env cleanup, reflexive `terraform destroy` — and the dataset (and all dbt-materialized results) went with it. 30 minutes to rebuild.

In prod, that's not a 30-minute story.

That incident is what produced the [three-layer Terraform guards](03-terraform-anti-delete.md): `prevent_destroy` + `allow_destroy` variable + `force_destroy=false` by default.

**Lesson**: deliberate friction on destructive paths beats trusting your memory.

## 4. The SA started as `roles/owner`

To "just get it working", the first version gave the Airflow SA Owner. It worked, and it meant:

- The SA could change IAM (privilege escalation)
- The SA could delete any bucket (one typo away from disaster)
- If the key ever leaked, the whole project was compromised

Narrowed to least privilege ([main.tf](nyc_taxi_pipeline/terraform/main.tf)):

```hcl
google_project_iam_member.airflow_bq_data   # roles/bigquery.dataEditor
google_project_iam_member.airflow_bq_jobs   # roles/bigquery.jobUser
google_storage_bucket_iam_member.airflow_gcs # roles/storage.objectAdmin (bucket-scoped)
```

**Lesson**: shrinking from Owner is 10× harder than starting tight. Use narrow scopes on day one.

## 5. Local tfstate almost forced a full rebuild

`terraform init` defaults to local backend; state sat in `terraform.tfstate`. Moved to a new machine without syncing it — and it's in `.gitignore` by default.

`terraform apply` tried to re-create every existing resource → "already exists" everywhere → an hour of `terraform import` per resource.

Fix:

```hcl
backend "gcs" {
  prefix = "tfstate/cabstream"
}
```

with `bucket=` injected at init. State lives in GCS, machines and people stay consistent.

**Lesson**: unless the project is a 100%-toy, remote state on **day one**.

## 6. `params` weren't validated; SQL was silently misassembled

The first `download_taxi_data` just did:

```python
months = context["params"]["months"]
for m in months:
    year, month_num = m.split("-")
```

A user passed `["2023-1"]`. URL became `yellow_tripdata_2023-1.parquet`. TLC's real file is `2023-01.parquet`. 404 with a vague error. 30 minutes wasted.

Fix:

```python
def _year_month(month: str) -> tuple[str, str]:
    parts = month.split("-", 1)
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        raise ValueError(f"Expected YYYY-MM, got {month!r}")
    return parts[0], parts[1]
```

**Lesson**: DAG `params` are user input. Treat them like user input (validate, raise, unit-test).

## The meta-lesson

Lined up, all six stories have the same shape:

> "The shortcut costs hours of debugging, a few re-runs, and an occasional data loss."

The "looks unnecessary" effort worth investing in a data pipeline: size checks, `all_done` cleanup, `prevent_destroy`, least privilege, remote state, params validation. One by one — your future self thanks you in six months.
