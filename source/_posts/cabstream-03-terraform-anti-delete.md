---
title: "Three Layers of \"Don't Accidentally Delete My Data\" in Terraform"
date: 2026-05-12 15:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

A single `terraform destroy` can take a GCS bucket — and three years of parquet — with it. This project uses **three layered guards**, each blocking a different category of mistake.

## Layer 1: `prevent_destroy` blocks at plan time

```hcl
resource "google_storage_bucket" "data_lake_bucket" {
  # ...
  lifecycle {
    prevent_destroy = true
  }
}
```

Effect: any `terraform plan` that shows a destroy/replace on this bucket **fails immediately** — `apply` never even gets a chance.

When to use: resources that "should never be deleted" — data buckets, production datasets, KMS keys.

Cost: when you legitimately want to delete it, you must first comment the line out and re-apply. The extra ceremony is the point.

## Layer 2: `allow_destroy` variable blocks data loss

```hcl
resource "google_storage_bucket" "data_lake_bucket" {
  # ...
  force_destroy = var.allow_destroy
}

resource "google_bigquery_dataset" "nyc_taxi_dataset" {
  # ...
  delete_contents_on_destroy = var.allow_destroy
}
```

```hcl
variable "allow_destroy" {
  description = "When true, allows `terraform destroy` to wipe the bucket/dataset contents. Keep false in prod."
  type        = bool
  default     = false
}
```

With `force_destroy = false`, GCS refuses to delete a bucket that still has objects. The provider default is actually `true`, so you have to opt out explicitly.

The variable name `allow_destroy` is deliberately blunt — you cannot run `terraform apply -var="allow_destroy=true"` without knowing what you're doing.

## Layer 3: remote state blocks "lost laptop = rebuild everything"

```hcl
backend "gcs" {
  prefix = "tfstate/cabstream"
}
```

`bucket=` is intentionally not hardcoded; it gets injected at init time via `terraform init -backend-config="bucket=<your-tfstate-bucket>"`. Benefits:

- No state files in the repo
- Locking is automatic (GCS backend handles it)
- Even if a laptop is lost, rebuild only needs an SA key plus one `init` line

## The "I really want to delete" playbook

Because the guards stack, an actual teardown becomes refreshingly explicit:

```bash
# 1. Flip force_destroy / delete_contents_on_destroy on
terraform apply -var="allow_destroy=true" -var="project_id=..." -var="admin_cidr=..."

# 2. Comment out the prevent_destroy lines
# 3. terraform destroy
```

Three steps, two diffs, one apply. Skipping any of them gets you stuck — which is exactly how destructive operations on data infra should feel.

## Habits worth borrowing

- Separate "safe defaults" from "release valves"; name the valve to make people pause (`allow_destroy` > `enable_delete`).
- Only put `prevent_destroy` on resources that truly should never be deleted — otherwise it becomes noise.
- Prefer `lifecycle_rule` to transition to `NEARLINE` instead of deleting. Wrong delete = data gone; wrong transition = a small retrieval fee.

> See [nyc_taxi_pipeline/terraform/main.tf](nyc_taxi_pipeline/terraform/main.tf) and [nyc_taxi_pipeline/terraform/variables.tf](nyc_taxi_pipeline/terraform/variables.tf).
