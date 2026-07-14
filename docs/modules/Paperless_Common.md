---
title: "Paperless-ngx Common Shared Configuration Module"
description: "Shared configuration reference for the Paperless-ngx module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Paperless-ngx Common Shared Configuration Module

The `Paperless Common` module defines the Paperless-ngx document management system configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates no GCP resources directly and produces a `config` output consumed by platform-specific wrapper modules (`Paperless CloudRun` and `Paperless GKE`). It also auto-generates two application secrets in Secret Manager.

## 1. Overview

**Purpose**: To centralise all Paperless-ngx-specific configuration (custom container image, PostgreSQL database setup, environment variable mapping, health probes, GCS Fuse media storage, and the `db-init` job definition) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Paperless_CloudRun  ──┐
└── Paperless_GKE       ──┤── instantiate Paperless_Common
                          ↓
             Paperless_Common (this module)
             Creates: PAPERLESS_ADMIN_PASSWORD secret
                      PAPERLESS_SECRET_KEY secret
             Produces: config, secret_ids, storage_buckets
                      ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                      ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Uses **PostgreSQL 15** (unlike Ghost Common which uses MySQL 8.0 — this is the standard for all other modules in the ecosystem).
- **Creates two GCP secrets** in Secret Manager: `PAPERLESS_ADMIN_PASSWORD` and `PAPERLESS_SECRET_KEY`. This is a key difference from Ghost Common (which creates no secrets) and similar to Django Common and Directus Common.
- Provides a **GCS Fuse media volume** as the primary persistence mechanism, rather than relying on NFS for document storage.
- The `PAPERLESS_SECRET_KEY` is a Django application secret — regenerating it invalidates all existing user sessions.
- Redis is **required** (not optional) — Paperless-ngx uses Redis as its Celery message broker for all background processing.

---

## 2. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"paperless"` |
| `application_version` | Version tag (default: `"latest"`) |
| `container_image` | `"ghcr.io/paperless-ngx/paperless-ngx"` (GHCR image used as build base) |
| `image_source` | `"custom"` — a custom wrapper image is built |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `true`) — mirrors the image to Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = {}` |
| `container_port` | `8000` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (default: `"paperless"`) |
| `db_user` | Database user (default: `"paperless"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | GCS Fuse volume mounts. When empty, a default `paperless-media` volume is auto-configured at `/usr/src/paperless/media` |
| `container_resources` | CPU: `2000m`, Memory: `2Gi` |
| `environment_variables` | Assembled from all Paperless-ngx-specific env var inputs (see §7) |
| `initialization_jobs` | Default `db-init` job or custom override (see §5) |
| `startup_probe` | HTTP `GET /`, 60s initial delay, 10s timeout, 10s period, 30 failure threshold |
| `liveness_probe` | HTTP `GET /`, 60s initial delay, 10s timeout, 30s period, 3 failure threshold |

### `secret_ids`
A map of environment variable names to Secret Manager secret IDs. These are injected into the container at runtime by the platform module.

| Key | Secret Description |
|---|---|
| `PAPERLESS_ADMIN_PASSWORD` | Initial admin account password. Auto-generated 24-character random string. |
| `PAPERLESS_SECRET_KEY` | Django application secret key. Auto-generated 64-character random string. Used for session signing and CSRF protection. |

