# Directus_Common Shared Configuration Module

The `Directus_Common` module defines the Directus headless CMS and Backend-as-a-Service (BaaS) platform configuration for the RAD Modules ecosystem. Unlike a purely configuration-only module, it **also creates GCP resources** — specifically the Secret Manager secrets required by the Directus runtime. Its outputs are consumed by platform-specific wrapper modules (`Directus_CloudRun` and `Directus_GKE`).

## 1. Overview

**Purpose**: To centralize all Directus-specific configuration (custom container image build, database setup, environment variables, resource limits, health probes, storage bucket, and application secrets) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Directus_CloudRun  ──┐
└── Directus_GKE       ──┤── instantiate Directus_Common
                         ↓
            Directus_Common (this module)
            Creates: Secret Manager secrets
            Produces: config, storage_buckets, secret_ids, secret_values, path
                         ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                         ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key difference from Cyclos_Common**: This module provisions real GCP resources (Secret Manager secrets with generated credentials) and performs a custom Docker image build, rather than referencing a prebuilt public image.

---

## 2. GCP Resources Created

`Directus_Common` provisions the following resources directly:

### Secret Manager Secrets

| Secret ID suffix | Content | Description |
|-----------------|---------|-------------|
| `-key` | 32-char random alphanumeric (no special chars) | Directus `KEY` — used for encrypting data at rest |
| `-secret` | 32-char random alphanumeric (no special chars) | Directus `SECRET` — used for signing JWTs |
| `-admin-password` | 16-char random with `_%@` special chars | Initial admin account password |
| `-redis` _(conditional)_ | Full Redis connection URL (e.g. `redis://:pass@host:6379`) | Redis connection string built from `redis_host`, `redis_port`, and `redis_auth`; created only when `enable_redis = true`. When `redis_host` is empty the URL uses `$(NFS_SERVER_IP)` as a placeholder expanded by `docker-entrypoint.sh` at runtime. |

Secret IDs are prefixed with `resource_prefix` when provided, or constructed as `app<name><tenant><deployment_id>` otherwise.

A `time_sleep` of 30 seconds is added after all secret versions are written to ensure Secret Manager propagation before dependent resources attempt to read them.

---

## 3. Outputs

### `config`
A comprehensive application configuration object passed to the platform module via `application_config`. Key fields:

| Field | Value / Description |
|-------|---------------------|
| `app_name` | `"directus"` |
| `application_version` | Directus version tag (e.g., `"11.1.0"`) |
| `container_image` | `"directus/directus"` (base public image) |
| `image_source` | `"custom"` — a custom Docker image is built (see §7) |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "directus"` (relative to `scripts_dir`), `build_args = { DIRECTUS_VERSION = <version> }` |
| `container_port` | `8055` |
| `database_type` | `"POSTGRES"` |
| `db_name` | Database name (default: `"directus"`) |
| `db_user` | Database user (default: `"directus"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `enable_nfs` | Whether to mount an NFS volume (default: `true`) |
| `nfs_mount_path` | NFS mount path (default: `"/mnt/nfs"`) |
| `gcs_volumes` | Optional list of GCS Fuse volume mounts |
| `container_resources` | CPU/memory limits and requests |
| `min_instance_count` | Minimum running instances (default: `0` — scale-to-zero) |
| `max_instance_count` | Maximum running instances (default: `10`) |
| `environment_variables` | Merged map — see §4 |
| `enable_postgres_extensions` | `false` by default (Directus does not require extensions as a prerequisite) |
| `postgres_extensions` | Empty by default; override if needed |
| `initialization_jobs` | Default `db-init` job or custom override — see §6 |
| `startup_probe` | HTTP `GET /server/ping`, 30s initial delay, 5s timeout, 10s period, 30 failure threshold |
| `liveness_probe` | HTTP `GET /server/ping`, 15s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `storage_buckets`
A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|-------|-------|
| `name` | `<project_id>-<tenant_deployment_id>-directus-uploads-<deployment_id>` |
| `name_suffix` | `"uploads"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` (inherits project-level policy) |

