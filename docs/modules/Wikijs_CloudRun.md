---
title: "Wiki.js on Google Cloud Run"
description: "Configuration reference for deploying Wiki.js on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Wiki.js on Google Cloud Run

Wiki.js is a powerful open-source wiki platform designed for teams that need modern,
fast knowledge management with Git-backed version control and a clean writing
experience. This module deploys Wiki.js on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Wiki.js uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Wiki.js runs as a Node.js container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Wiki.js uses PostgreSQL with the `pg_trgm` extension for full-text search |
| Shared files | Filestore (NFS) | Uploaded assets shared across all instances (mounted into the service) |
| Object storage | Cloud Storage | A dedicated `wikijs-storage` bucket, mountable via GCS Fuse at `/wiki-storage` |
| Cache (optional) | Redis | Disabled by default; enable for session caching |
| Secrets | Secret Manager | Auto-generated database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Selecting MySQL or `NONE` breaks startup. The
  `pg_trgm` extension is installed automatically and is required for Wiki.js
  full-text search.
- **Port 3000.** Wiki.js binds to port 3000 (set by `Wikijs_Common`), not the
  conventional 80 or 8080.
- **Gen2 execution environment is required** for NFS mounts. Cloud Run gen2 is the
  default.
- **Scale-to-zero by default.** `min_instance_count = 0` is the default — set to `1`
  for wikis that cannot tolerate 15–30 s cold starts.
- **Asset storage path matters.** `HA_STORAGE_PATH=/wiki-storage` tells Wiki.js where
  to write uploads. The NFS or GCS Fuse volume must be mounted at the same path.
- **The database is bootstrapped on first deploy** by a `db-init` job that creates
  the PostgreSQL user, database, and schema. The startup probe uses `/healthz` with a
  60-second initial delay to allow this.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Wiki.js service

Wiki.js runs as a Cloud Run v2 service that autoscales by request load between the
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

### B. Cloud SQL for PostgreSQL 15

Wiki.js stores all application data (pages, users, navigation, search index) in a
managed Cloud SQL for PostgreSQL 15 instance. The `pg_trgm` extension is installed
at provisioning time and powers Wiki.js's native full-text search. The service
connects privately through the **Cloud SQL Auth Proxy** over a Unix socket (no public
IP). On first deploy an initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Filestore (NFS) and Cloud Storage

Uploaded assets are written to a **Filestore (NFS)** share mounted into the service
so all instances share the same files. A dedicated **Cloud Storage** bucket
(`wikijs-storage`) is also provisioned for persistent asset storage; it can be
mounted at `/wiki-storage` via GCS Fuse.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis cache (optional)

Redis is disabled by default. When enabled, it provides session caching. Set
`enable_redis = true` and supply `redis_host` to activate.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The database password is stored in Secret Manager and injected into the service at
runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
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

## 3. Wiki.js Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) uses the
  `postgres:15-alpine` image to connect through the Cloud SQL Auth Proxy, idempotently
  create the `wikijs` database and user, and grant the required privileges. The
  `pg_trgm` PostgreSQL extension is installed as part of the `Wikijs_Common`
  configuration. The job is safe to re-run.
- **Schema migration on first start.** Wiki.js connects to PostgreSQL on startup and
  runs its own internal schema migration. The startup probe carries a 60-second
  initial delay to allow this on first boot.
- **Asset storage path.** Wiki.js writes uploaded files to the path set by
  `HA_STORAGE_PATH` (default `/wiki-storage`). To persist assets across revisions,
  configure `gcs_volumes` to mount the `wikijs-storage` bucket at `/wiki-storage`.
  The NFS mount path and this variable must resolve to the same location.
- **Health endpoint.** Both the startup and liveness probes use `/healthz`, which
  returns HTTP 200 only once Wiki.js is running and connected to PostgreSQL. Do not
  replace this with `/` — the UI path is slow and may return errors during startup.
