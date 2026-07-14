---
title: "BookStack on Google Cloud Run"
description: "Configuration reference for deploying BookStack on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# BookStack on Google Cloud Run

BookStack is a free, open-source, MIT-licensed wiki and documentation platform
built on Laravel (PHP), organising content as Shelves → Books → Chapters → Pages
with WYSIWYG and Markdown editing, full-text search, page revisions, and granular
permissions. This module deploys BookStack on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services BookStack uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

BookStack runs as a PHP container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP (LinuxServer) container, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — BookStack does not support PostgreSQL or other engines |
| Object storage | Cloud Storage | A dedicated `data` bucket (`gcs-bookstack<tenant>-data`) provisioned automatically |
| Persistent files | Filestore / NFS | Uploaded images and attachments persisted at `/var/lib/bookstack` |
| Cache & sessions | Redis (optional) | Disabled by default; BookStack uses the local cache/session driver |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`database_type = "MYSQL_8_0"`); PostgreSQL is not supported and selecting
  another engine breaks startup.
- **The prebuilt `linuxserver/bookstack` image is used directly.** There is no custom
  Cloud Build for the default deployment; the official LinuxServer.io image is
  mirrored into Artifact Registry (`enable_image_mirroring = true`) and deployed
  as-is.
- **The container listens on port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **NFS persistence of uploads is on by default.** `enable_nfs = true` mounts NFS at
  `/var/lib/bookstack` so uploaded images and attachments survive restarts, redeploys,
  and scale events. Disabling it loses uploaded files.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max_instance_count = 1`).
  Cold starts add a few seconds of latency to the first request after idle; BookStack
  is a pure request/response wiki with no background workers, so request-based billing
  (`cpu_always_allocated = false`) is correct.
- **`APP_KEY` is immutable after first boot.** The Laravel app key is generated once
  and stored in Secret Manager; rotating it makes all encrypted DB values (two-factor
  secrets, some settings) undecryptable.
- **The image runs `php artisan migrate --force` automatically on start**, so the
  schema is created on first boot after `db-init` provisions the database and user —
  there is no separate migration job.
- **A default administrator is seeded** by the LinuxServer image: `admin@admin.com`
  with password `password`. Change it immediately on first login.
- **Cloud Run connects to Cloud SQL over private-IP TCP.** `enable_cloudsql_volume = false`
  by default, so `DB_HOST` is the instance private IP; MySQL over private-IP TCP needs
  no SSL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the BookStack service

BookStack runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

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

BookStack stores all application data (books, pages, users, revisions, permissions)
in a managed Cloud SQL for MySQL 8.0 instance. The service connects over the Cloud
SQL **private IP** via VPC egress (`enable_cloudsql_volume = false`); `DB_HOST` is
set to the instance private IP and no public IP is exposed. On first deploy an
initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`storage_buckets` default: `name_suffix = "data"`,
resulting in `gcs-bookstack<tenant>-data`) is provisioned automatically. Additional
buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/       # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (optional cache & sessions)

Redis is **disabled by default** (`enable_redis = false`); BookStack uses its local
cache and session drivers. When `enable_redis = true` is set, the shared layer injects
`REDIS_HOST` and `REDIS_PORT` so BookStack can use Redis for cache and sessions. When
`redis_host` is left empty and `enable_nfs` is true, the NFS server VM's co-hosted
Redis IP is used.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the DB wiring in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -E 'DB_|REDIS_'
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager: the
Laravel **`APP_KEY`** (`base64:<44-char base64>`), used to encrypt all application
data that BookStack stores encrypted. The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows the public access expected of a shared wiki. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. BookStack Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It detects the Cloud SQL socket or TCP endpoint, waits for MySQL
  to be reachable, creates the application database and user, grants privileges,
  verifies the app user can connect, and gracefully shuts down the Cloud SQL Auth
  Proxy sidecar. The job is idempotent and safe to re-run (`max_retries = 3`).
- **Schema auto-migration on start.** The LinuxServer BookStack image runs
  `php artisan migrate --force` automatically on every container start, so the schema
  is created on first boot and upgraded on later boots — there is **no separate
  migration job**.
- **`APP_KEY` is immutable after first boot.** The Laravel app key is generated once
  and written to Secret Manager. Rotating it makes all encrypted DB values (two-factor
  secrets, some settings) permanently undecryptable. Only rotate during a planned
  maintenance window with a re-encryption plan.
- **First-run administrator.** The image seeds a default admin account,
  `admin@admin.com` / `password`. Change the password (and ideally the email)
  immediately after the first login.
- **Uploaded files live on NFS.** Images, attachments, and other uploads are stored on
  the filesystem under `/var/lib/bookstack`, which is NFS-backed by default so they
  survive restarts, redeploys, and scale-to-zero.
- **Health path.** The liveness probe targets `/status` — BookStack's unauthenticated
  JSON health endpoint that reports app/database/cache/session status. The startup
  probe is a TCP check on port 80. Allow a generous first-boot window: the liveness
  probe has a 300-second initial delay to accommodate the automatic migrations.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for BookStack are listed; every other input is
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
| `application_name` | `bookstack` | Base name for resources. Do not change after first deploy. |
| `display_name` | `BookStack` | Human-readable name shown in the Console. |
| `description` | `BookStack wiki on Cloud Run` | Service description. |
| `application_version` | `latest` | `linuxserver/bookstack` image tag; pin (e.g. `version-v24.10`) in production. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | `512M` / `64M` / `64M` | PHP tuning hints; inert for the LinuxServer image by default. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploy the mirrored LinuxServer image directly — no custom build. |
| `container_image` | `""` | Override image reference; leave empty to use the mirrored default. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU by default. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Keep at 1 — BookStack has no multi-instance queue coordination. |
| `container_port` | `80` | BookStack listens on port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Connect over Cloud SQL private-IP TCP (correct for MySQL on Cloud Run). |
| `enable_image_mirroring` | `true` | Mirror the LinuxServer image into Artifact Registry. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Ingress & VPC

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows public access for the wiki. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks anonymous readers.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `APP_URL`, mail config). Do not set `APP_KEY` or `DB_*` here. |
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
| `create_cloud_storage` | `true` | Create the default `data` bucket and any in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix="data" }]` | GCS buckets to provision. |
| `enable_nfs` | `true` | Persist uploaded images/attachments on NFS. |
| `nfs_mount_path` | `/var/lib/bookstack` | Mount path where BookStack stores uploads. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — BookStack requires MySQL 8.0. |
| `db_name` | `bookstack` | MySQL database name (tenant-prefixed). Immutable after first deploy. |
| `db_user` | `bookstack` | Application database user (tenant-prefixed). Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | DB password rotation. |

