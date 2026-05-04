# Ollama_CloudRun Module — Configuration Guide

Ollama is an open-source LLM inference server that serves large language models such as Llama,
Mistral, Gemma, and Phi via a REST API on port 11434. This module deploys Ollama on **Google
Cloud Run** (serverless, CPU-only) with model weights persisted to a GCS Fuse volume so that
container restarts load models from storage rather than re-downloading them.

`Ollama_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It delegates all GCP
infrastructure provisioning to App_CloudRun (Cloud Run service, networking, Secret Manager, GCS,
CI/CD) and uses an `Ollama_Common` sub-module to supply Ollama-specific application
configuration, the GCS models bucket, and the optional model-pull initialization job. The
`Ollama_Common` outputs feed into App_CloudRun's `application_config`, `module_storage_buckets`,
and `scripts_dir` inputs.

> This module is designed as a **shared AI inference endpoint**. Any workload in the same VPC
> can call `http://<service-url>:11434`. For GPU-accelerated inference use `Ollama_GKE` with an
> NVIDIA L4 node pool.

---

## §1 · Module Overview

### What `Ollama_CloudRun` provides

- An **Ollama container** (prebuilt image `ollama/ollama` from Docker Hub,
  `enable_image_mirroring = true` by default) deployed on Cloud Run listening on port `11434`.
- A **GCS bucket** (`<resource_prefix>-models`) mounted via GCS Fuse at `/mnt/gcs`. The
  environment variable `OLLAMA_MODELS` is set to `/mnt/gcs/ollama/models` so model weights
  survive container restarts and new revisions load instantly from GCS.
- An optional **model-pull initialization job** (Cloud Run Job) that starts a local Ollama
  server in the background, pulls the specified model, and stores it in the GCS bucket. This
  job only runs when `default_model` is non-empty and `initialization_jobs = []`.
- **No database, no Redis, no NFS** — Ollama is stateless beyond its GCS-backed model cache.

### Key differences from `App_CloudRun` defaults

| Feature | App_CloudRun default | Ollama_CloudRun default |
|---|---|---|
| `container_port` | `8080` | `11434` |
| `cpu_limit` | `"1000m"` | `"4000m"` |
| `memory_limit` | `"512Mi"` | `"8Gi"` |
| `min_instance_count` | `0` | `1` |
| `max_instance_count` | `1` | `1` |
| `ingress_settings` | `"all"` | `"internal"` |
| `execution_environment` | `"gen1"` | `"gen2"` (required for GCS Fuse) |
| `timeout_seconds` | `60` | `3600` |
| `enable_redis` | varies | **always `false`** (hard-coded) |
| Database | varies | **`NONE`** (hard-coded, no Cloud SQL) |
| GCS models bucket | none | auto-provisioned via Ollama_Common |
| Model-pull job | none | auto-generated when `default_model` is set |
| Auto-injected env vars | none | `OLLAMA_MODELS`, `OLLAMA_HOST`, `OLLAMA_KEEP_ALIVE` |

---

## §2 · IAM & Project Identity

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | **required** | GCP project into which all resources are deployed. |
| `tenant_deployment_id` | `string` | `"demo"` | Short suffix appended to resource names. 1–20 lowercase letters, numbers, hyphens. |
| `resource_creator_identity` | `string` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Service account used by Terraform. |
| `support_users` | `list(string)` | `[]` | Email addresses granted IAM access and added to monitoring alert channels. |
| `resource_labels` | `map(string)` | `{}` | Labels applied to all module-managed resources. |
| `module_description` | `string` | *(Ollama_CloudRun description)* | Platform UI description. |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/applications/ollama"` | External documentation URL. |
| `module_dependency` | `list(string)` | `["Services_GCP"]` | Modules that must be deployed before this one. |
| `module_services` | `list(string)` | *(GCP service list)* | GCP services consumed by this module. |
| `credit_cost` | `number` | `100` | Platform credits consumed on deployment. |
| `require_credit_purchases` | `bool` | `true` | Enforce credit balance check before deployment. |
| `enable_purge` | `bool` | `true` | Permit full deletion of all module resources on destroy. |
| `public_access` | `bool` | `false` | Controls platform UI visibility. |
| `deployment_id` | `string` | `""` | Optional fixed deployment ID. Auto-generated when blank. |

