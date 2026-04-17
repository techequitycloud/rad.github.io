# Ghost_Common Shared Configuration Module

The `Ghost_Common` module defines the Ghost publishing platform configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates no GCP resources and produces a `config` output consumed by platform-specific wrapper modules (`Ghost_CloudRun` and `Ghost_GKE`).

## 1. Overview

**Purpose**: To centralize all Ghost-specific configuration (custom container image, MySQL 8.0 database setup, environment variable mapping, health probes, storage bucket, and initialization job) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Ghost_CloudRun  ──┐
└── Ghost_GKE       ──┤── instantiate Ghost_Common
                      ↓
           Ghost_Common (this module)
           Creates: (no GCP resources)
           Produces: config, storage_buckets, path
                      ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                      ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- The only `*_Common` module in the ecosystem that uses **MySQL 8.0** instead of PostgreSQL.
- Creates **no GCP resources** — no secrets, no IAM bindings (compare with Directus_Common and Django_Common which create Secret Manager secrets).
- Defines a **readiness probe** in addition to startup and liveness probes (unique among the `*_Common` modules).
- The `entrypoint.sh` script auto-detects the Cloud Run service URL at runtime via the GCE metadata server and Cloud Run API v2, removing the need to know the URL at Terraform plan time.

---

## 2. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | `"ghost"` |
| `application_version` | Version tag (default: `"6.14.0"`) |
| `container_image` | `"ghost"` (public Docker Hub image used as build base) |
| `image_source` | `"custom"` — a custom wrapper image is built (see §6) |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `false`) — controls whether the image is mirrored to Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { APP_VERSION = <version> }` |
| `container_port` | `2368` |
| `database_type` | `"MYSQL_8_0"` — Ghost 6.x requires MySQL 8.0+ |
| `db_name` | Database name (default: `"ghost"`) |
| `db_user` | Database user (default: `"ghost"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | List of GCS Fuse volume mounts (empty by default) |
| `container_resources` | CPU: `2000m`, Memory: `4Gi` (higher than other modules — Ghost 6.x is resource-intensive) |
| `environment_variables` | Passed through directly from `var.environment_variables` |
| `secret_environment_variables` | `var.secret_environment_variables` (default `{}`) — secret env vars passed to the container; managed externally or via wrapper by default |
| `enable_mysql_plugins` | `false` |
| `mysql_plugins` | `[]` |
| `initialization_jobs` | Default `db-init` job or custom override — see §5 |
| `startup_probe` | HTTP `GET /`, 90s initial delay, 10s timeout, 10s period, 10 failure threshold |
| `liveness_probe` | HTTP `GET /`, 60s initial delay, 5s timeout, 30s period, 3 failure threshold |
| `readiness_probe` | HTTP `GET /`, 30s initial delay, 5s timeout, 10s period, 3 failure threshold |

### `storage_buckets`
A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|-------|-------|
| `name_suffix` | `"ghost-content"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` (inherits project-level policy) |

