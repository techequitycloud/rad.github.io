# Dify on Google Cloud Run

This document provides a comprehensive reference for the `modules/Dify_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Dify-specific behaviours, and operational patterns for deploying Dify on Google Cloud Run (v2).

---

## 1. Module Overview

Dify is an open-source LLM application development platform with 50,000+ GitHub stars, widely adopted for building production-grade AI applications without deep ML expertise. `Dify_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Dify-specific application configuration, database initialisation, secrets, and storage configuration via `Dify_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Python/Next.js containers, 2 vCPU / 4 Gi default. Min 1 instance to maintain Celery worker availability. A **web** sidecar service (`langgenius/dify-web`) is automatically deployed alongside the API.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15** with `pgvector` extension enabled for vector storage. NFS (GCE VM or Filestore) for shared Redis and task state. GCS `dify-storage` bucket auto-provisioned by `Dify_Common`.
*   **AI Infrastructure**: pgvector reuses the Cloud SQL PostgreSQL instance as the vector store (`VECTOR_STORE=pgvector`). Redis is required for Celery task queue and event bus streaming.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`. `Dify_Common` auto-generates a `SECRET_KEY` secret stored in Secret Manager.
*   **Caching/Queue**: Redis **enabled by default** (`enable_redis = true`) — required for Celery broker, backend, and SSE/WebSocket LLM streaming.
*   **CI/CD**: Cloud Build custom image pipeline; Cloud Deploy progressive delivery optional.
*   **Reliability**: Health probes target `/health` with 30-second initial delay.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'dify'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'Dify - LLM Application Platform'` | Human-readable name shown in the GCP Console. |
| `description` | 3 | `string` | `'Dify - Open-source LLM application development platform...'` | Cloud Run service description. |
| `application_version` | 3 | `string` | `'0.15.0'` | Dify image version tag. Applies to both API and web containers. |

**Wrapper architecture:** `Dify_CloudRun` calls `Dify_Common` to build an `application_config` object containing Dify-specific environment variables, probe configuration, pgvector settings, and the `db-init` job definition. `Dify_CloudRun` hardcodes a `web` additional service (`langgenius/dify-web`) that is deployed alongside the API service. The web service consumes `CLOUDRUN_SERVICE_URL` at runtime via `$(CLOUDRUN_SERVICE_URL)` substitution. `module_storage_buckets` carries the `dify-storage` GCS bucket provisioned by `Dify_Common`. `scripts_dir` is resolved to `abspath("${module.dify_app.path}/scripts")` at apply time.

**PostgreSQL + pgvector note:** `Dify_Common` enables the `vector` PostgreSQL extension automatically. The pgvector integration reuses the Cloud SQL PostgreSQL instance — no separate vector database is required in the default configuration.

---

## 2. IAM & Access Control

`Dify_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**Auto-generated application secret:** `Dify_Common` generates a 64-character random `SECRET_KEY` and stores it in Secret Manager as `<resource_prefix>-secret-key`. This secret is injected as `SECRET_KEY` into the Dify API container at runtime. It is used by Dify for JWT signing and session encryption — do not change it after initial deployment.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket (since `enable_cloudsql_volume = true` by default), using `DB_HOST` (the socket path under `/cloudsql`), `DB_USER`, and `ROOT_PASSWORD` (from Secret Manager).

**30-second secret propagation delay:** `Dify_Common` waits 30 seconds after creating the `SECRET_KEY` secret before proceeding. This allows Secret Manager global replication to complete before the Cloud Run service revision starts.

