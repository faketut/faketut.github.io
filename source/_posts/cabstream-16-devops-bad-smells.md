---
title: "Six \"Looks Like DevOps, Is Actually a Time Bomb\" Smells"
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

## Smell 2: `0.0.0.0/0` left on a "temporary" rule

A lot of projects set `source_ranges = ["0.0.0.0/0"]` during debugging and forget to roll it back. An Airflow 8080 open to the internet is effectively a time bomb.

This project makes the CIDR a **required variable with no default**:

```hcl
variable "admin_cidr" {
  description = "CIDR allowed to reach the Airflow webserver on :8080 (e.g. 203.0.113.4/32)."
  type        = string
}
```

Every apply must pass `-var="admin_cidr=..."` explicitly. Removes "forgot to flip it back" at the language level.

## Smell 3: `terraform apply` without a `plan`

A trendy but dangerous CI pattern: `terraform apply -auto-approve`. This project's README keeps them separate:

```bash
terraform plan  -var="project_id=$GCP_PROJECT_ID" -var="admin_cidr=$ADMIN_CIDR"
terraform apply -var="project_id=$GCP_PROJECT_ID" -var="admin_cidr=$ADMIN_CIDR"
```

Combined with `prevent_destroy`, anything unexpected is blocked at plan time. Two layers of safety net beat one.

## Smell 4: shipping the SA key to the VM

A common workflow: generate `key.json` locally → `scp` to the VM → set `GOOGLE_APPLICATION_CREDENTIALS`.

Problems:
- A key sits on disk for the VM's lifetime; rotation is painful
- VM compromise → key leaks → whole project blast radius

This project uses VM-attached SA ([main.tf](nyc_taxi_pipeline/terraform/main.tf)):

```hcl
resource "google_compute_instance" "airflow_vm" {
  ...
  service_account {
    email  = google_service_account.airflow_sa.email
    scopes = ["cloud-platform"]
  }
}
```

The VM gets tokens via the metadata server. There is no key file to leak. Replacing the VM is the rotation.

## Smell 5: "validation" means `terraform validate`

`terraform validate` only catches syntax. This project's CI runs three checks per stack:

```yaml
- run: terraform -chdir=nyc_taxi_pipeline/terraform fmt -check
- run: terraform -chdir=nyc_taxi_pipeline/terraform init -backend=false
- run: terraform -chdir=nyc_taxi_pipeline/terraform validate
```

`fmt -check` catches formatting drift, `init -backend=false` pulls providers, `validate` checks resource schema. Three steps, under 30 seconds, and 80% of PR-level mistakes die there.

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

## Smell 6: `terraform.tfstate` committed to Git

Search GitHub and you'll find plenty of public repos with `terraform.tfstate` in them. tfstate contains resource IDs, public IPs, SA emails — a recon goldmine.

This project's `.gitignore` excludes them up front:

```
*.tfstate
*.tfstate.*
.terraform/
```

And mandates remote state:

```hcl
backend "gcs" { prefix = "tfstate/cabstream" }
```

## Checklist

Before calling a new project "DevOps-done":

- [ ] No cleartext passwords or tokens in README/tutorials
- [ ] Open-port CIDR is a required variable with no default
- [ ] `terraform plan` and `apply` are separate steps
- [ ] VMs use attached SAs, no key files
- [ ] CI runs fmt / validate / lint / unit tests, each under 30s
- [ ] tfstate lives in a remote backend; local versions are gitignored

Six checks ticked, and you're past 80% of projects that "look DevOps".

> Files: [.github/workflows/ci.yml](.github/workflows/ci.yml), [nyc_taxi_pipeline/terraform/variables.tf](nyc_taxi_pipeline/terraform/variables.tf)