### `secret_ids`
A map of Directus secret environment variable names to their Secret Manager secret IDs. Includes a `depends_on` on the 30-second propagation wait. Passed to the platform module as `module_secret_env_vars`.

```hcl
{
  KEY            = "<prefix>-key"
  SECRET         = "<prefix>-secret"
  ADMIN_PASSWORD = "<prefix>-admin-password"
  REDIS          = "<prefix>-redis"  # only when enable_redis = true
}
```

### `secret_values`
A **sensitive** map of the same secrets but with their raw generated values. Used by `App_GKE` to bypass Secret Manager read-after-write consistency issues during initial apply.

### `path`
The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory.

---

## 4. Environment Variables

The module sets the following environment variables by default:

| Variable | Value | Purpose |
|----------|-------|---------|
| `DB_CLIENT` | `"pg"` | Directus PostgreSQL driver |
| `DB_USER` | from `db_user` variable | Database application user |
| `DB_SSL` | `"false"` (with Auth Proxy) / `'{"rejectUnauthorized":false}'` (TCP) | SSL mode; disabled when using the Auth Proxy sidecar, set to skip CA verification for private IP TCP |
| `STORAGE_LOCATIONS` | `"gcs"` | Enables GCS as the file storage backend |
| `STORAGE_GCS_DRIVER` | `"gcs"` | GCS driver identifier |
| `STORAGE_GCS_BUCKET` | `<project_id>-<tenant>-directus-uploads-<deployment_id>` | Uploads bucket name |
| `BOOTSTRAP` | `"true"` | Triggers `directus bootstrap` on first startup |
| `AUTO_MIGRATE` | `"true"` | Runs `directus database migrate:latest` on every startup |
| `ADMIN_EMAIL` | `"admin@example.com"` | Initial admin account email |

**When `enable_redis = true`**, two additional variables are set:

| Variable | Value | Purpose |
|----------|-------|---------|
| `CACHE_ENABLED` | `"true"` | Enables Directus response caching |
| `CACHE_STORE` | `"redis"` | Uses Redis as the cache backend |

The `REDIS` connection URL is injected as a secret (not a plain env var) via `secret_ids`. The URL format is:
- With auth: `redis://:<password>@<host>:<port>`
- Without auth: `redis://<host>:<port>`
- When using NFS-hosted Redis (host resolved at runtime): `$(NFS_SERVER_IP)` is used as a placeholder, expanded by `docker-entrypoint.sh` at startup.

Custom environment variables passed via `environment_variables` are merged last and override all defaults.

---

## 5. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | `string` | required | GCP project ID |
| `resource_prefix` | `string` | `""` | Prefix for resource naming |
| `labels` | `map(string)` | `{}` | Labels applied to all resources |
| `deployment_id` | `string` | `""` | Unique deployment identifier |
| `deployment_id_suffix` | `string` | `""` | Random suffix used in resource name calculations |
| `tenant_deployment_id` | `string` | `"demo"` | Tenant/environment identifier |
| `deployment_region` | `string` | `"us-central1"` | Primary GCP region |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"directus"` | Application name |
| `application_version` | `string` | `"11.1.0"` | Directus Docker image tag |
| `description` | `string` | `"Directus - Open Source Headless CMS..."` | Module description |
| `container_port` | `number` | `8055` | Port the container listens on |
| `database_type` | `string` | `"POSTGRES"` | Database type |
| `db_name` | `string` | `"directus"` | PostgreSQL database name |
| `db_user` | `string` | `"directus"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit |
| `memory_limit` | `string` | `"512Mi"` | Container memory limit |
| `min_instance_count` | `number` | `0` | Minimum instances (0 = scale-to-zero) |
| `max_instance_count` | `number` | `10` | Maximum instances |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables merged over defaults |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs; empty triggers default `db-init` job |
| `enable_image_mirroring` | `bool` | `true` | Enable image mirroring to Artifact Registry |
| `enable_postgres_extensions` | `bool` | `false` | Whether to create PostgreSQL extensions as a prerequisite |
| `postgres_extensions` | `list(string)` | `[]` | PostgreSQL extensions to create |
| `startup_probe` | `object` | see above | Startup health probe |
| `liveness_probe` | `object` | see above | Liveness health probe |

