# N8N_Common Shared Configuration Module

The `N8N_Common` module defines the n8n workflow automation platform (without AI components) for the RAD Modules ecosystem. It **creates GCP resources** (two Secret Manager secrets) and produces a `config` output consumed by platform-specific wrapper modules (`N8N_CloudRun` and `N8N_GKE`).

## 1. Overview

**Purpose**: To centralize all n8n-specific configuration — PostgreSQL backend, Redis queue support, GCS data storage, SMTP credentials, and an encryption key secret — in a single module shared by Cloud Run and GKE deployments. This is the standard n8n module; for deployments that also require Qdrant and Ollama AI sidecars, use `N8N_AI_Common` instead.

**Architecture**:

```
Layer 3: Application Wrappers
├── N8N_CloudRun  ──┐
└── N8N_GKE       ──┤── instantiate N8N_Common
                    ↓
        N8N_Common (this module)
        Creates: 2 Secret Manager secrets (SMTP password, encryption key)
        Produces: config, storage_buckets, secret_ids, secret_values,
                  resource_prefix, path
                    ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                    ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key differences from `N8N_AI_Common`**:
- No AI sidecar services — `config.additional_services` is not present.
- Redis is **disabled by default** (`enable_redis = false`).
- Health probes target **`/healthz`** (not `/`), and the startup probe uses a shorter 10s initial delay with a higher 30-failure threshold.
- Uses `resource_prefix` (not `wrapper_prefix`) for naming, and exposes it as an output.
- Secrets are output together as a `secret_ids` map rather than as individual outputs.
- The SMTP secret is seeded with a dummy placeholder value; the real SMTP password is expected to be provided by the caller or set post-deployment.
- `DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED` is deliberately **not set** — see §4 for the reason.
- Default resources: `1000m` CPU / `2Gi` memory (lighter than the AI variant).

---

## 2. GCP Resources Created

| Secret ID | Content | Purpose |
|-----------|---------|---------|
| `<resource_prefix>-smtp-password` | 16-char random alphanumeric (dummy) | Placeholder for n8n outbound SMTP password — replaced by the caller with the real credential |
| `<resource_prefix>-encryption-key` | 32-char random (with special chars) | n8n `N8N_ENCRYPTION_KEY` — encrypts stored workflow credentials in the database |

A 30-second `time_sleep` is applied after both secret versions are written before the `secret_ids` output is resolved.

> **Note on SMTP secret**: The SMTP password secret is seeded with a generated dummy value at provisioning time. Wrapper modules are expected to either override this value post-deployment or wire in the real SMTP credential via a separate mechanism. The secret ID is still included in `secret_ids` so the container receives the secret reference — callers must update the secret version with the real password before n8n sends email.

---

## 3. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | from `application_name` (default: `"n8n"`) |
| `display_name` | from `display_name` (default: `"n8n Workflow Automation"`) |
| `container_image` | `"n8nio/n8n"` (public base image) |
| `image_source` | `"custom"` |
| `enable_image_mirroring` | `true` (configurable variable — default: `true`) |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, no build args |
| `container_port` | `5678` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | from `db_name` variable (default: `"n8n"`) |
| `db_user` | from `db_user` variable (default: `"n8n"`) |
| `enable_cloudsql_volume` | Whether to mount Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Passed through from `var.gcs_volumes` (empty by default) |
| `container_resources` | CPU/memory limits; no requests set |
| `min_instance_count` | `0` (scale-to-zero) |
| `max_instance_count` | `3` |
| `environment_variables` | Merged map — see §4 |
| `enable_postgres_extensions` | `false` |
| `postgres_extensions` | `[]` |
| `initialization_jobs` | Default `db-init` job or custom override — see §6 |
| `startup_probe` | HTTP `GET /healthz`, 10s initial delay, 5s timeout, 10s period, 30 failure threshold |
| `liveness_probe` | HTTP `GET /healthz`, 15s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `storage_buckets`
One GCS bucket for n8n workflow data:

| Field | Value |
|-------|-------|
| `name` | `<resource_prefix>-storage` (explicit, not just a suffix) |
| `name_suffix` | `"n8n-data"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` |

### `secret_ids`
A map of n8n secret environment variable names to their Secret Manager secret IDs, with `depends_on` on the 30-second propagation wait:

```hcl
{
  N8N_SMTP_PASS      = "<resource_prefix>-smtp-password"
  N8N_ENCRYPTION_KEY = "<resource_prefix>-encryption-key"
}
```

### `secret_values`
A **sensitive** map of raw generated values for GKE deployments that bypass Secret Manager read-after-write:

```hcl
{
  N8N_SMTP_PASS      = "<16-char dummy password>"
  N8N_ENCRYPTION_KEY = "<32-char encryption key>"
}
```

### `resource_prefix`
Exposes `var.resource_prefix` directly. Wrapper modules use this to reference the prefix when constructing other resource names (e.g., IAM bindings, bucket references) without having to pass it through separately.

### `path`
Absolute path to the module directory, used by wrapper modules to locate `scripts/`.

---

## 4. Environment Variables

The module merges a fixed set of n8n configuration variables with caller-provided `environment_variables` (caller variables take precedence):

| Variable | Value | Purpose |
|----------|-------|---------|
| `N8N_PORT` | `"5678"` | n8n listening port |
| `N8N_PROTOCOL` | `"https"` | Public protocol |
| `N8N_DIAGNOSTICS_ENABLED` | `"true"` | Usage telemetry |
| `N8N_METRICS` | `"true"` | Prometheus metrics endpoint |
| `N8N_SECURE_COOKIE` | `"false"` | Disable secure cookie (Cloud Run terminates TLS) |
| `DB_TYPE` | `"postgresdb"` | n8n database backend |
| `N8N_DEFAULT_BINARY_DATA_MODE` | `"filesystem"` | Store binary data on disk (GCS Fuse volume) |
| `WEBHOOK_URL` | `var.service_url` | Public webhook base URL |
| `N8N_EDITOR_BASE_URL` | `var.service_url` | Editor base URL |
| `ENABLE_REDIS` | `"true"` / `"false"` | Redis queue mode toggle |
| `QUEUE_BULL_REDIS_HOST` | `var.redis_host` or `"$(NFS_SERVER_IP)"` | Redis host; placeholder expanded at runtime when no explicit host is set |
| `QUEUE_BULL_REDIS_PORT` | `var.redis_port` (when enabled) | Redis port |
| `QUEUE_BULL_REDIS_PASSWORD` | `var.redis_auth` (when set) | Redis auth |

**`DB_POSTGRESDB_*` variables are intentionally absent** from the Terraform-set environment. The `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` platform variables are translated to `DB_POSTGRESDB_*` at runtime by `entrypoint.sh`. This separation avoids a specific Cloud SQL Auth Proxy incompatibility:

> Setting `DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false` would instruct n8n's PostgreSQL driver to attempt an SSL handshake with relaxed certificate verification. However, the Cloud SQL Auth Proxy does not support client-side SSL on its local interface — it handles encryption internally — causing the error: *"The server does not support SSL connections"*. By leaving `DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED` unset, SSL is disabled in the pg driver (its default), which is correct when using the Auth Proxy.

---

## 5. Database Naming

The module computes two local values from `resource_prefix` that are available for use within the module:

```hcl
database_name_full = replace(var.resource_prefix, "-", "_")
database_user_full = replace(var.resource_prefix, "-", "_")
```

These convert the hyphen-separated resource prefix into an underscore-separated PostgreSQL identifier (hyphens are not valid in unquoted PostgreSQL names). However, the actual `db_name` and `db_user` used in the `config` output come from `var.db_name` and `var.db_user` directly — these locals are available for wrapper module reference but are not wired into the config by default.

---

## 6. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|-------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets required | `ROOT_PASSWORD` (PostgreSQL superuser), `DB_PASSWORD` (app user) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |

`db-init.sh` behavior:
1. Detects Cloud SQL Auth Proxy socket: if `/cloudsql` contains a socket file, symlinks it to `/tmp/.s.PGSQL.5432` and sets `DB_HOST=/tmp`.
2. Resolves the target host from `DB_IP`, then `DB_HOST`, then `DB_POSTGRESDB_HOST`.
3. Polls PostgreSQL using `pg_isready` until available.
4. Creates (or updates the password of) the n8n application user.
5. Grants the application user role to `postgres` (to allow ownership assignment).
6. Creates the n8n database owned by the application user if absent; otherwise reassigns ownership.
7. Grants full privileges on the database and public schema.
8. Signals Cloud SQL Proxy shutdown via `wget POST http://127.0.0.1:9091/quitquitquit` (up to 10 retries, 1s apart).