For the complete role tables and IAP, password rotation, and public access details, see [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Dify is a Python (Flask/Gunicorn) application with embedded Celery workers. The API service runs in supervisord mode — both the API gunicorn process and a Celery worker run inside the same container. A separate `dify-web` Next.js service is deployed as an additional service and communicates with the API via the Cloud Run service URL.

**Startup CPU Boost** is always enabled (hardcoded in `App_CloudRun`).

**Container image:** `Dify_Common` sets `image_source = "custom"` and `container_image = "langgenius/dify-api"`. Cloud Build compiles a custom image using `Dify_Common`'s Dockerfile which wraps the upstream image with supervisord. The web service uses `langgenius/dify-web:<version>` as a prebuilt image.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU minimum; both gunicorn and Celery worker share this allocation. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. 4 Gi recommended; LLM workflow caching can be memory-intensive. |
| `min_instance_count` | 4 | `1` | Minimum instances. At least 1 recommended — Celery workers maintain task queue connections. |
| `max_instance_count` | 4 | `3` | Maximum instances. Acts as a cost ceiling. |
| `container_port` | 4 | `5001` | Dify API server port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration. Increase for long-running LLM inference requests. Range: 0–3600. |
| `enable_cloudsql_volume` | 4 | `true` | Default `true` — Dify connects via Unix socket. |
| `traffic_split` | 4 | `[]` | Percentage-based canary/blue-green traffic allocation. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Dify_CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `5001` | Dify API's native port. |
| `cpu_limit` | `'1000m'` | `'2000m'` | Gunicorn + Celery worker share CPU; 2 vCPU required. |
| `memory_limit` | `'512Mi'` | `'4Gi'` | LLM workflow state, model caching, and RAG pipeline require significant RAM. |
| `min_instance_count` | `0` | `1` | Celery workers maintain broker connections; scale-to-zero disrupts task queues. |
| `enable_nfs` | `false` | `true` | NFS provides shared storage for Redis (co-located on the NFS VM). |
| `enable_redis` | `false` | `true` | Redis is required for Celery broker, backend, and SSE event bus. |

### B. Database (Cloud SQL — PostgreSQL 15)

Dify requires **PostgreSQL** — `Dify_Common` fixes `database_type = "POSTGRES_15"` and enables the `pgvector` extension. The pgvector integration is used by Dify as the default vector store (`VECTOR_STORE=pgvector`), eliminating the need for a separate vector database.

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. Dify requires PostgreSQL. Options: `POSTGRES_15`, `POSTGRES_14`. |
| `db_name` | 12 | `'dify_db'` | PostgreSQL database name. **Do not change after initial deployment.** |
| `db_user` | 12 | `'dify_user'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

> `enable_postgres_extensions` and the `vector` extension are enabled automatically by `Dify_Common` and cannot be disabled.

### C. Storage (NFS & GCS)

**NFS is enabled by default** (`enable_nfs = true`). The NFS server IP is used as the Redis host when `redis_host` is not explicitly set. Requires `execution_environment = 'gen2'`.

**GCS storage bucket:** `Dify_Common` automatically provisions a dedicated `<resource_prefix>-storage` GCS bucket and configures Dify to use it via `STORAGE_TYPE=google-storage`. Workload Identity / ADC handles authentication; no service account JSON key is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisions an NFS volume. Required when Redis is enabled without an external `redis_host`. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip additional bucket creation. The `dify-storage` bucket is always provisioned. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned storage bucket. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `nfs_instance_name` | 9 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Base name for an inline NFS GCE VM when none exists. |
| `manage_storage_kms_iam` | 11 | `false` | Creates a CMEK KMS keyring/key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates an Artifact Registry KMS key and enables at-rest CMEK encryption of container images. |

### D. Networking

Cloud Run uses Direct VPC Egress to reach Cloud SQL's internal IP. Because `enable_cloudsql_volume = true` is the default, the Auth Proxy sidecar handles the Cloud SQL connection via Unix socket.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC. |

### E. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically provisioned by `Dify_Common` when `initialization_jobs` is left as the default empty list (`[]`). It uses the `postgres:15-alpine` image and executes `Dify_Common/scripts/db-init.sh`, which performs idempotent operations to create the Dify database user and database.

Dify runs its own database migrations automatically on startup via `MIGRATION_ENABLED=true` — no additional migration job is required.

Additional recurring cron jobs can be defined via `cron_jobs`:

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Dify_Common` to supply the default `db-init` job. Non-empty list replaces it entirely. |
| `cron_jobs` | 13 | `[]` | Recurring jobs triggered by Cloud Scheduler. Each entry: `name`, `schedule` (cron UTC), `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules (e.g., office VPN, CI/CD egress IPs). |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled directly on the service. Useful for protecting the Dify console from unauthorised access.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

### C. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured in the project. |

### D. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. Auto-discovered when empty. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. Auto-discovered from project when empty. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Secret Manager Integration

Dify application secrets are stored in Secret Manager and injected natively by Cloud Run at revision start.

`Dify_Common` auto-generates one secret:

| Secret | Environment Variable | Description |
|---|---|---|
| `<prefix>-secret-key` | `SECRET_KEY` | 64-character random key for JWT signing and session encryption. |

Additional secrets can be injected via `secret_environment_variables`:

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Map of env var name → Secret Manager secret ID. (e.g., `{ OPENAI_API_KEY = "my-openai-key" }`) |
| `secret_rotation_period` | 6 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Dify traffic through the LB, preventing direct `*.run.app` URL access.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Maximum number of recent container images to keep in Artifact Registry. Set `0` to disable. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged (dangling) images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. Set `0` to disable age-based deletion. |

### C. Custom Domains

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. (e.g., `['dify.example.com']`) |

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. Requires `github_repository_url` and credentials. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT (`repo`, `admin:repo_hook` scopes). Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID (preferred for organisation repos). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Cloud Deploy Pipeline

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages. Each: `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Reliability & Scheduling

### A. Scaling & Concurrency

`min_instance_count = 1` by default. Scale-to-zero is not recommended because Celery workers maintain broker connections to Redis. The `max_instance_count` ceiling prevents unbounded scaling — important when running LLM inference that can consume significant external API quota.

### B. Traffic Splitting

| Variable | Group | Default | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Percentage-based traffic allocation across named revisions. All entries must sum to 100. Empty sends 100% to the latest revision. |

### C. Health Probes & Uptime Monitoring

Dify exposes a `/health` HTTP endpoint. Both startup and liveness probes target this endpoint.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=30, timeout_seconds=10, period_seconds=10, failure_threshold=30 }` | Startup readiness probe. Container receives no traffic until this succeeds. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=30, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Liveness probe. Container is restarted after `failure_threshold` consecutive failures. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/health" }` | Cloud Monitoring uptime check. Alerts notify `support_users` if unreachable. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### D. Auto Password Rotation

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 6 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis Cache & Celery

