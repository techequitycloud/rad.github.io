# Activepieces_Common Shared Configuration Module

The `Activepieces_Common` module defines the Activepieces workflow automation platform configuration for the RAD Modules ecosystem. It **creates GCP resources** (two Secret Manager secrets for cryptographic keys) and produces a `config` output consumed by the platform-specific wrapper modules (`Activepieces_CloudRun` and `Activepieces_GKE`).

## 1. Overview

**Purpose**: To provide a complete, cloud-ready Activepieces application template — including a custom container image, database setup, application secrets, and queue configuration — that platform modules can deploy without Activepieces-specific knowledge.

**Architecture**:

```
Layer 3: Application Wrappers
├── Activepieces_CloudRun  ──┐
└── Activepieces_GKE       ──┤── instantiate Activepieces_Common
                              ↓
            Activepieces_Common (this module)
            Creates: Secret Manager secrets (AP_ENCRYPTION_KEY, AP_JWT_SECRET)
            Produces: config, storage_buckets, secret_ids, secret_values, path
                              ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                              ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Builds a custom container image wrapping the public `activepieces/activepieces` upstream image. The `Dockerfile` adds a thin entrypoint script that maps platform-standard `DB_*` variables to the Activepieces-specific `AP_POSTGRES_*` variables.
- Defines **one** default initialization job (`db-init`) that runs automatically when `initialization_jobs = []` is passed.
- Injects Activepieces queue mode configuration: `AP_QUEUE_MODE = "MEMORY"` by default, switching to `"REDIS"` when `enable_redis = true`.
- Auto-configures `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` from the predicted service URL at plan time; the `entrypoint.sh` overrides these at runtime from `CLOUDRUN_SERVICE_URL` when available.

---

## 2. GCP Resources Created

### Secret Manager Secrets

| Secret ID suffix | Content | Description |
|-----------------|---------|-------------|
| `-encryption-key` | 32-character hex string (16 random bytes) | `AP_ENCRYPTION_KEY` — used by Activepieces for encrypting stored credentials and connection data |
| `-jwt-secret` | 32-character random alphanumeric string | `AP_JWT_SECRET` — used for signing JSON Web Tokens (user sessions and API tokens) |

Both secret IDs are prefixed with `resource_prefix`. A 30-second `time_sleep` is added after both secret versions are written to ensure propagation before dependent resources read them.

The `secretmanager.googleapis.com` API is enabled automatically via a `google_project_service` resource.

---

## 3. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | `"activepieces"` |
| `display_name` | Passed from `var.display_name` |
| `description` | Passed from `var.description` |
| `container_image` | `"activepieces/activepieces"` — upstream public image pulled and wrapped by the Dockerfile |
| `application_version` | Version tag (default: `"latest"`) |
| `image_source` | `"custom"` — the bundled `Dockerfile` is built by Cloud Build |
| `enable_image_mirroring` | Passed from `var.enable_image_mirroring` (default: `true`) |
| `container_build_config` | `{ enabled = true, dockerfile_path = "Dockerfile", context_path = ".", build_args = {} }` |
| `container_port` | `8080` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (from `var.db_name`) |
| `db_user` | Database user (from `var.db_user`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (from `var.enable_cloudsql_volume`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Passed from `var.gcs_volumes` |
| `container_resources` | CPU/memory limits from `var.cpu_limit` and `var.memory_limit` |
| `min_instance_count` | Passed from `var.min_instance_count` |
| `max_instance_count` | Passed from `var.max_instance_count` |
| `environment_variables` | Merged Activepieces defaults plus caller's `var.environment_variables` (see §4) |
| `enable_postgres_extensions` | `false` — Activepieces does not require standard extensions; `pgvector` is installed by `db-init.sh` |
| `postgres_extensions` | `[]` |
| `initialization_jobs` | Default `db-init` job or custom override (see §5) |
| `startup_probe` | Passed from `var.startup_probe` |
| `liveness_probe` | Passed from `var.liveness_probe` |

### `storage_buckets`
A list containing a single GCS bucket configuration for provisioning by the platform module:

| Field | Value |
|-------|-------|
| `name_suffix` | `"ap-data"` |
| `name` | `"<resource_prefix>-storage"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` (inherits project-level policy) |

### `secret_ids`
A map of Activepieces secret environment variable names to their Secret Manager secret IDs. Includes a `depends_on` on the 30-second propagation wait.

```hcl
{
  AP_ENCRYPTION_KEY = "<prefix>-encryption-key"
  AP_JWT_SECRET     = "<prefix>-jwt-secret"
}
```

### `secret_values`
A **sensitive** map of the same secrets with raw generated values. Used by `App_GKE` to bypass Secret Manager read-after-write consistency issues during the initial apply.

```hcl
{
  AP_ENCRYPTION_KEY = "<32-char hex>"
  AP_JWT_SECRET     = "<32-char random string>"
}
```

### `path`
The absolute path to the `Activepieces_Common` module directory (`path.module`). Wrapper modules (`Activepieces_CloudRun`, `Activepieces_GKE`) use this output to set `scripts_dir` as `abspath("${module.activepieces_app.path}/scripts")`.

### `resource_prefix`
The resource naming prefix passed into the module. Exposed for downstream use by callers that need it for additional resource naming.

---

## 4. Environment Variables Injected by Activepieces_Common

`Activepieces_Common` merges the following default environment variables into the `config.environment_variables` field. User-supplied `var.environment_variables` are merged last and take precedence over any of these defaults.

| Variable | Default / Logic | Description |
|----------|-----------------|-------------|
| `AP_DB_TYPE` | `"POSTGRES"` | Tells Activepieces to use PostgreSQL |
| `AP_PORT` | `"8080"` | HTTP port the Activepieces server listens on |
| `AP_POSTGRES_PORT` | `"5432"` | PostgreSQL TCP port |
| `AP_FRONTEND_URL` | `var.service_url` | Public URL for the Activepieces UI and OAuth redirects. Overridden at runtime by `entrypoint.sh` from `CLOUDRUN_SERVICE_URL` |
| `AP_WEBHOOK_URL_PREFIX` | `var.service_url` | Base URL prefix for webhook endpoints |
| `AP_ENVIRONMENT` | `"production"` | Activepieces run mode |
| `AP_TELEMETRY_ENABLED` | `"false"` | Disables telemetry reporting to the Activepieces cloud |
| `AP_EXECUTION_MODE` | `"UNSANDBOXED"` | Disables sandboxing (required for Cloud Run / GKE) |
| `AP_SANDBOX_TYPE` | `"NO_SANDBOX"` | No container sandbox for piece execution |
| `AP_SIGN_UP_ENABLED` | `"true"` | Allows new user registration |
| `ENABLE_REDIS` | `tostring(var.enable_redis)` | Passed to `entrypoint.sh` to trigger Redis URL construction |
| `QUEUE_BULL_REDIS_HOST` | Redis host or `$(NFS_SERVER_IP)` placeholder | Only set when `enable_redis = true`. Falls back to the `$(NFS_SERVER_IP)` runtime placeholder when `redis_host` is empty |
| `QUEUE_BULL_REDIS_PORT` | `var.redis_port` | Only set when `enable_redis = true` |
| `QUEUE_BULL_REDIS_PASSWORD` | `var.redis_auth` | Only set when `enable_redis = true` and `redis_auth` is non-empty |
| `AP_QUEUE_MODE` | `"REDIS"` or `"MEMORY"` | `"REDIS"` when `enable_redis = true`; `"MEMORY"` otherwise |

> **Note:** `AP_POSTGRES_HOST`, `AP_POSTGRES_DATABASE`, `AP_POSTGRES_USERNAME`, `AP_POSTGRES_PASSWORD`, and `AP_REDIS_URL` are **not** set as static environment variables. They are resolved at runtime by `entrypoint.sh` from the platform-injected `DB_*` variables and the Redis configuration above.

---

## 5. Initialization Job

When `initialization_jobs = []` (the default), `Activepieces_Common` substitutes a single default `db-init` job:

| Field | Value |
|-------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` (absolute path resolved at module evaluation) |
| `execute_on_apply` | `true` |
| Timeout | `600s` |
| Max retries | `1` |
| CPU / Memory | `"1000m"` / `"512Mi"` |

