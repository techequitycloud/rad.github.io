# Metabase on GKE Autopilot

This document provides a comprehensive reference for the `modules/Metabase_GKE` Terraform module. It covers architecture, IAM, configuration variables, Metabase-specific behaviours, and operational patterns for deploying Metabase on Google Kubernetes Engine (GKE) Autopilot.

---

## 1. Module Overview

`Metabase_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP and Kubernetes infrastructure provisioning and injects Metabase-specific application configuration via `Metabase_Common`.

**Key Capabilities:**
- **Compute**: GKE Autopilot Deployment (Metabase is stateless), 2 vCPU / 4 Gi by default with Horizontal Pod Autoscaling.
- **Data Persistence**: Cloud SQL **PostgreSQL 15** as the Metabase application database. A `db-init` Kubernetes Job runs automatically on first deployment.
- **Security**: Inherits Cloud Armor WAF, IAP (OAuth 2.0), Binary Authorization, and VPC Service Controls from `App_GKE`.
- **Session Affinity**: Defaults to `'ClientIP'` (sticky sessions) — recommended for Metabase to avoid session interruptions when HPA scales pods.
- **Reliability**: Health probes target `/api/health` with 120-second initial delay for JVM startup. PodDisruptionBudget is enabled by default.

**JVM startup note:** Metabase requires at least 60–120 seconds to start. Set `min_instance_count = 1` to keep at least one pod warm and avoid scheduling delays on GKE Autopilot.

---

## 2. IAM & Access Control

`Metabase_GKE` delegates all IAM provisioning to `App_GKE`. Metabase pods access Cloud SQL via the Cloud SQL Auth Proxy sidecar and Workload Identity.

**Default `db-init` job:** `Metabase_Common` provides a `db-init` Kubernetes Job using `postgres:15-alpine` that runs before the Metabase workload starts, creating the PostgreSQL database and user.

---

## 3. Core Service Configuration

### A. Compute (GKE Autopilot)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build; `'prebuilt'` deploys an existing image. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `container_resources` | 4 | `{ cpu_limit="2000m", memory_limit="4Gi" }` | CPU/memory limits. JVM requires at least 2 Gi. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. Set to at least 1 to avoid JVM cold starts. |
| `max_instance_count` | 4 | `5` | Maximum pod replicas. |
| `container_port` | 4 | `3000` | Metabase's Jetty HTTP port. |
| `container_protocol` | 4 | `'http1'` | HTTP protocol version. |
| `timeout_seconds` | 4 | `300` | Max load balancer backend timeout. Increase for complex queries. |
| `enable_cloudsql_volume` | 4 | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Metabase image into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA for JVM right-sizing. Recommended for GKE Autopilot. |
| `service_annotations` | 4 | `{}` | Custom annotations on the Kubernetes Service resource. |
| `service_labels` | 4 | `{}` | Labels applied to the Kubernetes Service resource. |

### B. GKE-Specific Backend Configuration

| Variable | Group | Default | Description |
|---|---|---|---|
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. Metabase is stateless — use `'Deployment'`. |
| `service_type` | 6 | `'LoadBalancer'` | Kubernetes Service type. |
| `session_affinity` | 6 | `'ClientIP'` | Sticky sessions recommended for Metabase to prevent session loss on pod scaling. |
| `gke_cluster_name` | 6 | `""` | Target GKE cluster. Leave empty to auto-discover. |
| `gke_cluster_selection_mode` | 6 | `'primary'` | Strategy for choosing the target cluster. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Leave empty to auto-generate. |
| `termination_grace_period_seconds` | 6 | `60` | Seconds Kubernetes waits after SIGTERM. Increase to allow in-flight queries to complete. |
| `enable_network_segmentation` | 6 | `false` | Creates Kubernetes NetworkPolicy resources. |
| `enable_multi_cluster_service` | 6 | `false` | Creates a ServiceExport for Multi-Cluster Services. |
| `configure_service_mesh` | 6 | `false` | Enables Istio service mesh injection. |
| `deployment_timeout` | 6 | `1800` | Maximum seconds Terraform waits for the Deployment rollout. Increase for large JVM images. |
| `prereq_gke_subnet_cidr` | 6 | `'10.201.0.0/24'` | CIDR range for the GKE subnet. Not referenced in this module. |

### C. StatefulSet Configuration

Metabase is stateless and does not require StatefulSet. These variables are available for advanced use cases only.

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 7 | `null` | Enables PVC templates. Not recommended for Metabase. |
| `stateful_pvc_size` | 7 | `'10Gi'` | PVC storage size. |
| `stateful_pvc_mount_path` | 7 | `'/data'` | PVC mount path inside the container. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | Kubernetes StorageClass. |
| `stateful_headless_service` | 7 | `null` | Creates a headless Service for the StatefulSet. |
| `stateful_pod_management_policy` | 7 | `null` | Pod creation order. |
| `stateful_update_strategy` | 7 | `null` | Update strategy. |
| `stateful_fs_group` | 7 | `0` | Pod-level `fsGroup`. Set to `0` to leave unset — Metabase does not require a specific GID. |

### D. Database (Cloud SQL — PostgreSQL 15)

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 16 | `'POSTGRES_15'` | Cloud SQL engine. PostgreSQL required for Metabase. |
| `application_database_name` | 16 | `'metabase'` | PostgreSQL database name. |
| `application_database_user` | 16 | `'metabase'` | PostgreSQL application user. |
| `database_password_length` | 16 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_postgres_extensions` | 16 | `false` | Not required for Metabase. |
| `postgres_extensions` | 16 | `[]` | Not applicable for Metabase. |
| `enable_auto_password_rotation` | 16 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 16 | `90` | Seconds to wait after rotation before restarting pods. |
| `db_name` | 16 | `'metabase'` | Passed to `Metabase_Common`. |
| `db_user` | 16 | `'metabase'` | Passed to `Metabase_Common`. |

