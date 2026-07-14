---
title: "Logto on Google Cloud Run"
description: "Configuration reference for deploying Logto on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Logto on Google Cloud Run

Logto is an open-source, MPL-2.0-licensed identity provider — an Auth0 alternative
that speaks OIDC and OAuth 2.0 and ships with sign-in flows, social/enterprise
connectors, multi-tenancy, and an admin console. This module deploys Logto on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Logto uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Logto runs as a Node.js container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default; serverless autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Logto does not support MySQL or other engines |
| Object storage | Cloud Storage | One bucket provisioned automatically; optional for Logto (all core state is in Postgres) |
| Secrets | Secret Manager | Only the database password — Logto has **no** external application secret (OIDC keys are DB-seeded) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; a plan-time guard rejects any non-PostgreSQL `database_type`.
- **Logto core is published on port 3001; the admin console (3002) is not.** Cloud Run
  publishes a single port, so only the core API / OIDC endpoint (3001) is reachable.
  The admin console — where the first admin account and applications are registered —
  runs on 3002 and is **not** exposed through the `run.app` URL. Plan a separate path
  to 3002 for first-run setup (see §3).
- **There is no application secret to protect.** Logto generates its OIDC signing keys
  on first boot and stores them **in the database**. Nothing in Secret Manager needs to
  be guarded or rotated except the foundation-managed DB password. Protecting Logto's
  keys means protecting Cloud SQL.
- **`min_instance_count = 1` by default.** Logto is an identity provider on the request
  path of every login, so one instance is kept warm to avoid cold-start latency on
  OIDC requests. All state is in Postgres, so `0` (scale-to-zero) is data-safe if you
  prefer to trade cold starts for cost.
- **`cpu_always_allocated = false` (request-based billing).** Logto core is a
  request/response OIDC provider with no in-process background worker that must run
  without an inbound request, so CPU is billed only while serving.
- **The connection bypasses the Cloud SQL socket.** `enable_cloudsql_volume = true`
  still injects the Auth Proxy sidecar, but Logto's `slonik` driver cannot parse the
  Unix-socket DSN form — the entrypoint connects over the injected **private IP**
  (`DB_IP`) with `sslmode=no-verify` instead (encrypted; CA verification is skipped for
  the DB hop only).
- **No Redis.** Logto is Postgres-backed; `enable_redis` defaults to `false`.
- **`ENDPOINT` is derived from the service URL.** The entrypoint sets Logto's OIDC
  issuer and absolute URLs from the injected `CLOUDRUN_SERVICE_URL`; override `ENDPOINT`
  via `environment_variables` for a custom domain.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Logto service

