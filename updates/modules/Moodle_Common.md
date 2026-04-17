# Moodle_Common Shared Configuration Module

The `Moodle_Common` module defines the Moodle Learning Management System (LMS) configuration for the RAD Modules ecosystem. It **creates GCP resources** (two Secret Manager secrets) and produces a `config` output consumed by platform-specific wrapper modules (`Moodle_CloudRun` and `Moodle_GKE`).

## 1. Overview

**Purpose**: To centralize all Moodle-specific configuration — a full Apache + PHP 8.3 + Moodle stack built from source, NFS-backed shared data storage, cron scheduling, Redis session support, and application secrets — in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Moodle_CloudRun  ──┐
└── Moodle_GKE       ──┤── instantiate Moodle_Common
                       ↓
           Moodle_Common (this module)
           Creates: 2 Secret Manager secrets (cron, SMTP)
           Produces: config, secret_env_vars, secret_values,
                     cron_password, smtp_password, storage_buckets, path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, database, NFS, storage, secrets, IAM)
```

**Key characteristics**:
- Builds a **fully custom image from Ubuntu 24.04** — Apache 2, PHP 8.3 with all Moodle extensions, and the Moodle source downloaded directly from GitHub releases. There is no upstream Moodle Docker image used.
- **NFS is mandatory** — `enable_nfs` defaults to `true` and should not be disabled. Moodle requires a shared writable filesystem (`moodledata`) accessible across all instances.
- Defines **two** default initialization jobs: `db-init` (database setup) and `nfs-init` (NFS directory permissions). The `nfs-init` job sets `needs_db = false` so the Cloud SQL proxy sidecar is not injected.
- Has a **built-in cron daemon** — the container runs `cron` alongside Apache and executes `admin/cli/cron.php` hourly.
- The `storage_buckets` output is a **pass-through** of the caller's `module_storage_buckets` variable rather than a fixed definition, giving wrapper modules full control over bucket configuration.

---

## 2. GCP Resources Created

| Secret ID | Content | Purpose |
|-----------|---------|---------|
| `<wrapper_prefix>-cron-password` | 32-char random alphanumeric | Password for the Moodle scheduled task runner |
| `<wrapper_prefix>-smtp-password` | 24-char random alphanumeric | SMTP credentials for Moodle outbound email |

Both secrets use automatic global replication. A 30-second `time_sleep` is applied after both secret versions are written to ensure propagation before dependent resources read them.

The `wrapper_prefix` variable (default: `"moodle"`) controls the secret ID prefix and allows multiple Moodle deployments in the same project to coexist without naming collisions.

---

## 3. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | from `application_name` variable (required) |
| `description` | Application description (default: `"Moodle LMS"`) |
| `container_image` | `""` — no prebuilt image; fully built from source |
| `image_source` | `"custom"` |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { TARGETARCH = "amd64" }` |
| `container_port` | `8080` (Apache is configured to listen on `$PORT`, defaulting to 8080) |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (default: `"moodle"`) |
| `db_user` | Database user (default: `"moodle"`) |
| `enable_nfs` | `var.enable_nfs` (default `true` — Moodle requires NFS) |
| `nfs_mount_path` | `var.nfs_mount_path` (default `"/mnt"`) |
| `gcs_volumes` | Passed through from `var.gcs_volumes` |
| `container_resources` | CPU/memory limits and requests |
| `min_instance_count` | `0` (scale-to-zero) |
| `max_instance_count` | `10` |
| `environment_variables` | Passed through from `var.environment_variables` |
| `enable_postgres_extensions` | `true` |
| `postgres_extensions` | `["pg_trgm"]` |
| `initialization_jobs` | Two default jobs or custom override — see §6 |
| `startup_probe` | `null` — caller must provide |
| `liveness_probe` | `null` — caller must provide |
| `module_storage_buckets` | Passed through from `var.module_storage_buckets` |

