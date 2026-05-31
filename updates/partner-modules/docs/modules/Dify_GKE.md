# Dify on Google Kubernetes Engine (GKE Autopilot)

This document provides a comprehensive reference for the `modules/Dify_GKE` Terraform module. It covers architecture, IAM, configuration variables, Dify-specific behaviours, and operational patterns for deploying Dify on GKE Autopilot.

---

## 1. Module Overview

Dify is an open-source LLM application development platform with 50,000+ GitHub stars. `Dify_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning and injects Dify-specific application configuration, database initialisation, secrets, and storage configuration via `Dify_Common`.

**Key Capabilities:**
*   **Compute**: GKE Autopilot, Python/Next.js containers, 2 vCPU / 4 Gi default. Horizontal Pod Autoscaler (HPA) manages scaling. A **web** sidecar Deployment (`langgenius/dify-web`) is automatically deployed alongside the API.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15** with `pgvector` extension enabled for vector storage. NFS (GCE VM or Filestore) for shared Redis and task state. GCS `dify-storage` bucket auto-provisioned by `Dify_Common`.
*   **AI Infrastructure**: pgvector reuses the Cloud SQL PostgreSQL instance as the vector store (`VECTOR_STORE=pgvector`). Redis is required for Celery task queue and event bus streaming.
*   **Security**: Inherits Workload Identity, Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_GKE`. `Dify_Common` auto-generates a `SECRET_KEY` secret stored in Secret Manager.
*   **Caching/Queue**: Redis **enabled by default** (`enable_redis = true`) — required for Celery broker, backend, and SSE/WebSocket LLM streaming.
*   **CI/CD**: Cloud Build custom image pipeline; Cloud Deploy progressive delivery optional.

**Wrapper architecture:** `Dify_GKE` calls `Dify_Common` to build an `application_config` object and then calls `App_GKE` for all Kubernetes resource provisioning. The `web` additional service is wired to `$(GKE_SERVICE_URL)` for API communication. `scripts_dir` resolves to `abspath("${module.dify_app.path}/scripts")`.

---

## 2. IAM & Access Control

`Dify_GKE` delegates all IAM provisioning to `App_GKE`. Workload Identity is used to bind the Kubernetes service account to a GCP service account, granting the Dify pod access to Cloud SQL, Secret Manager, and GCS.

**Auto-generated application secret:** `Dify_Common` generates a 64-character random `SECRET_KEY` and stores it in Secret Manager as `<resource_prefix>-secret-key`.

