---
title: "Speedtest Tracker on Google Cloud Run"
description: "Configuration reference for deploying Speedtest Tracker on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Speedtest Tracker on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SpeedtestTracker_CloudRun.png" alt="Speedtest Tracker on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Speedtest Tracker is a free, open-source, self-hosted internet speed test
monitoring tool built on Laravel (PHP). It runs Ookla speed tests on a recurring
schedule, stores results in a database, and presents them as historical charts
through a web dashboard and REST API. This module deploys Speedtest Tracker on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Speedtest Tracker uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer
to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them
here.

---

## 1. Overview

Speedtest Tracker runs as a PHP container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP (LinuxServer) container, 1 vCPU / 1 GiB by default, **always-on** (not scale-to-zero) |
| Database | Cloud SQL for MySQL 8.0 | Required — this module fixes MySQL; the upstream image's SQLite default is bypassed |
| Cache & sessions | Redis (optional) | Disabled by default; Speedtest Tracker uses the local file/sync cache driver |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`database_type = "MYSQL_8_0"`); PostgreSQL is not supported. Speedtest
  Tracker's own SQLite default (used when no DB env vars are set at all) is never
  reached because this module always wires MySQL.
- **The prebuilt `linuxserver/speedtest-tracker` image is used directly.** There is
  no custom Cloud Build for the default deployment; the official LinuxServer.io
  image is mirrored into Artifact Registry (`enable_image_mirroring = true`) and
  deployed as-is. Fallback: `ghcr.io/alexjustesen/speedtest-tracker` (Alpine-based,
  no s6-overlay) if the LinuxServer image is ever found incompatible with Cloud
  Run's gVisor sandbox — a documented risk class for s6-overlay images in this
  catalogue (confirmed on Prowlarr, though not universal; BookStack, also
  LinuxServer, works fine on Cloud Run).
- **The container listens on port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **Always-on by design, not by cost default.** `cpu_always_allocated = true` and
  `min_instance_count = 1` / `max_instance_count = 1`. The `SPEEDTEST_SCHEDULE`
  cron expression drives an **in-process Laravel scheduler** that fires speed tests
  independent of any inbound HTTP request — under request-based billing or
  scale-to-zero, the schedule silently never completes its work (the same failure
  class documented for n8n/Kestra in this catalogue). `max_instance_count` is
  capped at 1 because the scheduler has no cross-instance locking; more than one
  warm instance risks firing duplicate speed tests on the same tick.
- **`APP_KEY` is immutable after first boot.** The Laravel app key is generated once
  and stored in Secret Manager; rotating it makes all encrypted DB values
  undecryptable.
- **The image runs `php artisan migrate --force` automatically on start**, so the
  schema is created on first boot after `db-init` provisions the database and user —
  there is no separate migration job.
- **No storage by default.** Speedtest Tracker stores all results and configuration
  in Cloud SQL, with no user-file-upload workflow — `create_cloud_storage` and
  `enable_nfs` default off.
- **Cloud Run connects to Cloud SQL over private-IP TCP.** `enable_cloudsql_volume = false`
  by default, so `DB_HOST` is the instance private IP; MySQL over private-IP TCP needs
  no SSL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Speedtest Tracker service

Speedtest Tracker runs as a Cloud Run v2 service kept always-on
(`min_instance_count = 1`) so its in-process cron scheduler keeps firing. Each
deployment creates an immutable revision; traffic can be split across revisions for
safe rollouts.

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

### B. Cloud SQL for MySQL 8.0

Speedtest Tracker stores all speed test results and application configuration in a
managed Cloud SQL for MySQL 8.0 instance. The service connects over the Cloud SQL
**private IP** via VPC egress (`enable_cloudsql_volume = false`); `DB_HOST` is set
to the instance private IP and no public IP is exposed. On first deploy an
initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=speedtesttracker --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Redis (optional cache & sessions)

