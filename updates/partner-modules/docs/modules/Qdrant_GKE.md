# Qdrant on Google Kubernetes Engine

This document provides a comprehensive reference for the `modules/Qdrant_GKE` Terraform module. It covers architecture, IAM, configuration variables, Qdrant-specific behaviours, and operational patterns for deploying Qdrant on GKE Autopilot.

---

## 1. Module Overview

`Qdrant GKE` is a **wrapper module** built on top of `App GKE`. It deploys Qdrant — the high-performance vector database and similarity search engine — on GKE Autopilot with production-grade StatefulSet persistence, GCS FUSE storage, optional API key authentication, Workload Identity, and horizontal auto-scaling.

**Key Capabilities:**
- **Compute**: GKE Autopilot, 1 vCPU / 1 Gi by default. StatefulSet or Deployment workload type.
- **Data Persistence**: StatefulSet PVC (recommended for production) or GCS FUSE-mounted Cloud Storage bucket at `/qdrant/storage`. No Cloud SQL, no Redis.
- **Security**: Optional API key via Secret Manager injected as `QDRANT__SERVICE__API_KEY`. Inherits Cloud Armor, IAP, and VPC-SC from `App GKE`.
- **CI/CD**: Cloud Build image pipeline by default; Cloud Deploy progressive delivery optional.
- **Reliability**: Startup probe targets `/readyz`; liveness probe targets `/livez`. PodDisruptionBudget enabled by default.
- **gRPC**: Disabled by default. Enable via `environment_variables = { QDRANT__SERVICE__GRPC_PORT = "6334" }` and configure a second Service port manually.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `region` | 1 | `string` | `'us-central1'` | GCP region fallback |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to resource names |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all resources |
| `application_name` | 3 | `string` | `'qdrant'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'Qdrant Vector Database'` | Human-readable name |
| `description` | 3 | `string` | Qdrant description | Workload description |
| `application_version` | 3 | `string` | `'latest'` | Qdrant image tag |

---

## 2. IAM & Access Control

`Qdrant GKE` delegates all IAM provisioning to `App GKE`. Workload Identity is used — the Kubernetes service account is bound to a GCP service account with the minimum required roles (GCS read/write for the storage bucket, Secret Manager accessor for the API key).

**API key:** When `enable_api_key = true`, `Qdrant Common` generates a 32-character API key and stores it in Secret Manager as `<prefix>-api-key`. It is injected as `QDRANT__SERVICE__API_KEY`. All REST and gRPC calls must include `api-key: <key>` in the request header/metadata.

---

## 3. Core Service Configuration

### A. Compute (GKE)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment |
| `cpu_limit` | 4 | `'1000m'` | CPU limit per pod |
| `memory_limit` | 4 | `'1Gi'` | Memory limit per pod. Qdrant loads HNSW indexes into memory — size accordingly. |
| `container_resources` | 4 | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Structured resource spec. Provides `cpu_request`, `mem_request`, `ephemeral_storage_*` fields. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas |
| `max_instance_count` | 4 | `1` | Maximum pod replicas. Keep at 1 for single-writer safety. |
| `timeout_seconds` | 4 | `300` | Request timeout (0–3600 s) |
| `enable_image_mirroring` | 4 | `true` | Mirror Qdrant image to Artifact Registry |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enable VPA |

### B. Kubernetes Workload

| Variable | Group | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | 6 | `""` | Target GKE cluster. Auto-discovered when empty. |
| `gke_cluster_selection_mode` | 6 | `'primary'` | `'explicit'`, `'round-robin'`, or `'primary'` |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Auto-generated when empty. |
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. Auto-resolves to StatefulSet when `stateful_pvc_enabled = true`. |
| `service_type` | 6 | `'ClusterIP'` | `'ClusterIP'` (recommended), `'LoadBalancer'`, or `'NodePort'` |
| `session_affinity` | 6 | `'None'` | `'None'` or `'ClientIP'` |
| `termination_grace_period_seconds` | 6 | `60` | Grace period for Qdrant to flush WAL writes (0–3600 s) |
| `enable_network_segmentation` | 6 | `false` | Enable Kubernetes NetworkPolicies |
| `configure_service_mesh` | 6 | `false` | Enable Istio service mesh injection |
| `deployment_timeout` | 6 | `1800` | Seconds Terraform waits for rollout completion |

