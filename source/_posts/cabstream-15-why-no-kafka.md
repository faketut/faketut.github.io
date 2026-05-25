---
title: "Why I Didn't Use Kafka, Dataflow, or Composer"
date: 2026-05-15 15:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

The repo is named **CabStream**-ETL — and yet there's no Kafka, no Pub/Sub, no Dataflow, not even managed Airflow (Composer). Everyone who sees the repo asks why.

Here's the honest selection process.

## Start with the upstream shape

NYC TLC publishes yellow taxi data as:

- **Monthly** parquet files
- Released about **1 ~ 2 months after the month ends**
- Stable URL pattern (`yellow_tripdata_2023-01.parquet`)
- 50 ~ 200 MB per file

So the upstream itself is **discrete, low-frequency, batch**.

> "Streaming" requires the upstream to actually produce a stream of events. If the upstream publishes one file a month, sticking a Kafka in front of it is just inventing extra work.

## Killing the streaming options one by one

### Kafka / Pub/Sub

Fits: high-frequency event streams (clickstream, IoT, order events).

This project:

- Upstream isn't events — it's parquet files. To use Kafka I'd have to write a "split files into events" producer. Pointless.
- BigQuery already supports streaming inserts. There is no latency requirement to optimize for.

**Verdict**: not introducing.

### Dataflow

Fits: very large ETL (hundreds of TB), complex windowed aggregation, true stream processing.

This project:

- ~3 M rows/month. BigQuery CTAS finishes in seconds.
- No windowed aggregation (aggregation lives in dbt).
- Dataflow's baseline worker count and cost don't make sense at this size.

**Verdict**: not introducing.

### Composer (managed Airflow)

Fits: multi-person teams, strict SLAs, no appetite for running the scheduler.

This project:

- One person.
- No external SLA (a one-day dashboard delay is invisible).
- Composer baseline ~$300/month. Self-hosted e2-standard-2 is ~$30/month.

**Verdict**: not introducing.

## So why is the repo still called "CabStream"

Honest answer: **I did start out wanting to make it streaming.** The plan was Pub/Sub for synthetic events, Dataflow for windowed aggregation, BigQuery streaming insert.

Halfway into week one it became obvious that:

1. 70% of my time would be spent **manufacturing fake events** rather than analyzing real business
2. Every business query I cared about was offline analysis (by day, by zone) — second-level latency was irrelevant
3. For the same (in fact lower) cost, the batch design let me build two more dashboards

After cutting the streaming layer, the overall complexity halved. **I kept the name as a reminder — "looks cool" and "is actually needed" are different things.**

## A "do you really need streaming?" checklist

| Signal | Streaming? |
|---|---|
| Upstream is event-sourced (clicks, sensors, orders) | ✓ |
| Business needs second-to-minute latency | ✓ |
| Windowed / sessionized aggregation required | ✓ |
| Missing an event is unrecoverable (online features, risk control) | ✓ |
| Upstream is scheduled files | ✗ |
| Use case is BI dashboards | ✗ |
| "The boss says we should do streaming" | Not a signal |

You need four checks before considering streaming. Zero checks and you're trading engineering complexity for a buzzword on a slide.

## So where is this project actually "modern"

- **All infra in IaC** (Terraform)
- **Version-controlled SQL modeling** (dbt)
- **CI running tests + validate + parse**
- **Single SA, least privilege, IP-restricted firewall**

Those are the parts of "modern data stack" that **survive over time** — and they matter much more than streaming-vs-batch.

## One-liner

> Selection should run from "shape of the problem" → "tool", not "tool I want to use" → "problem". Not using Kafka isn't embarrassing. Forcing it in is.