When a non-empty `initialization_jobs` list is provided, each job is normalized (type-coerced, optional fields filled with defaults) and passed through verbatim to the platform module.

### `db-init.sh` Behavior

The script runs inside a `postgres:15-alpine` container with platform-injected `DB_*` and `ROOT_PASSWORD` environment variables available:

1. **Cloud SQL socket detection**: If `/cloudsql` exists and contains a socket file, creates a symlink at `/tmp/.s.PGSQL.5432` and sets `DB_HOST=/tmp`, enabling standard `psql` Unix-socket connections.
2. **Target host resolution**: Resolves the active database host from `DB_IP` (if injected by the platform), falling back to `DB_HOST`.
3. **Waits for PostgreSQL** to be reachable using `pg_isready`.
4. **Creates (or updates) the database user** (`DB_USER`) with the password from `DB_PASSWORD`. Uses `ALTER USER` if the role already exists.
5. **Grants `DB_USER` role to `postgres`** to allow setting database ownership.
6. **Creates (or reconfigures) the database** (`DB_NAME`) with `DB_USER` as owner. Uses `ALTER DATABASE` if it already exists.
7. **Grants full privileges** on the database and the public schema to `DB_USER`.
8. **Installs the `pgvector` extension** (`CREATE EXTENSION IF NOT EXISTS vector`) as superuser — required by Activepieces for AI-powered features and vector similarity search.
9. **Signals Cloud SQL Auth Proxy shutdown** via `POST http://127.0.0.1:9091/quitquitquit` (up to 10 attempts with 1-second waits). Safe to run without the proxy — failures are silently ignored.

