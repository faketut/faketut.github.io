---
title: "A Usable Taxi Operations Dashboard in 30 Minutes with Looker Studio"
date: 2026-05-16 03:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

A finished pipeline without a dashboard is a half-finished pipeline. Looker Studio (formerly Data Studio) is "free + one-click to BigQuery" inside the GCP ecosystem, and 30 minutes is plenty.

Here's how to turn the five findings from the {% post_link cabstream-18-five-counterintuitive-findings next post %} into charts.

## 0 ~ 5 min: connect data sources

Looker Studio → Create → Data source → BigQuery

Connect each mart (three data sources):

- `nyc_taxi_data.mart_daily_trips`
- `nyc_taxi_data.mart_hourly_trips`
- `nyc_taxi_data.mart_location_trips`

Why not connect `fact_trips` directly?

- Marts are pre-aggregated to match query patterns; refresh is under 1 second
- Connecting fact directly means GB-scale scans on every refresh — bills add up

**This is the entire point of the mart layer.**

## 5 ~ 10 min: four KPI cards

Top row of the dashboard, the "snapshot at a glance":

| Metric | Source |
|---|---|
| Total trips | mart_daily_trips |
| Total revenue | mart_daily_trips |
| Avg fare | mart_daily_trips |
| Avg tip ratio | mart_daily_trips |

Looker's field list shows the mart's columns — pick the count, revenue, and average fields. Add a date range control (default: last 30 days). All cards react to it.

## 10 ~ 17 min: temporal charts

### Chart 1: daily trips trend (line chart)

- Source: mart_daily_trips
- X: pickup_date
- Y: the trip-count metric

One line, but reveals the week-over-week cadence (weekends flatter) plus holidays (note: the week before Christmas is a trough, not a peak — counterintuitive).

### Chart 2: 24-hour × 7-day heatmap

- Source: mart_hourly_trips
- X: pickup_hour
- Y: EXTRACT(DAYOFWEEK FROM pickup_date)
- Color: the trip-count metric

Heatmaps beat line charts for spotting patterns like "Friday rush shifted to 22:00".

## 17 ~ 23 min: geographic charts

### Chart 3: Top 20 pickup zones (bar chart)

- Source: mart_location_trips
- Dimensions: zone, borough (the mart joins dim_zones, so both exist)
- Metrics: the count and revenue metrics
- Sort: trip-count DESC
- Limit: 20

Add a borough filter so you can flip between "Manhattan Top 20" and "Queens Top 20".

### Chart 4: revenue share by borough (pie/donut)

- Source: mart_location_trips
- Dimension: borough
- Metric: the total-revenue metric

Visualizes business concentration; pairs well with Chart 3 to tell the "long tail is long but contributes little" story.

## 23 ~ 28 min: make it interactive

Add three controls:

1. **Date range** — global
2. **Borough** — affects only Charts 3 and 4
3. **Weekday/Weekend toggle** — affects only Chart 2

Looker Studio controls are page-scoped; place them at the top and set "affected charts" explicitly.

## 28 ~ 30 min: share

- File → Share → set to "Anyone with the link can view" for demos only
- For production, use Workspace-domain access or a personal email allowlist
- Embed in a blog: File → Embed report → iframe

## A connector option worth knowing

Looker Studio also supports an "Extract data" connector — it caches BQ data inside Looker's own storage and refreshes daily.

Use it when:
- The dashboard is public; you don't want to pay for BQ scans
- Data is under ~100 MB
- 24-hour lag is acceptable

This project's marts are a few MB. Extract mode is essentially free here — strongly recommended for public sharing.

## One detail that's easy to miss

Every mart is partitioned by `pickup_date`. **Add a date range filter to every chart in Looker Studio** and BigQuery automatically prunes to those partitions — far fewer bytes scanned than "let Looker do the filtering after a full GROUP BY".

That's why every mart in this project has `partition_by`: not for dbt's sake — for BI tools to ride for free.

> Mart definitions: [nyc_taxi_pipeline/dbt/models/mart_daily_trips.sql](https://github.com/faketut/CabStream-ETL/blob/main/nyc_taxi_pipeline/dbt/models/mart_daily_trips.sql), [nyc_taxi_pipeline/dbt/models/mart_hourly_trips.sql](https://github.com/faketut/CabStream-ETL/blob/main/nyc_taxi_pipeline/dbt/models/mart_hourly_trips.sql), [nyc_taxi_pipeline/dbt/models/mart_location_trips.sql](https://github.com/faketut/CabStream-ETL/blob/main/nyc_taxi_pipeline/dbt/models/mart_location_trips.sql)
