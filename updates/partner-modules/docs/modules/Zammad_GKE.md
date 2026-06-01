# Zammad on GKE Autopilot

This document provides a comprehensive reference for the `modules/Zammad_GKE` Terraform module. It covers architecture, IAM, configuration variables, Zammad-specific behaviours, and operational patterns for deploying Zammad on Google Kubernetes Engine (GKE) Autopilot.

---

## 1. Module Overview

Zammad is an open-source helpdesk and customer support platform — a GDPR-compliant alternative to Zendesk and Freshdesk. `Zammad GKE` is a **wrapper module** built on top of `App GKE`. It uses `App GKE` for all GCP and Kubernetes infrastructure provisioning and injects Zammad-specific application configuration via `Zammad Common`.

**Key Capabilities:**
*   **Compute**: GKE Autopilot, Rails-based container, 2 vCPU / 4 Gi by default. Horizontal Pod Autoscaling with configurable `min_instance_count` / `max_instance_count`.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15** (required). NFS (GCE VM or Filestore) for Zammad attachment storage at `/opt/zammad/storage`. GCS `zammad-attachments` bucket auto-provisioned.
*   **Security**: Workload Identity for secure GCP API access without key files. Inherits Cloud Armor WAF (via GKE Ingress), IAP, Binary Authorization, NetworkPolicy, and PodDisruptionBudget from `App GKE`.
*   **StatefulSet support**: `stateful_pvc_enabled` enables per-pod PVCs for workloads that require persistent local storage alongside the shared NFS volume.
*   **Caching & Background Jobs**: Redis **enabled by default** (`enable_redis = true`). Zammad requires Redis for ActionCable WebSocket pub/sub and Sidekiq background job processing.
*   **Container Build**: `container_image_source = 'custom'` by default — Cloud Build builds a custom image from `Zammad_Common`'s Dockerfile, extending `zammad/zammad` with the GCP-specific `entrypoint.sh`.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'zammad'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'Zammad Helpdesk'` | Human-readable name shown in the GCP Console. |
| `application_description` | 3 | `string` | `'Zammad Open-source Helpdesk on GKE Autopilot'` | Application description. |
| `application_version` | 3 | `string` | `'6.4.1'` | Zammad image version tag. Increment to trigger a new build. |

**Wrapper architecture:** `Zammad GKE` calls the `App GKE` foundation module directly (it does not have a separate `zammad.tf` application locals file in the same style as the Cloud Run variant — the `App GKE` call in `main.tf` passes all configuration inline). `Zammad Common` provides the container image configuration, `db-init` job, and `zammad-attachments` storage bucket. The custom `entrypoint.sh` maps Foundation-injected `DB_*` variables to Zammad's `POSTGRESQL_*` convention and runs `zammad-init` on startup. On GKE, `DB_HOST = 127.0.0.1` (the cloud-sql-proxy sidecar), which is TCP-addressable — no `DB_IP` fallback is needed.

**PostgreSQL requirement:** Zammad requires **PostgreSQL 13 or later**. MySQL is not supported and is rejected at plan time.

---

## 2. IAM & Access Control

`Zammad GKE` delegates all IAM provisioning to `App GKE`. Kubernetes workloads use **Workload Identity** — the pod's Kubernetes Service Account is federated to a GCP Service Account, eliminating the need for key files.

**Key IAM bindings provisioned by `App GKE`:**
- Cloud SQL Client role on the GCP SA (for Cloud SQL Auth Proxy sidecar)
- Secret Manager Secret Accessor on the GCP SA (for Secret Manager CSI driver or env var injection)
- Artifact Registry Reader (for image pulls)
- GCS bucket read/write on the `zammad-attachments` bucket SA

