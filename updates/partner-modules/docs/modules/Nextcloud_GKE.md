# Nextcloud on GKE Autopilot

This document provides a comprehensive reference for the `modules/Nextcloud_GKE` Terraform module. It covers architecture, IAM, configuration variables, Nextcloud-specific behaviours, and operational patterns for deploying Nextcloud on Google Kubernetes Engine (GKE) Autopilot.

---

## 1. Module Overview

Nextcloud is the leading self-hosted file sync and collaboration platform, used by 400 million+ users across 100,000+ organisations. `Nextcloud_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning and injects Nextcloud-specific application configuration, database initialisation, and storage configuration via `Nextcloud_Common`.

**Key Capabilities:**
*   **Compute**: GKE Autopilot, Apache/PHP container, 2 vCPU / 4 Gi by default. StatefulSet or Deployment workload type; `stateful_pvc_enabled` auto-selects StatefulSet for persistent storage.
*   **Data Persistence**: Cloud SQL **MySQL 8.0** via Cloud SQL Auth Proxy sidecar. NFS (Cloud Filestore) for shared config and user data. GCS Fuse volumes available for object storage mounts.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_GKE`. Admin password auto-generated and stored in Secret Manager. Workload Identity for secure SA binding.
*   **Caching**: Redis **enabled by default** (`enable_redis = true`) — `Nextcloud_Common` configures Redis as Nextcloud's distributed cache and file locking backend.
*   **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
*   **Reliability**: Health probes target `/status.php`. Pod disruption budget enabled by default. HPA for horizontal scaling.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `region` | 1 | `string` | `'us-central1'` | GCP region for resource deployment. |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'nextcloud'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'Nextcloud'` | Human-readable name shown in dashboards. |
| `application_description` | 3 | `string` | `'Nextcloud self-hosted collaboration and file sharing platform on GKE Autopilot'` | Workload description. |
| `application_version` | 3 | `string` | `'30'` | Nextcloud image version tag. |

**Wrapper architecture:** `Nextcloud_GKE` calls `Nextcloud_Common` (with `application_database_name` → `db_name` and `application_database_user` → `db_user`). It merges `NEXTCLOUD_TRUSTED_DOMAINS` (cluster-internal DNS + custom domains), sets `MYSQL_HOST = "127.0.0.1"` for the Cloud SQL Auth Proxy sidecar, and sets `OVERWRITECLIURL = "$(GKE_SERVICE_URL)"` resolved at apply time by `App_GKE`. `module_secret_env_vars` carries the admin password secret reference. `module_storage_buckets` carries the `nextcloud-data` bucket.

**MySQL note:** Nextcloud requires **MySQL 8.0** — fixed by `Nextcloud_Common`.

---

## 2. IAM & Access Control

`Nextcloud_GKE` delegates all IAM provisioning to `App_GKE`. Workload Identity binds the Kubernetes service account to a GCP service account that has access to Cloud SQL, Secret Manager, GCS, and NFS.

**Admin password secret:** `Nextcloud_Common` auto-generates a 24-character alphanumeric admin password at `<resource_prefix>-admin-password` in Secret Manager. Injected as `NEXTCLOUD_ADMIN_PASSWORD`.

**Database initialisation identity:** The `db-init` Kubernetes Job runs under the workload service account. It connects via the Cloud SQL Auth Proxy sidecar socket, then falls back to TCP via `DB_IP`.

For the complete role tables and IAP, password rotation, and Workload Identity details, see [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (GKE Workload)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | 4 | `'2000m'` | CPU per pod. 2 vCPU minimum recommended. |
| `memory_limit` | 4 | `'4Gi'` | Memory per pod. 4 Gi recommended for production. |
| `container_port` | 4 | `80` | Apache HTTP port inside the container. |
| `container_resources` | 4 | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Structured resource limits. When set at the Application Module level, overrides the `cpu_limit`/`memory_limit` shorthands. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `min_instance_count` | 4 | `1` | Minimum HPA replicas. |
| `max_instance_count` | 4 | `5` | Maximum HPA replicas. |
| `timeout_seconds` | 4 | `300` | Load balancer backend timeout in seconds. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Auth Proxy socket mount path. |
| `enable_image_mirroring` | 4 | `true` | Mirrors Nextcloud image into Artifact Registry. |
| `service_annotations` | 4 | `{}` | Custom Kubernetes Service annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Kubernetes Service. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA for automatic resource request tuning. |

### B. GKE-Specific Configuration

| Variable | Group | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | 6 | `""` | Target GKE cluster name. Auto-discovered when empty. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Auto-generated from `application_name` + `tenant_deployment_id` when empty. |
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. Auto-selects `StatefulSet` when `stateful_pvc_enabled = true`. |
| `service_type` | 6 | `'LoadBalancer'` | Kubernetes Service type: `ClusterIP`, `LoadBalancer`, or `NodePort`. |
| `session_affinity` | 6 | `'ClientIP'` | `'ClientIP'` routes requests from the same client to the same pod. |
| `network_tags` | 6 | `['nfsserver']` | Network tags for VPC firewall rules. `nfsserver` required for NFS connectivity. |
| `termination_grace_period_seconds` | 6 | `30` | Seconds Kubernetes waits after SIGTERM before SIGKILL. |
| `deployment_timeout` | 6 | `1800` | Seconds Terraform waits for rollout to complete. |
| `enable_network_segmentation` | 6 | `false` | Creates NetworkPolicy resources for pod-level traffic isolation. |
| `configure_service_mesh` | 6 | `false` | Adds `istio-injection: enabled` label to namespace. |
| `enable_multi_cluster_service` | 6 | `false` | Creates ServiceExport for Multi-Cluster Services. |
| `gke_cluster_selection_mode` | 6 | `'primary'` | Strategy for choosing the target cluster. Not referenced — for documentation only. |

### C. Database (Cloud SQL — MySQL 8.0)

Nextcloud requires **MySQL 8.0**. On GKE, the Cloud SQL Auth Proxy sidecar binds on `127.0.0.1:3306`, so `Nextcloud_GKE` hardcodes `MYSQL_HOST = "127.0.0.1"` in the merged environment.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_database_name` | 16 | `'gkeappdb'` | MySQL database name. Passed to `Nextcloud_Common` as `db_name`. **Do not change after initial deployment.** |
| `application_database_user` | 16 | `'gkeappuser'` | MySQL application user. Passed to `Nextcloud_Common` as `db_user`. |
| `database_type` | 16 | `'MYSQL_8_0'` | Cloud SQL engine. Fixed at `MYSQL_8_0` by `Nextcloud_Common`. |
| `database_password_length` | 16 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 16 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 16 | `90` | Seconds to wait after rotation before rolling pods. |
| `enable_mysql_plugins` | 16 | `false` | Install MySQL plugins. |
| `mysql_plugins` | 16 | `[]` | List of MySQL plugins to install. |

