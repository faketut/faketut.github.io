---
title: "External Table + CTAS vs. `LoadJob`: A Two-Step Path to Land Parquet in BigQuery"
date: 2026-05-13 21:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

BigQuery offers two ways to turn parquet into a queryable table:

1. **`bq load` / `LoadJob`** — copy parquet into BigQuery's managed storage in one shot
2. **External table + CTAS** — register a virtual table over GCS, then `CREATE TABLE AS SELECT` into a real one

This project takes path 2, via two DAG tasks:

```python
create_external_table_task = BigQueryCreateExternalTableOperator(
    task_id="create_external_table",
    table_resource=EXTERNAL_TABLE_RESOURCE,
)

create_optimized_table_task = BigQueryInsertJobOperator(
    task_id="create_optimized_table",
    configuration={
        "query": {"query": CREATE_OPTIMIZED_SQL, "useLegacySql": False}
    },
)
```

Where `CREATE_OPTIMIZED_SQL` is:

```sql
CREATE OR REPLACE TABLE `{PROJECT_ID}.{BIGQUERY_DATASET}.yellow_tripdata`
PARTITION BY DATE(tpep_pickup_datetime)
CLUSTER BY PULocationID AS
SELECT * FROM `{PROJECT_ID}.{BIGQUERY_DATASET}.external_yellow_tripdata`
```

Why bother, when `LoadJob` is one step?

## Three reasons

### 1. Schema declared once, in code

```python
EXTERNAL_TABLE_SCHEMA = [
    {"name": "VendorID", "type": "INTEGER"},
    {"name": "tpep_pickup_datetime", "type": "TIMESTAMP"},
    ...
]
```

The external table schema is **part of the DAG file**, in Git. The day upstream silently adds a column or changes a type, external-table creation fails — far safer than `LoadJob`'s schema auto-detection (which loves to flip column order or coerce empty columns to `STRING`).

### 2. Partition/cluster live in SQL, not in job config

```sql
PARTITION BY DATE(tpep_pickup_datetime)
CLUSTER BY PULocationID
```

With CTAS, partition expressions, cluster keys, and derived columns (`DATE(...)`, `LOWER(...)`) can be **computed inside SELECT**. `LoadJob`'s `timePartitioning` only accepts an existing column.

Real example: if the upstream timestamp arrives as a string, one `PARSE_TIMESTAMP(...)` in CTAS handles it. With `LoadJob`, you'd load first and `UPDATE` after.

### 3. "Re-run idempotently" is cheap

`CREATE OR REPLACE TABLE ... AS SELECT ...` is a single statement: all-or-nothing, no half-loaded state.

`LoadJob` with `WRITE_TRUNCATE` truncates first and then loads — fail mid-way on a big file and you've lost the previous good copy. With the two-step approach:

- External table creation fails → physical table untouched
- CTAS fails → physical table still holds the previous good version

## When `LoadJob` is actually better

- Truly huge data (hundreds of TB single batch) — save the full-table SELECT scan
- No partition/cluster needed
- Schema is rock-stable

For this project's monthly, GB-scale data, the clarity of the two-step approach beats the marginal slot savings.

## A side benefit people forget

External tables are free to keep around (no storage charge — you pay only when queried). That means:

- During development, you can build just the external table and validate schema/data before writing the CTAS
- When something breaks, you can query the external table in isolation to localize the fault — is it bad source data, or bad CTAS logic?

That "layered debuggability" is not something `LoadJob` can give you.

> File: [nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py](nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py)
