---
title: "Nextcloud_Common"
sidebar_label: "Nextcloud Common"
---

# Nextcloud_Common

> Internal configuration module shared between Nextcloud_CloudRun and Nextcloud_GKE.

## Overview

`Nextcloud_Common` is an **internal configuration module** shared between `Nextcloud_CloudRun` and `Nextcloud_GKE`. It centralises all Nextcloud-specific configuration — custom container image, MySQL 8.0 database setup, environment variable mapping, health probes, PHP runtime settings, and the default database initialisation job — in a single module consumed by both Cloud Run and GKE deployments.

This module creates **one GCP resource**: a Secret Manager secret for the Nextcloud admin password. All other GCP infrastructure provisioning (Cloud SQL, NFS, VPC, Artifact Registry, IAM) is performed by the platform modules (`App_CloudRun`, `App_GKE`) that consume its outputs. It is called automatically by the application modules — **it is not deployed directly by end users**.

**Nextcloud-specific characteristics:**
- Requires **MySQL 8.0** with `utf8mb4` character set and `utf8mb4_general_ci` collation.
- PHP settings (`php_memory_limit`, `upload_max_filesize`, `post_max_size`) are baked into the container image via Docker `ARG` at build time **and** injected as environment variables at runtime.
- The `entrypoint.sh` script handles: DB_HOST socket-to-IP mapping, MySQL readiness waiting, database bootstrap fallback using `ROOT_PASSWORD`, NFS config/data directory setup, and runtime derivation of `OVERWRITEHOST`/`OVERWRITECLIURL`/`NEXTCLOUD_TRUSTED_DOMAINS` from `CLOUDRUN_SERVICE_URL`.
- `NEXTCLOUD_UPDATE = "1"` is always set, enabling automatic minor version updates on container restart.
- `OVERWRITEPROTOCOL = "https"` is always set, forcing Nextcloud to generate HTTPS URLs.

---

## Secrets Created

| Secret Name | Content | Usage |
|---|---|---|
| `<resource_prefix>-admin-password` | 24-char alphanumeric password | Injected as `NEXTCLOUD_ADMIN_PASSWORD`; consumed by `occ maintenance:install` on first boot. |

---

## Outputs

| Output | Description |
|---|---|
| `config` | Application configuration object passed to the platform module via `application_modules`. Contains: `app_name`, `application_version`, `display_name`, `container_image`, `image_source`, `container_build_config` (Dockerfile path, context, build args), `container_port`, `database_type`, `db_name`, `db_user`, `enable_cloudsql_volume`, `cloudsql_volume_mount_path`, `gcs_volumes`, `container_resources`, `min_instance_count`, `max_instance_count`, `environment_variables`, `secret_environment_variables`, `enable_mysql_plugins`, `mysql_plugins`, `initialization_jobs`, `startup_probe`, `liveness_probe`. |
| `secret_ids` | Map of secret environment variable names to Secret Manager secret IDs. Contains `NEXTCLOUD_ADMIN_PASSWORD`. Passed as `module_secret_env_vars` in the Application Module. |
| `storage_buckets` | List of GCS bucket configurations for the platform module to provision. Contains a single `data` bucket (`name_suffix = "data"`). Passed as `module_storage_buckets`. |

---

## Container Build Configuration

`Nextcloud_Common` sets `image_source = "custom"` and provides a `container_build_config` that triggers a Cloud Build pipeline. The Dockerfile is located at `Nextcloud_Common/scripts/Dockerfile` and extends the official `nextcloud:<version>-apache` base image.

**Docker build args** (passed from `container_build_config.build_args`):

| Build Arg | Variable | Description |
|---|---|---|
| `APP_VERSION` | `application_version` | Nextcloud image tag (e.g. `"30"`). |
| `PHP_MEMORY_LIMIT` | `php_memory_limit` | Applied to `php.ini` inside the image. |
| `UPLOAD_MAX_FILESIZE` | `upload_max_filesize` | Applied to `php.ini` inside the image. |
| `POST_MAX_SIZE` | `post_max_size` | Applied to `php.ini` inside the image. |

---

## Environment Variables Configured

`Nextcloud_Common` builds the `environment_variables` map with:

| Variable | Value | Condition |
|---|---|---|
| `NEXTCLOUD_ADMIN_USER` | `nextcloud_admin_user` | Always |
| `PHP_MEMORY_LIMIT` | `php_memory_limit` | Always |
| `PHP_UPLOAD_LIMIT` | `upload_max_filesize` | Always |
| `NEXTCLOUD_UPDATE` | `"1"` | Always |
| `OVERWRITEPROTOCOL` | `"https"` | Always |
| `REDIS_HOST` | `redis_host` or `"$(REDIS_HOST)"` | When `enable_redis = true` |
| `REDIS_HOST_PORT` | `redis_port` | When `enable_redis = true` |

User-supplied `environment_variables` are merged last (taking precedence).

`NEXTCLOUD_ADMIN_PASSWORD` is passed as a **secret environment variable** (via `secret_environment_variables`) referencing the auto-generated Secret Manager secret.

---

## entrypoint.sh Behaviour

The `entrypoint.sh` script runs before the official Nextcloud entrypoint and handles several Cloud Run/GKE-specific concerns:

