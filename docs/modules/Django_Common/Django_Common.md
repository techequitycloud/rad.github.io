# Django_Common Shared Configuration Module

The `Django_Common` module defines the Django web framework configuration for the RAD Modules ecosystem. Like `Directus_Common`, it **creates GCP resources** (a Secret Manager secret for the Django `SECRET_KEY`) and produces a `config` output consumed by platform-specific wrapper modules (`Django_CloudRun` and `Django_GKE`).

## 1. Overview

**Purpose**: To provide a complete, cloud-ready Django application template — including a custom container image, database setup, migrations, static file collection, and application secrets — that platform modules can deploy without Django-specific knowledge.

**Architecture**:

```
Layer 3: Application Wrappers
├── Django_CloudRun  ──┐
└── Django_GKE       ──┤── instantiate Django_Common
                       ↓
            Django_Common (this module)
            Creates: Secret Manager secret (SECRET_KEY)
            Produces: config, storage_buckets, secret_ids, secret_values, path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Builds a fully custom container image from a bundled Django project — there is no prebuilt public base image to reference.
- Defines **two** default initialization jobs (`db-init` + `db-migrate`) that run sequentially on every `terraform apply`.
- Ships a complete sample Django project (`myproject/`) as a reference implementation that application teams replace with their own code.

---

## 2. GCP Resources Created

### Secret Manager Secret

| Secret ID suffix | Content | Description |
|-----------------|---------|-------------|
| `-secret-key` | 50-char random alphanumeric | Django `SECRET_KEY` — used for cryptographic signing (sessions, CSRF tokens, password reset links) |

The secret ID is prefixed with `resource_prefix` when provided, or constructed as `app<name><tenant><deployment_id_suffix>` otherwise. A 30-second `time_sleep` is added after the secret version is written to ensure propagation before dependent resources read it.

---

## 3. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | `"django"` |
| `application_version` | Version tag (default: `"latest"`) |
| `container_image` | `""` (empty — no prebuilt image; image is fully built from source) |
| `image_source` | `"custom"` — the bundled `Dockerfile` is built by Cloud Build |
| `enable_image_mirroring` | `true` — image is mirrored to Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."` (entire `scripts/` directory), no build args |
| `container_port` | `8080` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (default: `"django"`) |
| `db_user` | Database user (default: `"django"`) |
| `db_tier` | `"db-f1-micro"` — default Cloud SQL instance tier |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `false`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | List of GCS Fuse volume mounts (empty by default) |
| `container_resources` | CPU/memory limits and requests |
| `min_instance_count` | `0` (scale-to-zero) |
| `max_instance_count` | `10` |
| `environment_variables` | Passed through directly from `var.environment_variables` — no defaults added by this module |
| `enable_postgres_extensions` | `true` |
| `postgres_extensions` | `["pg_trgm", "unaccent", "hstore", "citext"]` — see §5 |
| `initialization_jobs` | Two default jobs (`db-init`, `db-migrate`) or custom override — see §6 |
| `startup_probe` | Pass-through of `var.startup_probe`; defaults to `null` when caller does not provide a value |
| `liveness_probe` | Pass-through of `var.liveness_probe`; defaults to `null` when caller does not provide a value |

### `storage_buckets`
A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|-------|-------|
| `name_suffix` | `"django-media"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` (inherits project-level policy) |

### `secret_ids`
A map of Django secret environment variable names to their Secret Manager secret IDs. Includes a `depends_on` on the 30-second propagation wait.

```hcl
{
  SECRET_KEY = "<prefix>-secret-key"
}
```

### `secret_values`
A **sensitive** map of the same secrets with raw generated values. Used by `App_GKE` to bypass Secret Manager read-after-write consistency issues during initial apply.

### `path`
The absolute path to the `Django_Common` module directory (`path.module`). Note: wrapper modules (`Django_CloudRun`, `Django_GKE`) do **not** use this output to set `scripts_dir` — they instead hard-code `abspath("${path.module}/../Django_Common/scripts")` to point directly at the `scripts/` subdirectory.

