---
title: "Flarum on Google Cloud Run"
description: "Configuration reference for deploying Flarum on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Flarum on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flarum_CloudRun.png" alt="Flarum on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flarum is a free, open-source forum and discussion platform — a modern,
extensible alternative to traditional bulletin-board software, built on PHP
with a JavaScript/Mithril front end and a REST API. This module deploys
Flarum on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud
infrastructure.

This guide focuses on the cloud services Flarum uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Flarum runs as a single nginx + php-fpm container built from the
`mondedie/flarum` community image. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | nginx/php-fpm container on port 8888, 1 vCPU / 2 GiB by default; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0` by `Flarum_Common` |
| File persistence | Cloud Filestore (NFS) | Enabled by default; uploaded avatars/attachments persist under `/flarum/app/public/assets` |
| Object storage | Cloud Storage | A `flarum-assets` bucket (from `Flarum_Common`) plus a default `data` bucket are provisioned; neither is mounted by default |
| Secrets | Secret Manager | Auto-generated `FLARUM_ADMIN_PASS`; database password managed separately |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** `Flarum_Common` hardcodes `database_type =
  "MYSQL_8_0"` in its output config; the variant's `database_type` variable
  only takes effect if explicitly overridden away from its `MYSQL_8_0`
  default.
- **Cloud SQL is reached via direct private-IP TCP by default, NOT the Auth
  Proxy socket.** `enable_cloudsql_volume` defaults to `false` on this
  variant (it overrides `Flarum_Common`'s own `true` default), so
  `DB_HOST` resolves to the Cloud SQL instance's private IP and the mondedie
  entrypoint connects over TCP through VPC egress. This is the opposite of
  the [Flarum_GKE](Flarum_GKE.md) variant, which always uses a
  cloud-sql-proxy sidecar on loopback. Set `enable_cloudsql_volume = true` to
  switch to the Unix-socket connection instead.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`), unlike
  the GKE variant which defaults to `min_instance_count = 1`. Cold starts add
  latency to the first request after idle; set `min_instance_count = 1` for
  an always-reachable forum.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at
  `/flarum/app/public/assets`) so user avatars and attachments persist and
  are shared across instances.
- **`FORUM_URL` is auto-wired on Cloud Run — unlike the GKE variant.**
  `main.tf` computes the deterministic predicted `run.app` service URL and
  passes it into `Flarum_Common` as `service_url`, which sets `FORUM_URL`
  automatically. If you front the service with a custom domain or the
  external HTTPS load balancer, override `FORUM_URL` via
  `environment_variables` to match the actual public hostname.
- **`FLARUM_ADMIN_PASS` is generated automatically** and stored in Secret
  Manager. The admin username and email are **fixed by `Flarum_Common`'s
  defaults** (`admin` / `admin@techequity.cloud`) — they are not exposed as
  Application Module variables on this variant, so retrieve the generated
  password before first login rather than expecting to configure the
  username/email.
- **`php_memory_limit`, `upload_max_filesize`, and `post_max_size` have no
  effect.** These three variables are declared and forwarded to
  `Flarum_Common`, but `Flarum_Common`'s configuration never references
  them — they are inert leftovers from the WordPress-derived template this
  module was cloned from. Changing them changes nothing in the deployed
  container.
- **The image is a thin custom build, not a prebuilt image.**
  `container_image_source = "custom"` builds `FROM mondedie/flarum` via
  Cloud Build, re-tagging the base image through the app-specific
  `FLARUM_VERSION` build ARG (because the Foundation's own `APP_VERSION`
  build arg would otherwise win the merge and force a moving tag).
  `application_version = "latest"` maps to the image's own
  production-recommended `stable` tag.
- **No separate migration job.** The `mondedie/flarum` image's own
  s6-overlay entrypoint runs the Flarum installer on first container start,
  once the `db-init` job has created the database and user.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource
names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Flarum service

