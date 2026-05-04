# Ollama_GKE Module — Configuration Guide

Ollama is an open-source LLM inference server that serves large language models such as Llama,
Mistral, Gemma, and Phi via a REST API on port 11434. This module deploys Ollama on **GKE
Autopilot** as a Kubernetes Deployment with model weights persisted to a GCS Fuse volume so
that pod restarts load models from storage rather than re-downloading them.

`Ollama_GKE` is a **wrapper module** built on top of `App_GKE`. It delegates all GCP
infrastructure provisioning to App_GKE (GKE cluster, networking, GCS, Secret Manager, CI/CD)
and uses an `Ollama_Common` sub-module to supply Ollama-specific application configuration, the
GCS models bucket, and the optional model-pull initialization job. The `Ollama_Common` outputs
feed into App_GKE's `application_config`, `module_storage_buckets`, and `scripts_dir` inputs.

> Ollama_GKE is designed as a **shared in-cluster AI inference endpoint**. Any pod in the same
> cluster namespace calls the API via the internal ClusterIP service URL
> `http://ollama.<namespace>.svc.cluster.local:11434`. For CPU-only, serverless inference
> use `Ollama_CloudRun`.

---

## §1 · Module Overview

### What `Ollama_GKE` provides

- An **Ollama Kubernetes Deployment** (prebuilt image `ollama/ollama`, mirrored to Artifact
  Registry when `enable_image_mirroring = true`) with a **ClusterIP service** on port `11434`.
- A **GCS bucket** (`<resource_prefix>-models`) mounted via GCS Fuse CSI driver at `/mnt/gcs`.
  `OLLAMA_MODELS` is set to `/mnt/gcs/ollama/models` so weights persist across pod restarts.
- An optional **model-pull Kubernetes Job** that starts a local Ollama server in the
  background, pulls the specified model, and stores it in the GCS bucket. Runs when
  `default_model` is non-empty and `initialization_jobs = []`.
- **Horizontal Pod Autoscaler (HPA)** between `min_instance_count` and `max_instance_count`.
- **No database, no Redis** — Ollama is stateless beyond its GCS-backed model cache.

### Key differences from `App_GKE` defaults

| Feature | App_GKE default | Ollama_GKE default |
|---|---|---|
| `container_port` | `8080` | `11434` (set by Ollama_Common) |
| `container_resources.cpu_limit` | `"1000m"` | `"8"` |
| `container_resources.memory_limit` | `"512Mi"` | `"16Gi"` |
| `container_resources.cpu_request` | `"500m"` | `"4"` |
| `container_resources.mem_request` | `"256Mi"` | `"8Gi"` |
| `min_instance_count` | `1` | `1` |
| `max_instance_count` | `3` | `3` |
| `service_type` | `"ClusterIP"` | `"ClusterIP"` |
| `enable_redis` | varies | **always `false`** (hard-coded) |
| Database | varies | **`NONE`** (via `database_type`) |
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
| `support_users` | `list(string)` | `[]` | Email addresses granted IAM access and monitoring alert recipients. |
| `resource_labels` | `map(string)` | `{}` | Labels applied to all module-managed resources. |
| `deployment_region` | `string` | `"us-central1"` | GCP region fallback when network discovery cannot determine region from VPC subnets. Also used as the GCS bucket region. |
| `module_description` | `string` | *(Ollama_GKE description)* | Platform UI description. |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/applications/ollama-gke"` | External documentation URL. |
| `module_dependency` | `list(string)` | `["Services_GCP"]` | Modules that must be deployed before this one. |
| `module_services` | `list(string)` | *(GCP service list)* | GCP services consumed by this module. |
| `credit_cost` | `number` | `100` | Platform credits consumed on deployment. |
| `require_credit_purchases` | `bool` | `true` | Enforce credit balance check before deployment. |
| `enable_purge` | `bool` | `true` | Permit full deletion of all module resources on destroy. |
| `public_access` | `bool` | `false` | Controls platform UI visibility. |
| `deployment_id` | `string` | `""` | Optional fixed deployment ID. Auto-generated when blank. |

---

## §3 · Core Service Configuration

