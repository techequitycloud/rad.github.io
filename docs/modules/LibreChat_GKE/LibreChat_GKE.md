---
title: "LibreChat on Google Kubernetes Engine (GKE Autopilot)"
sidebar_label: "LibreChat GKE"
---

# LibreChat on Google Kubernetes Engine (GKE Autopilot)

This document provides a comprehensive reference for the `modules/LibreChat_GKE` Terraform module. It covers architecture, configuration variables, LibreChat-specific behaviours, and operational patterns for deploying LibreChat on GKE Autopilot.

---

## 1. Module Overview

`LibreChat_GKE` deploys LibreChat — the open-source AI chat interface — on **GKE Autopilot** with Kubernetes-native scaling, Workload Identity IAM, and the full Foundation Module (`App_GKE`) infrastructure stack.

**Key differences from `LibreChat_CloudRun`:**
- Runs as a **Kubernetes Deployment** (or StatefulSet when PVC is enabled) instead of Cloud Run.
- Uses the **GCS Fuse CSI driver** for storage mounts instead of Cloud Run volume mounts.
- **Horizontal Pod Autoscaler (HPA)** replaces Cloud Run's built-in scaling.
- **Workload Identity** is used instead of Cloud Run SA direct bindings.
- Session affinity is set to `ClientIP` by default for WebSocket continuity.
- `credit_cost` defaults to `150` (vs `50` for Cloud Run) due to the GKE cluster requirements.

**GCP Services deployed:**
- GKE Autopilot cluster (via `Services_GCP`)
- Kubernetes Deployments / StatefulSets
- Kubernetes Services (LoadBalancer / ClusterIP)
- Artifact Registry
- Cloud Storage (GCS Fuse CSI Driver)
- Filestore / NFS server (optional)
- Secret Manager + Workload Identity
- Cloud IAM
- Cloud Monitoring + Uptime Checks
- Cloud Armor WAF (optional)
- Cloud Deploy (optional)
- Binary Authorization (optional)
- VPC Service Controls (optional)

**MongoDB note:** LibreChat uses **MongoDB**. No Cloud SQL instance is provisioned (`database_type = "NONE"`). `LibreChat_Common` auto-provisions Firestore with MongoDB compatibility when no `mongodb_uri` is supplied.

---

## 2. Prerequisites

1. **Services_GCP** deployed in the same GCP project (provides GKE Autopilot cluster, VPC, NFS server).
2. **MongoDB** — MongoDB Atlas, self-hosted, or Firestore auto-provisioned by the module.
3. **Redis** (recommended) — Cloud Memorystore for Redis or existing Redis instance accessible from the GKE cluster's VPC.

---

## 3. Core Service Configuration

### A. Compute (GKE)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` (GHCR) or `'custom'` (Cloud Build). |
| `container_image` | 4 | `'ghcr.io/danny-avila/librechat'` | Container image URI. |
| `container_resources` | 4 | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per pod. |
| `container_port` | 4 | `3080` | LibreChat's native HTTP port. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. |
| `max_instance_count` | 4 | `5` | Maximum pod replicas (HPA ceiling). |
| `execution_environment` | 4 | `'gen2'` | Execution environment setting (passed through to Foundation Module). |
| `timeout_seconds` | 4 | `600` | Request timeout in seconds. |

### B. MongoDB Database

