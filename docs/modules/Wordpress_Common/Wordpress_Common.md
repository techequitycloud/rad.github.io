---
title: "Wordpress Common Shared Configuration Module"
sidebar_label: "Common"
---

# Wordpress_Common Module

## Overview

`Wordpress_Common` is a configuration module in the RAD Modules ecosystem that provisions eight WordPress security keys and salts and outputs a `config` object consumed by `App_CloudRun` or `App_GKE` to deploy WordPress — the world's most widely used CMS — on Google Cloud.

Unlike most `*_Common` modules that compute a `resource_prefix` internally, **Wordpress_Common requires `resource_prefix` to be supplied by the caller** and uses it directly for all secret naming without any transformation. Both `resource_prefix` and `deployment_id_suffix` are required inputs with no defaults.

The module uses **MySQL 8.0** and deploys WordPress on **Apache** via a `php:8.4-apache`-based image with WordPress downloaded at build time.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       Wordpress_Common (Layer 1)                             │
│                                                                              │
│  Inputs: project_id, resource_prefix, deployment_id_suffix, ...             │
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐    │
│  │  GCP Resources       │    │  Config Output (consumed by Layer 2)    │    │
│  │                      │    │                                         │    │
│  │  Secret Manager API  │    │  container_image: "" (custom build)     │    │
│  │  8 secrets           │    │  container_port: 80                     │    │
│  │  (64-char, special   │    │  database_type: MYSQL_8_0               │    │
│  │   chars)             │    │  enable_mysql_plugins: false            │    │
│  │  time_sleep 30s      │    │  secret_env_vars:                       │    │
│  │                      │    │    WORDPRESS_AUTH_KEY → secret-id       │    │
│  │  GCS Bucket          │    │    (+ 7 more keys/salts)                │    │
│  │   wp-uploads         │    │  environment_variables:                 │    │
│  │  (created by         │    │    WORDPRESS_TABLE_PREFIX: "wp_"        │    │
│  │   Layer 2)           │    │    WP_REDIS_HOST, WP_REDIS_PORT         │    │
│  │                      │    │  initialization_jobs: [db-init]         │    │
│  │                      │    │  startup_probe: TCP / 30s delay         │    │
│  │                      │    │  liveness_probe: HTTP /wp-admin 300s    │    │
│  └──────────────────────┘    └─────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        App_CloudRun / App_GKE (Layer 2)
```

---

## GCP Resources Created

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_project_service` | `secretmanager.googleapis.com` | Ensures Secret Manager API is active |
| `random_password` × 8 | — | 64-char alphanumeric + special-char security keys/salts |
| `google_secret_manager_secret` × 8 | `{resource_prefix}-{key-name}` | WordPress security constants |
| `google_secret_manager_secret_version` × 8 | — | Populates each security constant |
| `time_sleep` | — | 30s wait after all 8 secret versions for IAM propagation |

**Secret names** (suffix appended to `{resource_prefix}`):

| Secret Suffix | WordPress Constant |
|--------------|-------------------|
| `-auth-key` | `AUTH_KEY` |
| `-secure-auth-key` | `SECURE_AUTH_KEY` |
| `-logged-in-key` | `LOGGED_IN_KEY` |
| `-nonce-key` | `NONCE_KEY` |
| `-auth-salt` | `AUTH_SALT` |
| `-secure-auth-salt` | `SECURE_AUTH_SALT` |
| `-logged-in-salt` | `LOGGED_IN_SALT` |
| `-nonce-salt` | `NONCE_SALT` |

All 8 passwords use `length = 64, special = true` — the largest and most complex secrets in the RAD Modules ecosystem.

> **`resource_prefix` is required** with no default. Pass `App_GKE.resource_prefix` for GKE deployments, or a fixed stable string for Cloud Run.

---

## Module Outputs

| Output | Type | Description |
|--------|------|-------------|
| `config` | object | Full application configuration for App_CloudRun/App_GKE |
| `storage_buckets` | list(object) | One bucket spec: `wp-uploads` |
| `secret_ids` | map(string) | 8 WordPress security constant secret IDs (gated by 30s sleep) |
| `secret_values` | map(string) (sensitive) | 8 plaintext security constant values |
| `path` | string | Absolute path to this module directory |

