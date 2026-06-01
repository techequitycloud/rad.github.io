---
title: "Chroma on Google Kubernetes Engine"
sidebar_label: "Chroma GKE"
---

# Chroma on Google Kubernetes Engine

This document provides a comprehensive reference for the `modules/Chroma_GKE` Terraform module. It covers architecture, IAM, configuration variables, Chroma-specific behaviours, and operational patterns for deploying Chroma on GKE Autopilot.

---

## 1. Module Overview

`Chroma_GKE` is a **wrapper module** built on top of `App_GKE`. It deploys Chroma — the AI-native open-source vector database — on GKE Autopilot with production-grade StatefulSet persistence, GCS FUSE storage, optional token authentication, Workload Identity, and horizontal auto-scaling.

**Key Capabilities:**
- **Compute**: GKE Autopilot, 1 vCPU / 1 Gi by default. StatefulSet or Deployment workload type.
- **Data Persistence**: StatefulSet PVC (recommended for production) or GCS FUSE-mounted Cloud Storage bucket. No Cloud SQL, no Redis.
- **Security**: Optional auth token via Secret Manager injected as `CHROMA_SERVER_AUTH_CREDENTIALS`. Inherits Cloud Armor, IAP, and VPC-SC from `App_GKE`.
- **CI/CD**: Cloud Build image pipeline by default; Cloud Deploy progressive delivery optional.
- **Reliability**: Health probes target `/api/v2/heartbeat`. PodDisruptionBudget enabled by default.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `region` | 1 | `string` | `'us-central1'` | GCP region fallback |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to resource names |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all resources |
| `application_name` | 3 | `string` | `'chroma'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'Chroma Vector Database'` | Human-readable name in the GCP Console |
| `description` | 3 | `string` | Chroma description | Workload description |
| `application_version` | 3 | `string` | `'latest'` | Chroma image tag |

---

## 2. IAM & Access Control

`Chroma_GKE` delegates all IAM provisioning to `App_GKE`. Workload Identity is used — the Kubernetes service account is bound to a GCP service account with the minimum required roles (GCS read/write for the data bucket, Secret Manager accessor for the auth token).

**Auth token:** When `enable_auth_token = true`, `Chroma_Common` generates a token and stores it in Secret Manager as `<prefix>-auth-token`. The token is injected as `CHROMA_SERVER_AUTH_CREDENTIALS`.

---

## 3. Core Service Configuration

### A. Compute (GKE)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment |
| `cpu_limit` | 4 | `'1000m'` | CPU limit per pod |
| `memory_limit` | 4 | `'1Gi'` | Memory limit per pod. Increase for large collections. |
| `container_resources` | 4 | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Structured resource spec. Provides `cpu_request`, `mem_request`, `ephemeral_storage_*` fields. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas |
| `max_instance_count` | 4 | `1` | Maximum pod replicas. Keep at 1 for single-writer safety. |
| `timeout_seconds` | 4 | `300` | Request timeout (0–3600 s) |
| `enable_image_mirroring` | 4 | `true` | Mirror Chroma image to Artifact Registry |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enable VPA (disables CPU/memory HPA when true) |

### B. Kubernetes Workload

| Variable | Group | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | 6 | `""` | Target GKE cluster. Auto-discovered when empty. |
| `gke_cluster_selection_mode` | 6 | `'primary'` | `'explicit'`, `'round-robin'`, or `'primary'` |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Auto-generated when empty. |
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. Auto-resolves to StatefulSet when `stateful_pvc_enabled = true`. |
| `service_type` | 6 | `'ClusterIP'` | `'ClusterIP'` (recommended for vector databases), `'LoadBalancer'`, or `'NodePort'` |
| `session_affinity` | 6 | `'None'` | `'None'` or `'ClientIP'` |
| `termination_grace_period_seconds` | 6 | `60` | Grace period for Chroma to flush writes |
| `enable_network_segmentation` | 6 | `false` | Enable Kubernetes NetworkPolicies |
| `configure_service_mesh` | 6 | `false` | Enable Istio service mesh injection |
| `deployment_timeout` | 6 | `1800` | Seconds Terraform waits for rollout |

### C. StatefulSet Persistence