---

## 7. Scripts and Container Image

### `Dockerfile`
Identical in structure to `N8N_AI_Common`'s Dockerfile, with one difference in the ENTRYPOINT:

- Base image: `node:22-alpine3.22`
- Installs: `python3`, `py3-pip`, `git`, `bash`, `curl`, `jq`, `tini`, `su-exec`
- Installs n8n globally at the pinned version: `npm install -g n8n@2.4.7`
- Creates `node` group (GID 1000) and user (UID 1000)
- Sets `N8N_USER_FOLDER=/home/node/.n8n` and `N8N_PORT=5678`
- **ENTRYPOINT**: `["tini", "--", "/entrypoint.sh"]` — tini is explicit here as PID 1 (in `N8N_AI_Common` tini is called implicitly via `exec`)

### `entrypoint.sh`
Identical to `N8N_AI_Common`'s entrypoint. Translates platform variables to n8n-native names before starting n8n:

1. **Socket detection**: If `DB_HOST` starts with `/`, symlinks to `/tmp/.s.PGSQL.5432` and resets `DB_HOST=/tmp`.
2. **DB variable mapping** (only when the n8n-native variable is not already set):

| Platform variable | n8n variable |
|-------------------|-------------|
| `DB_HOST` | `DB_POSTGRESDB_HOST` |
| `DB_NAME` | `DB_POSTGRESDB_DATABASE` |
| `DB_USER` | `DB_POSTGRESDB_USER` |
| `DB_PASSWORD` | `DB_POSTGRESDB_PASSWORD` |

