# OpenEMR_Common Module

## Overview

`OpenEMR_Common` is a pure-configuration Terraform module in the RAD Modules ecosystem. It generates a `config` object consumed by platform modules (`App_CloudRun`, `App_GKE`) to deploy OpenEMR — an open-source electronic health record (EHR) and medical practice management system — on Google Cloud. The module provisions one GCP Secret Manager secret (the OpenEMR admin password) and emits all container configuration as Terraform outputs. No compute resources or GCS buckets are created directly.

OpenEMR has specific infrastructure requirements: **MySQL 8.0** (not PostgreSQL), NFS-backed site files (documents, session cache, Twig cache, sqlconf), ephemeral storage for PHP opcache and Apache logs, and a multi-step startup sequence that can take several minutes on first boot. This module handles all of these by configuring custom init jobs, a temporary health probe server during startup, and version-aware upgrade scripts.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         OpenEMR_Common (Layer 1)                             │
│                                                                              │
│  Inputs: project_id, tenant_deployment_id, deployment_id,                   │
│          application_version, enable_redis, gcs_volumes, ...                │
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐    │
│  │  GCP Resources       │    │  Config Output (consumed by Layer 2)    │    │
│  │                      │    │                                         │    │
│  │  Secret Manager API  │    │  container_image: "" (custom build)     │    │
│  │  admin-password      │    │  container_port: 80                     │    │
│  │    secret (20-char   │    │  database_type: MYSQL_8_0               │    │
│  │    alphanumeric)     │    │  enable_nfs: true                       │    │
│  │                      │    │  nfs_mount_path: /var/www/.../sites     │    │
│  │                      │    │  gcs_volumes: (pass-through)            │    │
│  │  storage_buckets: [] │    │  ephemeral_storage_limit: 8Gi           │    │
│  │  (no GCS buckets)    │    │  initialization_jobs: [nfs-init,        │    │
│  │                      │    │                        db-init]         │    │
│  └──────────────────────┘    │  startup_probe: TCP/0s                  │    │
│                              │  liveness_probe: HTTP /interface/...    │    │
│                              └─────────────────────────────────────────┘    │
│                                                                              │
│  wrapper_prefix = "app{application_name}{tenant_deployment_id}{             │
│                         deployment_id}"                                      │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        App_CloudRun / App_GKE (Layer 2)
        (Cloud Run service, Cloud SQL MySQL, NFS, GCS, jobs)
```

**Volume mounts at runtime:**

| Mount | Source | Path | Purpose |
|-------|--------|------|---------|
| NFS | Filestore | `/var/www/localhost/htdocs/openemr/sites` | sqlconf.php, documents, Twig/Smarty caches |
| Cloud SQL | Auth Proxy socket | `/cloudsql` | MySQL 8.0 via Unix socket |
| GCS Fuse | (caller-provided) | (caller-defined) | Optional custom volumes |

---

## GCP Resources Created

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_project_service` | `secretmanager.googleapis.com` | Ensures Secret Manager API is active |
| `random_password` | — | 20-char alphanumeric admin password |
| `google_secret_manager_secret` | `{wrapper_prefix}-admin-password` | Stores OpenEMR admin/initial password |
| `google_secret_manager_secret_version` | — | Populates the admin password secret |

> **Note:** `storage_buckets` output is always `[]`. OpenEMR does not require a dedicated GCS bucket by default. Callers may inject custom GCS volumes via the `gcs_volumes` input variable.

> `wrapper_prefix` is computed as `"app{application_name}{tenant_deployment_id}{deployment_id}"` (e.g., `appopenemrprod<hex_id>`).

---

## Module Outputs

| Output | Type | Description |
|--------|------|-------------|
| `config` | object | Full application configuration consumed by App_CloudRun/App_GKE |
| `storage_buckets` | list | Always empty `[]` — no GCS buckets provisioned by this module |
| `path` | string | Absolute path to this module directory |
| `admin_password_secret_id` | string | Secret Manager resource ID for the admin password |
| `admin_password` | string (sensitive) | Plaintext admin password value. Marked sensitive — used by `OpenEMR_GKE` to inject `OE_PASS` via `explicit_secret_values`. Not exposed to `OpenEMR_CloudRun`, which uses the Secret Manager reference instead. |

---

## Input Variables

