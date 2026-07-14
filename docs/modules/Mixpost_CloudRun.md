---
title: "Mixpost on Google Cloud Run"
description: "Configuration reference for deploying Mixpost on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Mixpost on Google Cloud Run

Mixpost is an open-source, self-hosted social media scheduling and management
platform — a Buffer/Hootsuite alternative for composing, scheduling, publishing,
and analysing posts across multiple social accounts from one dashboard. It ships
as a single Laravel application (nginx + PHP-FPM + supervisord running the queue
worker and scheduler inside one container, the official `inovector/mixpost`
image). This module deploys Mixpost on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Mixpost uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Mixpost runs as a single, self-contained web container on Cloud Run v2 — no
separate build step, since the official prebuilt image is deployed directly.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | nginx + PHP-FPM + supervisord container listening on port 80, 2 vCPU / 2 GiB by default; serverless autoscaling |
| Database | Cloud SQL for MySQL 8.0 | Required and fixed — `Mixpost_Common` hardcodes `MYSQL_8_0` |
| Queue, cache & sessions | Redis | Enabled by default; drives `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER`; defaults to the co-located NFS server IP when no external host is given |
| Object storage | Cloud Storage | A `storage` bucket provisioned automatically by `Mixpost_Common` |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** `Mixpost_Common` sets `database_type = "MYSQL_8_0"`
  and `DB_CONNECTION = "mysql"` unconditionally; the `database_type` variable's
  face value is not actually forwarded from the application module for the
  Mixpost engine choice — only MySQL is supported.
- **The database is reached over a Cloud SQL Auth Proxy Unix socket, not TCP.**
  `enable_cloudsql_volume` defaults `false` on this module (unlike most
  MySQL/Laravel Cloud Run modules) — check the deployed revision if the app
  cannot reach the database; enabling it mounts the socket at
  `/cloudsql` and `db-init.sh` auto-detects the connection type
  (`-S <socket>` vs `-h <host> --get-server-public-key`).
- **Redis is on by default and effectively required.** `enable_redis = true`
  wires `QUEUE_CONNECTION`, `CACHE_DRIVER`, and `SESSION_DRIVER` to `redis`
  (falling back to `sync`/`file` only when disabled) — this merge happens in
  the Application module's own `main.tf` locals, not in `Mixpost_Common`. When
  `redis_host` is empty, the NFS server VM's IP is used as the Redis endpoint
  (requires `enable_nfs = true`).
- **`min_instance_count = 0`, `cpu_always_allocated = false` — cold-start,
  request-based billing.** Unlike the GKE variant (which defaults `min = 1` to
  keep the in-pod scheduler running continuously), the Cloud Run variant
  scales to zero between requests. **Trade-off:** the Laravel `schedule:run`
  cron and queue worker only run while an instance is warm/serving a request,
  so scheduled social posts do **not** reliably publish on their own — externalise
  `schedule:run` with Cloud Scheduler hitting a cron endpoint (every minute), or
  set `cpu_always_allocated = true` **and** `min_instance_count >= 1` to restore
  continuous in-process operation (mirroring the always-on apps documented in
  the repository's CLAUDE.md).
- **NFS is enabled by default** (`enable_nfs = true`, `/mnt/nfs`) for shared
  media/file storage, and doubles as the default Redis host when `redis_host`
  is left blank.
- **`APP_KEY` is generated automatically** and stored in Secret Manager in
  Laravel's native `base64:<value>` format — never rotate it after first boot.
- **Laravel DB env mapping is hardcoded in `main.tf`.** `db_user_env_var_name =
  "DB_USERNAME"`, `db_name_env_var_name = "DB_DATABASE"`, and
  `service_url_env_var_name = "APP_URL"` are set in the Application module's
  `main.tf` (not operator-configurable) so the Foundation's tenant-scoped
  `DB_USER`/`DB_NAME`/service URL land on the environment variable names
  Laravel's `env()` actually reads.
- **The startup probe is TCP, the liveness probe is HTTP.** `main.tf` overrides
  `Mixpost_Common`'s config to use a `TCP` startup probe on port 80 (Cloud Run
  health checks arrive over plain HTTP from a Google-internal address, and TCP
  is sufficient to confirm the port is listening) and an `HTTP` liveness probe
  against `/`, which Mixpost answers with `200`.
- **`container_image_source = "prebuilt"`** deploys `inovector/mixpost:<version>`
  directly; there is no custom Dockerfile build for this module.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Mixpost service

Mixpost runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

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

Mixpost stores all application data (social accounts, posts, media metadata,
users) in a managed Cloud SQL for MySQL 8.0 instance. On first deploy the
`db-init` initialization Job creates the application database (`utf8mb4`) and
user and grants privileges; the connection method (socket vs TCP) is
auto-detected from `$DB_HOST`.

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