### C. StatefulSet Persistence

For production deployments, `stateful_pvc_enabled = true` is strongly recommended over GCS FUSE. Qdrant's WAL and HNSW index files are I/O-intensive — PVC-backed storage provides significantly lower latency than GCS FUSE for these access patterns.

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 7 | `null` | Enable PVC. Recommended for production. Auto-selects StatefulSet. |
| `stateful_pvc_size` | 7 | `'20Gi'` | Per-pod PVC size. Size to hold all collection data, HNSW indexes, and WAL. |
| `stateful_pvc_mount_path` | 7 | `'/qdrant/storage'` | Container path for the PVC. Matches `QDRANT__STORAGE__STORAGE_PATH`. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | `'standard-rwo'` (Balanced PD) or `'premium-rwo'` (higher IOPS, lower latency) |
| `stateful_headless_service` | 7 | `null` | Create a headless service for stable network identities |
| `stateful_pod_management_policy` | 7 | `null` | `'OrderedReady'` ensures safe sequential restarts |
| `stateful_update_strategy` | 7 | `null` | `'RollingUpdate'` for zero-downtime updates |
| `stateful_fs_group` | 7 | `1000` | GID for PVC write access. Set to `0` to leave unset. |

**PVC prevents GCS double-mount:** When `stateful_pvc_enabled = true`, the wrapper passes `enable_gcs_storage_volume = false` to `Qdrant Common`, preventing the `<prefix>-storage` bucket from being mounted at `/qdrant/storage` alongside the PVC.

### D. Storage (GCS FUSE)

When `stateful_pvc_enabled` is not set, Qdrant data is persisted via GCS FUSE at `/qdrant/storage`:

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 14 | `true` | Provision GCS buckets |
| `storage_buckets` | 14 | `[]` | Additional GCS buckets |
| `gcs_volumes` | 14 | `[]` | Additional GCS FUSE volumes |
| `manage_storage_kms_iam` | 14 | `false` | CMEK for storage |
| `enable_artifact_registry_cmek` | 14 | `false` | CMEK for Artifact Registry |

---

## 4. Authentication & Access Control

