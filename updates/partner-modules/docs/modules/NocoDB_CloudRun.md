# NocoDB on Google Cloud Run

This document provides a comprehensive reference for the `modules/NocoDB_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, NocoDB-specific behaviours, and operational patterns for deploying NocoDB on Google Cloud Run (v2).

---

## 1. Module Overview

NocoDB is an open-source no-code database platform (Airtable alternative) with 45,000+ GitHub stars that transforms any database into a smart spreadsheet with a no-code interface, REST and GraphQL APIs, and built-in automations. `NocoDB CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects NocoDB-specific application configuration, database initialisation, and storage configuration via `NocoDB Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), 1 vCPU / 1 Gi by default. Scale-to-zero (`min_instance_count = 0`) with `max_instance_count = 3` — both are user-configurable.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15** (default). NocoDB also supports MySQL 8.0. NocoDB connects via private IP TCP rather than the Auth Proxy Unix socket because its internal database URL constructor rejects Unix socket paths — `enable_cloudsql_volume` defaults to `false`.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App CloudRun`. `NocoDB Common` does not auto-generate application-level secrets — NocoDB manages its own JWT and encryption keys.
*   **Caching**: Redis **disabled by default** (`enable_redis = false`). Configure `redis_host` and `redis_port` when enabling.
*   **CI/CD**: Cloud Build custom image pipeline by default (`container_image_source = 'custom'`); Cloud Deploy progressive delivery optional.
*   **Health**: Health probes target `/api/v1/health` with 30-second initial delay.
*   **NC_DB_* mapping**: When `container_image_source = 'custom'` (default), a wrapper Dockerfile maps the standard `DB_*` env vars injected by `App_CloudRun` to the `NC_DB_*` variables NocoDB expects. Alternatively, set `container_image_source = 'prebuilt'` and configure `NC_DB_*` variables manually.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'nocodb'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'NocoDB'` | Human-readable name shown in the GCP Console. |
| `application_description` | 3 | `string` | `'NocoDB on Cloud Run'` | Cloud Run service description. |
| `application_version` | 3 | `string` | `'latest'` | NocoDB image version tag. |

**Wrapper architecture:** `NocoDB CloudRun` calls `NocoDB Common` to build an `application_config` object containing NocoDB-specific environment variables and probe configuration. `module_storage_buckets` carries the NocoDB uploads bucket provisioned by `NocoDB Common`. `scripts_dir` is resolved to `abspath("${module.nocodb_app.path}/scripts")` at apply time.

**NC_DB_* note:** The module exposes `db_password_env_var_name`, `db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`, `db_port_env_var_name`, and `service_url_env_var_name` variables to control what additional env var names are populated alongside the standard `DB_*` names. Defaults are `NC_DB_PASSWORD`, `NC_DB_HOST`, `NC_DB_USER`, `NC_DB_NAME`, `NC_DB_PORT`, and `NC_PUBLIC_URL` respectively.

---

## 2. IAM & Access Control

`NocoDB_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**No application-level secrets:** `NocoDB Common` does not auto-generate application secrets such as `NC_AUTH_JWT_SECRET`. NocoDB generates and stores these internally on first boot. User-defined secrets can be added via `secret_environment_variables`.

**Database identity:** NocoDB connects to Cloud SQL PostgreSQL via **private IP TCP** (not Unix socket). `enable_cloudsql_volume` defaults to `false`. The private IP is injected as `DB_HOST` (and `NC_DB_HOST`) by `App CloudRun`.

**120-second IAM propagation delay:** Inherited from `App CloudRun` — the NocoDB service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