> `db_name` and `db_user` are convenience pass-through variables in `Nextcloud_GKE` that map to `application_database_name` and `application_database_user` respectively.

### D. Storage (NFS & GCS)

**NFS is enabled by default** (`enable_nfs = true`). As with Cloud Run, the `entrypoint.sh` script symlinks `/var/www/html/config` → `/mnt/nfs/nextcloud-config` and sets `NEXTCLOUD_DATA_DIR=/mnt/nfs/nextcloud-data`. This is critical for multi-replica deployments where all pods must share the same `config.php` and user data directory.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 13 | `true` | Provisions NFS shared storage. Required for `config.php` persistence and shared user data. |
| `nfs_mount_path` | 13 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `nfs_volume_name` | 13 | `'nfs-data-volume'` | Kubernetes volume name for the NFS mount. |
| `nfs_instance_name` | 13 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 13 | `'app-nfs'` | Base name for inline NFS VM. |
| `create_cloud_storage` | 14 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 14 | `[{ name_suffix = "data" }]` | GCS buckets to provision. |
| `gcs_volumes` | 14 | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |
| `manage_storage_kms_iam` | 14 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 14 | `false` | Creates Artifact Registry KMS key for CMEK image encryption. |

### E. Nextcloud-Specific Settings

| Variable | Group | Default | Description |
|---|---|---|---|
| `nextcloud_admin_user` | 22 | `'admin'` | Nextcloud administrator account username. |
| `php_memory_limit` | 22 | `'512M'` | PHP memory limit. Baked into the container image and injected at runtime. |
| `upload_max_filesize` | 22 | `'512M'` | PHP `upload_max_filesize`. Increase for large uploads (e.g. `'5G'`). |
| `post_max_size` | 22 | `'512M'` | PHP `post_max_size`. Must be ≥ `upload_max_filesize`. |