### `secret_env_vars`
A map of Moodle secret environment variable names to Secret Manager secret IDs, with a `depends_on` on the 30-second propagation wait:

```hcl
{
  MOODLE_CRON_PASSWORD = "<wrapper_prefix>-cron-password"
  MOODLE_SMTP_PASSWORD = "<wrapper_prefix>-smtp-password"
}
```

### `secret_values`
A **sensitive** map of the same secrets with their raw generated values. Used by `App_GKE` to bypass Secret Manager read-after-write consistency issues on initial apply.

### `cron_password` / `smtp_password`
Individual sensitive outputs exposing each password directly. Provided as a convenience for wrapper modules that need to pass a single credential to another resource (e.g., configuring an external SMTP provider).

### `storage_buckets`
Reflects `local.config.module_storage_buckets`, which is the value of `var.module_storage_buckets` passed in by the wrapper module. This module does not define its own fixed bucket — the caller specifies what storage is needed.

### `path`
The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory.

---

## 4. Input Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | **required** | Application name |
| `project_id` | `string` | **required** | GCP project ID |
| `description` | `string` | `"Moodle LMS"` | Application description; used as `db-init` job description |
| `db_name` | `string` | `"moodle"` | PostgreSQL database name |
| `db_user` | `string` | `"moodle"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit |
| `memory_limit` | `string` | `"512Mi"` | Container memory limit |
| `min_instance_count` | `number` | `0` | Minimum instances (0 = scale-to-zero) |
| `max_instance_count` | `number` | `10` | Maximum instances |
| `gcs_volumes` | `list(any)` | `[]` | GCS Fuse volume mounts |
| `environment_variables` | `map(string)` | `{}` | Environment variables passed to the container |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs; empty triggers the two default jobs |
| `startup_probe` | `any` | `null` | Startup probe; no default — caller must provide |
| `liveness_probe` | `any` | `null` | Liveness probe; no default — caller must provide |
| `module_storage_buckets` | `list(any)` | `[]` | Storage bucket configs passed through to `storage_buckets` output |
| `resource_labels` | `map(string)` | `{}` | Labels applied to Secret Manager secrets |
| `wrapper_prefix` | `string` | `"moodle"` | Prefix for Secret Manager secret IDs |
| `deployment_id` | `string` | `""` | Unique deployment identifier |
| `enable_cloudsql_volume` | `bool` | `true` | Mount the Cloud SQL Auth Proxy socket as a volume |
| `enable_nfs` | `bool` | `true` | Enable NFS volume mount (required by Moodle for shared `moodledata`) |
| `nfs_mount_path` | `string` | `"/mnt"` | Path at which the NFS volume is mounted inside the container |

---

## 5. PostgreSQL Extension

One extension is created during `db-init`:

| Extension | Purpose |
|-----------|---------|
| `pg_trgm` | Trigram-based text search — used by Moodle's full-text search across course content and user data |

The database is created with explicit `UTF8` encoding, `en_US.UTF-8` collation and ctype, and `template0` as the base template to ensure encoding compatibility.

---

## 6. Initialization Jobs

Two jobs run by default (when `initialization_jobs = []`):

### Job 1: `db-init`

| Field | Value |
|-------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets required | `DB_PASSWORD`, `ROOT_PASSWORD` |
| `execute_on_apply` | `true` |
| Timeout | 600s, 3 retries |
| `needs_db` | `true` (Cloud SQL proxy sidecar injected) |

`db-init.sh` behavior:
1. Detects Cloud SQL Auth Proxy socket: if `/cloudsql` directory exists and contains a socket file, symlinks it to `/tmp/.s.PGSQL.5432` and sets `DB_HOST=/tmp`.
2. Resolves the target host from `DB_IP` (platform-injected private IP) or `DB_HOST`.
3. Polls PostgreSQL as the `postgres` superuser until available.
4. Creates (or updates the password of) the Moodle application role with `CREATEDB` privileges.
5. Creates the database with `UTF8` encoding, `en_US.UTF-8` locale, and `template0` if it does not exist; otherwise reassigns ownership.
6. Grants full privileges on the database and public schema to the application user.
7. Creates the `pg_trgm` extension as superuser.
8. Signals Cloud SQL Proxy shutdown via `wget POST http://127.0.0.1:9091/quitquitquit`.