### `path`
The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"ghost"` | Application name |
| `application_version` | `string` | `"6.14.0"` | Ghost Docker image tag |
| `description` | `string` | `"Initialize Ghost Database with MySQL 8.0 settings"` | Init job description |
| `deployment_id` | `string` | `""` | Unique deployment identifier |
| `db_name` | `string` | `"ghost"` | MySQL database name |
| `db_user` | `string` | `"ghost"` | MySQL application user |
| `cpu_limit` | `string` | `"2000m"` | Container CPU limit |
| `memory_limit` | `string` | `"4Gi"` | Container memory limit |
| `environment_variables` | `map(string)` | `{}` | Environment variables passed directly to the container |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs; empty triggers the default `db-init` job |
| `startup_probe` | `object` | see above | Startup health probe |
| `liveness_probe` | `object` | see above | Liveness health probe |
| `enable_image_mirroring` | `bool` | `false` | Mirror the container image to Artifact Registry before deployment |
| `min_instance_count` | `number` | `0` | Minimum number of running instances (0 enables scale-to-zero) |
| `max_instance_count` | `number` | `3` | Maximum number of running instances |
| `secret_environment_variables` | `map(string)` | `{}` | Secret environment variables passed to the container |

### Storage & Volumes

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts (name, bucket_name, mount_path, readonly, mount_options) |
| `deployment_region` | `string` | `"us-central1"` | Region for the storage bucket |

---

## 4. Health Probes

Ghost_Common is the only `*_Common` module that defines all three probe types. All probes target `GET /` (the Ghost homepage, which returns 200 when the application is fully ready):

| Probe | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|-------|--------------|---------|--------|-------------------|---------|
| **Startup** | 90s | 10s | 10s | 10 | Allows up to 190s total for Ghost to complete its first-run database migrations and schema setup |
| **Liveness** | 60s | 5s | 30s | 3 | Restarts the container if Ghost becomes unresponsive |
| **Readiness** | 30s | 5s | 10s | 3 | Removes the instance from the load balancer while temporarily unhealthy |

The generous startup probe thresholds accommodate Ghost's schema migration process on fresh databases, which can be slow on the first run.

---

## 5. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|-------|-------|
| Image | `mysql:8.0-debian` |
| Script | `scripts/db-init.sh` |
| Secrets required | `ROOT_PASSWORD` (MySQL root, optional), `DB_PASSWORD` (app user) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |

`db-init.sh` behavior:
1. Resolves the target host from `DB_HOST` (preferred — may carry `127.0.0.1` for the Auth Proxy) or falls back to `DB_IP`.
2. Detects connection type: if `DB_HOST` starts with `/`, uses a Unix socket (`-S`); otherwise uses TCP (`-h`).
3. Validates that `DB_PASSWORD` is set; warns and skips DB/user creation if `ROOT_PASSWORD` is absent (assumes the database already exists).
4. Polls MySQL using the `mysql` client (up to 30 retries, 2s apart).
5. **When `ROOT_PASSWORD` is provided**:
   - Creates the database with `utf8mb4` charset and `utf8mb4_0900_ai_ci` collation (MySQL 8.0 default, required by Ghost 6.x).
   - Creates (or recreates) the application user with `mysql_native_password` authentication — deliberately chosen over `caching_sha2_password` for compatibility with the Node.js `mysql2` driver, which requires RSA key exchange on first TCP connection with `caching_sha2_password`.
   - Grants `ALL PRIVILEGES` on the Ghost database plus explicit `CREATE, ALTER, DROP, INDEX, REFERENCES` for migrations.
6. **When `ROOT_PASSWORD` is absent**: Skips creation and proceeds to verification.
7. Verifies the application user can connect and queries database charset/collation/version info.
8. Signals Cloud SQL Proxy shutdown via `curl` if available, otherwise falls back to raw bash `/dev/tcp` I/O (the `mysql:8.0-debian` image does not include `curl` or `wget`).

---

## 6. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as the Docker build context.

### `Dockerfile`
Wraps the public `ghost:<version>` image:
- Installs `curl`, `jq`, and `netcat-openbsd` for the custom entrypoint.
- Copies `entrypoint.sh` to `/usr/local/bin/custom-entrypoint.sh`.
- Ensures `/var/lib/ghost/content` is owned by the `node` user.
- Sets `WORKDIR /var/lib/ghost`.
- Exposes port `2368`.
- Uses `custom-entrypoint.sh` as the entrypoint and `node current/index.js` as the default command.

### `entrypoint.sh`
Runs before the original Ghost entrypoint to configure the runtime environment:

**1. Service URL Resolution** (three-step priority):
1. Uses the `url` environment variable directly if set.
2. Auto-detects the Cloud Run service URL via the GCE metadata server:
   - Fetches an access token from `http://metadata.google.internal/...`.
   - Retrieves the project ID and region from metadata.
   - Calls the Cloud Run API v2 (`https://run.googleapis.com/v2/projects/.../services/...`) to get the service URI.
   - Exports both `url` and `admin__url` from the detected URI.
3. Falls back to `http://localhost:2368` for local development when not on Cloud Run.

**2. Database Variable Mapping**: Translates standard platform env vars into Ghost's double-underscore config key syntax:

| Platform env var | Ghost config key |
|-----------------|-----------------|
| `DB_HOST` (TCP) | `database__connection__host` |
| `DB_HOST` (socket path starting with `/`) | `database__connection__socketPath` |
| `DB_IP` (fallback) | `database__connection__host` |
| `DB_USER` | `database__connection__user` |
| `DB_NAME` | `database__connection__database` |
| `DB_PASSWORD` | `database__connection__password` |
| `DB_PORT` | `database__connection__port` |

**3. MySQL Configuration Validation**: When `database__client = "mysql"`:
- Validates all required connection variables are present for TCP connections.
- Waits for TCP reachability using `nc` (up to 30 attempts, 2s apart) for non-localhost hosts.
- Skips wait for Unix socket connections (Cloud SQL Proxy creates the socket asynchronously).

**4. Startup**: Delegates to the original Ghost entrypoint (`exec docker-entrypoint.sh "$@"`).

---

## 7. Ghost Configuration via Environment Variables

Ghost reads its configuration from environment variables using double-underscore notation. The entrypoint maps platform-injected variables, but wrapper modules can pass any Ghost config key directly via `environment_variables`:

```hcl
environment_variables = {
  "database__client"              = "mysql"
  "mail__transport"               = "SMTP"
  "mail__options__host"           = "smtp.example.com"
  "storage__active"               = "gcs"
  "imageOptimization__resize"     = "true"
  "privacy__useUpdateCheck"       = "false"
}
```

---

## 8. Platform-Specific Differences

| Aspect | Ghost_CloudRun | Ghost_GKE |
|--------|----------------|-----------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `min_instance_count` | `0` (scale-to-zero) | `1` (always one pod running) |
| `enable_cloudsql_volume` | Optional (default `true`) | Optional (default `true`) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path | Cloud SQL private IP |
| URL auto-detection | `entrypoint.sh` fetches service URL from GCP metadata API | `entrypoint.sh` fetches service URL from GCP metadata API |
| NFS | Not supported | Not supported |
| Redis | Not supported | Not supported |

---

## 9. Implementation Pattern

```hcl
# Example: how Ghost_CloudRun instantiates Ghost_Common

module "ghost_app" {
  source = "../Ghost_Common"

  application_version  = var.application_version
  db_name              = var.db_name
  db_user              = var.db_user
  deployment_region    = var.deployment_region
  environment_variables = {
    "database__client" = "mysql"
    # Additional Ghost config keys as needed
  }
}

# config is passed directly to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = module.ghost_app.config
  module_storage_buckets = module.ghost_app.storage_buckets
  scripts_dir            = "${module.ghost_app.path}/scripts"
  # ... other inputs
}
```
