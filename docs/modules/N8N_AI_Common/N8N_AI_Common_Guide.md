---
title: "N8N AI Common Shared Configuration Module"
sidebar_label: "Common"
---

# N8N_AI_Common Shared Configuration Module

The `N8N_AI_Common` module defines the n8n workflow automation platform with an integrated AI stack (Qdrant vector database and Ollama LLM provider) for the RAD Modules ecosystem. It **creates GCP resources** (two Secret Manager secrets) and produces a `config` output consumed by platform-specific wrapper modules (`N8N_AI_CloudRun` and `N8N_AI_GKE`).

## 1. Overview

**Purpose**: To centralize all n8n-specific configuration — including the AI sidecar services (Qdrant, Ollama), Redis queue backend, GCS-backed workflow data storage, SMTP credentials, and an encryption key secret — in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── N8N_AI_CloudRun  ──┐
└── N8N_AI_GKE       ──┤── instantiate N8N_AI_Common
                       ↓
          N8N_AI_Common (this module)
          Creates: 2 Secret Manager secrets (SMTP password, encryption key)
          Produces: config, storage_buckets, secret_values,
                    smtp_password_secret_id, encryption_key_secret_id, path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- The only `*_Common` module that defines **additional sidecar services** (`additional_services`) — Qdrant and Ollama run alongside n8n as companion containers/services, each with their own image, port, probes, and volume mounts.
- Uses a **GCS Fuse volume** (`/home/node/.n8n`) as the primary n8n data store, mounted with UID/GID 1000 (`node` user). A second GCS volume (`/mnt/gcs`) is shared between n8n, Qdrant, and Ollama.
- **Redis is enabled by default** (`enable_redis = true`) for queue-mode operation; supports `$(NFS_SERVER_IP)` placeholder resolution at runtime for NFS-hosted Redis.
- Supports an optional `container_resources` override object to replace `cpu_limit`/`memory_limit` individually — the Ollama sidecar inherits the same CPU/memory limits as the main container.

---

## 2. GCP Resources Created

| Secret ID | Content | Purpose |
|-----------|---------|---------|
| `<wrapper_prefix>-smtp-password` | 16-char random alphanumeric | n8n outbound SMTP password |
| `<wrapper_prefix>-encryption-key` | 32-char random (with special chars) | n8n `N8N_ENCRYPTION_KEY` — encrypts stored credentials in the database |

Both secrets use automatic global replication. A 30-second `time_sleep` is applied after both secret versions are written before the secret ID outputs are resolved.

---

## 3. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | from `application_name` (default: `"n8nai"`) |
| `display_name` | from `application_display_name` (default: `"N8N AI Starter Kit"`) |
| `container_image` | `"n8nio/n8n"` (public image used as build base) |
| `image_source` | `"custom"` — a custom wrapper image is built |
| `enable_image_mirroring` | `true` (configurable variable — default: `true`) |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, no build args |
| `container_port` | `5678` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (default: `"n8n_db"`) |
| `db_user` | Database user (default: `"n8n_user"`) |
| `enable_cloudsql_volume` | Whether to mount Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Merged list: caller's `gcs_volumes` + a fixed `n8n-data` volume at `/mnt/gcs` |
| `container_resources` | From `var.container_resources` if set, else `cpu_limit`/`memory_limit` |
| `min_instance_count` | `0` (scale-to-zero) |
| `max_instance_count` | `3` |
| `environment_variables` | Merged map — see §4 |
| `enable_postgres_extensions` | `false` |
| `postgres_extensions` | `[]` |
| `initialization_jobs` | Default `db-init` job or custom override — see §6 |
| `startup_probe` | HTTP `GET /`, 120s initial delay, 3s timeout, 10s period, 3 failure threshold |
| `liveness_probe` | HTTP `GET /`, 30s initial delay, 5s timeout, 30s period, 3 failure threshold |
| `additional_services` | Conditional list of Qdrant and/or Ollama sidecar services — see §5 |

### `storage_buckets`
One GCS bucket for shared n8n, Qdrant, and Ollama data:

| Field | Value |
|-------|-------|
| `name` | `<wrapper_prefix>-storage` (explicit name, not just a suffix) |
| `name_suffix` | `"n8n-data"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` |

### `smtp_password_secret_id` / `encryption_key_secret_id`
Individual outputs exposing the Secret Manager secret IDs for each secret, with `depends_on` on the 30-second propagation wait. Used by wrapper modules to inject secrets into the container via Secret Manager references.

### `secret_values`
A **sensitive** map of raw generated values for GKE deployments that bypass Secret Manager read-after-write:

