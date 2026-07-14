---
title: "Snipe-IT on Google Cloud Run"
description: "Configuration reference for deploying Snipe-IT on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Snipe-IT on Google Cloud Run

Snipe-IT is a free, open-source IT asset and inventory management system used to
track hardware, software licences, accessories, and consumables, with asset
check-in/out, audit logging, depreciation, and a full REST API. It is built on
Laravel/PHP and runs behind Apache. This module deploys Snipe-IT on **Cloud Run
v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions
and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Snipe-IT uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Snipe-IT runs as the official `snipe/snipe-it` PHP/Apache container pulled
directly from Docker Hub — there is no custom build step. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Prebuilt `snipe/snipe-it` PHP/Apache image, port 80, 1 vCPU / 2 GiB by default; serverless autoscaling with scale-to-zero |
| Database | Cloud SQL for MySQL 8.0 | Required — fixed by `SnipeIT_Common`; other engines are not supported |
| File persistence | Cloud Filestore (NFS) | Enabled by default; uploaded asset images, signatures, and barcodes persist under `/var/lib/snipeit` |
| Object storage | Cloud Storage | A `snipeit-uploads` bucket provisioned automatically |
| Cache | Redis (optional) | Enabled by default for Laravel cache/session backing |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password managed by the foundation |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Prebuilt official image only.** `container_image_source = "prebuilt"` is
  the default — the module deploys `snipe/snipe-it:<application_version>`
  (default tag `v8-latest`) directly, mirrored into Artifact Registry when
  `enable_image_mirroring = true`. There is no Cloud Build/Dockerfile step.
- **MySQL 8.0 is mandatory.** `SnipeIT_Common` fixes `database_type` to
  `MYSQL_8_0` regardless of the variable's value; other engines are not
  supported.
- **Cloud SQL is reached over TCP by default, not a Unix socket.**
  `enable_cloudsql_volume` defaults to `false` here — unlike most App_CloudRun
  modules. This is deliberate: Snipe-IT is a Laravel/MySQL client, and per this
  repository's convention, Laravel-mysql apps (Snipe-IT, Matomo) connect over
  the Cloud SQL private IP rather than the Auth Proxy socket. `db-init.sh`
  still supports the socket path if you flip `enable_cloudsql_volume = true`,
  but the proven, tested default is TCP.
- **DB env vars are hard-mapped to Laravel's native names.** `main.tf`
  hardcodes `db_user_env_var_name = "DB_USERNAME"`, `db_name_env_var_name =
  "DB_DATABASE"`, and `db_password_env_var_name = "DB_PASSWORD"` — the exact
  names Laravel's `env()` config reads — plus `DB_CONNECTION = "mysql"` and
  `DB_PORT = "3306"` set by `SnipeIT_Common`. This is an already-fixed, proven
  convention (mirrored from the same fix applied to BookStack/Matomo), not
  something you need to configure.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at
  `/var/lib/snipeit`) so uploaded asset images, signatures, and barcodes
  persist and survive scale-to-zero/cold starts — unlike apps such as
  Activepieces where NFS defaults off.
- **A Laravel `APP_KEY` is generated automatically** and stored in Secret
  Manager (`secret-<prefix>-snipeit-app-key`), injected as the `APP_KEY`
  secret env var. Regenerating it after first boot invalidates all active
  sessions and any application data encrypted with the old key.
- **Single instance ceiling by default.** `max_instance_count = 1` —
  multi-instance behaviour with shared NFS storage and Laravel's
  database-backed session driver has not been verified for Snipe-IT.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Cold
  starts add latency to the first request after idle.
- **Redis is on by default** (`enable_redis = true`) for Laravel cache/session
  offload; leaving `redis_host` blank falls back to the platform's standard
  Redis endpoint resolution.
- **Two ordered init jobs run on every apply.** `db-init` (creates the
  database/user via `mysql:8.0-debian`) runs first, then `migrate` (`php
  artisan migrate --force` against the `snipe/snipe-it` image) — both are
  `execute_on_apply = true` and safe to re-run.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Snipe-IT service

Snipe-IT runs as a Cloud Run v2 service that autoscales by request load
between the minimum and maximum instance counts. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.

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

### B. Cloud SQL for MySQL 8.0

Snipe-IT stores all application data (assets, licences, accessories,
consumables, users, audit trail) in a managed Cloud SQL for MySQL 8.0
instance. By default the service reaches it over the **private IP via TCP**
(`enable_cloudsql_volume = false`), not the Cloud SQL Auth Proxy Unix socket
used by most other App_CloudRun modules. On first deploy, the `db-init`
initialization Job creates the application database and user (retrying the
socket path first, then falling back to TCP against `DB_IP`), followed by the
`migrate` job which runs Laravel's `artisan migrate --force`.

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