Redis is **required** for Dify (`enable_redis = true` by default). `Dify_Common` configures three Redis-backed features:
- **Celery broker and backend** — task queue for LLM inference and document indexing jobs (db 1)
- **Event bus** — SSE/WebSocket streaming for real-time LLM output (db 0)
- **Redis cache** — general caching (db 0)

When `enable_redis = true` and `redis_host` is not provided, the module defaults to using the NFS server IP as the Redis host. For production deployments, point `redis_host` at a dedicated Google Cloud Memorystore for Redis instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | **Required.** Enables Redis for Celery task queue and LLM streaming. |
| `redis_host` | 21 | `""` | Redis server hostname or IP. Leave blank to use the NFS server IP. Override with a Memorystore instance for production. |
| `redis_port` | 21 | `'6379'` | Redis server TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Leave empty if the Redis instance does not require authentication. Sensitive. |

### B. LLM Provider Integration

Dify connects to external LLM providers (OpenAI, Anthropic, Azure OpenAI, etc.) through its web console — API keys are configured per workspace via the Dify UI and stored in the application database, not as Terraform variables. Use `secret_environment_variables` only for providers that require environment-level configuration.

### C. Backup Import & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (Drive file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI (e.g., `'gs://my-bucket/dify-2024-01.sql'`) or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` fixed by `Dify_Common` | Dify requires PostgreSQL. MySQL is unsupported. |
| **pgvector enabled** | `enable_postgres_extensions = true`, `postgres_extensions = ["vector"]` | Enables the `vector` extension for pgvector integration. Cannot be disabled. |
| **SECRET_KEY auto-generated** | `google_secret_manager_secret.dify_secret_key` in `Dify_Common` | A 64-character random key is created and injected as `SECRET_KEY`. |
| **MIGRATION_ENABLED=true** | Hardcoded in `Dify_Common` environment_variables | Dify runs Flask-Migrate automatically on startup. No separate migration job is needed. |
| **Web service auto-deployed** | `dify_additional_services` in `dify.tf` | A `langgenius/dify-web:<version>` service is deployed and wired to `$(CLOUDRUN_SERVICE_URL)`. |
| **GCS storage bucket** | `dify-storage` bucket provisioned by `Dify_Common` via `module_storage_buckets` | `STORAGE_TYPE=google-storage`, `GOOGLE_STORAGE_BUCKET_NAME=<prefix>-storage`. |
| **NFS enabled by default** | `enable_nfs = true` default | NFS server provides the Redis host when no external Redis is configured. |
| **Redis enabled by default** | `enable_redis = true` default | Celery and event bus require Redis. Cannot be safely disabled. |
| **Default db-init job** | Supplied by `Dify_Common` when `initialization_jobs = []` | PostgreSQL database and user are created idempotently. Override with non-empty list to replace. |
| **Scripts directory** | `scripts_dir = abspath("${module.dify_app.path}/scripts")` | Initialization scripts are sourced from `Dify_Common`. |

