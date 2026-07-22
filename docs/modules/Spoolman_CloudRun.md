---
title: "Spoolman on Google Cloud Run"
description: "Configuration reference for deploying Spoolman on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Spoolman on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Spoolman_CloudRun.png" alt="Spoolman on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Spoolman is a free, open-source inventory and usage tracker for 3D-printing
filament spools — vendors, materials, remaining weight, cost per spool, and
per-print consumption. It ships as a single-process Python/FastAPI backend with
a bundled static Vue/Quasar frontend. This module deploys Spoolman on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Spoolman uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Spoolman runs as a single Python/FastAPI container on Cloud Run v2 — there is no
separate frontend service; the Vue/Quasar UI is bundled and served from the same
process. The deployment wires together a minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Prebuilt `ghcr.io/donkie/spoolman` image, 1 vCPU / 512Mi by default, serverless autoscaling; scale-to-zero by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — this module standardises on Postgres (Spoolman upstream also supports MySQL/SQLite/CockroachDB) |
| Object storage | None | Spoolman keeps all state in Postgres; no GCS bucket is provisioned |
| Cache | None | Spoolman has no Redis/cache integration |
| Secrets | Secret Manager | Only the auto-generated database password — Spoolman has no admin/API-key bootstrap secret of its own |
| Ingress | Cloud Run URL | Default `run.app` URL, public by default (`ingress_settings = "all"`) |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only supported engine in this module.** `database_type`
  is fixed by `Spoolman_Common`; Spoolman upstream also supports MySQL and
  CockroachDB via env vars, but this module does not expose that choice.
- **No custom build.** `container_image_source = "prebuilt"` deploys
  `ghcr.io/donkie/spoolman` directly — there is no Dockerfile, no Cloud Build
  step, and no `application_version` pinning risk from a `latest`-tag base image
  bug class.
- **No init job.** The Foundation auto-creates the Postgres role and database;
  Spoolman runs its own Alembic migrations automatically on every container
  start. There is nothing to wait for beyond the container becoming healthy.
- **No application secrets.** Spoolman ships with **no authentication at all** —
  whoever can reach the URL has full read/write access to the inventory. There
  is no login gate to bootstrap and nothing generated in Secret Manager beyond
  the database password. If that is not acceptable for your deployment, put the
  service behind IAP (`enable_iap = true`) or a Cloud Armor IP allowlist.
