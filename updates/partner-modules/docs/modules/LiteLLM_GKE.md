# LiteLLM on Google Kubernetes Engine (GKE Autopilot)

This document provides a comprehensive reference for the `modules/LiteLLM_GKE` Terraform module — deploying LiteLLM on GKE Autopilot.

---

## 1. Module Overview

`LiteLLM GKE` deploys LiteLLM — the open-source LLM proxy and AI gateway — on **GKE Autopilot** with Kubernetes-native scaling, Workload Identity IAM, Cloud SQL Auth Proxy for PostgreSQL, and the full Foundation Module (`App GKE`) infrastructure stack.

**Key differences from `LiteLLM CloudRun`:**
- Runs as a **Kubernetes Deployment** on GKE Autopilot instead of Cloud Run.
- Uses the **GCS Fuse CSI driver** for storage mounts.
- **Horizontal Pod Autoscaler (HPA)** for scaling instead of Cloud Run's built-in scaling.
- **Workload Identity** for GCP API access.
- `credit_cost` defaults to `150` (vs `50` for Cloud Run).

**GCP Services deployed:**
- GKE Autopilot cluster (via `Services GCP`)
- Kubernetes Deployments, Services, Jobs
- HPA
- Artifact Registry
- Cloud Storage
- Cloud SQL PostgreSQL 15
- Cloud SQL Auth Proxy
- Workload Identity
- Secret Manager
- Cloud Monitoring + Uptime Checks
- Redis (optional)

---

## 2. Core Service Configuration

### A. Compute (GKE)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'2000m'` | CPU per pod. |
| `memory_limit` | 4 | `'2Gi'` | Memory per pod. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. |
| `max_instance_count` | 4 | `3` | Maximum pod replicas (HPA ceiling). |
| `container_port` | 4 | `4000` | LiteLLM's native port. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar into pods. |
| `timeout_seconds` | 4 | `600` | Request timeout. |

### B. Database (Cloud SQL — PostgreSQL 15)