### Job 2: `nfs-init`

| Field | Value |
|-------|-------|
| Image | `ubuntu:24.04` |
| Script | `scripts/nfs-init.sh` |
| Secrets required | None |
| `execute_on_apply` | `true` |
| Timeout | 300s, 3 retries |
| `mount_nfs` | `true` — the NFS volume is mounted at `/mnt` |
| `needs_db` | `false` — Cloud SQL proxy sidecar is **not** injected |

`nfs-init.sh` behavior:
1. Creates the four Moodle data subdirectories on the NFS volume: `/mnt/filedir`, `/mnt/temp`, `/mnt/cache`, `/mnt/localcache`.
2. Sets ownership to UID/GID 33 (`www-data`) and permissions to `2770` (setgid) recursively — required for Apache to read and write Moodle's data.
3. Attempts to signal Cloud SQL Proxy shutdown via Python 3's `urllib.request` as a safety net (proxy is not normally present since `needs_db = false`).

---

## 7. Scripts and Container Image

All supporting files are in `scripts/`. The entire `scripts/` directory is used as the Docker build context.

### `Dockerfile`
Builds a complete LAMP-style stack from `ubuntu:24.04`:
- Installs Apache 2, `libapache2-mod-php`, and PHP 8.3 with all extensions required by Moodle: `gd`, `pgsql`, `curl`, `xmlrpc`, `intl`, `mysql`, `xml`, `mbstring`, `zip`, `soap`, `ldap`, `redis`.
- Installs system utilities: `tini`, `nfs-kernel-server`, `nfs-common`, `supervisor`, `cron`, `gosu`, `pwgen`.
- Downloads the Moodle source archive from GitHub (`moodle/moodle` tag `v${APP_VERSION}`) and extracts it to `/var/www/html/`.
- Copies baked-in configuration: `moodle-config.php` → `/var/www/html/config.php`, `health.php` → `/var/www/html/health.php`.
- Copies and installs `foreground.sh` (Apache process manager) and `moodlecron` (cron schedule).
- Sets `www-data` ownership on all web content.
- Uses **tini** as PID 1 for correct signal handling: `ENTRYPOINT ["/usr/bin/tini", "--", "/cloudrun-entrypoint.sh", "/etc/apache2/foreground.sh"]`.
- Exposes ports 80 and 443 (Apache binds to `$PORT` at runtime, defaulting to 8080).

### `cloudrun-entrypoint.sh`
The runtime entrypoint (invoked by tini):
1. Sets ownership of the NFS data directory (`$MOODLE_DATA_DIR`, default `/mnt`) to `www-data:www-data` — `chown` is attempted but errors are suppressed since GCS Fuse volumes do not support `chown`.
2. Expands the `$(NFS_SERVER_IP)` placeholder in `MOODLE_REDIS_HOST` if present (resolves NFS-hosted Redis address at startup).
3. Executes `"$@"` — passes control to `foreground.sh`.

### `foreground.sh`
Apache process manager and environment bootstrapper:
1. Parses `APP_URL` to extract the hostname, forces the `https://` scheme, and writes `export APP_URL=https://<host>` to `/root/env.sh` (sourced by cron jobs at runtime to ensure environment variables are available).
2. Sets `max_input_vars = 5000` in `/etc/php/8.3/apache2/php.ini` — required by Moodle's admin forms which exceed PHP's default limit.
3. Starts the system `cron` daemon.
4. Sources Apache environment variables and creates required runtime directories (`/var/run/apache2`, `/var/lock/apache2`, `/var/log/apache2`).
5. Configures Apache to listen on `$PORT` (default 8080) by substituting port 80 in `ports.conf` and enabled site configs.
6. Streams Apache logs to stdout via `tail -F`.
7. Runs `apache2 -D FOREGROUND` as the main process.

