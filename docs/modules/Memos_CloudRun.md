---
title: "Memos on Google Cloud Run"
description: "Configuration reference for deploying Memos on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Memos on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_CloudRun.png" alt="Memos on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos is an open-source, MIT-licensed, self-hosted note-taking service built for
quick markdown capture — a single ~20MB Go binary with a React frontend. This
module deploys Memos on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Memos uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Memos runs as a single Go container on Cloud Run v2. The deployment wires together
a deliberately small set of Google Cloud services — Memos has no queue, no cache,
and no background workers:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 1 vCPU / 512 MiB by default, serverless autoscaling, scale-to-zero by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — this module standardizes on Postgres via a single `MEMOS_DSN` connection URL |
| Object storage | none | Not provisioned by this module — see the attachments note below |
| Cache & queue | none | Memos has no queue or cache dependency |
| Secrets | Secret Manager | Only the database password (managed by the Foundation); Memos itself has no app-level secret |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the standardized engine.** `Memos_Common` fixes
  `database_type = "POSTGRES_15"`. Memos itself also supports MySQL and SQLite
  upstream, but this module does not wire those paths.
- **No admin-bootstrap secret exists.** The **first account created through the web
  UI becomes the host/admin** — there is no `DEFAULTUSER`-style env var and nothing
  to retrieve from Secret Manager for first login.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Memos does no work without an inbound request, so
  request-based billing is the correct default — unlike apps with background
  schedulers or WebSocket push, there is no reason to force always-on CPU here.
- **The database DSN is computed at container start**, not baked into the image.
  `memos-entrypoint.sh` reads the platform-injected `DB_*` variables and builds the
  single `MEMOS_DSN` connection URL Memos expects, branching on whether Cloud Run
  handed it a Unix-socket directory or a TCP host, and URL-encoding the password.
- **No object storage is provisioned.** This module does not declare a GCS bucket or
  volume for uploaded file attachments. Text notes persist fully in PostgreSQL, but
  binary attachments would live on Cloud Run's ephemeral container filesystem and
  would **not** survive a revision restart. Fine for text-only note-taking; add a
  `gcs_volumes` entry if attachment persistence is required.
- **Public sign-up is open by default**, same as any fresh Memos install. Disable
  self-registration from within the Memos UI after creating the first (admin)
  account, if the deployment should not accept further public sign-ups.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Memos service

Memos runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision.

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

Memos stores all application data (notes, tags, users, resources metadata) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately
through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed.
On first deploy an initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Secret Manager

