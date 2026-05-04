# Activepieces on Google Cloud Run

This document provides a comprehensive reference for the `modules/Activepieces_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Activepieces-specific behaviours, and operational patterns for deploying Activepieces on Google Cloud Run (v2).

---

## 1. Module Overview

Activepieces is an open-source, Apache 2.0-licensed no-code workflow automation platform for connecting apps, APIs, and data sources. `Activepieces_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Activepieces-specific application configuration, secrets, database initialisation, and queue configuration via `Activepieces_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Node.js container, scale-to-zero supported (`min_instance_count = 0` by default). Custom image build via Cloud Build wraps the upstream `activepieces/activepieces` image.
*   **Data Persistence**: Cloud SQL PostgreSQL 15 with Cloud SQL Auth Proxy sidecar (`enable_cloudsql_volume = true` by default). The `db-init.sh` script handles socket detection and the `pgvector` extension for AI features. GCS data bucket provisioned automatically by `Activepieces_Common`.
*   **Security**: `AP_ENCRYPTION_KEY` and `AP_JWT_SECRET` auto-generated and stored in Secret Manager. Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`.
*   **Queue Mode**: Memory-based queue by default (`AP_QUEUE_MODE = MEMORY`). Set `enable_redis = true` to switch to Redis queue mode (`AP_QUEUE_MODE = REDIS`), required for horizontal scaling.
*   **Webhooks**: `ingress_settings = 'all'` is the default so external systems can POST to Activepieces webhook endpoints. Enabling IAP will block public webhooks.
*   **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 1 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `string` | `'activepieces'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `string` | `'Activepieces Workflow Automation'` | Human-readable name shown in the GCP Console. Note: uses `display_name` alias, not `application_display_name`. |
| `description` | 2 | `string` | `'Activepieces - Open source workflow automation platform'` | Cloud Run service description. Note: uses `description` alias, not `application_description`. |
| `application_version` | 2 | `string` | `'latest'` | Container image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `Activepieces_CloudRun` calls `Activepieces_Common` to build an `application_config` object containing Activepieces environment variables, the `AP_ENCRYPTION_KEY` and `AP_JWT_SECRET` secrets, database initialisation job configuration, probe settings, and the data GCS bucket definition. `module_env_vars` is empty (all env vars are set inside `Activepieces_Common`). `module_secret_env_vars` carries `Activepieces_Common`-generated secret IDs. `module_storage_buckets` carries the data bucket provisioned by `Activepieces_Common`. `scripts_dir` is resolved to `${module.activepieces_app.path}/scripts`.

**Naming note:** Unlike Django, which uses `application_display_name` and `application_description`, `Activepieces_CloudRun` uses `display_name` and `description` aliases. These are mapped to the `App_CloudRun` display name and description fields inside `Activepieces_Common`'s config output.

---

## 2. IAM & Access Control

`Activepieces_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**Activepieces auto-generated secrets and IAM:** `Activepieces_Common` creates two Secret Manager secrets during provisioning: `AP_ENCRYPTION_KEY` and `AP_JWT_SECRET`. These are injected into the Cloud Run revision via `module_secret_env_vars`. The Cloud Run SA requires `roles/secretmanager.secretAccessor`, which is already granted by `App_CloudRun`. The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun`.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It connects to Cloud SQL via the Auth Proxy sidecar (since `enable_cloudsql_volume = true` by default). The `db-init.sh` script auto-detects the socket path at runtime.

**GCS data bucket IAM:** `Activepieces_Common` provisions a GCS data bucket and the application SA is granted storage access by `App_CloudRun`.

**120-second IAM propagation delay:** Inherited from `App_CloudRun` — the Activepieces service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

**Webhook access:** Public access is required for Activepieces webhook endpoints. `ingress_settings = 'all'` is the default. Enabling IAP (`enable_iap = true`) will require Google identity authentication and will block unauthenticated webhook calls from external systems.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Activepieces is a Node.js application with significant memory requirements. The default resource limits (`cpu_limit = "2000m"`, `memory_limit = "2Gi"`) reflect the minimum recommended for production use. Unlike Django (which uses a `container_resources` object), `Activepieces_CloudRun` exposes `cpu_limit` and `memory_limit` as individual top-level variables.

**Scale-to-zero is enabled by default** (`min_instance_count = 0`). Note: when running in memory queue mode, cold starts cause any in-flight workflow execution data held in memory to be lost. Set `min_instance_count = 1` for production deployments or when using memory queue mode with long-running workflows.

**Container image:** `container_image_source` is hardcoded to `'custom'` inside `Activepieces_Common`. Cloud Build wraps the official `activepieces/activepieces` image with the `entrypoint.sh` script. The `application_version` tag controls which upstream image version is pulled.

**Cloud SQL Auth Proxy:** `enable_cloudsql_volume` defaults to `true`. The Cloud SQL Auth Proxy sidecar is injected. `db-init.sh` detects the socket automatically.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `cpu_limit` | 3 | `'2000m'` | CPU limit per instance (2 vCPUs). Minimum 1 vCPU required; 2 vCPUs recommended for production. |
| `memory_limit` | 3 | `'2Gi'` | Memory limit per instance. Minimum 512Mi; 2Gi recommended for production. |
| `min_instance_count` | 3 | `0` | `0` enables scale-to-zero. Set `≥1` to eliminate cold starts and maintain webhook availability. |
| `max_instance_count` | 3 | `1` | Increase for high-traffic deployments. Requires Redis queue mode for safe horizontal scaling. |
| `container_port` | 3 | `8080` | Activepieces default port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration. |
| `enable_cloudsql_volume` | 3 | `true` | Injects Cloud SQL Auth Proxy sidecar. `db-init.sh` auto-detects the socket path. |
| `cloudsql_volume_mount_path` | 3 | `'/cloudsql'` | Base path for the Auth Proxy Unix socket mount. |
| `enable_image_mirroring` | 3 | `true` | Mirrors the container image into Artifact Registry. |
| `max_revisions_to_retain` | 3 | `7` | Maximum number of Cloud Run revisions to keep. Set to 0 to disable pruning. |
| `traffic_split` | 3 | `[]` | Percentage-based canary/blue-green traffic allocation. |
| `container_protocol` | 3 | `'http1'` | `'http1'` or `'h2c'`. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Activepieces_CloudRun` | Reason |
|---|---|---|---|
| `cpu_limit` (via `container_resources`) | `"1000m"` | `"2000m"` | Activepieces requires more CPU for workflow execution |
| `memory_limit` (via `container_resources`) | `"512Mi"` | `"2Gi"` | Activepieces Node.js runtime requires significant memory |
| `enable_cloudsql_volume` | `true` | `true` | Same default |