### Identity & Project

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | string | — | GCP project ID (required) |
| `tenant_deployment_id` | string | — | Unique tenant identifier, used in resource naming (required) |
| `deployment_id` | string | `""` | Unique deployment identifier; auto-generated if empty |
| `resource_labels` | map(string) | `{}` | Labels applied to all GCP resources |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | string | `"openemr"` | Application name used in resource naming |
| `application_version` | string | `"7.0.4"` | OpenEMR version tag |
| `display_name` | string | `"OpenEMR"` | Human-readable display name |
| `description` | string | `"OpenEMR application"` | Application description |
| `db_name` | string | `"openemr"` | MySQL database name |
| `db_user` | string | `"openemr"` | MySQL database user |

### Resources

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `cpu_limit` | string | `"2000m"` | CPU limit for the container |
| `memory_limit` | string | `"4Gi"` | Memory limit for the container |
| `ephemeral_storage_limit` | string | `"8Gi"` | Ephemeral storage limit (see note below) |
| `min_instance_count` | number | `1` | Minimum instances (defaults to 1, not 0) |
| `max_instance_count` | number | `1` | Maximum instances (singleton by default) |
| `environment_variables` | map(string) | `{}` | Additional environment variables (merged with module defaults) |
| `initialization_jobs` | list(any) | `[]` | Override default init jobs (empty = use defaults) |
| `gcs_volumes` | list(any) | `[]` | GCS Fuse volumes to attach (passed through to both config and nfs-init job) |
| `enable_cloudsql_volume` | bool | `true` | Mount Cloud SQL Auth Proxy sidecar socket volume |

> **Ephemeral storage:** OpenEMR writes PHP opcache, Apache logs, session files, and installation temp files to the container writable layer. The default 1Gi (GKE Autopilot default) is insufficient. On GKE Autopilot, total pod ephemeral storage is capped at 10Gi across all containers; the Cloud SQL Auth Proxy sidecar consumes ~1Gi, leaving a maximum of 9Gi for OpenEMR. The default of 8Gi fills this budget.

> **Singleton default:** `max_instance_count = 1` reflects that OpenEMR's NFS-based leadership election (`docker-leader` file) works correctly for single instances. Multi-instance or Kubernetes deployments require `SWARM_MODE=yes` or `K8S` environment variable.

### Health Probes

| Variable | Default | Description |
|----------|---------|-------------|
| `startup_probe` | TCP, 0s delay, 5s timeout, 10s period, 12 failures | TCP port check (allows up to 120s for startup) |
| `liveness_probe` | HTTP `GET /interface/login/login.php`, 0s delay, 10s timeout, 30s period, 10 failures | Full HTTP health check against the login page |

### Redis

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_redis` | bool | `true` | Enable Redis session store (enabled by default) |
| `redis_host` | string | `""` | Redis hostname; falls back to `$(NFS_SERVER_IP)` at runtime |
| `redis_port` | string | `"6379"` | Redis port |

> Redis is **enabled by default** in OpenEMR_Common (unlike most other modules). The `$(NFS_SERVER_IP)` placeholder in `REDIS_SERVER` is expanded at container startup by `openemr.sh`.

---

## Initialization Jobs

Two default jobs run at deployment time. Unlike the Odoo module, they have **no explicit ordering** — both run independently.

### Job 1: `nfs-init`

| Property | Value |
|----------|-------|
| Image | `gcr.io/google.com/cloudsdktool/google-cloud-cli:alpine` |
| `needs_db` | `false` (no Cloud SQL proxy injected) |
| `mount_nfs` | `true` |
| `mount_gcs_volumes` | `var.gcs_volumes` (same volumes as the app) |
| `execute_on_apply` | `true` |
| `max_retries` | 4 |
| Script | `scripts/nfs-init.sh` |
| Timeout | 600s |
| Env vars | `NFS_MOUNT_PATH=/var/www/localhost/htdocs/openemr/sites` |

The `gcr.io/google.com/cloudsdktool/google-cloud-cli:alpine` image is used specifically because this job supports downloading OpenEMR backups from **GCS** (`gsutil`) or **Google Drive** (`gdown`) when `BACKUP_FILEID` is provided.

**`nfs-init.sh` flow:**

1. Sets UID 1000 ownership on `NFS_MOUNT_PATH`
2. If `BACKUP_FILEID` is set:
   - Detects `gs://` URIs → uses `gsutil cp`
   - Otherwise assumes Google Drive file ID → installs and uses `gdown`
   - Extracts ZIP backup, moves contents to `NFS_MOUNT_PATH`
   - Patches `sqlconf.php` with current `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `ROOT_PASS`
   - Sets ownership 1000:1000, file permissions 644, directory permissions 755
   - Sets `sqlconf.php` to 600, `documents/` to 755
3. If no backup:
   - Creates default site directory structure (documents/smarty, documents/mpdf, onsite_portal_documents, logs, era, edi, certificates, cache, twig)
   - Generates `sqlconf.php` with `$config = 0` (triggers auto-installation on first boot)
   - Generates `config.php` with default OFX, prescription, and document settings
   - Sets UID 1000:1000 on all created files
4. Signals Cloud SQL Auth Proxy shutdown via `POST http://localhost:9091/quitquitquit`

