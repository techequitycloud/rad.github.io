# NocoDB on Google Kubernetes Engine (GKE Autopilot)

This document provides a comprehensive reference for the `modules/NocoDB_GKE` Terraform module. It covers architecture, IAM, configuration variables, NocoDB-specific behaviours, and operational patterns for deploying NocoDB on GKE Autopilot.

---

## 1. Module Overview

NocoDB is an open-source no-code database platform (Airtable alternative) with 45,000+ GitHub stars that transforms any database into a smart spreadsheet with a no-code interface, REST and GraphQL APIs, and built-in automations. `NocoDB_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning and injects NocoDB-specific application configuration via `NocoDB_Common`.

**Key Capabilities:**
*   **Compute**: GKE Autopilot, Kubernetes Deployment (not StatefulSet — NocoDB stores state in PostgreSQL, not on disk). 1 vCPU / 1 Gi by default. HPA scales from `min_instance_count = 1` to `max_instance_count = 10`.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15** (default). NocoDB also supports MySQL 8.0.
*   **IAM**: Workload Identity binds the Kubernetes service account to a GCP SA for Secret Manager and GCS access.
*   **Security**: Inherits Cloud Armor, Binary Authorization, and VPC Service Controls from `App_GKE`.
*   **NC_DB_* mapping**: A custom Dockerfile in `NocoDB_Common` maps `DB_*` env vars to `NC_DB_*` variables NocoDB expects when `container_image_source = 'custom'` (default).
*   **Health**: Health probes target `/api/v1/health` with 30-second initial delay.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'nocodb'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'NocoDB'` | Human-readable name shown in the GCP Console. |
| `application_description` | 3 | `string` | `'NocoDB on GKE Autopilot'` | Application description. |
| `application_version` | 3 | `string` | `'latest'` | NocoDB image version tag. |

**Wrapper architecture:** `NocoDB_GKE` calls `NocoDB_Common` to build an `application_config` object. The GCS uploads bucket name is computed from the resource prefix and injected as `GCS_BUCKET_NAME` and `GCS_BASE_URL`. `module_secret_env_vars = module.nocodb_app.secret_ids` and `module_storage_buckets = module.nocodb_app.storage_buckets` are forwarded to `App_GKE`.

---

## 2. IAM & Access Control

`NocoDB_GKE` delegates all IAM provisioning to `App_GKE`. Workload Identity binds the Kubernetes SA to a GCP SA, granting access to Secret Manager secrets (database password, application secrets) and GCS buckets.

**No application-level secrets:** `NocoDB_Common` does not auto-generate application secrets. NocoDB manages its own JWT and encryption keys at runtime. Use `secret_environment_variables` for custom secrets.

---

## 3. Core Service Configuration

### A. Compute (GKE Autopilot)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build. `'prebuilt'` deploys an existing image. |
| `container_image` | 4 | `""` | Container image URI. Leave empty for Cloud Build to manage. |
| `container_resources` | 4 | `{ cpu_limit="1000m", memory_limit="1Gi" }` | CPU/memory limits and requests. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas (HPA minReplicas). |
| `max_instance_count` | 4 | `10` | Maximum pod replicas (HPA maxReplicas). |
| `container_port` | 4 | `8080` | NocoDB's native HTTP port. |
| `container_protocol` | 4 | `'http1'` | HTTP protocol version. |
| `timeout_seconds` | 4 | `300` | Load balancer backend timeout. |
| `container_build_config` | 4 | `{ enabled=true, dockerfile_path="Dockerfile" }` | Build configuration for Cloud Build. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA for automatic resource adjustment. |
| `enable_cloudsql_volume` | — | `true` | Cloud SQL Auth Proxy sidecar (NocoDB GKE uses this for Cloud SQL access). |

### B. Database (Cloud SQL)

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. `POSTGRES_15`, `MYSQL_8_0`, or `NONE`. |
| `application_database_name` | 12 | `'nocodb'` | Database name. Do not change after initial deployment. |
| `application_database_user` | 12 | `'nocodb'` | Database application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `sql_instance_name` | 12 | `""` | Existing Cloud SQL instance. Leave empty for auto-discovery. |
| `db_password_env_var_name` | 12 | `'NC_DB_PASSWORD'` | Additional env var name for DB password. |
| `db_host_env_var_name` | 12 | `'NC_DB_HOST'` | Additional env var name for DB host. |
| `db_user_env_var_name` | 12 | `'NC_DB_USER'` | Additional env var name for DB user. |
| `db_name_env_var_name` | 12 | `'NC_DB_NAME'` | Additional env var name for DB name. |
| `db_port_env_var_name` | 12 | `'NC_DB_PORT'` | Additional env var name for DB port. |
| `service_url_env_var_name` | 12 | `'NC_PUBLIC_URL'` | Additional env var name for service URL. |