Logto runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts. The published container port
is **3001** (Logto core / OIDC).

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected DB_HOST / DB_IP / ENDPOINT on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Logto stores everything — users, applications, connectors, OIDC signing keys, and
per-tenant roles — in a managed Cloud SQL for PostgreSQL 15 instance. On Cloud Run the
Auth Proxy sidecar is injected, but the app connects over the instance **private IP**
(`DB_IP`) with `sslmode=no-verify` because Logto's driver cannot use the socket DSN
form. On first deploy an initialization Job creates the application database and role
(with `CREATEROLE`, required for Logto's per-tenant RLS roles).

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database (`logto`), user (`logto`), and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage

One **Cloud Storage** bucket is provisioned automatically. Logto keeps all core state
in PostgreSQL, so this bucket is available for optional assets rather than required
runtime storage.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

Logto has **no external application secret** — its OIDC signing keys are generated and
stored in the database on first boot. The only secret in play is the **database
password**, which the foundation generates and manages.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~logto"
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. Logto's OIDC issuer and all
absolute redirect URLs are built from `ENDPOINT`, which the entrypoint derives from the
service URL — so the browser-facing host, the issuer, and registered redirect URIs must
all agree. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud
Armor can be layered on; set `ENDPOINT` to the custom domain when you do.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The entrypoint prints a
`[cloud-entrypoint]` line reporting the resolved DB connection mode and `ENDPOINT` —
useful when diagnosing connection or issuer-URL problems.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Logto Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role **with
  `CREATEDB CREATEROLE`** (required for Logto's per-tenant RLS roles) and the
  application database, then grants privileges and transfers `public` schema ownership
  to the app role. The job is safe to re-run.
- **Schema and OIDC keys seeded on boot.** On start Logto runs
  `npm run cli db seed -- --swe` (`--swe` = seed-when-empty, idempotent) which creates
  its schema and generates the OIDC private signing keys **into the database** — only
  when the database is empty. These keys are not stored in Secret Manager; the database
  is their sole custodian. Wiping the database regenerates new keys and invalidates all
  previously issued tokens and registered clients.
- **No application secret to rotate.** There is no encryption key or JWT secret in
  Secret Manager — only the foundation-managed DB password.
- **Admin console (3002) is not published.** Cloud Run exposes only the core (3001).
  The admin console — where you create the first administrator and register
  applications — runs on 3002 and is not reachable through the `run.app` URL. Complete
  first-run setup by fronting Logto with a proxy that routes to 3002, or by temporarily
  exposing 3002 through a dedicated deployment. `ADMIN_ENDPOINT` defaults to the same
  host as `ENDPOINT` for URL consistency.
- **`ENDPOINT` must match the browser-facing host.** Logto builds its OIDC issuer and
  redirect URLs from `ENDPOINT`; the entrypoint sets it from `CLOUDRUN_SERVICE_URL`.
  For a custom domain, set `ENDPOINT` in `environment_variables` before deploying.
- **Health path.** Startup, liveness, and readiness probes target `/api/status` — an
  unauthenticated endpoint that returns `200` once the core is up. The startup probe
  allows a wide first-boot window (60s initial delay + 30 retries) for the seed step.
  Verify it manually:
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/api/status"
  ```
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Logto are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `logto` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Logto` | Human-readable name shown in the Console. |
| `description` | `Logto - open-source Auth0-alternative identity provider (OIDC)` | Service description. |
| `application_version` | `latest` | Logto image tag (`svhd/logto:<tag>`); pin to a specific release (e.g. `1.33`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Logto is built as a thin wrapper `FROM svhd/logto` — keep `custom`. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance; Logto needs at least 2 GiB for reliable operation. |
| `cpu_always_allocated` | `false` | Request-based billing (CPU billed only while serving). Logto has no background worker to keep alive. |
| `min_instance_count` | `1` | Keep 1 warm so OIDC/login requests never hit a cold start; `0` is data-safe (all state in Postgres). |
| `max_instance_count` | `5` | Cost ceiling; must be ≥ `min_instance_count`. |
| `container_port` | `3001` | Logto core listens on 3001; the admin console (3002) is not published. |
| `execution_environment` | `gen2` | Gen2 recommended. |
| `timeout_seconds` | `300` | Maximum request duration. |
| `enable_cloudsql_volume` | `true` | Injects the Auth Proxy sidecar; Logto still connects via `DB_IP` (socket DSN unsupported by slonik). |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress so external OIDC clients and browsers can reach Logto. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks unauthenticated OIDC/login traffic** — leave off for a public IdP. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Set `ENDPOINT` here for a custom domain. Do not set `PORT` (Cloud Run reserves it) or `DB_URL` (composed by the entrypoint). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Logto needs none by default. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated database backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9–11 — Load Balancer / Storage / Custom SQL

`enable_cloud_armor`, `application_domains`, `enable_cdn`, and the Artifact Registry
retention settings (Group 9); `create_cloud_storage`, `storage_buckets`, `enable_nfs`,
`gcs_volumes` (Group 10); and `enable_custom_sql_scripts` and friends (Group 11) all
follow standard [App_CloudRun](App_CloudRun.md) behaviour. NFS is off by default —
Logto needs no shared filesystem.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `logto` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `logto` | Application database user (granted `CREATEROLE`). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status`, 60s delay, 30 retries | Wide first-boot window for the seed step. |
| `liveness_probe` | HTTP `/api/status`, 60s delay, 30s period | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check. Disabled by default; enable and set `path = "/api/status"` for production monitoring. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Logto uses Postgres for all persistence — leave `false`. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service (Logto core / OIDC endpoint). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a non-PostgreSQL `database_type`, `min_instance_count > max_instance_count`, Redis enabled with no resolvable host, `enable_cloudsql_volume` with no database. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Cloud SQL database | Back up; never wipe | Critical | Logto's OIDC signing keys live in the DB. Wiping it regenerates new keys and invalidates every issued token and registered client. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all identity data. |
| `database_type` | `POSTGRES_15` | Critical | MySQL/other engines are rejected at plan time; Logto only runs on PostgreSQL. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `ENDPOINT` | Actual browser-facing host | High | A mismatched issuer breaks OIDC discovery, redirect URIs, and every OAuth callback. |
| `container_port` | `3001` | High | The core listens on 3001; a wrong port makes every probe and request fail. Admin console (3002) is intentionally unpublished. |
| `enable_iap` | `false` for a public IdP | High | IAP blocks all unauthenticated requests, including the OIDC/login flows Logto exists to serve. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | High | Below ~2 GiB Logto is prone to OOM under load. |
| Admin console access (3002) | Plan a route before go-live | High | The first-admin/setup UI is on 3002, unreachable via the `run.app` URL — first-run setup stalls without a separate path. |
| `enable_cloudsql_volume` | `true` | Medium | The proxy sidecar is injected for parity, but Logto connects via `DB_IP`; disabling it removes the sidecar without harming the app's private-IP path. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency to the first login after idle (data-safe otherwise). |
| `enable_redis` | `false` | Low | Logto does not use Redis; enabling it wires an unused dependency. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Logto-specific application configuration shared
with the GKE variant is described in **[Logto_Common](Logto_Common.md)**.