Flarum runs as a Cloud Run v2 service that autoscales by request load
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

Flarum stores all forum data (discussions, posts, users, tags) in a managed
Cloud SQL for MySQL 8.0 instance, with tables prefixed `flarum_`. By
default (`enable_cloudsql_volume = false`) the service connects over
**direct private-IP TCP** through VPC egress; setting
`enable_cloudsql_volume = true` instead mounts the **Cloud SQL Auth Proxy**
as a Unix socket volume. On first deploy an initialization Job creates the
application database and user; the Flarum installer then creates the schema
on first container boot.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage & Filestore (NFS)

A **Cloud Storage** `flarum-assets` bucket (from `Flarum_Common`) and a
default `data` bucket (from the `storage_buckets` variable) are provisioned
automatically, but neither is mounted into the container by default — add an
entry to `gcs_volumes` if you want to use one as a filesystem mount.
Separately, Flarum's uploaded avatars and attachments live on **Cloud
Filestore (NFS)** at `/flarum/app/public/assets`, mounted because
`enable_nfs = true` by default.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~flarum"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, CMEK options, and NFS
discovery behaviour.

### D. Secret Manager

One Flarum-specific secret is generated automatically and stored in Secret
Manager: `FLARUM_ADMIN_PASS` (the first-run administrator password,
24 characters). The admin username and email are fixed at `admin` /
`admin@techequity.cloud` and are not stored as secrets. The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~flarum AND name~admin-pass"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Redis (optional)

Redis is **disabled by default** (`enable_redis = false`). When enabled
without an explicit `redis_host`, the Foundation injects the shared NFS
server VM's IP as `REDIS_HOST` (requires `enable_nfs = true` or a
discoverable Services_GCP-managed NFS server) — this Foundation-level
injection always wins over `Flarum_Common`'s own placeholder value, so a
working Redis endpoint reaches the container either way.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the resolved host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Networking & ingress

The service is reachable at its `run.app` URL by default
(`ingress_settings = "all"`). An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow
to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Flarum Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs
  `db-init.sh` using `mysql:8.0-debian`. It locates the Cloud SQL Auth Proxy
  Unix socket under `/cloudsql` (waiting up to 30 s when
  `enable_cloudsql_volume = true`) or falls back to the instance private IP
  over TCP, idempotently creates the application database and user, grants
  privileges, verifies the app user can connect (warming MySQL 8's
  `caching_sha2_password` server-side cache), and gracefully shuts down the
  Auth Proxy sidecar. The job is safe to re-run.
- **No separate migration job.** The `mondedie/flarum` image's own
  s6-overlay entrypoint runs the Flarum installer automatically on first
  container start, creating the schema (with the `flarum_` table prefix)
  once `db-init` has provisioned the database and user. The custom
  Dockerfile is an unmodified thin wrapper over the base image — it neither
  overrides `ENTRYPOINT` nor adds a migrate step.
- **Admin account.** The installer creates a first-run administrator whose
  username is `admin` and email is `admin@techequity.cloud` (fixed
  `Flarum_Common` defaults, not exposed as module variables) and whose
  password is the generated `FLARUM_ADMIN_PASS` secret. This is generated
  once and never rotated by the module — changing the secret after install
  does **not** change the admin login (change it from the Flarum admin UI
  instead).
- **DB env-var wiring.** `Flarum_CloudRun`'s `main.tf` sets
  `db_user_env_var_name = "DB_USER"`, `db_password_env_var_name = "DB_PASS"`,
  and `db_name_env_var_name = "DB_NAME"` on the Foundation call — the exact
  env names the mondedie/flarum installer expects — so no alias entrypoint
  is needed. `Flarum_Common` additionally sets `DB_PORT = "3306"` and
  `DB_PREF = "flarum_"` directly in `environment_variables`.