### Group 13 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | BookStack has no platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP port 80, 30s delay | Startup probe (port-listening check). |
| `liveness_probe` | HTTP `/status`, 300s delay | Liveness probe against the unauthenticated health endpoint. |
| `uptime_check_config` | `{ enabled=false, path="/status" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Sessions

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Inject `REDIS_HOST`/`REDIS_PORT` so BookStack can use Redis for cache/sessions. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match the engine BookStack requires, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all encrypted DB values (two-factor secrets, some settings) permanently undecryptable. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `database_type` | `MYSQL_8_0` | Critical | BookStack requires MySQL; any other engine breaks startup. |
| `APP_URL` (via `environment_variables`) | Actual service URL | High | A wrong base URL breaks asset loading, links, and login redirects. |
| `enable_nfs` | `true` | High | Disabling loses all uploaded images and attachments on redeploy or scale-to-zero. |
| `memory_limit` | `2Gi` | High | Lower values risk OOM kills under concurrent editing and full-text indexing. |
| `enable_cloudsql_volume` | `false` (private-IP TCP) | High | On Cloud Run, BookStack connects over private-IP TCP; forcing the socket path is unnecessary and can break DB connectivity. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks all external readers of the wiki. |
| `enable_iap` | only when readers must authenticate | High | IAP blocks all anonymous access, including public documentation readers. |
| `max_instance_count` | `1` | Medium | BookStack has no multi-instance coordination; scaling out risks cache/session inconsistency. |
| `min_instance_count` | `0` (CR) | Medium | Scale-to-zero adds a cold-start delay on the first request after idle. |
| `admin@admin.com` default password | Change on first login | Medium | Leaving the default `password` lets anyone with the URL log in as admin. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. BookStack-specific application configuration
shared with the GKE variant is described in
**[BookStack_Common](BookStack_Common.md)**.