### C. Storage

`NocoDB_Common` auto-provisions a GCS uploads bucket. The bucket name and base URL are injected as `GCS_BUCKET_NAME` and `GCS_BASE_URL`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path for NFS mount. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |

### D. GKE Backend Configuration

| Variable | Group | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | — | `""` | GKE cluster name. Leave empty to auto-discover. |
| `namespace_name` | — | `""` | Kubernetes namespace. Leave empty to auto-generate. |
| `workload_type` | — | `null` | `'Deployment'` or `'StatefulSet'`. Defaults to `Deployment` for NocoDB. |
| `service_type` | — | `'ClusterIP'` | Kubernetes Service type. |

### E. Observability

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/v1/health", initial_delay_seconds=30, failure_threshold=30 }` | Startup probe. |
| `health_check_config` | 14 | `{ path="/api/v1/health", initial_delay_seconds=30, failure_threshold=3 }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v1/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

---

## 4. Integrations

### A. Redis

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis for NocoDB caching. |
| `redis_host` | 21 | `null` | Redis hostname/IP. Required when `enable_redis = true`. |
| `redis_port` | 21 | `'6379'` | Redis TCP port. |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

### B. CI/CD

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `service_url` | URL of the NocoDB deployment. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL instance. |
| `database_name` | Name of the application database. |
| `database_password_secret` | Secret Manager secret name for the database password. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `NC_AUTH_JWT_SECRET` (via Secret Manager) | Auto-generated 32-char random string | **Critical** | Changing or rotating this value after the first deployment immediately invalidates all existing user sessions and API tokens. All users are forcibly logged out. Treat as immutable after first deploy. |
| `GCS_BUCKET_NAME` | Auto-set from module output | **High** | Do not override. An incorrect bucket name causes all NocoDB file attachments to fail silently. |
| `application_database_name` | `"nocodb"` | **High** | Immutable after first apply. Changing orphans the NocoDB application schema. |
| `application_database_user` | `"nocodb"` | **High** | Immutable after first apply. Renaming requires manual Cloud SQL intervention. |
| `container_resources.memory_limit` | `"1Gi"` | **High** | Under 512Mi the NocoDB Node.js process is OOM-killed on startup. On GKE Autopilot, `mem_request` must also be set appropriately to avoid eviction. Minimum `"1Gi"`. |
| `container_resources.mem_request` | `null` (defaults to limit) | **Medium** | On GKE Autopilot, setting `mem_request` far below `memory_limit` leads to burstable scheduling and possible eviction under memory pressure. |
| `enable_cloudsql_volume` | `true` | **Critical** | Required for the Cloud SQL Auth Proxy sidecar. Disabling with a PostgreSQL backend causes all DB connections to fail. |
| `enable_redis` | `false` | **Medium** | Without Redis, NocoDB cannot share session/cache state across multiple pods. Required when `max_instance_count > 1`. Enabling without a valid `redis_host` raises a validation error at plan time. |
| `redis_host` | `null` | **High** | Required when `enable_redis = true`. An empty host causes all Redis connections to fail on pod startup. |
| `min_instance_count` | `1` | **High** | Scale-to-zero terminates background automation workers. Webhook callbacks fired during a cold-start window will time out. |
| `max_instance_count` | `10` | **Medium** | Running multiple pods without Redis causes session invalidation when requests are load-balanced to different pods. Enable Redis before increasing above `1`. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **High** | GKE-specific: must use binary suffixes (`Gi`, `Mi`). A bare integer (e.g., `"4"`) is treated as bytes by Kubernetes and blocks all pod scheduling. |
| `enable_iap` | `false` | **High** | Without IAP the NocoDB interface is reachable from the load-balancer IP. Enable IAP or configure Kubernetes network policies for internal workspaces. |
| `pdb_min_available` | `"1"` | **Medium** | Setting to `"0"` allows all pods to be evicted during node upgrades, causing a full NocoDB outage. |
| `application_version` | `"latest"` | **Medium** | Pinning to a specific version prevents uncontrolled upgrades. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | Disabling automated backups leaves all table data, views, and automations unprotected. |
| `stateful_pvc_enabled` | `false` | **Low** | NocoDB does not require persistent volumes — state is in PostgreSQL and GCS. Enabling adds unnecessary StatefulSet complexity. |
