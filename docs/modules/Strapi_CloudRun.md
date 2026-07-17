---
title: "Strapi on Google Cloud Run"
description: "Configuration reference for deploying Strapi on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Strapi on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Strapi_CloudRun.png" alt="Strapi on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Strapi is the leading open-source headless CMS — delivering a fully customisable
content API (REST and GraphQL) with a rich admin panel, used by enterprises and
developers worldwide for content management and API-first architectures. This module
deploys Strapi on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Strapi uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Strapi runs as a Node.js container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Strapi requires PostgreSQL |
| Shared files | Filestore (NFS) | Media uploads shared across all instances (gen2 required) |
| Object storage | Cloud Storage | A dedicated uploads bucket (`strapi-uploads` suffix) |
| Cache (optional) | Redis / Memorystore | Optional; disabled by default |
| Secrets | Secret Manager | Five auto-generated cryptographic secrets plus the database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is required.** Strapi's data layer is wired to PostgreSQL; MySQL and
  `NONE` break startup.
- **A custom container image is built via Cloud Build.** `container_image_source`
  defaults to `"custom"` — the module builds a production-ready two-stage Node.js 20
  image on every version increment.
- **Five cryptographic secrets are auto-generated.** `JWT_SECRET`, `ADMIN_JWT_SECRET`,
  `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`, and `APP_KEYS` are generated and stored in
  Secret Manager on first deploy and must never change after that.
- **NFS is enabled by default.** Strapi stores uploaded media under `/uploads`.
  Without a shared NFS volume (gen2 required), media is lost between instances.
- **Redis is disabled by default.** Enable it only when using plugins that explicitly
  require a shared cache or session store; when enabled, `redis_host` must be set.
- **Container port is 8080 on Cloud Run.** The Cloud Run module overrides Strapi
  Common's default port of 1337 to comply with Cloud Run's standard port.
- **GCS media bucket variables are auto-injected.** `GCS_BUCKET_NAME` and
  `GCS_BASE_URL` are set automatically; no manual configuration is required.
- **Scale-to-zero is the default.** `min_instance_count = 0` allows the service to
  scale to zero when idle, though this adds cold-start latency of 15–30 seconds on
  first request.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Strapi service

Strapi runs as a Cloud Run v2 service that autoscales by request load between the
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

Strapi stores all application data (content types, content, users, API tokens) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through
the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy an
initialization Cloud Run Job creates the application database and user.

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

Uploaded media is written to a **Filestore (NFS)** share mounted into the service so
all instances share the same files (gen2 execution environment required). A dedicated
**Cloud Storage** bucket (suffix `strapi-uploads`) is also provisioned and configured
as the Strapi GCS upload provider.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Secret Manager

Five Strapi cryptographic secrets are generated on first deploy and stored in Secret
Manager: `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`,
and `APP_KEYS` (four comma-joined keys). The database password is also stored here.
All secrets are injected into the service at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Redis cache (optional)

When `enable_redis = true`, Redis is used as a session store and REST API response
cache via the `strapi-plugin-redis` and `strapi-plugin-rest-cache` plugins. When
`redis_host` is left null and NFS is enabled, the NFS host IP is used as the Redis
endpoint at runtime.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

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

## 3. Strapi Application Behaviour

- **First-deploy database setup.** A `db-init` Cloud Run Job runs on every apply
  using `postgres:15-alpine`. It idempotently creates the Strapi database and user,
  grants the necessary privileges (including `CREATEDB`), and signals the Cloud SQL
  Auth Proxy to shut down cleanly. It is safe to re-run.
- **GCS media provider.** `GCS_BUCKET_NAME` and `GCS_BASE_URL` are automatically
  injected into the container. Strapi's `config/plugins.js` detects these variables
  and switches to the GCS upload provider for all media library assets.
- **Email delivery (optional).** If `SMTP_HOST` is set in `environment_variables`,
  `config/plugins.js` automatically enables the `nodemailer` email provider for
  Strapi notifications. Set `SMTP_PASSWORD` via `secret_environment_variables`.
- **Health probe.** Both startup and liveness probes target `/_health` via HTTP —
  Strapi's dedicated health endpoint that returns 200 only when the application and
  database connection are ready. The startup probe (`startup_probe` — the value
  actually applied; `startup_probe_config` is a separate, inert variable) allows up
  to ~90 seconds (60s initial delay + 3 × 10-second period) for first-boot
  initialisation.
- **Cryptographic secrets are immutable after first deploy.** All five auto-generated
  secrets sign active sessions and API tokens. Regenerating any of them immediately
  invalidates all active sessions and tokens.
