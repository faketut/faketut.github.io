---
title: "GCS Lifecycle Rules: Two Mindsets — Delete vs. Demote"
date: 2026-05-13 03:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

When people write GCS lifecycle rules they reach for one verb: **delete at age N**. The habit worth picking up in data engineering is the other one: **demote at age N**.

This project has a short rule:

```hcl
lifecycle_rule {
  action {
    type          = "SetStorageClass"
    storage_class = "NEARLINE"
  }
  condition {
    age            = 30
    matches_prefix = ["staging/"]
  }
}
```

What it does: objects under the `staging/` prefix transition to NEARLINE after 30 days.

## Delete vs. demote, side by side

| Dimension | `Delete` | `SetStorageClass` to NEARLINE |
|---|---|---|
| Storage cost saved | 100% | ~50% |
| Recoverable | No | Yes |
| Retrieval latency | — | Milliseconds (NEARLINE isn't ARCHIVE — no thaw) |
| Retrieval fee | — | A few cents per GB |
| Cost of being wrong | Irrecoverable | One retrieval charge |

For a project where a single human runs `terraform apply` from a laptop, that second row is the difference between sleeping well and not.

## Why only `staging/`

`matches_prefix = ["staging/"]` is the load-bearing part. The bucket has two top-level prefixes:

- `yellow_tripdata/` — raw monthly parquet, **permanently STANDARD**, BigQuery external tables read it directly
- `staging/` — every temporary artifact (manual exports, backfill intermediates, debug dumps)

Only staging is safe to demote, because:

1. The prefix is already temporary by intent
2. If you need it back, you can re-derive it from `yellow_tripdata/`

A blanket rule over the whole bucket would silently trigger NEARLINE retrieval charges every time BigQuery queries an external table — next month's bill is awkward.

## Two related mistakes worth naming

**Mistake 1: using `Delete` + `age=N` as "auto cleanup"**

GCS lifecycle is asynchronous and can lag by hours. If your business logic depends on "the object is definitely gone on day N+1", you will eventually be wrong. For deterministic deletes, do it in Airflow.

**Mistake 2: forgetting versioning when configuring `Delete`**

If the bucket has object versioning on, a plain `Delete` just creates a noncurrent version — no actual savings. You'd also need `NumberOfNewerVersions` conditions. This project doesn't enable versioning, so this trap doesn't bite — **but the fact that versioning is off deserves a wiki note of its own.**

## One-liner

> The default verb for data-asset lifecycle rules should be "demote", not "delete". Delete is the last optimization, not the first move.

> File: [nyc_taxi_pipeline/terraform/main.tf](nyc_taxi_pipeline/terraform/main.tf#L57-L74)