```hcl
{
  N8N_SMTP_PASS      = "<16-char password>"
  N8N_ENCRYPTION_KEY = "<32-char key>"
}
```

### `path`
Absolute path to the module directory, used by wrapper modules to locate `scripts/`.

---

## 4. Environment Variables

The module merges caller-provided `environment_variables` with a fixed set of n8n runtime configuration:

### Default Variables (from `var.environment_variables`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_TYPE` | `"postgresdb"` | n8n database backend |
| `DB_POSTGRESDB_PORT` | `"5432"` | PostgreSQL port |
| `DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED` | `"false"` | Disable SSL cert verification (private IP) |
| `N8N_USER_MANAGEMENT_DISABLED` | `"false"` | Enable user management |
| `EXECUTIONS_DATA_SAVE_ON_ERROR` | `"all"` | Persist all failed execution data |
| `EXECUTIONS_DATA_SAVE_ON_SUCCESS` | `"all"` | Persist all successful execution data |
| `GENERIC_TIMEZONE` / `TZ` | `"UTC"` | Timezone |
| `N8N_DEFAULT_BINARY_DATA_MODE` | `"filesystem"` | Store binary data on disk (GCS Fuse) |
| `N8N_EMAIL_MODE` | `"smtp"` | Email delivery mode |
| `N8N_SMTP_HOST` | `""` | SMTP server hostname (caller must set) |
| `N8N_SMTP_PORT` | `"587"` | SMTP port |
| `N8N_SMTP_USER` | `""` | SMTP username (caller must set) |
| `N8N_SMTP_SENDER` | `""` | From address (caller must set) |
| `N8N_SMTP_SSL` | `"false"` | Use STARTTLS rather than SSL |

### Fixed Variables (always set by the module)

| Variable | Value | Purpose |
|----------|-------|---------|
| `N8N_PORT` | `"5678"` | n8n listening port |
| `N8N_PROTOCOL` | `"https"` | Public protocol |
| `N8N_DIAGNOSTICS_ENABLED` | `"true"` | Usage telemetry |
| `N8N_METRICS` | `"true"` | Prometheus metrics endpoint |
| `N8N_SECURE_COOKIE` | `"false"` | Disable secure cookie flag (Cloud Run terminates TLS) |
| `N8N_DEFAULT_BINARY_DATA_MODE` | `"filesystem"` | Override to filesystem |
| `WEBHOOK_URL` | `var.service_url` | Public webhook base URL |
| `N8N_EDITOR_BASE_URL` | `var.service_url` | Editor base URL |
| `DB_TYPE` | `"postgresdb"` | Override to ensure PostgreSQL |
| `ENABLE_REDIS` | `"true"` / `"false"` | Redis queue mode flag |
| `QUEUE_BULL_REDIS_HOST` | `var.redis_host` or `"$(NFS_SERVER_IP)"` | Redis host; placeholder expanded at runtime |
| `QUEUE_BULL_REDIS_PORT` | `var.redis_port` | Redis port (when enabled) |
| `QUEUE_BULL_REDIS_PASSWORD` | `var.redis_auth` | Redis auth (when set) |

---

## 5. AI Sidecar Services (`additional_services`)

This is the defining feature of `N8N_AI_Common`. When `enable_ai_components = true`, the `config.additional_services` list includes one or both of the following companion services, deployed alongside n8n:

### Qdrant (Vector Database)
Enabled when `enable_qdrant = true` (default).

| Field | Value |
|-------|-------|
| Image | `qdrant/qdrant:<qdrant_version>` (default: `latest`) |
| Port | `6333` |
| CPU / Memory | `1000m` / `1Gi` |
| Min / Max instances | `1` / `1` (always running) |
| Ingress | `INGRESS_TRAFFIC_INTERNAL_ONLY` |
| Output env var | `QDRANT_URL` — injected into n8n so it can reach Qdrant |
| Storage path | `QDRANT__STORAGE__STORAGE_PATH = "/mnt/gcs/qdrant"` |
| Volume mount | `n8n-data` GCS bucket at `/mnt/gcs` (shared with n8n) |
| Startup probe | `GET /readyz`, 15s delay, 5s timeout, 10s period, 10 threshold |

### Ollama (Local LLM Provider)
Enabled when `enable_ollama = true` (default).