For production deployments, `stateful_pvc_enabled = true` is recommended over GCS FUSE. PVC-backed storage avoids GCS FUSE I/O overhead for large collections and eliminates GCS API latency for index reads.

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 7 | `null` | Enable PVC. Recommended for production. Auto-selects StatefulSet. |
| `stateful_pvc_size` | 7 | `'20Gi'` | Per-pod PVC size. Size to hold all collections plus index overhead. |
| `stateful_pvc_mount_path` | 7 | `'/data'` | Container path for the PVC |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | `'standard-rwo'` (Balanced PD) or `'premium-rwo'` (higher IOPS) |
| `stateful_headless_service` | 7 | `null` | Create a headless service for stable network identities |
| `stateful_pod_management_policy` | 7 | `null` | `'OrderedReady'` ensures safe sequential restarts |
| `stateful_update_strategy` | 7 | `null` | `'RollingUpdate'` for zero-downtime updates |
| `stateful_fs_group` | 7 | `1000` | GID for PVC write access. Set to `0` to leave unset. |

**PVC vs GCS FUSE double-mount prevention:** When `stateful_pvc_enabled = true`, the wrapper passes `enable_gcs_storage_volume = false` to `Chroma_Common`, which prevents the `<prefix>-data` GCS bucket from being mounted at `/data` alongside the PVC.

### D. Storage (GCS FUSE)

When `stateful_pvc_enabled` is not set, Chroma data is persisted via GCS FUSE:

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 14 | `true` | Provision GCS buckets |
| `storage_buckets` | 14 | `[]` | Additional GCS buckets |
| `gcs_volumes` | 14 | `[]` | Additional GCS FUSE volumes |
| `manage_storage_kms_iam` | 14 | `false` | CMEK for storage |
| `enable_artifact_registry_cmek` | 14 | `false` | CMEK for Artifact Registry |

---

## 4. Authentication & Access Control