---

## 4. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | `string` | required | GCP project ID |
| `tenant_deployment_id` | `string` | required | Unique tenant/environment identifier |
| `resource_prefix` | `string` | `""` | Prefix for resource naming |
| `labels` | `map(string)` | `{}` | Labels applied to all resources |
| `deployment_id` | `string` | `""` | Unique deployment identifier |
| `deployment_id_suffix` | `string` | `""` | Random suffix used in resource name calculations |
| `service_url` | `string` | `""` | URL where the service will be accessible |
| `deployment_region` | `string` | `"us-central1"` | Primary GCP region |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"django"` | Application name |
| `application_version` | `string` | `"latest"` | Image version tag |
| `enable_image_mirroring` | `bool` | `true` | Enable image mirroring to Artifact Registry |
| `display_name` | `string` | `"Django"` | Human-readable display name |
| `description` | `string` | `"Django Application"` | Module description (also used as `db-init` job description) |
| `db_name` | `string` | `"django"` | PostgreSQL database name |
| `db_user` | `string` | `"django"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit |
| `memory_limit` | `string` | `"512Mi"` | Container memory limit |
| `min_instance_count` | `number` | `0` | Minimum instances (0 = scale-to-zero) |
| `max_instance_count` | `number` | `10` | Maximum instances |
| `environment_variables` | `map(string)` | `{}` | Environment variables passed directly to the container |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs; empty triggers the two default jobs |
| `startup_probe` | `any` | `null` | Startup probe; no default — caller must provide |
| `liveness_probe` | `any` | `null` | Liveness probe; no default — caller must provide |

### Storage & Volumes

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_cloudsql_volume` | `bool` | `false` | Mount Cloud SQL Auth Proxy sidecar socket |
| `gcs_volumes` | `list(any)` | `[]` | GCS Fuse volume mounts |

---

## 5. PostgreSQL Extensions

The following extensions are created as superuser during the `db-init` job, before the application connects:

| Extension | Purpose |
|-----------|---------|
| `pg_trgm` | Trigram-based text search and similarity matching |
| `unaccent` | Unicode accent-insensitive text search |
| `hstore` | Key-value store within a PostgreSQL column |
| `citext` | Case-insensitive text data type |

---

## 6. Initialization Jobs

Two jobs run by default (when `initialization_jobs = []`), executed in order:

### Job 1: `db-init`
| Field | Value |
|-------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets required | `ROOT_PASSWORD` (PostgreSQL superuser), `DB_PASSWORD` (app user) |
| `execute_on_apply` | `true` |
| Timeout | 1200s, 1 retry |

`db-init.sh` behavior:
1. Detects Cloud SQL Auth Proxy: if `DB_SSL=false` and `DB_HOST` is not a Unix socket, forces `DB_HOST=127.0.0.1`.
2. Resolves the target host from `DB_IP` (if injected by the platform) or falls back to `DB_HOST`.
3. Polls the database using `psql` until available.
4. Creates (or updates) the Django database role with `CREATEDB` privileges.
5. Creates the database as the application user if it does not exist.
6. Grants full privileges on the database and public schema (tables, sequences, functions) to the application user and sets the database owner.
7. Creates the four required PostgreSQL extensions (`pg_trgm`, `unaccent`, `hstore`, `citext`).
8. Signals Cloud SQL Proxy shutdown via `POST http://localhost:9091/quitquitquit` (falls back to `wget` if `curl` is unavailable).

### Job 2: `db-migrate`
| Field | Value |
|-------|-------|
| Image | `null` — uses the application image (built by Cloud Build) |
| Script | `scripts/migrate.sh` |
| GCS volumes mounted | `["django-media"]` |
| `execute_on_apply` | `true` |
| Timeout | 1200s, 1 retry |

