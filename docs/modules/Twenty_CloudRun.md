---
title: "Twenty CRM on Google Cloud Run"
---

# Twenty CRM on Google Cloud Run

Twenty is an open-source CRM with 25,000+ GitHub stars, built as a modern,
developer-friendly alternative to Salesforce and HubSpot. This module deploys
Twenty on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation,
which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Twenty uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Twenty runs as a Node.js container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Twenty does not support MySQL |
| Object storage | Cloud Storage | Optional; a dedicated bucket when `enable_gcs_storage = true` |
| Background jobs | Redis (optional) | bull-mq when enabled; pg-boss (PostgreSQL-backed) by default with no extra infra |
| Secrets | Secret Manager | Auto-generated app secret (`APP_SECRET` / `ENCRYPTION_KEY`) and database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Selecting MySQL or `NONE` breaks startup.
- **Redis is enabled by default.** Twenty v0.4+ hardcodes Redis for session and cache
  storage — without a valid Redis connection Twenty fails to start. When `redis_host`
  is left empty, the platform NFS VM IP is used (requires `enable_nfs = true` or an
  explicit `redis_host`).
- **pg-boss is the job queue when Redis is disabled.** It requires no additional
  infrastructure and uses the PostgreSQL database directly.
- **File attachments default to ephemeral local storage.** Enable `enable_gcs_storage`
  for persistent object storage using GCS.
- **Two init jobs run before the server starts.** `db-init` creates the database and
  user; `twenty-migrate` runs TypeORM schema migrations. Database migrations are
  disabled in the main container (`DISABLE_DB_MIGRATIONS=true`) to keep cold starts
  fast after the first boot.
- **`SERVER_URL` and `FRONT_BASE_URL` must be set manually.** Without them, API links,
  CORS, and email invitations are broken.
- The **APP_SECRET / ENCRYPTION_KEY** is generated automatically and stored in Secret
  Manager; you never set it in plain text.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Twenty service

Twenty runs as a Cloud Run v2 service that autoscales by request load between the
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

Twenty stores all application data (contacts, pipelines, custom objects) in a managed
Cloud SQL for PostgreSQL 15 instance. The service connects privately through the
**Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy two
initialization Jobs run: `db-init` creates the database and user, and `twenty-migrate`
runs schema migrations using Twenty's own entrypoint.

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

### C. Cloud Storage (optional file storage)

When `enable_gcs_storage = true`, a dedicated **Cloud Storage** bucket is provisioned
and Twenty is configured to use the GCS S3-compatible API (`STORAGE_TYPE=s3`). Without
it, file attachments are stored in the container's ephemeral filesystem and are lost
on new revision deployments.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Note: when `enable_gcs_storage = true`, you must supply GCS HMAC keys via
`secret_environment_variables` (`STORAGE_S3_ACCESS_KEY_ID` and
`STORAGE_S3_SECRET_ACCESS_KEY`). Generate them in the Console under Cloud Storage →
Settings → Interoperability.

### D. Redis (background jobs)

Redis backs Twenty's session and cache storage in v0.4+ and, when enabled, switches
background processing to **bull-mq**. Without Redis, Twenty uses **pg-boss** (a
PostgreSQL-backed job queue) with no additional infrastructure. When `redis_host` is
empty and `enable_nfs = true`, the NFS VM IP is used as the Redis host.

When `enable_redis = true`, a dedicated worker Cloud Run service must be deployed via
`additional_services` to consume the bull-mq queue.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Twenty app secret (`APP_SECRET` / `ENCRYPTION_KEY`) and the database password are
stored in Secret Manager and injected into the service at runtime; plaintext never
appears in configuration.

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

## 3. Twenty Application Behaviour

- **First-deploy database setup.** Two initialization Jobs run sequentially before the
  service starts:
  1. `db-init` — connects to Cloud SQL via the Auth Proxy Unix socket, creates the
     PostgreSQL database and user, grants privileges, and installs the `uuid-ossp`
     extension. It is idempotent and safe to re-run.
  2. `twenty-migrate` — runs Twenty's own entrypoint (`twenty-entrypoint.sh`) with
     `DISABLE_DB_MIGRATIONS=false`, executing TypeORM schema migrations and registering
     background cron jobs.
  Inspect them after deploy:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Migrations disabled on normal boot.** The main container runs with
  `DISABLE_DB_MIGRATIONS=true` so migrations only run via the `twenty-migrate` job.
  This reduces cold-start time from several minutes to seconds on subsequent boots.
- **Background jobs.** When Redis is disabled (pg-boss mode), background jobs — email
  sending, webhook delivery, data sync — are processed by the main service. When Redis
  is enabled (bull-mq mode), a separate worker service must be deployed via
  `additional_services` pointing to the same image with the worker command.
  Inspect jobs:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Health path.** The startup probe polls `/healthz` with a 120-second initial delay
  and up to 40 failures (~10 minutes) to accommodate first-boot migrations. The
  liveness probe polls `/healthz` with a 30-second initial delay.