For the complete role tables and Workload Identity, IAP, password rotation, and public access details, see [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (GKE)

Dify runs as a Kubernetes Deployment (default) or StatefulSet. The API pod runs supervisord — both the Flask/gunicorn API process and a Celery worker run inside the same container. A separate `dify-web` Next.js Deployment is created automatically and communicates with the API service.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'2000m'` | CPU limit per container instance. 2 vCPU minimum. |
| `memory_limit` | 4 | `'4Gi'` | Memory limit per container instance. 4 Gi recommended. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. Keep at 1+ for Celery availability. |
| `max_instance_count` | 4 | `3` | Maximum pod replicas. Acts as a cost ceiling. |
| `container_port` | 4 | `5001` | Dify API server port. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar into the pod. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Dify image into Artifact Registry. |
| `workload_type` | 6 | `null` | `'Deployment'` (stateless) or `'StatefulSet'` (stateful). Defaults to `'Deployment'`. |
| `service_type` | 6 | `'LoadBalancer'` | Kubernetes Service type: `'ClusterIP'`, `'LoadBalancer'`, or `'NodePort'`. |
| `session_affinity` | 6 | `'ClientIP'` | Route requests from the same client to the same pod. |
| `gke_cluster_name` | 6 | `""` | GKE cluster name. Leave empty to auto-discover. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Auto-generated when empty. |
| `enable_pod_disruption_budget` | 4 | `false` | Creates a PodDisruptionBudget for minimum availability during node maintenance. |
| `pdb_min_available` | 4 | `1` | Minimum pods available during disruptions. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enable VPA. Disables HPA based on CPU/Memory when enabled. |
| `termination_grace_period_seconds` | 6 | `60` | Seconds Kubernetes waits for SIGTERM before force-killing. Range: 0–3600. |
| `service_annotations` | 4 | `{}` | Custom annotations applied to the Kubernetes Service. |
| `service_labels` | 4 | `{}` | Custom labels applied to the Kubernetes Service. |

### B. Database (Cloud SQL — PostgreSQL 15)

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 16 | `'dify_db'` | PostgreSQL database name. **Do not change after initial deployment.** |
| `db_user` | 16 | `'dify_user'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 16 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 16 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 16 | `90` | Seconds to wait after rotation before restarting the application. |

### C. Storage (NFS & GCS)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 13 | `true` | Provisions an NFS volume. Required when Redis is enabled without an external `redis_host`. |
| `nfs_mount_path` | 13 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `nfs_volume_name` | 13 | `'nfs-data-volume'` | Volume name for the NFS mount. |
| `nfs_instance_name` | 13 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 13 | `'app-nfs'` | Base name for an inline NFS GCE VM when none exists. |
| `create_cloud_storage` | 14 | `true` | Set `false` to skip additional GCS bucket creation. |
| `storage_buckets` | 14 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `gcs_volumes` | 14 | `[]` | GCS FUSE volume mounts via CSI driver. |
| `manage_storage_kms_iam` | 14 | `false` | Creates a CMEK KMS keyring and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 14 | `false` | Enables at-rest CMEK encryption of container images in Artifact Registry. |
| `max_images_to_retain` | 14 | `7` | Maximum number of recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 14 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 14 | `30` | Days after which images are eligible for deletion. |

### D. Custom Domain & Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_domain` | 19 | `false` | Enable custom domain configuration via Kubernetes Gateway API with SSL certificates. |
| `application_domains` | 19 | `[]` | Custom domains for the application. (e.g., `['dify.example.com']`) |
| `reserve_static_ip` | 19 | `true` | Reserve a static external IP for predictable endpoint configuration. |
| `static_ip_name` | 19 | `""` | Name for the reserved static IP. Auto-generated when empty. |
| `network_tags` | 19 | `['nfsserver']` | Network tags applied to GKE nodes. The `nfsserver` tag is required for NFS connectivity. |

### E. Initialization & Bootstrap

A `db-init` Kubernetes Job is automatically provisioned by `Dify_Common` when `initialization_jobs` is left as the default empty list. Dify runs its own database migrations automatically on startup via `MIGRATION_ENABLED=true`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 11 | `[]` | Kubernetes Jobs for initialization tasks. Leave empty for `Dify_Common` to supply the default `db-init` job. |
| `cron_jobs` | 11 | `[]` | List of CronJobs to deploy alongside Dify. |
| `additional_services` | 11 | `[]` | Additional Kubernetes services to deploy alongside Dify. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 21 | `false` | Attaches a Cloud Armor security policy to the GKE Ingress backend. |
| `admin_ip_ranges` | 21 | `[]` | CIDR ranges permitted for administrative access. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Name of the Cloud Armor security policy to apply. |
| `enable_cdn` | 21 | `false` | Enables Cloud CDN on the load balancer. |

### B. Identity-Aware Proxy (IAP)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Enable IAP for authentication via Kubernetes Gateway. Requires `enable_custom_domain = true`. |
| `iap_authorized_users` | 20 | `[]` | List of user emails authorized to access via IAP. |
| `iap_authorized_groups` | 20 | `[]` | List of Google Groups authorized to access via IAP. |
| `iap_oauth_client_id` | 20 | `""` | OAuth client ID for IAP. Required when `enable_iap = true`. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth client secret for IAP. Required when `enable_iap = true`. Sensitive. |

### C. Binary Authorization & VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 12 | `false` | Enable Binary Authorization. Only signed images can be deployed. |
| `enable_vpc_sc` | 22 | `false` | Enables VPC Service Controls perimeter enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | When `true`, VPC-SC violations are logged but not blocked. |
| `organization_id` | 22 | `""` | GCP Organization ID for the VPC-SC Access Context Manager policy. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs for all supported GCP services. |

### D. Secret Manager Integration

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 5 | `{}` | Map of env var name → Secret Manager secret ID. (e.g., `{ OPENAI_API_KEY = "my-openai-key" }`) |
| `secret_rotation_period` | 5 | `'2592000s'` | Rotation period for secrets. Default: 30 days. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation before proceeding. |

---

## 5. StatefulSet Configuration

For deployments requiring persistent local storage (e.g., custom model caches), Dify can run as a StatefulSet with per-pod Persistent Volume Claims.

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 7 | `null` | Enable PVC for StatefulSet. Setting `true` without an explicit `workload_type` auto-selects `'StatefulSet'`. |
| `stateful_pvc_size` | 7 | `'10Gi'` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | 7 | `'/data'` | Container path where the per-pod PVC is mounted. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | Kubernetes StorageClass for PVC provisioning. |
| `stateful_headless_service` | 7 | `null` | Create a headless service for stable network identities. |
| `stateful_pod_management_policy` | 7 | `null` | `'OrderedReady'` or `'Parallel'`. Defaults to `'OrderedReady'`. |
| `stateful_update_strategy` | 7 | `null` | `'RollingUpdate'` or `'OnDelete'`. Defaults to `'RollingUpdate'`. |
| `stateful_fs_group` | 7 | `0` | GID set as pod-level `fsGroup`. Set to `0` to leave unset. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 12 | `false` | Enable automated Cloud Build trigger for CI/CD. |
| `github_repository_url` | 12 | `""` | GitHub repository URL for automated CI/CD. |
| `github_token` | 12 | `""` | GitHub PAT. Required when `enable_cicd_trigger = true`. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Cloud Build trigger configuration. |
| `enable_cloud_deploy` | 12 | `false` | Enable Google Cloud Deploy for managed promotion pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Ordered list of Cloud Deploy pipeline stages. |

---

## 7. Reliability & Scheduling

### A. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Startup probe. Container receives no traffic until this succeeds. |
| `liveness_probe` | 14 | `{ path="/health", initial_delay_seconds=30, failure_threshold=3, ... }` | Liveness probe. Container is restarted after `failure_threshold` failures. |
| `startup_probe_config` | 10 | `{ enabled=true }` | Alternative startup probe configuration for App_GKE. Takes precedence. |
| `health_check_config` | 10 | `{ enabled=true }` | Alternative liveness probe configuration for App_GKE. Takes precedence. |
| `uptime_check_config` | 10 | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 10 | `[]` | Custom alert policies for monitoring Dify metrics. |
| `deployment_timeout` | 6 | `1800` | Maximum seconds Terraform waits for the Kubernetes rollout to complete. |

### B. Redis Cache & Celery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | **Required.** Enables Redis for Celery task queue and LLM streaming. |
| `redis_host` | 21 | `""` | Redis hostname or IP. Leave blank to default to the NFS server IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

### C. Backup & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 17 | `'0 2 * * *'` | Cron schedule for automated database and NFS backups. |
| `backup_retention_days` | 17 | `7` | Number of days to retain backup files. |
| `enable_backup_import` | 17 | `false` | Enable automatic import of database backup during deployment. |
| `backup_source` | 17 | `'gcs'` | Backup source: `'gcs'` or `'gdrive'`. |
| `backup_uri` | 17 | `""` | Location of the backup file to import. |
| `backup_format` | 17 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## 8. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` fixed by `Dify_Common` | Dify requires PostgreSQL. MySQL is unsupported. |
| **pgvector enabled** | `enable_postgres_extensions = true`, `postgres_extensions = ["vector"]` | Enables the `vector` extension. Cannot be disabled. |
| **SECRET_KEY auto-generated** | `Dify_Common` provisions the secret | A 64-character random key is stored in Secret Manager and injected as `SECRET_KEY`. |
| **MIGRATION_ENABLED=true** | Hardcoded in `Dify_Common` environment_variables | Dify runs Flask-Migrate automatically on startup. |
| **Web service auto-deployed** | `dify_additional_services` in `dify.tf` | A `langgenius/dify-web:<version>` Deployment is created and wired to `$(GKE_SERVICE_URL)`. |
| **GCS storage bucket** | `dify-storage` bucket provisioned by `Dify_Common` | `STORAGE_TYPE=google-storage`, authenticated via Workload Identity. |
| **NFS enabled by default** | `enable_nfs = true` default | NFS server provides the Redis host when no external Redis is configured. |
| **Redis enabled by default** | `enable_redis = true` default | Celery and event bus require Redis. Cannot be safely disabled. |
| **Default db-init job** | Supplied by `Dify_Common` when `initialization_jobs = []` | PostgreSQL database and user are created idempotently. |
| **Workload Identity** | Managed by `App_GKE` | The Dify pod accesses GCP APIs via Workload Identity — no service account key files. |

---

## 9. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `service_url` | External URL of the Dify service. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `nfs_server_ip` | NFS server internal IP *(sensitive)*. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