Same as `LibreChat_CloudRun` — see [LibreChat_CloudRun §3.B](./LibreChat_CloudRun.md#b-mongodb-database) for the full connection modes reference.

| Variable | Group | Default | Description |
|---|---|---|---|
| `mongodb_uri` | 3 | — | MongoDB connection URI. Sensitive. Required or use Firestore auto-discovery. |
| `firestore_mongodb_host` | 1 | — | Firestore endpoint host (manual override). |
| `firestore_mongodb_database` | 12 | `'LibreChat'` | Firestore database ID / MongoDB database name. |
| `firestore_mongodb_username` | 12 | `""` | SCRAM username. |
| `firestore_mongodb_password` | 12 | `""` | SCRAM password. Auto-generated when not set. |
| `database_type` | 12 | `'NONE'` | Fixed. Must remain `'NONE'`. |

### C. LibreChat Application Settings

| Variable | Group | Default | Description |
|---|---|---|---|
| `app_title` | 3 | `'LibreChat'` | Title shown in the LibreChat UI. |
| `allow_registration` | 3 | `true` | Allow self-registration. Set `false` after creating admin account. |
| `allow_social_login` | 3 | `false` | Enable OAuth social login providers. |

### D. Storage (GCS & NFS)

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip additional bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned uploads bucket. |
| `enable_nfs` | 11 | `false` | Provisions a Filestore NFS instance and mounts it into the pod. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Pod mount path for the NFS volume. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |

### E. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — cluster VPC only. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |
| `region` | 1 | `'us-central1'` | GCP region. Auto-discovered from cluster info. |

---

## 4. GKE-Specific Features

### A. StatefulSet and Persistent Volumes

Unlike `LibreChat_CloudRun`, the GKE variant supports persistent PVCs:

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | — | `false` | Enables a PersistentVolumeClaim for the pod. Automatically uses StatefulSet. |
| `workload_type` | — | `'Deployment'` | Set to `'StatefulSet'` for stateful workloads. Auto-selected when `stateful_pvc_enabled = true`. |
| `quota_memory_requests` | — | — | ResourceQuota memory requests. Must use binary suffixes (`'4Gi'`, `'8192Mi'`). |
| `quota_memory_limits` | — | — | ResourceQuota memory limits. Must use binary suffixes. |

> **Important:** `quota_memory_requests` and `quota_memory_limits` must use binary unit suffixes (`Gi`, `Mi`). Bare integers are treated as bytes by Kubernetes and will block all pod scheduling.

### B. Horizontal Pod Autoscaler

HPA is configured via `min_instance_count` and `max_instance_count`. The Foundation Module (`App_GKE`) manages the HPA resource. LibreChat scales well horizontally when Redis is enabled for session management.

---

## 5. Advanced Security

Identical to `LibreChat_CloudRun` for Cloud Armor, IAP, Binary Authorization, and VPC Service Controls. See [LibreChat_CloudRun §4](./LibreChat_CloudRun.md#4-advanced-security).

**Workload Identity:** The GKE variant uses Workload Identity instead of direct service account bindings. The Kubernetes service account is annotated with the GCP SA email, and the GCP SA is granted `iam.workloadIdentityUser` on the Kubernetes SA.

---

## 6. Redis Integration

Same as `LibreChat_CloudRun`. Redis is **strongly recommended** for GKE deployments because pod restarts and rescheduling are more frequent than Cloud Run revisions, making session persistence more critical.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis for session management. Strongly recommended for GKE. |
| `redis_host` | 21 | `""` | Redis hostname or IP (Cloud Memorystore recommended). |
| `redis_port` | 21 | `6379` | Redis TCP port. |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

---

## 7. CI/CD & Delivery

Same variables as `LibreChat_CloudRun`. See [LibreChat_CloudRun §6](./LibreChat_CloudRun.md#6-cicd--delivery).

---

## 8. Observability

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, path="/", initial_delay_seconds=30, failure_threshold=10 }` | Pod startup probe. |
| `liveness_probe` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60, failure_threshold=3 }` | Pod liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Detail |
|---|---|
| **MongoDB only** | `database_type = "NONE"` — no Cloud SQL is provisioned. |
| **Firestore auto-provisioning** | ENTERPRISE Firestore DB created when no `mongodb_uri` or `firestore_mongodb_host` is set. Never deleted on destroy. |
| **SCRAM user init job** | Auto-injected initialization job creates/updates MongoDB SCRAM user in Firestore. |
| **JWT/credential secrets** | `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET` auto-generated by `LibreChat_Common`. |
| **Session affinity** | `ClientIP` session affinity set by default in the Kubernetes Service for WebSocket continuity. |
| **GCS Fuse CSI** | File uploads use GCS Fuse CSI driver mounted at `/uploads`. |
| **Workload Identity** | GKE SA annotated and bound via Workload Identity instead of direct SA binding. |

---

## 10. Outputs

| Output | Description |
|---|---|
| `kubernetes_ready` | True when the GKE cluster is available and all Kubernetes resources are deployed. |
| `deployment_id` | Deployment ID suffix used in resource names. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `CREDS_KEY` (auto-generated) | Random 32-byte hex key in Secret Manager | **Critical** | Encrypts all saved AI provider credentials for every user. Changing it after first use destroys all stored credentials — every user must re-enter their API keys. Treat as immutable after the first user saves credentials. |
| `CREDS_IV` (auto-generated) | Random 16-byte hex IV in Secret Manager | **Critical** | AES-GCM IV paired with `CREDS_KEY`. Same consequences as rotating `CREDS_KEY` — all stored credentials become undecryptable. |
| `JWT_SECRET` (auto-generated) | Random secret in Secret Manager | **High** | Signs all access and refresh tokens. Rotation logs out all users immediately. Plan rotation during a maintenance window. |
| `mongodb_uri` | Auto-discovered Firestore MongoDB endpoint | **Critical** | LibreChat requires MongoDB or Firestore MongoDB compatibility. If auto-discovery fails and no manual URI is provided, the pod crashes on startup and serves no traffic. |
| `firestore_mongodb_host` | Auto-discovered | **High** | Manual host override. A stale or incorrect value breaks all data operations and renders the service non-functional. |
| `enable_cloudsql_volume` | `false` | **Critical** | Must remain `false`. LibreChat does not use Cloud SQL. Enabling injects an unnecessary Cloud SQL Auth Proxy sidecar and can conflict with MongoDB-only connection routing. |
| `enable_custom_sql_scripts` | `false` | **Critical** | Must remain `false`. LibreChat does not use Cloud SQL. Enabling this causes the init job to attempt SQL script execution against a non-existent Cloud SQL instance. |
| `allow_registration` | `true` | **High** | Combined with a LoadBalancer-exposed service, open registration allows anyone on the network to create an account. Disable after the admin account is created or restrict with IAP. |
| `USE_REDIS` / `enable_redis` | `false` | **High** | Without Redis, multiple pod replicas each have isolated in-memory session state. Users experience session drops when requests land on different pods. Set `enable_redis = true` and provide `redis_host` for all multi-replica deployments. |
| `redis_host` | `""` | **High** | Required when `enable_redis = true`. If not set and Redis is enabled, LibreChat fails to connect to Redis on startup and session caching is broken. |
| `MEILI_MASTER_KEY` (auto-generated) | Random secret in Secret Manager | **High** | If changed after the search index is built, all indices are invalidated. A full re-index of all messages is required after any key rotation. |
| `stateful_pvc_enabled` | `false` | **High** | Without a PVC or NFS for file uploads, attachments shared in chat are stored on the container's ephemeral filesystem and are lost when the pod is evicted. Enable PVC or NFS for production. |
| `quota_memory_requests` / `quota_memory_limits` | Binary unit defaults | **Critical** | Must use binary suffixes (`Gi`, `Mi`). Bare integers are treated as bytes by Kubernetes, blocking all pod scheduling in the namespace. |
| `secret_environment_variables` (AI provider keys) | `{}` | **Critical** | Provider API keys must reference Secret Manager secrets. Injecting them as plain `environment_variables` exposes them in pod specs visible in `kubectl describe pod`. |
| `min_instance_count` | `1` | **High** | Scale-to-zero drops all in-flight SSE streaming connections. Keep at least 1 replica for a reliable chat experience. |
| `timeout_seconds` | `600` | **High** | Long AI responses via SSE streaming can exceed several minutes. Insufficient timeout truncates responses mid-stream. |
| `enable_nfs` | `false` | **Medium** | NFS is needed for shared file storage across multiple pod replicas. Without it, uploaded files are pod-local and invisible to other replicas. |
| `workload_type` | `null` (auto-select) | **Medium** | Setting `stateful_pvc_enabled = true` auto-selects `StatefulSet`. Manually setting `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time. |
| `backup_schedule` | `""` (disabled) | **High** | Without NFS backup schedules, conversation and user data backed only by Firestore/MongoDB have no GCS-level snapshots. Enable for production. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | **Critical** | Required when `enable_iap = true`. If not provided, the IAP gateway fails to initialise and the service becomes unreachable. |
| `application_version` | `"latest"` | **Medium** | Unplanned LibreChat upgrades can change MongoDB schema. Pin to a specific release in production. |

## Destroying Resources

GKE Autopilot node pools and Kubernetes resources may take 5–10 minutes to fully terminate. The GKE cluster itself is managed by `Services_GCP` and must be destroyed separately.
