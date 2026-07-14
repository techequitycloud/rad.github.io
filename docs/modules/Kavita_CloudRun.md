---
title: "Kavita on Google Cloud Run"
description: "Configuration reference for deploying Kavita on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Kavita on Google Cloud Run

Kavita is a fast, self-hosted digital library and reading server for comics,
manga, and e-books — a clean web reading UI, OPDS feeds, collections, reading
lists, and full-text search over your library, built on .NET with an internal
SQLite database. This module deploys Kavita on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Kavita uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Kavita runs as a single .NET container on Cloud Run v2 with **no external
database or cache** — everything it needs (settings, its internal SQLite
database, and the library index) lives on disk under `/kavita/config`.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | .NET web container on port 5000, `1000m` CPU / `1Gi` memory by default; `min=1`/`max=1` |
| Database | **None** — internal SQLite | `database_type` is fixed to `NONE` by `Kavita_Common`; no Cloud SQL instance is created |
| State persistence | Cloud Storage bucket mounted via **GCS Fuse** | `/kavita/config` holds the SQLite database (`kavita.db`), settings, covers, and logs — this is Cloud Run's **only** persistence option (no block PVC) |
| Object storage | Cloud Storage | A `storage` bucket is auto-provisioned and mounted at `/kavita/config` |
| Secrets | Secret Manager | **None generated** — the first-run setup wizard creates the admin account; `secret_ids`/`secret_values` are empty |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **SQLite has no choice but to live on GCS Fuse here.** Cloud Run has no block
  Persistent Volume option, so `/kavita/config` (Kavita's SQLite database and
  settings) is always mounted through gcsfuse. This is the one place in this
  module where the repository's usual "gcsfuse corrupts SQLite" caution is
  unavoidable rather than a misconfiguration — the module's own description
  recommends [Kavita_GKE](Kavita_GKE.md) for production libraries, where the same
  data instead lives on a real block PVC. Treat `Kavita_CloudRun` as best suited
  to light-to-medium libraries.
- **`min_instance_count` defaults to `1`, not `0`.** Unlike most Cloud Run
  application modules (which default to scale-to-zero), Kavita keeps one instance
  always warm by default, avoiding cold-start delays while it reloads its library
  index and re-mounts the gcsfuse volume.
- **`max_instance_count` is pinned to `1`.** Kavita has no clustering or
  shared-write coordination; a second instance writing to the same gcsfuse-mounted
  SQLite file risks corrupting the library index.
- **No database, no Redis.** `database_type` is fixed to `NONE`, and Redis is
  forced off: `main.tf` hardcodes `enable_redis = false` regardless of the
  variable's own inherited foundation default (`true`) — Kavita has no use for a
  queue or cache.
- **No auto-generated secrets.** There is no admin password, API key, or signing
  key created in Secret Manager. The administrator account is created
  interactively through Kavita's first-run setup wizard the first time you open
  the service URL.
- **Custom-built image, pinned version tag.** The Dockerfile thin-wraps
  `jvmilazz0/kavita:${KAVITA_VERSION}`. `application_version = "latest"` resolves
  to a pinned `KAVITA_VERSION = 0.8.7` build argument in `Kavita_Common` (not the
  generic `APP_VERSION` the Foundation injects) — bumping the version requires
  editing that pinned value and rebuilding, not just redeploying.
- **Health path is `/api/health`, unauthenticated, for both probes.** The startup
  probe allows a generous failure budget to tolerate first-boot library indexing.
- **Only Kavita's state directory is persisted by this module.** The actual
  library content (comics, manga, e-books) is not provisioned here — add your own
  `gcs_volumes` (or NFS) for the content and register it as a library inside the
  Kavita UI after deploy.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Kavita service

Kavita runs as a single Cloud Run v2 service. Because it is a single-writer
SQLite app backed by a gcsfuse-mounted volume, do not raise `max_instance_count`
above 1.

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

### B. Cloud Storage — the GCS Fuse–mounted config/library-state bucket

`Kavita_Common` provisions a single Cloud Storage bucket (suffix `storage`) and
this module mounts it at `/kavita/config` via GCS Fuse. It holds Kavita's SQLite
database (`kavita.db`), cover images, bookmarks, backups, and logs — effectively
all of Kavita's durable state. Additional buckets can be declared via
`storage_buckets`, and additional read-only content mounts via `gcs_volumes`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~kavita"
  gcloud storage ls gs://<config-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount options and CMEK.

### C. Secret Manager