### `moodle-config.php`
The Moodle PHP configuration file, baked into the image at `/var/www/html/config.php`. All values are read from environment variables at runtime:

| Config key | Source | Notes |
|-----------|--------|-------|
| `$CFG->dbtype` | hardcoded `'pgsql'` | PostgreSQL driver |
| `$CFG->dbname` | `DB_NAME` | |
| `$CFG->dbuser` | `DB_USER` | |
| `$CFG->dbpass` | `DB_PASSWORD` | |
| `$CFG->dbhost` | `DB_HOST` | If `DB_HOST` starts with `/`, sets `dbhost='localhost'` and uses socket path |
| `$CFG->dboptions['dbsocket']` | derived from `DB_HOST` | Unix socket path when `DB_HOST` is a socket |
| `$CFG->wwwroot` | `APP_URL` → `CLOUDRUN_SERVICE_URL` → `GKE_SERVICE_URL` | Priority order; `APP_URL` validated for a real hostname |
| `$CFG->dataroot` | `MOODLE_DATA_DIR` (default `/mnt`) | NFS mount path |
| `$CFG->sslproxy` | derived from `wwwroot` scheme | `true` only when `wwwroot` is `https://` |
| `$CFG->reverseproxy` | `ENABLE_REVERSE_PROXY` | Set `true` only when a load balancer with custom domain sits in front |
| `$CFG->themedir` | `MOODLE_THEME_DIR` | Optional GCS Fuse mount path for external themes |
| `$CFG->alternate_component_directory` | `MOODLE_PLUGIN_DIR` | Optional GCS Fuse mount path for external plugins |