---

## §3 · Core Service Configuration

### §3.A · Application Identity

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"ollama"` | Base name for the Cloud Run service, Artifact Registry repo, and GCS bucket. Do not change after initial deployment. |
| `application_display_name` | `string` | `"Ollama LLM Server"` | Human-readable name shown in the platform UI. |
| `description` | `string` | `"Ollama — standalone open-source LLM inference server..."` | Brief description surfaced in resource metadata. |
| `application_version` | `string` | `"latest"` | Ollama Docker image tag. Use a pinned tag (e.g. `"0.3.12"`) in production. |

### §3.B · Ollama Model Configuration (Group 18)

These are the Ollama-specific variables that have no equivalent in other wrapper modules.

| Variable | Type | Default | Description |
|---|---|---|---|
| `default_model` | `string` | `""` | Model to pull on first deployment. Examples: `"llama3.2:3b"` (~2 GB), `"mistral"` (~4 GB), `"llama3:8b"` (~5 GB). Leave empty to skip the auto-pull job. Stored in GCS and loaded on every startup. |
| `model_pull_timeout_seconds` | `number` | `3600` | Timeout in seconds for the model-pull initialization job. Large models can take 10–30 minutes on first pull. Valid range: 300–7200. |

When `default_model` is set and `initialization_jobs` is empty, the module automatically
creates a Cloud Run Job named `model-pull` that:
1. Starts a local Ollama server in the background.
2. Polls `http://localhost:11434/` until ready (up to 30 retries, 3 seconds apart).
3. Runs `ollama pull $OLLAMA_MODEL`.
4. Shuts down the server.

The job mounts the `ollama-models` GCS volume so the pulled weights persist into the shared
models bucket.

### §3.C · Runtime & Scaling (Group 3)

| Variable | Type | Default | Description |
|---|---|---|---|
| `deploy_application` | `bool` | `true` | Set `false` to provision storage and IAM without deploying the Cloud Run service. |
| `cpu_limit` | `string` | `"4000m"` | CPU limit per container. 3B models: `"4000m"`; 7B models: `"8000m"`. Cloud Run max is `"8"`. |
| `memory_limit` | `string` | `"8Gi"` | Memory limit per container. 3B models: `"8Gi"`; 7B models: `"16Gi"`. |
| `min_instance_count` | `number` | `1` | Minimum instances. `1` keeps a warm instance to avoid 60–120 s cold-start model loading. `0` enables scale-to-zero at the cost of latency. |
| `max_instance_count` | `number` | `1` | Maximum concurrent instances. LLM inference is CPU-saturating; multiple instances rarely help unless requests are fully independent. |
| `execution_environment` | `string` | `"gen2"` | Cloud Run execution generation. `"gen2"` is **required** for GCS Fuse support. |
| `timeout_seconds` | `number` | `3600` | Maximum request duration. Inference on large prompts can be slow — 3600 s is the maximum. Valid range: 0–3600. |
| `container_protocol` | `string` | `"http1"` | HTTP protocol. Use `"h2c"` only if all callers support HTTP/2 cleartext. |
| `traffic_split` | `list(object)` | `[]` | Traffic allocation across Cloud Run revisions. Empty sends all traffic to the latest revision. All entries must sum to 100. |
| `enable_image_mirroring` | `bool` | `true` | Mirror `ollama/ollama` to Artifact Registry before deployment to avoid Docker Hub rate limits. |
| `service_annotations` | `map(string)` | `{}` | Custom annotations applied to the Cloud Run service. |
| `service_labels` | `map(string)` | `{}` | Custom labels applied to the Cloud Run service. |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Required by the App_CloudRun interface; not used by Ollama (no database). |