> **Socket remapping:** When `DB_HOST` is a Unix socket path (Cloud Run), `nfs-init.sh` writes `localhost` into `sqlconf.php` instead of the raw socket path. The actual socket routing is handled by PHP's `mysqli.default_socket` / `pdo_mysql.default_socket` overrides at runtime.

### Job 2: `db-init`

| Property | Value |
|----------|-------|
| Image | `mysql:8.0-debian` |
| `needs_db` | `true` |
| `mount_nfs` | `false` |
| `max_retries` | 4 |
| Script | `scripts/db-init.sh` |
| Timeout | 600s |

**`db-init.sh` flow:**

1. Detects platform (microdnf / apt-get / apk) and installs `nc` + `curl`
2. Determines target host (`DB_IP` → `DB_HOST`)
3. For TCP connections: waits for port 3306 with `nc -z`
4. Writes secure `~/.my.cnf` with root credentials (escaping `\` and `"` to avoid silent truncation by MySQL option file parser when password contains `#` or `;`)
5. Creates MySQL user with `CREATE USER IF NOT EXISTS` + `ALTER USER` pattern
6. Creates database with `CREATE DATABASE IF NOT EXISTS`
7. Grants all privileges on database to user
8. Signals Cloud SQL Auth Proxy shutdown via `POST http://localhost:9091/quitquitquit`

> **mysql:8.0-debian not mariadb:** The comment in `db-init.sh` explicitly warns against installing `default-mysql-client` or `mysql-client` via apt-get on Debian 12 — they resolve to `mariadb-client`, which conflicts with `mysql-client-8.0` (dpkg exit 100).

---

## Container Image

The module builds a custom Docker image from `scripts/Dockerfile` using Alpine 3.20 as the base.

### Dockerfile Summary

```
Base: alpine:3.20

System packages (Apache + PHP 8.3 stack):
  - apache2, apache2-utils, apache2-proxy
  - php83 + extensions: tokenizer, ctype, session, apache2, json, pdo,
    pdo_mysql, curl, ldap, openssl, iconv, xml, xsl, gd, zip, soap,
    mbstring, zlib, mysqli, sockets, xmlreader, redis, simplexml,
    xmlwriter, phar, fileinfo, sodium, calendar, intl, opcache,
    pecl-apcu, fpm
  - perl, mysql-client, mariadb-connector-c, tar, curl, imagemagick
  - nodejs, npm (for OpenEMR frontend build)
  - openssl, dcron, rsync, shadow, ncurses

OpenEMR build:
  - Cloned from github.com/openemr/openemr --branch rel-704 --depth 1
  - composer install --no-dev
  - npm install && npm run build
  - ccdaservice npm install
  - composer dump-autoload --optimize --apcu
  - Build tools removed after build (git, build-base, python3)
  - Installed to /var/www/localhost/htdocs/openemr/

User:
  - apache user (UID 1000, modified from default UID)

Configuration:
  - php.ini copied to /etc/php83/php.ini
  - openemr.conf copied to /etc/apache2/conf.d/
  - PHP-FPM configured to run as apache user

Upgrade scripts:
  - /root/docker-version (version: 7)
  - /root/fsupgrade-{1..7}.sh (chmod 500)

Utilities:
  - /root/unlock_admin.php + /root/unlock_admin.sh
  - /root/devtoolsLibrary.source

Swarm pieces (rsync snapshot for multi-instance restore):
  - /swarm-pieces/ssl/
  - /swarm-pieces/sites/

CMD:  ["./openemr.sh"]
EXPOSE: 80
```

> No `ENTRYPOINT` is defined — the image uses `CMD ["./openemr.sh"]` directly, unlike other modules that use `tini` as PID 1.

---

## `openemr.sh` — Startup Orchestration

The `openemr.sh` script handles all aspects of OpenEMR startup. It is the primary difference from other `*_Common` modules: rather than a thin entrypoint, it performs a full installation/upgrade orchestration.

**Key behaviors:**

### 1. Variable Mapping
Maps platform-standard `DB_*` variables to OpenEMR's `MYSQL_*` variables:
- `DB_HOST` → `MYSQL_HOST`
- `DB_USER` → `MYSQL_USER`
- `DB_NAME` → `MYSQL_DATABASE`
- `DB_PASSWORD` → `MYSQL_PASS`

Expands the `$(NFS_SERVER_IP)` placeholder in `REDIS_SERVER` at startup.

For Unix socket connections (Cloud Run), sets `MYSQL_UNIX_PORT=$MYSQL_HOST` and overrides `MYSQL_HOST=localhost`.

### 2. Temporary Health Probe Server
During installation (which can take several minutes), OpenEMR starts a **PHP built-in web server** on port 80 serving stub `login.php` and `index.php` endpoints that return HTTP 200. This prevents startup/liveness probe failures while `auto_configure.php` runs:

```sh
php -S "0.0.0.0:${PORT:-80}" -t /tmp/health-probe &
HEALTH_PROBE_PID=$!
```

The probe server is killed after setup completes and Apache takes over.

### 3. Authority / Operator Model
| Role | AUTHORITY | OPERATOR | When |
|------|-----------|----------|------|
| Singleton / Cloud Run | yes | yes | Default (`SWARM_MODE=no`, `K8S` unset) |
| Swarm leader | yes | yes | `SWARM_MODE=yes`, wins file lock |
| Swarm member | no | yes | `SWARM_MODE=yes`, loses file lock |
| K8S admin job | yes | no | `K8S=admin` |
| K8S worker | no | yes | `K8S=worker` |

Only `AUTHORITY=yes` instances run `auto_configure.php` and database migrations.

### 4. Version-Aware Upgrade
Compares three version stamps:
- `/root/docker-version` (image version)
- `/var/www/localhost/htdocs/openemr/docker-version` (code version)
- `/var/www/localhost/htdocs/openemr/sites/default/docker-version` (NFS version)

If the image version is newer than the NFS version, runs the appropriate `fsupgrade-N.sh` scripts in sequence. The upgrade path covers:
- `fsupgrade-1.sh`: 5.0.1 → current
- `fsupgrade-2.sh`: 5.0.2 → current
- `fsupgrade-3.sh`: 6.0.0 → current
- `fsupgrade-4.sh`: 6.1.0 → current
- `fsupgrade-5.sh`: 7.0.0 → current
- `fsupgrade-6.sh`: 7.0.1 → current
- `fsupgrade-7.sh`: 7.0.2 → current

### 5. Auto-Configuration
On first boot (when `sqlconf.php` has `$config = 0`), runs `auto_configure.php` as the `apache` user via `su`:

```sh
su -s /bin/sh -c "php -c auto_configure.ini auto_configure.php -f ${CONFIGURATION} no_root_db_access=1" apache
```

Uses a temporary PHP file cache (`/tmp/php-file-cache`) with opcache enabled to speed up the PHP-based installer. For Cloud SQL Unix socket connections, sets `pdo_mysql.default_socket` and `mysqli.default_socket` in the dynamic `auto_configure.ini`.

Includes a **race condition guard**: if multiple Cloud Run instances start simultaneously, only the first to complete setup proceeds; others detect `$config = 1` and skip.

### 6. Apache + PHP-FPM Startup
After setup and upgrade, starts PHP-FPM and Apache as the final step:
```sh
php-fpm83 && httpd -D FOREGROUND
```

---

## Utility Scripts

### `unlock_admin.sh` / `unlock_admin.php`
Re-activates the `admin` account and resets the password. Used for recovery when the admin account is locked due to failed login attempts:
- Sets `active=1` in the users table
- Updates password using OpenEMR's `AuthUtils::updatePassword()`

Can be called from a `kubectl exec` or Cloud Run shell:
```sh
/root/unlock_admin.sh <new_password>
```

### `devtoolsLibrary.source`
Bash function library sourced by `openemr.sh`. Key functions:
- `prepareVariables()` — assembles MySQL connection variables
- `setGlobalSettings()` — applies `OE_*` environment variables to the OpenEMR globals table
- `resetOpenemr()` — drops and recreates the database and NFS site files
- `upgradeOpenEMR()` — runs the appropriate `fsupgrade-N.sh` scripts
- `backupOpenemr()` / `restoreOpenemr()` — backup/restore via mysqldump + zip
- `importRandomPatients()` — Synthea synthetic patient data integration
- `generateMultisiteBank()` — multi-site provisioning

---

## `auto_configure.php`

PHP script run during first boot to perform database initialization via the OpenEMR `Installer` class. Reads configuration from environment variables:

| Env var | Maps to | Default |
|---------|---------|---------|
| `MYSQL_HOST` | `$_GET["iuser"]` host | (from `CONFIGURATION`) |
| `MYSQL_DATABASE` | `$_GET["dbname"]` | `"openemr"` |
| `MYSQL_USER` | `$_GET["login"]` | `"openemr"` |
| `MYSQL_PASS` | `$_GET["pass"]` | `"openemr"` |
| `OE_USER` | `$_GET["iuser"]` | `"admin"` |
| `OE_PASS` | `$_GET["iuserpass"]` | `"pass"` |

The `no_root_db_access=1` flag prevents the installer from attempting to create the database as root (already done by `db-init` job).

---

## Environment Variables (Module Defaults)

The following environment variables are always set by the module (merged with `var.environment_variables`):

| Variable | Value | Purpose |
|----------|-------|---------|
| `MYSQL_PORT` | `"3306"` | MySQL port for OpenEMR |
| `OE_USER` | `"admin"` | Default OpenEMR admin username |
| `MANUAL_SETUP` | `"no"` | Enables automatic setup via `auto_configure.php` |
| `SWARM_MODE` | `"no"` | Disables multi-instance swarm coordination |
| `ENABLE_REDIS` | `tostring(var.enable_redis)` | Redis session store toggle |
| `REDIS_SERVER` | Redis host or `$(NFS_SERVER_IP)` | Redis hostname (expanded at runtime) |
| `REDIS_PORT` | `"6379"` or `var.redis_port` | Redis port |
| `MYSQL_ROOT_PASS` | `"BLANK"` | Forces OpenEMR to skip root DB access |

---

## Platform-Specific Differences

| Aspect | OpenEMR_CloudRun | OpenEMR_GKE |
|--------|------------------|------------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | `true` (defaults from Common; CloudRun uses Auth Proxy socket) | `true` (forced in GKE wrapper; Cloud SQL Proxy sidecar) |
| `DB_HOST` | Cloud SQL Auth Proxy Unix socket path (mounted at `/cloudsql`) | Cloud SQL private IP (proxy sidecar connects via `127.0.0.1`) |
| NFS | Mandatory (OpenEMR sites directory) | Mandatory (OpenEMR sites directory) |
| `K8S` env var | Not set (single-instance mode) | `K8S=yes` (multi-pod aware clustering) |
| GCS volumes | Optional pass-through via `gcs_volumes` | Optional pass-through via `gcs_volumes` |
| Redis | Enabled by default (`enable_redis = true`) | Enabled by default (`enable_redis = true`) |
| Init jobs | `nfs-init` (no DB) and `db-init` run independently | `nfs-init` (no DB) and `db-init` run independently |

---

## Usage Example

```hcl
module "openemr_common" {
  source = "./modules/OpenEMR_Common"

  project_id           = var.project_id
  tenant_deployment_id = "prod"
  deployment_id        = random_id.deployment.hex
  application_version  = "7.0.4"

  enable_redis = true
  # redis_host left empty — resolves to NFS_SERVER_IP at runtime

  environment_variables = {
    OE_PASS       = "change-me-on-first-login"
    MYSQL_ROOT_PASS = "BLANK"
  }
}

module "openemr_cloudrun" {
  source = "./modules/App_CloudRun"

  config          = module.openemr_common.config
  storage_buckets = module.openemr_common.storage_buckets

  secret_env_vars = {
    OE_PASS = module.openemr_common.admin_password_secret_id
  }
}
```

### Backup Restore

To restore an existing OpenEMR installation from a GCS backup:

```hcl
# In your init job override, set BACKUP_FILEID to a GCS path
initialization_jobs = [
  {
    name        = "nfs-init"
    image       = "gcr.io/google.com/cloudsdktool/google-cloud-cli:alpine"
    mount_nfs   = true
    needs_db    = false
    execute_on_apply = true
    script_path = "./modules/OpenEMR_Common/scripts/nfs-init.sh"
    env_vars = {
      NFS_MOUNT_PATH = "/var/www/localhost/htdocs/openemr/sites"
      BACKUP_FILEID  = "gs://my-bucket/openemr-backup-2025-01-01.zip"
    }
  }
]
```

Or for a Google Drive backup, set `BACKUP_FILEID` to the Google Drive file ID (not a `gs://` URI).