### A. Chroma Auth Token

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auth_token` | 3 | `false` | Generate auth token in Secret Manager. Injected as `CHROMA_SERVER_AUTH_CREDENTIALS`. |

### B. Identity-Aware Proxy (IAP)

IAP via the Kubernetes Gateway API. Requires `enable_custom_domain` or `enable_cdn`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Enable IAP via Kubernetes Gateway |
| `iap_authorized_users` | 20 | `[]` | IAP-authorized users |
| `iap_authorized_groups` | 20 | `[]` | IAP-authorized groups |
| `iap_oauth_client_id` | 20 | `""` | OAuth client ID. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth client secret. Sensitive. |

### C. Cloud Armor

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 21 | `false` | Attach Cloud Armor to GKE Ingress |
| `admin_ip_ranges` | 21 | `[]` | CIDR ranges exempted from WAF rules |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Cloud Armor policy name |
| `enable_cdn` | 21 | `false` | Enable Cloud CDN via GCPBackendPolicy |

---

## 5. Observability & Health

### A. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 10 | `{ path="/api/v2/heartbeat", initial_delay=15, period=10, threshold=10 }` | Startup probe |
| `liveness_probe` | 10 | `{ path="/api/v2/heartbeat", initial_delay=30, period=30, threshold=3 }` | Liveness probe |
| `startup_probe_config` | 10 | `{ path="/api/v2/heartbeat" }` | Alternative startup probe |
| `health_check_config` | 10 | `{ path="/api/v2/heartbeat" }` | Alternative liveness probe |
| `uptime_check_config` | 10 | `{ enabled=true, path="/api/v2/heartbeat" }` | Cloud Monitoring uptime check |
| `alert_policies` | 10 | `[]` | Metric alert policies |

### B. Pod Disruption Budget & Resource Quotas

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | 9 | `true` | Create a PodDisruptionBudget |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during disruptions |
| `enable_resource_quota` | 8 | `false` | Create a Kubernetes ResourceQuota |
| `quota_memory_requests` | 8 | `""` | Memory requests quota (must use binary suffix, e.g., `'4Gi'`) |
| `quota_memory_limits` | 8 | `""` | Memory limits quota (must use binary suffix) |

---

## 6. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| No SQL database | `database_type = "NONE"` fixed by `Chroma_Common` | No Cloud SQL resources created |
| No Redis | Not used | Chroma has no caching dependency |
| Fixed env vars | Always injected by `Chroma_Common` | `ANONYMIZED_TELEMETRY=false`, `CHROMA_SERVER_HTTP_PORT=8000` |
| Health probe path | Hard-coded to `/api/v2/heartbeat` | Chroma provides no configurable health path |
| StatefulSet auto-select | `stateful_pvc_enabled = true` | Automatically resolves `workload_type` to `"StatefulSet"` |
| PVC prevents GCS double-mount | `enable_gcs_storage_volume = false` passed to `Chroma_Common` | Prevents simultaneous PVC and GCS FUSE at `/data` |

---

## 7. Variable Reference

| Variable | Group | Default | Description |
|---|---|---|---|
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | Region fallback |
| `tenant_deployment_id` | 2 | `'demo'` | Resource name suffix |
| `support_users` | 2 | `[]` | Monitoring alert recipients |
| `resource_labels` | 2 | `{}` | Resource labels |
| `application_name` | 3 | `'chroma'` | Base resource name |
| `application_display_name` | 3 | `'Chroma Vector Database'` | Display name |
| `description` | 3 | Chroma description | Workload description |
| `application_version` | 3 | `'latest'` | Image tag |
| `enable_auth_token` | 3 | `false` | Generate auth token |
| `deploy_application` | 4 | `true` | Deploy workload |
| `cpu_limit` | 4 | `'1000m'` | CPU limit |
| `memory_limit` | 4 | `'1Gi'` | Memory limit |
| `min_instance_count` | 4 | `1` | Minimum replicas |
| `max_instance_count` | 4 | `1` | Maximum replicas |
| `timeout_seconds` | 4 | `300` | Request timeout |
| `enable_image_mirroring` | 4 | `true` | Mirror to Artifact Registry |
| `environment_variables` | 5 | `{}` | Plain-text env vars |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references |
| `secret_propagation_delay` | 5 | `30` | Post-creation wait |
| `secret_rotation_period` | 5 | `'2592000s'` | Rotation period |
| `gke_cluster_name` | 6 | `""` | GKE cluster name |
| `namespace_name` | 6 | `""` | Kubernetes namespace |
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'` |
| `service_type` | 6 | `'ClusterIP'` | Kubernetes Service type |
| `termination_grace_period_seconds` | 6 | `60` | Grace period |
| `stateful_pvc_enabled` | 7 | `null` | Enable StatefulSet PVC |
| `stateful_pvc_size` | 7 | `'20Gi'` | PVC size |
| `stateful_pvc_mount_path` | 7 | `'/data'` | PVC mount path |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | StorageClass |
| `stateful_pod_management_policy` | 7 | `null` | Pod management policy |
| `stateful_update_strategy` | 7 | `null` | Update strategy |
| `stateful_fs_group` | 7 | `1000` | fsGroup GID |
| `enable_resource_quota` | 8 | `false` | ResourceQuota |
| `enable_pod_disruption_budget` | 9 | `true` | PodDisruptionBudget |
| `pdb_min_available` | 9 | `'1'` | Min pods during disruptions |
| `startup_probe` | 10 | `{ path="/api/v2/heartbeat" }` | Startup probe |
| `liveness_probe` | 10 | `{ path="/api/v2/heartbeat" }` | Liveness probe |
| `uptime_check_config` | 10 | `{ enabled=true }` | Uptime check |
| `initialization_jobs` | 11 | `[]` | Init jobs |
| `cron_jobs` | 11 | `[]` | Scheduled jobs |
| `enable_cicd_trigger` | 12 | `false` | Cloud Build trigger |
| `github_repository_url` | 12 | `""` | GitHub URL |
| `enable_cloud_deploy` | 12 | `false` | Cloud Deploy pipeline |
| `enable_nfs` | 13 | `false` | Cloud Filestore NFS |
| `create_cloud_storage` | 14 | `true` | GCS buckets |
| `storage_buckets` | 14 | `[]` | Additional buckets |
| `gcs_volumes` | 14 | `[]` | GCS FUSE volumes |
| `backup_schedule` | 17 | `'0 2 * * *'` | Backup cron |
| `backup_retention_days` | 17 | `7` | Backup retention |
| `enable_backup_import` | 17 | `false` | One-time restore |
| `enable_custom_domain` | 19 | `false` | Custom domain |
| `application_domains` | 19 | `[]` | Domain names |
| `reserve_static_ip` | 19 | `false` | Reserve static IP |
| `enable_iap` | 20 | `false` | IAP via Gateway |
| `enable_cloud_armor` | 21 | `false` | Cloud Armor |
| `enable_vpc_sc` | 22 | `false` | VPC Service Controls |
| `organization_id` | 22 | `""` | Org ID for VPC-SC |
| `enable_audit_logging` | 22 | `false` | Cloud Audit Logs |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `enable_auth_token` | `false` | **Critical** | Without an auth token, any caller who can reach the Chroma service endpoint can read, write, or delete any collection. Set to `true` for any internet-facing or shared cluster deployment. The generated token is stored in Secret Manager and must be passed as `Authorization: Bearer <token>`. |
| `stateful_pvc_enabled` | `null` | **High** | Without a PVC, Chroma stores collection data in the ephemeral container filesystem. A pod restart or rolling update erases all collections and their vectors. Set `stateful_pvc_enabled = true` for any persistent production deployment. |
| `stateful_pvc_size` | `"20Gi"` | **High** | Undersized PVCs fill up as vector collections grow. A full PVC causes Chroma to crash with disk-full errors, making all collections unavailable. HNSW indexes for 1M vectors at 1536 dimensions require approximately 6 Gi. Size generously — PVC capacity cannot be reduced after provisioning. |
| `workload_type` | `null` | **High** | Defaults to `Deployment` (stateless). Setting `stateful_pvc_enabled = true` without an explicit `workload_type` automatically resolves to `StatefulSet`. Explicitly setting `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | **Medium** | Balanced PD (`standard-rwo`) provides adequate IOPS for most workloads. Large-scale ANN searches (HNSW with `ef_search` > 100) benefit from `premium-rwo` (SSD). Changing storage class after PVC creation requires manual data migration. |
| `memory_limit` | `"1Gi"` | **High** | Chroma loads full HNSW indexes into memory. The default `1Gi` supports only very small collections. For production workloads, provision at least `4Gi`; large embeddings (> 1M vectors) may require `16Gi` or more. OOM kills terminate the pod, dropping all in-flight queries. |
| `cpu_limit` | `"1000m"` | **Medium** | HNSW index builds and similarity searches are CPU-bound. Under high query concurrency, CPU throttling degrades p99 latency significantly. Increase to `2000m`–`4000m` for production. |
| `min_instance_count` | `1` | **Medium** | Scale-to-zero (`0`) on GKE causes the pod to be deleted. After scaling back up, Chroma must reload the HNSW index from the PVC (or GCS), which can take tens of seconds for large collections. Keep at `1` for latency-sensitive workloads. |
| `max_instance_count` | `1` | **High** | Multiple Chroma replicas sharing a single PVC are not supported. Chroma does not have a distributed lock on its storage. Using `max_instance_count > 1` with a single PVC causes concurrent write corruption. For horizontal scaling, use a Chroma cluster deployment with separate PVCs per pod (one collection set per replica). |
| `enable_gcs_storage_volume` (Common) | `true` | **High** | If GCS Fuse is the storage backend (no PVC) and it is disabled, all data is stored in the ephemeral container layer and lost on restart. Do not disable unless PVC persistence is configured. |
| `quota_memory_requests` | `""` | **Critical** | If `enable_resource_quota = true` and this value is set without binary suffixes (e.g. `"4"` instead of `"4Gi"`), Kubernetes treats it as bytes, blocking all pod scheduling in the namespace. Always use `Gi` or `Mi`. Note: in Chroma_GKE this variable is accepted but not forwarded; verify in App_GKE if enabled. |
| `stateful_pvc_mount_path` | `"/data"` | **Critical** | Chroma defaults to `/data` for its storage directory. If the mount path does not match the `CHROMA_SERVER_PERSIST_DIRECTORY` environment variable, Chroma will use the ephemeral in-container path, silently losing data on restart. |
| `application_version` | `"latest"` | **Medium** | Using `"latest"` makes deployments non-reproducible. Chroma's data format has changed between major versions; upgrading across incompatible versions can make existing collections unreadable. Pin to a specific version tag in production. |
| `enable_nfs` | `false` | **Low** | NFS is not recommended for primary Chroma storage on GKE — prefer PVCs for better IOPS and exclusive access semantics. NFS is useful for shared read-only data. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | Regular backups of the PVC (via Kubernetes VolumeSnapshot or GCS export) are essential. The default daily schedule may not meet aggressive RPO targets. |
| `enable_iap` | `false` | **High** | Without IAP, the GKE LoadBalancer endpoint is accessible to any caller (depending on firewall rules). Enable IAP with `iap_authorized_users`/`iap_authorized_groups` for user-facing deployments. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | **High** | Setting `enable_iap = true` without valid OAuth credentials causes the IAP configuration to fail silently or block all traffic. Obtain these from the GCP Console OAuth consent screen before enabling IAP. |