- **`FORUM_URL` is set automatically** from the predicted `run.app` service
  URL. If you add a custom domain or load balancer in front of the service,
  update `FORUM_URL` via `environment_variables` to the actual public
  hostname, or absolute links, asset URLs, and redirects will point at the
  wrong host.
- **Registration/sign-up.** Flarum's own public registration setting is an
  in-app admin preference (Admin → Basics), not something this module
  toggles — review it after first login if you want to restrict who can
  create forum accounts.
- **Health path.** The application-specific `startup_probe` defaults to a
  **TCP** check on the container port (8888) with a generous
  `failure_threshold = 20` at `period_seconds = 15` (five minutes of grace)
  to accommodate the first-boot installer. The `liveness_probe` defaults to
  **HTTP** `GET /` — Flarum's unauthenticated public forum home page — with
  an `initial_delay_seconds = 300` (five minutes) before the first check.
- **Redis (optional).** `enable_redis` defaults to `false`. When enabled
  without an explicit `redis_host`, the Foundation requires `enable_nfs =
  true` or a discoverable NFS server (plan-time validation on
  `App_CloudRun`) — otherwise the apply fails with a clear error rather than
  deploying a forum that can't reach Redis.
- **Inspect job execution and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform.
Only settings specific to or notable for Flarum are listed; every other
input is inherited from [App_CloudRun](App_CloudRun.md) with its standard
behaviour and defaults.

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
| `application_name` | `flarum` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Flarum` | Human-readable name shown in the Console. |
| `description` | `Flarum wiki on Cloud Run` | Service description text. Cosmetic only — despite the wording, Flarum is a forum, not a wiki; this has no functional effect. |
| `application_version` | `latest` | Maps to the `mondedie/flarum` `stable` tag via the `FLARUM_VERSION` build ARG; any other value is used verbatim. |
| `php_memory_limit` | `512M` | **Inert** — declared and forwarded to `Flarum_Common`, but never consumed. Has no effect on the deployed container. |
| `upload_max_filesize` | `64M` | **Inert** — same as above. |
| `post_max_size` | `64M` | **Inert** — same as above. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Thin build `FROM mondedie/flarum`. Keep `custom` — `prebuilt` bypasses the `FLARUM_VERSION` build-arg mechanism entirely. |
| `container_image` | `""` | Leave empty; `Flarum_Common` supplies the built image. |
| `cpu_limit` | `1000m` | 1 vCPU for nginx + php-fpm. |
| `memory_limit` | `2Gi` | Minimum ~512Mi enforced by the gen2 execution-environment floor. |
| `min_instance_count` | `0` | Scale-to-zero by default — differs from the GKE variant's `min=1`. |
| `max_instance_count` | `1` | Keep at `1` unless multi-instance NFS/DB sharing is verified. |
| `container_port` | `8888` | mondedie/flarum serves nginx + php-fpm on 8888. |
| `execution_environment` | `gen2` | Required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | **Cloud-Run-specific override** of `Flarum_Common`'s own `true` default — Flarum connects via direct private-IP TCP unless you flip this to `true` for the Auth Proxy Unix-socket volume. |
| `enable_image_mirroring` | `true` | Mirror the mondedie/flarum base image into Artifact Registry for Cloud Build. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `container_protocol` | `http1` | `h2c` available if the app supports HTTP/2 cleartext. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access for the forum. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC — sufficient for the default private-IP TCP DB connection. |
| `enable_iap` | `false` | Require Google sign-in. Blocks anonymous/public forum access. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, e.g. an overridden `FORUM_URL`. Do not set `DB_HOST`/`DB_PORT`/`DB_PREF`/`FLARUM_ADMIN_*` here — they are managed by the module. |
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
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & NFS Instance Targeting

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a
GCS bucket after provisioning. `nfs_instance_name` / `nfs_instance_base_name`
let you target or name an existing NFS GCE VM instead of relying on
auto-discovery. See [App_CloudRun](App_CloudRun.md).

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
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS bucket — created alongside (not instead of) `Flarum_Common`'s `flarum-assets` bucket. |
| `enable_nfs` | `true` | NFS is on by default so uploaded avatars/attachments persist and are shared. |
| `nfs_mount_path` | `/flarum/app/public/assets` | Where Flarum stores user-uploaded assets. |
| `gcs_volumes` | `[]` | No bucket is mounted into the container by default; add an entry to actually use `flarum-assets` or `data` as a filesystem mount. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `Flarum_Common`; only matters if explicitly overridden. |
| `db_name` | `flarum` | Database name. Immutable after first deploy. |
| `db_user` | `flarum` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off / `90` | DB password rotation. |

Several Foundation-mirror variables in this group (`application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`, `sql_instance_name`,
`sql_instance_base_name`, `enable_mysql_plugins`, `mysql_plugins`,
`enable_postgres_extensions`, `postgres_extensions`) are declared for
convention parity but not forwarded by `main.tf` — the actual `DB_USER` /
`DB_NAME` / `DB_PASS` env-var names the mondedie image expects are hardcoded
directly, not sourced from these variables.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Forwarded to the Foundation — define recurring Cloud Scheduler-triggered jobs here if needed. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP on port 8888, 30s initial delay, 20×15s window | Startup probe. Generous grace window for the first-boot installer. |
| `liveness_probe` | HTTP `/` , 300s initial delay | Liveness probe — five-minute delay to avoid killing the container mid-install. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default, enable explicitly to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 15 — Networking

`network_name` is declared for convention parity but not forwarded by
`main.tf` — the VPC network is always auto-discovered.

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional Redis object cache backend. |
| `redis_host` | `""` | Leave empty to use the shared NFS server's IP (requires `enable_nfs = true` or a discoverable NFS server). |
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
| `storage_buckets` | Created Cloud Storage buckets (`flarum-assets` and `data`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, `enable_redis = true` with an empty `redis_host` and no discoverable NFS server, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Selecting a non-MySQL engine breaks the installer and every query. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `container_image_source` | `custom` | Critical | Switching to `prebuilt` bypasses the `FLARUM_VERSION` build-arg mechanism this module relies on to pin the mondedie base-image tag. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `FORUM_URL` (auto-injected) | Actual public URL | High | If you add a custom domain or load balancer, an unmatched `FORUM_URL` breaks absolute links, asset URLs, and redirects. |
| `enable_cloudsql_volume` | `false` (TCP) or `true` (socket) — pick one deliberately | High | Left at its default with restrictive `vpc_egress_setting`/firewall changes, direct private-IP TCP to Cloud SQL can be blocked; switching to `true` requires the socket path to actually mount. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded avatars/attachments ephemeral — lost on container restart or scale-to-zero. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified shared-storage/lock behaviour risks split sessions and NFS/DB lock contention. |
| `enable_iap` | only when public access not needed | High | IAP blocks all unauthenticated requests, including anonymous forum visitors. |
| `FLARUM_ADMIN_PASS` (auto-generated) | Retrieve before first login | Medium | Not knowing it locks you out of the first administrator account until reset via the database. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | N/A | Medium | These variables are inert — changing them does not change PHP behaviour or upload limits in the deployed container. |
| `gcs_volumes` (empty by default) | Add an entry to actually use a bucket | Medium | The `flarum-assets` and `data` buckets are billed and created but do nothing unless explicitly mounted. |
| `min_instance_count` | `1` for an always-reachable forum | Medium | Scale-to-zero (`0`, the default) adds cold-start delay on the first request after idle. |
| `memory_limit` | `2Gi` | Medium | Undersizing PHP-FPM under load risks OOM kills. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Flarum-specific application configuration
shared with the GKE variant — the admin credential, database bootstrap, container
image build, core settings, and health probe defaults — is described in
**[Flarum_Common](Flarum_Common.md)**.
