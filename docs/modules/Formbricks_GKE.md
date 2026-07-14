---
title: "Formbricks GKE Module \u2014 Configuration Guide"
description: "Configuration reference for deploying Formbricks on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Formbricks GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Formbricks_GKE` module. `Formbricks_GKE` is a **wrapper module** that combines the generic `App_GKE` infrastructure module with the `Formbricks_Common` shared application configuration to deploy the [Formbricks](https://formbricks.com/) open-source survey and experience management platform on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Formbricks GKE` map directly to the same options in `App GKE`. Where a variable is identical in behaviour, this guide references the `App GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Formbricks** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Standard Configuration Reference

The following configuration areas are provided by the underlying `App_GKE` module.

| Configuration Area | Formbricks-Specific Notes |
|---|---|
| Project & Identity | Identical to `App_GKE`. |
| Application Identity | Formbricks-specific defaults; see [Group 2: Application Identity](#group-2-application-identity). |
| Runtime & Scaling | Formbricks-specific defaults for `container_port`, `cpu_limit`, `memory_limit`; see [Group 3: Runtime & Scaling](#group-3-runtime--scaling). |
| Environment Variables & Secrets | Formbricks secrets injected automatically; see [Group 5: Environment Variables & Secrets](#group-5-environment-variables--secrets). |
| Networking | Identical to `App_GKE`. |
| Initialization Jobs | `db-init` PostgreSQL job supplied automatically by `Formbricks Common`; see [Group 8: Jobs & Scheduled Tasks](#group-8-jobs--scheduled-tasks). |
| Storage — NFS | `enable_nfs` defaults to `true`; see [Group 9: Storage & Filesystem — NFS](#group-9-storage--filesystem--nfs). |
| Storage — GCS | `uploads` GCS bucket provisioned automatically; see [Group 10: Storage & Filesystem — GCS](#group-10-storage--filesystem--gcs). |
| Database Configuration | PostgreSQL 15 required; see [Group 11: Database Configuration](#group-11-database-configuration). |
| Backup Schedule & Retention | Identical to `App_GKE`. |
| Observability & Health Checks | `/api/v2/health` endpoint; see [Group 13: Observability & Health](#group-13-observability--health). |
| Cloud Armor WAF | Identical to `App_GKE`. |
| Identity-Aware Proxy | Identical to `App_GKE`. |
| Binary Authorization | Identical to `App_GKE`. |
| VPC Service Controls | Identical to `App_GKE`. |
| Traffic & Ingress | Identical to `App_GKE`. |
| Custom Domain & Static IP | Formbricks `webapp_url` must be set to match; see [Group 11: Custom Domain & Static IP](#group-11-database-configuration). |
| Cloud Build Triggers | Identical to `App_GKE`. |
| Cloud Deploy Pipeline | Identical to `App_GKE`. |
| Image Mirroring | `enable_image_mirroring` defaults to `true`. |
| Pod Disruption Budgets | Identical to `App_GKE`. |
| Topology Spread Constraints | Identical to `App_GKE`. |
| Resource Quotas | Identical to `App_GKE`. |
| Auto Password Rotation | See [Group 11: Database Configuration](#group-11-database-configuration). |
| Redis Cache | `enable_redis` defaults to `true`; see [Group 12: Redis Cache](#group-12-redis-cache). |
| Backup Import | Exposes `backup_uri` and `backup_file`. |
| StatefulSet Configuration | See [Group 15: Stateful Workloads](#group-15-stateful-workloads). |

---

## How Formbricks GKE Relates to App GKE

`Formbricks GKE` passes all variables through to `App GKE` and adds a `Formbricks Common` sub-module that supplies Formbricks-specific defaults, secrets, and application configuration. The main effects are:

1. **PostgreSQL 15 is required.** Formbricks is built on Prisma ORM targeting PostgreSQL. The `database_type` default is `"POSTGRES_15"`.
2. **Application secrets are auto-generated.** `Formbricks Common` creates `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` in Secret Manager on first deployment. These are injected into the pod as secret environment variables via the Secrets Store CSI Driver.
3. **An `uploads` GCS bucket is provisioned automatically.** `Formbricks Common` provides an `uploads` bucket that Formbricks uses via GCS's S3-compatible XML API. HMAC credentials in Secret Manager authenticate the connection. You do not need to define it in `storage_buckets`.
4. **A `db-init` job runs on first deployment.** `Formbricks Common` supplies a default `db-init` Kubernetes Job that initialises the PostgreSQL schema and creates the application user. Prisma migrations then run automatically when the Formbricks container starts.
5. **Resource defaults are sized for Formbricks.** The default `cpu_limit` (2 vCPU) and `memory_limit` (2 Gi) reflect Formbricks's Next.js runtime and Prisma connection pool requirements.
6. **Redis caching is enabled by default.** Formbricks uses Redis for API response caching and rate limiting. Mandatory for safe horizontal scaling.
7. **`webapp_url` must be set after first deploy.** NextAuth.js requires the public URL of the Formbricks instance for OAuth redirect URIs and email links. Leave empty on first deploy; update to the external IP, nip.io domain, or custom domain after the load balancer IP is known.
8. **Session affinity defaults to `ClientIP`.** Formbricks's Next.js session handling benefits from routing repeated requests from the same browser to the same pod. Required to maintain consistent authentication state across the admin panel.

---

## Group 1: Project & Identity

Identical to `App_GKE`.

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. **Required.** |
| `region` | `"us-central1"` | GCP region for resource deployment. Used as fallback for VPC discovery and as the storage bucket location for the `uploads` bucket. |
| `tenant_deployment_id` | `"demo"` | Short suffix appended to all resource names. |
| `support_users` | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all provisioned resources. |

---

## Group 2: Application Identity

**Formbricks-specific defaults:**

| Variable | Formbricks GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"formbricks"` | `"gkeapp"` | Used as the base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `application_display_name` | `"Formbricks Surveys"` | `"App GKE Application"` | Shown in dashboards and the platform UI. Can be changed freely. |
| `application_description` | `"Formbricks Surveys on GKE Autopilot"` | `"App GKE Custom Application"` | Descriptive label. Not forwarded to `App_GKE` — the `description` variable controls this. |
| `application_version` | `"latest"` | `"1.0.0"` | The Formbricks release tag to build and deploy. Set to a specific version for production (e.g., `"v2.3.0"`). |
| `description` | `"Formbricks - Open Source Survey and Experience Management"` | — | Passed to `Formbricks Common` as the db-init job description. |
| `webapp_url` | `""` | — | Public URL of the Formbricks instance. Leave empty on first deploy; update after the external IP is known. |

---

## Group 3: Runtime & Scaling

**Formbricks-specific defaults and behaviour:**

| Variable | Formbricks GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `container_port` | `3000` | `8080` | Formbricks's native HTTP port. Do not change. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Formbricks Next.js server benefits from 2 vCPU; `"1000m"` causes noticeable response latency under moderate survey traffic. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Formbricks with Prisma connection pool and response caching requires at least 1 Gi; 2 Gi is recommended for production with file upload support. |
| `min_instance_count` | `0` | — | Defaults to 0 (scale-to-zero). Set to `1` for production to eliminate cold starts. |
| `max_instance_count` | `3` | `3` | HPA maxReplicas. Increase for higher-traffic survey campaigns. |
| `container_image_source` | `"custom"` | `"custom"` | `Formbricks Common` supplies a Dockerfile-based build. Set to `"prebuilt"` to deploy the upstream `ghcr.io/formbricks/formbricks` image directly. |
| `enable_cloudsql_volume` | `true` | `true` | The Cloud SQL Auth Proxy sidecar provides the PostgreSQL endpoint in GKE (Cloud Run uses the native Cloud SQL volume — a Unix socket under `/cloudsql`). |
| `enable_image_mirroring` | `true` | varies | Mirrors the Formbricks image from `ghcr.io` to Artifact Registry to avoid rate limits and ensure pull reliability. |
| `session_affinity` | `"ClientIP"` | varies | Required for consistent authentication state across Formbricks admin sessions. See note below. |

**`session_affinity` note:** Formbricks's Next.js server handles session state in-process (with Redis as external backing store). Without `ClientIP` session affinity, admin panel requests can route to different pods that have not yet synchronised their in-memory session cache, causing intermittent authentication failures. Keep `"ClientIP"` for all Formbricks GKE deployments.

**`container_resources`:** The `container_resources` variable default (`{ cpu_limit = "1000m", memory_limit = "512Mi" }`) is overridden by the Formbricks Common-provided `cpu_limit` and `memory_limit` values (`"2000m"` and `"2Gi"` respectively) in the `main.tf` locals merge. To set custom resource limits, set `cpu_limit` and `memory_limit` directly rather than `container_resources`.

The remaining runtime variables (`deploy_application`, `container_image`, `container_build_config`, `enable_vertical_pod_autoscaling`, `container_protocol`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) behave as described in the App_GKE guide.

---

## Group 4: Access & Networking

The following networking variables are available in `Formbricks GKE`:

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Identity-Aware Proxy authentication on the load balancer. Recommended for internal or staging Formbricks deployments. |
| `iap_authorized_users` | `[]` | Individual users or service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | `""` | OAuth client ID for IAP. Required when `enable_iap = true`. |
| `iap_oauth_client_secret` | `""` | OAuth client secret for IAP. Required when `enable_iap = true`. |
| `iap_support_email` | `""` | Support email shown on the Google OAuth consent screen. |
| `enable_custom_domain` | `true` | Configures Kubernetes Gateway API for custom domain routing with managed SSL certificates. |
| `application_domains` | `[]` | Custom domain names (e.g., `["surveys.example.com"]`). When `enable_custom_domain = true` and this is empty, a nip.io domain is used for testing. |
| `reserve_static_ip` | `true` | Reserves a Global Static IP for the load balancer. Recommended for production. |
| `static_ip_name` | `""` | Name for the reserved IP. Auto-generated if blank. |
| `network_tags` | `["nfsserver"]` | Firewall tags applied to GKE cluster nodes. The `nfsserver` tag is required for NFS connectivity. |
| `enable_cloud_armor` | `false` | Enables a Cloud Armor WAF security policy. |
| `admin_ip_ranges` | `[]` | Admin CIDR ranges permitted through Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Name of the Cloud Armor security policy to attach. |

> **Formbricks URL configuration:** When using a custom domain, set `webapp_url` to match the domain. Formbricks uses this value to generate NextAuth.js redirect URIs, email confirmation links, and survey share URLs. A mismatch between the actual service URL and `webapp_url` breaks authentication and causes broken links in survey emails.

---

## Group 5: Environment Variables & Secrets

`Formbricks Common` injects the following environment variables automatically. You do not need to define them in `environment_variables`:

| Environment Variable | Value / Source | Notes |
|---|---|---|
| `STORAGE_PROVIDER` | `"s3"` | Instructs Formbricks to use the S3 storage driver. |
| `S3_ENDPOINT_URL` | `"https://storage.googleapis.com"` | Points Formbricks's S3 client at GCS. |
| `S3_BUCKET_NAME` | `<uploads-bucket-name>` | Auto-provisioned `uploads` GCS bucket. |
| `NEXTAUTH_URL` | `var.webapp_url` | NextAuth.js base URL. Empty until `webapp_url` is set. |
| `WEBAPP_URL` | `var.webapp_url` | Formbricks public URL for email links. |
| `HUB_API_URL` | `var.hub_api_url` | Formbricks Hub API endpoint (v5+). |
| `CUBEJS_API_URL` | `var.cubejs_api_url` | Cube.js analytics API endpoint (v5+). |
| `SMTP_HOST` | `var.smtp_host` | SMTP server. Empty disables email. |
| `SMTP_PORT` | `var.smtp_port` | SMTP port. |
| `SMTP_USER` | `var.smtp_user` | SMTP username. |
| `SMTP_SECURE_ENABLED` | `"1"` / `"0"` | Implicit TLS flag. |
| `MAIL_FROM` | `var.mail_from` | Sender address. |

The following sensitive values are injected as Kubernetes Secrets via the Secrets Store CSI Driver (from Secret Manager):

| Kubernetes Secret | Environment Variable | Notes |
|---|---|---|
| `NEXTAUTH_SECRET` | `NEXTAUTH_SECRET` | JWT signing key — do not change after users exist. |
| `ENCRYPTION_KEY` | `ENCRYPTION_KEY` | Data encryption key. |
| `CRON_SECRET` | `CRON_SECRET` | Cron authentication token. |
| `HUB_API_KEY` | `HUB_API_KEY` | Hub connectivity key. |
| `CUBEJS_API_SECRET` | `CUBEJS_API_SECRET` | Cube.js JWT secret. |
| `S3_ACCESS_KEY` | `S3_ACCESS_KEY` | GCS HMAC access key. |
| `S3_SECRET_KEY` | `S3_SECRET_KEY` | GCS HMAC secret key. |
| `SMTP_PASSWORD` | `SMTP_PASSWORD` | When `smtp_host` is configured. |
| `REDIS_URL` | `REDIS_URL` | When Redis auth is enabled. |

Use `secret_environment_variables` to inject additional Secret Manager secrets beyond those provided by `Formbricks Common`.

The remaining secrets variables (`secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) behave identically to `App_GKE`.

---

## Group 6: Backup & Maintenance

**Formbricks-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. Adjust to match your survey data recovery objectives. |
| `backup_retention_days` | `7` | Increase to 30+ days for active survey deployments with valuable response data. |

**Backup Import:**

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` | `false` | When `true`, runs a one-time import job during deployment. |
| `backup_source` | `"gcs"` | `"gcs"` imports from a Cloud Storage URI; `"gdrive"` imports from a Google Drive file ID. |
| `backup_uri` | `""` | Full GCS URI (e.g., `"gs://my-bucket/formbricks.sql"`) or Google Drive file ID. |
| `backup_file` | `"backup.sql"` | Filename of a backup already placed in the module-managed backups bucket. |
| `backup_format` | `"sql"` | Format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_GKE`. Available variables: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

---

## Group 8: Jobs & Scheduled Tasks

**Formbricks default `db-init` job:**

When `initialization_jobs` is left as the default empty list, `Formbricks Common` automatically supplies a `db-init` job:

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | PostgreSQL-compatible client image |
| Purpose | Creates the `formbricks` PostgreSQL database and user, then grants privileges |
| Execute on every apply | `true` |
| CPU / Memory | `1000m` / `512Mi` |

Prisma migrations then run automatically when the Formbricks container starts — the `db-init` job only ensures the database and user exist beforehand.

Override `initialization_jobs` with a non-empty list to replace this default with custom jobs. Each custom job must specify at least one of `command`, `args`, or `script_path`.

> **Note:** GKE cron jobs (`cron_jobs`) use Kubernetes CronJob fields (`restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`) rather than the Cloud Run-style fields (`parallelism`, `paused`, `max_retries`, `task_count`) used in `Formbricks CloudRun`.

---

## Group 9: Storage & Filesystem — NFS

**Formbricks-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `enable_nfs` | `true` | NFS storage is enabled by default. Formbricks stores shared file uploads, cached assets, and session data on the NFS volume so all pod replicas access the same filesystem. |
| `nfs_mount_path` | `"/mnt/nfs"` | The path where the NFS volume is mounted inside the Formbricks container. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | `"app-nfs"` | Base name for an inline NFS GCE VM when none exists. |

---

## Group 10: Storage & Filesystem — GCS

`Formbricks Common` automatically provisions an `uploads` GCS bucket in addition to any buckets defined in `storage_buckets`. This bucket is used by Formbricks for S3-compatible file storage — survey response attachments, uploaded images, and custom assets are stored here via GCS's XML API with HMAC credentials.

| Bucket | `name_suffix` | Purpose |
|---|---|---|
| Auto-provisioned | `uploads` | Formbricks file uploads via S3-compatible GCS XML API |

The `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, and `enable_artifact_registry_cmek` variables behave identically to `App_GKE`.

---

## Group 11: Database Configuration

**Formbricks-specific defaults and restrictions:**

| Variable | Formbricks GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Formbricks requires PostgreSQL. Do not change to MySQL or SQL Server — Prisma ORM in this module targets PostgreSQL. |
| `db_name` | `"formbricks"` | — | Shorthand for the Formbricks database name. **Do not change after first deployment.** |
| `db_user` | `"formbricks"` | — | Shorthand for the Formbricks database user. **Do not change after first deployment.** |
| `application_database_name` | `"formbricksdb"` | `"gkeappdb"` | The `App_GKE` level variable for the database name. This is effectively overridden by `db_name` in `Formbricks Common` — use `db_name` for Formbricks. |
| `application_database_user` | `"formbricksuser"` | `"gkeappuser"` | The `App_GKE` level variable for the database user. Use `db_user` for Formbricks. |
| `enable_postgres_extensions` | `true` | `false` | PostgreSQL extensions are enabled by default for Formbricks. |
| `postgres_extensions` | `["vector", "uuid-ossp"]` | `[]` | `vector` (pgvector) is required by Formbricks's Prisma schema (embeddings/AI features) — without it, `prisma db push` fails with a permission error since the app DB user can't `CREATE EXTENSION`. `uuid-ossp` supports UUID generation. |

**Cloud SQL instance discovery:**

| Variable | Default | Description |
|---|---|---|
| `sql_instance_name` | `""` | Name of an existing Cloud SQL instance to use. Leave empty to auto-discover. |
| `sql_instance_base_name` | `"app-sql"` | Base name for an inline Cloud SQL instance. Deployment ID is appended. |

**Automatic password rotation:**

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys an automated database password rotation job. When `true`, the database password is rotated on the schedule defined by `secret_rotation_period` and GKE pods are restarted. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

---

## Group 12: Redis Cache

Formbricks uses Redis for API response caching, rate limiting, and background job coordination. Redis is **mandatory for horizontal scaling** — without Redis, multiple Formbricks pods cannot share cache state, leading to duplicate rate limit buckets and inconsistent API responses.

> **Note:** In `Formbricks GKE`, the Redis variables are in **group 15** in the variables file, but are documented here as group 12 for clarity.

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enables Redis as the Formbricks cache and rate-limiting backend. **Required for `max_instance_count > 1`.** When `redis_host` is blank, the module defaults to the NFS server IP. |
| `redis_host` | `""` | Redis server hostname or IP. Leave blank to use the NFS server IP. Override with a Cloud Memorystore instance for production. |
| `redis_port` | `"6379"` | Redis TCP port. |
| `redis_auth` | `""` | Redis AUTH password. Leave empty if Redis does not require authentication. Sensitive. |
| `hub_api_url` | `"http://localhost:8080"` | Formbricks Hub API URL (group 15). |
| `cubejs_api_url` | `"http://localhost:4000"` | Cube.js analytics API URL (group 15). |

**Validating Redis in GKE:**
```bash
# Confirm the Redis environment variable is set in the Formbricks pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS

# Test Redis connectivity from inside the Formbricks pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379

# List Memorystore Redis instances (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,authEnabled)"
```

---

## Group 13: Observability & Health

Formbricks exposes `/api/v2/health` — a dedicated health endpoint that returns `HTTP 200` only when the application and its PostgreSQL connection are operational.

`Formbricks GKE` exposes **two parallel sets** of probe variables:

| Variable set | Configures |
|---|---|
| `startup_probe`, `liveness_probe` | Passed to `Formbricks Common`; configure the application container's Kubernetes probe spec |
| `startup_probe_config`, `health_check_config` | Passed to `App GKE` directly; configure the infrastructure-level and load balancer health checks |

**Startup probe** (`startup_probe` → Formbricks Common):

| Field | Formbricks Default | Notes |
|---|---|---|
| `path` | `"/api/v2/health"` | Formbricks-native health endpoint — reflects DB connectivity. |
| `initial_delay_seconds` | `0` | Kubernetes startup probe uses `failureThreshold × periodSeconds` as the total allowance. |
| `period_seconds` | `30` | Check every 30 seconds. |
| `failure_threshold` | `10` | Up to 300 seconds total (10 × 30s) for Formbricks to start. |
| `timeout_seconds` | `10` | |

**Liveness probe** (`liveness_probe` → Formbricks Common):

| Field | Formbricks Default | Notes |
|---|---|---|
| `path` | `"/api/v2/health"` | Same endpoint as startup probe. |
| `initial_delay_seconds` | `60` | Gives Formbricks time to stabilise before liveness checks begin. |
| `period_seconds` | `30` | |
| `failure_threshold` | `3` | Container restarted after 3 consecutive failures (90 seconds). |

**App GKE-standard probes** (`startup_probe_config`, `health_check_config` → App GKE):

Both default to `path = "/"`. For accurate load balancer health checks, override both to use `path = "/api/v2/health"` to match Formbricks's actual health endpoint.

| Variable | Group | Default |
|---|---|---|
| `startup_probe_config` | 10 | `{ enabled = true, type = "TCP", path = "/" }` |
| `health_check_config` | 10 | `{ enabled = true, type = "HTTP", path = "/" }` |
| `uptime_check_config` | 10 | `{ enabled = false, path = "/" }` |
| `alert_policies` | 10 | `[]` |

---

## Group 14: Reliability Policies

Identical to `App_GKE`. Available variables: `enable_pod_disruption_budget` (default `true`), `pdb_min_available` (default `"1"`), `enable_topology_spread` (default `false`), `topology_spread_strict` (default `false`).

For production Formbricks deployments with `max_instance_count > 1`, set `enable_topology_spread = true` to distribute pods across GKE Autopilot node zones and improve availability.

---

## Group 15: Stateful Workloads

When `stateful_pvc_enabled = true`, the module automatically uses a `StatefulSet` workload type. This provisions a per-pod PVC for Formbricks local storage.

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Enable per-pod PVC for StatefulSet. Set `true` if NFS is disabled and local persistent storage is needed. |
| `stateful_pvc_size` | `"10Gi"` | PVC size per pod. Survey file uploads can grow quickly — provision 50+ Gi for active deployments. |
| `stateful_pvc_mount_path` | `"/data"` | Mount path for the per-pod PVC. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | GKE Autopilot default (Balanced PD, ReadWriteOnce). |
| `stateful_headless_service` | `true` | Creates a headless Service for stable pod DNS identities. |
| `stateful_pod_management_policy` | `"OrderedReady"` | Sequential pod startup. Use `"Parallel"` to start all pods simultaneously. |
| `stateful_update_strategy` | `"RollingUpdate"` | Rolling pod replacements on template changes. |

> **Note:** `stateful_pvc_enabled = true` and `workload_type = "Deployment"` cannot be used together — this fails at plan time.

---

## Module Outputs

`Formbricks GKE` exposes the following outputs:

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes service. |
| `service_url` | Service URL. |
| `service_external_ip` | External IP address of the load balancer. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix. |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets (includes the `uploads` bucket). |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is reachable and all Kubernetes resources are deployed. `false` on the first apply of a new inline cluster — re-run apply to complete the deployment. |

---

## Exploring with the GCP Console

After deployment, use the GCP Console to observe and operate the Formbricks GKE deployment.

**GKE Workloads:**
- Navigate to **Kubernetes Engine → Workloads** and select your project and cluster.
- Filter by the Formbricks namespace (e.g., `formbricks-demo`). You will see the Formbricks `Deployment` or `StatefulSet` along with any `db-init` Jobs.
- Click the workload to see pod count, rolling update status, and resource requests/limits.
- The **Events** tab shows Kubernetes scheduler decisions, image pull status, and probe failures. This is the first place to look when pods fail to start.
- The **YAML** tab shows the full Kubernetes manifest including all injected environment variables and secret volume mounts.

**GKE Services & Ingress:**
- Navigate to **Kubernetes Engine → Services & Ingress** and select the Formbricks namespace.
- The Formbricks Service (type `LoadBalancer`) shows its external IP. This is the IP to set as the `webapp_url` base on first deploy.
- If `enable_custom_domain = true`, a Gateway resource appears here with the attached SSL certificate status.
- The **Backend health** tab on the Ingress/Gateway shows whether the load balancer considers the Formbricks pods healthy.

**HPA (Horizontal Pod Autoscaler):**
- Navigate to **Kubernetes Engine → Workloads**, select the Formbricks deployment, then look at the **Horizontal Pod Autoscaler** section.
- Current replica count, target CPU utilisation, and scaling events are visible here.
- Alternatively, navigate to the cluster in **Kubernetes Engine → Clusters** and use the built-in Cloud Shell: `kubectl get hpa -n formbricks-demo`.

**Secret Manager:**
- Navigate to **Security → Secret Manager** and filter by `formbricks`.
- All auto-generated secrets appear here: `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and conditionally `SMTP_PASSWORD` and `REDIS_URL`.
- Click any secret to see its version history, creation timestamp, and which Kubernetes workloads reference it (under **Usage**).

**Cloud SQL:**
- Navigate to **SQL** and select the PostgreSQL instance.
- The **Connections** tab shows active connections from GKE pods. Under heavy load, connection count is a key health indicator — Prisma's connection pool limits typically keep this low.
- The **Operations** tab logs the `db-init` job's database and user creation.

**Cloud Storage:**
- Navigate to **Cloud Storage → Buckets** and find the `uploads` bucket.
- Survey file attachments uploaded by respondents are stored as objects here.
- The **Permissions** tab confirms the HMAC service account has `roles/storage.objectAdmin`.

**Cloud Build:**
- Navigate to **Cloud Build → History** to see the Formbricks image build history.
- Each build log shows the Dockerfile steps, build arguments referencing `application_version`, and the push step to Artifact Registry.

---

## Exploring with gcloud

The following commands are useful for day-to-day operations. Replace `PROJECT_ID`, `REGION`, `CLUSTER_NAME`, and `NAMESPACE` with your values.

**Get cluster credentials and set the namespace context:**
```bash
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

kubectl config set-context --current --namespace=NAMESPACE
```

**List all pods and their status:**
```bash
kubectl get pods -n NAMESPACE -o wide
```

**Describe a Formbricks pod (shows events, probe status, resource usage):**
```bash
kubectl describe pod POD_NAME -n NAMESPACE
```

**Tail live Formbricks container logs:**
```bash
kubectl logs -n NAMESPACE -l app=formbricks --follow --tail=100
```

**Check the HPA status and scaling history:**
```bash
kubectl get hpa -n NAMESPACE
kubectl describe hpa formbricks -n NAMESPACE
```

**Confirm all Formbricks secrets are mounted in the pod:**
```bash
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E 'NEXTAUTH|ENCRYPTION|CRON|S3|REDIS|SMTP'
```

**List Secret Manager secrets for the Formbricks deployment:**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, replication.automatic, createTime)"
```

**View the latest version of a secret (metadata only):**
```bash
gcloud secrets versions describe latest \
  --secret=formbricks-nextauth-secret \
  --project=PROJECT_ID
```

**Check the Cloud SQL PostgreSQL instance:**
```bash
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name, state, databaseVersion, settings.tier)"

gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Check the GKE Ingress / Gateway external IP:**
```bash
kubectl get gateway -n NAMESPACE
kubectl get svc -n NAMESPACE formbricks
```

**Check the Formbricks uploads GCS bucket:**
```bash
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, location, storageClass)"

gcloud storage ls gs://UPLOADS_BUCKET_NAME/ --long
```

**View GKE cluster-level events (useful for scheduling failures):**
```bash
kubectl get events -n NAMESPACE --sort-by='.lastTimestamp' | tail -30
```

**Check Memorystore Redis (if using Memorystore for Redis):**
```bash
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"
```

**Manually trigger the db-init job:**
```bash
kubectl create job formbricks-db-init-manual \
  --from=cronjob/formbricks-db-init \
  -n NAMESPACE
kubectl logs -n NAMESPACE job/formbricks-db-init-manual --follow
```

**View Cloud Build image build history:**
```bash
gcloud builds list \
  --project=PROJECT_ID \
  --limit=10 \
  --format="table(id, status, createTime, duration)"
```

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `project_id` | _(required)_ | **Critical** | No default — deployment fails immediately. |
| `webapp_url` | Set after first deploy | **High** | NextAuth.js generates OAuth redirect URIs and email links referencing the value of `webapp_url`. If left empty after first deploy, authentication fails for any OAuth provider and email links resolve to localhost. Retrieve the external IP from `kubectl get svc`, set `webapp_url`, and redeploy. |
| `db_name` | `"formbricks"` | **Critical** | Immutable after first deployment — changing this recreates the database, destroying all survey definitions, responses, and team data. |
| `db_user` | `"formbricks"` | **Critical** | Immutable after first deployment — changing this recreates the database user and breaks all existing credential references. |
| `database_type` | `"POSTGRES_15"` | **Critical** | Formbricks's Prisma schema targets PostgreSQL. Setting to `MYSQL_8_0` or `NONE` causes Formbricks to fail at startup with a Prisma client error. |
| `enable_redis` | `true` | **High** | Redis is on by default. When `redis_host = ""` the module falls back to the NFS server IP. If `enable_nfs = false` and `redis_host` is also empty, Formbricks fails at startup. With `max_instance_count > 1`, Redis is mandatory — without it, each pod maintains an isolated cache, causing inconsistent rate limiting and response behaviour. |
| `session_affinity` | `"ClientIP"` | **High** | Without session affinity, Formbricks admin panel requests route to different pods. In-memory session caches diverge, causing intermittent authentication failures and unexpected logouts. Keep `"ClientIP"` for all multi-replica Formbricks deployments. |
| `enable_nfs` | `true` | **High** | Without NFS, uploaded survey assets are stored on the ephemeral pod filesystem. All uploads are lost on pod restart or rolling update. Multiple replicas serve inconsistent file content. |
| `memory_limit` | `"2Gi"` | **High** | The GKE `container_resources` base default is only `"512Mi"`. Formbricks's Next.js runtime requires at least 1 Gi; the Prisma connection pool and response caching under active survey traffic require 2 Gi. Under-provisioning causes Node.js OOM crashes. |
| `smtp_host` | `""` | **High** | Without SMTP, Formbricks cannot send user invitations, survey response notifications, or magic-link sign-in emails. Configure a valid SMTP provider before inviting team members. |
| `min_instance_count` | `0` | **Medium** | Scale-to-zero causes cold starts of 15–20 seconds. Survey respondents visiting immediately after an idle period experience this delay. Set to `1` for production surveys with SLA requirements. |
| `backup_retention_days` | `7` | **Medium** | Seven days is insufficient for active survey deployments. Increase to 30+ days for any production Formbricks deployment collecting valuable survey response data. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critical** (GKE-specific) | Must use binary suffixes (`Gi`, `Mi`) when set. Bare integers are treated as bytes by Kubernetes and block all pod scheduling entirely. |
| `enable_pod_disruption_budget` | `true` | **Medium** | Already enabled. Disabling allows all pods to be terminated simultaneously during GKE Autopilot node upgrades, causing a full service outage. |
| `pdb_min_available` | `"1"` | **Medium** | With a single replica, PDB prevents all voluntary disruptions until the pod is rescheduled. Use at least 2 replicas in production to allow rolling maintenance. |
| `stateful_pvc_size` | `"10Gi"` | **Medium** | Survey file uploads grow quickly. `10Gi` is a minimum for development. Provision 50–100Gi for active production deployments accepting file attachments. PVC size can be expanded but not reduced without data migration. |
| `enable_cloud_armor` | `false` | **Medium** | Without Cloud Armor, the Formbricks admin panel is protected only by Formbricks's own authentication. Enable for any publicly accessible production deployment. |
