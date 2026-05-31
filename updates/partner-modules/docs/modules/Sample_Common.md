# Sample_Common Module

## Overview

`Sample_Common` is a **reference implementation** of a `*_Common` module in the RAD Modules ecosystem. It deploys a minimal Flask web application backed by PostgreSQL to demonstrate the correct structure, patterns, and conventions that all `*_Common` modules follow.

Use this module as a starting point when building a new application module, or as a working example to understand how Layer 1 configuration modules integrate with `App_CloudRun` and `App_GKE`.

The module provisions one GCP Secret Manager secret (the Flask `SECRET_KEY`), defines no GCS buckets, and optionally enables a Redis sidecar for server-side session storage.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Sample_Common (Layer 1)                             │
│                                                                              │
│  Inputs: project_id, tenant_deployment_id, deployment_id,                   │
│          enable_redis, resource_prefix, ...                                  │
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐    │
│  │  GCP Resources       │    │  Config Output (consumed by Layer 2)    │    │
│  │                      │    │                                         │    │
│  │  Secret Manager API  │    │  container_image: "" (derived from      │    │
│  │                      │    │    application_name by App_GKE/Run)     │    │
│  │  secret-key          │    │  container_port: 8080                   │    │
│  │    (32-char, no      │    │  secret_env_vars: {SECRET_KEY: ...}     │    │
│  │     special chars)   │    │  database_type: POSTGRES_15             │    │
│  │  30s propagation     │    │  initialization_jobs: [db-init]         │    │
│  │  wait                │    │  additional_services: [redis] (opt.)    │    │
│  │                      │    │  startup_probe: HTTP /healthz 10s       │    │
│  │  storage_buckets: [] │    │  liveness_probe: HTTP /healthz 15s      │    │
│  │  (no GCS buckets)    │    │                                         │    │
│  └──────────────────────┘    └─────────────────────────────────────────┘    │
│                                                                              │
│  secret_prefix = var.resource_prefix  OR                                    │
│                  "app{application_name}{tenant_deployment_id}{deployment_id}"│
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
| `random_password` | — | 32-char alphanumeric Flask secret key |
| `google_secret_manager_secret` | `{secret_prefix}-secret-key` | Stores Flask `SECRET_KEY` |
| `google_secret_manager_secret_version` | — | Populates the secret key |
| `time_sleep` | — | 30s wait after secret creation for IAM propagation |

