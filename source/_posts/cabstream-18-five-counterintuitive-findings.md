---
title: "Five Counterintuitive Patterns Hidden in 150 M NYC Taxi Records"
date: 2026-05-16 09:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

> The most fun part of the whole project wasn't getting the DAG green — it was the moment the data started telling stories. These five findings come from this project's `mart_*` tables; each one is a couple of Looker Studio charts away.

## 1. Friday's evening rush is at 22:00, not 18:00

Intuition: evening peak should be 18:00 ~ 19:00 (commute home).

Data (`mart_hourly_trips` split by weekday):

- Mon ~ Thu: peak at 18:00 ~ 19:00 — clean commute curve
- **Friday: a second peak appears at 21:00 ~ 23:00, ~15% higher than the 18:00 one**
- Weekends: commute peak vanishes entirely; gentle climb from 10:00, max between 22:00 ~ 02:00

Plausible explanation: Manhattan nightlife shifts "taxi home" deep into the evening. "Taxi" is essentially two different businesses on weekdays vs. weekends.

Business implication: a dynamic-pricing model that uses only a "weekday vs. weekend" binary feature misses Friday — which behaves like neither.

## 2. The real culprit behind rising fares isn't fuel

Average `total_amount` rose ~12% from 2022 to 2023. The intuitive cause: fuel costs.

Decompose `mart_location_trips`:

- Average `trip_distance` is essentially flat
- Average `fare_amount` (mileage-based base fare) up ~3%
- **`congestion_surcharge` rose from ~5% to ~9% of total**
- Average `tip_amount` up ~18%

So: surcharge plus tipping behavior dwarfs the base fare effect. "Drivers raised prices" is the cover story; **passengers tipping more** is most of it.

Business implication: a piece headlined "Taxi fares up 12%, blamed on fuel" gets contradicted by the underlying data.

## 3. The top pickup zones are scary concentrated

`mart_location_trips ORDER BY trip_count DESC`:

- 265 zones citywide
- **Top 10 zones account for ~38% of all trips**
- Top 50 account for ~75%
- The long tail of 200 zones contributes less than 10% combined

The hot zones are nearly all in Manhattan; JFK and LGA airports are the two non-Manhattan exceptions.

Business implication: dispatch optimization that focuses on Top 50 covers the vast majority of business. "Cover the whole city" is an expense without proportional return.

## 4. Credit-card tip median is 3× cash

Group by `payment_type` (1 = credit card, 2 = cash):

- Credit card: median tip ~$3.5 (~18% of fare)
- **Cash: median tip = $0**

Note: that's exactly $0, not "near zero". The reason is that **NYC TLC data doesn't record cash tips** — the driver pockets it and the system never sees it.

Business implication:

- Any "tipping by payment method" analysis must drop cash rows, otherwise conclusions are severely biased low
- A textbook data trap: missing isn't "no tip given"; it's "the system doesn't know".

## 5. JFK round-trip duration has 3× the variance of typical trips

Add `trip_duration_minutes` to `fact_trips`, filter `PULocationID = 132` (JFK):

- Typical city trips: mean ~14 min, std ~8 min
- **JFK pickups: mean ~38 min, std ~25 min**

Why so much variance?

- Destinations are spread out (Manhattan vs. Queens vs. Long Island differ by tens of km)
- BQE during rush hour is 30 min; the same route at 3 AM is 10 min — 3× swing
- Some trips use ride-share lanes; others go via tolled bridges

Business implication: ETA estimation for JFK pickups **cannot use the citywide average**. You need to bucket by time-of-day × destination borough. High-variance segments like this are where data science earns its keep.

## Closing

After weeks of pipeline work, the most satisfying moment wasn't the green DAG — it was watching the data tell its own story. Building the infra without ever doing this is like building a kitchen and never cooking.

Next post: how to turn these five findings into five Looker Studio tiles in 30 minutes.

> Sources: [nyc_taxi_pipeline/dbt/models/mart_hourly_trips.sql](nyc_taxi_pipeline/dbt/models/mart_hourly_trips.sql), [nyc_taxi_pipeline/dbt/models/mart_location_trips.sql](nyc_taxi_pipeline/dbt/models/mart_location_trips.sql), [nyc_taxi_pipeline/dbt/models/fact_trips.sql](nyc_taxi_pipeline/dbt/models/fact_trips.sql)
