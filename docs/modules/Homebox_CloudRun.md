---
title: "Homebox on Google Cloud Run"
description: "Configuration reference for deploying Homebox on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Homebox on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homebox_CloudRun.png" alt="Homebox on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Homebox is an open-source, self-hosted home inventory and organization system
with a Go REST API backend (Echo-style, Ent ORM) and a Vue 3/Nuxt frontend
served embedded from the same binary — track items, attach photos, and
organize by location. This module deploys Homebox on **Cloud Run v2** on
top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Homebox uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Homebox runs as a single Go binary (API + embedded frontend) on Cloud Run v2.
The deployment wires together a small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go/Echo service, 1 vCPU / 512 MiB by default, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Homebox reads discrete `HBOX_DATABASE_*` env vars, not a constructed DSN |
| Object storage | Cloud Storage | A `data` bucket is created for item photos/attachments, but not auto-mounted |
| Cache & queue | none | Homebox has no Redis or queue dependency |
| Secrets | Secret Manager | Database password plus `HBOX_AUTH_API_KEY_PEPPER` (a real, app-consumed secret) |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the standardized engine.** `Homebox_Common` fixes
  `database_type = "POSTGRES_15"` and sets `HBOX_DATABASE_DRIVER=postgres`
  explicitly — Homebox defaults to embedded SQLite otherwise, whose default
  DSN forces `journal_mode=WAL`, which is unsafe over NFS/gcsfuse.
- **No custom container build.** Homebox's discrete Postgres env vars need no
  DSN construction, so the official prebuilt image
  (`ghcr.io/sysadminsmedia/homebox`) is used directly.
- **Open self-registration, not a default admin account.** Unlike some apps
  in this catalogue, Homebox does not ship a hardcoded credential: the first
  person to submit the "Register" form on a fresh instance becomes the
  initial admin user. There is no default-credential security risk, but
  operators should set `HBOX_OPTIONS_ALLOW_REGISTRATION=false` afterward to
  close public signups — see the [Common guide](Homebox_Common.md) for detail.
- **Item photos are not persisted by default.** A GCS bucket is created but
  not auto-mounted at Homebox's `/data` path — add a `gcs_volumes` entry if
  uploaded item photos and attachments need to survive a revision restart.
  Item *metadata* is unaffected (stored in PostgreSQL).
- **Request-based billing by default.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — Homebox is a plain request/response app with no
  background scheduler or queue worker.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Homebox service

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

Homebox stores all item, location, and user data in a managed Cloud SQL for
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

A `data` bucket is provisioned automatically for item photos and attachments,
but is **not** mounted into the container by default — see the Pitfalls table.

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~homebox"
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

## 3. Homebox Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh` using `postgres:15-alpine`, idempotently creating the
  application role and database.
- **Schema migrations on start.** Homebox's Ent ORM applies its own internal
  migrations automatically on every startup — no separate migration job runs
  at the platform layer.
- **Open self-registration — no default admin credential.** The first
  visitor to complete the "Register" form becomes the admin. There is no
  credential to retrieve, reset, or rotate — set
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` once the admin account exists to
  close public signups.
- **Health path.** Startup and liveness probes target `/api/v1/status` —
  Homebox's real, unauthenticated status endpoint, confirmed from the
  official Dockerfile's own `HEALTHCHECK` instruction.
- **Inspect job execution:**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Homebox are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `homebox` | Base name for resources. |
| `application_version` | `latest` | Homebox publishes a genuine `latest` tag — no remapping needed. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed — discrete Postgres env vars require no DSN construction. |
| `container_port` | `7745` | Homebox's native default port. |
| `cpu_always_allocated` | `false` | Request-based billing. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Scale-to-zero default. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `data` bucket | Created but not auto-mounted — add `gcs_volumes` to persist item photos. |
| `gcs_volumes` | `[]` | Add an entry mounted at `/data` for persistent item photo/attachment storage. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Aliases the platform `DB_HOST` onto Homebox's expected name. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Aliases `DB_PORT`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` 30s delay | Probes target Homebox's real status endpoint. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` | Cloud Run service name and default `run.app` URL. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `data` bucket for item photos and attachments. |
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
| First registration | Complete promptly after deploy | **Medium** | The first person to register on a fresh, publicly reachable instance becomes the admin — until you register and set `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, anyone who discovers the URL can claim the admin account. |
| `gcs_volumes` for item photos | Add explicitly before real use | **High** | Without it, uploaded item photos and attachments live on Cloud Run's ephemeral filesystem and do not survive a revision restart — this is a bigger deal for Homebox than for apps where images are optional, since photo attachments are core to a home-inventory workflow. Item metadata is unaffected. |
| `db_*_env_var_name` variables | Leave at their Homebox-specific defaults | Critical | Changing/clearing these breaks Homebox's Postgres connection entirely — it reads `HBOX_DATABASE_*`, not `DB_*`. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Homebox-specific application configuration
shared with the GKE variant is described in
**[Homebox_Common](Homebox_Common.md)**.