The script is **idempotent** — re-running it against an already-initialised database is safe.

---

## 6. Scripts and Container Image

All supporting files are in `scripts/`. The entire `scripts/` directory is used as the Docker build context (`context_path = "."`).

### `Dockerfile`

A minimal single-stage image wrapping the upstream `activepieces/activepieces:latest` image:

```dockerfile
FROM activepieces/activepieces:latest
USER root
COPY entrypoint.sh /ap-entrypoint.sh
RUN chmod +x /ap-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/ap-entrypoint.sh"]
```

Unlike Django or Moodle, **no Python dependencies or build steps are added** — the image is the official Activepieces image with only the platform entrypoint wrapper overlaid. This means the custom build step exists solely to inject `entrypoint.sh` and to push the image into the project's Artifact Registry.

### `entrypoint.sh`

The container entrypoint. Runs before the Activepieces Node.js server starts:

1. **Unix socket detection**: If `DB_HOST` starts with `/`, searches for a socket file under that path, symlinks it to `/tmp/.s.PGSQL.5432`, and sets `DB_HOST=/tmp`.
2. **Maps `DB_*` to `AP_POSTGRES_*`**: Sets `AP_POSTGRES_HOST`, `AP_POSTGRES_DATABASE`, `AP_POSTGRES_USERNAME`, and `AP_POSTGRES_PASSWORD` from the corresponding `DB_*` variables if the `AP_POSTGRES_*` variables are not already set.
3. **Constructs `AP_REDIS_URL`**: When `ENABLE_REDIS=true` and `AP_REDIS_URL` is not already set, builds the Redis URL from `QUEUE_BULL_REDIS_HOST` (expanding the `$(NFS_SERVER_IP)` runtime placeholder), `QUEUE_BULL_REDIS_PORT`, and `QUEUE_BULL_REDIS_PASSWORD`.
4. **Updates `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX`**: If `CLOUDRUN_SERVICE_URL` is injected by the platform, overrides both variables with the actual service URL (correcting any stale predicted URL set at Terraform plan time).
5. **Locates the Activepieces entry point**: Searches for `main.js` under `/usr/src/app` and `/app`, excluding `node_modules/` and `engine/` paths, preferring files under `backend/` or `server/` directories. This handles version-to-version relocations of the server entrypoint.
6. **Launches the server** with `exec node <entry>` (replaces the shell process as PID 1).

### `db-init.sh`

Database setup script used by the default `db-init` initialization job. See §5 for full behavior.

---

## 7. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | `string` | required | GCP project ID |
| `resource_prefix` | `string` | required | Prefix for resource naming |
| `labels` | `map(string)` | `{}` | Labels applied to created resources |
| `tenant_deployment_id` | `string` | `"demo"` | Tenant/environment identifier |
| `deployment_id` | `string` | `""` | Random deployment ID suffix |
| `deployment_region` | `string` | `"us-central1"` | Primary GCP region |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"activepieces"` | Application name |
| `application_version` | `string` | `"latest"` | Image version tag |
| `display_name` | `string` | `"Activepieces Workflow Automation"` | Human-readable display name |
| `description` | `string` | `"Activepieces is an open-source workflow automation platform"` | Module description |
| `db_name` | `string` | `"activepieces"` | PostgreSQL database name |
| `db_user` | `string` | `"activepieces"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit |
| `min_instance_count` | `number` | `0` | Minimum instances |
| `max_instance_count` | `number` | `3` | Maximum instances |
| `environment_variables` | `map(string)` | `{}` | Additional env vars merged with Activepieces defaults |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs; empty triggers the default `db-init` job |
| `startup_probe` | object | (structured default) | Startup probe configuration; passed through to `config` |
| `liveness_probe` | object | (structured default) | Liveness probe configuration; passed through to `config` |
| `enable_image_mirroring` | `bool` | `true` | Mirror image to Artifact Registry |