### E. Storage

Metabase does not require dedicated GCS storage. All application state is stored in PostgreSQL.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 14 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 14 | `[]` | GCS bucket configurations. Empty by default — Metabase does not require object storage. |
| `gcs_volumes` | 14 | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` | 14 | `false` | Creates CMEK KMS keyring. |
| `enable_artifact_registry_cmek` | 14 | `false` | Enables CMEK for Artifact Registry images. |
| `max_images_to_retain` | 14 | `7` | Maximum recent container images to keep. |
| `delete_untagged_images` | 14 | `true` | Automatically deletes untagged images. |
| `image_retention_days` | 14 | `30` | Days after which images are eligible for deletion. |
| `enable_nfs` | 13 | `false` | Provisions NFS storage. Not typically required for Metabase. |
| `nfs_mount_path` | 13 | `'/mnt/nfs'` | NFS mount path. |
| `nfs_volume_name` | 13 | `'nfs-data-volume'` | Volume name for the NFS mount. |
| `nfs_instance_name` | 13 | `""` | Name of an existing NFS GCE VM. |
| `nfs_instance_base_name` | 13 | `'app-nfs'` | Base name for inline NFS VM. |

---

## 4. Advanced Security

### A. Identity-Aware Proxy (IAP)

IAP is particularly valuable for Metabase GKE deployments — it restricts access to the BI tool to authenticated Google users before traffic reaches the Kubernetes Service.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Enables IAP for the GKE Ingress. |
| `iap_authorized_users` | 20 | `[]` | Users granted IAP access. |
| `iap_authorized_groups` | 20 | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | 20 | `""` | OAuth 2.0 Client ID. Required when `enable_iap = true`. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth 2.0 Client Secret. Required when `enable_iap = true`. Sensitive. |
| `iap_support_email` | 20 | `""` | Support email shown on the OAuth consent screen. |

### B. Cloud Armor

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 21 | `false` | Attaches a Cloud Armor security policy to the GKE Ingress backend. |
| `admin_ip_ranges` | 21 | `[]` | Admin CIDR ranges. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Cloud Armor security policy name. |
| `enable_cdn` | 21 | `false` | Enables Cloud CDN on the GKE Ingress backend. |

### C. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enables VPC-SC perimeter enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 5. Traffic & Ingress

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_domain` | 19 | `false` | Provisions a Kubernetes Ingress for custom domain routing. |
| `application_domains` | 19 | `[]` | Custom domain names for the Ingress. |
| `reserve_static_ip` | 19 | `true` | Provisions a global static external IP. Recommended for production. |
| `static_ip_name` | 19 | `""` | Name for the static IP. Leave empty to auto-generate. |
| `network_tags` | 19 | `['nfsserver']` | Network tags applied to GKE nodes. |
| `network_name` | 19 | `""` | VPC network name. Leave empty to auto-discover. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 12 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 12 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 12 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 12 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Ordered promotion stages. |
| `enable_binary_authorization` | 12 | `false` | Enforces image attestation. |

---

## 7. Reliability & Scheduling

