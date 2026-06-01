---
title: "MongoDB on Google Kubernetes Engine (GKE Autopilot)"
sidebar_label: "MongoDB GKE"
---

# MongoDB on Google Kubernetes Engine (GKE Autopilot)

This document provides a comprehensive reference for the `modules/MongoDB_GKE` Terraform module. It covers architecture, IAM, configuration variables, MongoDB-specific behaviours, and operational patterns for deploying MongoDB on GKE Autopilot.

---

## 1. Module Overview

MongoDB is the world's most popular NoSQL database with 35,000+ GitHub stars, used by 35,000+ organisations including Adobe, eBay, and Bosch. It powers flexible document storage for content management, IoT data, mobile backends, and AI/ML feature stores where relational schemas are too rigid. `MongoDB_GKE` is a **self-contained wrapper module** built on top of `App_GKE`. Unlike most other modules in this repository, it does not have a corresponding `Common` module — all MongoDB-specific configuration is assembled directly in `mongodb.tf`.

**Key Capabilities:**
*   **Compute**: GKE Autopilot, **StatefulSet** (auto-selected when `stateful_pvc_enabled = true`). 1 vCPU / 2 Gi by default. Default: `min_instance_count = 1`, `max_instance_count = 1` (single-node mode).
*   **Persistence**: SSD-backed PVC (`standard-rwo` StorageClass). `stateful_pvc_size = '20Gi'` default. Data is mounted at `/data/db`.
*   **Authentication**: Root user auto-provisioned via `MONGO_INITDB_ROOT_USERNAME` (default: `'admin'`). Password is auto-generated and stored in Secret Manager if `MONGO_INITDB_ROOT_PASSWORD` is not supplied via `secret_environment_variables`.
*   **Access**: `service_type = 'ClusterIP'` by default — MongoDB is internal to the GKE cluster. Set to `'LoadBalancer'` for external access.
*   **No Cloud SQL**: MongoDB is its own database engine. `database_type = "NONE"` and `enable_cloudsql_volume = false` are hardcoded.
*   **Probes**: TCP probes on the wire-protocol port (27017). HTTP probes would fail because MongoDB speaks its own binary protocol, not HTTP.
*   **Security context**: `stateful_fs_group = 999` is hardcoded in `mongodb.tf` — MongoDB's official image runs `mongod` as UID/GID 999, and the PVC mount must be chowned to this GID.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'mongodb'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'MongoDB'` | Human-readable name. |
| `application_description` | 3 | `string` | `'MongoDB document database on GKE Autopilot'` | Application description. |
| `application_version` | 3 | `string` | `'7.0'` | MongoDB image version tag (e.g., `'7.0'`, `'6.0'`). |

**Module architecture:** Unlike other application modules, `MongoDB_GKE` assembles its own `mongodb_module` config in `mongodb.tf` rather than calling a Common module. It sets `database_type = "NONE"`, `enable_cloudsql_volume = false`, and forces `image_source = "prebuilt"` — no custom Dockerfile is required for MongoDB. `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_DATABASE` are hardcoded into `local.mongo_env_vars`, merged before user `environment_variables`.

---

## 2. IAM & Access Control

`MongoDB_GKE` delegates all IAM provisioning to `App_GKE`. Workload Identity binds the Kubernetes SA to a GCP SA.

**Auto-generated root password:** `mongodb_secrets.tf` auto-generates `MONGO_INITDB_ROOT_PASSWORD` and stores it in Secret Manager (`<prefix>-mongo-root-password`) if `MONGO_INITDB_ROOT_PASSWORD` is not present in `secret_environment_variables`. The generated secret is forwarded to `App_GKE` via `module_secret_env_vars` with an implicit `time_sleep` dependency to ensure propagation before the pod starts.

To supply a custom root password, add `MONGO_INITDB_ROOT_PASSWORD` to `secret_environment_variables` pointing to an existing Secret Manager secret ID.

---

## 3. Core Service Configuration

