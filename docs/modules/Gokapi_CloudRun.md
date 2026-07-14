---
title: "Gokapi on Google Cloud Run"
description: "Configuration reference for deploying Gokapi on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Gokapi on Google Cloud Run

Gokapi is a lightweight, self-hosted file-sharing server written in Go — a
self-hosted alternative to WeTransfer. Users upload files and generate shareable
download links with optional expiry dates, download-count limits, and password
protection, all backed by an internal SQLite database (no external database
required). This module deploys Gokapi on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Gokapi uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common
to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Gokapi runs as a single Go binary container on Cloud Run v2, with no external
database. The deployment wires together a small, focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go binary container on port `53842`, `1000m` CPU / `1Gi` memory by default; single revision, `min_instance_count = 1` / `max_instance_count = 1` |
| Database | **None (SQLite, on mounted storage)** | No Cloud SQL — `database_type` is fixed to `NONE` by `Gokapi_Common`; Gokapi writes its own SQLite DB under `GOKAPI_CONFIG_DIR` |
| File & DB persistence | Cloud Storage bucket mounted via **GCS Fuse** at `/data` | The only persistence path available on Cloud Run — there is no PVC/block-storage concept here, unlike the StatefulSet PVC used by `Gokapi_GKE` |
| Object storage | Cloud Storage | The `storage`-suffixed bucket is auto-provisioned and, on Cloud Run, is always mounted (not idle, unlike the GKE variant) |
| Secrets | Secret Manager | Only an **optional** operator API key (`GOKAPI_API_KEY`); no mandatory generated secret |
| Ingress | Cloud Run URL / Cloud Load Balancing | `ingress_settings = "all"` by default, so the service is publicly reachable out of the box |

**Sensible defaults worth knowing up front:**

- **No Cloud SQL, ever.** `database_type` is hard-fixed to `NONE` by
  `Gokapi_Common` — the generic database variables in this module
  (`sql_instance_name`, `application_database_name`, `db_*_env_var_name`, etc.)
  are forwarded to the foundation only for variable-mirroring compatibility and
  have no effect.
