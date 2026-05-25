---
title: "Partition + Cluster Without the Hand-Waving: A Worked Example on Taxi Data"
date: 2026-05-14 03:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

BigQuery's two big performance levers are **partition** and **cluster**. The docs are thorough. The question that doesn't get answered cleanly in practice is:

> "I have ten columns that might show up in `WHERE`. Which do I pick?"

There's no silver bullet, but there's a routine. Here it is on this project's real data.

## Step 0: characterize the data

NYC yellow taxi data is ~3 M rows/month. Three columns dominate `WHERE` clauses:

- `tpep_pickup_datetime` — time, filtered in nearly every report (by day or hour)
- `PULocationID` — pickup zone, 100×+ skew between hot zones
- `payment_type` — low cardinality (5 values)

## Step 1: pick the partition

**Partitioning physically splits the table.** Partition pruning is the cheapest filter BigQuery has.

Rules of thumb:

| Property | Good partition? |
|---|---|
| In nearly every query's filter | ✓ |
| Moderate cardinality (< 4000)* | ✓ |
| Even distribution | ✓ |
| Value is known at write time | ✓ |

`tpep_pickup_datetime` hits all four → daily partition:

```sql
PARTITION BY DATE(tpep_pickup_datetime)
```

Note: the partition column must be truncated to a date (`DATE(...)`) — partitioning by raw TIMESTAMP would blow past the 4000-partition limit.

> *BigQuery caps a single table at 4000 partitions: ~11 years at daily granularity, only ~5 months at hourly.

## Step 2: pick the cluster

Clustering **physically sorts within each partition**. It doesn't prune partitions, but it can skip large segments of an "I'm filtering on this column" scan.

Rules of thumb:

- Pick **high-cardinality** columns (clustering on low cardinality buys almost nothing)
- Pick columns that show up in `WHERE` / `JOIN` often
- Up to 4 columns, **order-sensitive** (only prefix matches are pruned)

This project clusters on `PULocationID`:

```sql
CLUSTER BY PULocationID
```

Reasoning:
- Cardinality ~265 — high enough
- Almost every location-based mart filters or groups on it
- `payment_type` cardinality is 5 — clustering on it earns roughly nothing

## Step 3: in mart layers, use a different cluster key

Note that [fact_trips](nyc_taxi_pipeline/dbt/models/fact_trips.sql) is `CLUSTER BY pickup_location_id`, but [mart_hourly_trips](nyc_taxi_pipeline/dbt/models/mart_hourly_trips.sql) flips to:

```sql
{{ config(
    partition_by = {"field": "pickup_date", ...},
    cluster_by = ["pickup_hour"]
)}}
```

Why? The query patterns differ:

- fact_trips: detail queries — "what happened in zone X on day Y"
- mart_hourly_trips: BI reports — "what does the 24-hour curve look like"

**The same underlying data can — and should — have different cluster keys at different layers.** A side benefit of multi-layer dbt modeling.

## Approximate savings

Take a typical query:

```sql
SELECT SUM(total_amount)
FROM yellow_tripdata
WHERE DATE(tpep_pickup_datetime) BETWEEN '2023-01-15' AND '2023-01-21'
  AND PULocationID = 132;
```

| Table design | Bytes scanned | Relative cost |
|---|---|---|
| Unpartitioned, unclustered | ~2 GB (full table) | 100% |
| Daily partition only | ~50 MB (7 days) | 2.5% |
| Partition + cluster on PULocationID | ~3 MB | 0.15% |

The cluster gain shows up most when the filter value is concentrated on a high-cardinality column.

## Three counter-intuitive takeaways

- **More partitions is not better.** Hourly partitions are almost always a trap; daily is enough.
- **More cluster columns is not better.** Only the first one prunes aggressively; later ones decay fast.
- **Same data, multiple cluster variants is fine.** Maintain a fact-table cluster and a mart-table cluster independently.

> Files: [nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py](nyc_taxi_pipeline/airflow/nyc_taxi_pipeline.py), [nyc_taxi_pipeline/dbt/models/fact_trips.sql](nyc_taxi_pipeline/dbt/models/fact_trips.sql)