- **`SERVER_URL` is required.** Without it, Twenty generates broken API links, CORS
  errors occur on all API calls, and email invitations fail. Set it via
  `environment_variables`:
  ```bash
  environment_variables = {
    SERVER_URL     = "https://crm.example.com"
    FRONT_BASE_URL = "https://crm.example.com"
  }
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Twenty are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `twenty` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Twenty CRM` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Twenty image version tag. **Pin to a specific version for production** (e.g., `0.50.0`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. 2 vCPU recommended for production. |
| `memory_limit` | `2Gi` | Memory per instance. Raise to `4Gi` for large datasets. |
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid cold-start on webhook/job workloads. |
| `max_instance_count` | `3` | Maximum instances. |
| `container_port` | `3000` | Twenty listens on port 3000. Do not change unless using a custom image. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. |
| `execution_environment` | `gen2` | Gen2 required for VPC networking. |
| `container_image_source` | `custom` | `custom` (Cloud Build) or `prebuilt` (existing image URI). |
| `enable_image_mirroring` | `true` | Mirror the Twenty image into Artifact Registry. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Useful for internal CRM access. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `ingress_settings` | `all` | Which networks may reach the service (all / internal / LB-only). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text settings. **Set `SERVER_URL` and `FRONT_BASE_URL` here.** |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `STORAGE_S3_ACCESS_KEY_ID` and `STORAGE_S3_SECRET_ACCESS_KEY` when GCS storage is enabled. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting the service. |

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

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. Must match `SERVER_URL`. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provision a GCS bucket for persistent file storage using the S3-compatible API. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. |
| `enable_nfs` | `false` | NFS (Filestore) volume. Not required for Twenty; enable only when using NFS IP as the Redis host. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Options: `POSTGRES_15`, `POSTGRES_14`, `POSTGRES_13`. |
| `db_name` | `twenty` | Database name. Immutable after first deploy. |
| `db_user` | `twenty` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Optional additional env var names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` and `twenty-migrate` jobs. |
| `cron_jobs` | `[]` | Additional recurring Cloud Run jobs triggered by Cloud Scheduler. |
| `additional_services` | `[]` | Additional Cloud Run services. Required for a dedicated bull-mq worker when `enable_redis = true`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/healthz`, 120s delay, 40 failures | Probes `/healthz`; allows up to ~10 minutes for first-boot migrations. |
| `liveness_probe` / `health_check_config` | HTTP `/healthz`, 30s delay | Liveness probe. |
| `uptime_check_config` | enabled, path `/healthz` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enable Redis. Required for Twenty v0.4+; disabling forces pg-boss. |
| `redis_host` | `""` | Redis endpoint. When empty, the NFS VM IP is used (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires explicit `organization_id`). |
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
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SERVER_URL` / `FRONT_BASE_URL` (in `environment_variables`) | public URL of deployment | Critical | API links are broken, CORS errors block all requests, email invitations fail. Set before first use. |
| `database_type` | `POSTGRES_15` | Critical | Twenty requires PostgreSQL; MySQL or `NONE` breaks schema migrations and startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_cloudsql_volume` | `true` | Critical | Twenty connects via the Auth Proxy Unix socket; disabling removes the socket and breaks all DB connections. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job; re-enabling on a live deployment overwrites data. |
| `APP_SECRET` / `ENCRYPTION_KEY` (auto-generated) | do not rotate manually | Critical | Rotating the secret invalidates all active JWT sessions, immediately logging out every user. |
| `enable_redis` | `true` (required in v0.4+) | High | Without Redis, Twenty v0.4+ fails to start; session and cache storage are hardcoded to Redis. |
| `redis_host` | explicit host or `enable_nfs = true` | High | When `enable_redis = true` and `redis_host` is empty with no NFS VM, the Redis URL is empty and Twenty fails to connect. |
| `additional_services` (worker) | configured when using Redis | High | When `enable_redis = true`, bull-mq is active but no worker processes the queue; background jobs (email, webhooks) never run. |
| `enable_gcs_storage` | `true` for production | High | Without GCS storage, file attachments are stored in ephemeral container storage and lost on new revision deployment. |
| `STORAGE_S3_ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | via `secret_environment_variables` | High | When GCS storage is enabled, HMAC keys are not auto-generated; all file operations fail without them. |
| `memory_limit` | `2Gi` | High | Below 1 GiB the Node.js process is OOM-killed under load. |
| `application_version` | pinned version (e.g., `0.50.0`) | High | `latest` resolves to a different image on each Cloud Build run, making rollbacks unpredictable. |
| `container_port` | `3000` | High | Twenty's server listens on port 3000; any other value causes health checks to fail permanently. |
| `startup_probe` | HTTP `/healthz`, generous timeout | High | Too short a window causes the service to be killed during first-boot migrations (which take 8–10 minutes on a fresh schema). |
| `min_instance_count` | `1` | Medium | `0` adds cold-start latency and risks missing incoming webhooks while the instance scales up. |
| `enable_iap` / `enable_cloud_armor` | enable for non-public deployments | Medium | The CRM interface is otherwise publicly reachable. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Medium | When Memorystore Redis is used, its private IP may require `ALL_TRAFFIC` for routing. |
| `organization_id` | set explicitly for VPC-SC | Medium | VPC-SC perimeter is not activated without this — `enable_vpc_sc = true` has no effect. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Twenty-
specific application configuration shared with the GKE variant is described in
**[Twenty_Common](Twenty_Common.md)**.