**`storage_buckets`** spec:

```hcl
{
  name_suffix   = "wp-uploads"
  location      = var.deployment_region
  force_destroy = true
  # No storage_class or versioning fields — minimal spec
}
```

---

## Input Variables

### Identity & Project

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | string | — | GCP project ID (required) |
| `resource_prefix` | string | — | Prefix for all secret names (required — no default) |
| `deployment_id_suffix` | string | — | Random deployment ID suffix for resource name calculation (required) |
| `labels` | map(string) | `{}` | Labels applied to all GCP resources |
| `deployment_id` | string | `""` | Unique deployment identifier |
| `service_url` | string | `""` | URL where the service will be accessible |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | string | `"wordpress"` | Used in resource naming |
| `display_name` | string | `"Wordpress"` | Human-readable display name |
| `description` | string | `"Wordpress Content Management System"` | Description |
| `application_version` | string | `"latest"` | WordPress version tag (used as Docker `APP_VERSION` build arg) |
| `tenant_deployment_id` | string | `"demo"` | Tenant identifier |
| `deployment_region` | string | `"us-central1"` | Region for the GCS bucket |
| `db_name` | string | `"wp"` | MySQL database name |
| `db_user` | string | `"wp"` | MySQL database user |

### Resources

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `cpu_limit` | string | `"1000m"` | CPU limit |
| `memory_limit` | string | `"2Gi"` | Memory limit |
| `min_instance_count` | number | `1` | Minimum instances (stays warm) |
| `max_instance_count` | number | `3` | Maximum instances |
| `environment_variables` | map(string) | `{}` | Additional environment variables (merged with module defaults) |
| `secret_environment_variables` | map(string) | `{}` | Additional secret env var references (pass-through to config) |
| `gcs_volumes` | list(any) | `[]` | GCS Fuse volume mounts (pass-through to config) |
| `initialization_jobs` | list(any) | `[]` | Override default jobs (empty = use `db-init`) |
| `enable_cloudsql_volume` | bool | `true` | Mount Cloud SQL Auth Proxy sidecar socket volume |

### WordPress-Specific

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `php_memory_limit` | string | `"512M"` | PHP `memory_limit` (Docker build arg) |
| `upload_max_filesize` | string | `"64M"` | PHP `upload_max_filesize` (Docker build arg) |
| `post_max_size` | string | `"64M"` | PHP `post_max_size` (Docker build arg) |
| `enable_redis` | bool | `true` | Enable Redis object caching (default **on** — unlike most modules) |
| `redis_host` | string | `""` | Redis host override |
| `redis_port` | string | `"6379"` | Redis port |

### Health Probes

| Variable | Default | Description |
|----------|---------|-------------|
| `startup_probe` | TCP `/`, 30s delay, 10s timeout, 15s period, 20 failures | TCP startup check — avoids HTTP redirect failures before WordPress is ready |
| `liveness_probe` | HTTP `/wp-admin/install.php`, 300s delay, 60s timeout, 60s period, 3 failures | 300s initial delay accommodates WordPress first-run database setup |

> **Probe design:** The startup probe uses TCP (not HTTP) because WordPress may issue HTTP redirects before it is fully initialized. The liveness probe polls `/wp-admin/install.php` — which returns 200 OK even before WordPress is configured — providing a reliable liveness signal without a custom health endpoint.

---

## Environment Variables

The module merges caller-supplied `environment_variables` with the following defaults:

| Variable | Value | Purpose |
|----------|-------|---------|
| `WORDPRESS_TABLE_PREFIX` | `"wp_"` | Database table prefix |
| `WORDPRESS_DEBUG` | `"false"` | PHP debug mode (off in production) |
| `ENABLE_REDIS` | `"true"` / `"false"` | Signals wp-config to activate the Redis object cache plugin |
| `WP_REDIS_HOST` | `var.redis_host` or `"$(NFS_SERVER_IP)"` | Redis hostname for the WP Redis plugin |
| `WP_REDIS_PORT` | `var.redis_port` (`"6379"`) | Redis port |

**Intentionally omitted variables:**