Redis is **disabled by default** (`enable_redis = false`); Speedtest Tracker uses
its local file/sync cache and session drivers, which is fine for a single-instance
deployment. When `enable_redis = true` is set, the shared layer injects
`REDIS_HOST` and `REDIS_PORT`.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the DB/schedule wiring in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -E 'DB_|REDIS_|SPEEDTEST_'
  ```

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager: the
Laravel **`APP_KEY`** (`base64:<44-char base64>`), used to encrypt all application
data that Speedtest Tracker stores encrypted. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Speedtest Tracker Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It detects the Cloud SQL socket or TCP endpoint, waits for MySQL
  to be reachable, creates the application database and user, grants privileges,
  verifies the app user can connect, and gracefully shuts down the Cloud SQL Auth
  Proxy sidecar. The job is idempotent and safe to re-run (`max_retries = 3`).
- **Schema auto-migration on start.** The LinuxServer Speedtest Tracker image runs
  `php artisan migrate --force` automatically on every container start, so the schema
  is created on first boot and upgraded on later boots — there is **no separate
  migration job**.
- **`APP_KEY` is immutable after first boot.** The Laravel app key is generated once
  and written to Secret Manager. Rotating it makes all encrypted DB values
  permanently undecryptable. Only rotate during a planned maintenance window with a
  re-encryption plan.
- **In-process cron scheduler.** `SPEEDTEST_SCHEDULE` (default `"0 * * * *"`, hourly)
  drives Speedtest Tracker's own Laravel scheduler to run automated speed tests. This
  fires with no inbound HTTP request, so the deployment defaults
  `cpu_always_allocated = true` + `min_instance_count = 1` specifically to keep it
  reliable — do not flip these unless the schedule is disabled entirely.
- **Result pruning.** `PRUNE_RESULTS_OLDER_THAN` (default `"0"`, disabled)
  automatically deletes speed test results older than the configured number of days.
- **Health path.** The liveness probe targets `/api/healthcheck` — Speedtest
  Tracker's unauthenticated JSON health endpoint. The startup probe is a TCP check
  on port 80. Allow a generous first-boot window: the liveness probe has a
  300-second initial delay to accommodate the automatic migrations.
- **First-run setup.** Speedtest Tracker's web UI walks through account creation on
  first visit — there is no seeded default admin account to change.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Speedtest Tracker are listed; every other input
is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `speedtesttracker` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Speedtest Tracker` | Human-readable name shown in the Console. |
| `description` | `Speedtest Tracker — automated internet speed test monitoring and history` | Service description. |
| `application_version` | `latest` | `linuxserver/speedtest-tracker` image tag; pin (e.g. `version-v1.6.3`) in production. |
| `speedtest_schedule` | `0 * * * *` | Cron expression for the automated speed test schedule. |
| `prune_results_older_than` | `0` | Days after which old results are pruned; `0` disables pruning. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploy the mirrored LinuxServer image directly — no custom build. |
| `container_image` | `""` | Override image reference; leave empty to use the mirrored default. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU by default. |
| `memory_limit` | `1Gi` | Memory per instance. |
| `cpu_always_allocated` | `true` | **Must stay true** — the cron scheduler needs CPU with no inbound request. |
| `min_instance_count` | `1` | **Must stay ≥ 1** — the scheduler needs an always-running instance. |
| `max_instance_count` | `1` | Keep at 1 — avoids duplicate scheduled speed tests across instances. |
| `container_port` | `80` | Speedtest Tracker listens on port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `execution_environment` | `gen2` | Gen2 execution environment. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Connect over Cloud SQL private-IP TCP (correct for MySQL on Cloud Run). |
| `enable_image_mirroring` | `true` | Mirror the LinuxServer image into Artifact Registry. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Ingress & VPC

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows public access to the dashboard. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `DISPLAY_TIMEZONE`, `SPEEDTEST_SERVERS`). Do not set `APP_KEY` or `DB_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Cloud Armor, CDN & Custom Domain

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Cloud Storage & NFS

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create any buckets declared in `storage_buckets` (empty by default). |
| `storage_buckets` | `[]` | GCS buckets to provision. Not needed by default. |
| `enable_nfs` | `false` | Not required by default — all state lives in Cloud SQL. |
| `nfs_mount_path` | `/config` | Mount path if NFS is enabled (e.g. for custom certs). |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — Speedtest Tracker requires MySQL 8.0 in this module. |
| `db_name` | `speedtesttracker` | MySQL database name (tenant-prefixed). Immutable after first deploy. |
| `db_user` | `speedtesttracker` | Application database user (tenant-prefixed). Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | DB password rotation. |

### Group 13 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | For unrelated maintenance tasks — Speedtest Tracker's own speed-test schedule runs in-process via `SPEEDTEST_SCHEDULE`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP port 80, 30s delay | Startup probe (port-listening check). |
| `liveness_probe` | HTTP `/api/healthcheck`, 300s delay | Liveness probe against the unauthenticated health endpoint. |
| `uptime_check_config` | `{ enabled=false, path="/api/healthcheck" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Sessions

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Inject `REDIS_HOST`/`REDIS_PORT` so Speedtest Tracker can use Redis for cache/sessions. Not required by default. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

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
| `database_host` / `database_port` | DB endpoint (private IP, sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match the engine Speedtest Tracker requires, an out-of-range `redis_port`/`backup_retention_days`. This module additionally validates that `cpu_always_allocated=true` implies `min_instance_count >= 1`, and that `max_instance_count <= 1` whenever `speedtest_schedule` is set. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all encrypted DB values permanently undecryptable. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `database_type` | `MYSQL_8_0` | Critical | Speedtest Tracker requires MySQL in this module; any other engine breaks startup. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` | Critical | Flipping either silently stops `SPEEDTEST_SCHEDULE` from ever firing — it will look deployed and healthy but never actually run a scheduled speed test. |
| `max_instance_count` | `1` | High | Scaling beyond 1 with an active `speedtest_schedule` risks duplicate speed tests firing on the same schedule tick (no cross-instance locking). |
| `memory_limit` | `1Gi` | High | Lower values risk OOM kills during migrations or concurrent dashboard use. |
| `enable_cloudsql_volume` | `false` (private-IP TCP) | High | On Cloud Run, Speedtest Tracker connects over private-IP TCP; forcing the socket path is unnecessary and can break DB connectivity. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks all external dashboard access. |
| `enable_iap` | only when readers must authenticate | High | IAP blocks all anonymous access. |
| `container_image_source` | `prebuilt` | Medium | Custom Cloud Build with no Dockerfile fails the build. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Speedtest Tracker-specific application
configuration shared with the GKE variant is described in
**[SpeedtestTracker_Common](SpeedtestTracker_Common.md)**.