### §3.D · Automatically Injected Environment Variables

The following environment variables are set automatically by `Ollama_Common` and must not be
overridden in `environment_variables`:

| Variable | Value | Purpose |
|---|---|---|
| `OLLAMA_MODELS` | `"/mnt/gcs/ollama/models"` | Points Ollama at the GCS Fuse subdirectory for model persistence. |
| `OLLAMA_HOST` | `"0.0.0.0:11434"` | Binds to all interfaces so Cloud Run can forward traffic. |
| `OLLAMA_KEEP_ALIVE` | `"24h"` | Keeps loaded model in memory between requests to reduce per-request latency. |

Additional variables can be passed via `environment_variables` (e.g. `OLLAMA_NUM_PARALLEL`
to allow concurrent inferences on multi-CPU instances).

### §3.E · Environment Variables & Secrets (Group 5)

| Variable | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Additional plain-text env vars. The three Ollama-specific vars above are injected automatically. |
| `secret_environment_variables` | `map(string)` | `{}` | Map of env var name → Secret Manager secret name, injected at runtime. |
| `secret_propagation_delay` | `number` | `30` | Seconds to wait after secret creation before proceeding. Valid range: 0–300. |
| `secret_rotation_period` | `string` | `"2592000s"` | Pub/Sub rotation notification period (30 days). Set to `null` to disable. Format: `"<seconds>s"`. |
| `enable_auto_password_rotation` | `bool` | `false` | Not applicable for Ollama (no database). |
| `rotation_propagation_delay_sec` | `number` | `90` | Seconds to wait after rotation before restarting the service. |

### §3.F · Access & Networking (Group 4)

The default `ingress_settings = "internal"` is intentional — the Ollama API is designed to
be called from within the same VPC by other applications (Flowise, N8N, RAGFlow, Django)
rather than from the public internet.

| Variable | Type | Default | Options | Description |
|---|---|---|---|---|
| `ingress_settings` | `string` | `"internal"` | `all` / `internal` / `internal-and-cloud-load-balancing` | `"internal"` restricts access to the VPC. Use `"all"` only if external callers need direct API access. |
| `vpc_egress_setting` | `string` | `"PRIVATE_RANGES_ONLY"` | `ALL_TRAFFIC` / `PRIVATE_RANGES_ONLY` | Routes only RFC 1918 outbound traffic via VPC. |
| `enable_iap` | `bool` | `false` | | Enable Identity-Aware Proxy. |
| `iap_authorized_users` | `list(string)` | `[]` | | Users granted access through IAP. |
| `iap_authorized_groups` | `list(string)` | `[]` | | Google Groups granted access through IAP. |
| `enable_vpc_sc` | `bool` | `false` | | Enable VPC Service Controls perimeter enforcement. |
| `vpc_cidr_ranges` | `list(string)` | `[]` | | VPC subnet CIDR ranges for the VPC-SC network access level. |
| `vpc_sc_dry_run` | `bool` | `true` | | Log VPC-SC violations without blocking. |
| `organization_id` | `string` | `""` | | GCP Organization ID for VPC-SC Access Context Manager. |
| `enable_audit_logging` | `bool` | `false` | | Enable detailed Cloud Audit Logs. |
| `admin_ip_ranges` | `list(string)` | `[]` | | CIDR ranges for administrative access. |
| `enable_cloud_armor` | `bool` | `false` | | Enable Cloud Armor WAF fronted by a Global HTTPS Load Balancer. |
| `application_domains` | `list(string)` | `[]` | | Custom domain names for the Cloud Armor load balancer. |
| `enable_cdn` | `bool` | `false` | | Enable Cloud CDN on the Global HTTPS Load Balancer. |

---

## §4 · Storage & Filesystem (Group 10)

The Ollama models bucket is always provisioned automatically — no user configuration is
required to enable GCS model persistence.

