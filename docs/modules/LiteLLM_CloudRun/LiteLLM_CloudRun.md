---
title: "LiteLLM on Google Cloud Run"
sidebar_label: "LiteLLM CloudRun"
---

# LiteLLM on Google Cloud Run

This document provides a comprehensive reference for the `modules/LiteLLM_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, LiteLLM-specific behaviours, and operational patterns for deploying LiteLLM on Google Cloud Run (v2).

---

## 1. Module Overview

LiteLLM is an open-source LLM proxy and AI gateway with 20,000+ GitHub stars that provides a **unified OpenAI-compatible API** across 100+ LLM providers including OpenAI, Anthropic, Google Gemini, Azure OpenAI, Bedrock, Hugging Face, Ollama, and many more. Organizations use LiteLLM to centralize AI spend tracking, manage virtual API keys, enforce rate limits, and gain full visibility over model usage.

`LiteLLM CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects LiteLLM-specific application configuration, database initialization, and secrets via `LiteLLM Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Python container, 2 vCPU / 2 Gi by default. Configurable min/max instances.
*   **Database**: **PostgreSQL 15** (Cloud SQL) for usage logging, cost tracking, virtual key storage, and audit trails. The Foundation Module provisions the Cloud SQL instance; LiteLLM's `db-init.sh` creates the database and user.
*   **Security**: Auto-generated `LITELLM_MASTER_KEY` (prefixed `sk-`) and `LITELLM_SALT_KEY` stored in Secret Manager. Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App CloudRun`.
*   **Redis**: Optional response caching backend. Reduces latency and cost for repeated identical LLM requests.
*   **CI/CD**: Uses a **custom Cloud Build image** by default (`image_source = "custom"`) with a Dockerfile in `LiteLLM_Common/scripts`. Cloud Deploy optional.
*   **Health endpoints**: Uses `/health/readiness` (validates DB connectivity and Prisma migration) for startup, `/health/liveliness` for liveness.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'litellm'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'LiteLLM AI Gateway'` | Human-readable name. |
| `description` | 3 | `string` | `'LiteLLM AI Gateway - Open-source LLM proxy...'` | Service description. |
| `application_version` | 3 | `string` | `'main-stable'` | LiteLLM image version tag. |

**Wrapper architecture:** `LiteLLM CloudRun` calls `LiteLLM Common` to build an `application_config` object containing LiteLLM environment variables (including `PROXY_BASE_URL`, `STORE_MODEL_IN_DB`, Redis settings), the `db-init` Cloud Run Job, and the `litellm-data` GCS bucket. `module_secret_env_vars` carries `LITELLM_MASTER_KEY` and `LITELLM_SALT_KEY`. The `container_port` override (4000) is applied in the `litellm_module` merge.

---

## 2. IAM & Access Control

`LiteLLM CloudRun` delegates all IAM provisioning to `App CloudRun`.

**Application-level secrets:** `LiteLLM Common` auto-generates two secrets:
- `LITELLM_MASTER_KEY` — The primary API key for LiteLLM admin operations. Prefixed `sk-` for OpenAI compatibility. Required for all `/key/generate` and admin endpoint calls.
- `LITELLM_SALT_KEY` — Used for hashing virtual keys. Never expose or rotate without updating all virtual key hashes.

**Cloud SQL Auth Proxy:** `enable_cloudsql_volume = true` by default. LiteLLM connects to PostgreSQL via the Auth Proxy Unix socket at `/cloudsql`. `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD` are injected automatically by `App CloudRun`.

**Database initialization identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA, connecting to Cloud SQL PostgreSQL via the Auth Proxy socket to create the LiteLLM database and user.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU recommended. |
| `memory_limit` | 4 | `'2Gi'` | Memory per instance. 2 Gi recommended for production. |
| `min_instance_count` | 4 | `1` | Minimum instances. Set to 0 for scale-to-zero. |
| `max_instance_count` | 4 | `3` | Maximum instances. |
| `container_port` | 4 | `4000` | LiteLLM's native port. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommended for better networking. |
| `timeout_seconds` | 4 | `600` | Max request duration. Increase for long-running LLM inference. Range: 0–3600. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar for Unix socket connection. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for Auth Proxy socket. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. All entries must sum to 100. |
| `max_revisions_to_retain` | 4 | `7` | Not referenced. Interface compatibility only. |
| `enable_image_mirroring` | 4 | `true` | Mirrors LiteLLM image to Artifact Registry. |

**Differences from `App CloudRun` defaults:**

| Variable | `App CloudRun` | `LiteLLM CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `4000` | LiteLLM's native port. |
| `image_source` | `prebuilt` | `custom` | LiteLLM requires a custom Dockerfile with entrypoint script. |
| `enable_cloudsql_volume` | `true` | `true` | LiteLLM connects to PostgreSQL via Auth Proxy. |
| `startup_probe.path` | `/healthz` | `/health/readiness` | LiteLLM's readiness endpoint validates DB + Prisma migrations. |
| `liveness_probe.path` | `/healthz` | `/health/liveliness` | LiteLLM's dedicated liveness endpoint. |

