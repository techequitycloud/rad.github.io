# N8N_GKE Module — Configuration Guide

n8n is an open-source workflow automation platform that lets you connect services, run logic, and build automated pipelines through a visual node-based interface. This module deploys n8n on **GKE Autopilot** with a managed PostgreSQL database, GCS-backed storage persistence, and optional NFS for shared volumes.

`N8N_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (GKE Autopilot cluster, networking, Cloud SQL Auth Proxy, GCS, secrets, CI/CD) and adds n8n-specific application configuration on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `N8N_GKE`** or that have **n8n-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, GKE backend configuration, CI/CD, GCS storage, backup, custom SQL, observability, networking, IAP, and Cloud Armor — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE.md Section | N8N-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | §1 Module Overview | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | §2 IAM & Access Control | Refer to base App_GKE module documentation. |
| Application Identity | §3.A Compute (GKE Autopilot) | See [N8N Application Identity](#n8n-application-identity) below for n8n-specific defaults. |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | See [N8N Runtime Configuration](#n8n-runtime-configuration) below. `cpu_limit` and `memory_limit` are top-level variables. |
| Environment Variables & Secrets | §3 Core Service Configuration | See [N8N Environment Variables](#n8n-environment-variables) below for SMTP defaults. |
| GKE Backend Configuration | §3.A Compute (GKE Autopilot) | Refer to base App_GKE module documentation (`service_type`, `workload_type`, `session_affinity`, `gke_cluster_name`, `namespace_name`, etc.). See [StatefulSet Configuration](#statefulset-configuration) for n8n StatefulSet-specific variables. |
| Networking & Network Policies | §3.D Networking & Network Policies | Identical. |
| Jobs & Scheduled Tasks | §3.E Initialization Jobs & CronJobs | Refer to base App_GKE module documentation. |
| Additional Services | §3.F Additional Services | Identical. |
| CI/CD & GitHub Integration | §6 CI/CD & Delivery | Refer to base App_GKE module documentation. |
| Storage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | NFS is **enabled by default** (`enable_nfs = true`). See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Storage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | Refer to base App_GKE module documentation. |
| Database Configuration | §3.B Database (Cloud SQL) | See [N8N Database Configuration](#n8n-database-configuration) below. `db_name` and `db_user` replace `application_database_name` and `application_database_user`. |
| Backup Schedule & Retention | §3.B Database (Cloud SQL) | Refer to base App_GKE module documentation. |
| Custom SQL Scripts | §3.E Initialization Jobs & CronJobs | Refer to base App_GKE module documentation. |
| Observability & Health | §3.A Compute (GKE Autopilot) | See [N8N Health Probes](#n8n-health-probes) below for the two-path probe system. `startup_probe_config`, `health_check_config`, `uptime_check_config`, and `alert_policies` pass directly to App_GKE. |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Refer to base App_GKE module documentation. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Refer to base App_GKE module documentation. Note: GKE IAP requires `iap_oauth_client_id` and `iap_oauth_client_secret`. |
| Binary Authorization | §4.C Binary Authorization | Identical. |
| VPC Service Controls | §4.D VPC Service Controls | Identical. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Identical. |
| Traffic & Ingress | §5 Traffic & Ingress | Refer to base App_GKE module documentation. |
| CDN | §5.B CDN | Identical. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | `enable_pod_disruption_budget` defaults to `true`. |
| Topology Spread Constraints | §7.B Topology Spread Constraints | Identical. |
| Resource Quotas | §7.C Resource Quotas | Refer to base App_GKE module documentation. |
| Auto Password Rotation | §7.D Auto Password Rotation | See [N8N Database Configuration](#n8n-database-configuration). |
| Redis Cache | §8.A Redis / Memorystore | `enable_redis` defaults to `true`. See [Redis Configuration](#redis-configuration) for n8n-specific details. |
| Backup Import | §8.B Backup Import | Uses `backup_uri` instead of `backup_file` — mapped internally to App_GKE's `backup_file` input. |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identical. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Identical. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `N8N_GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **Encryption key auto-generated** | A 32-character random encryption key is generated and stored in Secret Manager as `N8N_ENCRYPTION_KEY`, then synced to a Kubernetes Secret. This key encrypts all n8n credentials (API keys, OAuth tokens, workflow passwords). **Back up this secret before destroying the module** — credentials encrypted with one key cannot be decrypted with a different key. |
| **SMTP password auto-generated** | A placeholder SMTP password is generated and stored in Secret Manager as `N8N_SMTP_PASS`. Replace the secret value with your real SMTP credentials before enabling email sending. |
| **n8n port fixed at 5678** | `N8N_PORT=5678` is injected automatically via the application configuration. The `container_port` variable defaults to `5678` to match. |
| **Database type set to PostgreSQL** | `DB_TYPE=postgresdb` is injected automatically. n8n requires PostgreSQL — do not change `database_type` to MySQL or SQL Server. |
| **Database connection variables injected** | `DB_POSTGRESDB_HOST`, `DB_POSTGRESDB_PORT`, `DB_POSTGRESDB_DATABASE`, `DB_POSTGRESDB_USER`, and `DB_POSTGRESDB_PASSWORD` are injected automatically from the Cloud SQL instance provisioned by App_GKE. The n8n Pod connects via the Cloud SQL Auth Proxy sidecar running at `127.0.0.1`. |
| **Webhook and editor URLs auto-set** | `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are always set to the predicted internal ClusterIP service URL (`http://<service>.<namespace>.svc.cluster.local`), computed before deployment. This value is pre-computed from `application_name`, `tenant_deployment_id`, and `deployment_id` and is stable across applies. |
| **Workload Identity for IAM** | The n8n Pod uses Workload Identity to authenticate to GCP services (Cloud SQL, GCS, Secret Manager) without needing to embed service account keys in the container. |
| **GCS persistence for workflow data** | n8n stores workflow data in a GCS Fuse volume. This persists data across Pod restarts and rescheduling. |
| **Database initialisation job** | A Kubernetes Job (`db-init`) is created automatically to provision the `n8n_db` database and `n8n_user` PostgreSQL user before the n8n Deployment starts. |