**No application-level secrets:** `Zammad Common` does not auto-generate application secrets. The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App GKE`.

**Session affinity:** `session_affinity = "ClientIP"` by default — Kubernetes routes each client to the same pod, which is important for Zammad's WebSocket connections (though Redis pub/sub handles cross-pod event delivery).

For the complete role tables, see [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (GKE Autopilot)

Zammad is a Ruby on Rails application. The GKE deployment uses a Kubernetes Deployment or StatefulSet with the Zammad container.

**Minimum memory:** Zammad 6.x requires at least 2 Gi RAM. The default is 4 Gi. Do not reduce below 2 Gi.

**Workload type:** Defaults to `null` (auto-resolved by `App GKE`). Set `stateful_pvc_enabled = true` to automatically use a StatefulSet. Do not set `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` — this combination fails at plan time.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build (default). `'prebuilt'` deploys an existing image URI. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `container_resources` | 4 | `{ cpu_limit: "2000m", memory_limit: "4Gi" }` | CPU/memory limits and optional requests. Validated at plan time. |
| `container_port` | 4 | `3000` | Zammad railsserver port. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. |
| `max_instance_count` | 4 | `5` | Maximum pod replicas. |
| `timeout_seconds` | 4 | `300` | Maximum backend response duration. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_cloudsql_volume` | 4 | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy socket. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Zammad image from Docker Hub into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA for automatic resource request adjustment. |
| `service_annotations` | 4 | `{}` | Custom Kubernetes Service annotations. |
| `service_labels` | 4 | `{}` | Custom Kubernetes Service labels. |
| `termination_grace_period_seconds` | 6 | `60` | Seconds Kubernetes waits before forcibly terminating. Zammad drains WebSocket connections during this window. |

### B. Database (Cloud SQL — PostgreSQL 15)

Identical requirement to the Cloud Run variant. Zammad requires PostgreSQL 15+ and the entrypoint maps `DB_*` to `POSTGRESQL_*`. On GKE, `DB_HOST = 127.0.0.1` (the Auth Proxy sidecar) which supports the TCP readiness check Zammad's init requires.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_database_name` | 16 | `'zammad'` | PostgreSQL database name. **Do not change after initial deployment.** |
| `application_database_user` | 16 | `'zammad'` | PostgreSQL application user. |
| `database_type` | 16 | `'POSTGRES_15'` | Must be `POSTGRES_13`, `POSTGRES_14`, `POSTGRES_15`, or `NONE`. |
| `database_password_length` | 16 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 16 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 16 | `90` | Seconds to wait after rotation before restarting pods. |

### C. Storage (NFS & GCS)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 13 | `true` | Provisions NFS storage for Zammad attachment files. |
| `nfs_mount_path` | 13 | `'/opt/zammad/storage'` | Container path where NFS is mounted. |
| `nfs_volume_name` | 13 | `'nfs-data-volume'` | Kubernetes volume name for the NFS mount. |
| `nfs_instance_name` | 13 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 13 | `'app-nfs'` | Base name for inline NFS VM. |
| `create_cloud_storage` | 14 | `true` | Controls GCS bucket provisioning. |
| `storage_buckets` | 14 | `[{ name_suffix = "data" }]` | Additional GCS buckets. |
| `gcs_volumes` | 14 | `[]` | GCS buckets to mount via CSI GCS Fuse driver. |
| `manage_storage_kms_iam` | 14 | `false` | Enables CMEK on storage buckets. |
| `enable_artifact_registry_cmek` | 14 | `false` | Enables CMEK on the Artifact Registry repository. |

### D. Networking & Ingress

| Variable | Group | Default | Description |
|---|---|---|---|
| `service_type` | 6 | `'LoadBalancer'` | Kubernetes Service type: `ClusterIP`, `LoadBalancer`, or `NodePort`. |
| `session_affinity` | 6 | `'ClientIP'` | Routes each client to the same pod — important for WebSocket session continuity. |
| `enable_custom_domain` | 19 | `false` | Provisions a Kubernetes Ingress for custom domain routing. |
| `application_domains` | 19 | `[]` | Custom domain names for the Ingress. |
| `reserve_static_ip` | 19 | `true` | Provisions a global static external IP for the load balancer. |
| `static_ip_name` | 19 | `""` | Name for the static IP address. Auto-generated if empty. |
| `network_tags` | 19 | `['nfsserver']` | Network tags applied to GKE nodes — required for NFS server firewall rules. |
| `enable_network_segmentation` | 6 | `false` | Creates Kubernetes NetworkPolicy resources to restrict inter-pod traffic. |
| `configure_service_mesh` | 6 | `false` | Enables Istio service mesh injection for the application namespace. |
| `enable_multi_cluster_service` | 6 | `false` | Enables Multi-Cluster Services (MCS) for the application. |