- **SQLite + uploaded files persist via a GCS Fuse mount, not a real block
  volume.** Cloud Run has no PVC/StatefulSet equivalent, so `Gokapi_Common`
  mounts the auto-provisioned `storage` bucket at `/data` using GCS Fuse
  (`enable_gcs_storage_volume` defaults `true` inside `Gokapi_Common`, and this
  Cloud Run variant exposes **no variable to turn it off** — that toggle only
  exists on `Gokapi_GKE`, tied to `stateful_pvc_enabled`). `GOKAPI_CONFIG_DIR =
  /data/config` (config + the SQLite database) and `GOKAPI_DATA_DIR = /data/data`
  (uploaded files) both live on this mount. GCS Fuse does not provide real POSIX
  file locking, which is exactly the semantics a SQLite-backed app depends on —
  see [Section 6](#6-configuration-pitfalls--sensible-defaults) for the risk this
  carries.
- **The `storage` GCS bucket is essential here, not decorative.** Unlike
  `Gokapi_GKE` (where the bucket sits unused behind a default StatefulSet PVC),
  on Cloud Run this bucket **is** the persistence layer for both the SQLite
  database and every uploaded file.
- **Single instance by design.** `min_instance_count = 1`, `max_instance_count =
  1`. Gokapi's SQLite database is single-writer with no clustering/replication
  story, so do not scale beyond 1 instance.
- **No admin password is auto-generated.** Gokapi has no mandatory secret — the
  administrator account is created interactively through Gokapi's own first-run
  setup wizard, the first time anyone opens the service in a browser.
- **Optional operator API key.** `enable_api_key` (default `false`) generates a
  32-character random token, stores it in Secret Manager, and injects it as
  `GOKAPI_API_KEY` via the module's `module_secret_env_vars` mechanism. This is a
  convenience token only — Gokapi's own upload/download API keys are normally
  minted from the admin UI after setup.
- **Redis is force-disabled.** `main.tf` hardcodes `enable_redis = false` to the
  foundation regardless of any variable value — Gokapi has no use for Redis.
- **Public ingress is on by default.** `ingress_settings = "all"` matches
  Gokapi's purpose of generating shareable download links reachable from outside
  the VPC — but it also means the unauthenticated first-run setup wizard is
  publicly reachable until an administrator account is claimed.
- **Built as a thin custom image, pinned against the `latest`-tag trap.** The
  image is a one-line `FROM f0rc3/gokapi:${GOKAPI_VERSION}` wrapper so the
  foundation can mirror it into Artifact Registry. `GOKAPI_VERSION` (an
  app-specific build arg the Foundation's generic `APP_VERSION` injection does
  not touch) resolves to a pinned `v1.9.6` when `application_version = "latest"`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Gokapi service

Gokapi runs as a single Cloud Run v2 service/revision. `min_instance_count = 1`
keeps one instance warm at all times (avoiding cold starts and preserving the
single SQLite writer); `max_instance_count = 1` must not be raised.

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

### B. Persistent storage — the GCS Fuse mount at `/data`

There is no Cloud SQL instance and no PVC. Instead, the auto-provisioned `storage`
Cloud Storage bucket is mounted into the container as a GCS Fuse volume at `/data`,
and both `GOKAPI_CONFIG_DIR=/data/config` (SQLite metadata DB + app config) and
`GOKAPI_DATA_DIR=/data/data` (uploaded files) live under that single mount. This
mount is unconditional on this module — there is no variable here to disable it
(compare `Gokapi_GKE`, which turns the equivalent GCS volume off whenever its
StatefulSet PVC is enabled).

- **Console:** Cloud Storage → Buckets, for the bucket contents; Cloud Run →
  service → Revisions → **Volumes**, to confirm the mount.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount semantics and its stated
performance caveat for database-like workloads, and
[Section 6](#6-configuration-pitfalls--sensible-defaults) below for why this
matters specifically for Gokapi's SQLite database.

### C. Secret Manager — the optional API key

Gokapi creates **no mandatory secret**. The only secret this module can create is
the optional `GOKAPI_API_KEY` operator convenience token, gated by `enable_api_key`
(default `false`). This secret is **not** surfaced in this module's
[Outputs](#5-outputs) — look it up directly by name.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for secret injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`), matching Gokapi's purpose of generating externally shareable download
links. An external HTTPS load balancer with Cloud Armor, a custom domain, and Cloud
CDN can be layered on via the Group 10 variables.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies (both disabled by default).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Gokapi Application Behaviour

- **No initialization job runs by default.** `Gokapi_Common` supplies no default
  `initialization_jobs` entry — Gokapi manages its own storage and needs no
  database to bootstrap. Only user-supplied jobs (custom data loading or
  migration) appear under Cloud Run Jobs.
- **First-boot setup is entirely interactive.** There is no auto-install flag and
  no generated admin password. The first time anyone opens the service's public
  URL, Gokapi's own setup wizard creates the administrator account — whoever gets
  there first.
- **Where data physically persists.** `GOKAPI_CONFIG_DIR=/data/config` (the
  SQLite metadata DB and app config) and `GOKAPI_DATA_DIR=/data/data` (uploaded
  files) both sit on the GCS Fuse mount of the `storage` bucket at `/data`. There
  is no built-in switch to move this to NFS or a different backend; doing so
  would require manually overriding `environment_variables` and enabling
  `enable_nfs`.
- **Single-writer, single instance.** `min_instance_count = 1` /
  `max_instance_count = 1` by default. Gokapi's SQLite database has no
  clustering/replication story, so do not raise `max_instance_count` above 1.
- **Health probes hit the public root, no auth required.** Both the startup probe
  and the liveness probe are **HTTP GET `/`** (Gokapi's login/setup page, 200,
  unauthenticated) — startup: `initial_delay=15s, timeout=5s, period=10s,
  failure_threshold=10`; liveness: `initial_delay=30s, timeout=5s, period=30s,
  failure_threshold=3`.
- **Container port is functionally fixed at `53842`, even though the variable is
  forwarded.** Unlike `Gokapi_GKE` (where the equivalent `container_port`
  variable is declared but never forwarded), this Cloud Run variant's `gokapi.tf`
  merges `container_port = var.container_port` into the per-app configuration
  that reaches the foundation — so the value is technically live here. However,
  Gokapi's own listen port is separately hardcoded as `GOKAPI_PORT = "53842"` in
  `Gokapi_Common`'s `environment_variables`, so changing `container_port` away
  from `53842` would route Cloud Run traffic to a port the container isn't
  actually listening on. Leave it at the default.
- **Inspect the deployed service and its persistent state:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Gokapi are listed; every other input is
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
| `application_name` | `gokapi` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Gokapi File Sharing` | Human-readable name shown in the Console. |
| `description` | `Gokapi self-hosted file sharing` | Service description. |
| `application_version` | `latest` | Gokapi image tag; resolves to a pinned `v1.9.6` when `latest` via the app-specific `GOKAPI_VERSION` build arg. |
| `enable_api_key` | `false` | Generates a random operator API key in Secret Manager, injected as `GOKAPI_API_KEY`. A convenience token only — Gokapi mints its own real API keys from the admin UI. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. Gokapi is a lightweight Go binary and needs little. |
| `memory_limit` | `1Gi` | Memory per instance. |
| `min_instance_count` | `1` | Kept at 1 to avoid cold starts and keep a single warm SQLite writer. |
| `max_instance_count` | `1` | **Keep at 1** — Gokapi's SQLite DB is single-writer with no distributed mode. |
| `container_port` | `53842` | Forwarded into the module's per-app config (unlike `Gokapi_GKE`, where it's inert) — but must match `GOKAPI_PORT`, which is hardcoded `53842` in `Gokapi_Common`. Do not change. |
| `execution_environment` | `gen2` | Gen2 required for the GCS Fuse mount. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Must remain `false` — Gokapi has no Cloud SQL database; `main.tf` hardcodes this regardless of the variable's value. |
| `enable_image_mirroring` | `true` | Mirror the Gokapi image into Artifact Registry. |
| `container_protocol` | `http1` | Standard HTTP/1.1; Gokapi has no gRPC/HTTP2 requirement. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default, matching Gokapi's purpose of generating shareable download links. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. Blocks anonymous recipients from following shared download links. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `GOKAPI_CONFIG_DIR`, `GOKAPI_DATA_DIR`, and `GOKAPI_PORT` are set automatically — do not override these. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

Standard `App_CloudRun` backup/import job variables (`backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`) are declared and forwarded, but **inert for Gokapi** — the
foundation's backup and import machinery only operates when `database_type` is
not `NONE`, and Gokapi's is fixed to `NONE`. There is no automated backup of the
SQLite DB or uploaded files; back up the `storage` GCS bucket directly if needed.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts (inert) & NFS Instance Discovery

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off / `""` | Inert — Gokapi has no SQL database to run scripts against. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM to use instead of auto-discovery. Only relevant if you manually re-point Gokapi's storage at NFS (see Group 11). |
| `nfs_instance_base_name` | `app-nfs` | Base name for an inline NFS GCE VM, if one is created. |
| `nfs_volume_name` | `nfs-data-volume` | Cloud Run volume name for the NFS mount. |

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage, Filesystem & Redis

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisions the `storage` bucket that backs `/data`. Leaving this `false` would break Gokapi's only persistence path. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `false` | Off by default. Enabling it provisions Filestore/an NFS VM but does **not** automatically move Gokapi's data there — `GOKAPI_CONFIG_DIR`/`GOKAPI_DATA_DIR` still point at `/data` (the GCS Fuse mount) unless you override them yourself. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container if NFS is enabled — distinct from `/data`. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts; the `storage` bucket's `/data` mount is always added on top of this list. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `enable_redis` | `true` (variable default) | **Inert** — `main.tf` hardcodes `enable_redis = false` to the foundation regardless of this variable's value. Gokapi has no use for Redis. |
| `redis_host` / `redis_port` / `redis_auth` | — | Declared for convention mirroring only; never forwarded to the foundation. |

### Group 12 — Database Backend

All Group 12 variables (`database_type`, `sql_instance_name`,
`application_database_name`, `application_database_user`,
`db_*_env_var_name`, `enable_postgres_extensions`, `enable_mysql_plugins`, etc.)
are declared for convention-mirroring compatibility only. `database_type` is
fixed to `NONE` inside `Gokapi_Common`, and none of the sibling database
variables are forwarded to the foundation by `main.tf` — Gokapi has no SQL
database.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job is injected; only use this for custom data-loading or migration jobs. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs; Gokapi has no built-in scheduled maintenance task. |
| `backup_file` | `backup.sql` | Inert — see Group 7; no database to restore into. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , 15s delay, 10 retries | Startup probe — Gokapi's public login/setup page, no auth. |
| `liveness_probe` | HTTP `/` , 30s delay, 3 retries | Liveness probe. |
| `startup_probe_config` | HTTP `/` (alternative form) | Alternative structured probe. |
| `health_check_config` | HTTP `/` (alternative form) | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 15 — Networking

| Variable | Default | Description |
|---|---|---|
| `network_name` | `""` | Declared for convention mirroring; not forwarded by `main.tf` — the VPC network is always auto-discovered. |

### Group 23 — VPC Service Controls & Audit Logging

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
| `gokapi_url` | The Cloud Run service URL (named `gokapi_url`, not the generic `service_url` used by other modules). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets — includes the `storage` bucket mounted at `/data`. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any user-supplied setup jobs (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

Note the absence of any `database_*` output (there is no database) and of a
secret-id output for the optional API key — retrieve that one directly with
`gcloud secrets list --filter="name~api-key"` (see [Section 2C](#c-secret-manager--the-optional-api-key)).

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with GCS Fuse mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| GCS Fuse mount at `/data` (unconditional, no toggle on this module) | Accept it for light use; move to `Gokapi_GKE` for heavier workloads | Critical | GCS Fuse does not provide real POSIX file locking, which SQLite depends on for safe concurrent access. There is no way to swap this module to a genuine block volume — the toggle only exists on `Gokapi_GKE`'s StatefulSet PVC. |
| `ingress_settings` | `all` (default) with prompt admin claim | High | Because the admin account is created via an open, unauthenticated first-run wizard, a public URL means **anyone** who reaches it first claims the administrator account. Claim it immediately after deploy, or set `enable_iap = true` until you have. |
| `max_instance_count` | `1` | Critical | Gokapi's SQLite database is single-writer with no clustering; running >1 instance risks database corruption and inconsistent uploads. |
| `container_port` | `53842` (leave default) | High | `GOKAPI_PORT` is hardcoded to `53842` in `Gokapi_Common`'s environment variables independently of this variable; changing `container_port` routes Cloud Run traffic to a port the container isn't listening on. |
| `create_cloud_storage` | `true` | Critical | Setting `false` removes Gokapi's only persistence bucket — the SQLite DB and every upload live there. |
| `enable_api_key` (auto-generated secret) | Leave `false` unless you need a pre-provisioned key | Low | The token is a convenience only; Gokapi's real upload/download API keys are minted from the admin UI regardless of this setting. |
| `enable_nfs` | `false` unless you also repoint `GOKAPI_CONFIG_DIR`/`GOKAPI_DATA_DIR` | Medium | Enabling NFS alone provisions an unused Filestore/NFS VM — Gokapi's data still lives at `/data` on GCS Fuse unless you manually override the environment variables to use the NFS mount path instead. |
| `enable_backup_import` / `backup_schedule` / etc. | Leave at defaults | Low | These variables are inert for Gokapi (`database_type = NONE`); no automated backup of the SQLite DB or uploads exists. Back up the `storage` bucket directly if you need one. |
| `min_instance_count` | `1` (default) | Low | Keeping 1 instance warm avoids cold starts on shared download links; this is cheap for a lightweight Go binary. |
| `enable_cloud_armor` | enable for production | Medium | A publicly reachable file-sharing app with unauthenticated upload/admin surfaces benefits from WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. The Gokapi-specific application configuration
shared with the GKE variant (image, storage bucket, optional API key, health
probes) lives in the `Gokapi_Common` module (`modules/Gokapi_Common`), which has
no standalone platform doc yet — see its `main.tf`/`variables.tf`/`README.md` for
the underlying wiring.