> **`secret_prefix` resolution:** When `var.resource_prefix` is set (e.g., passed from `App_GKE`'s own `resource_prefix` output), it is used directly. This aligns the secret name with GKE cluster and deployment resources. When empty, falls back to `"app{application_name}{tenant_deployment_id}{deployment_id}"`.

---

## Module Outputs

| Output | Type | Description |
|--------|------|-------------|
| `config` | object | Full application configuration for App_CloudRun/App_GKE |
| `storage_buckets` | list | Always `[]` — no GCS buckets provisioned |
| `secret_ids` | map(string) | `{ FLASK_SECRET_KEY: "<secret_id>" }` — depends on 30s sleep |
| `secret_values` | map(string) (sensitive) | `{ FLASK_SECRET_KEY: "<plaintext>" }` |
| `path` | string | Absolute path to this module directory |

The `SECRET_KEY` is also wired directly into the `config.secret_env_vars` map, so `App_CloudRun`/`App_GKE` automatically mount it as a secret environment variable in the container without any extra caller configuration.

---

## Input Variables

### Identity & Project

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | string | — | GCP project ID (required) |
| `tenant_deployment_id` | string | `"demo"` | Tenant identifier used in secret naming |
| `deployment_id` | string | `""` | Deployment identifier |
| `resource_prefix` | string | `""` | Override secret prefix (pass `App_GKE.resource_prefix` to align names) |
| `resource_labels` | map(string) | `{}` | Labels applied to all GCP resources |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | string | `"sample-app"` | Used in auto-generated secret prefix |
| `application_version` | string | `"1.0.0"` | Application version tag |
| `display_name` | string | `"Sample Application"` | Human-readable display name |
| `description` | string | `"Sample Custom Application - Flask App with Database Connection"` | Description |
| `db_name` | string | `"sampledb"` | PostgreSQL database name |
| `db_user` | string | `"sampleuser"` | PostgreSQL database user |

### Resources

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `cpu_limit` | string | `"1000m"` | CPU limit |
| `memory_limit` | string | `"512Mi"` | Memory limit |
| `min_instance_count` | number | `0` | Minimum instances |
| `max_instance_count` | number | `1` | Maximum instances |
| `environment_variables` | map(string) | `{ FLASK_ENV = "production" }` | Container environment variables |
| `initialization_jobs` | list(any) | `[]` | Override default jobs (empty = use default `db-init`) |

### Health Probes

| Variable | Default | Description |
|----------|---------|-------------|
| `startup_probe` | HTTP `GET /healthz`, 10s delay, 5s timeout, 10s period, 3 failures | Startup readiness check |
| `liveness_probe` | HTTP `GET /healthz`, 15s delay, 5s timeout, 30s period, 3 failures | Ongoing liveness check |

### Redis

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_redis` | bool | `false` | Deploys a `redis:alpine` sidecar service |
| `redis_host` | string | `""` | Redis host for the Flask app |
| `redis_port` | number | `6379` | Redis port |

---

## Initialization Job: `db-init`

| Property | Value |
|----------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| `execute_on_apply` | `true` |
| `max_retries` | 3 |
| Timeout | 600s |

**`db-init.sh` flow:**

1. Detects Cloud SQL Unix socket under `/cloudsql`, symlinks to `/tmp/.s.PGSQL.5432`, sets `DB_HOST=/tmp`
2. Resolves target host (`DB_IP` → `DB_HOST`)
3. Waits for PostgreSQL with `pg_isready`
4. Creates/updates user via a `DO $$` PL/pgSQL block (idempotent — CREATE or ALTER)
5. Grants `DB_USER` role to `postgres` (required for Cloud SQL where postgres is not a true superuser)
6. Creates database with `CREATE DATABASE … OWNER "$DB_USER"` or updates owner if it already exists
7. Grants all privileges on the database
8. Signals Cloud SQL Auth Proxy shutdown via `POST http://127.0.0.1:9091/quitquitquit` (10 retries)

---

## Redis Sidecar (`additional_services`)

When `enable_redis = true`, a Redis sidecar is added to the `config.additional_services` list:

```hcl
{
  name               = "redis"
  image              = "redis:alpine"
  port               = var.redis_port    # number, default 6379
  cpu_limit          = "1000m"
  memory_limit       = "512Mi"
  min_instance_count = 0
  max_instance_count = 1
  ingress            = "INGRESS_TRAFFIC_INTERNAL_ONLY"
}
```

The Flask app reads `ENABLE_REDIS`, `REDIS_HOST`, and `REDIS_PORT` from environment variables at startup. When `ENABLE_REDIS=true` but `REDIS_HOST` is empty, it logs a warning and falls back to cookie-based sessions.

---

## Container Image

Built from `scripts/Dockerfile` using `python:3.11-slim`.

```
Base: python:3.11-slim

User: appuser (non-root, system user/group)

Dependencies (requirements.txt):
  - Flask 3.0.0
  - psycopg2-binary 2.9.9
  - gunicorn 21.2.0
  - SQLAlchemy 2.0.25
  - redis
  - Flask-Session

Files copied:
  - requirements.txt
  - app.py

CMD: exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 app:app
ENV: PORT=8080
```

No `ENTRYPOINT` is defined — the image uses `CMD` directly. No `tini`.

---

## Flask Application (`app.py`)

A minimal working application demonstrating all integration patterns:

### Database
- Connects to PostgreSQL via `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`
- URL-encodes user and password with `urllib.parse.quote_plus` to handle special characters in SQLAlchemy connection strings
- Supports both **Unix socket** (`DB_HOST` starts with `/`) and **TCP** connections:
  ```python
  # Unix socket
  postgresql://user:pass@/dbname?host=/cloudsql/...
  # TCP
  postgresql://user:pass@host:5432/dbname
  ```
- SQLAlchemy connection pool: `pool_size=5`, `max_overflow=10`
- `Visitor` ORM model with a persistent counter table
- `init_db()` runs at startup to create the table and seed an initial row

### Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Increments the DB visitor counter; optionally tracks per-session visits via Redis |
| `/healthz` | GET | Returns `{"status": "healthy"}` — used by both startup and liveness probes |
| `/db` | GET | Executes `SELECT version()` and returns the PostgreSQL version |

### Sessions
- When `ENABLE_REDIS=true` and `REDIS_HOST` is set: uses `Flask-Session` with Redis backend (`SESSION_TYPE=redis`, signed sessions via `SECRET_KEY`)
- Otherwise: falls back to Flask's default cookie-based sessions

---

## Platform-Specific Differences

| Aspect | Sample_CloudRun | Sample_GKE |
|--------|-----------------|------------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `resource_prefix` | Auto-computed from app/tenant/deployment | Explicitly set (typically `App_GKE.resource_prefix`) |
| `min_instance_count` | `0` (scale-to-zero) | `1` (minimum pod availability) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path | Cloud SQL private IP |
| Redis host | Explicit `redis_host` required | Defaults to `127.0.0.1` if enabled |
| Secret injection | `module.sample_common.secret_ids` map | Secret values injected directly |
| NFS | Not used | Not used |

---

## Usage Example

```hcl
module "sample_common" {
  source = "./modules/Sample_Common"

  project_id           = var.project_id
  tenant_deployment_id = "prod"
  deployment_id        = random_id.deployment.hex

  enable_redis = true
  redis_host   = "localhost"  # or set by App_CloudRun sidecar
}

module "sample_cloudrun" {
  source = "./modules/App_CloudRun"

  config          = module.sample_common.config
  storage_buckets = module.sample_common.storage_buckets
  # SECRET_KEY is already wired via config.secret_env_vars — no extra config needed
}
```

### Aligning Secret Names with App_GKE

When deploying on GKE, pass `App_GKE`'s `resource_prefix` output so the secret name matches all other cluster resources:

```hcl
module "sample_common" {
  source          = "./modules/Sample_Common"
  project_id      = var.project_id
  resource_prefix = module.app_gke.resource_prefix
  # ...
}
```