Only the database password secret exists for this module — managed entirely by the
Foundation, not by `Memos_Common`. Memos generates its own internal session-signing
key and stores it in its own database on first boot; there is no corresponding
Secret Manager entry to inspect.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Memos Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh` using `postgres:15-alpine`. It connects through the Cloud
  SQL Auth Proxy and idempotently creates the application role and database. The
  job is safe to re-run.
- **Schema migrations on start.** Memos applies its own internal GORM auto-migrate
  schema setup on every startup — no separate migration job is needed, and
  upgrading `application_version` applies schema changes automatically.
- **No admin-bootstrap credential to retrieve.** The first account created through
  the web UI's sign-up form becomes the host/admin. There is nothing in Secret
  Manager to fetch before first login — this differs from most apps in this
  catalogue.
- **Database DSN is computed, not static.** `memos-entrypoint.sh` builds
  `MEMOS_DSN` from `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` at
  container start (see [Memos_Common](Memos_Common.md) for the exact branching
  logic), then chains into the upstream image's own entrypoint, which drops
  privileges to a non-root user before launching the compiled binary.
- **Health path.** Startup and liveness probes target `/` — Memos's public
  login/landing page, reachable without authentication. No dedicated `/health` or
  `/healthz` endpoint is documented upstream.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Memos are listed; every other input is
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
| `application_name` | `memos` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Memos` | Human-readable name shown in the Console. |
| `application_description` | `Memos note-taking service on Cloud Run` | Service description. |
| `application_version` | `latest` | Deployment-tracking tag. `Memos_Common` maps `"latest"` to the pinned `MEMOS_VERSION = "0.28.0"` Dockerfile build arg, so a fresh build never resolves a non-existent `latest` upstream tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the wrapper image with the computed-DSN entrypoint. `"prebuilt"` deploys the official image directly but then requires manually wiring `MEMOS_DRIVER`/`MEMOS_DSN` via `environment_variables`. |
| `container_image` | `ghcr.io/usememos/memos` | Base image reference used by the custom build. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance — sufficient for Memos's small footprint. |
| `min_instance_count` | `0` | Scale-to-zero — Memos has no background work to keep warm for. |
| `max_instance_count` | `1` | Single-instance default; raise for higher concurrent load. |
| `container_port` | `5230` | Memos's native default port — no remapping performed. |
| `execution_environment` | `gen2` | Gen2 required for NFS/GCS Fuse mounts (not used by this module, but the platform default). |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `cpu_always_allocated` | `false` | Request-based billing — Memos does no work between requests. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Memos image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress; Memos has no separate unauthenticated ingest path to protect. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the whole service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Any `MEMOS_*` value Memos documents can be set here (e.g. `MEMOS_INSTANCE_URL`). The database connection (`MEMOS_DSN`, `MEMOS_DRIVER`) is computed automatically — do not set them here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL & NFS

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`
run SQL from a GCS bucket after provisioning. `nfs_instance_name` /
`nfs_instance_base_name` are declared for convention parity but not exercised —
Memos does not use NFS. See [App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets` — empty by default, since Memos attachments are not GCS-backed in this module. |
| `storage_buckets` | `[]` | No bucket provisioned by default. |
| `enable_nfs` | `false` | Not used — Memos keeps no state outside PostgreSQL in this module's wiring. |
| `gcs_volumes` | `[]` | Add an entry here (mounted at Memos's data directory) if attachment persistence across revisions is required. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Memos_Common`. |
| `application_database_name` | `memos` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `memos` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not used — Memos has no platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 30s delay | Startup probe — targets the public login page. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false }` | Cloud Monitoring uptime check; enable explicitly to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 16 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Memos has no cache/queue dependency; leave `false` unless integrating an external Redis instance for a custom purpose. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets — empty by default. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (includes `db-init`). |
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

> **Inherited plan-time validation.** This module passes its configuration through
> the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values and
> combinations at plan time. Invalid configuration fails the **plan** with a clear,
> named error before any resource is created, so most mistakes below are caught up
> front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| First account created via sign-up | Create it immediately after deploy | Critical | The **first** account to register becomes host/admin — if left open, any visitor who reaches the URL first claims that role. |
| Public self-registration | Disable after first admin | High | Memos ships with open sign-up by default; leaving it enabled lets anyone with the URL create an account. |
| `container_image_source` | `custom` (default) | High | `"prebuilt"` deploys the official image directly, but that image has no logic to compute `MEMOS_DSN` from the platform's `DB_*` vars — it must be wired manually via `environment_variables` or the app fails to connect to the database. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `memory_limit` | `512Mi` (default is sufficient) | Medium | Memos's footprint is small; raising this mainly affects cost, not correctness. |
| `min_instance_count` | `0` (default) | Low | Scale-to-zero adds a brief cold start (Go binary, fast boot) to the first request after idle — much shorter than JVM/Node.js apps in this catalogue. |
| `gcs_volumes` for attachments | Add explicitly if needed | Medium | Without it, uploaded binary attachments live on Cloud Run's ephemeral filesystem and do not survive a revision restart — text notes in PostgreSQL are unaffected. |
| `enable_cloud_armor` | enable for production | Medium | The login/sign-up form is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Memos-specific application configuration
shared with the GKE variant is described in
**[Memos_Common](Memos_Common.md)**.