### A. Compute (GKE Autopilot — StatefulSet)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'prebuilt'` | Always `'prebuilt'` for MongoDB. No custom Dockerfile required. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for the official `mongo` image. |
| `cpu_limit` | 4 | `'1000m'` | CPU per pod. MongoDB's WiredTiger cache scales with available RAM. |
| `memory_limit` | 4 | `'2Gi'` | Memory per pod. WiredTiger defaults to ~50% of available RAM minus 1 GB. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. Keep at 1 for single-node mode. |
| `max_instance_count` | 4 | `1` | Maximum pod replicas. Keep at 1 for single-node mode. |
| `container_port` | 4 | `27017` | MongoDB wire-protocol port. Sets both the Kubernetes Service port and `mongod` listen port. |
| `container_protocol` | 4 | `'http1'` | HTTP protocol for the Kubernetes Service (legacy compatibility field). |
| `timeout_seconds` | 4 | `300` | Load balancer backend timeout. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the MongoDB image into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA. |

**Single-node note:** `min_instance_count = 1` and `max_instance_count = 1` are the defaults. MongoDB replica sets require additional configuration (auth key files, replica set initialisation) not provided by this module. Keep both at 1 for standalone mode.

### B. MongoDB-Specific Variables

| Variable | Group | Default | Description |
|---|---|---|---|
| `mongo_root_username` | 3 | `'admin'` | Root username (`MONGO_INITDB_ROOT_USERNAME`). Supply the password via `secret_environment_variables`. |
| `mongo_initdb_database` | 3 | `'admin'` | Initial database created on first startup (`MONGO_INITDB_DATABASE`). |

### C. StatefulSet & PVC

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 7 | `null` (auto) | When `null`, the module auto-selects StatefulSet when PVC config is present. Set `true` explicitly to force PVC-backed StatefulSet. |
| `stateful_pvc_size` | 7 | `'20Gi'` | Storage size for the MongoDB data PVC. Size depends on document volume. |
| `stateful_pvc_mount_path` | 7 | `'/data/db'` | Mount path for the MongoDB data volume. Must match `mongod --dbpath`. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | Kubernetes StorageClass. `standard-rwo` is the GKE Autopilot default (SSD-backed). |
| `stateful_headless_service` | 7 | `null` | Creates a headless Kubernetes Service for stable pod DNS entries. |
| `stateful_pod_management_policy` | 7 | `null` | Pod creation/deletion order: `'OrderedReady'` or `'Parallel'`. |
| `stateful_update_strategy` | 7 | `null` | StatefulSet update strategy: `'RollingUpdate'` or `'OnDelete'`. |

**fsGroup note:** `stateful_fs_group = 999` is hardcoded in `mongodb.tf`. The official MongoDB image runs `mongod` as UID/GID 999. Kubernetes will chown the PVC mount to this GID on attach. This cannot be overridden via variables.

### D. Access & Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `service_type` | 6 | `'ClusterIP'` | Kubernetes Service type. `'ClusterIP'` restricts access to within the GKE cluster. `'LoadBalancer'` exposes port 27017 externally. |
| `workload_type` | 6 | `null` | `'StatefulSet'` is auto-selected when PVC is configured. `'Deployment'` is also valid (no persistence). |
| `termination_grace_period_seconds` | 6 | `60` | Seconds Kubernetes waits after SIGTERM. MongoDB needs time to flush the journal. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Leave empty to auto-generate. |
| `gke_cluster_name` | 6 | `""` | GKE cluster name. Leave empty to auto-discover. |
| `session_affinity` | 6 | `'None'` | `'None'` or `'ClientIP'`. |
| `deployment_timeout` | 6 | `600` | Seconds Terraform waits for StatefulSet rollout. GKE Autopilot must provision a node and attach the PVC. |
| `enable_network_segmentation` | 6 | `false` | Creates Kubernetes NetworkPolicy resources restricting ingress/egress. |
| `configure_service_mesh` | 6 | `false` | Enables Istio service mesh injection. |
| `enable_multi_cluster_service` | 6 | `false` | Creates a ServiceExport for Multi-Cluster Services (MCS). |

### E. Environment Variables & Secrets

The `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_DATABASE` env vars are pre-populated by the module. User `environment_variables` are merged after, so operator-supplied values take precedence.

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | `{}` | Extra env vars merged into the MongoDB container. Merged after built-in defaults. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager secret references. Supply `MONGO_INITDB_ROOT_PASSWORD` here to use a custom password. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation before proceeding. |
| `database_password_length` | 16 | `32` | Auto-generated password length. Range: 16–64. |

---

## 4. Advanced Security