NocoDB is a lightweight Node.js application. `NocoDB CloudRun` exposes `cpu_limit` and `memory_limit` with production-ready defaults.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build with NC_DB_* mapping. `'prebuilt'` deploys an existing image URI. |
| `container_image` | 4 | `'nocodb/nocodb'` | Container image URI. Defaults to the official NocoDB Docker Hub image. |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance. |
| `memory_limit` | 4 | `'1Gi'` | Memory per instance. |
| `min_instance_count` | 4 | `0` | Minimum instances. Set to 0 for scale-to-zero. |
| `max_instance_count` | 4 | `3` | Maximum instances. |
| `container_port` | 4 | `8080` | NocoDB's native HTTP port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommended. |
| `timeout_seconds` | 4 | `300` | Max request duration in seconds. |
| `enable_cloudsql_volume` | 4 | `false` | **Disabled by default** — NocoDB connects via private IP TCP, not Unix socket. |
| `cpu_always_allocated` | 4 | `true` | CPU allocated at all times (not only during requests). |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App CloudRun` defaults:**

| Variable | `App CloudRun` | `NocoDB CloudRun` | Reason |
|---|---|---|---|
| `enable_cloudsql_volume` | `true` | `false` | NocoDB's URL constructor rejects Unix socket paths — private IP TCP is used. |
| `container_image` | (app-specific) | `'nocodb/nocodb'` | Official NocoDB Docker Hub image. |
| `cpu_always_allocated` | `false` | `true` | NocoDB performs background sync tasks between requests. |

### B. Database (Cloud SQL — PostgreSQL 15)

NocoDB supports PostgreSQL (default) and MySQL 8.0. `database_type` defaults to `POSTGRES_15`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. Supports `POSTGRES_15`, `MYSQL_8_0`, or `NONE`. |
| `application_database_name` | 12 | `'nocodb'` | Database name. Do not change after initial deployment. |
| `application_database_user` | 12 | `'nocodb'` | Application database user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |
| `sql_instance_name` | 12 | `""` | Existing Cloud SQL instance to use. Leave empty for auto-discovery. |
| `sql_instance_base_name` | 12 | `'app-sql'` | Base name for inline Cloud SQL instance. |
| `db_password_env_var_name` | 12 | `'NC_DB_PASSWORD'` | Additional env var name for the DB password (alongside `DB_PASSWORD`). |
| `db_host_env_var_name` | 12 | `'NC_DB_HOST'` | Additional env var name for the DB host (alongside `DB_HOST`). |
| `db_user_env_var_name` | 12 | `'NC_DB_USER'` | Additional env var name for the DB user (alongside `DB_USER`). |
| `db_name_env_var_name` | 12 | `'NC_DB_NAME'` | Additional env var name for the DB name (alongside `DB_NAME`). |
| `db_port_env_var_name` | 12 | `'NC_DB_PORT'` | Additional env var name for the DB port (alongside `DB_PORT`). |
| `service_url_env_var_name` | 12 | `'NC_PUBLIC_URL'` | Additional env var name for the service URL (alongside `CLOUDRUN_SERVICE_URL`). |

### C. Storage (GCS)

NocoDB stores file uploads in a GCS bucket. `NocoDB Common` auto-provisions a `nocodb-uploads` bucket. The bucket name is injected as `GCS_BUCKET_NAME` into the Cloud Run service.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. NocoDB uses GCS for uploads — NFS not required by default. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path for NFS mount. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |

### D. Networking

NocoDB uses Direct VPC Egress to reach Cloud SQL's private IP.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. |
| `network_name` | 15 | `""` | VPC network name. Leave empty to auto-discover the Services GCP-managed network. |

### E. Initialisation & Bootstrap

NocoDB performs its own database schema migrations on first start — no external `db-init` job is required. The `initialization_jobs` variable defaults to `[]`. Add custom jobs when pre-population or schema seeding is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs run at deployment time. NocoDB handles its own migrations. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `additional_services` | 13 | `[]` | Additional Cloud Run services deployed alongside the main application. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled. Useful for internal NocoDB deployments where only specific Google-authenticated users should access the interface.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/service accounts granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |

### C. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |

### D. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

### E. Secret Manager Integration

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Map of env var name → Secret Manager secret ID. (e.g., `{ NC_AUTH_JWT_SECRET = "nocodb-jwt-secret" }`) |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer & CDN

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Maximum number of recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |

---

## 7. Reliability & Scheduling

### A. Scaling & Concurrency

Unlike Ghost or Django modules, `min_instance_count` and `max_instance_count` are **user-configurable** in NocoDB CloudRun. They default to `0` (scale-to-zero) and `3` respectively. NocoDB is stateless at the request layer — sessions and application state are stored in PostgreSQL.

### B. Health Probes & Uptime Monitoring

NocoDB exposes a dedicated `/api/v1/health` endpoint. All probes target this path.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/v1/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Startup readiness probe. |
| `liveness_probe` | 14 | `{ path="/api/v1/health", initial_delay_seconds=30, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v1/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### C. Auto Password Rotation

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after writing the new secret before restarting the service. |

---

## 8. Integrations

### A. Redis Cache

Redis is **disabled by default** (`enable_redis = false`). NocoDB can use Redis for caching when configured.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis for NocoDB caching. |
| `redis_host` | 21 | `null` | Redis server hostname or IP. Required when `enable_redis = true`. |
| `redis_port` | 21 | `'6379'` | Redis server TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

### B. Backup & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_file` | 7 | `'backup.sql'` | Filename of the backup to import. |
| `backup_format` | 7 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

### C. Custom SQL Scripts

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL default** | `database_type = "POSTGRES_15"` | NocoDB supports both PostgreSQL and MySQL. PostgreSQL 15 is the default. |
| **Private IP connection** | `enable_cloudsql_volume = false` default | NocoDB connects via private IP TCP — the Unix socket path is incompatible with NocoDB's URL constructor. |
| **NC_DB_* env var mapping** | Custom Dockerfile in `NocoDB_Common` | When `container_image_source = 'custom'`, the Dockerfile maps `DB_*` → `NC_DB_*` automatically. |
| **GCS uploads bucket** | `GCS_BUCKET_NAME` env var injected in `nocodb.tf` | Uploads bucket name is computed as `app<name><tenant><id>-nocodb-uploads` and injected as `GCS_BUCKET_NAME`. |
| **Scale-to-zero** | `min_instance_count = 0` default | User-configurable, unlike Ghost. |
| **No auto-generated app secrets** | `NocoDB Common` does not create `NC_AUTH_JWT_SECRET` | NocoDB manages its own JWT keys at runtime. Use `secret_environment_variables` for custom secrets. |

---

## 10. Variable Reference

All user-configurable variables exposed by `NocoDB CloudRun`, sorted by UI group. Group 0 variables are reserved for platform metadata.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (NocoDB platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | (docs URL) | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users who can access the module regardless of `public_access`. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region for resource deployment. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'nocodb'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `'NocoDB'` | Human-readable name. |
| `application_description` | 3 | `'NocoDB on Cloud Run'` | Service description. |
| `application_version` | 3 | `'latest'` | NocoDB container image tag. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build with NC_DB_* mapping) or `'prebuilt'` (existing image). |
| `container_image` | 4 | `'nocodb/nocodb'` | Container image URI. |
| `container_build_config` | 4 | `{ enabled=true }` | Build configuration for Cloud Build custom builds. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the NocoDB image into Artifact Registry. |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance. |
| `memory_limit` | 4 | `'1Gi'` | Memory per instance. |
| `min_instance_count` | 4 | `0` | Minimum instances. 0 enables scale-to-zero. |
| `max_instance_count` | 4 | `3` | Maximum instances. |
| `container_port` | 4 | `8080` | NocoDB's native port. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommended. |
| `timeout_seconds` | 4 | `300` | Max request duration. |
| `cpu_always_allocated` | 4 | `true` | CPU allocated at all times (not only during requests). |
| `enable_cloudsql_volume` | 4 | `false` | **Disabled** — NocoDB connects via private IP TCP. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy Unix socket (if enabled). |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum number of Cloud Run revisions to keep. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |
| `enable_iap` | 5 | `false` | Enables IAP on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_file` | 7 | `'backup.sql'` | Backup filename to import. |
| `backup_format` | 7 | `'sql'` | Backup format. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days before images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `nfs_instance_name` | 11 | `""` | Existing NFS instance name. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Base name for inline NFS VM. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key. |
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. `POSTGRES_15`, `MYSQL_8_0`, or `NONE`. |
| `application_database_name` | 12 | `'nocodb'` | Database name. Do not change after initial deployment. |
| `application_database_user` | 12 | `'nocodb'` | Database application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting. |
| `sql_instance_name` | 12 | `""` | Existing Cloud SQL instance name. Leave empty for auto-discovery. |
| `sql_instance_base_name` | 12 | `'app-sql'` | Base name for inline Cloud SQL instance. |
| `db_password_env_var_name` | 12 | `'NC_DB_PASSWORD'` | Additional env var name for DB password. |
| `db_host_env_var_name` | 12 | `'NC_DB_HOST'` | Additional env var name for DB host. |
| `db_user_env_var_name` | 12 | `'NC_DB_USER'` | Additional env var name for DB user. |
| `db_name_env_var_name` | 12 | `'NC_DB_NAME'` | Additional env var name for DB name. |
| `db_port_env_var_name` | 12 | `'NC_DB_PORT'` | Additional env var name for DB port. |
| `service_url_env_var_name` | 12 | `'NC_PUBLIC_URL'` | Additional env var name for service URL. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. NocoDB handles its own migrations. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `additional_services` | 13 | `[]` | Additional Cloud Run services deployed alongside the main application. |
| `startup_probe` | 14 | `{ path="/api/v1/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Startup probe. |
| `liveness_probe` | 14 | `{ path="/api/v1/health", initial_delay_seconds=30, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v1/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `false` | Redis for NocoDB caching. Disabled by default. |
| `redis_host` | 21 | `null` | Redis hostname/IP. Required when `enable_redis = true`. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |
| `additional_cloudrun_sa_roles` | — | `[]` | Extra IAM roles for the Cloud Run service account. |

---

## 11. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the Cloud Run service. |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `NC_AUTH_JWT_SECRET` (via Secret Manager) | Auto-generated 32-char random string | **Critical** | The module auto-generates this secret and injects it as `NC_AUTH_JWT_SECRET`. Changing or rotating this value after the first deployment immediately invalidates all existing user sessions and API tokens. All users are forcibly logged out. Treat as immutable after first deploy. |
| `NC_PUBLIC_URL` | Auto-set from Cloud Run service URL | **High** | NocoDB uses this value to construct absolute URLs in email notifications, webhooks, and share links. An incorrect value causes all share links and webhook callbacks to point to the wrong origin. This is controlled by `service_url_env_var_name`, which defaults to `"NC_PUBLIC_URL"` — do not change this variable name. |
| `GCS_BUCKET_NAME` | Auto-set from module output | **High** | Do not override. The module injects this as the NocoDB upload/attachment storage backend. An incorrect bucket name causes all file attachments to fail silently. |
| `application_database_name` | `"nocodb"` | **High** | Changing after the database is initialised orphans the NocoDB application schema and all table/view metadata. Immutable after first apply. |
| `application_database_user` | `"nocodb"` | **High** | Created by the db-init job. Renaming requires manual Cloud SQL intervention. Immutable after first apply. |
| `memory_limit` | `"1Gi"` | **High** | Under 512Mi the NocoDB Node.js process is OOM-killed on startup. `"1Gi"` is the minimum for small deployments; production workloads with many views/automations need `"2Gi"`. |
| `enable_cloudsql_volume` | `true` | **Critical** | Required for the Cloud SQL Auth Proxy sidecar. Disabling with a PostgreSQL backend causes all database connections to fail. |
| `enable_redis` | `false` | **Medium** | Without Redis, NocoDB cannot share session state or cache results across multiple instances. Required when `max_instance_count > 1`. Enabling without a valid `redis_host` raises a validation error. |
| `redis_host` | `null` | **High** | Required when `enable_redis = true`. An empty host causes all Redis connections to fail on startup. If `enable_nfs = true`, the NFS server IP is used as the default Redis host. |
| `NC_REDIS_URL` format | Auto-built from `redis_host`/`redis_port`/`redis_auth` | **High** | If manually overriding via `environment_variables`, the URL must follow `redis://:password@host:port` or `redis://host:port`. An invalid format causes NocoDB to start without Redis even if `enable_redis = true`. |
| `min_instance_count` | `1` | **High** | Scale-to-zero causes cold starts of 10–20 s. Webhook callbacks fired during this window will time out and be dropped by the sending service. |
| `max_instance_count` | `10` | **Medium** | Running multiple instances without Redis causes users' sessions to be invalidated when routed to a different instance. Always enable Redis before increasing above `1`. |
| `enable_iap` | `false` | **High** | Without IAP the NocoDB interface is publicly accessible. For internal workspaces, enable IAP or restrict `ingress_settings`. |
| `ingress_settings` | `"all"` | **High** | Leaves NocoDB reachable from the public internet. For internal-only deployments set to `"internal-and-cloud-load-balancing"`. |
| `application_version` | `"latest"` | **Medium** | Pinning to a specific version is recommended. `"latest"` triggers uncontrolled upgrades on every container rebuild. |
| `cpu_always_allocated` | `false` | **Medium** | NocoDB has background automation and webhook retry logic. With `false`, the CPU is throttled to near-zero when the request ends, causing background tasks to stall until the next request arrives. Set to `true` for automation-heavy workloads. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | Disabling automated backups leaves all NocoDB table schemas, views, automations, and row data unprotected. |
| `timeout_seconds` | `300` | **Medium** | Bulk import/export operations on large tables can exceed 5 minutes. Reducing below 120 s causes these operations to be aborted mid-run. |
| `enable_auto_password_rotation` | `false` | **Medium** | Enabling without sufficient `rotation_propagation_delay_sec` causes brief intervals of DB connectivity failures during the rotation window. |
| `secret_propagation_delay` | `"30s"` | **Low** | Reducing below 15 s causes the Cloud Run service to start before the Secret Manager secret is fully propagated, resulting in a failed first startup that requires a manual revision deployment. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released by GCP approximately **20–30 minutes** after the Cloud Run service is removed.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run:

```bash
tofu destroy
```
