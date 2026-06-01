---
title: "Dify_Common Shared Configuration Module"
sidebar_label: "Dify Common"
---

# Dify_Common Shared Configuration Module

The `Dify_Common` module defines the Dify LLM application platform configuration for the RAD Modules ecosystem. It is a **shared configuration module** — it creates a small set of GCP resources (Secret Manager secret) and produces `config`, `secret_ids`, `storage_buckets`, `secret_values`, and `path` outputs consumed by the platform-specific wrapper modules (`Dify_CloudRun` and `Dify_GKE`).

## 1. Overview

**Purpose**: To centralise all Dify-specific configuration (custom container image, PostgreSQL 15 + pgvector setup, Redis/Celery environment variables, storage bucket, SECRET_KEY generation, and initialisation job) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Dify_CloudRun  ──┐
└── Dify_GKE       ──┤── instantiate Dify_Common
                      ↓
           Dify_Common (this module)
           Creates: Secret Manager secret (SECRET_KEY)
           Produces: config, secret_ids, storage_buckets, secret_values, path
                      ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                      ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Uses **PostgreSQL 15** with the `pgvector` extension enabled — Dify uses pgvector as its default vector store.
- Creates **one GCP resource**: a Secret Manager secret for the `SECRET_KEY` (64-character random value).
- Configures **three Redis connection paths**: Celery broker (db 1), Celery backend (db 1), and event bus (db 0).
- The `GOOGLE_STORAGE_BUCKET_NAME` is set to `<resource_prefix>-storage` — this bucket is provisioned by `App_CloudRun`/`App_GKE` and used by Dify for file storage via the Google Storage driver.
- The `db-init.sh` script creates the PostgreSQL database and user idempotently using `postgres:15-alpine`.
- The `$(NFS_SERVER_IP)` placeholder in Redis configuration is resolved at runtime by `App_CloudRun`/`App_GKE` when `redis_host` is not provided.

---

## 2. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"dify"` |
| `display_name` | `var.display_name` |
| `description` | `var.description` |
| `container_image` | `"langgenius/dify-api"` |
| `application_version` | `var.application_version` (default: `"0.15.0"`) |
| `image_source` | `"custom"` — a custom wrapper image is built via Cloud Build |
| `enable_image_mirroring` | `var.enable_image_mirroring` |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = {}` |
| `container_port` | `5001` — Dify API server port |
| `database_type` | `"POSTGRES_15"` — Dify requires PostgreSQL |
| `db_name` | `var.db_name` (default: `"dify_db"`) |
| `db_user` | `var.db_user` (default: `"dify_user"`) |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | `var.gcs_volumes` |
| `enable_postgres_extensions` | `true` — always enabled |
| `postgres_extensions` | `["vector"]` — pgvector for vector similarity search |
| `container_resources` | CPU: `var.cpu_limit`, Memory: `var.memory_limit` |
| `min_instance_count` | `var.min_instance_count` |
| `max_instance_count` | `var.max_instance_count` |
| `startup_probe` | `var.startup_probe` (HTTP `/health`, 30 s delay) |
| `liveness_probe` | `var.liveness_probe` (HTTP `/health`, 30 s delay) |
| `initialization_jobs` | Default `db-init` job or custom override |
| `additional_services` | `[]` — web service is defined at the wrapper level |

### `environment_variables` (within `config`)

The following environment variables are set automatically by `Dify_Common`:

| Variable | Value | Description |
|---|---|---|
| `DIFY_BIND_ADDRESS` | `"0.0.0.0"` | API bind address |
| `DIFY_PORT` | `"5001"` | API server port |
| `SERVER_WORKER_AMOUNT` | `"2"` | Gunicorn worker count |
| `GUNICORN_TIMEOUT` | `"360"` | Gunicorn request timeout |
| `DEPLOY_ENV` | `"PRODUCTION"` | Deployment environment |
| `MIGRATION_ENABLED` | `"true"` | Runs Flask-Migrate on startup |
| `DB_TYPE` | `"postgresql"` | Database type |
| `DB_USERNAME` | `"$(DB_USER)"` | Platform-injected database user |
| `DB_DATABASE` | `"$(DB_NAME)"` | Platform-injected database name |
| `REDIS_HOST` | Resolved Redis host (NFS IP or `redis_host`) | Redis connection |
| `REDIS_PORT` | `var.redis_port` | Redis port |
| `REDIS_PASSWORD` | `var.redis_auth` (if set) | Redis authentication |
| `REDIS_USE_SSL` | `"false"` | Redis SSL mode |
| `REDIS_DB` | `"0"` | Redis database index |
| `CELERY_BROKER_URL` | `redis://<auth>@<host>:<port>/1` | Celery task broker |
| `CELERY_BACKEND` | `redis://<auth>@<host>:<port>/1` | Celery result backend |
| `BROKER_USE_SSL` | `"false"` | Celery broker SSL mode |
| `EVENT_BUS_REDIS_URL` | `redis://<auth>@<host>:<port>/0` | SSE/WebSocket event bus |
| `STORAGE_TYPE` | `"google-storage"` | Storage backend |
| `GOOGLE_STORAGE_BUCKET_NAME` | `"<resource_prefix>-storage"` | GCS bucket for Dify files |
| `VECTOR_STORE` | `"pgvector"` | Vector store backend |
| `PGVECTOR_HOST` | `"$(DB_IP)"` | pgvector host (TCP IP) |
| `PGVECTOR_PORT` | `"5432"` | pgvector port |
| `PGVECTOR_USER` | `"$(DB_USER)"` | pgvector user |
| `PGVECTOR_PASSWORD` | `"$(DB_PASSWORD)"` | pgvector password |
| `PGVECTOR_DATABASE` | `"$(DB_NAME)"` | pgvector database |
| `CONSOLE_API_URL` | `var.service_url` | Dify console API URL |
| `CONSOLE_WEB_URL` | `var.service_url` | Dify console web URL |
| `SERVICE_API_URL` | `var.service_url` | Dify service API URL |
| `APP_API_URL` | `var.service_url` | Dify app API URL |
| `APP_WEB_URL` | `var.service_url` | Dify app web URL |
| `FILES_URL` | `var.service_url` | Dify files URL |
| `WEB_API_CORS_ALLOW_ORIGINS` | `"*"` | CORS origins (restrict in production) |
| `CONSOLE_CORS_ALLOW_ORIGINS` | `"*"` | Console CORS origins |
| `CHECK_UPDATE_URL` | `""` | Disables update check |
| `LOG_LEVEL` | `"INFO"` | Application log level |

