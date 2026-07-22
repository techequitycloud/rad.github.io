---
title: "Jellystat on Google Cloud Run"
description: "Configuration reference for deploying Jellystat on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Jellystat on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellystat_CloudRun.png" alt="Jellystat on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Jellystat](https://github.com/CyferShepard/Jellystat) is an open-source
statistics and analytics dashboard for [Jellyfin](https://jellyfin.org/) media
servers, tracking playback history, active sessions, user activity, library
growth, and viewing trends. This module deploys Jellystat on **Cloud Run v2**
on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Jellystat uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Jellystat runs as a single Node.js/Express container (with a bundled React
frontend) on Cloud Run v2. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 512 MiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — non-standard `POSTGRES_*` env var names |
| Object storage | Cloud Storage | A small optional `backups` bucket for database export archives |
| Secrets | Secret Manager | Auto-generated `JWT_SECRET`; database password |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer.
- **Non-standard database env var names.** Jellystat reads `POSTGRES_IP`,
  `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and
  `POSTGRES_DATABASE` — **not** `POSTGRES_DB** (community-confirmed that name
  does not work), and not the platform's generic `DB_*` names. Both sets are
  injected side by side via `main.tf`'s `db_*_env_var_name` aliasing.
- **`container_port = 3000` is fixed.** Jellystat's server hardcodes this
  port; it is not configurable via environment variable (see upstream issue
  #314). The variable exists for Foundation convention parity only.
- **`JWT_SECRET` is generated automatically** and stored in Secret Manager.
  It signs Jellystat's session/auth tokens.
- **No Redis support.** Jellystat has no native Redis integration;
  `enable_redis` and related variables are inert.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Cold
  starts add a few seconds of latency to the first request after idle.
- **No environment variable pairs Jellystat with a Jellyfin server.** This is
  the single most important operational fact about this module: Jellystat's
  Jellyfin connection (server URL + API key) is entered entirely through its
  own web UI after first boot, and has no Terraform-automatable equivalent.
  See §3 below.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Jellystat service

Jellystat runs as a Cloud Run v2 service that autoscales by request load
between the minimum and maximum instance counts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Jellystat stores all playback/analytics data in a managed Cloud SQL for
PostgreSQL 15 instance. The service connects privately through the **Cloud SQL
Auth Proxy** over a Unix socket. On first deploy an initialization Job creates
the application database and user. Jellystat then applies its own schema
migrations automatically on startup.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage

An optional, small **Cloud Storage** bucket (`backups`) is provisioned for
Jellystat's own database export/backup archive feature.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret
Manager: `JWT_SECRET` (used to sign Jellystat session/auth tokens). The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Jellystat Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application role and database. The job is safe to
  re-run.
- **Database migrations on start.** Jellystat applies its own schema
  migrations automatically on every startup — no separate migrate job exists
  in this module.
- **`JWT_SECRET` is generated once and stored in Secret Manager.** Rotating it
  invalidates all active user sessions (users must log back in) but causes no
  data loss.
- **Health path.** Startup, liveness, and uptime probes target
  `GET /auth/isConfigured` — a public, unauthenticated endpoint that returns
  200 as soon as the server is up.
- **Manual Jellyfin pairing is required after first boot — this cannot be
  automated by Terraform.** Jellystat has no environment variable for the
  companion Jellyfin server's URL or API key; the pairing is entirely
  UI-driven:
  1. Open the deployed Jellystat URL and create the first admin account.
  2. In your Jellyfin server's own Dashboard → API Keys, generate a new API
     key for Jellystat.
  3. In Jellystat's settings, enter your Jellyfin server's URL and paste in
     that API key.
  If you don't already have a Jellyfin server deployed, deploy one first with
  the sibling **Jellyfin_CloudRun** module (or **Jellyfin_GKE**) — see its own
  configuration guide.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Jellystat are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `jellystat` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Jellystat` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Container image version tag — passed through to the `cyfershepard/jellystat` image tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys the official `cyfershepard/jellystat` image directly. Do not set `custom` — there is no Dockerfile for this app. |
| `container_image` | `""` | Leave blank to use the default image. |
| `container_port` | `3000` | Fixed — matches Jellystat's hardcoded internal port. Changing this variable has no effect on the app. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Container resources. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Scale-to-zero by default. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off — Jellystat has no shared-file storage need. |
| `create_cloud_storage` | `true` | Creates the small `backups` bucket. |
| `gcs_volumes` | `[]` | Not used by default. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed. |
| `application_database_name` | `jellystat_db` | Injected as both `DB_NAME` and `POSTGRES_DATABASE`. Immutable after first deploy. |
| `application_database_user` | `jellystat_user` | Injected as both `DB_USER` and `POSTGRES_USER`. |
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/auth/isConfigured` | Public, unauthenticated health endpoint. |
| `uptime_check_config` | `{ enabled = false, path = "/auth/isConfigured" }` | Enable explicitly to activate. |

### Group 21 — Redis (not consumed)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | off / empty | **Not consumed.** Jellystat has no native Redis integration. |

All other inputs are inherited from [App_CloudRun.md](App_CloudRun.md) with
standard behaviour.

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (`backups`). |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `uptime_check_names` | Monitoring status and uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `JWT_SECRET` (auto-generated) | Only rotate deliberately | Medium | Rotating it invalidates all active sessions — users must log back in — but causes no data loss. |
| `container_image_source` | `prebuilt` | Critical | Setting `custom` fails the Cloud Build step — there is no Dockerfile for Jellystat in this catalogue. |
| `container_port` | `3000` (informational) | Low | Jellystat's server hardcodes port 3000 regardless of this variable's value. |
| Jellyfin URL/API key pairing | Manual, post-deploy | High | There is no environment variable for this — skipping the manual UI step leaves Jellystat showing no data even though the deployment is healthy. |
| `enable_redis` | leave `false` | Low | Jellystat has no Redis integration; setting `true` has no effect. |
| `startup_probe`/`liveness_probe` path | `/auth/isConfigured` | High | Pointing probes at an authenticated endpoint causes 401/403 and the revision never becomes Ready. |
| `min_instance_count` | `0` (default) is fine | Low | Jellystat is a request/response dashboard with no background scheduler — no need for always-on CPU. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Jellystat-specific application
configuration shared with the GKE variant is described in
**[Jellystat_Common](Jellystat_Common.md)**.