| Field | Value |
|-------|-------|
| Image | `ollama/ollama:<ollama_version>` (default: `latest`) |
| Port | `11434` |
| CPU / Memory | Inherits `var.cpu_limit` / `var.memory_limit` from the main container |
| Min / Max instances | `1` / `1` (always running) |
| Ingress | `INGRESS_TRAFFIC_INTERNAL_ONLY` |
| Output env var | `OLLAMA_HOST` — injected into n8n so it can reach Ollama |
| Models path | `OLLAMA_MODELS = "/mnt/gcs/ollama/models"` |
| Volume mount | `n8n-data` GCS bucket at `/mnt/gcs` (shared with n8n and Qdrant) |
| Startup probe | `GET /`, 20s delay, 5s timeout, 10s period, 10 threshold |

Both sidecars store their data on the shared `n8n-data` GCS Fuse volume under dedicated subdirectories (`/mnt/gcs/qdrant` and `/mnt/gcs/ollama/models`), avoiding the need for separate persistent volumes.

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
1. Detects Cloud SQL Auth Proxy socket: if `/cloudsql` directory contains a socket file, symlinks it to `/tmp/.s.PGSQL.5432` and sets `DB_HOST=/tmp`.
2. Resolves the target host from `DB_IP`, then `DB_HOST`, then `DB_POSTGRESDB_HOST` (n8n-native variable).
3. Polls PostgreSQL using `pg_isready` until available.
4. Creates (or updates the password of) the n8n application user.
5. Grants the application user role to `postgres` to allow database ownership transfer.
6. Creates the n8n database owned by the application user if it does not exist; otherwise reassigns ownership.
7. Grants full privileges on the database and public schema to the application user.
8. Signals Cloud SQL Proxy shutdown via `wget POST http://127.0.0.1:9091/quitquitquit`.

---

## 7. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as the Docker build context.

### `Dockerfile`
Builds from `node:22-alpine3.22`:
- Installs system packages: `python3`, `py3-pip`, `git`, `bash`, `curl`, `jq`, `tini`, `su-exec`.
- Installs n8n globally at the pinned version: `npm install -g n8n@2.4.7`.
- Creates the `node` group (GID 1000) and user (UID 1000) — matches the GCS Fuse mount options `uid=1000,gid=1000` so the mounted volume is immediately writable by n8n.
- Creates `/home/node/.n8n` and sets ownership to `node:node`.
- Copies and makes `entrypoint.sh` executable (as root, then switches back to `node`).
- Sets `N8N_USER_FOLDER=/home/node/.n8n` and `N8N_PORT=5678`.
- Exposes port `5678`.
- Uses `tini` implicitly via the `entrypoint.sh` which calls `exec n8n`.

### `entrypoint.sh`
Translates platform-standard environment variables into n8n's native variable names before starting n8n:

**1. Unix socket detection**: If `DB_HOST` starts with `/`, symlinks the socket to `/tmp/.s.PGSQL.5432` and resets `DB_HOST=/tmp` for PostgreSQL client compatibility.

**2. DB variable mapping** (only sets if the n8n-native variable is not already present):

| Platform variable | n8n variable |
|-------------------|-------------|
| `DB_HOST` | `DB_POSTGRESDB_HOST` |
| `DB_NAME` | `DB_POSTGRESDB_DATABASE` |
| `DB_USER` | `DB_POSTGRESDB_USER` |
| `DB_PASSWORD` | `DB_POSTGRESDB_PASSWORD` |

**3. Redis host resolution**: Expands the `$(NFS_SERVER_IP)` placeholder in `QUEUE_BULL_REDIS_HOST` to the runtime NFS server IP, enabling NFS-hosted Redis to be referenced without knowing the IP at Terraform plan time.

**4. Start n8n**: `exec n8n "$@"` — replaces the shell process with n8n as PID 1 (via `exec`).

---

## 8. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | `string` | **required** | GCP project ID |
| `wrapper_prefix` | `string` | **required** | Prefix for Secret Manager secret IDs and the storage bucket name |
| `deployment_id` | `string` | `""` | Unique deployment identifier |
| `common_labels` | `map(string)` | `{}` | Labels applied to secrets |
| `deployment_region` | `string` | `"us-central1"` | Region for the storage bucket |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"n8nai"` | Application name |
| `application_display_name` | `string` | `"N8N AI Starter Kit"` | Display name |
| `description` | `string` | `"N8N AI Starter Kit - Workflow automation with Qdrant and Ollama"` | Description |
| `application_version` | `string` | `"2.4.7"` | n8n version (pinned in both Dockerfile and config) |
| `service_url` | `string` | `""` | Public service URL; set as `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` |
| `environment_variables` | `map(string)` | see §4 | Default n8n environment variables |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs; empty triggers default `db-init` |
| `startup_probe` | `object` | see §3 | Startup health probe |
| `liveness_probe` | `object` | see §3 | Liveness health probe |

### AI Components

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_ai_components` | `bool` | `true` | Master switch for AI sidecar services |
| `enable_qdrant` | `bool` | `true` | Enable Qdrant vector database sidecar |
| `qdrant_version` | `string` | `"latest"` | Qdrant Docker image tag |
| `enable_ollama` | `bool` | `true` | Enable Ollama LLM provider sidecar |
| `ollama_version` | `string` | `"latest"` | Ollama Docker image tag |