### B. Database (Cloud SQL — PostgreSQL 15)

LiteLLM uses **PostgreSQL 15** for storing usage logs, virtual keys, model routing rules, and audit trails. The `db-init.sh` script creates the database and user on first deployment.

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | PostgreSQL 15. Do not change — LiteLLM requires PostgreSQL for its Prisma ORM. |
| `db_name` | 12 | `'litellm_db'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 12 | `'litellm_user'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

### C. LiteLLM Application Settings

LiteLLM is configured primarily through environment variables and its `config.yaml`. Key auto-injected vars:

| Env Var | Source | Description |
|---|---|---|
| `LITELLM_MASTER_KEY` | Secret Manager | Primary admin key for LiteLLM API operations. |
| `LITELLM_SALT_KEY` | Secret Manager | Key hashing salt. Never change after virtual keys have been created. |
| `DATABASE_URL` | Auto-assembled | PostgreSQL connection string. Assembled by `entrypoint.sh` from `DB_*` vars. |
| `STORE_MODEL_IN_DB` | LiteLLM Common | `"true"` — model routing config stored in PostgreSQL, not in config.yaml. |
| `PROXY_BASE_URL` | LiteLLM Common | Set to the predicted Cloud Run service URL. |

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{ LITELLM_LOG = "INFO", NUM_WORKERS = "1" }` | Plain-text env vars. Override for custom LiteLLM configuration. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. Use to inject LLM provider API keys. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |

### D. LLM Provider API Keys

LiteLLM provider API keys are **not** automatically managed by this module. Add them via `secret_environment_variables`:

```hcl
secret_environment_variables = {
  OPENAI_API_KEY    = "openai-api-key"
  ANTHROPIC_API_KEY = "anthropic-api-key"
  GEMINI_API_KEY    = "gemini-api-key"
}
```

Alternatively, add keys via the LiteLLM Admin UI or `/key/generate` API after deployment using the `LITELLM_MASTER_KEY`.

### E. Storage

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip additional bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | Provisions a Filestore NFS instance. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |

### F. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. For internal-only use, set `'internal'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |
| `enable_iap` | 5 | `false` | Enables IAP. Note: IAP blocks programmatic API calls from LLM clients. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |

### G. Initialization Jobs

`LiteLLM Common` provides a default `db-init` job that creates the PostgreSQL database and user. Override with a custom list to replace this default.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `LiteLLM Common` to supply the default `db-init` job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN. Note: CDN caching of LLM API responses is not recommended. |

### B. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |

### C. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 5. Redis Caching

LiteLLM uses Redis to cache responses to repeated identical LLM requests, dramatically reducing latency and API costs for high-frequency queries.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis caching by injecting `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`. |
| `redis_host` | 21 | `""` | Redis hostname or IP. Use Cloud Memorystore for production. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |

---

## 7. Reliability & Observability

### A. Health Probes