### B. Database (Cloud SQL — PostgreSQL)

Activepieces requires **PostgreSQL 15** — `Activepieces_Common` hardcodes `database_type = "POSTGRES_15"`. The `db-init.sh` script installs the `pgvector` extension (required for AI-powered workflow features).

`Activepieces_CloudRun` uses `db_name` and `db_user` — aliases that differ from `App_CloudRun`'s `application_database_name` / `application_database_user`. These are wired into `Activepieces_Common`'s config output and forwarded correctly.

**pgvector extension:** The `db-init.sh` script installs `CREATE EXTENSION IF NOT EXISTS vector` as a PostgreSQL superuser during the `db-init` job. This is required for Activepieces AI piece integrations that use vector similarity search.

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 11 | `'activepieces_db'` | PostgreSQL database name. **Do not change after initial deployment.** |
| `db_user` | 11 | `'ap_user'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 11 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |

### C. Storage (NFS & GCS)

**NFS is disabled by default** (`enable_nfs = false`). Unlike Django, Activepieces does not require shared NFS storage by default — workflow execution state is stored in PostgreSQL. Enable NFS if co-locating Redis with an NFS server VM, or if the deployment requires shared file access.

**GCS data bucket:** `Activepieces_Common` automatically provisions a dedicated data bucket (suffix `ap-data`). Additional GCS buckets can be defined via `storage_buckets`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 10 | `false` | Provisions an NFS volume. Required only if co-locating Redis with the NFS server. |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `nfs_instance_name` | 8 | `""` | Name of an existing NFS GCE VM to use. |
| `nfs_instance_base_name` | 8 | `'app-nfs'` | Base name for the inline NFS GCE VM. |
| `create_cloud_storage` | 10 | `true` | Set `false` to skip additional bucket creation. The `ap-data` bucket from `Activepieces_Common` is always provisioned. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `manage_storage_kms_iam` | 10 | `false` | Creates CMEK KMS keyring and enables CMEK encryption on storage buckets. |
| `enable_artifact_registry_cmek` | 10 | `false` | Enables CMEK encryption for container images in Artifact Registry. |

### D. Networking

Public ingress is required for Activepieces webhook endpoints. The default `ingress_settings = 'all'` allows external systems to POST to webhook URLs.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 4 | `'all'` | `'all'` — required for webhook endpoints; `'internal'` — VPC only (disables webhooks); `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS LB. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC. |