---

## N8N Application Identity

These variables control how the n8n deployment is named and described. They correspond to §3.A variables in App_GKE but carry n8n-specific defaults.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"n8n"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, Kubernetes namespace, and Artifact Registry. **Do not change after initial deployment** — it is embedded in resource names and changing it will cause resources to be recreated. |
| `display_name` | `"N8N Workflow Automation"` | Any string | Human-readable name shown in the platform UI and GKE monitoring dashboards. Equivalent to `application_display_name` in App_GKE. Can be updated freely without affecting resource names. |
| `description` | `"n8n Workflow Automation - Workflow automation platform on GKE Autopilot"` | Any string | Brief description of the deployment. Populated into Kubernetes resource annotations and platform documentation. |
| `application_version` | `"2.4.7"` | n8n version string, e.g. `"2.4.7"`, `"latest"` | Version tag applied to the container image and used for deployment tracking. Increment this value to trigger a new image build and revision. See [n8n releases](https://github.com/n8nio/n8n/releases) for available versions. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# View annotations (description is stored here)
kubectl describe deployment n8n -n NAMESPACE | grep -A5 Annotations
```

---

## N8N Runtime Configuration

n8n exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** rather than requiring users to set the full `container_resources` object.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"2000m"` | Kubernetes CPU quantity (e.g. `"1000m"`, `"2000m"`, `"4"`) | CPU limit for the n8n container in GKE Autopilot. **2 vCPU is the recommended minimum for production workflow automation.** n8n executes workflow nodes concurrently and complex workflows with many nodes are CPU-bound. In GKE Autopilot, the CPU limit also determines Pod scheduling and billing. |
| `memory_limit` | `"4Gi"` | Kubernetes memory quantity (e.g. `"2Gi"`, `"4Gi"`, `"8Gi"`) | Memory limit for the n8n container. **4 Gi is recommended for active deployments.** n8n caches workflow state and credential data in memory. Setting below `1Gi` risks OOMKilled Pod restarts during complex workflow executions. |
| `min_instance_count` | `1` | Integer ≥ 0 | Minimum number of n8n Pod replicas. Set to `1` to ensure continuous webhook availability — n8n webhooks are only active while at least one Pod is running. Set to `0` only in development environments where downtime is acceptable. |
| `max_instance_count` | `3` | Integer ≥ 1 | Maximum number of n8n Pod replicas allowed by the HPA. The default of `3` permits horizontal scaling. **Enable Redis queue mode (`enable_redis = true`) before scaling beyond 1 replica** — without Redis, multiple replicas will conflict on workflow state and execution locks. |
| `timeout_seconds` | `300` | Integer, 0–3600 | Maximum request duration before the ingress layer times out. Increase for long-running workflow executions. |

> **Note on `container_resources`:** The full `container_resources` object (as documented in [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot)) is also available. If `container_resources` is set explicitly in your `tfvars`, it takes precedence over the top-level `cpu_limit` and `memory_limit` variables. Use `container_resources` when you also need to set `cpu_request` or `mem_request`.

**N8N-specific runtime defaults that differ from App_GKE:**

| Variable | App_GKE Default | N8N_GKE Default | Reason |
|---|---|---|---|
| `container_port` | `8080` | `5678` | n8n's native port. |
| `cpu_limit` | `"1000m"` | `"2000m"` | Workflow automation is CPU-intensive for concurrent node execution. |
| `memory_limit` | `"512Mi"` | `"4Gi"` | n8n requires substantial memory for workflow state and credential caching. |
| `min_instance_count` | `1` | `1` | Ensures webhook availability at all times. |
| `enable_nfs` | `false` | `true` | NFS provides shared persistence for workflow data and credentials. |
| `enable_cloudsql_volume` | `true` | `true` | n8n connects to Cloud SQL via the Auth Proxy sidecar. |
| `session_affinity` | `"None"` | `"ClientIP"` | Ensures a user's browser session consistently reaches the same n8n Pod, which is required for the n8n editor UI to function correctly. |

### Validating Runtime Configuration

```bash
# View resource requests and limits on the running n8n Pod
kubectl describe pod -n NAMESPACE -l app=n8n | grep -A10 "Limits:"

# Check the HPA (if min/max_instance_count > 1)
kubectl get hpa -n NAMESPACE
```

---

## StatefulSet Configuration

When `workload_type = "StatefulSet"` (see [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot)), `N8N_GKE` exposes additional variables to configure the StatefulSet's persistent volume claim and Pod management behaviour. These variables are **unique to `N8N_GKE`** — they do not exist in `App_GKE`.

Use `workload_type = "StatefulSet"` when n8n must retain local state across Pod restarts and you require stable network identities or ordered Pod startup. For most deployments, the default `workload_type = "Deployment"` with GCS Fuse persistence is sufficient.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` / `false` | When `true` and `workload_type = "StatefulSet"`, provisions a PersistentVolumeClaim per Pod for local storage. Use this when n8n's filesystem persistence requirements exceed what GCS Fuse provides (e.g., high-frequency small file writes). Only effective when `workload_type = "StatefulSet"`. |
| `stateful_pvc_size` | `"10Gi"` | Kubernetes storage quantity (e.g. `"10Gi"`, `"50Gi"`, `"100Gi"`) | Size of the PVC provisioned for each StatefulSet Pod. Size the PVC based on expected workflow execution data and binary file storage volume. Only used when `stateful_pvc_enabled = true`. |
| `stateful_pvc_mount_path` | `"/data"` | Absolute path string | Filesystem path inside the n8n container where the PVC is mounted. Override to `/home/node/.n8n` if you want n8n's data directory to be backed by a PVC instead of GCS Fuse. Only used when `stateful_pvc_enabled = true`. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | GKE storage class name (e.g. `"standard-rwo"`, `"premium-rwo"`) | Kubernetes StorageClass for the PVC. `standard-rwo` uses standard persistent disk with ReadWriteOnce access. Use `premium-rwo` for higher IOPS when n8n processes high volumes of binary workflow data. Only used when `stateful_pvc_enabled = true`. |
| `stateful_headless_service` | `true` | `true` / `false` | When `true`, creates a headless Kubernetes Service (ClusterIP: None) for the StatefulSet, giving each Pod a stable DNS entry (`<pod-name>.<service>.<namespace>.svc.cluster.local`). Required for n8n queue mode webhook routing when running multiple replicas as a StatefulSet. Only effective when `workload_type = "StatefulSet"`. |
| `stateful_pod_management_policy` | `"OrderedReady"` | `"OrderedReady"` / `"Parallel"` | Controls the order in which StatefulSet Pods are started and stopped. `OrderedReady` starts Pods sequentially and waits for each to be ready before starting the next — recommended for n8n to ensure the primary instance initialises the database schema before replicas start. `Parallel` starts all Pods simultaneously and is only safe when Redis queue mode is enabled. Only effective when `workload_type = "StatefulSet"`. |
| `stateful_update_strategy` | `"RollingUpdate"` | `"RollingUpdate"` / `"OnDelete"` | Controls how StatefulSet Pods are updated when the Pod template changes. `RollingUpdate` replaces Pods automatically in reverse ordinal order. `OnDelete` requires manual Pod deletion to trigger updates — use this when you need to control the exact timing of n8n restarts during maintenance windows. Only effective when `workload_type = "StatefulSet"`. |

### Validating StatefulSet Configuration

```bash
# Confirm the StatefulSet exists (when workload_type = "StatefulSet")
kubectl get statefulsets -n NAMESPACE

# Check PVCs created for the StatefulSet
kubectl get pvc -n NAMESPACE

# Verify stable DNS entries for each Pod
kubectl exec -n NAMESPACE <any-pod> -- nslookup n8n-0.n8n.NAMESPACE.svc.cluster.local
```

---

## Redis Configuration

These variables configure n8n's Redis integration. The underlying Redis infrastructure support is provided by `App_GKE` (see [App_GKE §8.A](../App_GKE/App_GKE.md#a-redis--memorystore)); the variables below are n8n-specific. Redis is required for n8n **queue mode**, which enables reliable multi-replica workflow execution.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Enables Redis as the n8n queue mode backend by injecting `REDIS_HOST` and `REDIS_PORT` environment variables into the n8n Pod. When `true` and `redis_host` is empty, the module defaults to the NFS server IP discovered from `Services_GCP`. **Required when `max_instance_count > 1`** to avoid workflow state conflicts between replicas. |
| `redis_host` | `""` *(auto-discovered)* | Hostname or IP, e.g. `"10.0.0.5"`, `"redis.internal"` | Hostname or IP of the Redis server. Leave blank to use the NFS server IP auto-discovered from `Services_GCP`. Override with a dedicated Redis/Memorystore instance endpoint for production deployments requiring higher availability or AUTH. |
| `redis_port` | `"6379"` | Port string, e.g. `"6379"` | TCP port of the Redis server. Must match the port configured on the Redis instance. |
| `redis_auth` | `""` | Sensitive string | Authentication password for the Redis server. Leave empty for unauthenticated Redis. For Google Cloud Memorystore with AUTH enabled, set this to the instance auth string. Treated as sensitive — never stored in Terraform state in plaintext. |

> **Validation guard:** When `enable_redis = true`, either `redis_host` must be set or `enable_nfs` must be `true`. If neither condition is met, Terraform will reject the configuration with an error explaining that `REDIS_HOST` would be empty, causing the n8n queue worker to fail to connect.

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are set in the n8n Pod
kubectl describe pod -n NAMESPACE -l app=n8n | grep -E "REDIS"
```

---

## N8N Database Configuration

n8n requires PostgreSQL. This module exposes `db_name` and `db_user` as **short top-level variables** in place of the `application_database_name` and `application_database_user` variables documented in [App_GKE §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql).

All other database variables (`database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, `secret_rotation_period`, etc.) behave identically to the App_GKE equivalents — refer to [App_GKE §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"n8n_db"` | `[a-z][a-z0-9_]{0,62}` | Name of the PostgreSQL database created within the Cloud SQL instance. Injected automatically as `DB_POSTGRESDB_DATABASE`. **Do not change after initial deployment** — renaming the database requires a full backup-and-restore migration. |
| `db_user` | `"n8n_user"` | `[a-z][a-z0-9_]{0,31}` | PostgreSQL user created for n8n. Injected automatically as `DB_POSTGRESDB_USER`. The password is auto-generated, stored in Secret Manager, synced to a Kubernetes Secret, and injected as `DB_POSTGRESDB_PASSWORD`. |

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB env vars are injected into the n8n Pod
kubectl describe pod -n NAMESPACE -l app=n8n | grep -E "DB_POSTGRES"
```

---

## N8N Environment Variables

The `environment_variables` variable (documented in [App_GKE §3](../App_GKE/App_GKE.md#3-core-service-configuration)) has n8n-specific defaults that configure email delivery.

**Default `environment_variables` in N8N_GKE:**

```hcl
environment_variables = {
  SMTP_HOST     = ""
  SMTP_PORT     = "25"
  SMTP_USER     = ""
  SMTP_PASSWORD = ""
  SMTP_SSL      = "false"
  EMAIL_FROM    = "ghost@example.com"
}
```

Override the SMTP values to enable n8n email notifications (workflow failure alerts, credential sharing invitations). For providers such as SendGrid or Mailgun that use API key authentication, set `SMTP_USER = "apikey"` and store the actual key in `secret_environment_variables`.

> **Do not set** `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, or `N8N_EDITOR_BASE_URL` in `environment_variables` — these are injected automatically by the platform and will be overridden.

---

## N8N Health Probes

`N8N_GKE` exposes **two parallel sets** of probe variables that configure Kubernetes probes via different routing paths:

| Variable set | Passed to | Configures |
|---|---|---|
| `startup_probe`, `liveness_probe` | `N8N_Common` sub-module | The application container's Kubernetes probe spec (`initialDelaySeconds`, `path`, `failureThreshold`, etc.) |
| `startup_probe_config`, `health_check_config` | `App_GKE` directly | The App_GKE-standard probe configuration used for load balancer health checks and GKE infrastructure probes |

These are parallel paths, not aliases. Changing `startup_probe` does not affect `startup_probe_config`, and vice versa.

**Application container probes** (`startup_probe`, `liveness_probe` → `N8N_Common`):

| Variable | Default |
|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 120, timeout_seconds = 3, period_seconds = 10, failure_threshold = 3 }` |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` |

The `initial_delay_seconds = 120` on the startup probe gives n8n time to connect to PostgreSQL and load encrypted credentials before health checks begin.

**App_GKE-standard probes** (`startup_probe_config`, `health_check_config` → `App_GKE`):

| Variable | Default |
|---|---|
| `startup_probe_config` | `{ enabled = true, type = "TCP" }` — TCP type; no HTTP path check |
| `health_check_config` | `{ enabled = true, type = "HTTP", path = "/" }` — HTTP GET on `"/"` |

For full documentation on `uptime_check_config` and `alert_policies`, refer to [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

> **Note:** `uptime_check_config` defaults to `{ enabled = false, path = "/" }` in N8N_GKE (monitoring is disabled by default), unlike N8N_CloudRun where it defaults to `{ enabled = true, path = "/" }`.

---

## Configuration Examples

### Basic Deployment

Deploys n8n on GKE using default settings. Suitable for evaluation and development.

```hcl
# config/basic.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "basic"
```

### Advanced Deployment

Production-grade deployment with Redis queue mode, CI/CD, GKE-specific reliability policies, and full observability.

```hcl
# config/advanced.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "prod"

application_name         = "n8n"
display_name             = "N8N Workflow Automation"

# Scaling & Performance
cpu_limit          = "4000m"
memory_limit       = "8Gi"
min_instance_count = 1
max_instance_count = 5

# Redis (required for multi-replica scaling)
enable_redis = true

# Database
database_password_length = 32

# GKE Specific
enable_resource_quota           = true
enable_pod_disruption_budget    = true
enable_network_segmentation     = true
enable_vertical_pod_autoscaling = true

# CI/CD & Cloud Deploy
enable_cicd_trigger = true
enable_cloud_deploy = true
cloud_deploy_stages = [
  { name = "dev",     require_approval = false, auto_promote = false },
  { name = "staging", require_approval = false, auto_promote = false },
  { name = "prod",    require_approval = true,  auto_promote = false },
]

# Security
enable_iap                  = true
enable_binary_authorization = true
enable_cloud_armor          = true

# Backup
backup_schedule       = "0 2 * * *"
backup_retention_days = 30

# Observability
uptime_check_config = {
  enabled        = true
  path           = "/healthz"
  check_interval = "60s"
  timeout        = "10s"
}

alert_policies = [
  {
    name               = "high-cpu"
    metric_type        = "kubernetes.io/container/cpu/usage_time"
    comparison         = "COMPARISON_GT"
    threshold_value    = 2000
    duration_seconds   = 300
    aggregation_period = "60s"
  }
]
```

### StatefulSet Deployment

Deploys n8n as a StatefulSet with a PVC for local data storage, suitable for high-frequency workflow executions with binary file output.

```hcl
# config/custom.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "stateful"

application_name = "n8n"

# StatefulSet
workload_type    = "StatefulSet"
min_instance_count = 1
max_instance_count = 3

# StatefulSet PVC
stateful_pvc_enabled       = true
stateful_pvc_size          = "50Gi"
stateful_pvc_mount_path    = "/home/node/.n8n"
stateful_pvc_storage_class = "premium-rwo"

# StatefulSet behaviour
stateful_headless_service      = true
stateful_pod_management_policy = "OrderedReady"
stateful_update_strategy       = "RollingUpdate"

# Redis (required for multi-replica StatefulSet)
enable_redis = true

# Custom Container Build
container_image_source = "custom"
container_build_config = {
  enabled            = true
  dockerfile_path    = "Dockerfile"
  context_path       = "scripts"
  dockerfile_content = null
  build_args         = {}
  artifact_repo_name = "n8n-repo"
}

# SMTP
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "sendgrid-api-key-secret"
}
```