### C. Cloud Storage

A dedicated **Cloud Storage** `storage`-suffixed bucket is provisioned
automatically by `Mixpost_Common`. Additional buckets can be declared via
`storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (queue, cache & sessions)

Redis is **enabled by default** (`enable_redis = true`), driving
`QUEUE_CONNECTION`, `CACHE_DRIVER`, and `SESSION_DRIVER`. No dedicated
Memorystore instance is provisioned by this module — unless `redis_host` is
overridden to an external instance, Redis is expected at the NFS server VM's
IP (the same Compute Engine VM that serves NFS also runs Redis in this
repository's shared-infrastructure convention).

- **Console:** Memorystore → Redis (only if pointed at a managed instance);
  otherwise Compute Engine → VM instances for the NFS/Redis host.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -E 'QUEUE_CONNECTION|CACHE_DRIVER|SESSION_DRIVER'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### E. Secret Manager

One Mixpost-specific secret is generated automatically: the Laravel `APP_KEY`
(`secret-<resource_prefix>-<application_name>-app-key`), a random 32-character
value base64-encoded in Laravel's native `base64:<value>` format. The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mixpost"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Cloud Filestore (NFS)

**Enabled by default** (`enable_nfs = true`), mounted at `/mnt/nfs` for shared
media/upload persistence, and — when `redis_host` is left blank — also the
default Redis endpoint.

- **Console:** Filestore → Instances; or Compute Engine → VM instances if the
  Redis/NFS host is the repository's self-managed NFS VM.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### G. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Mixpost Application Behaviour

- **First-deploy database setup.** The `db-init` initialization Job runs
  `db-init.sh` using `mysql:8.0-debian`. It auto-detects whether `$DB_HOST` is
  a Unix socket path (`-S`) or a TCP host (`-h ... --get-server-public-key`,
  needed because MySQL 8's `caching_sha2_password` refuses to send a password
  over what looks like an unencrypted connection), idempotently creates the
  application database with `utf8mb4`, creates the application user, and
  grants privileges. The job is safe to re-run (`execute_on_apply = true`,
  `max_retries = 1`).
- **No separate migration job.** The prebuilt `inovector/mixpost` image's
  built-in supervisord entrypoint runs `php artisan migrate --force` and seeds
  the admin account on every boot, so there is no distinct migrate init job —
  upgrading `application_version` applies schema changes automatically on next
  start.
- **`APP_KEY` is immutable after first boot.** Generated once by
  `Mixpost_Common` and written to Secret Manager as `base64:<32-char value>`.
  Rotating it invalidates encrypted session/cookie data and any encrypted
  database fields.
- **Admin account defaults are baked into the image, not configurable via this
  module.** `mixpost_admin_email` is declared for forwarding but is **not
  currently injected** into the running container config — the image seeds its
  own default admin account regardless of this variable. Retrieve the actual
  first-login credentials from the image's documented defaults and change the
  password immediately after first login.
- **Scheduled publishing depends on the instance staying warm.** With the
  cold-start default (`min_instance_count = 0`, `cpu_always_allocated = false`),
  the in-container Laravel scheduler/queue worker only runs while a request is
  in flight or the instance is within its keep-warm window. For reliable
  scheduled posting, either point a Cloud Scheduler job at a cron/health
  endpoint every minute to keep an instance alive and trigger `schedule:run`,
  or set `cpu_always_allocated = true` with `min_instance_count >= 1`.
- **Health path.** The startup probe is `TCP` on port 80 (avoids any HTTP
  redirect/auth complications on first boot); the liveness probe is `HTTP` on
  `/`, which Mixpost/nginx answers directly with `200`. `REQUIRE_HTTPS = false`
  is injected because Cloud Run terminates TLS in front of the container.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Inspect the running configuration:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -E 'DB_|APP_URL|QUEUE_CONNECTION'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Mixpost are listed; every other input is
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
| `application_name` | `mixpost` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Mixpost` | Human-readable name shown in the Console. |
| `application_description` | `Mixpost - Open-source social media management platform` | Service description. |
| `application_version` | `latest` | `inovector/mixpost` image tag deployed directly (prebuilt, no custom build). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys `inovector/mixpost` directly; forwarded explicitly so the Foundation does not treat this as a custom build with no Dockerfile. |
| `container_image` | `""` | Override to a mirrored or custom image URI. |
| `cpu_limit` | `2000m` | 2 vCPU recommended. |
| `memory_limit` | `2Gi` | Mixpost requires at least 2Gi for media processing and queue workers. |
| `cpu_always_allocated` | `false` | Cold-start/request-based billing. Set `true` (with `min_instance_count >= 1`) to keep the Laravel scheduler/queue worker running continuously; otherwise externalise `schedule:run` via Cloud Scheduler. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1`+ to avoid cold starts and keep the scheduler warm. |
| `max_instance_count` | `3` | Cost ceiling; increase cautiously — Mixpost has no built-in multi-instance queue coordination beyond Redis. |
| `container_port` | `80` | nginx + PHP-FPM serve plain HTTP on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Cloud SQL Auth Proxy Unix socket. Enable for socket-based connections; `db-init.sh` auto-detects socket vs TCP either way. |
| `enable_image_mirroring` | `true` | Mirror the Mixpost image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |
| `container_protocol` | `http1` | `h2c` available if the app supports HTTP/2 cleartext. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Mount path for the Cloud SQL Auth Proxy socket. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress for the Mixpost UI and any inbound social-platform webhooks. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `APP_*`/`DB_*`/`MAIL_*` values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `explicit_secret_values` | `{}` | Raw sensitive values written directly into Secret Manager during deployment. |
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

### Group 9 — NFS Instance & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md). |

### Group 10 — Cloud Armor, CDN & Image Retention

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
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "storage" }]` | The auto-provisioned bucket plus any additional buckets. |
| `enable_nfs` | `true` | On by default for shared media/uploads, and doubles as the default Redis host source. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `Mixpost_Common`; not overridable to another engine. |
| `application_database_name` | `mixpost` | Database name. Immutable after first deploy. |
| `application_database_user` | `mixpost` | Application database user; password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not wired to Mixpost's own scheduler — use this or an external Cloud Scheduler job if externalising `schedule:run` under the cold-start default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP `/` port 80, 90s delay, `failure_threshold=36` | Startup probe overridden in `main.tf` to TCP. |
| `liveness_probe` | HTTP `/`, 120s delay, `failure_threshold=3` | Liveness probe; Mixpost/nginx answers `/` with `200`. |
| `startup_probe_config` | HTTP `/`, 90s delay | Alternative structured probe (config-object default; superseded by the `startup_probe` override above for the actual Cloud Run revision). |
| `health_check_config` | HTTP `/`, 120s delay | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Wires `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` to `redis`; falls back to `sync`/`file` when disabled. |
| `redis_host` | `""` | Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Group 23 — Mixpost Application Settings

