---
title: "Apache Superset on Google Cloud Run"
description: "Configuration reference for deploying Apache Superset on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Apache Superset on Google Cloud Run

Apache Superset is an open-source data exploration and visualisation platform trusted
by organisations worldwide. This module deploys Superset on **Cloud Run v2** on top
of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Superset uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Superset runs as a Python/Gunicorn container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python/Gunicorn service, 2 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — stores dashboards, charts, datasets, and user settings |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Cache & async queries | Redis | Disabled by default; strongly recommended for production multi-user deployments |
| Secrets | Secret Manager | Auto-generated `SUPERSET_SECRET_KEY` and database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** Superset uses it as its metadata database for all
  dashboards, charts, datasets, and role definitions. MySQL is not supported.
- **`SUPERSET_SECRET_KEY` is auto-generated.** A 50-character random key is generated
  and stored in Secret Manager. It signs Flask sessions — rotating it invalidates all
  active user sessions. Treat it as immutable after the first deploy.
- **Two-phase initialisation runs automatically.** A `db-init` job creates the
  PostgreSQL database and user; then an `app-init` job runs schema migrations and
  creates the admin user. Both run on every deploy but are idempotent.
- **Redis is disabled by default.** Without Redis, Celery workers have no broker;
  async query execution and dashboard caching are unavailable. Enable for production.
- The health probe targets **`/health`** — Superset's Gunicorn readiness endpoint.
- **`gen2` execution environment is used.** Required for full Linux compatibility
  and, when NFS is enabled, NFS volume mounts.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Superset service

Superset runs as a Cloud Run v2 service that autoscales by request load between the
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

Superset stores all metadata in a managed Cloud SQL for PostgreSQL 15 instance. The
service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket
(no public IP). On first deploy the `db-init` job creates the application database
and user, and the `app-init` job applies the schema migrations.

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

### C. Cloud Storage

A dedicated **Cloud Storage** bucket is provisioned automatically for Superset data
exports, chart outputs, and report files. The service account is granted access
automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mounts and CMEK.

### D. Redis cache and async query engine

Redis serves as Superset's caching backend and Celery broker. When enabled, it powers
async SQL execution, dashboard cache warming, and scheduled reports. Without Redis,
all queries run synchronously and block Gunicorn workers.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The `SUPERSET_SECRET_KEY` and the database password are stored in Secret Manager and
injected into the service at runtime.

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
Monitoring. An uptime check against `/health` is enabled by default. Optional alert
policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Superset Application Behaviour

- **First-deploy database setup.** The `db-init` job creates the Superset database
  and user idempotently before the service starts. It runs with `postgres:15-alpine`
  and shuts down the Cloud SQL Auth Proxy sidecar via `quitquitquit` on completion.
- **Schema migrations on every deploy.** The `app-init` job runs `superset db upgrade`
  on each deploy, applying any pending schema changes. It then runs
  `superset fab create-admin` to create or update the admin user, and `superset init`
  to load default roles and permissions. The `app-init` job depends on `db-init`
  completing successfully.
- **Startup sequence.** The `app-init` job has a 30-minute timeout to accommodate slow
  first-run migrations. The HTTP startup probe (60 s initial delay, 12 failure
  thresholds) gives the Gunicorn worker pool up to 180 seconds to come up.
- **Flask secret key.** `SUPERSET_SECRET_KEY` signs Flask sessions and encrypts
  database connection credentials stored in Superset's metadata. Changing it after
  the first deploy invalidates all sessions and makes stored credentials unreadable.
  The key is auto-generated as a 50-character random string in Secret Manager.
- **Async queries and scheduled reports.** Superset's Celery workers use Redis as the
  broker and result backend. Without Redis, async queries and scheduled reports are
  unavailable. Configure `enable_redis = true` and supply `redis_host` for production.
- **Health path.** Readiness/liveness probes target `/health`, which returns HTTP 200
  when the Gunicorn worker pool is ready.
- **Inspect running jobs:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Superset are listed; every other input is
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
| `application_name` | `superset` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Apache Superset` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Service description. |
| `application_version` | `latest` | Superset image version tag; pin to a specific release for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per instance; 2 vCPU / 2 GiB minimum for Superset. |
| `container_port` | `8088` | Superset/Gunicorn listens on port 8088. |
| `container_image_source` | `custom` | `custom` builds the bundled Dockerfile (required for psycopg2); `prebuilt` uses an existing image. |
| `execution_environment` | `gen2` | Cloud Run generation; gen2 required for NFS mounts and improved networking. |
| `min_instance_count` | `1` | Minimum instances; keep ≥ 1 to avoid cold-start delays (~30–60 s for Superset). |
| `max_instance_count` | `5` | Maximum instances (cost ceiling). |
| `timeout_seconds` | `600` | Request timeout; extended for long-running SQL queries. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `ingress_settings` | `all` | Which networks may reach the service (all / internal / LB-only). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `SUPERSET_SECRET_KEY` is injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
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
`enable_binary_authorization`.

### Group 9 — Custom SQL & NFS

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. Superset does not require NFS. |

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
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. |
| `enable_nfs` | `false` | Shared Filestore volume. Superset does not require NFS. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Superset requires PostgreSQL. |
| `application_database_name` | `superset_db` | Database name. Immutable after first deploy. |
| `application_database_user` | `superset_user` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(set)_ | Names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in two-phase db-init + app-init pipeline. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler — useful for cache warmup or report generation. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, 60 s delay, 12 failures | Allows up to 180 s for the Gunicorn worker pool to initialise. |
| `liveness_probe` / `health_check_config` | HTTP `/health`, 30 s delay | Liveness probe. |
| `uptime_check_config` | enabled, `/health` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for Celery and caching. **Strongly recommended for production.** |
| `redis_host` | `""` | Redis hostname or IP. Required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port (number in the Cloud Run variant). |
| `redis_auth` | `""` | Optional Redis authentication password (sensitive). |

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
| `SUPERSET_SECRET_KEY` (auto-generated) | immutable after first deploy | Critical | Changing the key invalidates all active sessions and makes stored database connection credentials permanently unreadable. |
| `database_type` | `POSTGRES_15` | Critical | Superset requires PostgreSQL; changing breaks startup. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling removes the Auth Proxy sidecar; all PostgreSQL connections fail. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all dashboards and metadata. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` | `true` for production | High | Without Redis, Celery workers have no broker; async queries and scheduled reports are unavailable. |
| `redis_host` | set explicitly | High | Required when `enable_redis = true`; empty causes Celery workers to fail on startup. |
| `container_resources.memory_limit` | `2Gi` minimum | High | Under 1 GiB Gunicorn workers are OOM-killed during query execution. |
| `container_resources.cpu_limit` | `2000m` | High | Under 1000m the app-init migration job may time out in its 30-minute window. |
| `min_instance_count` | `1` | High | `0` adds cold-start latency and risks missed async work; Superset takes 30–60 s to start. |
| `startup_probe.failure_threshold` | `12` or higher | High | Reducing too far causes Cloud Run to kill the container before Superset finishes database migrations. |
| `application_version` | pin to a specific release | Medium | `latest` triggers uncontrolled upgrades that may introduce breaking API changes. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | Without them, the Superset login form is publicly reachable. |
| `timeout_seconds` | `600` | Medium | Reducing below 120 s causes long-running analytical queries to be aborted mid-execution. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Superset-specific application configuration shared
with the GKE variant is described in **[Superset_Common](Superset_Common.md)**.