Same as `LiteLLM CloudRun`. See [LiteLLM CloudRun §3.B](./LiteLLM_CloudRun.md#b-database-cloud-sql--postgresql-15).

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Required. LiteLLM uses PostgreSQL for Prisma ORM. |
| `db_name` | 12 | `'litellm_db'` | PostgreSQL database name. |
| `db_user` | 12 | `'litellm_user'` | PostgreSQL application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. |
| `enable_auto_password_rotation` | 12 | `false` | Automated password rotation. |

### C. Application Settings

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Plain-text env vars. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references for LLM provider API keys. |

### D. Storage & Networking

Same variables as `LiteLLM CloudRun`. See [LiteLLM CloudRun §3.E](./LiteLLM_CloudRun.md#e-storage) and [§3.F](./LiteLLM_CloudRun.md#f-networking).

### E. Initialization

Same as `LiteLLM CloudRun`. The default `db-init` job from `LiteLLM Common` creates the PostgreSQL database and user.

---

## 3. GKE-Specific Features

### A. StatefulSet and Persistent Volumes

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | — | `false` | Enables PVC for the pod. Automatically uses StatefulSet. |
| `workload_type` | — | `'Deployment'` | `'Deployment'` or `'StatefulSet'`. |
| `quota_memory_requests` | — | — | ResourceQuota memory requests. Must use binary suffixes (`'4Gi'`). |
| `quota_memory_limits` | — | — | ResourceQuota memory limits. Must use binary suffixes. |

### B. Horizontal Pod Autoscaler

HPA scales between `min_instance_count` and `max_instance_count` based on CPU/memory utilization. LiteLLM stateless request routing scales well horizontally.

---

## 4. Advanced Security

Identical to `LiteLLM CloudRun` for Cloud Armor, Binary Authorization, and VPC Service Controls.

**Workload Identity:** The GKE Kubernetes SA is annotated with the GCP SA email. `roles/datastore.user` (if needed) and Cloud SQL client roles are bound via Workload Identity.

---

## 5. Redis Caching

Same as `LiteLLM CloudRun`. Redis response caching is optional but recommended for high-throughput deployments.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis response caching. |
| `redis_host` | 21 | `""` | Redis hostname or IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port. |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

---

## 6. Observability

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/health/readiness", initial_delay_seconds=60, failure_threshold=6 }` | Pod startup probe. |
| `liveness_probe` | 14 | `{ path="/health/liveliness", initial_delay_seconds=30, failure_threshold=3 }` | Pod liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/health/liveliness" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

---

## 7. Platform-Managed Behaviours

| Behaviour | Detail |
|---|---|
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` fixed by `LiteLLM Common`. |
| **Custom Docker image** | `image_source = "custom"` — Cloud Build creates a custom image with the LiteLLM entrypoint script. |
| **LITELLM_MASTER_KEY / LITELLM_SALT_KEY** | Auto-generated by `LiteLLM Common`, stored in Secret Manager. |
| **Default db-init job** | Injected by `LiteLLM Common` when `initialization_jobs = []`. |
| **Workload Identity** | GKE SA bound via Workload Identity for GCP API access. |
| **Cloud SQL Auth Proxy** | Injected as a sidecar container into each pod. |

---

## 8. Outputs

| Output | Description |
|---|---|
| `kubernetes_ready` | True when GKE cluster and Kubernetes resources are deployed. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Cloud SQL PostgreSQL instance name. |
| `database_name` | LiteLLM database name. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `LITELLM_MASTER_KEY` (auto-generated) | `"sk-<random>"` in Secret Manager | **Critical** | Controls all administrative operations and authenticates proxy API calls. Rotation immediately breaks all integrations holding existing virtual keys or the master key. Treat as immutable unless performing a coordinated key rotation with all consumers. |
| `LITELLM_SALT_KEY` (auto-generated) | Random secret in Secret Manager | **Critical** | Salts all virtual API keys in the database. Changing it makes every previously issued virtual key permanently invalid. All API consumers must be issued new keys. Treat as permanently immutable. |
| `STORE_MODEL_IN_DB` (via `environment_variables`) | `"True"` | **High** | Required for database-backed model and key management via the Admin UI. Setting to `"False"` disables the Admin UI model management and reverts to YAML-file-only configuration. |
| `enable_cloudsql_volume` | `true` | **Critical** | The Cloud SQL Auth Proxy sidecar is required for PostgreSQL connectivity in the GKE pod. Disabling it causes Prisma to fail connecting to the database at startup. |
| `database_type` | `"POSTGRES"` | **Critical** | LiteLLM requires PostgreSQL for virtual key management and spend tracking. Without it, the `STORE_MODEL_IN_DB` features are unavailable and key management is disabled. |
| `enable_redis` | `false` | **High** | Without Redis, rate-limit counters are per-pod and not shared across replicas. For accurate rate limiting and response caching in a multi-replica GKE deployment, Redis is essential. |
| `redis_host` | `""` | **High** | Must be set when `enable_redis = true`. An empty `redis_host` with Redis enabled causes LiteLLM to log cache connection errors on every request. |
| `quota_memory_requests` / `quota_memory_limits` | Binary unit defaults | **Critical** | Must include binary unit suffixes (`Gi`, `Mi`). Bare integer values are treated as bytes by Kubernetes and block all pod scheduling. |
| `stateful_pvc_enabled` | `false` | **Medium** | GCS Fuse is the default persistence backend for any config files. Enabling PVC storage for LiteLLM config prevents pod migration across nodes and complicates rolling updates. |
| `workload_type` | `null` (auto-select) | **Medium** | Setting `stateful_pvc_enabled = true` alongside `workload_type = "Deployment"` fails at plan time. Let auto-selection handle this. |
| `min_instance_count` | `1` | **High** | LiteLLM is a shared API gateway. Cold starts (30–60 s on GKE Autopilot node provision) cause queuing in all dependent services. Keep at least 1 replica running at all times. |
| `timeout_seconds` | `600` | **High** | Large language model inference can take several minutes. Proxy requests are terminated by the load balancer if the backend pod takes longer than `timeout_seconds` to respond. |
| `service_type` (Kubernetes) | `"ClusterIP"` | **Critical** | Exposing with `LoadBalancer` makes the LiteLLM master key and all virtual keys accessible over the public internet. Always use ClusterIP with an authenticated ingress or Gateway in front. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | **Critical** | Required when `enable_iap = true`. Missing values prevent the IAP gateway from initialising and make the service unreachable. |
| `NUM_WORKERS` (via `environment_variables`) | `"1"` | **Medium** | A single worker serialises all requests. Increase to `2`–`4` for high-throughput deployments and scale `cpu_limit` proportionally. |
| `backup_schedule` | `""` (disabled) | **High** | The PostgreSQL database holds all virtual keys and spend data. Without automated backups, accidental deletion or corruption causes permanent loss of key assignments and usage history. |
| `enable_vertical_pod_autoscaling` | `false` | **Medium** | Enabling VPA disables HPA (conflict). On GKE Autopilot, VPA is the recommended approach for right-sizing pods. Choose one or the other. |
| `application_version` | `"main-stable"` | **Medium** | LiteLLM releases frequently and may change the Prisma schema or break virtual key formats. Pin to a specific release for production stability. |
