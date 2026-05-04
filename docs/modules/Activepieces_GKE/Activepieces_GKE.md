# Activepieces_GKE Module — Configuration Guide

Activepieces is an open-source, Apache 2.0-licensed no-code workflow automation platform for connecting apps, APIs, and data sources. This module deploys a production-ready Activepieces application on **GKE Autopilot**, backed by a managed Cloud SQL PostgreSQL 15 instance, GCS data storage, and Secret Manager for cryptographic secrets (`AP_ENCRYPTION_KEY` and `AP_JWT_SECRET`).

`Activepieces_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, Filestore, secrets, CI/CD) and adds Activepieces-specific application configuration via the `Activepieces_Common` sub-module.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents variables that are **unique to `Activepieces_GKE`** or that have **Activepieces-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, runtime scaling, backend configuration, CI/CD, networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE.md Section | Activepieces-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | §1 Module Overview | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | §2 IAM & Access Control | Identical. Plus `deployment_region` for fallback region. |
| Application Identity | §3.A Compute (GKE Autopilot) | See [Activepieces Application Identity](#activepieces-application-identity). `application_name` defaults to `"activepieces"`. |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | `min_instance_count` defaults to `1`. `container_image_source` defaults to `"custom"`. See [Scaling Considerations](#scaling-considerations). |
| Environment Variables & Secrets | §3 Core Service Configuration | `Activepieces_Common` injects all `AP_*` variables automatically — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Networking & Network Policies | §3.D Networking & Network Policies | `session_affinity` defaults to `"ClientIP"` — see [Session Affinity](#session-affinity). |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | See [Initialization Jobs](#initialization-jobs). Default `db-init` job is provided by `Activepieces_Common`. |
| Additional Services | §3.F Additional Services | Identical. |
| Storage — NFS & GCS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` defaults to `false`. GCS data bucket auto-provisioned by `Activepieces_Common`. |
| Database Configuration | §3.B Database (Cloud SQL) | See [Activepieces Database Configuration](#activepieces-database-configuration). PostgreSQL 15 required; `pgvector` installed automatically. |
| Backup Schedule & Retention | §3.B Database (Cloud SQL) | Uses `backup_uri` instead of `backup_file`. |
| Custom SQL Scripts | §3.E Initialization Jobs & CronJobs | Identical. |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | See [Activepieces Health Probes](#activepieces-health-probes). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identical. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | GKE-specific IAP variables required. See [IAP (GKE-specific)](#identity-aware-proxy-gke-specific). **Warning: IAP blocks webhook endpoints.** |
| Binary Authorization | §4.C Binary Authorization | Identical. Exposes `binauthz_evaluation_mode`. |
| VPC Service Controls | §4.D VPC Service Controls | Identical. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Identical. |
| Traffic & Ingress | §5 Traffic & Ingress | See [Webhook Access](#webhook-access). |
| CDN | §5.B CDN | Identical. |
| Static IP | §5.C Static IP | Identical. |
| Cloud Build Triggers | §6.A Cloud Build Triggers | Identical. |
| Cloud Deploy Pipeline | §6.B Cloud Deploy Pipeline | Identical. |
| Image Mirroring | §6.C Image Mirroring | `enable_image_mirroring` defaults to `true`. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | `enable_pod_disruption_budget` defaults to `true`, `pdb_min_available = "1"`. |
| Topology Spread Constraints | §7.B Topology Spread Constraints | Identical. |
| Resource Quotas | §7.C Resource Quotas | Identical. |
| Auto Password Rotation | §7.D Auto Password Rotation | See [Password Rotation Propagation Delay](#password-rotation-propagation-delay). |
| Redis Cache | §8.A Redis | **Activepieces-specific.** See [Redis Queue Mode](#redis-queue-mode). |
| Backup Import | §8.B Backup Import | Uses `backup_uri` (maps to `App_GKE`'s `backup_file`). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identical. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Identical. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Activepieces_GKE` (via the `Activepieces_Common` sub-module) regardless of the variable values in your `tfvars` file.

| Behaviour | Detail |
|---|---|
| **Activepieces environment variables** | `Activepieces_Common` injects the following environment variables automatically: `AP_DB_TYPE` (`POSTGRES`), `AP_PORT` (`8080`), `AP_POSTGRES_PORT` (`5432`), `AP_FRONTEND_URL`, `AP_WEBHOOK_URL_PREFIX` (from the predicted internal service URL), `AP_ENVIRONMENT` (`production`), `AP_TELEMETRY_ENABLED` (`false`), `AP_EXECUTION_MODE` (`UNSANDBOXED`), `AP_SANDBOX_TYPE` (`NO_SANDBOX`), `AP_SIGN_UP_ENABLED` (`true`). |
| **AP_POSTGRES_* mapping** | `entrypoint.sh` maps platform-standard `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` to Activepieces-specific `AP_POSTGRES_HOST`, `AP_POSTGRES_DATABASE`, `AP_POSTGRES_USERNAME`, `AP_POSTGRES_PASSWORD` at container startup. Do not set `AP_POSTGRES_*` variables directly in `environment_variables`. |
| **AP_ENCRYPTION_KEY** | A random 32-character hex string is auto-generated and stored in Secret Manager. It is injected into the container via `module_secret_env_vars`. **Do not set `AP_ENCRYPTION_KEY` in `environment_variables`** — the platform-managed value in Secret Manager takes precedence. |
| **AP_JWT_SECRET** | A random 32-character alphanumeric string is auto-generated and stored in Secret Manager. Injected via `module_secret_env_vars`. Do not set manually. |
| **AP_QUEUE_MODE** | Defaults to `"MEMORY"`. Set `enable_redis = true` to switch to `"REDIS"` mode. |
| **pgvector extension** | The `pgvector` extension (`CREATE EXTENSION IF NOT EXISTS vector`) is installed automatically in the application database during the `db-init` job. Required for Activepieces AI-powered workflow features. |
| **GCS data bucket** | `Activepieces_Common` provisions a GCS bucket (suffix `ap-data`) and passes it to `App_GKE` via `module_storage_buckets`. The application SA is granted storage access by `App_GKE`. |
| **NFS disabled by default** | `enable_nfs` defaults to `false`. Unlike Django, Activepieces stores all state in PostgreSQL. Enable NFS only if co-locating Redis on the NFS server VM or if your deployment requires shared filesystem access across pods. |
| **Session affinity** | `session_affinity` defaults to `"ClientIP"` to ensure consistent routing for Activepieces UI sessions. |
| **Secret injection** | `Activepieces_GKE` uses `explicit_secret_values` (the raw secret values) to inject secrets directly into Kubernetes Secrets, bypassing Secret Manager read-after-write consistency issues on the initial apply. |

---

## Identity-Aware Proxy (GKE-specific)

> **Warning:** Enabling IAP (`enable_iap = true`) requires Google identity authentication for all inbound requests, including **webhook endpoints**. Third-party services that POST to Activepieces webhook URLs will receive authentication errors. Only enable IAP if webhooks are not needed or are called exclusively by internal services.

`Activepieces_GKE` exposes three GKE-specific IAP variables not present in `Activepieces_CloudRun`. These are required when `enable_iap = true`:

| Variable | Group | Default | Description |
|---|---|---|---|
| `iap_oauth_client_id` | 19 | `""` | OAuth client ID. Create in Google Cloud Console > APIs & Services > Credentials. Sensitive. |
| `iap_oauth_client_secret` | 19 | `""` | OAuth client secret. Sensitive. |
| `iap_support_email` | 19 | `""` | Support email shown on the OAuth consent screen. Must be a valid email address or empty. Validated by regex. |

A `validation.tf` precondition enforces that both `iap_oauth_client_id` and `iap_oauth_client_secret` are non-empty when `enable_iap = true`.

---

## Webhook Access

Activepieces receives webhook calls from external services. For GKE deployments, the default `service_type = "LoadBalancer"` exposes the Kubernetes Service on an external IP. Webhook endpoints are accessible at the LoadBalancer IP (or custom domain when `enable_custom_domain = true`).

The `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` are set to the predicted internal cluster URL at plan time (`http://<name>.<namespace>.svc.cluster.local`). For GKE deployments, you must set `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` to the external service URL via `environment_variables` after the LoadBalancer IP is known:

```hcl
environment_variables = {
  AP_FRONTEND_URL       = "https://activepieces.example.com"
  AP_WEBHOOK_URL_PREFIX = "https://activepieces.example.com"
}
```

---

## Activepieces Application Identity

These variables have Activepieces-specific defaults.

| Variable | Default | Description & Implications |
|---|---|---|
| `application_name` | `"activepieces"` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, and Artifact Registry. **Do not change after initial deployment.** |
| `application_display_name` | `"Activepieces Workflow Automation"` | Human-readable name shown in the platform UI and monitoring dashboards. Can be updated freely. |
| `application_description` | `"Activepieces - Open source workflow automation on GKE Autopilot"` | Brief description populated into Kubernetes annotations and platform documentation. |
| `application_version` | `"latest"` | Version tag applied to the container image. The custom image wraps `activepieces/activepieces:<version>`. Pin to a specific version (e.g. `"0.20.0"`) in production. |
| `display_name` | `"Activepieces Workflow Automation"` | Human-readable display name passed to `Activepieces_Common`. Exposed alongside `application_display_name`. |
| `description` | `"Activepieces - Open source workflow automation platform on GKE Autopilot"` | Description passed to `Activepieces_Common`. |

---

## Activepieces Database Configuration

Activepieces requires PostgreSQL 15 (`database_type = "POSTGRES"` by default in `Activepieces_GKE`). `Activepieces_Common` hardcodes `database_type = "POSTGRES_15"` in the `config` output regardless of what is passed via `application_database_name`/`application_database_user`.

**Note:** `Activepieces_GKE` exposes **two sets** of database name and user variables:
- `application_database_name` / `application_database_user` — passed to `App_GKE` for Cloud SQL instance provisioning.
- `db_name` / `db_user` — passed to `Activepieces_Common` for the application-level database and user configuration.

Both sets should be set to the same values. The defaults differ between the two (see table below).

| Variable | Default | Description & Implications |
|---|---|---|
| `application_database_name` | `"activepieces_db"` | Passed to `App_GKE` for Cloud SQL provisioning. Must match `db_name`. |
| `application_database_user` | `"ap_user"` | Passed to `App_GKE` for Cloud SQL user provisioning. Must match `db_user`. |
| `db_name` | `"activepieces_db"` | Passed to `Activepieces_Common` for app configuration. |
| `db_user` | `"ap_user"` | Passed to `Activepieces_Common` for app configuration. |
| `database_type` | `"POSTGRES"` | Cloud SQL database engine. Activepieces requires PostgreSQL. `Activepieces_Common` overrides to `"POSTGRES_15"` in the app config. |
| `enable_postgres_extensions` | `false` | Not required for Activepieces — `pgvector` is installed directly by the `db-init.sh` script. Set to `true` only for additional extensions. |
| `postgres_extensions` | `[]` | Additional extensions beyond `pgvector`. |

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the running pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^(DB_|AP_POSTGRES_)"

# Confirm secrets are injected
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^(AP_ENCRYPTION_KEY|AP_JWT_SECRET)"
```

---

## Activepieces Health Probes

`Activepieces_GKE` exposes **two separate sets** of probe variables with different routing:

*   **`startup_probe` / `liveness_probe`** — Activepieces-specific variables passed to `Activepieces_Common`, which uses them to configure the application container's Kubernetes probe spec. Both target `/` by default in the GKE module.
*   **`startup_probe_config` / `health_check_config`** — `App_GKE`-standard variables passed directly to `App_GKE`.

Activepieces connects to PostgreSQL and applies database migrations on **first boot** — this can take several minutes. The default `startup_probe` settings (`initial_delay_seconds = 60`, `failure_threshold = 3`, `period_seconds = 10`) provide a 60-second initial delay plus 30 seconds of retry window. Increase `failure_threshold` or `initial_delay_seconds` if migrations are slow.

**`startup_probe` and `liveness_probe` (Activepieces_Common internal probes):**

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 60, timeout_seconds = 3, period_seconds = 10, failure_threshold = 3 }` | Used by `Activepieces_Common` for container startup assessment. Targets `/`. Increase `initial_delay_seconds` to 120+ for first-boot migrations. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Used by `Activepieces_Common` for ongoing health assessment. |

**`startup_probe_config` / `health_check_config` (App_GKE-standard probes):**

Django-style App_GKE infrastructure probes. Defaults:
- `startup_probe_config`: `{ enabled = true, type = "TCP", initial_delay_seconds = 0, timeout_seconds = 240, period_seconds = 240, failure_threshold = 1 }`
- `health_check_config`: `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 0, timeout_seconds = 1, period_seconds = 10, failure_threshold = 3 }`

> **Best practice:** Configure a dedicated `/api/v1/flags` health endpoint. The Activepieces flags API responds when the server is fully initialised and connected to PostgreSQL. Set `path = "/api/v1/flags"` in both `startup_probe` and `liveness_probe` for more accurate health signalling than the root `/` path.

### Validating Health Probe Configuration

```bash
# View startup and liveness probe config
kubectl get deployment activepieces -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].startupProbe}' | jq .

# View pod restart counts
kubectl get pods -n NAMESPACE -o wide

# View Activepieces startup logs
kubectl logs -n NAMESPACE -l app=activepieces --since=10m | head -100
```

---

## Redis Queue Mode

Activepieces supports two queue modes:

- **`MEMORY`** (default): Workflow jobs are executed in-process. Suitable for single-replica deployments. Scaling beyond one replica in memory mode causes inconsistent execution — jobs may be dispatched to any replica and lose context.
- **`REDIS`** (when `enable_redis = true`): Bull queue backed by Redis. Enables reliable horizontal scaling. Required when `max_instance_count > 1`.

| Variable | Group | Default | Description & Implications |
|---|---|---|---|
| `enable_redis` | 14 | `false` | Switches `AP_QUEUE_MODE` from `MEMORY` to `REDIS`. Required before scaling beyond 1 replica. |
| `redis_host` | 14 | `""` | Redis server hostname or IP. Leave empty to fall back to the NFS server IP (`$(NFS_SERVER_IP)` placeholder). For production, set explicitly to a Cloud Memorystore private IP. |
| `redis_port` | 14 | `"6379"` | Redis TCP port (string type). |
| `redis_auth` | 14 | `""` | Redis AUTH password. Sensitive — never stored in Terraform state in plaintext. |

> **Redis host resolution:** When `enable_redis = true` and `redis_host = ""`, the `$(NFS_SERVER_IP)` placeholder is used. This is replaced at runtime by the NFS server's internal IP. This enables a simple co-located Redis + NFS setup. For production deployments, provision a dedicated Cloud Memorystore instance and set `redis_host` explicitly.

> **Provisioning Redis:** `Activepieces_GKE` does not provision a Redis instance. Provision Cloud Memorystore separately, or deploy `Services_GCP` — it provides a shared Memorystore instance auto-discovered when `redis_host` is left blank.

**Validation rule:** A `validation.tf` precondition enforces that when `enable_redis = true`, either `redis_host != ""` or `enable_nfs = true`. This prevents `QUEUE_BULL_REDIS_HOST` from being empty, which would cause the application to fail on startup.

### Validating Redis Configuration

```bash
# Confirm Redis environment variables are injected
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^(QUEUE_BULL_REDIS|AP_QUEUE_MODE|AP_REDIS_URL|ENABLE_REDIS)"

# Confirm AP_REDIS_URL was constructed by entrypoint.sh
kubectl logs -n NAMESPACE POD_NAME | grep "Resolved AP_REDIS_URL"
```

---

## Session Affinity

Activepieces is primarily a stateful server-side application. User sessions and ongoing workflow execution context are tracked per-connection.

| Variable | Default | Description & Implications |
|---|---|---|
| `session_affinity` | `"ClientIP"` | Routes all requests from a given client IP to the same pod for the duration of the affinity timeout (default 10800 seconds). Prevents UI session disruption and ensures long-running workflow connections remain on the same pod. Use `"None"` only when running in Redis queue mode with fully externalised session state. |

---

## Scaling Considerations

| Variable | Default | Description & Implications |
|---|---|---|
| `min_instance_count` | `1` | GKE deployments default to 1 replica (unlike Cloud Run's scale-to-zero default of 0). Ensures webhook endpoints are always available. |
| `max_instance_count` | `3` | Maximum pod replicas. **Only increase when `enable_redis = true`** — memory queue mode does not support horizontal scaling. |

---

## Initialization Jobs

`Activepieces_GKE` does **not** configure a non-empty default `initialization_jobs` list — when `initialization_jobs = []` (the default), `Activepieces_Common` substitutes a single default `db-init` job (`execute_on_apply = true`). Unlike Django, there is no separate `db-migrate` job — Activepieces runs database migrations automatically on startup.

The default `db-init` job:

| Field | Value |
|-------|-------|
| Name | `db-init` |
| Description | `"Create Activepieces Database and User"` |
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` (from `Activepieces_Common`) |
| `execute_on_apply` | `true` |
| Timeout | `600s` |

The `db-init.sh` script:
1. Detects Cloud SQL Auth Proxy Unix socket and maps it for `psql` access.
2. Waits for PostgreSQL to be reachable.
3. Creates (or updates) the application database user.
4. Creates (or reconfigures) the application database.
5. Grants full privileges on the database and public schema.
6. Installs the `pgvector` extension (required for AI piece integrations).
7. Signals Cloud SQL Auth Proxy shutdown.

```hcl
# Example: explicit initialization jobs override
initialization_jobs = [
  {
    name             = "db-init"
    description      = "Create Activepieces Database and User"
    image            = "postgres:15-alpine"
    script_path      = "db-init.sh"
    execute_on_apply = true
  }
]
```

### Validating Initialization Jobs

```bash
# List all Kubernetes Jobs in the namespace
kubectl get jobs -n NAMESPACE

# View logs of the db-init job
kubectl logs -n NAMESPACE -l job-name=db-init --tail=50

# Confirm pgvector extension was installed
gcloud sql connect INSTANCE_NAME --user=postgres --project=PROJECT_ID \
  -- -c "SELECT installed_version FROM pg_available_extensions WHERE name = 'vector';"
```

---

## StatefulSet PVC Configuration

Activepieces stores all workflow state in PostgreSQL. A StatefulSet with per-pod PVCs is **not recommended** for standard deployments. Use the default `Deployment` workload type with PostgreSQL for state persistence.

If your deployment requires per-pod local storage (e.g., for custom piece artifacts or temporary execution data), the following variables configure the per-pod PVC:

| Variable | Default | Description & Implications |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Enable PVC for StatefulSet. Leave `false` for standard Deployment workloads. |
| `stateful_pvc_size` | `"10Gi"` | Per-pod PVC capacity. |
| `stateful_pvc_mount_path` | `"/data"` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Kubernetes StorageClass. `"premium-rwo"` for lower latency. |
| `stateful_headless_service` | `true` | Headless Service for stable pod DNS names. |
| `stateful_pod_management_policy` | `"OrderedReady"` | `OrderedReady` for sequential startup; `Parallel` for simultaneous startup. |
| `stateful_update_strategy` | `"RollingUpdate"` | `RollingUpdate` for automatic updates; `OnDelete` for manual pod deletion. |

---

## Password Rotation Propagation Delay

| Variable | Default | Description & Implications |
|---|---|---|
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after updating the `DB_PASSWORD` secret before triggering a rolling restart of the Activepieces Deployment. Allows Secret Manager replication to complete before pods reconnect with new credentials. **Increase to `120`** in multi-region deployments. Only used when `enable_auto_password_rotation = true`. |

---

## Validation Rules

`Activepieces_GKE` includes a `validation.tf` with three cross-variable preconditions enforced at `terraform apply` time:

| Rule | Condition | Error Message |
|---|---|---|
| Instance count | `min_instance_count <= max_instance_count` | `min_instance_count must not exceed max_instance_count` |
| Redis host source | When `enable_redis = true`, either `redis_host != ""` or `enable_nfs = true` | `When enable_redis is true, either redis_host must be set or enable_nfs must be true` |
| IAP credentials | When `enable_iap = true`, both `iap_oauth_client_id` and `iap_oauth_client_secret` must be non-empty | `When enable_iap is true, both iap_oauth_client_id and iap_oauth_client_secret must be provided` |

---

## Deployment Prerequisites & Validation

After deploying `Activepieces_GKE`, confirm the deployment is healthy:

```bash
# Confirm the Activepieces pod is running and ready
kubectl get pods -n NAMESPACE -l app=activepieces -o wide

# Confirm the Cloud SQL instance is running
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion)"

# Confirm AP_POSTGRES_* and secret env vars are injected
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^(AP_POSTGRES_|AP_ENCRYPTION_KEY|AP_JWT_SECRET|AP_QUEUE_MODE)"

# Confirm the database and user exist
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# View Activepieces application logs
kubectl logs -n NAMESPACE -l app=activepieces --since=5m

# Confirm the service is accessible
kubectl get service -n NAMESPACE

# Test the flags API health endpoint
kubectl exec -n NAMESPACE POD_NAME -- curl -s http://localhost:8080/api/v1/flags | jq .
```

---

## Resource Creator Identity

| Variable | Default | Description & Implications |
|---|---|---|
| `resource_creator_identity` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | The service account used by Terraform to create and manage GCP resources. For enhanced security, replace with a project-scoped service account. |