3. **Redis host resolution**: Expands `$(NFS_SERVER_IP)` in `QUEUE_BULL_REDIS_HOST` to the runtime NFS server IP.
4. `exec n8n "$@"` — starts n8n as the final process under tini.

---

## 8. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | `string` | **required** | GCP project ID |
| `resource_prefix` | `string` | **required** | Prefix for all resource IDs and secret names |
| `labels` | `map(string)` | `{}` | Labels applied to secrets |
| `tenant_deployment_id` | `string` | `"demo"` | Tenant identifier (1–20 lowercase alphanumeric chars) |
| `deployment_id` | `string` | `""` | Unique deployment ID suffix |
| `deployment_region` | `string` | `"us-central1"` | Region for the storage bucket |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"n8n"` | Application name |
| `application_version` | `string` | `"latest"` | n8n version tag |
| `display_name` | `string` | `"n8n Workflow Automation"` | Display name |
| `description` | `string` | `"n8n is an extendable workflow automation tool"` | Description |
| `db_name` | `string` | `"n8n"` | PostgreSQL database name |
| `db_user` | `string` | `"n8n"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit |
| `min_instance_count` | `number` | `0` | Minimum instances (scale-to-zero) |
| `max_instance_count` | `number` | `3` | Maximum instances |
| `environment_variables` | `map(string)` | `{}` | Additional env vars merged over module defaults |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs; empty triggers default `db-init` |
| `startup_probe` | `object` | `/healthz`, 10s delay, 30 threshold | Startup health probe |
| `liveness_probe` | `object` | `/healthz`, 15s delay, 3 threshold | Liveness health probe |
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `enable_image_mirroring` | `bool` | `true` | Mirror the container image to the project's Artifact Registry before deployment |