`migrate.sh` behavior:
1. Constructs `DATABASE_URL` from `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, and `DB_NAME` if not already set.
2. Runs `python manage.py migrate` to apply all pending schema migrations.
3. Runs `python manage.py collectstatic --noinput --clear` to gather static assets.
4. Signals Cloud SQL Proxy shutdown.

---

## 7. Scripts and Container Image

All supporting files are in `scripts/`. The entire `scripts/` directory is used as the Docker build context (`context_path = "."`).

### `Dockerfile`
Multi-stage build using `python:3.11-slim`:

**Builder stage**:
- Installs build dependencies (`build-essential`, `libpq-dev`).
- Installs Python packages from `requirements.txt` into `/install` (isolated prefix).

**Final stage**:
- Installs runtime-only dependencies: `libpq-dev`, `postgresql-client`, `netcat-openbsd`, `curl`.
- Copies compiled Python packages from the builder stage.
- Creates a `django` user and group with **UID/GID 2000** — matches the Cloud Run GCS Fuse mount UID requirement.
- Copies the Django project with correct ownership.
- Creates `/app/static`, `/app/staticfiles`, and `/app/media` directories.
- Runs as the `django` (non-root) user.
- Exposes port `8080`.
- Docker health check: `curl -f http://localhost:8080/health/` every 30s.
- Entrypoint: `entrypoint.sh`; CMD: `gunicorn --bind 0.0.0.0:8080 --workers 2 --threads 4 --timeout 120 myproject.wsgi:application`.

### `requirements.txt`
| Package | Purpose |
|---------|---------|
| `Django>=5.0,<6.0` | Web framework |
| `gunicorn>=21.2.0` | Production WSGI server |
| `psycopg2-binary>=2.9.9` | PostgreSQL driver |
| `whitenoise>=6.6.0` | Static file serving from the container |
| `python-dotenv>=1.0.0` | `.env` file support |
| `django-storages[google]` | GCS media/static file backend |
| `django-environ` | Environment variable-based settings |