### E. StatefulSet Configuration

| Variable | Group | Default | Description |
|---|---|---|---|
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. `null` auto-resolves. Setting `stateful_pvc_enabled = true` auto-selects `StatefulSet`. |
| `stateful_pvc_enabled` | 7 | `null` | Enables PVC templates in the StatefulSet spec. Auto-selects StatefulSet workload type. |
| `stateful_pvc_size` | 7 | `'10Gi'` | Storage size for each StatefulSet PVC. |
| `stateful_pvc_mount_path` | 7 | `'/data'` | Path inside the pod where the per-pod PVC is mounted. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | StorageClass for StatefulSet PVCs. |
| `stateful_headless_service` | 7 | `null` | Creates a headless Kubernetes Service for stable DNS entries. |
| `stateful_pod_management_policy` | 7 | `null` | `'OrderedReady'` or `'Parallel'`. Controls pod creation order. |
| `stateful_update_strategy` | 7 | `null` | `'RollingUpdate'` or `'OnDelete'`. |
| `stateful_fs_group` | 7 | `0` | GID set as pod-level `fsGroup` in the security context. Set to `0` to leave unset. |

### F. Resource Quota

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | 8 | `false` | Creates a Kubernetes ResourceQuota in the application namespace. |
| `quota_cpu_requests` | 8 | `""` | Total CPU requests allowed across all pods. |
| `quota_cpu_limits` | 8 | `""` | Total CPU limits allowed across all pods. |
| `quota_memory_requests` | 8 | `""` | Total memory requests (must use binary suffix, e.g., `'4Gi'`). |
| `quota_memory_limits` | 8 | `""` | Total memory limits (must use binary suffix, e.g., `'8Gi'`). |

> **Important:** `quota_memory_requests` and `quota_memory_limits` must use binary unit suffixes (`Gi`, `Mi`). Bare integers are treated as bytes by Kubernetes and will block all pod scheduling.

---

## 4. Reliability & High Availability

### A. PodDisruptionBudget

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | 9 | `true` | Creates a Kubernetes PodDisruptionBudget to limit simultaneous pod unavailability during node maintenance. |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during voluntary disruptions. Integer (e.g., `'1'`) or percentage (e.g., `'50%'`). |

### B. Topology Spread

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_topology_spread` | 9 | `false` | Adds `TopologySpreadConstraints` to distribute pods evenly across zones. |
| `topology_spread_strict` | 9 | `false` | When `true`, uses `DoNotSchedule` whenUnsatisfiable (hard constraint). |

### C. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe_config` | 10 | `{ enabled=true, path="/api/v1/ping", initial_delay_seconds=60, failure_threshold=15 }` | Startup probe. Zammad runs DB migrations before accepting traffic. |
| `health_check_config` | 10 | `{ enabled=true, path="/api/v1/ping", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe. |
| `startup_probe` | 10 | `{ enabled=true, path="/api/v1/ping", initial_delay_seconds=60, failure_threshold=30 }` | Per-container startup probe. |
| `liveness_probe` | 10 | `{ enabled=true, path="/-/health", initial_delay_seconds=60, failure_threshold=3 }` | Per-container liveness probe. |
| `uptime_check_config` | 10 | `{ enabled=false, path="/api/v1/ping" }` | Cloud Monitoring uptime check (disabled by default for GKE). |
| `alert_policies` | 10 | `[]` | Custom metric alert policies. |

---

## 5. Environment, Secrets & CI/CD

### A. Environment Variables & Secrets

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | `{}` | Static environment variables. Use for non-sensitive Zammad configuration. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references injected as environment variables. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret rotation schedule. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after a secret is created or updated. |

### B. CI/CD

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 12 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 12 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 12 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Advanced trigger config. |
| `enable_cloud_deploy` | 12 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 12 | `false` | Enforces Binary Authorization on the GKE cluster. |

---

## 6. Redis (Required)

Redis is **enabled by default** and required for Zammad. See `Zammad CloudRun §8.A` for the full description. The same `REDIS_URL` construction logic applies.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 15 | `true` | **Required for production.** Enables Redis for ActionCable and Sidekiq. |
| `redis_host` | 15 | `""` | Redis hostname or IP. Leave blank to use the NFS server IP. |
| `redis_port` | 15 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 15 | `""` | Redis AUTH password. Sensitive. |

---

## 7. Backup & Jobs

### A. Backup Import

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 17 | `'0 2 * * *'` | Cron schedule for automated database backups. |
| `backup_retention_days` | 17 | `7` | Days to retain backup files. |
| `enable_backup_import` | 17 | `false` | Triggers a one-time database import job during deployment. |
| `backup_source` | 17 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_file` | 17 | `'backup.sql'` | Backup filename or Google Drive file ID. |
| `backup_uri` | 17 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 17 | `'sql'` | Backup format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