### E. Initialization & Bootstrap

When `initialization_jobs = []` (the default), `Activepieces_Common` substitutes a single default `db-init` job (`execute_on_apply = true`). This creates the PostgreSQL database and user, grants privileges, and installs the `pgvector` extension.

Unlike Django, there is no separate `db-migrate` job — Activepieces runs its own database migrations automatically on application startup.

The `db-init` job uses `postgres:15-alpine` and executes `Activepieces_Common/scripts/db-init.sh`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs. Empty list triggers the default `db-init` job with `execute_on_apply = true`. Custom jobs can be provided to override. |
| `cron_jobs` | 12 | `[]` | Recurring jobs triggered by Cloud Scheduler. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy is provisioned in front of Cloud Run.

**Activepieces consideration:** Webhook endpoints receive unauthenticated POST requests from external services. Ensure that Cloud Armor WAF rules do not block valid webhook traffic. Add webhook source IPs to `admin_ip_ranges` if needed, or configure WAF rules to allow traffic from trusted sources.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules. |

### B. Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP (`enable_iap = true`) will require Google identity authentication for all requests, including webhook endpoints. This will **block external webhook triggers** from third-party services. Only enable IAP if Activepieces is used in an internal-only context where webhook endpoints are not needed.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service. Will block public webhook endpoints. |
| `iap_authorized_users` | 4 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

### C. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured in the project. |

### D. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 21 | `false` | Registers module API calls within the project's VPC-SC perimeter. A perimeter must already exist before enabling. |
| `vpc_cidr_ranges` | 21 | `[]` | VPC subnet CIDR ranges for the VPC-SC network access level. |
| `vpc_sc_dry_run` | 21 | `true` | When `true`, VPC-SC violations are logged but not blocked. |
| `organization_id` | 21 | `""` | GCP Organization ID for the VPC-SC Access Context Manager policy. |
| `enable_audit_logging` | 21 | `false` | Enables detailed Cloud Audit Logs for all supported services. |

### E. Secret Manager Integration

`Activepieces_Common` auto-generates two secrets: `AP_ENCRYPTION_KEY` (32-character hex string for credential encryption) and `AP_JWT_SECRET` (32-character random string for JWT signing). These are injected via `module_secret_env_vars`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 5 | `{}` | Map of env var name → Secret Manager secret ID. Resolved at runtime by Cloud Run. |
| `secret_rotation_period` | 5 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Activepieces traffic through the LB, preventing direct `*.run.app` URL access.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

**Activepieces consideration:** Cloud CDN is most useful for the Activepieces frontend (static assets). API endpoints and webhooks must not be cached — ensure that Activepieces API responses include appropriate `Cache-Control: no-store` headers before enabling CDN.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |

### C. Custom Domains

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 9 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. DNS must point to the LB IP. |

