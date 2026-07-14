---
title: "PhotoPrism on Google Cloud Run"
description: "Configuration reference for deploying PhotoPrism on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# PhotoPrism on Google Cloud Run

PhotoPrism is a self-hosted, AI-powered photo and video management application: it
browses, organizes, and shares a personal media library with automatic tagging,
facial recognition, and full-text/visual search, all served from a single Go binary
with an embedded SQLite database — no external database engine, no separate worker
process. This module deploys PhotoPrism on **Cloud Run v2** in **embedded-SQLite,
GCS-backed** mode on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services PhotoPrism uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

PhotoPrism runs as a single Go binary container on Cloud Run v2, pinned to exactly
one instance. The deployment wires together a deliberately small set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go binary container on port 2342, 1 vCPU / 1 GiB by default; **single instance always** (`min=1`, `max=1`) — no scale-to-zero, no horizontal scaling |
| Database | None | Embedded SQLite (`PHOTOPRISM_DATABASE_DRIVER=sqlite`) — no Cloud SQL instance is provisioned by default |
| Persistent storage | Cloud Storage (GCS FUSE) | The **only** persistence layer on this variant — the entire `/photoprism` data directory (SQLite DB, cache, originals, imports) is mounted from a single GCS bucket via GCS FUSE |
| Secrets | Secret Manager | Auto-generated `PHOTOPRISM_ADMIN_PASSWORD` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (`ingress_settings = "all"`); optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database is ever provisioned by default.** `database_type` defaults to
  `"NONE"` and `enable_cloudsql_volume` is hardcoded `false` in `main.tf` — PhotoPrism
  manages its own SQLite file under `/photoprism/storage`. Unlike the GKE variant
  (which hardcodes `database_type = "NONE"` unconditionally), **this Cloud Run
  module still forwards `var.database_type` to the foundation** — see the pitfall
  in §6 if you change it away from `NONE`.
- **GCS FUSE is the only persistence mechanism — there is no block-PVC option on
  Cloud Run.** The module's own description states it plainly: *"This module
  deploys PhotoPrism on Cloud Run in embedded SQLite mode with a GCS-backed data
  volume. For production media libraries requiring a durable block volume, use
  PhotoPrism_GKE (block PVC)."* gcsfuse's write/consistency model is weaker than a
  real block device for SQLite's WAL/journal files; the single-instance pin (below)
  is what keeps this safe rather than any locking guarantee from gcsfuse itself.
- **Single instance, always.** `min_instance_count = 1` and `max_instance_count = 1`
  are both defaulted and described as fixed — PhotoPrism serves one shared SQLite
  library from one writable volume; running two instances against the same
  gcsfuse-mounted bucket risks database and index corruption.
- **Redis is forced off, regardless of the variable.** The App_CloudRun foundation
  default for `enable_redis` is `true`, but `main.tf` hardcodes
  `enable_redis = false` unconditionally — PhotoPrism has no Redis integration and
  no `REDIS_HOST`/`REDIS_PORT` is ever injected.
- **Admin password is auto-generated.** A 24-character password (no special
  characters) is created and stored in Secret Manager, then injected as the
  `PHOTOPRISM_ADMIN_PASSWORD` secret env var; the username is the plain
  `admin_username` variable (default `admin`).
- **Custom image build is a thin mirror, not app logic.** The build wraps the
  upstream `photoprism/photoprism` image (`FROM photoprism/photoprism:${PHOTOPRISM_VERSION}`)
  so the foundation can mirror it into Artifact Registry; the app-specific build ARG
  is `PHOTOPRISM_VERSION` (not the generic `APP_VERSION`), pinned to `240915` when
  `application_version = "latest"`.
- **`gen2` execution environment is mandatory.** GCS FUSE volumes require
  `execution_environment = "gen2"` (the default); switching to `gen1` breaks the
  storage mount entirely.
- **Health path.** Both startup and liveness probes target the unauthenticated
  `GET /api/v1/status` endpoint.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the PhotoPrism service (single instance)

PhotoPrism runs as a Cloud Run v2 service pinned to exactly one instance
(`min_instance_count = max_instance_count = 1`) — there is no autoscaling range to
tune. Each deployment creates an immutable revision; traffic can still be split
across revisions for staged rollouts, but running two revisions serving live
traffic simultaneously risks two writers against the same gcsfuse-mounted SQLite
file.

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

### B. Cloud Storage — the GCS FUSE persistent volume

A dedicated **Cloud Storage** bucket (`storage_buckets` name suffix `storage`) is
provisioned automatically and mounted into the container as a **GCS FUSE** volume at
`/photoprism` (`gcs_volumes` entry `name = "storage"`, `mount_path = "/photoprism"`,
not read-only). This single mount covers everything PhotoPrism persists:
`/photoprism/storage` (SQLite database + thumbnail cache), `/photoprism/originals`
(imported/indexed media), and `/photoprism/import` (staged imports). Additional
buckets can be declared via `storage_buckets`; additional GCS FUSE mounts via
`gcs_volumes`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/photoprism/originals/   # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount options and CMEK.