- **Scale-to-zero is the default** (`min_instance_count = 0`,
  `cpu_always_allocated` inherits the Foundation's request-based default).
  Spoolman does no background work — no scheduler, no queue, no WebSocket — so
  there is no reason to override either setting.
- **Connections use the Cloud SQL Unix socket, not TCP.** Spoolman's SQLAlchemy
  layer builds its connection via `URL.create()` (a structured object, not
  string concatenation), so the socket directory path — which contains colons
  in the Cloud SQL instance connection name — passes through cleanly with no
  URL-parsing issue. No TLS/`sslmode` configuration is needed.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Spoolman service

Spoolman runs as a single Cloud Run v2 service. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Spoolman stores all inventory data (spools, filaments, vendors, usage history)
in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP
is exposed. There is no initialization job — Spoolman applies its own schema
migrations on every boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Secret Manager

Only the auto-generated database password lives in Secret Manager — Spoolman
has no admin account or API key of its own to bootstrap.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
  gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
  ```

### D. Networking & ingress

The service is reachable at its `run.app` URL by default
(`ingress_settings = "all"`). An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Spoolman Application Behaviour

- **No first-deploy database setup job.** Unlike most application modules in
  this catalogue, Spoolman needs no `db-init` job — the Foundation creates the
  Postgres role and database, and Spoolman's own Alembic migrations run
  automatically on every container start (including the very first boot).
- **No authentication.** There is no login page, no admin account, and no API
  key gate. Anyone who can reach the service URL can view and modify the entire
  inventory. Decide your access-control approach (IAP, Cloud Armor allowlist, or
  accept public read/write) before sharing the URL.
- **Health path.** `/api/health` is public and unauthenticated, returning a
  200/OK JSON status once the server (and its DB connection) is up. Both the
  startup and liveness probes target this path.
- **Database engine locked to Postgres.** Spoolman's own `SPOOLMAN_DB_TYPE`
  environment variable selects the engine; this module always sets it to
  `postgres`. Never unset it via `environment_variables` — without it, Spoolman
  silently falls back to a throwaway container-local SQLite file with no error
  at all (a documented failure class in this catalogue — see the Configuration
  Guide's Pitfalls table).
- **Inspect Cloud SQL connectivity:**
  ```bash
  gcloud run revisions describe <revision-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.containers[0].env)' | tr ';' '\n' | grep -i spoolman_db
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Spoolman are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `spoolman` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Spoolman` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Image tag pulled from `ghcr.io/donkie/spoolman`. Genuinely prebuilt — no Dockerfile/build-arg pinning concerns. |
| `application_database_name` / `application_database_user` | `spoolman` / `spoolman` | Immutable after first deploy. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Forwarded to the Foundation — required, or the default `"custom"` silently triggers a Kaniko/Cloud Build attempt with no Dockerfile. |
| `container_port` | `8000` | Spoolman's default listen port. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Ample for a single-tenant filament tracker; raise for a large multi-user inventory. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Scale-to-zero is safe — Spoolman has no background work. |
| `enable_cloudsql_volume` | `true` | Mounts the Cloud SQL Auth Proxy Unix socket. Required for the DSN construction described in §1. |

### Group 12 — Database

| Variable | Default | Description |
|---|---|---|
| `db_host_env_var_name` | `SPOOLMAN_DB_HOST` | Aliases the Foundation's `DB_HOST` (the Cloud SQL socket directory on Cloud Run). |
| `db_user_env_var_name` | `SPOOLMAN_DB_USERNAME` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `SPOOLMAN_DB_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `SPOOLMAN_DB_NAME` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `SPOOLMAN_DB_PORT` | Aliases `DB_PORT`. |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | No GCS bucket needed — all state lives in Cloud SQL. |
| `enable_nfs` | `false` | No shared filesystem needed. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, 10s delay | Public, unauthenticated. |
| `liveness_probe` | HTTP `/api/health`, 30s period | Public, unauthenticated. |

All other inputs (CI/CD, backups, VPC-SC, Cloud Armor, IAP, Redis) are inherited
from [App_CloudRun](App_CloudRun.md) with standard behaviour — Spoolman uses
none of them by default.

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Always empty — Spoolman needs no GCS bucket. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo (when mirroring is enabled). |
| `monitoring_enabled` / `uptime_check_names` | Monitoring status and uptime checks. |
| `initialization_jobs` | Always empty — Spoolman needs no init job. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| No authentication (built-in) | Front with IAP or Cloud Armor if needed | Critical | Anyone with the URL can read and modify the entire filament inventory — there is no login gate to disable. |
| `SPOOLMAN_DB_TYPE` (auto-injected `postgres`) | Never unset via `environment_variables` | Critical | Unsetting it silently falls back to a throwaway container-local SQLite file — no error, and all data is lost on every restart. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` (do not override to `custom`) | Critical | Setting `"custom"` triggers a Kaniko/Cloud Build attempt against a module with no Dockerfile — the build fails outright. |
| `enable_cloudsql_volume` | `true` | High | Disabling it removes the Unix socket Spoolman's `SPOOLMAN_DB_HOST` depends on for the documented no-TLS connection path. |
| `SPOOLMAN_DB_QUERY` | Leave empty unless troubleshooting | Medium | This is an escape hatch for a TCP + `sslmode` fallback — only needed if the socket-based connection path is ever found to be unreliable on a live deployment; not required for normal operation. |
| `ingress_settings` | `all` (default) | Medium | Restricting to `internal` makes the service unreachable from a browser unless fronted by a load balancer. |
| `min_instance_count` | `0` (default) | Low | Spoolman has no background work, so scale-to-zero is safe; raise only to avoid cold-start latency for interactive use. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Spoolman-specific application configuration
shared with the GKE variant is described in
**[Spoolman_Common](Spoolman_Common.md)**.