| Variable | Type | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | `bool` | `true` | Provision GCS buckets defined in `storage_buckets`. The models bucket is always created regardless. |
| `storage_buckets` | `list(object)` | `[]` | Additional GCS buckets to provision beyond the Ollama models bucket. |
| `enable_nfs` | `bool` | `false` | Provision and mount a Cloud Filestore NFS volume. Not required for Ollama (uses GCS). |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | Filesystem path for the NFS volume. |
| `nfs_instance_name` | `string` | `""` | Name of an existing NFS GCE VM. Auto-discovered when empty. |
| `nfs_instance_base_name` | `string` | `"app-nfs"` | Base name for an inline NFS GCE VM. |
| `gcs_volumes` | `list(object)` | `[]` | Additional GCS buckets to mount as GCS Fuse volumes. The `ollama-models` bucket is always appended automatically. |
| `manage_storage_kms_iam` | `bool` | `false` | Create a CMEK KMS key for GCS encryption. |
| `enable_artifact_registry_cmek` | `bool` | `false` | Enable CMEK encryption for Artifact Registry. |

**GCS volume layout:**

```
<resource_prefix>-models/          ← GCS bucket root
└── ollama/
    └── models/                    ← /mnt/gcs/ollama/models (OLLAMA_MODELS)
```

---

## §5 · Backup & Maintenance (Group 6)

Ollama has no database — backup and import settings are present for interface compatibility
with App_CloudRun but have no operational effect.

| Variable | Type | Default | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `""` | Not applicable for Ollama. Models are stored durably in GCS. |
| `backup_retention_days` | `number` | `7` | Days to retain backup files. |
| `enable_backup_import` | `bool` | `false` | Not applicable for Ollama. |
| `backup_source` | `string` | `"gcs"` | Source system: `"gcs"` or `"gdrive"`. |
| `backup_uri` | `string` | `""` | Location of the backup file. |
| `backup_format` | `string` | `"sql"` | Format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## §6 · CI/CD Integration (Group 7)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | `bool` | `false` | Create a Cloud Build trigger on GitHub pushes. |
| `github_repository_url` | `string` | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | `string` | `""` | GitHub Personal Access Token. Sensitive. |
| `github_app_installation_id` | `string` | `""` | Cloud Build GitHub App installation ID. |
| `cicd_trigger_config` | `object` | `{ branch_pattern = "^main$" }` | Branch filter, included/ignored paths, trigger name, and build substitutions. |
| `enable_cloud_deploy` | `bool` | `false` | Switch to a Cloud Deploy pipeline with promotion stages. |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod(approval)]` | Ordered promotion stages. |
| `enable_binary_authorization` | `bool` | `false` | Enforce Binary Authorization for signed container images. |

### Artifact Registry Image Lifecycle

| Variable | Type | Default | Description |
|---|---|---|---|
| `max_images_to_retain` | `number` | `7` | Maximum number of recent images to keep in Artifact Registry. |
| `delete_untagged_images` | `bool` | `true` | Delete untagged (dangling) images automatically. |
| `image_retention_days` | `number` | `30` | Days after which images are eligible for deletion. `0` disables age-based deletion. |
| `max_revisions_to_retain` | `number` | `7` | Maximum Cloud Run revisions to keep after each deployment. |

---

## §7 · Custom Initialization & Jobs (Group 8)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | `bool` | `false` | Not applicable for Ollama. |
| `custom_sql_scripts_bucket` | `string` | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | `string` | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | `bool` | `false` | Execute scripts as root database user. |
| `initialization_jobs` | `list(object)` | `[]` | Cloud Run jobs executed once during deployment. When non-empty, overrides the automatic model-pull job entirely. See §3.B for the auto-generated job schema. |
| `cron_jobs` | `list(object)` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |

---

## §8 · Database Backend (Group 11)

Ollama has no database dependency. Redis is also disabled for this module.

| Variable | Type | Default | Description |
|---|---|---|---|
| `database_password_length` | `number` | `32` | Not used by Ollama. Present for App_CloudRun interface compatibility. Valid range: 16–64. |

**Hard-coded values (not user-configurable):**
- `enable_redis = false`
- `database_type = "NONE"` (set via `Ollama_Common`)

---

## §9 · Observability & Health (Group 13)

Ollama's root endpoint (`/`) responds with `"Ollama is running"` once the server is
ready. Probes target this path.

| Variable | Type | Default | Description |
|---|---|---|---|
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=30, timeout_seconds=5, period_seconds=15, failure_threshold=20 }` | Startup probe forwarded through Ollama_Common. The 30 s initial delay and 20-attempt threshold allow up to ~5 minutes for model loading from GCS on first start. |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. 60 s initial delay avoids false restarts during the model-load phase. |
| `startup_probe_config` | `object` | `{ enabled=true }` | Structured startup probe passed directly to App_CloudRun (240 s timeout by default). |
| `health_check_config` | `object` | `{ enabled=true }` | Structured liveness probe passed directly to App_CloudRun. |
| `uptime_check_config` | `object` | `{ enabled=true, path="/", check_interval="60s", timeout="10s" }` | Cloud Monitoring uptime check from multiple global locations. |
| `alert_policies` | `list(object)` | `[]` | Cloud Monitoring alert policies notifying `support_users`. |