**Special GoogleHC handling**: The config file detects the `GoogleHC` user-agent string (Google's health checker) early and returns `"ok"` immediately, bypassing the full Moodle bootstrap for faster health check responses.

**Redis session support**: When `MOODLE_REDIS_ENABLED=true`, configures Moodle to use Redis for session storage (`\core\session\redis`) with key prefix `moodle_prod_sess_`, 120-second lock timeout, and 7200-second lock expiry.

### `health.php`
A minimal health check endpoint at `/health.php`:
```php
http_response_code(200);
echo "OK";
```
Returns HTTP 200 with body `"OK"` for use as a Cloud Run or Kubernetes liveness/readiness probe target.

### `moodle-install.sh`
CLI-based Moodle installer for initial setup:
1. Checks for a `/mnt/moodledata_installed` lock file — exits early if found (prevents re-installation on container restarts).
2. Runs `php admin/cli/install_database.php` as `www-data` with configurable admin credentials (`MOODLE_ADMIN_USER`, `MOODLE_ADMIN_PASSWORD`, `MOODLE_ADMIN_EMAIL`) and site name (`MOODLE_SITE_FULLNAME`, `MOODLE_SITE_NAME`).
3. Creates the `/mnt/moodledata_installed` lock file on success.

> **Note**: This script is not included in the default initialization jobs. It is intended for use as a one-time custom initialization job when a fresh Moodle installation is needed.

### `moodlecron`
System crontab installed at `/etc/cron.d/moodlecron`. Runs two tasks hourly as root:

| Schedule | Command | Purpose |
|----------|---------|---------|
| `0 * * * *` | `php /var/www/html/admin/cli/cron.php` | Moodle scheduled tasks (email, badges, reports, backups) |
| `0 * * * *` | `php /var/www/html/local/deleteoldquizattempts/cli/delete_attempts.php --days=7` | Purges quiz attempts older than 7 days |

Both commands source `/root/env.sh` first to inherit the runtime environment variables (including `APP_URL`, database connection details).

### `entrypoint.sh`
A simpler alternative entrypoint (not used by default — `cloudrun-entrypoint.sh` is the active entrypoint):
- Sets default values for `DB_HOST`, `DB_PORT`, `DB_USER`, `DB__PASSWORD`, `DB_NAME`, and `PORT`.
- Sets `www-data` ownership on `/mnt` if it exists.
- Executes `"$@"`.

---

## 8. Moodle Runtime Environment Variables

Key environment variables consumed by `moodle-config.php` and `cloudrun-entrypoint.sh` at runtime (set by wrapper modules):

| Variable | Purpose |
|----------|---------|
| `DB_HOST` | PostgreSQL host or Unix socket path |
| `DB_PORT` | PostgreSQL port (default 5432) |
| `DB_NAME` | Moodle database name |
| `DB_USER` | Moodle database user |
| `DB_PASSWORD` | Database password (injected as secret) |
| `APP_URL` | Moodle `wwwroot` — public-facing URL |
| `CLOUDRUN_SERVICE_URL` | Fallback URL when `APP_URL` has no valid hostname |
| `GKE_SERVICE_URL` | Fallback URL for GKE deployments |
| `MOODLE_DATA_DIR` | NFS mount path for moodledata (default `/mnt`) |
| `ENABLE_REVERSE_PROXY` | Set `"true"` only when a load balancer with custom domain is in front |
| `MOODLE_REDIS_ENABLED` | `"true"` to enable Redis session handling |
| `MOODLE_REDIS_HOST` | Redis host; supports `$(NFS_SERVER_IP)` placeholder |
| `MOODLE_REDIS_PORT` | Redis port |
| `MOODLE_REDIS_PASSWORD` | Redis auth password |
| `MOODLE_THEME_DIR` | GCS Fuse mount path for external themes |
| `MOODLE_PLUGIN_DIR` | GCS Fuse mount path for external plugins |
| `MOODLE_CRON_PASSWORD` | Injected from Secret Manager (cron task auth) |
| `MOODLE_SMTP_PASSWORD` | Injected from Secret Manager (outbound email auth) |

---

## 9. Platform-Specific Differences

| Aspect | Moodle_CloudRun | Moodle_GKE |
|--------|-----------------|-----------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` (default `true`) | `var.enable_cloudsql_volume` (default `true`) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path | Cloud SQL private IP |
| NFS | Mandatory (`var.enable_nfs`, default `true`) | Mandatory (`var.enable_nfs`, default `true`) |
| `nfs-init` job | Runs first with `needs_db = false` | Runs first with `needs_db = false` |
| Cron | Cloud Scheduler invokes `/admin/cron.php` via signed URL | Cloud Scheduler invokes `/admin/cron.php` via signed URL |
| Redis | Optional; defaults to NFS-hosted via `$(NFS_SERVER_IP)` | Optional; defaults to NFS-hosted via `$(NFS_SERVER_IP)` |
| Secret injection | `secret_env_vars` from `module.moodle_app` + `DB_PASSWORD` | Secret values injected directly |

---

## 10. Implementation Pattern

```hcl
# Example: how Moodle_CloudRun instantiates Moodle_Common

module "moodle_app" {
  source = "../Moodle_Common"

  application_name  = "moodle"
  project_id        = var.project_id
  wrapper_prefix    = local.resource_prefix
  resource_labels   = local.labels
  deployment_id     = local.deployment_id
  deployment_region = var.deployment_region

  module_storage_buckets = [
    {
      name_suffix              = "moodle-media"
      location                 = var.deployment_region
      storage_class            = "STANDARD"
      force_destroy            = true
      versioning_enabled       = false
      public_access_prevention = "inherited"
    }
  ]
}

# config and secrets are passed to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = module.moodle_app.config
  module_storage_buckets = module.moodle_app.storage_buckets
  module_secret_env_vars = module.moodle_app.secret_env_vars
  scripts_dir            = module.moodle_app.path
  # ... other inputs
}
```
