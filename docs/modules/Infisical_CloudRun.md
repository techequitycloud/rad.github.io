---
title: "Infisical on Google Cloud Run"
description: "Configuration reference for deploying Infisical on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Infisical on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Infisical_CloudRun.png" alt="Infisical on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Infisical is an open-source, end-to-end encrypted secrets management platform:
teams and CI/CD pipelines store, inject, and rotate application secrets from a
single platform, using client SDKs, a CLI, or the web UI. This module deploys
Infisical on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Infisical uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Infisical runs as a Node.js container (a custom-built image wrapping the official
`infisical/infisical` image) on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Custom-built Node.js service, 1 vCPU / 2Gi by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Infisical does not support MySQL or other engines |
| Cache & rate-limiting | Redis (optional, on by default) | NFS-hosted Redis by default, or an authenticated external Redis via `redis_auth` |
| Secrets | Secret Manager | Auto-generated `ENCRYPTION_KEY`, `AUTH_SECRET`, `ADMIN_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` defaults to `POSTGRES_15` and is
  the only value Infisical supports.
- **The container image is custom-built, not the upstream image.** `Infisical_Common`
  builds `FROM infisical/infisical:${INFISICAL_VERSION}` with a wrapper `entrypoint.sh`
  that assembles the database connection string at container start (the runtime
  `DB_PASSWORD` Secret Manager value can't be URL-encoded at Terraform plan time).
  `application_version = "latest"` maps to a pinned known-good release
  (`v0.162.10`) as the build arg, per this catalog's convention against building
  `latest`-tag base images.
- **Redis defaults on, and its wiring is mutually exclusive by construction.** When
  `redis_auth` is empty (the default), the Foundation's own NFS-hosted Redis
  plain-env injection supplies `REDIS_HOST`/`REDIS_PORT`. When `redis_auth` is set,
  `Infisical_Common` instead creates and injects its own `REDIS_URL` secret. Only
  one path is ever active.
- **The startup probe is TCP, not HTTP.** Infisical does expose an unauthenticated
  `/api/status` endpoint that returns 200 with JSON when healthy — but only once the
  app reports *full* readiness (database + Redis + dependencies). An HTTP startup
  probe against that path would never pass, so the module defaults to a TCP probe
  (succeeds as soon as the port is bound) and **disables the liveness probe
  entirely** to avoid restart-looping a container that is still coming up.
- **No object storage is mounted.** A generic `data` GCS bucket is provisioned via
  the Foundation's `storage_buckets` variable, but `gcs_volumes` is empty by
  default — Infisical keeps all persistent state in PostgreSQL and needs no
  bucket mount.
- **The admin account is bootstrapped headlessly, not via the web UI.** An
  `admin-bootstrap` init job runs the `infisical` CLI's `bootstrap` command against
  the running server, avoiding the "open until the first visitor claims it"
  signup window. On Cloud Run this job does **not** run automatically on apply —
  see [§3](#3-infisical-application-behaviour).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Infisical service

Infisical runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Infisical stores all application data (secrets, projects, organizations, users,
audit logs) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
through the **Cloud SQL Auth Proxy** over a Unix socket (`enable_cloudsql_volume =
true` by default); no public IP is exposed. On first deploy, the `db-init`
initialization job creates the application database and role.

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

### C. Redis (cache & rate-limiting)

Redis is **enabled by default** (`enable_redis = true`). When `redis_host` is left
empty, the NFS server VM's IP is used as the default Redis host. When `redis_auth`
is set, `Infisical_Common` provisions its own `REDIS_URL` Secret Manager secret
instead of relying on the Foundation's plain-env injection.

- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm which Redis path is active in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager

Three cryptographic secrets are generated automatically and stored in Secret
Manager: `ENCRYPTION_KEY` (encrypts every secret Infisical stores),
`AUTH_SECRET` (signs JWT session tokens), and `ADMIN_PASSWORD` (consumed only
by the `admin-bootstrap` job, never injected into the running server). A
`REDIS_URL` secret is created conditionally. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~infisical"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Infisical Application Behaviour

- **First-deploy database setup.** The `db-init` initialization job runs
  `postgres:15-alpine`, connects through the Cloud SQL Auth Proxy socket, and
  idempotently creates the application role and database (matching the `DB_USER`/
  `DB_NAME` the Foundation injects). `execute_on_apply = true`, so this runs on
  every apply and is safe to re-run.
- **The database connection string is assembled at container start, not baked in
  at plan time.** Infisical accepts a single `DB_CONNECTION_URI`, but the runtime
  `DB_PASSWORD` (a Secret Manager value) isn't known when Terraform renders the
  image — `entrypoint.sh` URL-encodes it and builds the URI from the discrete
  `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` values, branching
  `sslmode` on `DB_HOST`'s shape (Unix socket path → `disable`; loopback →
  `disable`; raw private IP → `require`).
- **The admin account is bootstrapped headlessly — but not automatically on Cloud
  Run.** The `admin-bootstrap` init job (image `infisical/cli:latest`, depends on
  `db-init`) runs `infisical bootstrap --ignore-if-bootstrapped` against the
  running server's HTTP API to create the first super-admin, organization, and
  instance-admin machine identity. Because Cloud Run init jobs run strictly
  *before* the Service exists, this job can't reach a live server at apply time —
  `execute_on_apply = false`. **Trigger it manually** after confirming the service
  is healthy:
  ```bash
  curl -s "$SERVICE_URL/api/status"   # expect HTTP 200 with a JSON body
  gcloud run jobs execute <service>-admin-bootstrap --region "$REGION" --project "$PROJECT" --wait
  ```
  The job retries up to 20 times (15s apart) and is idempotent
  (`--ignore-if-bootstrapped`), so re-running it after a redeploy is harmless.
- **The admin password lives only in Secret Manager.** Retrieve the bootstrapped
  credential with:
  ```bash
  gcloud secrets versions access latest --secret=<prefix>-infisical-admin-password --project "$PROJECT"
  ```
  It is never injected into the running server container — only into the
  `admin-bootstrap` job.
- **Health endpoint.** `/api/status` returns HTTP 200 with a JSON body once
  Infisical, its database connection, and (if enabled) Redis are all healthy —
  but the platform's startup/liveness probes deliberately do **not** poll it
  directly (see [§1](#1-overview)); use it for your own manual health checks and
  external uptime monitoring instead.
- **Redis is optional but on by default.** Set `enable_redis = false` only if you
  are certain no caching/rate-limiting backend is desired; Infisical falls back to
  in-memory behaviour without Redis but loses cross-instance consistency once
  `max_instance_count > 1`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Infisical are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `infisical` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Infisical` | Human-readable name shown in the Console. |
| `description` | `Infisical - Open Source Secrets Management` | Service description. |
| `application_version` | `latest` | Image version tag. `"latest"` maps to a pinned build arg (`v0.162.10`) — Infisical's own docs recommend never running bare `latest` in production. |
| `site_url` | `""` | Public URL for `SITE_URL` (invite/email links, CORS) and the `admin-bootstrap` CLI target. Defaults to this service's own computed `run.app` URL when empty. |
| `admin_email` | `admin@techequity.cloud` | Email for the bootstrapped first super-admin account. |
| `admin_organization` | `Default Organization` | Organization name created for the bootstrapped account. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds `Infisical_Common`'s Dockerfile; `prebuilt` deploys `container_image` directly. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `container_port` | `8080` | Port Infisical listens on. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix socket sidecar — the entrypoint's `sslmode` branching relies on the socket path shape. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `3` | Safe above 1 — migrations use a distributed Postgres advisory lock and auth is JWT-based (no sticky in-memory session state). |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access; Infisical is typically reached by both browsers and CLI/SDK clients. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Infisical. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | various | **Declared but not forwarded to `Infisical_Common` — inert, no effect on the deployment.** |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core Infisical vars (`HOST`, `SITE_URL`, `DB_CONNECTION_URI`) are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

Standard `App_CloudRun` backup/restore inputs — see [App_CloudRun](App_CloudRun.md).
Key inputs: `backup_schedule`, `backup_retention_days`, `enable_backup_import`.

### Group 8 — CI/CD & Binary Authorization

Standard `App_CloudRun` Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md).

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

Standard `App_CloudRun` Cloud Armor / CDN / Artifact Registry retention inputs —
see [App_CloudRun](App_CloudRun.md).

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Foundation-level default bucket — **provisioned but never mounted**; Infisical needs no object storage. |
| `enable_nfs` | (Foundation default) | Only relevant here as the default source of the Redis host IP when `redis_host` is empty. |
| `gcs_volumes` | `[]` | GCS buckets mounted via GCS Fuse. Empty by default and unused by Infisical. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Infisical requires PostgreSQL. |
| `db_name` | `infisical` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | `infisical` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use `Infisical_Common`'s default `db-init` + `admin-bootstrap` jobs. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, `container_port` | Forwarded to `Infisical_Common`. TCP, not HTTP `/api/status` — see [§1](#1-overview). |
| `liveness_probe` | **disabled** | Forwarded to `Infisical_Common`. Disabled for the same reason as the startup probe. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check — consider pointing `path` at `/api/status` for a meaningful external health signal. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enable Redis for caching and rate-limiting. |
| `redis_host` | `""` | Leave blank to default to the NFS server IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` (sensitive) | When set, switches Infisical to `Infisical_Common`'s own `REDIS_URL` secret instead of the Foundation's plain-env injection. |
| `cubejs_api_url` / `hub_api_url` | localhost URLs | **Declared but not forwarded to `Infisical_Common` — inert, no effect.** |

### Group 22 — VPC Service Controls & Audit Logging

Standard inputs — see [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

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
| `storage_buckets` | Created Cloud Storage buckets (the unused `data` bucket). |
| `network_name` | VPC network name. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `uptime_check_names` | Monitoring status and uptime checks. |
| `initialization_jobs` | Names of the `db-init` and `admin-bootstrap` jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `artifact_registry_repository` | CI/CD status and registry. |
| `vpc_sc_enabled` / `audit_logging_enabled` | Security posture. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values and combinations at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes every previously stored secret permanently undecryptable. |
| `AUTH_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_redis` | Forward `var.enable_redis` unconditionally to `App_CloudRun` | Critical | Hardcoding it to `false` at the Foundation call leaves `REDIS_URL` completely unset in the common no-auth case — Infisical crashes at boot with "Either REDIS_URL, REDIS_SENTINEL_HOSTS or REDIS_CLUSTER_HOSTS must be defined". |
| `database_type` | `POSTGRES_15` | Critical | Any non-Postgres value is rejected by validation, or (if it were somehow set) Infisical would fail to connect entirely — MySQL is not supported. |
| `startup_probe` / `liveness_probe` | Keep the module defaults (TCP startup, disabled liveness) | High | Pointing either at HTTP `/api/status` makes the Cloud Run revision never become Ready — that endpoint only returns 2xx after full readiness (DB + Redis + deps), and Cloud Run won't route traffic to a service still waiting on its own startup probe. |
| `admin-bootstrap` job | Trigger manually after first healthy deploy | High | Without triggering it, no admin account exists and the instance is unusable from the UI/API until the job is run. |
| `site_url` | Leave empty for the auto-computed `run.app` URL, or set explicitly for a custom domain | Medium | An incorrect value breaks invite/email links, CORS, and the `admin-bootstrap` job's target. |
| `smtp_host` / `smtp_user` / `smtp_password` / `mail_from` / `cubejs_api_url` / `hub_api_url` | N/A | Low | These variables are declared for convention-mirroring parity but are never forwarded to `Infisical_Common` — setting them has no effect. |
| `memory_limit` | `2Gi` (default) or higher | Medium | Lower values risk OOM under concurrent secret-fetch load. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Infisical-specific application configuration
shared with the GKE variant is described in
**[Infisical_Common](Infisical_Common.md)**.