After the first apply, retrieve the LB IP from the Terraform output `load_balancer_ip` and create an `A` record. Then update `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` environment variables to use the custom domain for correct OAuth redirect and webhook URL generation.

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT (`repo`, `admin:repo_hook` scopes). Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced trigger config. |

### B. Cloud Deploy Pipeline

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 7 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 7 | `[dev, staging, prod(approval)]` | Ordered promotion stages. |

---

## 7. Reliability & Scheduling

### A. Scaling & Concurrency

**Important:** In the default memory queue mode (`AP_QUEUE_MODE = MEMORY`), workflow execution state is held in memory. Scaling to `max_instance_count > 1` in memory mode will cause workflows to be split across instances and may produce inconsistent execution. **Enable Redis queue mode before scaling horizontally.**

| Variable | Group | Default | Description |
|---|---|---|---|
| `min_instance_count` | 3 | `0` | `0` enables scale-to-zero. Set `≥1` to prevent cold starts on webhook triggers. |
| `max_instance_count` | 3 | `1` | Increase only when `enable_redis = true` for consistent queue management. |

### B. Health Probes

`Activepieces_CloudRun` exposes a dual probe system, consistent with other application modules.

**`startup_probe` / `liveness_probe`** — passed to `Activepieces_Common` to configure how the application container assesses readiness. These target `/api/v1/flags` — the Activepieces flags API endpoint that responds when the server is ready.

**`startup_probe_config` / `health_check_config`** — passed directly to `App_CloudRun` and configure the Cloud Run infrastructure-level probes.

Activepieces connects to PostgreSQL and applies database migrations on **first boot** — allow at least 7 minutes on the initial deployment. The default `startup_probe` settings (`initial_delay_seconds = 120`, `failure_threshold = 10`, `period_seconds = 30`) provide a total startup window of ~5 minutes after the initial delay (120 + 10×30 = 420 seconds).

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 13 | `{ enabled=true, type="HTTP", path="/api/v1/flags", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=10 }` | Startup probe used by `Activepieces_Common`. Targets `/api/v1/flags`. Allow 7+ minutes on first boot. |
| `liveness_probe` | 13 | `{ enabled=true, type="HTTP", path="/api/v1/flags", initial_delay_seconds=30, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Liveness probe used by `Activepieces_Common`. |
| `startup_probe_config` | 13 | `{ enabled=false }` | Cloud Run infrastructure startup probe. Disabled by default — `startup_probe` above takes effect instead. |
| `health_check_config` | 13 | `{ enabled=true }` | Cloud Run infrastructure liveness probe. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. |

### C. Auto Password Rotation

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 11 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 5 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis Queue Mode

Redis is **disabled by default** (`enable_redis = false`). In the default configuration, `AP_QUEUE_MODE = "MEMORY"` — workflow jobs are executed in-process. This is suitable for single-instance, low-traffic deployments.

When `enable_redis = true`:
- `AP_QUEUE_MODE` is set to `"REDIS"`
- `QUEUE_BULL_REDIS_HOST`, `QUEUE_BULL_REDIS_PORT`, and optionally `QUEUE_BULL_REDIS_PASSWORD` are injected
- `entrypoint.sh` constructs and exports `AP_REDIS_URL` at runtime

If `redis_host` is left empty and `enable_nfs = true`, the NFS server VM's IP is used as the Redis host (via the `$(NFS_SERVER_IP)` platform placeholder). This enables a simple single-VM deployment where Redis is co-located on the NFS server. For production, provision a dedicated Cloud Memorystore instance and set `redis_host` explicitly.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 20 | `false` | Switches to Redis queue mode. Requires `redis_host` or `enable_nfs = true`. |
| `redis_host` | 20 | `""` | Redis hostname or IP. Empty defaults to NFS server IP when `enable_nfs = true`. |
| `redis_port` | 20 | `'6379'` | Redis TCP port. Note: type is `string`, not `number`. |
| `redis_auth` | 20 | `""` | Redis AUTH password. Sensitive — never stored in state in plaintext. |

> **Validation:** A precondition in `Activepieces_GKE`'s `validation.tf` enforces that when `enable_redis = true`, either `redis_host` must be set or `enable_nfs` must be true. The same logic applies logically for the CloudRun variant.

### B. Backup Import & Recovery

`Activepieces_CloudRun` uses `backup_uri` (not `backup_file` as in Django). `backup_uri` is mapped to `App_CloudRun`'s `backup_file` parameter internally.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (Google Drive file ID). |
| `backup_uri` | 6 | `""` | Full GCS URI (e.g., `gs://my-bucket/backup.sql`) or Google Drive file ID. Maps to `backup_file` in `App_CloudRun`. |
| `backup_format` | 6 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### C. Custom SQL Scripts

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 8 | `false` | Runs custom SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 8 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 8 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 8 | `false` | Run scripts as the root DB user. |