### `storage_buckets`
A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|---|---|
| `name_suffix` | `"media"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` |

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"paperless"` | Application name used in resource naming |
| `application_version` | `string` | `"latest"` | Paperless-ngx image version tag. Pin to a specific release for production |
| `description` | `string` | `"Paperless-ngx - open-source document management system"` | Application description |
| `db_name` | `string` | `"paperless"` | PostgreSQL database name |
| `db_user` | `string` | `"paperless"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"2000m"` | Container CPU limit |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables passed to the container |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs; empty triggers the default `db-init` job |
| `startup_probe` | `object` | see §4 | Startup health probe configuration |
| `liveness_probe` | `object` | see §4 | Liveness health probe configuration |
| `enable_image_mirroring` | `bool` | `true` | Mirror the GHCR image to Artifact Registry before deployment |
| `min_instance_count` | `number` | `1` | Minimum running instances |
| `max_instance_count` | `number` | `3` | Maximum running instances |

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts. Empty triggers default paperless-media auto-mount at `/usr/src/paperless/media` |
| `region` | `string` | `"us-central1"` | Region for the storage bucket |

### Paperless-ngx Settings

| Variable | Type | Default | Description |
|---|---|---|---|
| `time_zone` | `string` | `"UTC"` | Timezone for document timestamps and scheduled tasks |
| `ocr_language` | `string` | `"eng"` | Tesseract OCR language code(s). Use `+` to combine multiple |
| `admin_user` | `string` | `"admin"` | Username for the auto-created superuser |
| `admin_email` | `string` | `"admin@example.com"` | Email for the auto-created superuser |
| `service_url` | `string` | `""` | The public URL of the service. Used for `PAPERLESS_URL`. |

### External Integration

| Variable | Type | Default | Description |
|---|---|---|---|
| `redis_host` | `string` | `null` | Redis host IP or hostname. Leave empty to use NFS server IP |
| `redis_port` | `string` | `"6379"` | Redis TCP port |
| `enable_redis` | `bool` | `true` | Enable Redis as the Celery broker and result backend |
| `redis_auth` | `string` | `""` | Redis AUTH password. Sensitive |
| `nfs_server_ip` | `string` | `null` | NFS server IP used as Redis host fallback when `enable_redis = true` and no `redis_host` provided |

---

## 4. Health Probes

All probes target `GET /` (the Paperless-ngx login page, which returns HTTP 200 when fully initialised):

| Probe | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|
| **Startup** | 60s | 10s | 10s | 30 | Allows roughly 360s total (60s delay + 30 × 10s) for Paperless-ngx to complete database migrations and start Celery workers |
| **Liveness** | 60s | 10s | 30s | 3 | Restarts the container if Paperless-ngx becomes unresponsive |

**Why the generous startup threshold:** Paperless-ngx applies Django database migrations on first boot. On a fresh database, this can include dozens of migration steps — particularly for the initial schema creation covering documents, tags, correspondents, document types, and custom fields. The `failure_threshold = 30` with `period_seconds = 10` gives roughly 360 seconds of total startup tolerance (including the 60s initial delay), covering even slow Cloud SQL instances with many pending migrations.

Unlike Ghost Common, Paperless Common does **not** define a readiness probe — startup and liveness are sufficient for the Cloud Run and GKE deployment models.

---

## 5. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|---|---|
| Image | PostgreSQL client image |
| Script | `scripts/db-init.sh` |
| Secrets required | `DB_PASSWORD` (app user) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |

`db-init.sh` behaviour:
1. Resolves the Cloud SQL connection from `DB_HOST` (Unix socket path under `/cloudsql` when `enable_cloudsql_volume = true`).
2. Polls the database using the PostgreSQL client (up to 30 retries, 2s apart) until it is reachable.
3. Creates the application user (`paperless`) with the password from Secret Manager (`DB_PASSWORD`) if it does not already exist.
4. Creates the `paperless` database if it does not already exist, owned by the application user.
5. Grants all necessary privileges on the database.
6. Signals Cloud SQL Proxy shutdown after completion.

Override `initialization_jobs` with a non-empty list to replace this default with custom jobs. Each custom job must specify at least one of `command`, `args`, or `script_path`.

---

## 6. Secrets Created by Paperless Common

Unlike Ghost Common (which creates no secrets), Paperless Common auto-provisions two Secret Manager secrets at apply time. These secrets are created in the same GCP project as the deployment and are injected into the container at runtime via the platform module's `module_secret_env_vars` mechanism.

| Secret Name Pattern | Env Var | Value | Rotation |
|---|---|---|---|
| `secret-<resource-prefix>-paperless-admin-password` | `PAPERLESS_ADMIN_PASSWORD` | 24-character random alphanumeric string | Not rotated automatically. Retrieve from Secret Manager for first login. |
| `secret-<resource-prefix>-paperless-key` | `PAPERLESS_SECRET_KEY` | 64-character random alphanumeric string | Not rotated automatically. Rotating this value invalidates all active user sessions. |

**Important:** The `PAPERLESS_ADMIN_PASSWORD` secret is consumed only during the initial superuser creation. After the first Paperless-ngx startup, the admin user exists in the PostgreSQL database and the password can be changed via the Paperless-ngx UI. However, the Secret Manager secret retains the original value — use `gcloud secrets versions access latest` to retrieve it for initial login if the password has not been changed.

**`PAPERLESS_SECRET_KEY` stability:** Django uses this key for session signing, CSRF tokens, and password reset links. If the key is regenerated (e.g., by destroying and redeploying the module), all existing user sessions are invalidated and all outstanding password reset links become invalid. This is intentional security behaviour.

---

## 7. Paperless-ngx Environment Variable Assembly

Paperless Common assembles the following environment variables and injects them into the `config.environment_variables` map, which the platform module passes to the container at runtime. These are merged with any additional `environment_variables` passed by the wrapper module.

| Environment Variable | Source | Description |
|---|---|---|
| `PAPERLESS_PORT` | Hardcoded: `"8000"` | Gunicorn server port |
| `PAPERLESS_DBENGINE` | Hardcoded: `"postgresql"` | Database engine |
| `PAPERLESS_DBPORT` | Hardcoded: `"5432"` | PostgreSQL port |
| `PAPERLESS_MEDIA_ROOT` | Hardcoded: `"/usr/src/paperless/media"` | GCS Fuse mount point for persistent document storage |
| `PAPERLESS_DATA_ROOT` | Hardcoded: `"/usr/src/paperless/data"` | Ephemeral metadata directory |
| `PAPERLESS_CONSUMPTION_DIR` | Hardcoded: `"/usr/src/paperless/consume"` | Drop folder for automatic document ingestion |
| `PAPERLESS_URL` | `var.service_url` | Public URL of the service. Set to the predicted Cloud Run or load balancer URL. |
| `PAPERLESS_ALLOWED_HOSTS` | Hardcoded: `"*"` | Django allowed hosts. `*` permits all host headers. |
| `PAPERLESS_CORS_ALLOWED_HOSTS` | `var.service_url` (or `"*"` when unset) | Django CORS allowed hosts. |
| `PAPERLESS_TIME_ZONE` | `var.time_zone` | Timezone for document date parsing and scheduled tasks |
| `PAPERLESS_OCR_LANGUAGE` | `var.ocr_language` | Tesseract language code(s) for OCR |
| `PAPERLESS_WEBSERVER_WORKERS` | Hardcoded: `"2"` | Number of gunicorn workers |
| `USERMAP_UID` | Hardcoded: `"1000"` | UID for the container user |
| `USERMAP_GID` | Hardcoded: `"1000"` | GID for the container user |
| `PAPERLESS_ADMIN_USER` | `var.admin_user` | Username for the auto-created superuser |
| `PAPERLESS_ADMIN_MAIL` | `var.admin_email` | Email for the auto-created superuser |
| `PAPERLESS_TIKA_ENABLED` | Hardcoded: `"false"` | Tika/Gotenberg office document conversion. Enable via `environment_variables` override |
| `PAPERLESS_REDIS` | Assembled from `redis_host`/`redis_port` | Redis URL for Celery broker. Format: `redis://:auth@host:port` or `redis://host:port` |