---

## 10. Variable Reference

All user-configurable variables exposed by `Dify_CloudRun`, sorted by UI group then order.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Dify platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | `'https://docs.radmodules.dev/docs/modules/Dify_CloudRun'` | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services_GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users who can access this module regardless of `public_access`. Enforced by the platform. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `impersonation_service_account` | 0 | `""` | SA to impersonate for shell script API calls. Leave empty to use runner credentials. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region fallback when network discovery is unavailable. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'dify'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `'Dify - LLM Application Platform'` | Human-readable name. |
| `description` | 3 | (Dify description text) | Service description. |
| `application_version` | 3 | `'0.15.0'` | Dify image version tag. Applies to both API and web containers. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU minimum. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. 4 Gi recommended. |
| `min_instance_count` | 4 | `1` | Minimum instances. Keep at 1+ for Celery availability. |
| `max_instance_count` | 4 | `3` | Maximum instances. Acts as a cost ceiling. |
| `container_port` | 4 | `5001` | Dify API server port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration. Range: 0–3600. |
| `enable_cloudsql_volume` | 4 | `true` | Mounts the Cloud SQL Auth Proxy Unix socket. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy socket. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Dify image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum number of Cloud Run revisions to keep. Set `0` to disable. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars. Use for non-sensitive Dify config such as `LOG_LEVEL`. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references (e.g., `{ OPENAI_API_KEY = "my-openai-key" }`). |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full URI) or `'gdrive'` (file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
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
| `max_images_to_retain` | 10 | `7` | Maximum number of recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip additional GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `true` | Provisions NFS shared storage. Required for Redis without an external host. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `nfs_instance_name` | 9 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Base name for inline NFS VM. Deployment ID is appended. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. Dify requires PostgreSQL. |
| `db_name` | 12 | `'dify_db'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 12 | `'dify_user'` | PostgreSQL application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Dify_Common` to supply the default `db-init` job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 14 | `{ path="/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Startup probe. |
| `liveness_probe` | 14 | `{ path="/health", initial_delay_seconds=30, failure_threshold=3, ... }` | Liveness probe. |
| `startup_probe_config` | 14 | `{ enabled=true }` | Alternative startup probe. Takes precedence when both are set. |
| `health_check_config` | 14 | `{ enabled=true }` | Alternative liveness probe. Takes precedence when both are set. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `true` | **Required.** Redis for Celery and LLM streaming. |
| `redis_host` | 21 | `""` | Redis hostname/IP. Defaults to NFS server IP when empty. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 11. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the Cloud Run service (Dify API). |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `nfs_server_ip` | NFS server internal IP *(sensitive)*. |
| `nfs_mount_path` | NFS mount path inside containers. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released by GCP approximately **20–30 minutes** after the Cloud Run service is removed.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run the destroy command:

```bash
tofu destroy
```

The second run will succeed once GCP has released the reserved addresses.