### `entrypoint.sh`
The container entrypoint, runs before Gunicorn starts:
1. Verifies `manage.py` and `myproject/` directory exist; exits with an error if missing.
2. Checks `/app/media` directory writability (warns if not writable — may indicate a missing GCS Fuse mount).
3. Constructs `DATABASE_URL` from individual env vars (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`), supporting both Unix socket (`postgres://user:pass@/db?host=/socket/path`) and TCP formats.
4. Waits for the database (up to 30 attempts, 2s apart): first checks socket existence or TCP port reachability, then verifies Django connectivity with `python manage.py check --database default`.
5. Optionally creates a Django superuser if `DJANGO_SUPERUSER_USERNAME` is set (falls back to `DB_PASSWORD` for the password if `DJANGO_SUPERUSER_PASSWORD` is not set).
6. Runs `exec "$@"` to replace the shell with Gunicorn as PID 1.

> **Note**: Database migrations and `collectstatic` are handled by the `db-migrate` initialization job, not the entrypoint. This prevents race conditions in horizontally scaled deployments where multiple instances start simultaneously.

### `migrate.sh`
Lightweight script used by the `db-migrate` initialization job (see §6). Constructs `DATABASE_URL` and runs `migrate` + `collectstatic`.

### `db-init.sh`
Database setup script used by the `db-init` initialization job (see §6).

### `myproject/` — Sample Django Project
A complete reference Django 5 project included as a starting point for application teams:

| File | Purpose |
|------|---------|
| `basesettings.py` | Development baseline (SQLite, DEBUG=True, standard Django apps) |
| `settings.py` | Production override using `django-environ` — see §8 |
| `urls.py` | Root URL configuration; includes the sample app |
| `wsgi.py` | WSGI application entry point for Gunicorn |
| `sample/` | A minimal sample app with a health check view and index template |

---

## 8. Production Settings (`myproject/settings.py`)

The production settings extend `basesettings.py` and configure Django for cloud deployment using `django-environ`:

*   **Secret Key**: Read from the `SECRET_KEY` environment variable (injected from Secret Manager via `secret_ids`).
*   **Configuration Loading**: Settings are read from the `APPLICATION_SETTINGS` environment variable (an env-file formatted string) in addition to individual env vars.
*   **Cloud Run SSL**: Trusts `X-Forwarded-Proto` header (`SECURE_PROXY_SSL_HEADER`) so Django correctly detects HTTPS behind Cloud Run's load balancer. `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, and `CSRF_COOKIE_SECURE` are configurable via env vars.
*   **Allowed Hosts**: Defaults to `["*"]`; extended with parsed hostnames from `CLOUDRUN_SERVICE_URLS` when set. `CSRF_TRUSTED_ORIGINS` is also set from `CLOUDRUN_SERVICE_URLS`.
*   **Database**: Parsed from a `DATABASE_URL` env var using `django-environ`'s `env.db()`. When `USE_CLOUD_SQL_AUTH_PROXY` is set, the host is overridden to `127.0.0.1:5432`.
*   **Static Files**: WhiteNoise middleware is injected for container-served static files. If `GS_BUCKET_NAME` is set, both `default` and `staticfiles` storage backends switch to `django-storages` GCS (`GoogleCloudStorage` with `publicRead` ACL).
*   **Media Root / Static Root**: Configurable via `MEDIA_ROOT`, `MEDIA_URL`, and `STATIC_ROOT` env vars.

---

## 9. Platform-Specific Differences

| Aspect | Django_CloudRun | Django_GKE |
|--------|-----------------|-----------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | Optional (`var.enable_cloudsql_volume`) | Optional (`var.enable_cloudsql_volume`) |
| `DB_HOST` | Detected at runtime by `db-init.sh`: socket path if Unix socket, or `127.0.0.1` when using the Auth Proxy over TCP | Cloud SQL private IP or `127.0.0.1` via Auth Proxy |
| Health probes | Caller must provide (`startup_probe`, `liveness_probe`) | Caller must provide (`startup_probe`, `liveness_probe`) |
| Secret injection | `secret_ids` map from `module.django_app` | Secret values injected directly |
| NFS | Not managed by Django_Common; App_CloudRun handles NFS via `enable_nfs` | Not managed by Django_Common; App_GKE handles NFS via `enable_nfs` (defaults to `true` in Django_GKE) |
| Redis | Optional via `enable_redis` | Optional via `enable_redis` |
| Scaling | Serverless, scale-to-zero (`min_instance_count = 0`) | Kubernetes Deployment with configurable replicas |

---

## 10. Implementation Pattern

```hcl
# Example: how Django_CloudRun instantiates Django_Common

module "django_app" {
  source = "../Django_Common"

  project_id           = var.project_id
  resource_prefix      = local.resource_prefix
  deployment_id        = local.random_id
  deployment_id_suffix = local.random_id
  service_url          = local.predicted_service_url
  tenant_deployment_id = var.tenant_deployment_id
  application_name     = var.application_name
  application_version  = var.application_version
  deployment_region    = local.region
  db_name              = var.application_database_name
  db_user              = var.application_database_user
  labels               = var.resource_labels
  # ... other inputs
}

locals {
  application_modules    = { django = merge(module.django_app.config, { ... }) }
  module_env_vars        = var.enable_redis ? { REDIS_HOST = var.redis_host, REDIS_PORT = tostring(var.redis_port) } : {}
  module_secret_env_vars = module.django_app.secret_ids
  module_storage_buckets = module.django_app.storage_buckets
  # Note: scripts_dir points to the scripts/ subdirectory, not the module root
  scripts_dir            = abspath("${path.module}/../Django_Common/scripts")
}

# config and secrets are passed to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_env_vars        = local.module_env_vars
  module_storage_buckets = local.module_storage_buckets
  module_secret_env_vars = local.module_secret_env_vars
  scripts_dir            = local.scripts_dir
  # ... other inputs
}
```