### A. Cloud Armor

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 21 | `false` | Attaches a Cloud Armor security policy to the GKE Ingress backend. |
| `admin_ip_ranges` | 21 | `[]` | Admin CIDR ranges for privileged access. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Name of the Cloud Armor security policy. |

### B. IAP

IAP is not recommended for MongoDB (a database, not a web application). Use Kubernetes NetworkPolicy or `service_type = 'ClusterIP'` to restrict access.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Not recommended for MongoDB. Use network policy instead. |

### C. Custom Domain & Static IP

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_domain` | 19 | `false` | Provisions a Kubernetes Ingress for custom domain routing. |
| `application_domains` | 19 | `[]` | Custom domain names for the Ingress. |
| `reserve_static_ip` | 19 | `false` | Provisions a global static external IP address. |
| `static_ip_name` | 19 | `""` | Name for the static IP address. |

---

## 5. Resource Quotas

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | 8 | `false` | Creates a Kubernetes ResourceQuota in the namespace. |
| `quota_cpu_requests` | 8 | `""` | Total CPU requests allowed. |
| `quota_cpu_limits` | 8 | `""` | Total CPU limits allowed. |
| `quota_memory_requests` | 8 | `""` | Total memory requests. Must use binary unit suffixes (e.g., `'4Gi'`). |
| `quota_memory_limits` | 8 | `""` | Total memory limits. Must use binary unit suffixes (e.g., `'4Gi'`). |

---

## 6. CI/CD

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 12 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 12 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 12 | `""` | GitHub PAT. Sensitive. |
| `enable_cloud_deploy` | 12 | `false` | Provisions a Cloud Deploy pipeline. |

---

## 7. Observability

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe_config` | 10 | `{ type="TCP", initial_delay_seconds=20, failure_threshold=45 }` | TCP startup probe. GKE Autopilot allows ~8 minutes for node provisioning, PVC attach, and image pull. |
| `health_check_config` | 10 | `{ type="TCP", initial_delay_seconds=30, failure_threshold=3 }` | TCP liveness probe. |
| `uptime_check_config` | 10 | `{ enabled=false }` | Uptime check. Disabled by default — MongoDB is an internal service. |
| `alert_policies` | 10 | `[]` | Cloud Monitoring metric alert policies. |

---

## 8. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **StatefulSet with SSD PVC** | `stateful_pvc_enabled` auto-select | MongoDB data is stored on a `standard-rwo` SSD PVC mounted at `/data/db`. |
| **No Cloud SQL** | `database_type = "NONE"`, `enable_cloudsql_volume = false` hardcoded | MongoDB is its own database. Cloud SQL is not provisioned. |
| **TCP probes only** | Startup and liveness probes use `type = "TCP"` | MongoDB speaks its own wire protocol — HTTP probes would fail with a protocol error. |
| **fsGroup = 999** | Hardcoded in `mongodb.tf` | The MongoDB official image runs `mongod` as UID/GID 999. The PVC mount is chowned to GID 999 by Kubernetes. |
| **Auto root password** | `mongodb_secrets.tf` creates if not supplied | `MONGO_INITDB_ROOT_PASSWORD` is auto-generated and stored in Secret Manager unless already present in `secret_environment_variables`. |
| **ClusterIP default** | `service_type = 'ClusterIP'` | MongoDB is exposed only within the GKE cluster by default. Use `'LoadBalancer'` for external access. |
| **Prebuilt image** | `image_source = "prebuilt"` hardcoded | The official `mongo` image works without modification. |
| **Startup tolerance** | `failure_threshold = 45` (startup) | GKE Autopilot must provision a node, attach the PVC, and pull the image before mongod starts. Allows up to ~8 minutes. |

---