### Storage & Volumes

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `enable_nfs` | `bool` | `true` | Mount an NFS (Cloud Filestore) volume |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | NFS mount path inside the container |
| `gcs_volumes` | `list(object)` | `[]` | Additional GCS Fuse volume mounts (name, bucket, mount_path, readonly, mount_options) |

### Redis

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_redis` | `bool` | `false` | Enable Redis caching |
| `redis_host` | `string` | `""` | Redis host; if empty, uses `$(NFS_SERVER_IP)` at runtime |
| `redis_port` | `string` | `"6379"` | Redis port |
| `redis_auth` | `string` | `""` | Redis authentication password (sensitive) |

---

## 6. Initialization Jobs

By default (when `initialization_jobs = []`), the module defines a single `db-init` job:

| Field | Value |
|-------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/directus/db-init.sh` |
| Secret | `ROOT_PASSWORD` (PostgreSQL superuser password) |
| CPU / Memory | `1000m` / `512Mi` |
| Timeout | 600s, max 3 retries |
| `execute_on_apply` | `true` (runs automatically on `terraform apply`) |

The `db-init.sh` script:
1. Detects Cloud SQL Auth Proxy usage: if `DB_SSL = "false"` and `DB_HOST` is not a Unix socket, forces `DB_HOST=127.0.0.1` to route through the proxy sidecar.
2. Polls the database until it is available using `psql`.
3. Creates (or updates) the Directus database role with `CREATEDB` privileges.
4. Creates the Directus database if it does not exist, or updates the owner if it does.
5. Grants full privileges on the database and public schema to the application user.
6. Creates `uuid-ossp` and `postgis` extensions (PostGIS failure is non-fatal — skipped if unavailable).
7. Signals the Cloud SQL Proxy to shut down via `POST http://localhost:9091/quitquitquit`.

---

## 7. Scripts and Container Image

All supporting files are in `scripts/directus/`.

### `Dockerfile`
Builds a custom image on top of `directus/directus:<version>`:
*   Installs `curl`, `bash`, and `postgresql-client` (Alpine packages) as root.
*   Installs `corepack` globally and enables `pnpm`.
*   Ensures `/directus` and `/directus/extensions` are owned by the `node` user.
*   Copies `docker-entrypoint.sh` into `/usr/local/bin/`.
*   Switches to the `node` user and installs `@directus/storage-driver-gcs` at the matching version using `pnpm` — avoids pnpm store conflicts by running as the correct user.
*   Sets `NODE_ENV=production`, `LOG_LEVEL=info`, `LOG_STYLE=json`, `DB_CLIENT=pg`.
*   Exposes port `8055`; uses `docker-entrypoint.sh` as the entrypoint and `node cli.js start` as the default command.