LiteLLM exposes two health endpoints:
- `/health/readiness` — validates database connectivity and confirms Prisma migrations have completed.
- `/health/liveliness` — confirms the LiteLLM proxy process is running.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/health/readiness", initial_delay_seconds=60, failure_threshold=6 }` | Startup probe. Validates DB connectivity before accepting traffic. |
| `liveness_probe` | 14 | `{ path="/health/liveliness", initial_delay_seconds=30, failure_threshold=3 }` | Liveness probe. |
| `startup_probe_config` | 14 | `{ enabled=true }` | Alternative structured startup probe. |
| `health_check_config` | 14 | `{ enabled=true }` | Alternative structured liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/health/liveliness" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### B. Backup

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated database backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (Drive file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI for the backup file to import. |
| `backup_format` | 7 | `'sql'` | Backup file format. |

---

## 8. Platform-Managed Behaviours

| Behaviour | Detail |
|---|---|
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` fixed by `LiteLLM Common`. LiteLLM's Prisma ORM requires PostgreSQL. |
| **Custom Docker image** | `image_source = "custom"` — a Dockerfile is built via Cloud Build. Required to embed the entrypoint script that assembles `DATABASE_URL` from injected `DB_*` env vars. |
| **LITELLM_MASTER_KEY auto-generated** | Prefixed `sk-` for OpenAI-compatible tooling. Stored in Secret Manager. |
| **LITELLM_SALT_KEY auto-generated** | Used to hash virtual keys. Do not rotate after virtual keys have been issued. |
| **STORE_MODEL_IN_DB = "true"** | Model routing configuration is stored in PostgreSQL, enabling runtime model management via the Admin UI without container restarts. |
| **PROXY_BASE_URL injected** | Set to the predicted Cloud Run service URL to ensure correct redirect URLs. |
| **Default db-init job** | Supplied by `LiteLLM Common` when `initialization_jobs = []`. Creates the PostgreSQL database and user idempotently. |
| **Auth Proxy by default** | `enable_cloudsql_volume = true` — Cloud SQL Auth Proxy sidecar is injected. LiteLLM connects via Unix socket. |

---

## 9. Variable Reference

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (LiteLLM platform text) | Platform metadata. |
| `module_documentation` | 0 | (docs URL) | Platform documentation URL. |
| `module_dependency` | 0 | `['Services GCP']` | Required platform modules. |
| `module_services` | 0 | (GCP service list) | GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users who can access regardless of `public_access`. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account for Terraform resource management. |
| `impersonation_service_account` | 0 | `""` | SA to impersonate for shell script API calls. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all resources. |
| `application_name` | 3 | `'litellm'` | Base resource name. |
| `display_name` | 3 | `'LiteLLM AI Gateway'` | Human-readable name. |
| `description` | 3 | `'LiteLLM AI Gateway...'` | Service description. |
| `application_version` | 3 | `'main-stable'` | Container image tag. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. |
| `memory_limit` | 4 | `'2Gi'` | Memory per instance. |
| `min_instance_count` | 4 | `1` | Minimum instances. |
| `max_instance_count` | 4 | `3` | Maximum instances. |
| `container_port` | 4 | `4000` | LiteLLM's native port. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `execution_environment` | 4 | `'gen2'` | Cloud Run execution environment. |
| `timeout_seconds` | 4 | `600` | Max request duration. Range: 0–3600. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Auth Proxy socket mount path. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Not referenced. Interface compatibility only. |
| `enable_image_mirroring` | 4 | `true` | Mirrors image to Artifact Registry. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 5 | `'all'` | Ingress traffic source restriction. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |
| `enable_iap` | 5 | `false` | Enables IAP. Blocks programmatic API calls. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Plain-text env vars. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references for LLM provider API keys. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 7 | `""` | Full GCS URI or Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | GitHub repository URL. |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | Not referenced. Interface compatibility only. |
| `enable_custom_sql_scripts` | 9 | `false` | Runs custom SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as root DB user. |
| `nfs_instance_name` | 9 | `""` | Name of existing NFS GCE VM. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Base name for inline NFS VM. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN. |
| `max_images_to_retain` | 10 | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Deletes untagged images automatically. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container NFS mount path. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key for storage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key. |
| `database_type` | 12 | `'POSTGRES_15'` | PostgreSQL 15. Required for LiteLLM. |
| `db_name` | 12 | `'litellm_db'` | PostgreSQL database name. |
| `db_user` | 12 | `'litellm_user'` | PostgreSQL application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. |
| `enable_auto_password_rotation` | 12 | `false` | Automated password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Empty = use default `db-init` job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 14 | `{ path="/health/readiness", initial_delay_seconds=60, failure_threshold=6 }` | Startup probe. |
| `liveness_probe` | 14 | `{ path="/health/liveliness", initial_delay_seconds=30, failure_threshold=3 }` | Liveness probe. |
| `startup_probe_config` | 14 | `{ enabled=true }` | Alternative structured startup probe. |
| `health_check_config` | 14 | `{ enabled=true }` | Alternative structured liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/health/liveliness" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `false` | Enables Redis response caching. |
| `redis_host` | 21 | `""` | Redis hostname or IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | VPC Service Controls enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 10. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the LiteLLM Cloud Run service. |
| `service_location` | GCP region where the service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Cloud SQL PostgreSQL instance name. |
| `database_name` | Name of the LiteLLM database. |
| `database_user` | LiteLLM database user. |
| `storage_buckets` | Created GCS storage buckets. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `LITELLM_MASTER_KEY` (auto-generated) | `"sk-<random>"` stored in Secret Manager | **Critical** | The master key controls all administrative access to LiteLLM (creating virtual keys, managing models, viewing usage). Rotating it invalidates the `Authorization: Bearer` header on all existing API integrations. All callers must update their keys immediately after rotation. |
| `LITELLM_SALT_KEY` (auto-generated) | Random secret in Secret Manager | **Critical** | Used to hash and salt all virtual API keys stored in the database. Changing it makes all previously issued virtual keys invalid — they cannot be verified and every API consumer loses access. The only recovery is to regenerate all virtual keys. Treat as permanently immutable. |
| `STORE_MODEL_IN_DB` (via `environment_variables`) | `"True"` | **High** | Required for the LiteLLM Admin UI to manage models and virtual keys via the database. If set to `"False"`, model configuration reverts to the YAML file and the database is not used for key management, breaking the Admin UI workflows. |
| `model_list` / model config YAML | Provided via environment or mounted file | **Critical** | LiteLLM requires at least one model to be configured to serve requests. An empty or malformed model list causes all proxy calls to return 404 or 500 errors. Validate the YAML format before deployment. |
| `database_type` | `"POSTGRES"` | **Critical** | LiteLLM's key management, spend tracking, and audit logging require PostgreSQL. Without a database, virtual key management and usage reporting are completely disabled. |
| `enable_cloudsql_volume` | `true` | **Critical** | Disabling the Cloud SQL Auth Proxy sidecar when using Cloud SQL causes all database connections to fail at startup. LiteLLM crashes with a Prisma connection error. |
| `enable_redis` | `false` | **High** | Without Redis, LiteLLM cannot cache responses, and all multi-instance deployments have isolated in-memory rate limit counters. Enable Redis for accurate rate limiting and response caching across multiple Cloud Run instances. |
| `redis_host` | `""` | **High** | Required when `enable_redis = true`. Leaving empty with Redis enabled causes LiteLLM to fail to connect to Redis on startup and log cache errors for every request. |
| `timeout_seconds` | `600` | **High** | LLM inference calls to slow models (e.g., large reasoning models or remote endpoints with high latency) can exceed several minutes. Insufficient timeout causes proxied requests to be terminated with 504 before the LLM responds. |
| `ingress_settings` | `"all"` | **Critical** | LiteLLM's proxy endpoint is typically called programmatically by other services. `"all"` exposes it publicly. Any holder of a valid virtual key (or the master key if leaked) can make paid API calls. Set to `"internal"` for VPC-only access in multi-service architectures. |
| `enable_iap` | `false` | **High** | IAP blocks all direct API calls since it requires a browser-based OAuth flow. Only enable IAP on the Admin UI path, not the main proxy endpoint — or accept that programmatic API access will require IAP service accounts. |
| `min_instance_count` | `1` | **High** | LiteLLM acts as a shared API gateway. Cold starts (20–40 s) cause request queuing in dependent services. Set to `1` or more for low-latency gateway use. |
| `memory_limit` | `2Gi` | **Medium** | The default 2 Gi is sufficient for standard proxy use. If many models are loaded simultaneously or response caching stores large payloads in memory, increase to 4 Gi. |
| `NUM_WORKERS` (via `environment_variables`) | `"1"` | **Medium** | A single gunicorn worker limits concurrent request throughput. Increase to `2`–`4` for high-throughput proxy deployments. Also increase `cpu_limit` proportionally. |
| `PROXY_BASE_URL` (via `service_url`) | Auto-set from Cloud Run URL | **Medium** | Must match the externally reachable URL. Incorrect values break OpenAI-compatible client auto-configuration and the Swagger docs. |
| `backup_schedule` | `""` (disabled) | **High** | The PostgreSQL database stores all virtual keys, spend records, and audit logs. Without backups, an accidental drop or Cloud SQL deletion loses all key assignments and usage history. |
| `enable_auto_password_rotation` | `false` | **Medium** | Enabling without a `rotation_propagation_delay` can cause a race condition where Cloud Run restarts before the new database password reaches all instances, causing connection failures. |
| `ingress_settings` (Admin UI path) | `"all"` | **High** | The LiteLLM Admin UI is served on the same port as the proxy API. A leaked or brute-forced master key on a publicly accessible endpoint gives an attacker full control over model routing, spend limits, and virtual key management. |
| `execution_environment` | `"gen2"` | **High** | NFS mounts (for config file delivery) and Direct VPC Egress are gen2-only. Always use gen2. |
| `application_version` | `"main-stable"` | **Medium** | LiteLLM updates frequently. Unpinned versions may change the Prisma schema or break existing virtual key formats. Pin to a specific release for production stability. |

## Destroying Resources

When destroying, the Cloud SQL PostgreSQL instance takes 8–12 minutes to delete. See the Serverless IPv4 address release note in the LibreChat CloudRun docs for the VPC subnet deletion timing issue.