### `secret_ids`

| Key | Secret | Description |
|---|---|---|
| `SECRET_KEY` | `<resource_prefix>-secret-key` | 64-character random JWT signing key |

### `storage_buckets`

| Field | Value |
|---|---|
| `name_suffix` | `"dify-storage"` |
| `name` | `"<resource_prefix>-storage"` |
| `location` | `var.region` |
| `storage_class` | `"STANDARD"` |
| `public_access_prevention` | `"inherited"` |

### `path`

The module directory path (`path.module`). Used by wrapper modules to resolve `scripts_dir`.

---

## 3. Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. **Required.** |
| `resource_prefix` | `string` | — | Prefix for resource naming. Must match the resource_prefix used by the calling module. |
| `labels` | `map(string)` | `{}` | Labels to apply to resources. |
| `tenant_deployment_id` | `string` | `"demo"` | Unique tenant/deployment identifier. |
| `deployment_id` | `string` | `""` | Random deployment ID suffix. |
| `region` | `string` | `"us-central1"` | GCP region for resource deployment. |
| `application_name` | `string` | `"dify"` | Application name. |
| `application_version` | `string` | `"latest"` | Application version tag. |
| `display_name` | `string` | `"Dify - LLM Application Platform"` | Application display name. |
| `description` | `string` | (Dify description) | Application description. |
| `db_name` | `string` | `"dify"` | Database name. |
| `db_user` | `string` | `"dify"` | Database user. |
| `cpu_limit` | `string` | `"2000m"` | CPU limit for the container. |
| `memory_limit` | `string` | `"4Gi"` | Memory limit for the container. |
| `min_instance_count` | `number` | `1` | Minimum number of instances. |
| `max_instance_count` | `number` | `3` | Maximum number of instances. |
| `startup_probe` | `object` | (HTTP `/health`, 30 s) | Startup probe configuration. |
| `liveness_probe` | `object` | (HTTP `/health`, 30 s) | Liveness probe configuration. |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables merged into the container spec. |
| `enable_cloudsql_volume` | `bool` | `true` | Enable Cloud SQL Auth Proxy sidecar. |
| `initialization_jobs` | `list(any)` | `[]` | Initialization jobs configuration. |
| `service_url` | `string` | `""` | The URL where the service will be accessible. Used for all Dify service URL variables. |
| `db_host` | `string` | `null` | Database host (IP or socket path). |
| `redis_host` | `string` | `null` | Redis host. Defaults to NFS server IP or `$(NFS_SERVER_IP)` placeholder. |
| `redis_port` | `string` | `"6379"` | Redis port. |
| `enable_redis` | `bool` | `true` | Enable Redis (required for Dify Celery task queue and caching). |
| `redis_auth` | `string` | `""` | Redis authentication password. Sensitive. |
| `nfs_server_ip` | `string` | `null` | NFS server IP used for Redis when no host is provided. |
| `bucket_name` | `string` | `""` | GCS bucket name for Dify storage. |
| `service_account_email` | `string` | `""` | Service account email for GCS access. |
| `enable_image_mirroring` | `bool` | `true` | Enable image mirroring to Artifact Registry. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts. |

---

## 4. Default Initialization Job

When `initialization_jobs = []` (the default), `Dify_Common` injects a single `db-init` job:

| Field | Value |
|---|---|
| `name` | `"db-init"` |
| `description` | `"Create Dify Database and User"` |
| `image` | `"postgres:15-alpine"` |
| `cpu_limit` | `"1000m"` |
| `memory_limit` | `"512Mi"` |
| `timeout_seconds` | `600` |
| `execute_on_apply` | `true` |
| `script_path` | `Dify_Common/scripts/db-init.sh` |

The script creates the PostgreSQL database user and database idempotently. It runs via the Cloud SQL Auth Proxy Unix socket (Cloud Run) or via the Auth Proxy sidecar (GKE).

Provide a non-empty `initialization_jobs` list to replace this default with custom jobs entirely.

---

## 5. Redis URL Construction

`Dify_Common` constructs Redis URLs based on the following logic:

1. If `enable_redis = false` — all Redis variables are set to empty strings.
2. If `redis_host` is provided — use it directly.
3. If `nfs_server_ip` is provided — use it as the host.
4. Otherwise — use the `$(NFS_SERVER_IP)` placeholder, which `App_CloudRun`/`App_GKE` resolves at runtime.

When `redis_auth` is set, the auth segment is included as `:password@` in the URL. An empty `redis_auth` produces clean `redis://host:port/db` URLs without a malformed `:@` segment.