- **Admin login.** There is no default admin user; Strapi's first-run wizard creates
  the initial administrator on first browser visit to the admin panel.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Strapi are listed; every other input is
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
| `application_name` | `strapi` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Strapi CMS` | Friendly name shown in the Console. |
| `application_description` | `Strapi CMS on Cloud Run` | Service description. |
| `application_version` | `5.0.0` | Image version tag; increment to trigger a new Cloud Build run. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `"custom"` triggers Cloud Build; `"prebuilt"` deploys an existing image URI. |
| `container_image` | `""` | Override image URI; leave empty for the module-built image. |
| `container_build_config` | `{ enabled = true }` | Dockerfile path, build context, and build args for Cloud Build. |
| `enable_image_mirroring` | `true` | Mirror image into Artifact Registry before deployment. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; Strapi needs headroom for Node.js and admin panel. |
| `min_instance_count` | `0` | Minimum instances (0 = scale-to-zero). Set to `1` to eliminate cold starts. |
| `max_instance_count` | `1` | Maximum instances; increase after validating NFS shared state. |
| `container_port` | `8080` | Port the Cloud Run service routes traffic to (Cloud Run default). |
| `execution_environment` | `gen2` | gen2 is required for NFS mounts. |
| `timeout_seconds` | `300` | Max request duration; increase for long media processing. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `traffic_split` | `[]` | Split traffic across revisions for canary/blue-green rollouts. |
| `max_revisions_to_retain` | `7` | How many old Cloud Run revisions to keep. |

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
| `environment_variables` | `{}` | Extra non-secret settings. `GCS_BUCKET_NAME` and `GCS_BASE_URL` are injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name for additional secrets. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Pub/Sub rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. Note: this module uses `backup_file` (not `backup_uri`). |

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

### Group 10 — Load Balancer, CDN & Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS Load Balancer + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Strapi media (gen2 required). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL is required — do not change to MySQL or `NONE`. |
| `application_database_name` | `strapidb` | Database name. Immutable after first deploy. |
| `application_database_user` | `strapiuser` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional alias env var names for connection details. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[{ name="db-init", execute_on_apply=true }]` | The built-in `db-init` job runs on every apply. Override with a non-empty list to replace it. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |
| `additional_services` | `[]` | Co-deployed Cloud Run services (e.g. background workers). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, 60s initial delay, 3 retries | The probe actually applied. `startup_probe_config` is also declared but is superseded by this value and has no effect. |
| `liveness_probe` | HTTP `/_health`, 30s initial delay, 3 retries | The probe actually applied. `health_check_config` is also declared but is superseded by this value and has no effect. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Use Redis for caching/sessions (disabled by default). |
| `redis_host` | `null` | Redis endpoint. Leave null to fall back to the NFS server IP (requires `enable_nfs = true`); if NFS is also disabled the fallback is unresolved and the connection fails. |
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
| `database_host` / `database_port` | DB endpoint / port (sensitive). |
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
| `APP_KEYS` / `JWT_SECRET` / `ADMIN_JWT_SECRET` / `API_TOKEN_SALT` (auto-generated) | generated once, never changed | Critical | Rotating any of these after first deploy immediately invalidates all active sessions and API tokens; every user is logged out and all client integrations break. |
| `database_type` | `POSTGRES_15` | Critical | Strapi requires PostgreSQL; MySQL or `NONE` breaks startup. |
| `enable_nfs` | `true` | Critical | Without shared storage, uploads are lost between instances/restarts. |
| `application_name` | set once | Critical | Immutable after first deploy; changing it renames all GCP resources, causing full recreation and data loss. |
| `application_database_name` / `application_database_user` | set once | Critical | Immutable after first deploy; renaming causes Strapi to connect to an empty database. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `execution_environment` | `gen2` | High | gen1 does not support NFS mounts; NFS will fail silently. |
| `enable_redis` | `false` | High | Enable only when plugins require it. An unset `redis_host` falls back to the NFS server IP (only works when `enable_nfs = true`); with NFS also disabled, the fallback is unresolved and causes a startup connection error. |
| `memory_limit` | `2Gi` | High | Strapi's Node.js runtime and admin panel require sufficient memory; values below `512Mi` cause OOM kills. |
| `min_instance_count` | `0` or `1` | Medium | `0` allows scale-to-zero; first request after idle will incur a 15–30 second cold start. |
| `enable_iap` | enable for admin-facing | Medium | The Strapi admin panel is otherwise publicly reachable. |
| `enable_cloud_armor` / `enable_cdn` | consider for production | Medium | CDN caches content closer to users; Cloud Armor provides WAF and DDoS protection. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `secret_propagation_delay` | `30` | Low | Too short a delay may cause startup failures on first deploy if secrets have not yet propagated. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Strapi-specific application configuration shared
with the GKE variant is described in **[Strapi_Common](Strapi_Common.md)**.