### §3.A · Application Identity (Group 2)

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"ollama"` | Base name for Kubernetes resources and GCS bucket. Do not change after initial deployment. |
| `application_display_name` | `string` | `"Ollama LLM Server"` | Human-readable name shown in the platform UI. |
| `application_description` | `string` | `"Ollama — standalone open-source LLM inference server on GKE..."` | Brief description surfaced in Kubernetes annotations. |
| `application_version` | `string` | `"latest"` | Ollama Docker image tag. Use a pinned tag in production. |

### §3.B · Ollama Model Configuration (Group 18)

| Variable | Type | Default | Description |
|---|---|---|---|
| `default_model` | `string` | `""` | Model to pull on first deployment. Examples: `"llama3.2:3b"`, `"mistral"`, `"phi3:mini"`. Leave empty to skip the auto-pull job. |
| `model_pull_timeout_seconds` | `number` | `3600` | Timeout for the model-pull init job. Large models take 20–30 minutes on first pull. Valid range: 300–7200. |

When `default_model` is set and `initialization_jobs` is empty, a Kubernetes Job named
`model-pull` is created automatically using the `scripts/model-pull.sh` script from
`Ollama_Common`. The job mounts the `ollama-models` GCS volume so pulled weights persist.

### §3.C · Runtime & Scaling (Group 3)

| Variable | Type | Default | Description |
|---|---|---|---|
| `deploy_application` | `bool` | `true` | Set `false` to provision storage and IAM without deploying the Kubernetes workload. |
| `workload_type` | `string` | `"Deployment"` | Kubernetes workload type. `"Deployment"` is recommended for GCS-backed Ollama. Use `"StatefulSet"` only when local PVC storage is preferred over GCS. |
| `container_resources` | `object` | `{ cpu_limit="8", memory_limit="16Gi", cpu_request="4", mem_request="8Gi" }` | Container CPU and memory configuration. For 3B models: `cpu_limit="4"`, `memory_limit="8Gi"`. For 7B models: `cpu_limit="8"`, `memory_limit="16Gi"`. |
| `min_instance_count` | `number` | `1` | Minimum pod replicas. `1` keeps a warm instance for low-latency inference. |
| `max_instance_count` | `number` | `3` | Maximum pod replicas for HPA. |
| `timeout_seconds` | `number` | `300` | Kubernetes pod termination grace period seconds. Increase for long inference requests. Valid range: 0–3600. |
| `termination_grace_period_seconds` | `number` | `60` | Seconds Kubernetes waits before force-killing the pod after a SIGTERM. |
| `service_type` | `string` | `"ClusterIP"` | Kubernetes Service type. `"ClusterIP"` keeps the API internal (recommended). `"LoadBalancer"` for external access only. Options: `ClusterIP`, `LoadBalancer`, `NodePort`. |
| `session_affinity` | `string` | `"None"` | Session affinity for the Kubernetes Service. `"ClientIP"` routes all requests from the same client IP to the same pod. |
| `enable_image_mirroring` | `bool` | `true` | Mirror `ollama/ollama` to Artifact Registry to avoid Docker Hub rate limits. |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Enable VPA to automatically adjust CPU/memory requests. Recommended for GKE Autopilot. |
| `container_image_source` | `string` | `"prebuilt"` | Image source: `"prebuilt"` uses `ollama/ollama` directly; `"custom"` triggers a Cloud Build. |
| `container_image` | `string` | `"ollama/ollama"` | Full container image URI when `container_image_source = "prebuilt"`. |
| `container_build_config` | `object` | `{ enabled=false }` | Cloud Build configuration when `container_image_source = "custom"`. |
| `container_protocol` | `string` | `"http1"` | HTTP protocol version. |
| `service_annotations` | `map(string)` | `{}` | Custom annotations applied to the Kubernetes service. |
| `service_labels` | `map(string)` | `{}` | Custom labels applied to the Kubernetes service. |
| `enable_cloudsql_volume` | `bool` | `false` | Not needed for Ollama. Required by the App_GKE interface. |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Cloud SQL Auth Proxy socket path. Present for interface compatibility. |

### §3.D · Automatically Injected Environment Variables

The following environment variables are set automatically by `Ollama_Common`:

| Variable | Value | Purpose |
|---|---|---|
| `OLLAMA_MODELS` | `"/mnt/gcs/ollama/models"` | Points Ollama at the GCS Fuse subdirectory for model persistence. |
| `OLLAMA_HOST` | `"0.0.0.0:11434"` | Binds to all interfaces so the Kubernetes service can forward traffic. |
| `OLLAMA_KEEP_ALIVE` | `"24h"` | Keeps loaded model resident in memory between requests. |

### §3.E · Environment Variables & Secrets (Group 5)

| Variable | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Additional plain-text env vars. The three Ollama vars above are injected automatically. |
| `secret_environment_variables` | `map(string)` | `{}` | Map of env var name → Secret Manager secret name. |
| `secret_propagation_delay` | `number` | `30` | Seconds to wait after secret creation. Valid range: 0–300. |
| `secret_rotation_period` | `string` | `"2592000s"` | Rotation notification period (30 days). Set `null` to disable. |
| `enable_auto_password_rotation` | `bool` | `false` | Not applicable for Ollama (no database). |
| `rotation_propagation_delay_sec` | `number` | `90` | Seconds to wait after rotation before restarting pods. |

### §3.F · Access & Networking (Group 4)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_iap` | `bool` | `false` | Enable Identity-Aware Proxy. |
| `iap_authorized_users` | `list(string)` | `[]` | Users granted access through IAP. |
| `iap_authorized_groups` | `list(string)` | `[]` | Google Groups granted access through IAP. |
| `iap_oauth_client_id` | `string` | `""` | OAuth 2.0 client ID for IAP (required for GKE IAP). |
| `iap_oauth_client_secret` | `string` | `""` | OAuth 2.0 client secret for IAP. Sensitive. |
| `iap_support_email` | `string` | `""` | Support email shown on the IAP consent screen. |
| `enable_cloud_armor` | `bool` | `false` | Enable Cloud Armor WAF. |
| `cloud_armor_policy_name` | `string` | `""` | Name of an existing Cloud Armor security policy. |
| `application_domains` | `list(string)` | `[]` | Custom domain names for the load balancer. |
| `enable_custom_domain` | `bool` | `false` | Configure a custom domain for the application. |
| `enable_cdn` | `bool` | `false` | Enable Cloud CDN on the load balancer. |
| `reserve_static_ip` | `bool` | `false` | Reserve a static external IP for the load balancer. |
| `static_ip_name` | `string` | `""` | Name of the reserved static IP. Auto-generated when empty. |
| `enable_vpc_sc` | `bool` | `false` | Enable VPC Service Controls perimeter enforcement. |
| `vpc_cidr_ranges` | `list(string)` | `[]` | VPC subnet CIDR ranges for VPC-SC. |
| `vpc_sc_dry_run` | `bool` | `true` | Log VPC-SC violations without blocking. |
| `organization_id` | `string` | `""` | GCP Organization ID for VPC-SC policy. |
| `enable_audit_logging` | `bool` | `false` | Enable detailed Cloud Audit Logs. |
| `admin_ip_ranges` | `list(string)` | `[]` | CIDR ranges for administrative access. |