### C. Cloud Storage & NFS file persistence

A dedicated **Cloud Storage** bucket (suffix `snipeit-uploads`) is provisioned
automatically. Separately, Snipe-IT's runtime upload tree (asset images,
signatures, barcodes) lives on **NFS (Cloud Filestore)** at
`/var/lib/snipeit`, shared across instances and surviving container
restarts/cold starts — required because Cloud Run's local container
filesystem is ephemeral.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse volumes and CMEK options.

### D. Redis (cache backend)

Redis is **enabled by default** (`enable_redis = true`) for Laravel's cache
layer. When `redis_host` is left empty, the standard platform Redis
resolution applies (the NFS server's co-located Redis, when NFS is enabled).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected value in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

One Snipe-IT secret is generated automatically and stored in Secret Manager:
the Laravel `APP_KEY` (`base64:<...>`, 32 random bytes base64-encoded). The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~snipeit"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`). An external HTTPS load balancer with a custom domain, Cloud CDN, and
Cloud Armor can be layered on; ingress settings and VPC egress control
connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies (disabled by
default).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Snipe-IT Application Behaviour

- **First-deploy database setup.** The `db-init` initialization Job runs on
  `mysql:8.0-debian`. It first checks for a mounted Cloud SQL Unix socket
  (only present if `enable_cloudsql_volume = true`) and, when absent, falls
  back to TCP against `DB_IP` (the instance private IP) — the module's
  default path. It idempotently creates the application database and user,
  grants privileges, and verifies the app user can actually connect (which
  also warms MySQL 8's `caching_sha2_password` server-side auth cache). Safe
  to re-run.
- **Explicit migration job, not boot-time-only auto-migration.** A separate
  `migrate` job runs `php /var/www/html/artisan migrate --force`
  (`depends_on_jobs = ["db-init"]`, `max_retries = 2`) so the schema exists
  before the first revision serves traffic. The official image's own
  boot-time auto-migration, if any, is a secondary safety net.
- **DB env-var mapping to Laravel names (already fixed, not a gotcha).**
  `main.tf` hardcodes `db_user_env_var_name = "DB_USERNAME"`,
  `db_name_env_var_name = "DB_DATABASE"`, and `db_password_env_var_name =
  "DB_PASSWORD"`, and `SnipeIT_Common` sets `DB_CONNECTION = "mysql"` and
  `DB_PORT = "3306"`. The Foundation injects the tenant-scoped DB credentials
  directly under these Laravel-native names — no entrypoint aliasing needed.
  The variables `db_user_env_var_name`/`db_name_env_var_name`/
  `db_password_env_var_name` declared in `variables.tf` are inert for this
  module (their values are silently ignored; the literals above always win).
- **`APP_KEY` is immutable after first boot.** Generated once
  (`random_password` + base64 encoding with the `base64:` prefix Laravel
  expects) and written to Secret Manager. Regenerating it invalidates all
  active sessions and any data Snipe-IT encrypted with the old key.
- **Session/cache/queue persistence.** `SnipeIT_Common` sets `SESSION_DRIVER =
  "database"`, `CACHE_DRIVER = "file"`, and `QUEUE_DRIVER = "database"` so
  sessions and queued jobs survive instance restarts even with
  `max_instance_count = 1`.
- **`APP_URL` is derived automatically.** The predicted Cloud Run service URL
  (built from `module.deployment_id.service_name` — the app-scoped name, not
  the tenant-only `resource_prefix`, per an explicit comment in `main.tf`
  guarding against a wrong-host 404 loop) is passed as `service_url` and
  injected as `APP_URL` when non-empty.
- **No open self-serve sign-up.** Unlike apps with a public registration
  flow, a fresh Snipe-IT install redirects `/` to the `/setup` installation
  wizard, where the first administrator account is created interactively.
  Getting `APP_URL`/the service host wrong breaks this redirect.
- **Health path.** The default startup probe is **TCP** on the container port
  (30 s initial delay, 15 s period, 20 failure threshold — generous to allow
  first-boot DB setup). The default liveness probe is **HTTP** `GET /` (300 s
  initial delay, 60 s period, failure threshold 3) — Snipe-IT serves its
  login/setup page at `/` unauthenticated, confirming the PHP app and DB
  connection are healthy.
- **`php_memory_limit`, `upload_max_filesize`, `post_max_size` are accepted
  but not applied.** These variables are declared for UI convention parity but
  are never referenced by `SnipeIT_Common`'s configuration — the prebuilt
  image keeps its own baked-in PHP settings regardless of these values.
- **Inspect job execution and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Snipe-IT are listed; every other input is
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
| `application_name` | `snipeit` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Snipe-IT` | Human-readable name shown in the Console. |
| `description` | `Snipe-IT IT asset management on Cloud Run` | Service description. |
| `application_version` | `v8-latest` | Tag of the official `snipe/snipe-it` image; pin to a specific release in production. |
| `php_memory_limit` | `512M` | Accepted but **not applied** — the prebuilt image keeps its own PHP config. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Accepted but **not applied** to the prebuilt image. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official image directly; `"custom"` is not the supported path for Snipe-IT. |
| `cpu_limit` | `1000m` | 1 vCPU minimum recommended with MySQL. |
| `memory_limit` | `2Gi` | Minimum 512Mi; 2Gi recommended for production. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Keep at `1` unless multi-instance session/NFS behaviour is verified. |
| `container_port` | `80` | Snipe-IT (Apache) listens on port 80, not the common Cloud Run 8080 default. |
| `execution_environment` | `gen2` | Required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | **TCP by default** — deliberate for this Laravel-mysql app; `true` mounts the Auth Proxy socket instead. |
| `enable_image_mirroring` | `true` | Mirror the Docker Hub image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required to reach the public setup wizard and UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in before reaching the app. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `APP_*`/`DB_*` values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`. Not typically used since Snipe-IT deploys the
prebuilt official image rather than a custom build.

### Group 9 — Custom Initialization & SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS
bucket against the database after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry mirror cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{name_suffix="data"}]` | Additional GCS buckets beyond the auto-provisioned `snipeit-uploads` bucket. |
| `enable_nfs` | `true` | On by default so uploaded asset images/signatures/barcodes persist and are shared across instances. Keep enabled. |
| `nfs_mount_path` | `/var/lib/snipeit` | Where Snipe-IT stores uploads and runtime data. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `SnipeIT_Common` regardless of value — Snipe-IT requires MySQL. |
| `db_name` | `snipeit` | Database name. Immutable after first deploy. |
| `db_user` | `snipeit` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off / `90` | DB password rotation. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Declared for convention parity; **inert** for this module — `main.tf` hardcodes the Laravel-native `DB_USERNAME`/`DB_DATABASE`/`DB_PASSWORD` mapping directly and does not forward these variables. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `migrate` job chain. |
| `cron_jobs` | `[]` | Forwarded to the foundation; empty by default since Snipe-IT has no built-in scheduled maintenance task. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay, 20 failure threshold | Generous to allow first-boot DB setup. |
| `liveness_probe` | HTTP `/`, 300s delay, 3 failure threshold | Confirms the PHP app and DB connection are healthy. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enabled by default for Laravel's cache backend. |
| `redis_host` | `""` | Leave empty to use the platform's standard Redis endpoint resolution. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

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
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, which
> validates values *and combinations* at plan time — a read replica without
> its primary, IAP with no authorized identities, a `gen1` runtime with
> NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`.
> Invalid configuration fails the **plan** with a clear, named error before
> any resource is created, so most mistakes below are caught up front rather
> than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixed) | Critical | Snipe-IT requires MySQL; `SnipeIT_Common` ignores other values. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `APP_KEY` (auto-generated) | Never change after first boot | Critical | Regenerating it invalidates all active sessions and any data encrypted with the old key. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_cloudsql_volume` | `false` (TCP) | High | This is the tested default for Snipe-IT's Laravel/MySQL client; flipping to `true` mounts the socket path instead but has not been verified against Snipe-IT's Laravel DB config for this module. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded asset images/signatures/barcodes ephemeral — isolated per instance and lost on cold start. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified shared-NFS/session-driver behaviour risks inconsistent uploads and session handling. |
| `ingress_settings` | `all` | High | Restricting to `internal` blocks the public `/setup` wizard needed to create the first administrator account. |
| `container_port` | `80` | High | Snipe-IT's Apache listens on 80; changing this without a matching custom image breaks routing. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | Leave as-is | Low | These variables are inert for this module — `main.tf` hardcodes the correct Laravel-native names regardless of their value. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | Any value | Low | Accepted but not applied to the prebuilt image — do not rely on these to change PHP behaviour. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start delay on the first request after idle. |
| `memory_limit` | `2Gi` | Medium | Values near the 512Mi floor risk OOM kills under concurrent asset imports/uploads. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The setup wizard and admin UI are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Snipe-IT-specific application
configuration shared with the GKE variant (image, `APP_KEY` secret, init
jobs) is described in `modules/SnipeIT_Common/README.md` — no standalone
`docs/modules/SnipeIT_Common.md` guide exists yet.
