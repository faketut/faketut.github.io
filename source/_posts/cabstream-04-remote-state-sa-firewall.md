---
title: "Remote State, Least-Privilege SA, IP-Restricted UI: Writing IaC That Could Pass an Audit"
date: 2026-05-12 21:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

Most people write Terraform for themselves first — state on the laptop, SA with Owner, firewall on `0.0.0.0/0`. The pain shows up the day someone else has to take over, or the security team runs a scan.

This project starts from "assume it will be audited", in ~140 lines. Three details are worth lifting.

## 1. Remote state without a hardcoded bucket

```hcl
backend "gcs" {
  prefix = "tfstate/cabstream"
}
```

`bucket` is deliberately missing. It is injected at init:

```bash
terraform init -backend-config="bucket=$TFSTATE_BUCKET"
```

Why:

- **Same code can target dev and prod state** with no source change
- A public repo doesn't leak the state bucket name
- Onboarding a new engineer needs one env var, not a story

## 2. A least-privilege service account

```hcl
resource "google_service_account" "airflow_sa" {
  account_id   = "cabstream-airflow"
  display_name = "CabStream Airflow runner"
}

resource "google_project_iam_member" "airflow_bq_data" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.airflow_sa.email}"
}

resource "google_project_iam_member" "airflow_bq_jobs" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.airflow_sa.email}"
}

resource "google_storage_bucket_iam_member" "airflow_gcs" {
  bucket = google_storage_bucket.data_lake_bucket.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.airflow_sa.email}"
}
```

Key choices:

- **`bigquery.dataEditor` + `bigquery.jobUser` instead of `bigquery.admin`**: can read/write tables and run jobs, cannot delete the dataset or change IAM.
- **GCS permission is bucket-scoped, not project-scoped.** A new bucket added to the project is invisible to this SA by default.
- **The VM attaches the SA directly** — no key files. Key files are the single highest-probability leak vector.

```hcl
service_account {
  email  = google_service_account.airflow_sa.email
  scopes = ["cloud-platform"]
}
```

## 3. Firewall: UI only reachable from your own IP

```hcl
resource "google_compute_firewall" "airflow_ui" {
  name          = "allow-airflow-ui"
  network       = "default"
  source_ranges = [var.admin_cidr]
  target_tags   = ["airflow"]

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }
}
```

`admin_cidr` is a **required variable** (no default in [variables.tf](nyc_taxi_pipeline/terraform/variables.tf)). Every apply must pass it explicitly:

```bash
terraform apply -var="admin_cidr=203.0.113.4/32"
```

Why required? Because anything with a default eventually gets quietly changed to `0.0.0.0/0`. Removing the dangerous default at the language level beats relying on code review.

## Anti-pattern cheat sheet

| Anti-pattern | What this project does |
|---|---|
| Local state file | GCS backend with injected bucket |
| SA with `Owner` / `Editor` | dataEditor + jobUser + bucket-level objectAdmin |
| Ship SA key to the VM | VM attaches SA, no key |
| `source_ranges = ["0.0.0.0/0"]` | Required `admin_cidr` variable |
| `force_destroy = true` | Defaults to false, gated behind `allow_destroy` |

Short file, but every line maps to a real incident someone has lived through.

> File: [nyc_taxi_pipeline/terraform/main.tf](nyc_taxi_pipeline/terraform/main.tf)