---

## §4 · GKE-Specific Configuration (Group 15)

| Variable | Type | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | `string` | `""` | Name of an existing GKE Autopilot cluster. Uses the Services_GCP-managed cluster when empty. |
| `namespace_name` | `string` | `""` | Kubernetes namespace for the Ollama deployment. Auto-generated from the application name when empty. |
| `enable_pod_disruption_budget` | `bool` | `true` | Create a PodDisruptionBudget to maintain availability during node upgrades. |
| `pdb_min_available` | `number` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_network_segmentation` | `bool` | `false` | Apply Kubernetes NetworkPolicies to restrict pod-to-pod traffic. |
| `configure_service_mesh` | `bool` | `false` | Configure Anthos Service Mesh (Istio) for traffic management and mTLS. |
| `network_tags` | `list(string)` | `[]` | GCP network tags applied to GKE nodes for firewall rule matching. |
| `deployment_timeout` | `number` | `600` | Seconds to wait for the Kubernetes Deployment to become ready. |
| `enable_resource_quota` | `bool` | `false` | Apply Kubernetes ResourceQuota to the namespace. |

---

## §5 · StatefulSet Settings (Group 16)

These settings apply only when `workload_type = "StatefulSet"`. The default `"Deployment"`
workload type with GCS Fuse is recommended and these are not needed.

| Variable | Type | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | `bool` | `false` | Provision a PVC for local model storage. Not required when using GCS Fuse. |
| `stateful_pvc_size` | `string` | `"50Gi"` | PVC size (e.g. `"100Gi"` for multiple large models). |
| `stateful_pvc_mount_path` | `string` | `"/mnt/data"` | Container path for the PVC. |
| `stateful_pvc_storage_class` | `string` | `"standard-rwo"` | Kubernetes StorageClass for the PVC. |
| `stateful_headless_service` | `bool` | `false` | Create a headless service for the StatefulSet. |
| `stateful_pod_management_policy` | `string` | `"OrderedReady"` | Pod management: `"OrderedReady"` or `"Parallel"`. |
| `stateful_update_strategy` | `string` | `"RollingUpdate"` | StatefulSet update strategy. |

---

## §6 · Storage & Filesystem (Group 10)

| Variable | Type | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | `bool` | `true` | Provision GCS buckets in `storage_buckets`. The models bucket is always created. |
| `storage_buckets` | `list(object)` | `[]` | Additional GCS buckets beyond the Ollama models bucket. |
| `enable_nfs` | `bool` | `false` | Provision and mount Cloud Filestore NFS. Not required for Ollama. |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | Filesystem path for the NFS volume. |
| `nfs_instance_name` | `string` | `""` | Name of an existing NFS GCE VM. Auto-discovered when empty. |
| `nfs_instance_base_name` | `string` | `"app-nfs"` | Base name for an inline NFS GCE VM. |
| `gcs_volumes` | `list(object)` | `[]` | Additional GCS buckets to mount as GCS Fuse volumes. The `ollama-models` bucket is always appended. |
| `manage_storage_kms_iam` | `bool` | `false` | Create a CMEK KMS key for GCS encryption. |
| `enable_artifact_registry_cmek` | `bool` | `false` | Enable CMEK encryption for Artifact Registry. |

**GCS volume layout:**

```
<resource_prefix>-models/          ← GCS bucket root
└── ollama/
    └── models/                    ← /mnt/gcs/ollama/models (OLLAMA_MODELS)
