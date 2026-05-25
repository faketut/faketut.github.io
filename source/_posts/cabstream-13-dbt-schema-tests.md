---
title: "Four Tests Worth Adding to Every dbt `schema.yml` — and the Real Bugs They Catch"
date: 2026-05-15 03:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

dbt's four built-in generic tests — `unique`, `not_null`, `accepted_values`, `relationships` — look unremarkable. Each one maps to a **specific real-world incident**. This project's `schema.yml` is short, but every entry has earned its place.

## 1. `unique` — catches "duplicate primary key"

```yaml
- name: fact_trips
  columns:
    - name: trip_id
      tests: [unique, not_null]
```

`trip_id` is a SHA256 over business fields:

```sql
TO_HEX(SHA256(CONCAT(
    CAST(VendorID AS STRING), '|',
    CAST(tpep_pickup_datetime AS STRING), '|',
    ...
)))
```

How duplicates appear: upstream accidentally posts two copies of the same month (human error). After incremental merge, two identical rows hash to the same `trip_id` → `unique` fails loudly.

**Cost without this test**: mart `COUNT(*)` doubles for that day; an analyst spends half a day explaining a "demand spike" that doesn't exist.

## 2. `not_null` — catches "upstream silently changed"

```yaml
- name: yellow_tripdata
  columns:
    - name: VendorID
      tests: [not_null]
    - name: tpep_pickup_datetime
      tests: [not_null]
    - name: PULocationID
      tests: [not_null]
```

Critically important on **external sources**. NYC TLC occasionally publishes a "revised" parquet where a column that was effectively non-null becomes nullable. They consider it backward-compatible — it's a disaster for downstream joins.

Real catch: `PULocationID` came back NULL for some trips after TLC started including "street hail without GPS upload" records. **Without the test, those rows produce NULL after joining `dim_zones`, then collapse into a phantom group in `mart_location_trips`.**

## 3. `accepted_values` — catches "business semantics drift"

Not in `schema.yml` yet, but strongly recommended:

```yaml
- name: payment_type
  tests:
    - accepted_values:
        values: [1, 2, 3, 4, 5, 6]
```

NYC TLC has expanded `payment_type` twice historically (added "voided trip", "unknown"). New values don't break any SQL — they just leak a "NULL/Other" bucket into every dashboard sliced by payment type. Analysts find it eventually, but only after the report is wrong.

With `accepted_values`, a new value → CI fails → you notice → you decide what to do with it. **Active** instead of **reactive**.

## 4. `relationships` — catches "missing dimension row"

```yaml
- name: fact_trips
  columns:
    - name: pickup_location_id
      tests:
        - relationships:
            to: ref('dim_zones')
            field: location_id
```

Every `pickup_location_id` in the fact should resolve in `dim_zones`. If `taxi_zone_lookup.csv` falls behind (TLC adds a new zone), the fact has orphan IDs.

Because `mart_location_trips` uses `LEFT JOIN`, orphans show up as `borough = NULL` — no error, but the dashboard sprouts a mysterious "unknown borough" group.

`relationships` flags this right after `dbt run`, instead of two days later when an analyst spots it on a chart.

## A priority order for adoption

If you can't add all of these at once, do them in this order:

1. **`unique + not_null` on every primary key** — catches duplication
2. **`not_null` on critical source fields** — catches upstream drift
3. **`relationships` between fact and dim** — catches dim gaps
4. **`accepted_values` on low-cardinality columns** — catches semantic drift

Four boxes ticked removes ~80% of the "weird data" tickets. The remaining 20% need custom generic tests — separate post.

## One anti-pattern

Don't put `not_null` on mart tables. Marts are aggregates; nulls are legal there (a zone with zero trips today may not appear at all, or may appear with `AVG = NULL`). `not_null` belongs at the **source** of facts, not the **aggregate**.

> File: [nyc_taxi_pipeline/dbt/models/schema.yml](nyc_taxi_pipeline/dbt/models/schema.yml)