### C. Secret Manager

One secret is generated automatically: the PhotoPrism admin password
(`secret-<prefix>-photoprism-admin-password`), a 24-character random string with no
special characters, injected as `PHOTOPRISM_ADMIN_PASSWORD`. There is no database
password to manage since no Cloud SQL instance exists by default.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`), which allows direct access to the web UI. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings
and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with an optional uptime check (disabled by default) and custom alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. PhotoPrism Application Behaviour

- **No init/db-create job by default.** `initialization_jobs` defaults to `[]` —
  there is no external database to bootstrap. PhotoPrism creates and migrates its
  own SQLite schema on first boot, directly on the gcsfuse-mounted volume.
- **Storage layout.** All state lives under the single mounted directory
  `/photoprism`: `PHOTOPRISM_STORAGE_PATH=/photoprism/storage` (SQLite database +
  cache), `PHOTOPRISM_ORIGINALS_PATH=/photoprism/originals` (imported/indexed
  media), `PHOTOPRISM_IMPORT_PATH=/photoprism/import` (staged imports).
- **Admin account.** `PHOTOPRISM_ADMIN_USER` is the plain `admin_username` variable
  (default `admin`); `PHOTOPRISM_ADMIN_PASSWORD` is the auto-generated Secret
  Manager value, injected as a secret env var. `PHOTOPRISM_AUTH_MODE = "password"`
  is set explicitly. Retrieve the password from Secret Manager before first login.
- **Site URL.** `PHOTOPRISM_SITE_URL` is empty by default — PhotoPrism tolerates
  this and falls back to the request host, but set `site_url` to the deployed
  Cloud Run URL for correctly generated absolute links and thumbnail URLs.
- **Health path.** Startup and liveness probes both target `GET /api/v1/status`, an
  unauthenticated endpoint that returns 200 once the HTTP server is up and the
  SQLite index is ready. The startup probe allows roughly 15s + 10×10s (~1 minute
  55 seconds) after the initial delay for first-boot schema creation and index
  warm-up; the liveness probe re-checks every 30 seconds with a 3-failure
  threshold.
- **No horizontal scaling, no queue coordination.** Because the entire application
  state — SQLite database, index, thumbnail cache, and originals — lives on one
  writable gcsfuse volume, PhotoPrism must run as a single instance
  (`min_instance_count = max_instance_count = 1`); there is no multi-writer
  support.
- **Inspect the running configuration and storage:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep PHOTOPRISM_
  gcloud run jobs list --project "$PROJECT" --region "$REGION"   # empty unless custom jobs were added
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for PhotoPrism are listed; every other input is
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
| `application_name` | `photoprism` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `PhotoPrism` | Human-readable name shown in the Console. |
| `description` | `PhotoPrism — AI-powered photo management app` | Service description. |
| `application_version` | `latest` | `photoprism/photoprism` image tag used as the custom-build base; `latest` is pinned to a known-good tag (`240915`) at build time. |
| `admin_username` | `admin` | Initial admin account username (`PHOTOPRISM_ADMIN_USER`); the password is generated separately. |
| `site_url` | `""` | Public site URL (`PHOTOPRISM_SITE_URL`). Empty falls back to the request host; set once the Cloud Run URL is known for correct absolute links. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | "PhotoPrism loads vector indexes into memory; size this based on your collections." `PhotoPrism_Common`'s own baseline default is `4Gi` for indexing/face-recognition workloads — raise for real libraries. |
| `min_instance_count` | `1` | Fixed at 1 to avoid cold starts during index loading. |
| `max_instance_count` | `1` | **Keep at 1** — a single PhotoPrism instance for data consistency. |
| `container_port` | `2342` | PhotoPrism's HTTP server port. |
| `execution_environment` | `gen2` | **Required** — GCS FUSE volumes only work under gen2. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Also hardcoded `false` in `main.tf` regardless of this variable — PhotoPrism has no Cloud SQL. |
| `container_protocol` | `http1` | HTTP/1.1 is sufficient; PhotoPrism does not require `h2c`. |
| `enable_image_mirroring` | `true` | Mirror the built `photoprism/photoprism`-based image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows direct access to the web UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the UI. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. additional `PHOTOPRISM_*` tuning). Do not set `PHOTOPRISM_ADMIN_PASSWORD` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` | `false` | Restore from a backup on deploy. |
| `backup_source` | `gcs` | `gcs` or `gdrive`. |
| `backup_uri` | `""` | Backup location; only used when `enable_backup_import = true`. |
| `backup_format` | `tar` | Since PhotoPrism has no SQL database, a backup restore is a filesystem archive of the media/library bucket, not a DB dump — keep this file-archive-oriented (`tar`/`zip`/etc.), not `sql`. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — NFS Instance & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Not applicable — PhotoPrism has no SQL database. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | _(empty)_ | Not applicable to PhotoPrism. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Optional pre-existing/inline NFS VM discovery. Forwarded but unused by default — PhotoPrism relies on the GCS FUSE volume, not NFS, for persistence (`enable_nfs = false`). |

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend — caution with cached photo/media responses if enabled. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage, Filesystem & Redis

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the auto-provisioned `storage` bucket plus any in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned PhotoPrism data bucket. |
| `enable_nfs` | `false` | Off by default and not needed — the GCS FUSE volume is PhotoPrism's primary store on this variant. |
| `nfs_mount_path` | `/mnt/nfs` | Inert unless `enable_nfs = true`. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts; the PhotoPrism `storage` volume at `/photoprism` is auto-added by `PhotoPrism_Common`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `enable_redis` | `true` (variable default) → **forced `false`** | `main.tf` hardcodes `enable_redis = false` regardless of this value — PhotoPrism has no Redis integration. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Inert — never injected since Redis is forced off. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | No SQL database is used by PhotoPrism. Unlike the GKE variant, **this value is still forwarded to the foundation** — see the pitfall in §6 before changing it. |
| `database_password_length` | `32` | Inert — no database password is ever generated while `database_type = NONE`. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No built-in init job — PhotoPrism bootstraps its own SQLite schema. Add custom jobs only for bespoke data-loading/maintenance tasks. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default (e.g. could add one for periodic library snapshots). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/status`, 15s delay, 10s period, 10-failure threshold | Primary startup probe (~1m55s window after the delay). |
| `liveness_probe` | HTTP `/api/v1/status`, 30s delay, 30s period, 3-failure threshold | Primary liveness probe. |
| `startup_probe_config` | `enabled = true`, path `/api/v1/status` | Alternative structured startup probe surface. <!-- TODO: verify precedence against `startup_probe` if both are set to conflicting values — unlike some sibling modules this alternative surface defaults `enabled = true` here, not disabled. --> |
| `health_check_config` | `enabled = true`, path `/api/v1/status` | Alternative structured liveness probe surface (same precedence caveat as above). |
| `uptime_check_config` | `{ enabled = false, path = "/api/v1/status" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `organization_id` | `""` | Override for folder-nested projects. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `photoprism_url` | The Cloud Run service URL. The output's own description calls it an "internal VPC URL … only reachable within the same VPC when ingress_settings is 'internal'" — but `ingress_settings` defaults to `all` (public); verify the deployed service's actual reachability against your own `ingress_settings` value rather than assuming from the output name. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets, including the PhotoPrism `storage` GCS FUSE bucket. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any custom initialization jobs (empty by default). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

Note there are no `database_*` outputs — no Cloud SQL instance is provisioned by
default (unlike Activepieces/BookStack-style modules).

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with GCS Fuse mounts, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` / `min_instance_count` | `1` / `1` | Critical | Scaling beyond 1 gives two instances a single writable gcsfuse-mounted SQLite database — corruption/lock contention risk, worse than a block PVC since gcsfuse's consistency model is weaker. |
| `execution_environment` | `gen2` | Critical | `gen1` cannot mount GCS FUSE volumes — the entire `/photoprism` data directory (DB, media) fails to attach and the app cannot start. |
| `database_type` | `NONE` | Medium | Unlike `PhotoPrism_GKE` (which hardcodes `NONE`), this module still forwards the variable to the foundation. Setting it to `MYSQL`/`POSTGRES` provisions a real, billed Cloud SQL instance that `PhotoPrism_Common` never wires into the app (no `DB_HOST`/`DB_USER` are consumed) — wasted cost with no functional benefit. |
| `enable_redis` | Forced `false` in `main.tf` | Low | No action needed — the override is intentional and cannot be defeated by setting the variable `true`. |
| `enable_cloudsql_volume` | `false` (default and hardcoded) | Low | Cannot be enabled even by setting the variable — informational only. |
| `memory_limit` | `1Gi` default — raise for real libraries | High | `PhotoPrism_Common`'s own baseline is `4Gi` for indexing/face-recognition workloads; 1Gi risks OOM kills once a library has meaningful photo/video volume. |
| `PHOTOPRISM_ADMIN_PASSWORD` (auto-generated) | Retrieve before first login | Medium | Not knowing it locks you out of the first admin account until reset via the database. |
| `site_url` | Set to the deployed Cloud Run URL once known | Medium | Left empty, PhotoPrism falls back to the request host; absolute links/thumbnail URLs can be wrong behind a load balancer or custom domain. |
| `ingress_settings` | `all` for direct web-UI access | Medium | Setting to `internal` blocks browser access to the UI unless reached through a VPC-connected client or an internal load balancer. |
| `backup_format` | A file-archive format (`tar`, `zip`, …), not `sql` | Medium | PhotoPrism has no SQL database — a `backup_uri` pointing at a DB dump is meaningless for this app; backups should target the media/library bucket contents. |
| `enable_nfs` | `false` | Low | Correct default — PhotoPrism does not need NFS since the GCS FUSE volume is its primary store; enabling it adds cost with no benefit unless custom jobs need shared filesystem access. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The public web UI and admin login are reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. PhotoPrism-specific application configuration
shared with the GKE variant — the admin credential, the embedded-SQLite database
engine, the storage layout, the container build, and the default health
probes — is described in **[PhotoPrism_Common](PhotoPrism_Common.md)**.