### B. Kubernetes Jobs

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 11 | `[]` | Kubernetes Jobs run before the application starts. Each job must define at least one of `command`, `args`, or `script_path`. |
| `cron_jobs` | 11 | `[]` | Kubernetes CronJobs for recurring tasks. |
| `additional_services` | 11 | `[]` | Sidecar or helper GKE services deployed alongside Zammad. |

---

## 8. Security

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Enables Identity-Aware Proxy. |
| `iap_authorized_users` | 20 | `[]` | Users granted IAP access. |
| `iap_authorized_groups` | 20 | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | 20 | `""` | OAuth 2.0 Client ID for IAP backend. Required when `enable_iap = true`. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth 2.0 Client Secret for IAP. Required when `enable_iap = true`. Sensitive. |
| `iap_support_email` | 20 | `""` | Support email on the OAuth consent screen. |
| `enable_cloud_armor` | 21 | `false` | Attaches a Cloud Armor security policy to the GKE Ingress backend. |
| `admin_ip_ranges` | 21 | `[]` | IP CIDR ranges allowed for administrative access. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Name of the Cloud Armor security policy. |
| `enable_cdn` | 21 | `false` | Enables Cloud CDN on the GKE Ingress backend. |
| `enable_vpc_sc` | 22 | `false` | Enforces VPC Service Controls perimeters. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID. Must be set explicitly for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL required** | Validation in `variables.tf` | `database_type` must be `POSTGRES_13`, `POSTGRES_14`, `POSTGRES_15`, or `NONE`. |
| **Variable mapping via entrypoint** | Custom `entrypoint.sh` in `Zammad Common` | `DB_HOST = 127.0.0.1` on GKE (Auth Proxy sidecar) — directly TCP-addressable. No `DB_IP` fallback needed unlike Cloud Run. |
| **zammad-init on every start** | `entrypoint.sh` | DB migrations run idempotently on every pod start before the railsserver process. |
| **Redis mandatory** | Validation precondition | When `enable_redis = true`, `redis_host` or `enable_nfs` must be set. |
| **Session affinity** | `session_affinity = "ClientIP"` default | Routes each client to the same pod for WebSocket session continuity. Redis pub/sub handles cross-pod event delivery. |
| **PDB enabled by default** | `enable_pod_disruption_budget = true` | `pdb_min_available = "1"` ensures at least one Zammad pod remains available during node maintenance. |
| **Network tags include `nfsserver`** | `network_tags = ["nfsserver"]` default | Required for GKE node-to-NFS firewall rules to function. |
| **NFS at `/opt/zammad/storage`** | `nfs_mount_path` default | Matches Zammad's expected attachment storage path. |
| **GCS attachments bucket** | Provisioned via `Zammad Common` | `zammad-attachments` bucket is always provisioned separately from `storage_buckets`. |
| **StatefulSet auto-select** | When `stateful_pvc_enabled = true` | `workload_type` resolves automatically to `"StatefulSet"`. Setting `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time. |

---

## 10. Variable Reference

All user-configurable variables exposed by `Zammad GKE`, sorted by UI group then order.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Zammad GKE text) | Platform metadata. |
| `module_documentation` | 0 | `'https://docs.radmodules.dev/docs/modules/Zammad_GKE'` | Documentation URL. |
| `module_dependency` | 0 | `['Services GCP']` | Required modules. |
| `module_services` | 0 | (GCP service list) | GCP services consumed. |
| `credit_cost` | 0 | `150` | Platform credit cost. |
| `require_credit_purchases` | 0 | `false` | Enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users granted access regardless of `public_access`. Actively enforced by the platform. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform. |
| `impersonation_service_account` | 0 | `""` | Service account to impersonate for GCP API calls. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region for resource deployment. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'zammad'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `'Zammad Helpdesk'` | Human-readable name. |
| `application_description` | 3 | `'Zammad Open-source Helpdesk on GKE Autopilot'` | Application description. |
| `application_version` | 3 | `'6.4.1'` | Zammad container image tag. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` or `'prebuilt'`. |
| `container_image` | 4 | `""` | Container image URI override. |
| `container_build_config` | 4 | `{ enabled: true }` | Dockerfile/context for custom builds. Not referenced — controlled by Common module. |
| `enable_image_mirroring` | 4 | `true` | Mirrors image from Docker Hub into Artifact Registry. |
| `container_resources` | 4 | `{ cpu_limit: "2000m", memory_limit: "4Gi" }` | CPU/memory limits and requests. Validated at plan time. |
| `container_port` | 4 | `3000` | Zammad railsserver port. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. |
| `max_instance_count` | 4 | `5` | Maximum pod replicas. |
| `timeout_seconds` | 4 | `300` | Maximum backend response duration. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for Auth Proxy socket. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA. |
| `service_annotations` | 4 | `{}` | Custom Kubernetes Service annotations. |
| `service_labels` | 4 | `{}` | Custom Kubernetes Service labels. |
| `environment_variables` | 5 | `{}` | Static environment variables. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret rotation schedule. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |
| `gke_cluster_name` | 6 | `""` | GKE cluster name. Auto-discovered when empty. |
| `gke_cluster_selection_mode` | 6 | `'primary'` | Cluster selection strategy. Not referenced in this module. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Auto-generated when empty. |
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. Auto-resolved when null. |
| `service_type` | 6 | `'LoadBalancer'` | Kubernetes Service type. |
| `session_affinity` | 6 | `'ClientIP'` | Routes each client to the same pod. |
| `enable_multi_cluster_service` | 6 | `false` | Enables Multi-Cluster Services. |
| `configure_service_mesh` | 6 | `false` | Enables Istio injection. |
| `enable_network_segmentation` | 6 | `false` | Creates Kubernetes NetworkPolicy resources. |
| `termination_grace_period_seconds` | 6 | `60` | SIGTERM grace period before forcible termination. |
| `network_tags` | 19 | `['nfsserver']` | Network tags for GKE nodes. |
| `deployment_timeout` | 6 | `1800` | Maximum seconds for Kubernetes rollout to complete. |
| `prereq_gke_subnet_cidr` | 6 | `'10.201.0.0/24'` | CIDR for the inline GKE subnet. Not referenced in this module. |
| `stateful_pvc_enabled` | 7 | `null` | Enables StatefulSet PVC templates. Auto-selects StatefulSet. |
| `stateful_pvc_size` | 7 | `'10Gi'` | Storage size per pod PVC. |
| `stateful_pvc_mount_path` | 7 | `'/data'` | Pod path for the per-pod PVC. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | StorageClass for StatefulSet PVCs. |
| `stateful_headless_service` | 7 | `null` | Creates a headless Service for stable DNS. |
| `stateful_pod_management_policy` | 7 | `null` | `'OrderedReady'` or `'Parallel'`. |
| `stateful_update_strategy` | 7 | `null` | `'RollingUpdate'` or `'OnDelete'`. |
| `stateful_fs_group` | 7 | `0` | Pod-level `fsGroup` GID. |
| `enable_resource_quota` | 8 | `false` | Creates a Kubernetes ResourceQuota. |
| `quota_cpu_requests` | 8 | `""` | Total CPU requests allowed. |
| `quota_cpu_limits` | 8 | `""` | Total CPU limits allowed. |
| `quota_memory_requests` | 8 | `""` | Total memory requests (must use binary suffix). |
| `quota_memory_limits` | 8 | `""` | Total memory limits (must use binary suffix). |
| `quota_max_pods` | 8 | `""` | Maximum pods in namespace. Not referenced. |
| `quota_max_services` | 8 | `""` | Maximum Services in namespace. Not referenced. |
| `quota_max_pvcs` | 8 | `""` | Maximum PVCs in namespace. Not referenced. |
| `enable_pod_disruption_budget` | 9 | `true` | Creates a PodDisruptionBudget. |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during disruptions. |
| `enable_topology_spread` | 9 | `false` | TopologySpreadConstraints for zone distribution. |
| `topology_spread_strict` | 9 | `false` | Hard constraint when true (`DoNotSchedule`). |
| `startup_probe_config` | 10 | `{ enabled=true, path="/api/v1/ping", ... }` | Service-level startup probe. |
| `health_check_config` | 10 | `{ enabled=true, path="/api/v1/ping", ... }` | Service-level liveness probe. |
| `startup_probe` | 10 | `{ enabled=true, path="/api/v1/ping", ... }` | Per-container startup probe. |
| `liveness_probe` | 10 | `{ enabled=true, path="/-/health", ... }` | Per-container liveness probe. |
| `uptime_check_config` | 10 | `{ enabled=false, path="/api/v1/ping" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 10 | `[]` | Custom metric alert policies. |
| `initialization_jobs` | 11 | `[]` | Kubernetes Jobs run before the application. Requires `command`, `args`, or `script_path`. |
| `cron_jobs` | 11 | `[]` | Kubernetes CronJobs. |
| `additional_services` | 11 | `[]` | Sidecar or helper GKE services. |
| `enable_cicd_trigger` | 12 | `false` | Cloud Build GitHub trigger. |
| `github_repository_url` | 12 | `""` | GitHub repository URL. |
| `github_token` | 12 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Advanced trigger config. |
| `enable_cloud_deploy` | 12 | `false` | Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Cloud Deploy stages. |
| `enable_binary_authorization` | 12 | `false` | Binary Authorization enforcement. |
| `enable_nfs` | 13 | `true` | NFS for attachment storage. |
| `nfs_mount_path` | 13 | `'/opt/zammad/storage'` | Container NFS mount path. |
| `nfs_volume_name` | 13 | `'nfs-data-volume'` | Kubernetes volume name. |
| `nfs_instance_name` | 13 | `""` | Existing NFS VM name. Auto-discovered when empty. |
| `nfs_instance_base_name` | 13 | `'app-nfs'` | Base name for inline NFS VM. |
| `create_cloud_storage` | 14 | `true` | Controls GCS bucket provisioning. |
| `storage_buckets` | 14 | `[{ name_suffix = "data" }]` | Additional GCS buckets. |
| `gcs_volumes` | 14 | `[]` | GCS Fuse CSI volumes. |
| `manage_storage_kms_iam` | 14 | `false` | CMEK on storage buckets. |
| `enable_artifact_registry_cmek` | 14 | `false` | CMEK on Artifact Registry. |
| `max_images_to_retain` | 14 | `7` | Maximum images in Artifact Registry. |
| `delete_untagged_images` | 14 | `true` | Delete untagged images. |
| `image_retention_days` | 14 | `30` | Image age retention threshold. |
| `enable_redis` | 15 | `true` | **Required.** Redis for ActionCable and Sidekiq. |
| `redis_host` | 15 | `""` | Redis hostname or IP. |
| `redis_port` | 15 | `'6379'` | Redis TCP port. |
| `redis_auth` | 15 | `""` | Redis AUTH password. Sensitive. |
| `database_type` | 16 | `'POSTGRES_15'` | Must be PostgreSQL 13–15 or NONE. |
| `application_database_name` | 16 | `'zammad'` | PostgreSQL database name. |
| `application_database_user` | 16 | `'zammad'` | PostgreSQL user. |
| `database_password_length` | 16 | `32` | Auto-generated password length. |
| `enable_postgres_extensions` | 16 | `false` | Enables PostgreSQL extension installation. |
| `postgres_extensions` | 16 | `[]` | List of PostgreSQL extensions to install. |
| `enable_auto_password_rotation` | 16 | `false` | Automated password rotation. |
| `rotation_propagation_delay_sec` | 16 | `90` | Seconds before pod restart after rotation. |
| `backup_schedule` | 17 | `'0 2 * * *'` | Backup cron schedule (UTC). |
| `backup_retention_days` | 17 | `7` | Backup retention days. |
| `enable_backup_import` | 17 | `false` | One-time backup import job. |
| `backup_source` | 17 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_file` | 17 | `'backup.sql'` | Backup filename or Drive file ID. |
| `backup_uri` | 17 | `""` | Full GCS URI or Drive file ID. |
| `backup_format` | 17 | `'sql'` | Backup format. |
| `enable_custom_sql_scripts` | 18 | `false` | Custom SQL scripts from GCS. |
| `custom_sql_scripts_bucket` | 18 | `""` | GCS bucket for SQL scripts. |
| `custom_sql_scripts_path` | 18 | `""` | Path prefix in the bucket. |
| `custom_sql_scripts_use_root` | 18 | `false` | Run scripts as root DB user. |
| `enable_custom_domain` | 19 | `false` | Provisions Kubernetes Ingress. |
| `application_domains` | 19 | `[]` | Custom domain names for Ingress. |
| `reserve_static_ip` | 19 | `true` | Provisions a global static IP. |
| `static_ip_name` | 19 | `""` | Static IP name. Auto-generated when empty. |
| `network_name` | 19 | `""` | VPC network name. Auto-discovered when empty. |
| `enable_iap` | 20 | `false` | Identity-Aware Proxy. |
| `iap_authorized_users` | 20 | `[]` | Users granted IAP access. |
| `iap_authorized_groups` | 20 | `[]` | Groups granted IAP access. |
| `iap_oauth_client_id` | 20 | `""` | OAuth Client ID for IAP. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth Client Secret for IAP. Sensitive. |
| `iap_support_email` | 20 | `""` | Support email for OAuth consent screen. |
| `enable_cloud_armor` | 21 | `false` | Cloud Armor WAF on GKE Ingress. |
| `admin_ip_ranges` | 21 | `[]` | CIDR ranges for admin access. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Cloud Armor policy name. |
| `enable_cdn` | 21 | `false` | Cloud CDN on GKE Ingress backend. |
| `enable_vpc_sc` | 22 | `false` | VPC Service Controls. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC CIDR ranges for VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | VPC-SC dry-run mode. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Cloud Audit Logs. |