Kavita has **no generated secrets** — no admin password, API key, or signing key
is created by this module. Kavita's own JWT signing key (`TokenKey`) is
auto-generated by the application on first boot and persisted on the
gcsfuse-mounted `/kavita/config` volume, not in Secret Manager. Any secrets you
add yourself via `secret_environment_variables` flow through Secret Manager like
any other application module.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kavita"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`), which allows browsers, mobile reader apps, and OPDS clients to reach it
directly. An external HTTPS load balancer with a custom domain, Cloud CDN, and
Cloud Armor can be layered on; ingress settings and VPC egress control
connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Kavita Application Behaviour

- **No first-deploy database setup.** Kavita has no `db-init` job — there is no
  external database to bootstrap. `initialization_jobs` defaults to an empty
  list; only custom jobs you supply are run.
- **No migration step.** Kavita creates and migrates its own internal SQLite
  schema on first boot; upgrading `application_version` (and rebuilding) applies
  schema changes automatically without a separate migration job.
- **No immutable, auto-generated secrets.** Unlike most application modules,
  there is no encryption key, admin token, or JWT secret minted into Secret
  Manager. Kavita's own JWT `TokenKey` is generated internally on first boot and
  persisted on the `/kavita/config` volume — nothing to rotate or lose track of
  at the Terraform layer.
- **Health path.** Both the startup and liveness probes target the public,
  unauthenticated **`/api/health`** endpoint. The startup probe uses a longer
  failure budget (`initial_delay_seconds = 15`, `period_seconds = 10`,
  `failure_threshold = 10`) to tolerate slower first-boot library indexing before
  the liveness probe (`initial_delay_seconds = 30`, `period_seconds = 30`,
  `failure_threshold = 3`) takes over.
- **Sign-up / first-run behaviour.** There is no seeded admin account or
  generated credential. Open the service URL — Kavita's first-run setup wizard
  walks through creating the initial administrator account and adding your first
  library. Complete this promptly after deploy: until it runs, the service is
  reachable but unclaimed.
- **Redis is force-disabled.** `main.tf` sets `enable_redis = false`
  unconditionally when calling `App_CloudRun`, overriding the foundation's own
  `enable_redis = true` default — no `REDIS_HOST`/`REDIS_PORT` are ever injected,
  and the `redis_host`/`redis_port`/`redis_auth` variables have no effect.
- **`enable_cloudsql_volume` is fixed off.** `main.tf` passes
  `enable_cloudsql_volume = false` directly to the foundation regardless of the
  variable (whose own default is also `false`) — Kavita has no Cloud SQL Auth
  Proxy sidecar.