---

## §10 · Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Cloud Run service URL (HTTPS). |
| `ollama_api_url` | Ollama REST API base URL — append `/api/generate`, `/api/chat`, etc. Constructed as `<service_url>/api`. |
| `service_location` | GCP region of the Cloud Run service. |
| `models_bucket` | GCS bucket name where Ollama model weights are persisted (`<resource_prefix>-models`). |
| `storage_buckets` | All provisioned GCS buckets. |
| `network_name` | VPC network name. |
| `network_exists` | Whether the VPC network exists. |
| `regions` | Available regions in the VPC. |
| `container_image` | Container image URI used by the service. |
| `container_registry` | Artifact Registry repository name. |
| `deployment_id` | Unique deployment identifier. |
| `tenant_id` | Tenant identifier. |
| `resource_prefix` | Resource naming prefix (`app<name><tenant><id>`). |
| `project_id` | GCP project ID. |
| `project_number` | GCP project number. |
| `monitoring_enabled` | Whether Cloud Monitoring is configured. |
| `monitoring_notification_channels` | Monitoring notification channel names. |
| `uptime_check_names` | Uptime check configuration names. |
| `initialization_jobs` | Created initialization job names. |
| `nfs_server_ip` | NFS server internal IP (sensitive). |
| `nfs_mount_path` | NFS mount path in containers. |
| `nfs_share_path` | NFS share path on server. |
| `nfs_setup_job` | NFS setup job name. |
| `stage_services` | Map of stage names to Cloud Run service details (for Cloud Deploy). |
| `deployment_summary` | Summary of the deployment configuration. |
| `cicd_enabled` | Whether CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |
| `github_repository_owner` | GitHub repository owner/organization. |
| `github_repository_name` | GitHub repository name. |
| `artifact_registry_repository` | Artifact Registry repository. |
| `cloudbuild_trigger_name` | Cloud Build trigger name. |
| `cloudbuild_trigger_id` | Cloud Build trigger ID. |
| `cicd_configuration` | CI/CD pipeline configuration details. |

---

## §11 · Platform-Managed Behaviours

The following behaviours are applied automatically and cannot be overridden via `tfvars`.