### External Integration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `service_url` | `string` | `""` | Public URL set as `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` |
| `db_host` | `string` | `null` | Explicit DB host override; defaults to `/cloudsql` when Auth Proxy is enabled |
| `enable_redis` | `bool` | `false` | Enable Redis queue-mode operation |
| `redis_host` | `string` | `null` | Redis host; if null/empty, uses `$(NFS_SERVER_IP)` placeholder |
| `redis_port` | `string` | `"6379"` | Redis port |
| `redis_auth` | `string` | `""` | Redis auth password (sensitive) |
| `nfs_server_ip` | `string` | `null` | NFS server IP for Redis host resolution (when using NFS-hosted Redis) |

### Storage

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts; no default volume unlike `N8N_AI_Common` |
| `bucket_name` | `string` | `""` | Legacy: GCS bucket name reference (not wired into config) |
| `service_account_email` | `string` | `""` | Legacy: service account email reference |

---

## 9. Platform-Specific Differences

| Aspect | N8N_CloudRun | N8N_GKE |
|--------|--------------|---------|
| `service_url` | Predicted Cloud Run service URL (`https://<prefix>-<project_number>.<region>.run.app`) | Internal ClusterIP URL (`http://<service>.<namespace>.svc.cluster.local`), computed before deployment |
| `enable_cloudsql_volume` | `true` (Auth Proxy sidecar, default) | `true` (Auth Proxy sidecar, default) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path (`/cloudsql`) | Cloud SQL Auth Proxy socket path (`/cloudsql`) when `enable_cloudsql_volume = true` |
| NFS | Enabled by default (`enable_nfs = true`); provides shared persistence | Enabled by default (`enable_nfs = true`) via `enable_nfs` |
| Redis | Optional; `$(NFS_SERVER_IP)` placeholder when enabled | Optional; `$(NFS_SERVER_IP)` placeholder when enabled |
| GCS volumes | Optional via `gcs_volumes` | Optional via `gcs_volumes` |
| Scaling | Serverless, scale-to-zero (`min_instance_count = 0`) | Kubernetes Deployment with configurable replicas |

---

## 10. Implementation Pattern

```hcl
# Example: how N8N_CloudRun instantiates N8N_Common

module "n8n_app" {
  source = "../N8N_Common"

  # Project & Deployment
  project_id           = var.project_id
  resource_prefix      = local.resource_prefix
  labels               = var.resource_labels
  tenant_deployment_id = var.tenant_deployment_id
  deployment_id        = local.random_id
  deployment_region    = local.region

  # Application Details
  application_name    = var.application_name
  application_version = var.application_version
  display_name        = var.display_name
  description         = var.description

  # Database
  db_name = var.db_name
  db_user = var.db_user

  # Container Resources
  cpu_limit          = var.cpu_limit
  memory_limit       = var.memory_limit
  min_instance_count = var.min_instance_count
  max_instance_count = var.max_instance_count

  # Probes
  startup_probe  = var.startup_probe
  liveness_probe = var.liveness_probe

  # Integration
  service_url = local.predicted_service_url

  # Redis (redis_auth is NOT passed here; App_CloudRun handles it directly)
  enable_redis  = var.enable_redis
  redis_host    = var.redis_host
  redis_port    = var.redis_port
  nfs_server_ip = null

  # Environment & Initialization
  environment_variables  = var.environment_variables
  enable_cloudsql_volume = var.enable_cloudsql_volume
  initialization_jobs    = var.initialization_jobs

  # Storage
  gcs_volumes = var.gcs_volumes
}

# config and secrets are passed to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config            = { n8n = merge(module.n8n_app.config, { description = var.description, container_port = var.container_port }) }
  module_storage_buckets        = module.n8n_app.storage_buckets
  module_secret_env_vars        = module.n8n_app.secret_ids
  module_explicit_secret_values = module.n8n_app.secret_values
  scripts_dir                   = abspath("${module.n8n_app.path}/scripts")
  # ... other inputs
}
```