### `docker-entrypoint.sh`
The container entrypoint. Runs before Directus starts:
1. Maps `DB_NAME` → `DB_DATABASE` (the platform injects `DB_NAME`; Directus expects `DB_DATABASE`).
2. Handles Cloud SQL socket detection: if `DB_HOST` is a Unix socket path, symlinks it to `/tmp/.s.PGSQL.5432` and resets `DB_HOST=/tmp` for `pg` driver compatibility.
3. Forces `DB_HOST=127.0.0.1` when `DB_SSL=false` and host is not a socket (routes through Auth Proxy for TCP connections).
4. Expands `$(NFS_SERVER_IP)` placeholder in the `REDIS` environment variable to the runtime NFS server IP.
5. Verifies the Cloud Run environment (`K_SERVICE`, `K_REVISION`, `PORT`).
6. Waits for the database to be ready using `pg_isready` (up to 60 attempts, 2s apart).
7. Validates GCS storage configuration (fails if `STORAGE_GCS_BUCKET` is unset).
8. Runs `npx directus bootstrap` when `BOOTSTRAP=true` (initializes schema on a fresh database; safe to re-run).
9. Runs `npx directus database migrate:latest` when `AUTO_MIGRATE=true` (applies any pending schema migrations; exits with error on failure).
10. Starts Directus by executing the CMD passed to the entrypoint (`node cli.js start`).

### `directus-bootstrap.sh`
A lighter-weight bootstrap script (used by the `directus-bootstrap` initialization job pattern):
1. Maps `DB_NAME` → `DB_DATABASE`.
2. Forces `DB_HOST=127.0.0.1` for non-SSL proxy connections.
3. Waits for database availability using `pg_isready` (up to 60 attempts).
4. Runs `npx directus bootstrap`.
5. Signals Cloud SQL Proxy shutdown via `/quitquitquit`.

---

## 8. Platform-Specific Differences

| Aspect | Directus_CloudRun | Directus_GKE |
|--------|------------------|--------------|
| `enable_cloudsql_volume` | `false` by default (TCP to private IP) | `true` by default (Auth Proxy sidecar via socket) |
| `DB_SSL` | `'{"rejectUnauthorized":false}'` (private IP TCP) | `"false"` (Auth Proxy handles TLS) |
| `DB_HOST` | Private IP from Cloud SQL | Socket path → remapped to `127.0.0.1` by entrypoint |
| `secret_ids` vs `secret_values` | Uses `secret_ids` (Secret Manager references) | Uses `secret_values` (raw values to avoid read-after-write issues) |
| NFS | Optional (default enabled) | Optional (default enabled) |
| Redis | Supported (NFS-hosted or external) | Supported (NFS-hosted or external) |
| Scale-to-zero | Supported (min instances = 0) | Not applicable (K8s manages replicas) |

---

## 9. Implementation Pattern

```hcl
# Example: how Directus_CloudRun instantiates Directus_Common

module "directus_app" {
  source = "../Directus_Common"

  deployment_id        = local.random_id
  deployment_id_suffix = local.random_id
  resource_prefix      = local.resource_prefix
  labels               = var.resource_labels
  project_id           = var.project_id
  tenant_deployment_id = var.tenant_deployment_id
  application_name     = var.application_name
  application_version  = var.application_version
  description          = var.description
  container_port       = var.container_port

  db_name = var.db_name
  db_user = var.db_user

  enable_image_mirroring = var.enable_image_mirroring
  enable_cloudsql_volume = var.enable_cloudsql_volume

  enable_nfs     = var.enable_nfs
  nfs_mount_path = var.nfs_mount_path
  gcs_volumes    = var.gcs_volumes

  cpu_limit    = var.cpu_limit
  memory_limit = var.memory_limit

  min_instance_count = var.min_instance_count
  max_instance_count = var.max_instance_count

  environment_variables = var.environment_variables
  initialization_jobs   = var.initialization_jobs

  startup_probe  = var.startup_probe
  liveness_probe = var.liveness_probe

  enable_redis = var.enable_redis
  redis_host   = var.redis_host
  redis_port   = var.redis_port
  redis_auth   = var.redis_auth
}

# config and secrets are passed to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules  # wraps module.directus_app.config
  module_storage_buckets = module.directus_app.storage_buckets
  module_secret_env_vars = module.directus_app.secret_ids
  module_env_vars        = {}
  scripts_dir            = abspath("${module.directus_app.path}/scripts")
  # ... other inputs
}
```