**Redis URL assembly:** The `PAPERLESS_REDIS` variable is assembled at apply time:
- If `redis_auth` is non-empty: `redis://:${redis_auth}@${redis_host}:${redis_port}`
- Otherwise: `redis://${redis_host}:${redis_port}`
- If `redis_host` is empty (or null): the NFS server IP is substituted — `nfs_server_ip` when provided, otherwise the `$(NFS_SERVER_IP)` runtime placeholder that App_CloudRun / App_GKE resolve at deploy time.
- If `enable_redis = false`: `redis://localhost:6379` is used.

---

## 8. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as the Docker build context.

### `Dockerfile`
Thin wrapper around the public `ghcr.io/paperless-ngx/paperless-ngx:<version>` image:
- Switches to `USER root` and copies `entrypoint.sh` in as `/platform-entrypoint.sh`.
- Exposes port `8000`.
- Sets `ENTRYPOINT ["/platform-entrypoint.sh"]`, replacing the upstream entrypoint.

### `entrypoint.sh`
Runs before the upstream Paperless-ngx process starts:
- Maps the platform-injected `DB_HOST`/`DB_IP`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` env vars onto the Paperless-ngx-native `PAPERLESS_DBHOST`/`PAPERLESS_DBUSER`/`PAPERLESS_DBNAME`/`PAPERLESS_DBPASS` vars (preferring `DB_IP` over a socket-path `DB_HOST` since Paperless-ngx needs a TCP hostname/IP, not a Unix socket).
- Reconstructs `PAPERLESS_REDIS` from `NFS_SERVER_IP` if it still contains an unresolved `$(NFS_SERVER_IP)` placeholder (Cloud Run only resolves `$(VAR)` references in declaration order).
- `exec`s `/init` — the upstream image's s6-overlay supervisor, which starts gunicorn (the web process) and the Celery worker/beat processes. The `PAPERLESS_WEBSERVER_WORKERS=2` environment variable controls the gunicorn worker count; the Celery worker count is managed by Paperless-ngx internally.

### `db-init.sh`
PostgreSQL initialisation script executed by the `db-init` Cloud Run Job or Kubernetes Job during first deployment. See §5 for detailed behaviour.

---

## 9. GCS Fuse Media Volume

The `paperless-media` GCS bucket is the primary persistence layer for all processed Paperless-ngx content. Unlike other modules that use NFS for application data, Paperless-ngx mounts GCS directly via GCS Fuse at `/usr/src/paperless/media`.

**Default volume configuration (when `gcs_volumes = []`):**

| Field | Value |
|---|---|
| `name` | `"paperless-media"` |
| `bucket_name` | Auto-provisioned `gcs-paperless<tenant-resource-prefix>-media` bucket (the bucket name the foundation actually creates — app-scoped, tenant-prefixed) |
| `mount_path` | `"/usr/src/paperless/media"` |
| `readonly` | `false` |
| `mount_options` | `["implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s", "uid=1000", "gid=1000", "file-mode=0664", "dir-mode=0775"]` — the uid/gid options make the mount writable by the non-root Paperless-ngx user on GKE's GCS Fuse CSI driver |

**Directory structure under `/usr/src/paperless/media`:**

```
/usr/src/paperless/media/
├── documents/
│   ├── originals/       # Original uploaded files (PDF, images, office docs)
│   ├── archive/         # OCR-processed, searchable PDFs (if archiving enabled)
│   └── thumbnails/      # Preview thumbnails for the web UI
```

**`PAPERLESS_DATA_ROOT`** (`/usr/src/paperless/data`) is intentionally ephemeral — it contains lock files, the SQLite database used for task state (in addition to PostgreSQL), and index files. These are recreated on startup and do not need to persist across Cloud Run revisions.

**`PAPERLESS_CONSUMPTION_DIR`** (`/usr/src/paperless/consume`) is the drop folder for document ingestion. Documents placed in this directory are automatically picked up by the Celery consumption task and moved to `/usr/src/paperless/media/documents/originals` after processing. In Cloud Run, this directory is ephemeral — for automated consumption, use the Paperless-ngx REST API or the web UI upload rather than filesystem drops.

---

## 10. Platform-Specific Differences

| Aspect | Paperless CloudRun | Paperless GKE |
|---|---|---|
| `min_instance_count` | `0` (default in `variables.tf`; user-configurable) | `1` (default in `variables.tf`; user-configurable) |
| `max_instance_count` | `3` (default in `variables.tf`; user-configurable) | `3` (default in `variables.tf`; user-configurable) |
| `GCS Fuse` | Mounted via Cloud Run native GCS Fuse volume | Mounted via GCS Fuse CSI Driver |
| `PAPERLESS_URL` | Set to predicted Cloud Run service URL | Set to load balancer or custom domain URL |
| `Redis` | Required; defaults to NFS server IP when `redis_host` blank | Required; defaults to NFS server IP when `redis_host` blank |
| `db-init` job | Cloud Run Job | Kubernetes Job |
| `PAPERLESS_CONSUMPTION_DIR` | Ephemeral (local to instance) | Ephemeral unless NFS-mounted |
| Session affinity | Not applicable (stateless Cloud Run) | `ClientIP` by default — prevents Django session routing issues |

---

## 11. Implementation Pattern

```hcl
# Example: how Paperless_CloudRun instantiates Paperless_Common