| Variable | Reason |
|----------|--------|
| `WORDPRESS_DB_NAME` | `App_CloudRun` computes its own `resource_prefix`; setting `DB_NAME` from `Wordpress_Common`'s prefix could cause a mismatch. `wp-config-docker.php` reads `DB_NAME` directly from the environment that `App_CloudRun` injects correctly. |
| `WORDPRESS_DB_USER` | Same reason — `App_CloudRun` manages DB credentials. |
| `WP_HOME` / `WP_SITEURL` | `wp-config-docker.php` reads `CLOUDRUN_SERVICE_URL` (always injected by `App_CloudRun`) so these never need to be set statically. |

---

## Secret Environment Variables

The `config.secret_environment_variables` map carries all 8 WordPress security constants, each mapped to its Secret Manager secret ID (resolved after the 30s propagation sleep):

| Variable | Secret ID Pattern | Description |
|----------|------------------|-------------|
| `WORDPRESS_AUTH_KEY` | `{resource_prefix}-auth-key` | Authentication key |
| `WORDPRESS_SECURE_AUTH_KEY` | `{resource_prefix}-secure-auth-key` | Secure authentication key |
| `WORDPRESS_LOGGED_IN_KEY` | `{resource_prefix}-logged-in-key` | Logged-in key |
| `WORDPRESS_NONCE_KEY` | `{resource_prefix}-nonce-key` | Nonce key |
| `WORDPRESS_AUTH_SALT` | `{resource_prefix}-auth-salt` | Authentication salt |
| `WORDPRESS_SECURE_AUTH_SALT` | `{resource_prefix}-secure-auth-salt` | Secure authentication salt |
| `WORDPRESS_LOGGED_IN_SALT` | `{resource_prefix}-logged-in-salt` | Logged-in salt |
| `WORDPRESS_NONCE_SALT` | `{resource_prefix}-nonce-salt` | Nonce salt |

Callers may inject additional secret references via `var.secret_environment_variables`, which are merged on top of these defaults.

---

## Initialization Job: `db-init`

| Property | Value |
|----------|-------|
| Image | `mysql:8.0-debian` |
| Script | `scripts/db-init.sh` |
| `execute_on_apply` | `true` |
| `max_retries` | 3 |
| Timeout | 600s |
| Secret env vars | `{}` — ROOT_PASSWORD and DB_PASSWORD are injected by App_CloudRun/App_GKE |

**`db-init.sh` flow:**