| Behaviour | Detail |
|---|---|
| **`OLLAMA_MODELS` injected** | Set to `/mnt/gcs/ollama/models` — the GCS Fuse subdirectory inside the auto-provisioned models bucket. Do not set this in `environment_variables`. |
| **`OLLAMA_HOST` injected** | Set to `"0.0.0.0:11434"` so Cloud Run's ingress can forward traffic to the container. |
| **`OLLAMA_KEEP_ALIVE` injected** | Set to `"24h"` to keep the loaded model resident in memory between requests. Override by setting `OLLAMA_KEEP_ALIVE` in `environment_variables`. |
| **Models bucket always provisioned** | The `<resource_prefix>-models` GCS bucket is always created via `Ollama_Common.storage_buckets`, regardless of `create_cloud_storage` or `storage_buckets` settings. |
| **GCS volume always mounted** | The `ollama-models` volume is always appended to `gcs_volumes`. Additional volumes specified in `gcs_volumes` are merged before the models volume. |
| **`execution_environment = "gen2"` default** | GCS Fuse requires the Cloud Run gen2 execution environment. The default enforces this. |
| **No database, no Redis** | `enable_redis = false` and `database_type = "NONE"` are hard-coded in `main.tf`. These cannot be changed. |
| **Model-pull job auto-generated** | When `default_model` is set and `initialization_jobs = []`, a Cloud Run Job (`model-pull`) is created automatically using the `scripts/model-pull.sh` script from `Ollama_Common`. Providing any entry in `initialization_jobs` disables the auto-generated job entirely. |
| **`scripts_dir`** | Set to `Ollama_Common`'s bundled `scripts/` directory. |

---

## §12 · Variable Reference

Complete variable reference with UIMeta group assignments.

| Variable | Default | Group |
|---|---|---|
| `module_description` | *(Ollama CloudRun description)* | 0 |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/ollama"` | 0 |
| `module_dependency` | `["Services_GCP"]` | 0 |
| `module_services` | *(list of GCP services)* | 0 |
| `credit_cost` | `100` | 0 |
| `require_credit_purchases` | `true` | 0 |
| `enable_purge` | `true` | 0 |
| `public_access` | `false` | 0 |
| `deployment_id` | `""` | 0 |
| `resource_creator_identity` | `"rad-module-creator@..."` | 0 |
| `project_id` | *(required)* | 1 |
| `tenant_deployment_id` | `"demo"` | 1 |
| `support_users` | `[]` | 1 |
| `resource_labels` | `{}` | 1 |
| `application_name` | `"ollama"` | 2 |
| `application_display_name` | `"Ollama LLM Server"` | 2 |
| `description` | `"Ollama — standalone open-source LLM inference server..."` | 2 |
| `application_version` | `"latest"` | 2 |
| `deploy_application` | `true` | 3 |
| `cpu_limit` | `"4000m"` | 3 |
| `memory_limit` | `"8Gi"` | 3 |
| `min_instance_count` | `1` | 3 |
| `max_instance_count` | `1` | 3 |
| `execution_environment` | `"gen2"` | 3 |
| `timeout_seconds` | `3600` | 3 |
| `container_protocol` | `"http1"` | 3 |
| `traffic_split` | `[]` | 3 |
| `enable_image_mirroring` | `true` | 3 |
| `service_annotations` | `{}` | 3 |
| `service_labels` | `{}` | 3 |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | 3 |
| `ingress_settings` | `"internal"` | 4 |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | 4 |
| `enable_iap` | `false` | 4 |
| `iap_authorized_users` | `[]` | 4 |
| `iap_authorized_groups` | `[]` | 4 |
| `enable_vpc_sc` | `false` | 4 |
| `vpc_cidr_ranges` | `[]` | 4 |
| `vpc_sc_dry_run` | `true` | 4 |
| `organization_id` | `""` | 4 |
| `enable_audit_logging` | `false` | 4 |
| `admin_ip_ranges` | `[]` | 4 |
| `enable_cloud_armor` | `false` | 4 |
| `application_domains` | `[]` | 4 |
| `enable_cdn` | `false` | 4 |
| `environment_variables` | `{}` | 5 |
| `secret_environment_variables` | `{}` | 5 |
| `secret_propagation_delay` | `30` | 5 |
| `secret_rotation_period` | `"2592000s"` | 5 |
| `enable_auto_password_rotation` | `false` | 5 |
| `rotation_propagation_delay_sec` | `90` | 5 |
| `backup_schedule` | `""` | 6 |
| `backup_retention_days` | `7` | 6 |
| `enable_backup_import` | `false` | 6 |
| `backup_source` | `"gcs"` | 6 |
| `backup_uri` | `""` | 6 |
| `backup_format` | `"sql"` | 6 |
| `enable_cicd_trigger` | `false` | 7 |
| `github_repository_url` | `""` | 7 |
| `github_token` | `""` | 7 |
| `github_app_installation_id` | `""` | 7 |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | 7 |
| `enable_cloud_deploy` | `false` | 7 |
| `cloud_deploy_stages` | `[dev, staging, prod(approval)]` | 7 |
| `enable_binary_authorization` | `false` | 7 |
| `enable_custom_sql_scripts` | `false` | 8 |
| `custom_sql_scripts_bucket` | `""` | 8 |
| `custom_sql_scripts_path` | `""` | 8 |
| `custom_sql_scripts_use_root` | `false` | 8 |
| `initialization_jobs` | `[]` | 8 |
| `cron_jobs` | `[]` | 8 |
| `create_cloud_storage` | `true` | 10 |
| `storage_buckets` | `[]` | 10 |
| `enable_nfs` | `false` | 10 |
| `nfs_mount_path` | `"/mnt/nfs"` | 10 |
| `nfs_instance_name` | `""` | 10 |
| `nfs_instance_base_name` | `"app-nfs"` | 10 |
| `gcs_volumes` | `[]` | 10 |
| `manage_storage_kms_iam` | `false` | 10 |
| `enable_artifact_registry_cmek` | `false` | 10 |
| `database_password_length` | `32` | 11 |
| `startup_probe_config` | `{ enabled=true }` | 13 |
| `health_check_config` | `{ enabled=true }` | 13 |
| `uptime_check_config` | `{ enabled=true, path="/" }` | 13 |
| `alert_policies` | `[]` | 13 |
| `startup_probe` | `{ path="/", initial_delay_seconds=30, failure_threshold=20 }` | 13 |
| `liveness_probe` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | 13 |
| `max_images_to_retain` | `7` | 13 |
| `delete_untagged_images` | `true` | 13 |
| `image_retention_days` | `30` | 13 |
| `max_revisions_to_retain` | `7` | 13 |
| `default_model` | `""` | 18 |
| `model_pull_timeout_seconds` | `3600` | 18 |