### F. StatefulSet Configuration

For persistent per-pod storage (in addition to the shared NFS volume), enable StatefulSet PVCs:

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 7 | `null` | Enables PVC templates in the StatefulSet. Auto-selects StatefulSet when `true`. |
| `stateful_pvc_size` | 7 | `'10Gi'` | Storage size per PVC. |
| `stateful_pvc_mount_path` | 7 | `'/data'` | Filesystem path for the per-pod PVC inside the container. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | Kubernetes StorageClass for PVC provisioning. |
| `stateful_headless_service` | 7 | `null` | Creates a headless Service for stable pod DNS entries. |
| `stateful_pod_management_policy` | 7 | `null` | `'OrderedReady'` or `'Parallel'`. |
| `stateful_update_strategy` | 7 | `null` | `'RollingUpdate'` or `'OnDelete'`. |
| `stateful_fs_group` | 7 | `0` | Pod-level `fsGroup` for PVC ownership (e.g. `33` for `www-data`). |

### G. Trusted Domains & URL Override

In GKE, `Nextcloud_GKE`'s `nextcloud.tf` hardcodes the following environment variable merges:

- `MYSQL_HOST = "127.0.0.1"` — Cloud SQL Auth Proxy sidecar binds on localhost.
- `NEXTCLOUD_TRUSTED_DOMAINS` — includes the cluster-internal DNS name (`<resource_prefix>.<namespace>.svc.cluster.local`) plus any `application_domains`.
- `OVERWRITECLIURL = "$(GKE_SERVICE_URL)"` — sentinel resolved by `App_GKE` to the actual service URL (custom domain, LoadBalancer IP, or cluster-internal) at apply time.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 19 | `[]` | Custom domain names for the Ingress. Also added to `NEXTCLOUD_TRUSTED_DOMAINS`. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 21 | `false` | Attaches a Cloud Armor security policy to the GKE Ingress. |
| `admin_ip_ranges` | 21 | `[]` | CIDR ranges for privileged access. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Cloud Armor security policy name. |

### B. Identity-Aware Proxy (IAP)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Enables IAP on the GKE Ingress backend. |
| `iap_authorized_users` | 20 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 20 | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | 20 | `""` | OAuth 2.0 Client ID. Required when `enable_iap = true`. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth 2.0 Client Secret. Required when `enable_iap = true`. Sensitive. |
| `iap_support_email` | 20 | `""` | Support email shown on the OAuth consent screen. |

### C. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enforces VPC Service Controls perimeters around GCP APIs. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

### D. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 12 | `false` | Enforces image attestation on the GKE cluster. |

### E. Secret Manager Integration

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 5 | `{}` | Secret Manager references injected as pod environment variables. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |

**Auto-generated secrets:** `Nextcloud_Common` generates `<resource_prefix>-admin-password` injected as `NEXTCLOUD_ADMIN_PASSWORD`. `DB_PASSWORD` and `ROOT_PASSWORD` are provisioned by `App_GKE`.

---

## 5. Networking & Access

### A. Custom Domain & Ingress

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_domain` | 19 | `false` | Provisions a Kubernetes Ingress for custom domain routing. |
| `application_domains` | 19 | `[]` | Custom domain names. Also added to `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `reserve_static_ip` | 19 | `true` | Provisions a global static external IP for the load balancer. |
| `static_ip_name` | 19 | `""` | Name for the static IP. Auto-generated when empty. |