### D. Observability & Alerting

| Variable | Group | Default | Description |
|---|---|---|---|
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 13 | `[]` | Metric alert policies. |
| `support_users` | 1 | `[]` | Email addresses notified by uptime and alert policy triggers. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` hardcoded by `Activepieces_Common` | Only PostgreSQL 15 is supported. `database_type` is not exposed as a variable. |
| **pgvector extension** | Installed by `db-init` job via `Activepieces_Common/scripts/db-init.sh` | `CREATE EXTENSION IF NOT EXISTS vector` is run as the `postgres` superuser. Required for AI-powered workflow pieces. The script is idempotent. |
| **AP_ENCRYPTION_KEY** | Auto-generated 32-char hex string stored in Secret Manager by `Activepieces_Common` | Injected via `module_secret_env_vars`. Do not set in `environment_variables`. |
| **AP_JWT_SECRET** | Auto-generated 32-char random string stored in Secret Manager by `Activepieces_Common` | Injected via `module_secret_env_vars`. Do not set in `environment_variables`. |
| **AP_POSTGRES_* mapping** | `entrypoint.sh` in `Activepieces_Common` | Platform-standard `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` are mapped to Activepieces-specific `AP_POSTGRES_HOST`, `AP_POSTGRES_DATABASE`, `AP_POSTGRES_USERNAME`, `AP_POSTGRES_PASSWORD` at runtime. |
| **AP_FRONTEND_URL / AP_WEBHOOK_URL_PREFIX** | Set to predicted service URL at plan time; corrected at runtime by `entrypoint.sh` from `CLOUDRUN_SERVICE_URL` | Ensures webhook URLs and OAuth redirects always use the actual service URL, not a stale predicted URL. |
| **Memory queue mode by default** | `AP_QUEUE_MODE = "MEMORY"` unless `enable_redis = true` | Single-instance operation. Do not scale `max_instance_count > 1` in memory mode. |
| **GCS data bucket** | Provisioned by `Activepieces_Common`, injected via `module_storage_buckets` | A dedicated GCS bucket (suffix `ap-data`) is provisioned for Activepieces data. |
| **NFS disabled by default** | `enable_nfs = false` | Unlike Django, NFS is opt-in. Enable only if co-locating Redis or requiring shared filesystem access. |
| **module_env_vars is empty** | `module_env_vars = {}` | All Activepieces environment variables are set inside `Activepieces_Common`'s `config.environment_variables`. No additional env vars are injected via `module_env_vars`. |
| **scripts_dir resolution** | `abspath("${module.activepieces_app.path}/scripts")` | Points to `Activepieces_Common/scripts/`. Initialization scripts are sourced from there. |

---

## 10. Variable Reference

All user-configurable variables exposed by `Activepieces_CloudRun`, sorted by UI group then order. Group 0 variables are reserved for platform metadata.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Activepieces Cloud Run platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | `https://docs.radmodules.dev/docs/applications/activepieces` | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services_GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `100` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `true` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 1 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `'activepieces'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `'Activepieces Workflow Automation'` | Human-readable name. Alias for `application_display_name`. |
| `description` | 2 | `'Activepieces - Open source workflow automation platform'` | Service description. Alias for `application_description`. |
| `application_version` | 2 | `'latest'` | Container image version tag. |
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 3 | `'2000m'` | CPU limit per instance. |
| `memory_limit` | 3 | `'2Gi'` | Memory limit per instance. |
| `min_instance_count` | 3 | `0` | `0` = scale-to-zero. Set `≥1` to eliminate cold starts. |
| `max_instance_count` | 3 | `1` | Set >1 only when `enable_redis = true`. |
| `container_port` | 3 | `8080` | TCP port Activepieces listens on. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration (0–3600). |
| `enable_cloudsql_volume` | 3 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | 3 | `'/cloudsql'` | Base path for Auth Proxy Unix socket. |
| `enable_image_mirroring` | 3 | `true` | Mirrors container image into Artifact Registry. |
| `max_revisions_to_retain` | 3 | `7` | Maximum Cloud Run revisions to retain. |
| `traffic_split` | 3 | `[]` | Canary/blue-green traffic allocation. |
| `container_protocol` | 3 | `'http1'` | `'http1'` or `'h2c'`. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 4 | `'all'` | `'all'` required for webhooks; `'internal'` disables public access. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 4 | `false` | Enables IAP. **Will block webhook endpoints.** |
| `iap_authorized_users` | 4 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 5 | `{}` | Additional plain-text env vars. Do not set `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, or `AP_POSTGRES_*` here. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references injected as env vars. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (file ID). |
| `backup_uri` | 6 | `""` | GCS URI or Google Drive file ID. Maps to `backup_file` in `App_CloudRun`. |
| `backup_format` | 6 | `'sql'` | Backup format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 7 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 7 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation on deployment. |
| `enable_custom_sql_scripts` | 8 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 8 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 8 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 8 | `false` | Run scripts as the root DB user. |
| `nfs_instance_name` | 8 | `""` | Name of an existing NFS GCE VM to use. |
| `nfs_instance_base_name` | 8 | `'app-nfs'` | Base name for the inline NFS GCE VM. |
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 9 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 9 | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | 9 | `true` | Automatically deletes untagged container images. |
| `image_retention_days` | 9 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 10 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 10 | `false` | Provisions NFS shared storage. Off by default (unlike Django). |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` | 10 | `false` | Creates CMEK KMS keyring and enables CMEK encryption. |
| `enable_artifact_registry_cmek` | 10 | `false` | Enables CMEK encryption for container images. |
| `db_name` | 11 | `'activepieces_db'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 11 | `'ap_user'` | PostgreSQL application user. |
| `database_password_length` | 11 | `32` | Auto-generated password length (16–64). |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs. Empty list triggers the default `db-init` job (`execute_on_apply=true`). |
| `cron_jobs` | 12 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 13 | `{ path="/api/v1/flags", initial_delay_seconds=120, failure_threshold=10, ... }` | Activepieces_Common startup probe. Allow 7+ minutes on first boot. |
| `liveness_probe` | 13 | `{ path="/api/v1/flags", initial_delay_seconds=30, failure_threshold=3, ... }` | Activepieces_Common liveness probe. |
| `startup_probe_config` | 13 | `{ enabled=false }` | Cloud Run infrastructure startup probe. Disabled — `startup_probe` takes effect. |
| `health_check_config` | 13 | `{ enabled=true }` | Cloud Run infrastructure liveness probe. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 20 | `false` | Switches to Redis queue mode. Required for `max_instance_count > 1`. |
| `redis_host` | 20 | `""` | Redis hostname/IP. Empty defaults to NFS server IP when `enable_nfs = true`. |
| `redis_port` | 20 | `'6379'` | Redis TCP port (string type). |
| `redis_auth` | 20 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 21 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 21 | `[]` | VPC subnet CIDR ranges for the VPC-SC network access level. |
| `vpc_sc_dry_run` | 21 | `true` | When `true`, VPC-SC violations are logged but not blocked. |
| `organization_id` | 21 | `""` | GCP Organization ID for the VPC-SC policy. |
| `enable_audit_logging` | 21 | `false` | Enables detailed Cloud Audit Logs for all supported services. |