### A. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe_config` | 10 | `{ path="/api/health", initial_delay_seconds=60, failure_threshold=18 }` | GKE startup probe. Allows up to 240 seconds total startup tolerance for JVM. |
| `health_check_config` | 10 | `{ path="/api/health", initial_delay_seconds=120, failure_threshold=3 }` | GKE liveness probe. |
| `uptime_check_config` | 10 | `{ enabled=false, path="/api/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 10 | `[]` | Cloud Monitoring metric alert policies. |
| `startup_probe` | 10 | `{ path="/api/health", initial_delay_seconds=60, failure_threshold=18 }` | Probe config passed to `Metabase_Common`. |
| `liveness_probe` | 10 | `{ path="/api/health", initial_delay_seconds=120, failure_threshold=3 }` | Probe config passed to `Metabase_Common`. |

### B. Reliability Policies

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | 9 | `true` | Creates a Kubernetes PodDisruptionBudget. |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | 9 | `false` | Distributes pods across GKE node zones. |
| `topology_spread_strict` | 9 | `false` | Rejects pods if topology spread cannot be satisfied. |

### C. Resource Quotas

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | 8 | `false` | Creates a Kubernetes ResourceQuota. |
| `quota_cpu_requests` | 8 | `""` | Total CPU requests allowed. |
| `quota_cpu_limits` | 8 | `""` | Total CPU limits allowed. |
| `quota_memory_requests` | 8 | `""` | Total memory requests. Must use binary unit suffixes (e.g., `'4Gi'`). |
| `quota_memory_limits` | 8 | `""` | Total memory limits. Must use binary unit suffixes (e.g., `'8Gi'`). |
| `quota_max_pods` | 8 | `""` | Maximum pods in the namespace. Not referenced. |
| `quota_max_services` | 8 | `""` | Maximum Services in the namespace. Not referenced. |
| `quota_max_pvcs` | 8 | `""` | Maximum PVCs in the namespace. Not referenced. |

### D. Jobs & Scheduled Tasks

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 11 | `[]` | Kubernetes Jobs run before the application starts. Leave empty for the default `db-init` job. |
| `cron_jobs` | 11 | `[]` | Scheduled cluster tasks using Kubernetes CronJobs. |
| `additional_services` | 11 | `[]` | Sidecar or helper GKE services. |

### E. Backup

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 17 | `'0 2 * * *'` | Backup cron schedule. |
| `backup_retention_days` | 17 | `7` | Days to retain backup files. |
| `enable_backup_import` | 17 | `false` | Triggers a one-time database import. |
| `backup_source` | 17 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 17 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 17 | `'sql'` | Backup file format. |

---

## 8. Integrations

### A. Redis

Metabase does not natively use Redis. The `enable_redis` variable injects `REDIS_HOST` and `REDIS_PORT` environment variables but does not configure Metabase's operation.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Injects Redis environment variables. Not required by Metabase. |
| `redis_host` | 21 | `""` | Redis hostname or IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port. |

### B. Custom SQL Scripts

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 18 | `false` | Runs SQL scripts from GCS against the Metabase database. |
| `custom_sql_scripts_bucket` | 18 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 18 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 18 | `false` | Run scripts as the root DB user. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Detail |
|---|---|
| **PostgreSQL 15 required** | Metabase uses PostgreSQL as its application database. All state is stored in PostgreSQL. |
| **`MB_JETTY_PORT = "3000"` injected** | Set automatically by `Metabase_Common`. Must match `container_port`. |
| **`JAVA_TIMEZONE = "UTC"` injected** | Set automatically by `Metabase_Common`. Ensures consistent timestamp handling. |
| **Default db-init Kubernetes Job** | `Metabase_Common` provides a `db-init` job that runs before the workload. Override by setting `initialization_jobs`. |
| **Metabase is stateless** | Use `workload_type = 'Deployment'`. StatefulSet is available but not recommended. |
| **Session affinity = ClientIP** | Default sticky sessions prevent users from being re-routed mid-session when HPA scales pods. |
| **No application secrets generated** | Metabase manages its own internal keys. No `SECRET_KEY` equivalent is created. |
| **No default GCS storage** | All Metabase state is in PostgreSQL. The `storage_buckets` default is empty. |
| **Unix socket by default** | `enable_cloudsql_volume = true`. Connects to Cloud SQL via Auth Proxy Unix socket. |

---

## 10. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `external_ip` | External load balancer IP address. |
| `namespace` | Kubernetes namespace for the deployment. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `container_image` | Container image used for the deployment. |