```

---

## §7 · Backup & Maintenance (Group 6)

Ollama has no database — backup settings are present for App_GKE interface compatibility only.

| Variable | Type | Default | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `""` | Not applicable for Ollama. |
| `backup_retention_days` | `number` | `7` | Days to retain backup files. |
| `enable_backup_import` | `bool` | `false` | Not applicable for Ollama. |
| `backup_source` | `string` | `"gcs"` | `"gcs"` or `"gdrive"`. |
| `backup_uri` | `string` | `""` | Location of the backup file. |
| `backup_format` | `string` | `"sql"` | Format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## §8 · CI/CD Integration (Group 7)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | `bool` | `false` | Create a Cloud Build trigger on GitHub pushes. |
| `github_repository_url` | `string` | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | `string` | `""` | GitHub Personal Access Token. Sensitive. |
| `github_app_installation_id` | `string` | `""` | Cloud Build GitHub App installation ID. |
| `cicd_trigger_config` | `object` | `{ branch_pattern = "^main$" }` | Branch filter, trigger name, and build substitutions. |
| `enable_cloud_deploy` | `bool` | `false` | Switch to a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod(approval)]` | Ordered promotion stages. |
| `enable_binary_authorization` | `bool` | `false` | Enforce Binary Authorization for signed container images. |

---

## §9 · Custom Initialization & Jobs (Group 8)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | `bool` | `false` | Not applicable for Ollama. |
| `custom_sql_scripts_bucket` | `string` | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | `string` | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | `bool` | `false` | Execute scripts as root database user. |
| `initialization_jobs` | `list(object)` | `[]` | Kubernetes Jobs executed once during deployment. When non-empty, overrides the auto-generated model-pull job. |
| `cron_jobs` | `list(object)` | `[]` | Recurring Kubernetes CronJobs. |
| `additional_services` | `list(any)` | `[]` | Additional containers deployed as separate Kubernetes Deployments with ClusterIP services (e.g. a Qdrant vector database alongside Ollama). |

