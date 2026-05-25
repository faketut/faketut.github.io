---
title: "Managing \"Semi-Static\" Reference Tables with dbt Seeds"
date: 2026-05-14 15:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

There's a category of table that's awkward to manage:

- It's real business data, not configuration
- But it changes slowly — once a year, sometimes not at all
- A dedicated ETL is overkill; hand-maintenance is forget-prone

NYC TLC's `taxi_zone_lookup.csv` (265 rows mapping LocationID to borough/zone) is the canonical example. This project manages it as a dbt seed, and it's been smoother than expected.

## Where it lives

```
nyc_taxi_pipeline/dbt/
├── dbt_project.yml
└── seeds/
    └── taxi_zone_lookup.csv
```

A single `dbt seed` uploads it to BigQuery:

```bash
dbt seed
# creates nyc_taxi_data.taxi_zone_lookup
```

Downstream models reference it just like any other model:

```sql
-- dim_zones.sql
LEFT JOIN {{ ref('taxi_zone_lookup') }} l
       ON z.location_id = l.LocationID
```

## Why this beats the alternatives

| Approach | Problem |
|---|---|
| Hand-create the table in BigQuery | No one knows where it came from or what was edited |
| Put CSV in GCS + external table | Extra layer, case-sensitivity surprises in CSV |
| Hardcode it in Python | Need a release for every change |
| **dbt seed** | Version-controlled, diff-able, one command to sync |

The biggest win is **the file is in Git**. The hidden hazard with semi-static data isn't that it changes — it's that **changes go unnoticed**. Git is the cheapest audit log.

## Good fit

- ~1 to ~10,000 rows
- Sub-monthly change rate
- Source is hand-maintained or periodically downloaded
- Examples: country/region mappings, FX tables, product taxonomy, tax rates

## Bad fit

- More than tens of thousands of rows (slow seed upload, Git diffs become meaningless)
- High-frequency changes (write a real DAG)
- Contains PII or credentials (don't put it in Git)

## Two habits worth pairing with seeds

**Habit 1: declare column types in `dbt_project.yml`**

CSV is untyped. Auto-detect happily turns `LocationID` into `INT64` and silently strips leading zeros from codes:

```yaml
seeds:
  nyc_taxi_pipeline:
    taxi_zone_lookup:
      +column_types:
        LocationID: int64
        Borough: string
        Zone: string
        service_zone: string
```

**Habit 2: test the seed in `schema.yml`**

It's the reference table — every downstream join depends on a unique key:

```yaml
seeds:
  - name: taxi_zone_lookup
    columns:
      - name: LocationID
        tests: [unique, not_null]
```

## A real reverse-validation story

A previous project hand-created this kind of table in BigQuery. An analyst once `UPDATE`'d a few rows during testing and forgot to revert. Three weeks later someone noticed a borough name was wrong on a dashboard — and nobody could say what the "correct" version had been.

After moving to dbt seed, `git log seeds/taxi_zone_lookup.csv` is the version history and `dbt seed --full-refresh` is the rollback.

> Files: [nyc_taxi_pipeline/dbt/seeds/taxi_zone_lookup.csv](nyc_taxi_pipeline/dbt/seeds/taxi_zone_lookup.csv), [nyc_taxi_pipeline/dbt/models/dim_zones.sql](nyc_taxi_pipeline/dbt/models/dim_zones.sql)