1. Installs `netcat` and `curl` (auto-detects `microdnf`/`apt-get`/`apk` — handles Oracle Linux, Debian, Alpine image variants)
2. Waits up to 30s for a Cloud SQL Unix socket under `/cloudsql`; falls back to TCP via `$DB_IP` or `$DB_HOST`
3. Writes `~/.my.cnf` with root credentials — password is double-escaped (`\` → `\\`, `"` → `\"`) then wrapped in double quotes, preventing `#` and `;` from being silently treated as MySQL option file comment characters
4. For TCP connections: appends `ssl-mode=PREFERRED` to `~/.my.cnf`
5. Creates MySQL user: `CREATE USER IF NOT EXISTS … IDENTIFIED WITH mysql_native_password BY '${SAFE_DB_PASS}'` then `ALTER USER` (idempotent password update)
6. Creates database: `` CREATE DATABASE IF NOT EXISTS `${DB_NAME}` ``
7. Grants `` ALL PRIVILEGES ON `${DB_NAME}`.* TO '${DB_USER}'@'%' ``
8. Removes `~/.my.cnf`
9. Signals Cloud SQL Auth Proxy shutdown via `POST http://localhost:9091/quitquitquit` (30 retries, 2s intervals)

---

## Container Image

Built from `scripts/Dockerfile` using `php:8.4-apache`.

```
Base: php:8.4-apache

Args (baked at build time):
  APP_VERSION            → WordPress version downloaded from wordpress.org
  PHP_MEMORY_LIMIT       → 512M (overridable)
  UPLOAD_MAX_FILESIZE    → 64M  (overridable)
  POST_MAX_SIZE          → 64M  (overridable)

System packages:
  ghostscript            → PDF thumbnail previews for WordPress media

PHP extensions compiled:
  bcmath, exif, gd (avif/freetype/jpeg/webp), intl, mysqli, zip

PECL extensions:
  imagick-3.8.0          → ImageMagick for advanced image processing
  redis                  → Required by the WP Redis object cache plugin

PHP.ini settings:
  opcache: memory_consumption=128, max_accelerated_files=4000
  error logging to stderr (display_errors=Off)
  memory_limit, upload_max_filesize, post_max_size from build args

Apache modules:
  rewrite, expires       → URL rewriting for WordPress permalinks
  remoteip               → Trusts X-Forwarded-For from Cloud Run / GKE load balancers

WordPress:
  Downloaded from wordpress.org/wordpress-{APP_VERSION}.tar.gz at build time
  Extracted to /usr/src/wordpress (copied to /var/www/html at first start by entrypoint)
  .htaccess with permalink rewrite rules pre-created
  wp-content directories pre-created with sticky-bit (chmod 1777)

VOLUME /var/www/html
ENTRYPOINT: docker-entrypoint.sh
CMD:        apache2-foreground
```

---

## `docker-entrypoint.sh`

Handles Cloud SQL connection, WordPress installation bootstrap, and `wp-config.php` generation:

1. **Socket detection (120s timeout):** Searches `$DB_HOST` path, `/cloudsql`, and `/var/run/mysqld` for a Unix socket. The 120s window is longer than other modules' 30s to accommodate the time Apache and Cloud SQL Auth Proxy need to initialize together.
2. **Socket symlink:** When found, symlinks to `/tmp/mysqld.sock` and sets `WORDPRESS_DB_HOST=localhost:/tmp/mysqld.sock` — WordPress's `mysqli` driver accepts the `host:socket_path` syntax.
3. **TCP fallback logic:**
   - If `DB_SSL=false` (proxy mode) and no socket found: forces `WORDPRESS_DB_HOST=127.0.0.1` (GKE sidecar proxy on localhost)
   - Otherwise: prefers `$DB_IP`, then `$DB_HOST` (if not a socket path)
   - Sets `WORDPRESS_DB_SSL=true` for direct private-IP connections (skipped if `DB_SSL=false`)
4. **`NFS_SERVER_IP` expansion:** Substitutes the `$(NFS_SERVER_IP)` placeholder in both `wp-config.php` (if already written) and the `WP_REDIS_HOST` environment variable, enabling Redis on the NFS VM to be referenced symbolically in Terraform and resolved at runtime.
5. **Apache `ServerName` suppression:** Creates `/etc/apache2/conf-available/servername.conf` to silence the `Could not reliably determine server's fully qualified domain name` warning.
6. **WordPress file copy:** If `/var/www/html` is empty, copies WordPress from `/usr/src/wordpress` using `tar` (preserves ownership, skips existing `wp-content` subdirectories to avoid overwriting user-installed plugins and themes).
7. **`wp-config.php` generation:** If no `wp-config.php` exists but `WORDPRESS_*` env vars are present, copies `wp-config-docker.php` and processes it with `awk`:
   - Replaces `put your unique phrase here` placeholders with `sha1sum /dev/urandom` random strings (safety fallback if secrets aren't injected)
   - Injects Redis constants before the `/* Stop editing */` marker:
     ```php
     if (getenv("WP_REDIS_HOST")) {
         define("WP_REDIS_HOST", getenv("WP_REDIS_HOST"));
     } elseif (getenv("NFS_SERVER_IP")) {
         define("WP_REDIS_HOST", getenv("NFS_SERVER_IP"));
     }
     if (getenv("WP_REDIS_PORT")) {
         define("WP_REDIS_PORT", getenv("WP_REDIS_PORT"));
     }
     ```
8. **`exec "$@"`** — passes `apache2-foreground` through.

---

## `wp-config-docker.php`

A modified version of WordPress's standard `wp-config-sample.php` adapted for container environments:

**`getenv_docker()` helper:** Checks `ENV_FILE` (Docker secrets file path) → `ENV` (environment variable) → `default`. Supports both Cloud Run/GKE environment injection and Docker Swarm secrets file injection.

**Variable resolution order:**

| WordPress Constant | Primary Env Var | Fallback Env Var | Final Default |
|-------------------|-----------------|------------------|---------------|
| `DB_NAME` | `WORDPRESS_DB_NAME` | `DB_NAME` | `'wordpress'` |
| `DB_USER` | `WORDPRESS_DB_USER` | `DB_USER` | `'example username'` |
| `DB_PASSWORD` | `WORDPRESS_DB_PASSWORD` | `DB_PASSWORD` | `'example password'` |
| `DB_HOST` | `WORDPRESS_DB_HOST` | `DB_HOST` | `'mysql'` |
| `AUTH_KEY` | `WORDPRESS_AUTH_KEY` | — | random (awk fallback) |
| *(+ 7 more keys/salts)* | `WORDPRESS_*` | — | random (awk fallback) |
| `$table_prefix` | `WORDPRESS_TABLE_PREFIX` | — | `'wp_'` |
| `WP_DEBUG` | `WORDPRESS_DEBUG` | — | `false` |

**Site URL resolution:**
```php
// CLOUDRUN_SERVICE_URL is always injected by App_CloudRun with the correct URL.
// Falls back to WP_HOME for non-Cloud Run deployments.
$_wp_site_url = getenv_docker('CLOUDRUN_SERVICE_URL', getenv_docker('WP_HOME', ''));
if ($_wp_site_url !== '') {
    define('WP_HOME',    $_wp_site_url);
    define('WP_SITEURL', getenv_docker('WP_SITEURL', $_wp_site_url));
}
```

**SSL:** When `WORDPRESS_DB_SSL=true`, sets `MYSQL_CLIENT_FLAGS = MYSQLI_CLIENT_SSL | MYSQLI_CLIENT_SSL_DONT_VERIFY_SERVER_CERT` (verification skipped because Cloud SQL uses self-signed certificates in private-IP mode).

**Reverse proxy:** Automatically sets `$_SERVER['HTTPS'] = 'on'` when `HTTP_X_FORWARDED_PROTO` contains `https` (Cloud Run and GKE ingress always set this header).

**`WORDPRESS_CONFIG_EXTRA`:** `eval()`s arbitrary PHP — an escape hatch for injecting plugin-specific constants without modifying the image.

---

## Platform-Specific Differences

| Aspect | Wordpress_CloudRun | Wordpress_GKE |
|--------|-------------------|---------------|
| `service_url` | Computed Cloud Run URL injected as `CLOUDRUN_SERVICE_URL` | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | Optional (Auth Proxy sidecar) | Optional (Auth Proxy sidecar) |
| `DB_HOST` | Cloud SQL Auth Proxy socket → symlinked to `/tmp/mysqld.sock` | Cloud SQL private IP |
| `WORDPRESS_DB_HOST` | `localhost:/tmp/mysqld.sock` (socket mode) | Private IP or `127.0.0.1` (proxy mode) |
| `WP_HOME` / `WP_SITEURL` | Auto-set from `CLOUDRUN_SERVICE_URL` by `wp-config-docker.php` | Must be configured via `WP_HOME` env var |
| NFS | Optional via `enable_nfs` | Optional via `enable_nfs` |
| Redis | Optional (default on); `$(NFS_SERVER_IP)` placeholder | Optional (default on); `$(NFS_SERVER_IP)` placeholder |

---

## Usage Example

```hcl
module "wordpress_common" {
  source = "./modules/Wordpress_Common"

  project_id           = var.project_id
  resource_prefix      = "wp-prod-abc123"   # Must be stable; aligns with App_GKE prefix
  deployment_id_suffix = random_id.id.hex

  application_version = "6.7.1"
  deployment_region   = "us-central1"

  php_memory_limit    = "512M"
  upload_max_filesize = "128M"
  post_max_size       = "128M"

  enable_redis = true
  redis_host   = "$(NFS_SERVER_IP)"  # Resolved at runtime by docker-entrypoint.sh
}

module "wordpress_cloudrun" {
  source = "./modules/App_CloudRun"

  config          = module.wordpress_common.config
  storage_buckets = module.wordpress_common.storage_buckets
  secret_ids      = module.wordpress_common.secret_ids
}
```

### Aligning `resource_prefix` with `App_GKE`

When deploying on GKE, pass `App_GKE`'s `resource_prefix` so all secrets and cluster resources share the same naming prefix:

```hcl
module "wordpress_common" {
  source               = "./modules/Wordpress_Common"
  project_id           = var.project_id
  resource_prefix      = module.app_gke.resource_prefix
  deployment_id_suffix = module.app_gke.deployment_id_suffix
  # ...
}
```