module "paperless_app" {
  source = "../Paperless_Common"

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  description            = var.description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  time_zone              = var.time_zone
  ocr_language           = var.ocr_language
  admin_user             = var.admin_user
  admin_email            = var.admin_email
  enable_redis           = var.enable_redis
  redis_host             = var.redis_host
  redis_port             = var.redis_port
  redis_auth             = var.redis_auth
}

locals {
  application_modules    = { paperless = module.paperless_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.paperless_app.secret_ids
  module_storage_buckets = module.paperless_app.storage_buckets
  scripts_dir            = abspath("${module.paperless_app.path}/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_secret_env_vars = local.module_secret_env_vars
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... other inputs
}
```

---

## 12. Exploring with the GCP Console

After deployment, the following GCP Console areas are most relevant to `Paperless Common`-managed resources.

**Secret Manager — Application Secrets**
Navigate to **Security → Secret Manager**. Filter by the deployment prefix. The two secrets created by `Paperless Common` are:
- `secret-<resource-prefix>-paperless-admin-password`: Click **View secret value** on the latest version to retrieve the initial admin password for first login.
- `secret-<resource-prefix>-paperless-key`: The Django secret key. No need to view this in normal operation — it is injected automatically into the container.

For each secret, the **Versions** tab shows all historical versions. `Paperless Common` creates a single version on the first apply. Secret Manager retains all versions until explicitly disabled or destroyed.

**Cloud Storage — Media Bucket**
Navigate to **Cloud Storage → Buckets → `gcs-paperless<tenant-resource-prefix>-media`**. This bucket holds all Paperless-ngx persistent document data. Key directories to inspect:
- `documents/originals/` — Original uploaded files, organised by year/month/day.
- `documents/thumbnails/` — JPEG thumbnail previews for the web UI.
- `documents/archive/` — OCR-processed searchable PDFs (if archive mode is enabled in Paperless-ngx settings).

The bucket's **Permissions** tab shows that the Cloud Run service account has `roles/storage.objectAdmin` on this bucket, granted by `App_CloudRun`.

**Cloud SQL — Database Verification**
Navigate to **SQL → Instances → `<instance-name>` → Databases**. The `paperless` database created by `db-init` is listed here. Click the database name to see its character set and collation (`UTF8` / `en_US.UTF-8` for PostgreSQL 15).

---

## 13. Exploring with gcloud

```bash
# Retrieve the initial admin password for first login
gcloud secrets versions access latest \
  --secret="secret-RESOURCE_PREFIX-paperless-admin-password" \
  --project=PROJECT_ID

# List all Secret Manager secrets created by Paperless Common
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:paperless" \
  --format="table(name,replication.automatic,createTime)"

# List versions of the admin password secret
gcloud secrets versions list secret-RESOURCE_PREFIX-paperless-admin-password \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Inspect the media bucket contents (processed documents)
# SERVICE_NAME = paperless<tenant-resource-prefix>
gcloud storage ls --recursive gs://gcs-SERVICE_NAME-media/documents/

# Count objects in the media bucket (useful for monitoring growth)
gcloud storage ls --recursive gs://gcs-SERVICE_NAME-media/ | wc -l

# Check bucket size
gcloud storage du gs://gcs-SERVICE_NAME-media/ \
  --summarize \
  --readable-sizes

# Verify bucket IAM bindings (confirm Cloud Run SA has objectAdmin)
gcloud storage buckets get-iam-policy gs://gcs-SERVICE_NAME-media

# List all Cloud Run Jobs (db-init lives here)
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,metadata.creationTimestamp)"

# Check the db-init job execution history (job name = SERVICE_NAME-db-init)
gcloud run jobs executions list \
  --job=SERVICE_NAME-db-init \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,completionStatus,startTime,completionTime)"

# Re-run the db-init job (idempotent — safe to run again)
gcloud run jobs execute SERVICE_NAME-db-init \
  --project=PROJECT_ID \
  --region=REGION \
  --wait

# Stream db-init job logs
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="SERVICE_NAME-db-init"' \
  --project=PROJECT_ID \
  --freshness=1h \
  --format="table(timestamp,textPayload)" \
  --order=asc

# Verify PostgreSQL database was created (connect via Cloud SQL proxy)
# First: start the proxy locally
cloud_sql_proxy -instances=PROJECT_ID:REGION:SQL_INSTANCE_NAME=tcp:5432 &
psql -h 127.0.0.1 -U paperless -d paperless -c "\dt" # list tables

# Check Redis connectivity (if using Memorystore)
gcloud redis instances describe REDIS_INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,authEnabled)"
```