- **Redis is optional.** Wiki.js does not require Redis for core operation. Enable it
  when you want application-level session caching.

  Inspect the jobs and their executions:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Wiki.js are listed; every other input is
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
| `application_name` | `wikijs` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Wiki.js` | Friendly name shown in the Console. |
| `application_version` | `2.5.311` | Wiki.js image version tag; increment to trigger a new revision. |
| `db_name` | `wikijs` | PostgreSQL database name. Immutable after first deploy; must match `DB_NAME`. |
| `db_user` | `wikijs` | PostgreSQL user. Immutable after first deploy; must match `DB_USER`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance (1 vCPU). |
| `memory_limit` | `2Gi` | Memory per instance; minimum `1Gi` for Node.js. |
| `min_instance_count` | `0` | Minimum instances — set `1` to eliminate cold starts. |
| `max_instance_count` | `1` | Maximum instances. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts. |
| `timeout_seconds` | `300` | Increase for large page exports or asset processing. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for Unix socket connections. |
| `enable_image_mirroring` | `true` | Mirror `requarks/wiki:2` from Docker Hub into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `ingress_settings` | `all` | Which networks may reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{ DB_TYPE="postgres", DB_PORT="5432", DB_USER="wikijs", DB_NAME="wikijs", DB_SSL="false", HA_STORAGE_PATH="/wiki-storage" }` | Pre-populated with Wiki.js DB connectivity settings. Core values — do not remove. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `DB_PASS` is wired automatically. |
| `explicit_secret_values` | `{}` | Sensitive values to store and inject as secrets. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

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
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — NFS Instance & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Wiki.js assets. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container — must align with `HA_STORAGE_PATH`. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Storage bucket / additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Wiki.js requires PostgreSQL. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(set)_ | Names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job from `Wikijs_Common`. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, 60 s initial delay | Startup probe — generous delay for first-boot DB migration. |
| `liveness_probe` | HTTP `/healthz`, 60 s initial delay | Liveness probe. |
| `uptime_check_config` | enabled, path `/` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session caching (optional for Wiki.js). |
| `redis_host` | `""` | Redis endpoint — required when `enable_redis = true`. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Wiki.js requires PostgreSQL; MySQL/`NONE` breaks startup. |
| `db_name` / `DB_NAME` | both `wikijs` | Critical | Mismatch: `db-init` creates a different database than Wiki.js connects to — crash loop. Immutable after first deploy. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling removes the Auth Proxy sidecar — all PostgreSQL connections fail. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `db_user` / `DB_USER` | both `wikijs` | High | Mismatch: grants are for one user but Wiki.js authenticates as another — auth failure. |
| `enable_nfs` | `true` | High | Without shared storage, uploads written by one instance are invisible to others. |
| `nfs_mount_path` + `HA_STORAGE_PATH` | both `/wiki-storage` | High | If mount path and `HA_STORAGE_PATH` disagree, Wiki.js writes to ephemeral disk. |
| `memory_limit` | `2Gi` | High | Below `1Gi` Wiki.js is OOM-killed on startup or under load. |
| `startup_probe.initial_delay_seconds` | `60` | High | Too low — Wiki.js is killed before first-boot schema migration completes. |
| `min_instance_count` | `1` | High | Scale-to-zero causes 15–30 s cold starts with failed in-flight requests. |
| `gcs_volumes` | mount at `/wiki-storage` | High | The `wikijs-storage` bucket is provisioned but not auto-mounted; without `gcs_volumes`, uploads go to ephemeral disk. |
| `application_version` | `2.5.311` | High | Wiki.js 2.x and 3.x have incompatible schemas. Test upgrades in staging. |
| `enable_iap` / `ingress_settings` | restrict for internal wikis | High | Default (`all`) exposes the Wiki.js login page to the public internet. |
| `enable_redis` | `false` unless needed | Low | Wiki.js does not require Redis for core operation. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Wiki.js-specific application configuration shared
with the GKE variant is described in **[Wikijs_Common](Wikijs_Common.md)**.