---

## §13 · Configuration Examples

### Basic Deployment

CPU-only inference for 3B models. Suitable for development and shared internal API use.

```hcl
# config/basic.tfvars
resource_creator_identity = ""
project_id               = "my-gcp-project-id"
tenant_deployment_id     = "demo"
application_name         = "ollama"

cpu_limit    = "4000m"
memory_limit = "8Gi"

min_instance_count = 1
max_instance_count = 1

ingress_settings = "internal"

default_model = "llama3.2:3b"
```

### Advanced Deployment

Production inference endpoint for 7B models with monitoring, environment tuning, and mirroring.

```hcl
# config/advanced.tfvars
resource_creator_identity    = ""
project_id                   = "my-gcp-project-id"
tenant_deployment_id         = "prod"
application_name             = "ollama"
application_display_name     = "Ollama LLM Server"
application_version          = "latest"

cpu_limit    = "8000m"
memory_limit = "16Gi"

min_instance_count = 1
max_instance_count = 5

timeout_seconds  = 600
ingress_settings = "internal"

default_model              = "mistral"
model_pull_timeout_seconds = 3600

environment_variables = {
  OLLAMA_NUM_PARALLEL = "2"
  OLLAMA_KEEP_ALIVE   = "24h"
}

support_users = ["ops@example.com"]
resource_labels = {
  env     = "production"
  team    = "ai-platform"
  service = "ollama"
}

enable_image_mirroring = true
```