### Database & Resources

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `db_name` | `string` | `"n8n_db"` | PostgreSQL database name |
| `db_user` | `string` | `"n8n_user"` | PostgreSQL application user |
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `enable_image_mirroring` | `bool` | `true` | Mirror the container image to the project's Artifact Registry before deployment |
| `gcs_volumes` | `list(any)` | n8n-data at `/home/node/.n8n` | GCS Fuse volumes; always merged with the shared `/mnt/gcs` volume |
| `container_resources` | `any` | `null` | Full resource object override; if null, uses `cpu_limit`/`memory_limit` |
| `cpu_limit` | `string` | `"2000m"` | CPU limit (also used by Ollama sidecar) |
| `memory_limit` | `string` | `"4Gi"` | Memory limit (also used by Ollama sidecar) |
| `min_instance_count` | `number` | `0` | Minimum instances (scale-to-zero) |
| `max_instance_count` | `number` | `3` | Maximum instances |

### Redis

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_redis` | `bool` | `true` | Enable Redis queue-mode operation |
| `redis_host` | `string` | `""` | Redis host; if empty, uses `$(NFS_SERVER_IP)` placeholder |
| `redis_port` | `string` | `"6379"` | Redis port |
| `redis_auth` | `string` | `""` | Redis auth password (sensitive) |

---

## 9. GCS Volume Layout

The shared `n8n-data` GCS bucket (`<wrapper_prefix>-storage`) is mounted at `/mnt/gcs` in all three containers and at `/home/node/.n8n` in n8n, using the following directory structure:

```
<wrapper_prefix>-storage/          ← GCS bucket root
├── (n8n workflow data)            ← /home/node/.n8n (n8n default data dir)
├── qdrant/                        ← /mnt/gcs/qdrant (Qdrant storage)
│   └── collections/
└── ollama/
    └── models/                    ← /mnt/gcs/ollama/models (downloaded LLMs)
```

The default `gcs_volumes` variable mounts the bucket at `/home/node/.n8n` with `uid=1000,gid=1000` (the `node` user). The module always appends a second mount at `/mnt/gcs` (without UID constraints) for the AI sidecar shared storage.

---

## 10. Platform-Specific Differences

| Aspect | N8N_AI_CloudRun | N8N_AI_GKE |
|--------|-----------------|-----------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | `true` (Auth Proxy sidecar) | `false` (TCP to Cloud SQL private IP) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path | Cloud SQL private IP |
| NFS | Not used (serverless) | Optional via `enable_nfs` |
| AI sidecars | Qdrant and Ollama as separate Cloud Run services | Qdrant and Ollama as sidecar containers in the same pod |
| Redis | Enabled by default; `$(NFS_SERVER_IP)` placeholder | Enabled by default; `$(NFS_SERVER_IP)` placeholder |
| GCS volumes | `n8n-data` + `/mnt/gcs` (two fixed volumes) | `n8n-data` + `/mnt/gcs` (two fixed volumes) |
| Scaling | Serverless, scale-to-zero (`min_instance_count = 0`) | Kubernetes Deployment with configurable replicas |

---

## 11. Implementation Pattern

```hcl
# Example: how N8N_AI_CloudRun instantiates N8N_AI_Common

module "n8n_app" {
  source = "../N8N_AI_Common"

  project_id              = var.project_id
  wrapper_prefix          = local.resource_prefix
  common_labels           = local.labels
  deployment_id           = local.deployment_id
  deployment_region       = var.deployment_region
  service_url             = local.service_url
  enable_ai_components    = var.enable_ai_components
  enable_qdrant           = var.enable_qdrant
  enable_ollama           = var.enable_ollama
  enable_redis            = var.enable_redis
  redis_host              = var.redis_host
  redis_auth              = var.redis_auth
}

# config and secrets are passed to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config      = module.n8n_app.config
  module_storage_buckets  = module.n8n_app.storage_buckets
  module_secret_env_vars  = {
    N8N_SMTP_PASS      = module.n8n_app.smtp_password_secret_id
    N8N_ENCRYPTION_KEY = module.n8n_app.encryption_key_secret_id
  }
  scripts_dir             = module.n8n_app.path
  # ... other inputs
}
```