### B. CDN

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 21 | `false` | Enables Cloud CDN on the GKE Ingress backend. Only applies when `enable_custom_domain = true`. |

---

## 6. Reliability

### A. Pod Disruption Budget

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | 9 | `true` | Creates a PodDisruptionBudget preventing full offline during node upgrades. |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during voluntary disruptions. |

### B. Topology Spread

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_topology_spread` | 9 | `false` | Distributes pods evenly across GKE node zones. Recommended for `min_instance_count > 1`. |
| `topology_spread_strict` | 9 | `false` | `true` rejects pods if spread cannot be satisfied. |

### C. Resource Quotas

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | 8 | `false` | Creates a Kubernetes ResourceQuota in the namespace. |
| `quota_cpu_requests` | 8 | `""` | Total CPU requests allowed in the namespace. |
| `quota_cpu_limits` | 8 | `""` | Total CPU limits allowed in the namespace. |
| `quota_memory_requests` | 8 | `""` | Total memory requests (must use binary suffix: `4Gi`, `8192Mi`). |
| `quota_memory_limits` | 8 | `""` | Total memory limits (must use binary suffix). |

> **Important:** `quota_memory_requests` and `quota_memory_limits` must use binary unit suffixes (`Gi`, `Mi`). Bare integers are treated as bytes by Kubernetes and will block all pod scheduling.

### D. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 10 | `{ enabled=true, type="HTTP", path="/status.php", initial_delay_seconds=60, timeout_seconds=10, period_seconds=15, failure_threshold=20 }` | Startup probe. Allows `occ maintenance:install` to complete on first boot. |
| `liveness_probe` | 10 | `{ enabled=true, type="HTTP", path="/status.php", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Liveness probe. Restarts the container after 3 consecutive failures. |
| `health_check_config` | 10 | `{ enabled=true, path="/healthz" }` | GKE-level health check config (mapped to `startup_probe_config` in `App_GKE`). |
| `startup_probe_config` | 10 | `{ enabled=true, path="/healthz" }` | GKE-level startup probe config. |
| `uptime_check_config` | 10 | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 10 | `[]` | Cloud Monitoring metric alert policies. |

---

## 7. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 12 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 12 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 12 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 12 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Ordered promotion stages. |

---

## 8. Integrations

### A. Redis Cache

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 15 | `true` | **Enabled by default.** Redis for Nextcloud caching and file locking. |
| `redis_host` | 15 | `""` | Redis hostname/IP. Leave blank to use NFS server IP. |
| `redis_port` | 15 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 15 | `""` | Redis AUTH password. Sensitive. |

### B. Backup Import & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 17 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 17 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 17 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 17 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 17 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 17 | `'sql'` | Backup format. |

### C. Custom SQL Scripts

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 18 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 18 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 18 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 18 | `false` | Run scripts as root DB user. |

### D. Jobs & Cron

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 11 | `[]` | One-shot Kubernetes Jobs. Leave empty for `Nextcloud_Common` to supply the default `db-init` job. |
| `cron_jobs` | 11 | `[]` | Kubernetes CronJobs for recurring scheduled tasks. |
| `additional_services` | 11 | `[]` | Additional sidecar or companion GKE services. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **MySQL 8.0 required** | `database_type = "MYSQL_8_0"` fixed by `Nextcloud_Common` | Nextcloud requires MySQL. PostgreSQL is not supported. |
| **Admin password auto-generated** | `Nextcloud_Common` creates `<prefix>-admin-password` | Injected as `NEXTCLOUD_ADMIN_PASSWORD`. |
| **PHP limits baked at build time** | Docker `ARG` in `Nextcloud_Common`'s Dockerfile | `php_memory_limit`, `upload_max_filesize`, `post_max_size` baked and also injected as env vars. |
| **MySQL host forced to 127.0.0.1** | Hardcoded in `nextcloud.tf` locals merge | Cloud SQL Auth Proxy sidecar on GKE binds on localhost. |
| **Trusted domains include cluster-internal DNS** | `nextcloud.tf` merges `<resource_prefix>.<namespace>.svc.cluster.local` | Ensures Kubernetes-internal service discovery works. |
| **OVERWRITECLIURL uses $(GKE_SERVICE_URL)** | `nextcloud.tf` sentinel | Resolved to actual service URL at apply time by `App_GKE`. |
| **NFS config symlink** | `entrypoint.sh` | Symlinks `/var/www/html/config` → `/mnt/nfs/nextcloud-config` when NFS is mounted. |
| **NFS enabled by default** | `enable_nfs = true` default | Critical for multi-pod deployments — all replicas must share `config.php` and data. |
| **Redis enabled by default** | `enable_redis = true` default | Prevents file locking conflicts in multi-pod scenarios. |
| **Default db-init job** | Supplied by `Nextcloud_Common` when `initialization_jobs = []` | MySQL database and user created with utf8mb4 collation. |
| **Pod Disruption Budget** | `enable_pod_disruption_budget = true` default | Ensures at least 1 pod is available during node upgrades. |

---

## 10. Variable Reference

All user-configurable variables exposed by `Nextcloud_GKE`, sorted by UI group.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Nextcloud GKE platform text) | Platform metadata. |
| `module_documentation` | 0 | `'https://docs.radmodules.dev/docs/modules/Nextcloud_GKE'` | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services_GCP']` | Platform metadata: required modules. |
| `credit_cost` | 0 | `150` | Platform metadata: deployment credit cost. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users who can access the module regardless of `public_access`. Actively enforced by the platform. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform. |
| `impersonation_service_account` | 0 | `""` | SA to impersonate for shell scripts. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'nextcloud'` | Base resource name. |
| `application_display_name` | 3 | `'Nextcloud'` | Human-readable name. |
| `application_description` | 3 | (Nextcloud description) | Workload description. |
| `application_version` | 3 | `'30'` | Nextcloud container image tag. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 4 | `""` | Override image URI. |
| `cpu_limit` | 4 | `'2000m'` | CPU per pod. |
| `memory_limit` | 4 | `'4Gi'` | Memory per pod. |
| `container_port` | 4 | `80` | Apache HTTP port. |
| `container_resources` | 4 | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Structured resource limits. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `min_instance_count` | 4 | `1` | Minimum HPA replicas. |
| `max_instance_count` | 4 | `5` | Maximum HPA replicas. |
| `timeout_seconds` | 4 | `300` | Load balancer backend timeout. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Auth Proxy socket mount path. |
| `enable_image_mirroring` | 4 | `true` | Mirrors image into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA. |
| `service_annotations` | 4 | `{}` | Custom Kubernetes Service annotations. |
| `service_labels` | 4 | `{}` | Kubernetes Service labels. |
| `environment_variables` | 5 | SMTP defaults | Plain-text env vars. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |
| `gke_cluster_name` | 6 | `""` | Target GKE cluster. Auto-discovered when empty. |
| `gke_cluster_selection_mode` | 6 | `'primary'` | Cluster selection strategy. Not referenced. |
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. Auto-selects StatefulSet when `stateful_pvc_enabled=true`. |
| `service_type` | 6 | `'LoadBalancer'` | Kubernetes Service type. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Auto-generated when empty. |
| `session_affinity` | 6 | `'ClientIP'` | Session affinity mode. |
| `network_tags` | 6 | `['nfsserver']` | GKE node network tags for VPC firewall rules. |
| `termination_grace_period_seconds` | 6 | `30` | Grace period before SIGKILL. |
| `deployment_timeout` | 6 | `1800` | Rollout completion timeout. |
| `enable_network_segmentation` | 6 | `false` | Creates NetworkPolicy resources. |
| `configure_service_mesh` | 6 | `false` | Enables Istio sidecar injection. |
| `enable_multi_cluster_service` | 6 | `false` | Creates ServiceExport for MCS. |
| `stateful_pvc_enabled` | 7 | `null` | Enables per-pod PVC templates. |
| `stateful_pvc_size` | 7 | `'10Gi'` | Storage size per PVC. |
| `stateful_pvc_mount_path` | 7 | `'/data'` | Mount path for per-pod PVC. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | StorageClass for PVCs. |
| `stateful_headless_service` | 7 | `null` | Creates headless Service for pod DNS. |
| `stateful_pod_management_policy` | 7 | `null` | `'OrderedReady'` or `'Parallel'`. |
| `stateful_update_strategy` | 7 | `null` | `'RollingUpdate'` or `'OnDelete'`. |
| `stateful_fs_group` | 7 | `0` | Pod-level `fsGroup` GID for PVC ownership. |
| `enable_resource_quota` | 8 | `false` | Creates Kubernetes ResourceQuota. |
| `quota_cpu_requests` | 8 | `""` | Total CPU requests quota. |
| `quota_cpu_limits` | 8 | `""` | Total CPU limits quota. |
| `quota_memory_requests` | 8 | `""` | Total memory requests quota (binary suffix required). |
| `quota_memory_limits` | 8 | `""` | Total memory limits quota (binary suffix required). |
| `enable_pod_disruption_budget` | 9 | `true` | Creates PodDisruptionBudget. |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during disruptions. |
| `enable_topology_spread` | 9 | `false` | Distributes pods across zones. |
| `topology_spread_strict` | 9 | `false` | Strict spread enforcement. |
| `health_check_config` | 10 | `{ enabled=true, path="/healthz" }` | GKE liveness probe config. |
| `startup_probe_config` | 10 | `{ enabled=true, path="/healthz" }` | GKE startup probe config. |
| `startup_probe` | 10 | `{ path="/status.php", initial_delay_seconds=60, failure_threshold=20, ... }` | Nextcloud startup probe. |
| `liveness_probe` | 10 | `{ path="/status.php", initial_delay_seconds=120, failure_threshold=3, ... }` | Nextcloud liveness probe. |
| `uptime_check_config` | 10 | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 10 | `[]` | Cloud Monitoring metric alert policies. |
| `initialization_jobs` | 11 | `[]` | One-shot Kubernetes Jobs. Leave empty for default `db-init`. |
| `cron_jobs` | 11 | `[]` | Kubernetes CronJobs. |
| `additional_services` | 11 | `[]` | Additional sidecar/companion GKE services. |
| `enable_cicd_trigger` | 12 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 12 | `""` | GitHub repository URL. |
| `github_token` | 12 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Cloud Build trigger config. |
| `enable_cloud_deploy` | 12 | `false` | Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 12 | `false` | Enforces image attestation. |
| `enable_nfs` | 13 | `true` | Provisions NFS shared storage. |
| `nfs_mount_path` | 13 | `'/mnt/nfs'` | NFS container mount path. |
| `nfs_volume_name` | 13 | `'nfs-data-volume'` | Kubernetes volume name for NFS. |
| `nfs_instance_name` | 13 | `""` | Existing NFS GCE VM name. |
| `nfs_instance_base_name` | 13 | `'app-nfs'` | Base name for inline NFS VM. |
| `create_cloud_storage` | 14 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 14 | `[{ name_suffix = "data" }]` | GCS buckets to provision. |
| `gcs_volumes` | 14 | `[]` | GCS buckets to mount via GCS Fuse CSI. |
| `manage_storage_kms_iam` | 14 | `false` | Creates CMEK key for storage. |
| `enable_artifact_registry_cmek` | 14 | `false` | Creates CMEK key for Artifact Registry. |
| `max_images_to_retain` | 14 | `7` | Maximum recent images in Artifact Registry. |
| `delete_untagged_images` | 14 | `true` | Deletes untagged images. |
| `image_retention_days` | 14 | `30` | Days after which images are eligible for deletion. |
| `enable_redis` | 15 | `true` | Redis for caching and file locking. |
| `redis_host` | 15 | `""` | Redis hostname/IP. |
| `redis_port` | 15 | `'6379'` | Redis TCP port. |
| `redis_auth` | 15 | `""` | Redis AUTH password. Sensitive. |
| `database_type` | 16 | `'MYSQL_8_0'` | Cloud SQL engine. |
| `application_database_name` | 16 | `'gkeappdb'` | MySQL database name. Maps to `db_name` in `Nextcloud_Common`. |
| `application_database_user` | 16 | `'gkeappuser'` | MySQL user. Maps to `db_user` in `Nextcloud_Common`. |
| `database_password_length` | 16 | `32` | Password length. Range: 16–64. |
| `enable_auto_password_rotation` | 16 | `false` | Automated password rotation. |
| `rotation_propagation_delay_sec` | 16 | `90` | Seconds to wait before rolling pods after rotation. |
| `enable_mysql_plugins` | 16 | `false` | Install MySQL plugins. |
| `mysql_plugins` | 16 | `[]` | MySQL plugins list. |
| `db_name` | 16 | `'nextcloud'` | Convenience alias for `application_database_name`. |
| `db_user` | 16 | `'nextcloud'` | Convenience alias for `application_database_user`. |
| `backup_schedule` | 17 | `'0 2 * * *'` | Backup cron schedule. |
| `backup_retention_days` | 17 | `7` | Days to retain backups. |
| `enable_backup_import` | 17 | `false` | Triggers one-time restore. |
| `backup_source` | 17 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 17 | `""` | GCS URI or Drive file ID. |
| `backup_format` | 17 | `'sql'` | Backup format. |
| `enable_custom_sql_scripts` | 18 | `false` | Runs custom SQL scripts from GCS. |
| `custom_sql_scripts_bucket` | 18 | `""` | GCS bucket with SQL scripts. |
| `custom_sql_scripts_path` | 18 | `""` | Path prefix in bucket. |
| `custom_sql_scripts_use_root` | 18 | `false` | Run as root DB user. |
| `enable_custom_domain` | 19 | `false` | Provisions Kubernetes Ingress. |
| `application_domains` | 19 | `[]` | Custom domains. Added to `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `reserve_static_ip` | 19 | `true` | Provisions a global static IP. |
| `static_ip_name` | 19 | `""` | Name for the static IP. |
| `network_name` | 19 | `""` | VPC network name. Not referenced. |
| `enable_iap` | 20 | `false` | Enables IAP. |
| `iap_authorized_users` | 20 | `[]` | IAP user allowlist. |
| `iap_authorized_groups` | 20 | `[]` | IAP group allowlist. |
| `iap_oauth_client_id` | 20 | `""` | OAuth Client ID. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth Client Secret. Sensitive. |
| `iap_support_email` | 20 | `""` | OAuth consent screen support email. |
| `enable_cloud_armor` | 21 | `false` | Attaches Cloud Armor policy. |
| `admin_ip_ranges` | 21 | `[]` | Admin CIDR ranges. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Cloud Armor security policy name. |
| `enable_cdn` | 21 | `false` | Enables Cloud CDN on the Ingress backend. |
| `enable_vpc_sc` | 22 | `false` | Enforces VPC-SC perimeters. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDRs for VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |
| `nextcloud_admin_user` | 22 | `'admin'` | Nextcloud administrator username. |
| `php_memory_limit` | 22 | `'512M'` | PHP memory limit. |
| `upload_max_filesize` | 22 | `'512M'` | PHP `upload_max_filesize`. |
| `post_max_size` | 22 | `'512M'` | PHP `post_max_size`. |

---

## 11. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `service_url` | External URL of the Nextcloud service. |
| `external_ip` | External LoadBalancer IP address. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Cloud SQL MySQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `nfs_server_ip` | NFS server internal IP *(sensitive)*. |
| `nfs_mount_path` | NFS mount path inside containers. |
| `container_image` | Container image used for the deployment. |
| `namespace` | Kubernetes namespace. |
| `cluster_name` | GKE cluster name. |