---

## 11. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `service_url` | External URL (Load Balancer IP or custom domain). |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix. |
| `database_instance_name` | Cloud SQL PostgreSQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `nfs_server_ip` | NFS server internal IP *(sensitive)*. |
| `nfs_mount_path` | NFS mount path inside pods (`/opt/zammad/storage`). |
| `container_image` | Container image deployed. |
| `namespace` | Kubernetes namespace. |
| `cicd_enabled` | Whether CI/CD pipeline is enabled. |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `enable_redis` | `false` | **Critical** | Zammad requires Redis for its ActionCable real-time communication layer. Without Redis, live ticket updates, agent notifications, and the Zammad scheduler all fail to initialize. Redis is mandatory for any Zammad deployment beyond a minimal test instance. |
| `redis_host` | `""` | **Critical** | When `enable_redis = true` and `redis_host` is empty, `REDIS_URL` is not injected. Zammad starts but all real-time features and background job processing fail silently at runtime. Set to the Memorystore IP or Redis service hostname. |
| `database_type` | `"POSTGRES_15"` | **Critical** | Zammad 6.x requires PostgreSQL 15+. `Zammad Common` hardcodes this. Overriding to MySQL causes the schema migration job to fail — the application will not start. |
| `container_image_source` | `"custom"` | **Critical** | `Zammad_Common` sets `image_source = "custom"` to include the `entrypoint.sh` that maps Foundation Module `DB_*` variables to Zammad's expected `POSTGRESQL_*` variables. Using `"prebuilt"` without this entrypoint causes all database connections to fail. |
| `enable_cloudsql_volume` | `true` | **Critical** | Zammad connects to Cloud SQL via the Auth Proxy Unix socket. Disabling this removes the socket path and all database connections fail on pod startup. |
| `application_database_name` | `"zammad"` | **Critical** | Changing after initial deployment orphans the existing database. Zammad will connect to a new empty database, losing all ticket history, user accounts, and configuration. |
| `container_resources.memory_limit` | `"4Gi"` | **High** | Zammad's Rails stack (web, scheduler, ActionCable) requires at least 2 GiB. Below this, OOM kills occur during schema migrations or under load. Use `4Gi` for production. |
| `min_instance_count` | `1` | **High** | Reducing to `0` with HPA scale-to-zero means 60–90 second cold starts for agents receiving the first ticket. Keep at `1` minimum for production helpdesks. |
| `max_instance_count` | `3` | **Medium** | Multiple Zammad pods require Redis for ActionCable coordination. Running multiple replicas without Redis causes race conditions on ticket assignment and real-time state divergence. Ensure Redis is configured before scaling beyond 1 replica. |
| `RAILS_ENV` (in `environment_variables`) | `"production"` | **High** | Changing to `"development"` disables asset caching, enables verbose debug output, and may expose sensitive configuration. Never set development mode in a production cluster. |
| `ZAMMAD_RAILSSERVER_PORT` (in `environment_variables`) | `"3000"` | **High** | Must match `container_port`. A mismatch causes Kubernetes liveness and readiness probes to fail — the pod never passes health checks and receives no traffic. |
| `container_port` | `3000` | **High** | Must match `ZAMMAD_RAILSSERVER_PORT`. Changing without updating the env var causes all health checks to fail. |
| `nfs_mount_path` | `"/opt/zammad/storage"` | **High** | Changing this causes Zammad to write attachments to the ephemeral pod filesystem. Existing attachments stored on NFS become inaccessible. Always keep consistent with Zammad's configured storage path. |
| `enable_nfs` | `true` (recommended) | **High** | Without NFS, Zammad attachment storage is ephemeral inside the pod. All uploaded files are lost on pod restart or rolling update. NFS is required for any stateful Zammad deployment. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **High** | When `enable_resource_quota = true`, these must use binary suffixes (e.g., `"8Gi"`, `"16384Mi"`). Bare integers are treated as bytes by Kubernetes, blocking all pod scheduling. A plan-time validation enforces the format. |
| `stateful_pvc_enabled` with `workload_type = "Deployment"` | — | **High** | This combination fails at plan time. Use `stateful_pvc_enabled = true` alone — it automatically resolves to `StatefulSet`. |
| `workload_type` | `null` (auto) | **Medium** | Zammad with NFS storage should use `StatefulSet` for stable pod identities. Using `Deployment` with shared NFS may cause write conflicts if multiple pods access the same attachment directories concurrently. |
| `startup_probe_config.initial_delay_seconds` | `60` | **High** | Zammad performs schema migrations on first startup. For large databases, `60s` may be insufficient. Increase to `120–180s` to prevent premature pod restarts that loop endlessly on migration. |
| `enable_topology_spread` | `false` | **Medium** | Without topology spread, all Zammad pods may schedule on a single availability zone. A zone failure takes down the entire helpdesk. Enable for production multi-replica deployments. |
| `enable_pod_disruption_budget` | `false` | **Medium** | Without a PDB, GKE cluster maintenance can evict all Zammad pods simultaneously. Enable when `max_instance_count > 1`. |
| `session_affinity` | `"None"` | **Medium** | With multiple replicas and Redis, session state is handled via Redis (stateless). Without Redis, `"ClientIP"` affinity prevents random session losses when requests route to different pods. |
| `enable_backup_import` | `false` | **High** | Setting to `true` triggers a database import on every `tofu apply`. Subsequent applies will overwrite live helpdesk data if `backup_uri` is not properly managed. Only enable for the initial restore. |
| `organization_id` | `""` | **Medium** | VPC-SC perimeter is only activated when `organization_id` is explicitly set. `enable_vpc_sc = true` without this value has no effect. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` | **High** | Each `App GKE` deployment sharing the same VPC must use a distinct CIDR. Overlapping with an existing subnet causes GKE node pool provisioning to fail at apply time. |