- **Custom image build.** The container is built from a thin wrapper Dockerfile
  (`FROM jvmilazz0/kavita:${KAVITA_VERSION}`); `application_version = "latest"`
  resolves to the pinned `KAVITA_VERSION = 0.8.7` build argument (a version bump
  requires editing the pinned value in `Kavita_Common`, then a rebuild — see the
  repository's "latest-tag base images" convention).
- **Inspect the service and its mounted state:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Kavita are listed; every other input is
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
| `application_name` | `kavita` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Kavita` | Human-readable name shown in the Console. |
| `description` | `Kavita — self-hosted comics, manga and ebook server (.NET, SQLite)` | Service description. |
| `application_version` | `latest` | Kavita image tag; `latest` resolves to the pinned `KAVITA_VERSION = 0.8.7` build arg in `Kavita_Common`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; Kavita is a lightweight .NET server. |
| `memory_limit` | `1Gi` | Memory per instance; comfortable for large libraries. |
| `min_instance_count` | `1` | Kept at 1 by default to avoid cold starts during library index loading — most Cloud Run modules default to `0`. |
| `max_instance_count` | `1` | **Keep at 1.** No clustering — a second instance writing the same gcsfuse-mounted SQLite file risks corruption. |
| `container_port` | `5000` | Kavita's fixed HTTP port. |
| `execution_environment` | `gen2` | Required for the GCS Fuse mount. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Kavita has no Cloud SQL; also hardcoded `false` in `main.tf` regardless of this value. |
| `enable_image_mirroring` | `true` | Mirror the Kavita image into Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1 is sufficient; Kavita has no gRPC use for `h2c`. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |
| `service_annotations` / `service_labels` | `{}` | Custom annotations/labels on the Cloud Run service resource. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access for the reading UI, OPDS feeds, and reader-app clients. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **OPDS/mobile reader clients typically cannot complete IAP's auth flow.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings; Kavita needs none by default. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency — only relevant to secrets you add yourself; Kavita mints none. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore `/kavita/config` from a backup on deploy — Kavita has no separate database dump; its state is the config directory itself. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & NFS Instance Discovery

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Not applicable — Kavita has no SQL database. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | — | Not applicable. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Only relevant if you add an NFS mount for separate library content; unused by default. |

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
| `create_cloud_storage` | `true` | Creates the auto-provisioned `storage` bucket (mounted at `/kavita/config`) plus any `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned config bucket. |
| `enable_nfs` | `false` | Off by default; enable only to mount separate library content over NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path for that NFS share (distinct from `/kavita/config`). |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts — e.g. a read-only bucket of library content. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | inert | Declared only for Foundation-variable mirroring — `main.tf` hardcodes `enable_redis = false` unconditionally; Kavita never uses Redis regardless of these values. |

### Group 12 — Database Backend (not applicable)

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Kavita_Common` — Kavita stores everything in an internal SQLite file; no Cloud SQL instance is created. |
| `database_password_length` | `32` | Not referenced — Kavita has no SQL database. |

All other database-related variables in this group (`sql_instance_name`,
`application_database_name`/`_user`, `enable_mysql_plugins`,
`enable_postgres_extensions`, the `db_*_env_var_name` set,
`enable_auto_password_rotation`, etc.) are declared only for Foundation-variable
mirroring and have no effect on a Kavita deployment.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty — Kavita has no `db-init`/migration job; it manages its own SQLite schema on first boot. |
| `cron_jobs` | `[]` | Not used by default; add custom scheduled tasks (e.g. collection snapshots) if needed. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, 15s delay | Startup probe; 10-attempt failure budget tolerates first-boot library indexing. |
| `liveness_probe` | HTTP `/api/health`, 30s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | disabled alt / HTTP `/api/health` | Alternative structured probes (inactive by default; `startup_probe`/`liveness_probe` take effect). |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 15 — Networking

| Variable | Default | Description |
|---|---|---|
| `network_name` | `""` | Declared for convention mirroring; not forwarded to `App_CloudRun` by this module — the VPC network is auto-discovered instead. |

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
| `kavita_url` | Internal VPC URL for the Kavita service (port 5000); only reachable within the VPC when `ingress_settings = "internal"`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets, including the `storage` bucket mounted at `/kavita/config`. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any custom initialization jobs you supplied (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

Note there are no `database_*` outputs — Kavita provisions no Cloud SQL instance.

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with a GCS Fuse mount, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/kavita/config` on GCS Fuse | Accept for light/medium libraries only | Critical | GCS Fuse is Cloud Run's only persistence option; concurrent writes or heavy metadata scans against a gcsfuse-backed SQLite file risk corrupting the library index. For large libraries, use [Kavita_GKE](Kavita_GKE.md)'s block PVC instead. |
| `max_instance_count` | `1` | Critical | Kavita has no clustering; a second instance writing to the same gcsfuse-mounted SQLite file corrupts the library index and admin/user data. |
| Library content storage | Add `gcs_volumes` (or NFS) separate from `/kavita/config` | High | `Kavita_Common` only persists the config/SQLite state directory — without a separate mount for the actual comics/manga/e-book files, there is nowhere durable to store the library content itself. |
| `enable_iap` | `false` unless all clients support it | High | Kavita's OPDS feed and mobile reader-app clients typically cannot complete Google IAP's auth flow, so enabling IAP breaks e-reader access even though the browser UI still works via a browser challenge. |
| `ingress_settings` | `all` | High | `internal` blocks the reading UI and OPDS clients from reaching the service directly. |
| First-run admin account | Complete the setup wizard immediately after deploy | Medium | Until the wizard runs, the service is reachable but unclaimed — anyone who reaches the URL first can create the initial admin account. |
| `application_version` / `KAVITA_VERSION` | Pin explicitly for production | Medium | `"latest"` resolves to `Kavita_Common`'s pinned `KAVITA_VERSION = 0.8.7`; bumping requires editing that pinned value and rebuilding, not just redeploying. |
| `min_instance_count` | `1` (default) | Medium | Setting to `0` enables scale-to-zero but adds cold-start latency while gcsfuse re-mounts and Kavita reloads its library index. |
| `enable_redis` (inert) | leave as-is | Low | Setting this variable has no effect — `main.tf` hardcodes `enable_redis = false` regardless of the value passed. |
| `enable_cloudsql_volume` | `false` | Low | Kavita never uses Cloud SQL; the value is hardcoded `false` in `main.tf` regardless of this setting. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention; Kavita's entire state is the `/kavita/config` directory, so this is the only backup path. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Kavita's application-specific configuration
shared with the GKE variant — including why it has no generated secrets, no
database, and how the `/kavita/config` state directory is mounted differently on
each platform (GCS Fuse here vs. a block PVC on GKE) — is described in
**[Kavita_Common](Kavita_Common.md)**.