### A. Qdrant API Key

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_api_key` | 3 | `false` | Generate API key in Secret Manager. Injected as `QDRANT__SERVICE__API_KEY`. Recommended for all deployments with external access. |

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
| `startup_probe_config` | 10 | `{ path="/readyz", ... }` | Startup probe via `App GKE` config interface |
| `health_check_config` | 10 | `{ path="/livez", ... }` | Liveness probe via `App GKE` config interface |
| `startup_probe` | 10 | `{ path="/readyz", initial_delay=15, period=10, threshold=10 }` | Startup probe (legacy format) |
| `liveness_probe` | 10 | `{ path="/livez", initial_delay=30, period=30, threshold=3 }` | Liveness probe (legacy format) |
| `uptime_check_config` | 10 | `{ enabled=true, path="/readyz" }` | Cloud Monitoring uptime check |
| `alert_policies` | 10 | `[]` | Metric alert policies |

**Critical probe guidance:** Always use `/readyz` for the startup probe and `/livez` for the liveness probe. Qdrant temporarily marks itself as not-ready while loading collections from disk. Using `/readyz` as the liveness target causes Kubernetes to kill and restart the pod during every collection load — creating a crash loop on instances with large collections.

### B. Pod Disruption Budget & Resource Quotas

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | 9 | `true` | Create a PodDisruptionBudget |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during disruptions |
| `enable_resource_quota` | 8 | `false` | Create a Kubernetes ResourceQuota |
| `quota_memory_requests` | 8 | `""` | Memory requests quota (binary suffix required, e.g., `'4Gi'`) |
| `quota_memory_limits` | 8 | `""` | Memory limits quota (binary suffix required) |

---

## 6. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| No SQL database | `database_type = "NONE"` fixed by `Qdrant Common` | No Cloud SQL resources created |
| No Redis | Not used | Qdrant has no caching dependency |
| Storage path env var | `QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage` always injected | Aligned with GCS FUSE / PVC mount point |
| HTTP port env var | `QDRANT__SERVICE__HTTP_PORT=6333` always injected | Explicit port |
| gRPC disabled by default | `QDRANT__SERVICE__GRPC_PORT` not set | Port 6334 not exposed in default Service. Enable manually via `environment_variables`. |
| Separate liveness/readiness | Startup: `/readyz`, Liveness: `/livez` | Prevents restart loops during large collection loads |
| StatefulSet auto-select | `stateful_pvc_enabled = true` | Automatically resolves `workload_type` to `"StatefulSet"` |
| PVC prevents GCS double-mount | `enable_gcs_storage_volume = false` passed to `Qdrant Common` | Prevents simultaneous PVC and GCS FUSE at `/qdrant/storage` |

---

## 7. Variable Reference

| Variable | Group | Default | Description |
|---|---|---|---|
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | Region fallback |
| `tenant_deployment_id` | 2 | `'demo'` | Resource name suffix |
| `support_users` | 2 | `[]` | Monitoring alert recipients |
| `resource_labels` | 2 | `{}` | Resource labels |
| `application_name` | 3 | `'qdrant'` | Base resource name |
| `application_display_name` | 3 | `'Qdrant Vector Database'` | Display name |
| `description` | 3 | Qdrant description | Workload description |
| `application_version` | 3 | `'latest'` | Image tag |
| `enable_api_key` | 3 | `false` | Generate API key |
| `deploy_application` | 4 | `true` | Deploy workload |
| `cpu_limit` | 4 | `'1000m'` | CPU limit |
| `memory_limit` | 4 | `'1Gi'` | Memory limit |
| `min_instance_count` | 4 | `1` | Min replicas |
| `max_instance_count` | 4 | `1` | Max replicas |
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
| `stateful_pvc_mount_path` | 7 | `'/qdrant/storage'` | PVC mount path |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | StorageClass |
| `stateful_pod_management_policy` | 7 | `null` | Pod management |
| `stateful_update_strategy` | 7 | `null` | Update strategy |
| `stateful_fs_group` | 7 | `1000` | fsGroup GID |
| `enable_resource_quota` | 8 | `false` | ResourceQuota |
| `enable_pod_disruption_budget` | 9 | `true` | PodDisruptionBudget |
| `pdb_min_available` | 9 | `'1'` | Min available pods |
| `startup_probe` | 10 | `{ path="/readyz" }` | Startup probe |
| `liveness_probe` | 10 | `{ path="/livez" }` | Liveness probe |
| `uptime_check_config` | 10 | `{ enabled=true }` | Uptime check |
| `initialization_jobs` | 11 | `[]` | Init jobs |
| `cron_jobs` | 11 | `[]` | Scheduled jobs |
| `enable_cicd_trigger` | 12 | `false` | Cloud Build trigger |
| `enable_cloud_deploy` | 12 | `false` | Cloud Deploy pipeline |
| `enable_binary_authorization` | 12 | `false` | Binary Authorization |
| `enable_nfs` | 13 | `false` | NFS mount |
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
| `organization_id` | 22 | `""` | GCP Org ID for VPC-SC |
| `enable_audit_logging` | 22 | `false` | Cloud Audit Logs |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `enable_api_key` (Common) | `false` | **Critical** | Without an API key, any caller who can reach the Qdrant service can read, modify, or delete all collections. Set to `true` for any deployment reachable outside the pod namespace. The key is stored in Secret Manager. |
| `stateful_pvc_enabled` | `null` | **High** | Without a PVC, Qdrant stores collection data in the ephemeral pod filesystem. Any pod restart, rolling update, or node eviction erases all collections permanently. Set `stateful_pvc_enabled = true` for any production deployment. |
| `stateful_pvc_size` | `"20Gi"` | **High** | An undersized PVC fills up as collections grow (HNSW index + payload storage). A full disk causes Qdrant to crash and makes collections unrecoverable without manual PVC expansion. Provision generously — PVC capacity cannot be decreased after creation. For 1M vectors at 1536 dims, allow at least 10 Gi per collection. |
| `workload_type` | `null` | **High** | `null` resolves to `Deployment`. With `stateful_pvc_enabled = true`, the module auto-selects `StatefulSet`. Explicitly combining `workload_type = "Deployment"` with `stateful_pvc_enabled = true` fails at plan time. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | **Medium** | Balanced PD is adequate for most query loads. High-throughput real-time index builds benefit from `premium-rwo`. Storage class cannot be changed after PVC creation without data migration. |
| `stateful_pvc_mount_path` | `"/qdrant/storage"` | **Critical** | Must match Qdrant's `storage.storage_path` configuration. If the PVC is mounted to a different path than Qdrant reads, all data is stored in the ephemeral container layer and lost on restart. Do not change without a matching `QDRANT__STORAGE__STORAGE_PATH` environment variable override. |
| `collection vector dimensions` | *(immutable — set at collection creation via client)* | **Critical** | Qdrant collection vector dimensions are immutable after creation. A mismatch with the embedding model dimension causes all upsert operations to fail. There is no migration path — the collection must be deleted and recreated, losing all vectors. |
| `memory_limit` | `"1Gi"` | **High** | Qdrant loads HNSW graphs into memory. The default `1Gi` supports only small test collections. Production workloads need `4Gi`–`16Gi` or more. OOM kills drop all in-flight queries and trigger a full index reload from disk. |
| `cpu_limit` | `"1000m"` | **Medium** | HNSW index builds and high-concurrency searches are CPU-bound. Throttling below `1000m` degrades p99 latency and slows index construction. Scale to `2000m`–`4000m` for production. |
| `min_instance_count` | `1` | **Medium** | Scale-to-zero on GKE (`0`) deletes the pod. After restart, Qdrant reloads indexes from PVC, which takes tens of seconds for large collections. For latency-sensitive applications, keep at `1`. |
| `max_instance_count` | `1` | **High** | Multiple Qdrant replicas sharing a single PVC (RWO) are not supported. RWO PVCs can only be mounted by one pod at a time; scaling beyond 1 prevents additional pods from scheduling. For horizontal scaling, deploy separate Qdrant instances with collection sharding at the application level. |
| `liveness_probe` (Common) | `/livez` | **High** | Qdrant's `/readyz` returns 503 while loading large collections. Using `/readyz` as the liveness target causes spurious restarts during collection load, which in turn triggers more reloads — a restart loop. Always use `/livez` for liveness checks. |
| `quota_memory_requests` | `""` | **Critical** | If `enable_resource_quota = true` with a bare integer (e.g. `"4"` instead of `"4Gi"`), Kubernetes treats it as bytes, blocking all pod scheduling. Always use binary suffixes. Note: Qdrant GKE accepts but does not forward this variable — check `App GKE`. |
| `application_version` | `"latest"` | **Medium** | Qdrant's storage format changes between major versions. An unexpected image change via `latest` during rebuild can make existing collections unreadable. Pin to a specific semver tag for production. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | Qdrant collections should be snapshotted regularly via the Qdrant API or GCS Fuse volume backup. Ensure the backup job is active and tested before relying on it for production recovery. |
| `enable_iap` | `false` | **High** | Without IAP, the GKE Ingress endpoint is accessible to any caller. Enable IAP and `enable_api_key = true` together for defense-in-depth on production deployments. |