1. **DB_HOST socket-to-IP mapping** — When `DB_HOST` is a Unix socket path (Cloud Run) and `DB_IP` is available, overrides `DB_HOST` with `DB_IP` for TCP. MySQL 8.0's `caching_sha2_password` requires SSL over TCP, which PHP PDO cannot handle without explicit SSL setup; the socket path bypasses this. Also maps `DB_HOST` → `MYSQL_HOST`, `DB_USER` → `MYSQL_USER`, `DB_NAME` → `MYSQL_DATABASE`, `DB_PASSWORD` → `MYSQL_PASSWORD`.
2. **MySQL readiness wait** — Probes `MYSQL_HOST:MYSQL_PORT` via `/dev/tcp` for up to 60 seconds (30 × 2s) before proceeding.
3. **Database bootstrap fallback** — If the `db-init` job has not run or failed, uses `ROOT_PASSWORD` to create the database and user inline. Prefers Unix socket connection (bypassing `caching_sha2_password` requirement) over TCP for root access.
4. **NFS config/data persistence** — When `/mnt/nfs` is mounted: creates `nextcloud-config/` and `nextcloud-data/` with `www-data` ownership, symlinks `/var/www/html/config` → `/mnt/nfs/nextcloud-config`, and sets `NEXTCLOUD_DATA_DIR=/mnt/nfs/nextcloud-data`. Without this, `config.php` is ephemeral and `occ maintenance:install` re-runs on every restart.
5. **Runtime URL derivation (Cloud Run only)** — When `CLOUDRUN_SERVICE_URL` is set: derives `OVERWRITECLIURL` and `OVERWRITEHOST` from the URL, and appends the Cloud Run hostname to `NEXTCLOUD_TRUSTED_DOMAINS`. This is more reliable than Terraform-computed values that can diverge when `resource_prefix` in `Nextcloud_Common` differs from the `App_CloudRun` service name across separate applies.

---

## Default Initialization Job

When `initialization_jobs = []` (the default), `Nextcloud_Common` supplies a single default job:

| Field | Value |
|---|---|
| `name` | `"db-init"` |
| `description` | `"Create Nextcloud Database and User"` |
| `image` | `"mysql:8.0-debian"` |
| `script_path` | `abspath("${path.module}/scripts/db-init.sh")` |
| `execute_on_apply` | `true` |
| `max_retries` | `3` |
| `timeout_seconds` | `600` |

`db-init.sh` creates the `nextcloud` database (utf8mb4), drops and recreates the user with `mysql_native_password` authentication, grants all privileges, and verifies connectivity. It also sends the Cloud SQL Auth Proxy quit signal at the end (required for GKE Job completion).

---

## Inputs

### Required

| Name | Type | Description |
|---|---|---|
| `project_id` | `string` | GCP project ID. |
| `resource_prefix` | `string` | Prefix for resource naming (e.g. `appnextclouddemoa1b2c3`). |

### Application Identity

| Name | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"nextcloud"` | Application name used in resource naming. |
| `display_name` | `string` | `"Nextcloud"` | Human-readable name. |
| `description` | `string` | `"Nextcloud self-hosted..."` | Application description. |
| `application_version` | `string` | `"30"` | Nextcloud Docker image tag (e.g. `"30"` for nextcloud:30-apache). |
| `tenant_deployment_id` | `string` | `"demo"` | Deployment environment identifier. |
| `region` | `string` | `"us-central1"` | GCP region. |

### Database

| Name | Type | Default | Description |
|---|---|---|---|
| `db_name` | `string` | `"nextcloud"` | MySQL database name. |
| `db_user` | `string` | `"nextcloud"` | MySQL application user. |

### Container Resources

| Name | Type | Default | Description |
|---|---|---|---|
| `cpu_limit` | `string` | `"2000m"` | Container CPU limit. |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit. |
| `min_instance_count` | `number` | `1` | Minimum running instances. |
| `max_instance_count` | `number` | `3` | Maximum running instances. |

### Nextcloud-Specific

| Name | Type | Default | Description |
|---|---|---|---|
| `nextcloud_admin_user` | `string` | `"admin"` | Nextcloud administrator username. |
| `php_memory_limit` | `string` | `"512M"` | PHP memory limit. Baked into image via Docker ARG. |
| `upload_max_filesize` | `string` | `"512M"` | PHP `upload_max_filesize`. Baked into image. |
| `post_max_size` | `string` | `"512M"` | PHP `post_max_size`. Baked into image. |

### Caching

| Name | Type | Default | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `true` | Enable Redis caching. |
| `redis_host` | `string` | `""` | Redis hostname. Empty uses `$(REDIS_HOST)` sentinel. |
| `redis_port` | `string` | `"6379"` | Redis TCP port. |

### Environment & Secrets

| Name | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Additional plain-text env vars merged into the config. |
| `secret_environment_variables` | `map(string)` | `{}` | Additional secret references merged into the config. |

### Storage & Volumes

| Name | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts. |

### Health Probes

| Name | Type | Default |
|---|---|---|
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/status.php", initial_delay_seconds=60, timeout_seconds=10, period_seconds=15, failure_threshold=40 }` |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/status.php", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` |

Note: The startup `failure_threshold` is **40** in `Nextcloud_Common` (vs 20 in `Nextcloud_CloudRun`). The Common module allows 60s + 40×15s = 660s for `occ maintenance:install` to complete on a cold Cloud SQL instance.

### Jobs

| Name | Type | Default | Description |
|---|---|---|---|
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs. Empty list triggers the default `db-init` job. |

### Metadata

| Name | Type | Default | Description |
|---|---|---|---|
| `labels` | `map(string)` | `{}` | Labels applied to created resources. |
| `deployment_id` | `string` | `""` | Unique deployment identifier. |
| `deployment_id_suffix` | `string` | `""` | Random suffix portion of the deployment ID. |
| `service_url` | `string` | `""` | Predicted service URL (Cloud Run). Used for display purposes only. |

---

## License

Licensed under the [Apache 2.0 License](#).