### Storage & Volumes

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts |
| `bucket_name` | `string` | `""` | GCS bucket name (legacy / optional pass-through) |
| `service_account_email` | `string` | `""` | Service account email (legacy / optional) |

### External Integration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `service_url` | `string` | `""` | Public service URL injected into `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` |
| `db_host` | `string` | `null` | Database host (IP or socket path). Used to compute `default_db_host` |
| `enable_redis` | `bool` | `false` | Enable Redis queue mode |
| `redis_host` | `string` | `null` | Redis host; empty defaults to `$(NFS_SERVER_IP)` placeholder |
| `redis_port` | `string` | `"6379"` | Redis port |
| `redis_auth` | `string` | `""` | Redis AUTH password (sensitive) |
| `nfs_server_ip` | `string` | `null` | NFS server IP; passed by the wrapper module (currently set to `null` — the `$(NFS_SERVER_IP)` placeholder is used instead) |

---

## 8. Platform-Specific Differences

| Aspect | Activepieces_CloudRun | Activepieces_GKE |
|--------|-----------------------|------------------|
| `service_url` | Predicted Cloud Run URL: `https://<name>-<project_number>.<region>.run.app` | Internal cluster URL: `http://<name>.<namespace>.svc.cluster.local` |
| `enable_cloudsql_volume` | Defaults to `true` | Defaults to `true` |
| `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX` | Set to the predicted Cloud Run URL at plan time; corrected at runtime by `entrypoint.sh` from `CLOUDRUN_SERVICE_URL` | Set to the internal cluster URL; must be updated to the external domain separately |
| Secret injection | `secret_ids` map referenced by Cloud Run at revision start | `secret_values` injected directly into Kubernetes Secrets (bypasses read-after-write delays) |
| NFS | Disabled by default (`enable_nfs = false`) | Disabled by default (`enable_nfs = false`) |
| Redis fallback host | `$(NFS_SERVER_IP)` placeholder | `$(NFS_SERVER_IP)` placeholder |
| Scaling | Serverless, scale-to-zero capable | Kubernetes Deployment with HPA |

---

## 9. Implementation Pattern

```hcl
# How Activepieces_CloudRun instantiates Activepieces_Common

module "activepieces_app" {
  source = "../Activepieces_Common"

  project_id           = var.project_id
  resource_prefix      = local.resource_prefix
  tenant_deployment_id = var.tenant_deployment_id
  deployment_id        = local.random_id
  deployment_region    = local.region
  labels               = var.resource_labels

  application_name    = var.application_name
  application_version = var.application_version
  display_name        = var.display_name
  description         = var.description

  db_name = var.db_name
  db_user = var.db_user

  cpu_limit          = var.cpu_limit
  memory_limit       = var.memory_limit
  min_instance_count = var.min_instance_count
  max_instance_count = var.max_instance_count

  startup_probe  = var.startup_probe
  liveness_probe = var.liveness_probe

  service_url = local.predicted_service_url

  enable_redis  = var.enable_redis
  redis_host    = var.redis_host
  redis_port    = var.redis_port
  nfs_server_ip = null  # $(NFS_SERVER_IP) placeholder used instead

  environment_variables  = var.environment_variables
  enable_cloudsql_volume = var.enable_cloudsql_volume
  initialization_jobs    = var.initialization_jobs
  gcs_volumes            = var.gcs_volumes
}

locals {
  application_modules    = { activepieces = merge(module.activepieces_app.config, { description = var.description, container_port = var.container_port }) }
  module_env_vars        = {}
  module_secret_env_vars = module.activepieces_app.secret_ids
  module_storage_buckets = module.activepieces_app.storage_buckets
  scripts_dir            = abspath("${module.activepieces_app.path}/scripts")
}
```
