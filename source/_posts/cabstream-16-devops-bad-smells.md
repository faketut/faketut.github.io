---
title: "Three \"Looks Like DevOps, Is Actually a Time Bomb\" Smells"
date: 2026-05-15 21:00:00
tags:
  - cabstream
  - airflow
  - dbt
  - gcp
categories:
  - engineering
  - data
---

This post is inverted: each section is a pattern that **looks like DevOps but isn't**, with the concrete dodge this project uses.

## Smell 1: cleartext passwords in the README

A common tutorial:

```bash
airflow users create \
    --username admin \
    --password admin123 \
    ...
```

Readers copy → deploy → public 8080 → crypto miners by morning.

This project's README deliberately omits `--password`:

```bash
airflow users create \
    --username admin \
    --firstname Admin \
    --lastname User \
    --role Admin \
    --email admin@example.com
# Omit --password so Airflow prompts you interactively;
# never commit or paste credentials. Rotate immediately after first login.
```

Airflow prompts interactively — the password never lands in shell history, screenshots, or docs.

## Smell 2: `terraform apply` without a `plan`

A trendy but dangerous CI pattern: `terraform apply -auto-approve`. This project's README keeps them separate:

```bash
terraform plan  -var="project_id=$GCP_PROJECT_ID" -var="admin_cidr=$ADMIN_CIDR"
terraform apply -var="project_id=$GCP_PROJECT_ID" -var="admin_cidr=$ADMIN_CIDR"
```

Combined with `prevent_destroy` (see {% post_link cabstream-03-terraform-anti-delete %}), anything unexpected is blocked at plan time. Two layers of safety net beat one.

## Smell 3: "validation" means `terraform validate`

`terraform validate` only catches syntax. This project's CI runs three checks per stack:

```yaml
- run: terraform -chdir=nyc_taxi_pipeline/terraform fmt -check
- run: terraform -chdir=nyc_taxi_pipeline/terraform init -backend=false
- run: terraform -chdir=nyc_taxi_pipeline/terraform validate
```

`fmt -check` catches formatting drift, `init -backend=false` pulls providers, `validate` checks resource schema. Three steps, under 30 seconds, and most PR-level mistakes die there.

Python side:

```yaml
- run: ruff check nyc_taxi_pipeline/airflow
- run: pytest nyc_taxi_pipeline/airflow
```

dbt side:

```yaml
- run: dbt parse --no-version-check
```

Each layer gets the cheapest possible static check — far more realistic than a big e2e suite.

## Checklist

Before calling a new project "DevOps-done":

- [ ] No cleartext passwords or tokens in README/tutorials
- [ ] `terraform plan` and `apply` are separate steps
- [ ] CI runs fmt / validate / lint / unit tests, each under 30s

Three checks ticked and the dangerous defaults are gone. The rest is ordinary hygiene.

> Files: [.github/workflows/ci.yml](https://github.com/faketut/CabStream-ETL/blob/main/.github/workflows/ci.yml), [nyc_taxi_pipeline/terraform/variables.tf](https://github.com/faketut/CabStream-ETL/blob/main/nyc_taxi_pipeline/terraform/variables.tf)