---

## §10 · Database Backend (Group 11)

Ollama has no database dependency. Redis is also disabled for this module.

| Variable | Type | Default | Description |
|---|---|---|---|
| `database_password_length` | `number` | `32` | Not used. Present for interface compatibility. Valid range: 16–64. |
| `enable_postgres_extensions` | `bool` | `false` | Not applicable for Ollama. |
| `postgres_extensions` | `list(string)` | `[]` | Not applicable for Ollama. |
| `enable_mysql_plugins` | `bool` | `false` | Not applicable for Ollama. |
| `mysql_plugins` | `list(string)` | `[]` | Not applicable for Ollama. |
| `database_type` | `string` | `"NONE"` | Always `"NONE"` for Ollama — no Cloud SQL instance is provisioned. |

**Hard-coded values (not user-configurable):**
- `enable_redis = false`

---

## §11 · Observability & Health (Group 13)

Ollama's root endpoint (`/`) returns `"Ollama is running"` once the server is ready.

| Variable | Type | Default | Description |
|---|---|---|---|
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=30, timeout_seconds=5, period_seconds=15, failure_threshold=20 }` | Startup probe forwarded through Ollama_Common to the container spec. The 20-attempt threshold allows up to ~5 minutes for model loading from GCS. |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. 60 s initial delay avoids false restarts during model loading. |
| `startup_probe_config` | `object` | `{ enabled=true }` | Structured startup probe passed directly to App_GKE (300 s timeout by default). |
| `health_check_config` | `object` | `{ enabled=true, initial_delay_seconds=60 }` | Structured liveness probe passed directly to App_GKE. |
| `uptime_check_config` | `object` | `{ enabled=true, path="/", check_interval="60s", timeout="10s" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `list(object)` | `[]` | Cloud Monitoring alert policies. |

---

## §12 · Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes service name. |
| `service_url` | Service URL (LoadBalancer or ClusterIP). |
| `namespace` | Kubernetes namespace containing the Ollama deployment. |
| `ollama_cluster_url` | Internal Kubernetes URL for the Ollama API: `http://<service_name>.<namespace>.svc.cluster.local:11434`. Other pods in the same cluster call this URL. |
| `service_cluster_ip` | ClusterIP of the Kubernetes service. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific Kubernetes services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP when `reserve_static_ip = true`. |
| `models_bucket` | GCS bucket name where Ollama model weights are persisted. |
| `storage_buckets` | All provisioned GCS buckets. |
| `network_name` | VPC network name. |
| `network_exists` | Whether the VPC network exists. |
| `regions` | Available regions in the VPC. |
| `container_image` | Container image URI. |
| `container_registry` | Artifact Registry repository name. |
| `deployment_id` | Unique deployment identifier. |
| `tenant_id` | Tenant identifier. |
| `resource_prefix` | Resource naming prefix. |
| `project_id` | GCP project ID. |
| `project_number` | GCP project number. |
| `monitoring_enabled` | Whether Cloud Monitoring is configured. |
| `monitoring_notification_channels` | Monitoring notification channel names. |
| `uptime_check_names` | Uptime check names (returns `[]` for GKE). |
| `initialization_jobs` | Created initialization job names. |
| `cron_jobs` | Created cron job names. |
| `statefulset_name` | StatefulSet name when `workload_type = "StatefulSet"`. |
| `nfs_server_ip` | NFS server internal IP (sensitive). |
| `nfs_mount_path` | NFS mount path in containers. |
| `nfs_share_path` | NFS share path on server. |
| `nfs_setup_job` | NFS setup job name. |
| `db_import_job` | Database import job name. |
| `deployment_summary` | Summary of the deployment. |
| `cicd_enabled` | Whether CI/CD pipeline is enabled. |
| `github_repository_url` | Connected GitHub repository URL. |
| `github_repository_owner` | GitHub repository owner. |
| `github_repository_name` | GitHub repository name. |
| `artifact_registry_repository` | Artifact Registry repository. |
| `cloudbuild_trigger_name` | Cloud Build trigger name. |
| `cloudbuild_trigger_id` | Cloud Build trigger ID. |
| `cicd_configuration` | CI/CD pipeline configuration details. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is available and all workload resources have been deployed. `false` on first apply of a new cluster. |

---

## §13 · Platform-Managed Behaviours

| Behaviour | Detail |
|---|---|
| **`OLLAMA_MODELS` injected** | Set to `/mnt/gcs/ollama/models`. Do not set this in `environment_variables`. |
| **`OLLAMA_HOST` injected** | Set to `"0.0.0.0:11434"` for Kubernetes service forwarding. |
| **`OLLAMA_KEEP_ALIVE` injected** | Set to `"24h"`. Override by setting `OLLAMA_KEEP_ALIVE` in `environment_variables`. |
| **Models bucket always provisioned** | The `<resource_prefix>-models` GCS bucket is always created, regardless of `create_cloud_storage` or `storage_buckets` settings. |
| **GCS volume always mounted** | The `ollama-models` volume is always appended to `gcs_volumes` inside Ollama_Common. |
| **No database, no Redis** | `enable_redis = false` and `database_type = "NONE"` are hard-coded. |
| **Model-pull job auto-generated** | When `default_model` is set and `initialization_jobs = []`, a Kubernetes Job (`model-pull`) is created using `scripts/model-pull.sh`. Providing any entry in `initialization_jobs` disables it. |
| **Network discovery** | The module uses the `App_Common/modules/app_networking` module to discover the VPC region from existing subnets. The first discovered region is used as `deployment_region`. Falls back to `var.deployment_region` when no subnets are found. |
| **Namespace auto-generated** | When `namespace_name = ""`, the namespace defaults to `<resource_prefix>` (the full `app<name><tenant><id>` string). |
| **`scripts_dir`** | Set to `Ollama_Common`'s bundled `scripts/` directory. |

---

## §14 · Variable Reference

Complete variable reference with UIMeta group assignments.

| Variable | Default | Group |
|---|---|---|
| `module_description` | *(Ollama GKE description)* | 0 |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/ollama-gke"` | 0 |
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
| `deployment_region` | `"us-central1"` | 1 |
| `application_name` | `"ollama"` | 2 |
| `application_display_name` | `"Ollama LLM Server"` | 2 |
| `application_description` | `"Ollama — standalone open-source LLM inference server on GKE..."` | 2 |
| `application_version` | `"latest"` | 2 |
| `deploy_application` | `true` | 3 |
| `workload_type` | `"Deployment"` | 3 |
| `container_resources` | `{ cpu_limit="8", memory_limit="16Gi", cpu_request="4", mem_request="8Gi" }` | 3 |
| `min_instance_count` | `1` | 3 |
| `max_instance_count` | `3` | 3 |
| `timeout_seconds` | `300` | 3 |
| `termination_grace_period_seconds` | `60` | 3 |
| `service_type` | `"ClusterIP"` | 3 |
| `session_affinity` | `"None"` | 3 |
| `enable_image_mirroring` | `true` | 3 |
| `enable_vertical_pod_autoscaling` | `false` | 3 |
| `container_image_source` | `"prebuilt"` | 3 |
| `container_image` | `"ollama/ollama"` | 3 |
| `container_build_config` | `{ enabled=false }` | 3 |
| `container_protocol` | `"http1"` | 3 |
| `service_annotations` | `{}` | 3 |
| `service_labels` | `{}` | 3 |
| `enable_cloudsql_volume` | `false` | 3 |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | 3 |
| `enable_iap` | `false` | 4 |
| `iap_authorized_users` | `[]` | 4 |
| `iap_authorized_groups` | `[]` | 4 |
| `iap_oauth_client_id` | `""` | 4 |
| `iap_oauth_client_secret` | `""` | 4 |
| `iap_support_email` | `""` | 4 |
| `enable_cloud_armor` | `false` | 4 |
| `cloud_armor_policy_name` | `""` | 4 |
| `application_domains` | `[]` | 4 |
| `enable_custom_domain` | `false` | 4 |
| `enable_cdn` | `false` | 4 |
| `reserve_static_ip` | `false` | 4 |
| `static_ip_name` | `""` | 4 |
| `enable_vpc_sc` | `false` | 4 |
| `vpc_cidr_ranges` | `[]` | 4 |
| `vpc_sc_dry_run` | `true` | 4 |
| `organization_id` | `""` | 4 |
| `enable_audit_logging` | `false` | 4 |
| `admin_ip_ranges` | `[]` | 4 |
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
| `additional_services` | `[]` | 8 |
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
| `enable_postgres_extensions` | `false` | 11 |
| `postgres_extensions` | `[]` | 11 |
| `enable_mysql_plugins` | `false` | 11 |
| `mysql_plugins` | `[]` | 11 |
| `database_type` | `"NONE"` | 11 |
| `startup_probe_config` | `{ enabled=true }` | 13 |
| `health_check_config` | `{ enabled=true, initial_delay_seconds=60 }` | 13 |
| `uptime_check_config` | `{ enabled=true, path="/" }` | 13 |
| `alert_policies` | `[]` | 13 |
| `startup_probe` | `{ path="/", initial_delay_seconds=30, failure_threshold=20 }` | 13 |
| `liveness_probe` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | 13 |
| `gke_cluster_name` | `""` | 15 |
| `namespace_name` | `""` | 15 |
| `enable_pod_disruption_budget` | `true` | 15 |
| `pdb_min_available` | `1` | 15 |
| `enable_network_segmentation` | `false` | 15 |
| `configure_service_mesh` | `false` | 15 |
| `network_tags` | `[]` | 15 |
| `deployment_timeout` | `600` | 15 |
| `enable_resource_quota` | `false` | 15 |
| `stateful_pvc_enabled` | `false` | 16 |
| `stateful_pvc_size` | `"50Gi"` | 16 |
| `stateful_pvc_mount_path` | `"/mnt/data"` | 16 |
| `stateful_pvc_storage_class` | `"standard-rwo"` | 16 |
| `stateful_headless_service` | `false` | 16 |
| `stateful_pod_management_policy` | `"OrderedReady"` | 16 |
| `stateful_update_strategy` | `"RollingUpdate"` | 16 |
| `default_model` | `""` | 18 |
| `model_pull_timeout_seconds` | `3600` | 18 |

---

## §15 · Configuration Examples

### Basic Deployment

CPU-only inference for 3B models. Suitable for evaluation and shared internal cluster use.

```hcl
# config/basic.tfvars
resource_creator_identity = ""
project_id               = "my-gcp-project-id"
tenant_deployment_id     = "demo"
application_name         = "ollama"

container_resources = {
  cpu_limit    = "8"
  memory_limit = "16Gi"
  cpu_request  = "4"
  mem_request  = "8Gi"
}

min_instance_count = 1
max_instance_count = 3

service_type = "ClusterIP"

default_model = "llama3.2:3b"
```

### Advanced Deployment

Production inference endpoint for 7B models with pod disruption budget, monitoring, and environment tuning.

```hcl
# config/advanced.tfvars
resource_creator_identity    = ""
project_id                   = "my-gcp-project-id"
tenant_deployment_id         = "prod"
application_name             = "ollama"
application_display_name     = "Ollama LLM Server"
application_version          = "latest"

container_resources = {
  cpu_limit    = "8"
  memory_limit = "16Gi"
  cpu_request  = "6"
  mem_request  = "12Gi"
}

min_instance_count = 1
max_instance_count = 5

workload_type = "Deployment"
service_type  = "ClusterIP"

default_model              = "mistral"
model_pull_timeout_seconds = 3600

environment_variables = {
  OLLAMA_NUM_PARALLEL = "2"
  OLLAMA_KEEP_ALIVE   = "24h"
}

enable_pod_disruption_budget = true
pdb_min_available            = 1

support_users = ["ops@example.com"]
resource_labels = {
  env     = "production"
  team    = "ai-platform"
  service = "ollama"
}

enable_image_mirroring = true
```