| Variable | Default | Description |
|---|---|---|
| `mixpost_admin_email` | `admin@example.com` | Declared for wiring; **not currently injected** into the running config — the image seeds its own default admin account regardless. |
| `mail_from_name` | `Mixpost` | Sender display name on outgoing emails (`MAIL_FROM_NAME`). |
| `mail_from_address` | `mixpost@example.com` | Sender address on outgoing emails (`MAIL_FROM_ADDRESS`); `MAIL_MAILER = "smtp"` is set automatically. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixed) | Critical | Not overridable to another engine; `Mixpost_Common` hardcodes MySQL regardless of this variable's face value. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating the Laravel key invalidates encrypted session/cookie data and any encrypted database fields. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `cpu_always_allocated` / `min_instance_count` | `true` + `>=1` if using scheduled posting | High | Leaving the cold-start default (`false` / `0`) means the Laravel scheduler and queue worker only run while an instance happens to be warm — scheduled social posts silently stop publishing on a schedule unless externalised via Cloud Scheduler. |
| `enable_redis` + `redis_host` / `enable_nfs` | `true` + NFS on, or an explicit `redis_host` | High | Enabling Redis with no host source (no `redis_host`, no NFS) leaves the Redis connection blank and the app fails to queue/cache/session correctly. |
| `enable_cloudsql_volume` | Match the app's DB connection expectations | High | This module defaults it `false` (TCP/private-IP); if `db-init` or the app cannot reach the DB, verify whether a socket (`true`) or TCP path is actually being used at the deployed revision. |
| `memory_limit` | `2Gi` | High | Mixpost requires at least 2Gi for media processing and queue workers; lower values risk OOM kills under concurrent load. |
| `mixpost_admin_email` | Retrieve real credentials post-deploy | Medium | The variable is not injected into the running config; the image seeds its own default admin account regardless — change the password immediately after first login. |
| `min_instance_count` | `0` for cost, `1`+ for latency/scheduling | Medium | Scale-to-zero (`0`) adds cold-start delay on the first request after idle, in addition to the scheduling trade-off above. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The admin UI and login are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Mixpost-specific application configuration
(the `APP_KEY` secret, the `db-init` script, and the environment variables
merged into the container) is shared with the GKE variant via the internal
`Mixpost_Common` module, which is not deployed directly and does not yet have
its own configuration guide.