## 9. Outputs

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `MONGO_INITDB_ROOT_PASSWORD` (via `secret_environment_variables`) | *(auto-generated — stored in Secret Manager)* | **Critical** | MongoDB requires a root password set via `MONGO_INITDB_ROOT_PASSWORD` at first startup. The module auto-generates and stores this in Secret Manager. If not injected, MongoDB starts with no authentication on the root account — any caller inside the cluster can connect with admin privileges. Never remove or override with an empty value. |
| `mongo_root_username` | `"admin"` | **High** | The root username is baked into the MongoDB data directory at first init. Changing `mongo_root_username` after the PVC already exists causes startup failure because the existing authentication database does not match. Choose a meaningful username before first deploy; do not change after data is written. |
| `stateful_pvc_enabled` | `null` | **Critical** | Without a PVC, MongoDB stores all data in the ephemeral pod filesystem. Any pod restart, rolling update, or node eviction permanently destroys all databases and collections. Set `stateful_pvc_enabled = true` for all production deployments. |
| `stateful_pvc_size` | `"20Gi"` | **High** | An undersized PVC fills up as documents accumulate. A full disk causes MongoDB to crash with `No space left on device` errors, making all write operations fail. MongoDB does not gracefully degrade on disk-full — it crashes. Provision at least 2–3× the expected initial data volume. PVC size cannot be decreased after creation. |
| `stateful_pvc_mount_path` | `"/data/db"` | **Critical** | Must match MongoDB's `--dbpath`. If the PVC is mounted at a different path, MongoDB writes data to the ephemeral container layer, losing all data on pod restart. Do not change this value. |
| `workload_type` | `null` | **High** | MongoDB requires `StatefulSet` for stable pod identity and ordered PVC binding. `null` defaults to `Deployment`. With `stateful_pvc_enabled = true`, the module auto-selects `StatefulSet`. Explicitly setting `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time. |
| `memory_limit` | `"2Gi"` | **High** | MongoDB's WiredTiger cache defaults to approximately `(memory_limit - 1 Gi) × 0.5`. With `2Gi`, the cache is ~500 Mi. Insufficient cache causes excessive disk I/O, severely degrading query performance. Scale to `4Gi`–`8Gi` for production document workloads. |
| `cpu_limit` | `"1000m"` | **Medium** | MongoDB aggregation pipelines and index builds are CPU-intensive. Below `500m`, complex queries and index creation degrade significantly. Scale to `2000m` for production. |
| `replica set (standalone vs replica set)` | *(standalone — no `--replSet` flag)* | **High** | This module deploys a standalone MongoDB instance. Standalone deployments do not support change streams, transactions, or oplog-based replication. If your application requires these features, you must configure a replica set (single-member or three-member). Changing from standalone to replica set after data exists requires a full `rs.initiate()` and potentially a data migration. |
| `mongo_initdb_database` | `"admin"` | **Medium** | The initial database created at first startup. Applications expecting a non-admin initial database (e.g., `appdb`) should set this before first deploy. Changing after PVC exists has no effect — the `MONGO_INITDB_DATABASE` variable is only applied on first-run initialization. |
| `connection string format` | *(application-specific)* | **High** | The correct MongoDB connection string for this module is `mongodb://<username>:<password>@<service_url>:27017/<db>?authSource=admin`. Missing `authSource=admin` causes authentication failures when connecting to non-admin databases with the root credential. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | **Medium** | Balanced PD is adequate for typical document workloads. High-throughput write-heavy workloads benefit from `premium-rwo` (SSD). Storage class cannot be changed after PVC creation without data migration. |
| `quota_memory_requests` | `""` | **Critical** | If `enable_resource_quota = true` and set without binary suffixes (e.g. `"4"` instead of `"4Gi"`), Kubernetes treats the value as bytes, blocking all pod scheduling. Always use `Gi` or `Mi`. |
| `quota_memory_limits` | `""` | **Critical** | Same constraint as `quota_memory_requests`. If limits are below actual pod memory requirements × replica count, pods fail to schedule. |
| `enable_iap` | `false` | **Low** | MongoDB uses a ClusterIP service (internal-only by default). IAP is not applicable for database-tier services. Ensure network policies restrict MongoDB access to only the application pods that need it. |
| `application_version` | *(module default)* | **High** | MongoDB major version upgrades (e.g., 6.0 → 7.0) change the on-disk storage format and WiredTiger compatibility. Downgrading after a major upgrade is not supported. Always test upgrades against a replica of the production PVC before applying to production. |
| `backup_schedule` | `"0 2 * * *"` | **High** | MongoDB has no built-in automatic backups in this module. The backup job runs `mongodump` to GCS. Ensure the job is active and tested — a missed backup combined with a PVC deletion (`enable_purge = true`) results in permanent data loss. |

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `service_url` | Internal cluster URL of the MongoDB Service. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `mongo_root_password_secret` | Secret Manager secret name for the MongoDB root password (auto-generated). |
