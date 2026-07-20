---
title: "Mealie on Google Cloud Run"
description: "Configuration reference for deploying Mealie on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Mealie on Google Cloud Run

Mealie is an open-source, self-hosted recipe manager and meal planner with a
FastAPI backend and a Vue frontend, offering automatic recipe import by URL
alongside a manual UI editor. This module deploys Mealie on **Cloud Run v2** on
top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Mealie uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Mealie runs as a single FastAPI/Vue container on Cloud Run v2. The deployment
wires together a small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | FastAPI service, 1 vCPU / 512 MiB by default, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Mealie reads discrete `POSTGRES_*` env vars, not a constructed DSN |
| Object storage | Cloud Storage | A `data` bucket is created for recipe images, but not auto-mounted |
| Cache & queue | none | Mealie has no Redis or queue dependency |
| Secrets | Secret Manager | Database password only — Mealie has no env-configurable admin credential |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the standardized engine.** `Mealie_Common` fixes
  `database_type = "POSTGRES_15"` and sets `DB_ENGINE=postgres` explicitly —
  Mealie defaults to embedded SQLite otherwise.
- **No custom container build.** Mealie's discrete Postgres env vars need no
  DSN construction, so the official prebuilt image
  (`ghcr.io/mealie-recipes/mealie`) is used directly.
- **Default admin account, not first-registration — and it is NOT
  configurable.** Unlike some apps in this catalogue, Mealie does not let the
  first visitor self-register as admin, and unlike earlier Mealie versions
  its initial credential can no longer be set via environment variables (the
  underlying settings are private, non-env-bindable fields as of v3.x — see
  the [Common guide](Mealie_Common.md) for the source-level detail). Every
  deployment boots the **same well-known account**: `changeme@example.com` /
  `MyPassword`. Log in immediately after first deploy and change both the
  password and, ideally, the admin email — Mealie forces a password reset on
  first login, which is the real security boundary here, not secrecy of the
  initial credential.
- **Recipe images are not persisted by default.** A GCS bucket is created but
  not auto-mounted at Mealie's `/app/data` path — add a `gcs_volumes` entry if
  uploaded recipe images need to survive a revision restart. Recipe *text*
  data is unaffected (stored in PostgreSQL).
- **Request-based billing by default.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — Mealie's URL-import scraping runs synchronously
  within the triggering request, not as a background job.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Mealie service

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, and traffic
splitting.

### B. Cloud SQL for PostgreSQL 15

Mealie stores all recipes, meal plans, and user data in a managed Cloud SQL for
PostgreSQL 15 instance, connected privately via the **Cloud SQL Auth Proxy**
over a Unix socket. On first deploy, an initialization Job creates the
application database and user.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

A `data` bucket is provisioned automatically for recipe images, but is **not**
mounted into the container by default — see the Pitfalls table.

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mealie"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Mealie Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh` using `postgres:15-alpine`, idempotently creating the
  application role and database.
- **Schema migrations on start.** Mealie applies its own internal migrations
  automatically on every startup.
- **Fixed default admin credential — not configurable.** Mealie creates
  `changeme@example.com` / `MyPassword` on first database initialisation. This is
  a hardcoded upstream default (no env var overrides it as of v3.x), not a
  generated secret — a password reset is forced on first login, and operators
  must complete it immediately after deploy.
- **Health path.** Startup and liveness probes target `/api/app/about` —
  Mealie's real, unauthenticated info endpoint.
- **Inspect job execution:**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Mealie are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `mealie` | Base name for resources. |
| `application_version` | `latest` | Mealie publishes a genuine `latest` tag — no remapping needed. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed — discrete Postgres env vars require no DSN construction. |
| `container_port` | `9000` | Mealie's native default port. |
| `cpu_always_allocated` | `false` | Request-based billing. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Scale-to-zero default. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `data` bucket | Created but not auto-mounted — add `gcs_volumes` to persist recipe images. |
| `gcs_volumes` | `[]` | Add an entry mounted at `/app/data` for persistent recipe image storage. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Mealie_Common`. |
| `db_host_env_var_name` | `POSTGRES_SERVER` | Aliases the platform `DB_HOST` onto Mealie's expected name. |
| `db_user_env_var_name` | `POSTGRES_USER` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `POSTGRES_DB` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Aliases `DB_PORT`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/app/about` 30s delay | Probes target Mealie's real info endpoint. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` | Cloud Run service name and default `run.app` URL. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `data` bucket for recipe images. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` (default) | High | `"custom"` triggers an unnecessary Cloud Build with no Dockerfile in this module — the build fails. |
| Default admin credential (`changeme@example.com` / `MyPassword`) | Log in and change it immediately after first deploy | **Critical** | This is a fixed, publicly documented upstream default — not a generated secret — as soon as the DB initialises, anyone who knows Mealie's default credential can log in until you complete the forced first-login password reset. |
| `gcs_volumes` for recipe images | Add explicitly if needed | Medium | Without it, uploaded recipe images live on Cloud Run's ephemeral filesystem and do not survive a revision restart — recipe text is unaffected. |
| `db_*_env_var_name` variables | Leave at their Mealie-specific defaults | Critical | Changing/clearing these breaks Mealie's Postgres connection entirely — it reads `POSTGRES_*`, not `DB_*`. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Mealie-specific application configuration
shared with the GKE variant is described in
**[Mealie_Common](Mealie_Common.md)**.
