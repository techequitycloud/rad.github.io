# Flowise_Common Shared Configuration Module

The `Flowise_Common` module defines the Flowise visual AI workflow builder for the RAD Modules ecosystem. It **creates GCP resources** (one Secret Manager secret for the admin password) and produces a `config` output consumed by the platform-specific wrapper modules (`Flowise_CloudRun` and `Flowise_GKE`).

## 1. Overview

**Purpose**: To centralise all Flowise-specific configuration — PostgreSQL backend, GCS file storage, admin password secret, and a pre-configured `db-init` bootstrap job — in a single module shared by Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Flowise_CloudRun  ──┐
└── Flowise_GKE       ──┤── instantiate Flowise_Common
                        ↓
        Flowise_Common (this module)
        Creates: 1 Secret Manager secret (admin password)
        Produces: config, storage_buckets, secret_ids, secret_values, path
                        ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                        ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Flowise runs a **custom Dockerfile** that wraps the `flowiseai/flowise:latest` base image. The Dockerfile copies a `flowise-entrypoint.sh` script that bridges the platform's `DB_*` environment variables to Flowise's `DATABASE_*` naming convention.
- The container image source is `"custom"` — Cloud Build compiles the image from the bundled Dockerfile at deploy time.
- Redis is **not required** for core Flowise functionality. The wrapper modules expose `enable_redis` but it defaults to `false`.
- Database connection variables (`DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME`, `DATABASE_PASSWORD`) are injected unconditionally at container start time by `flowise-entrypoint.sh` from platform-injected `DB_*` variables. This approach is required for GKE compatibility where environment variables are ordered alphabetically.

---

## 2. GCP Resources Created

| Resource | ID / Name | Purpose |
|---|---|---|
| `google_project_service.secretmanager` | `secretmanager.googleapis.com` | Enables Secret Manager API in the target project |
| `random_password.flowise_password` | *(32 chars, no special chars)* | Auto-generated Flowise admin password |
| `google_secret_manager_secret.flowise_password` | `<resource_prefix>-password` | Secret Manager secret holding the admin password |
| `google_secret_manager_secret_version.flowise_password` | *(latest version)* | Stores the generated admin password value |
| `time_sleep.secret_propagation` | *(30s delay)* | Waits after secret creation before the `secret_ids` output resolves, allowing Secret Manager global replication |

---

## 3. Storage Buckets

`Flowise_Common` produces a single GCS bucket definition via the `storage_buckets` output:

| Field | Value |
|---|---|
| `name` | `<resource_prefix>-flowise-uploads` |
| `name_suffix` | `"flowise-uploads"` |
| `location` | `var.deployment_region` |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` |

The bucket name is injected into the application environment as `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` by the wrapper module via `module_env_vars`. Flowise uses this bucket for file upload storage, API key files, and other GCS-backed artifacts.

---

## 4. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | from `application_name` (default: `"flowise"`) |
| `display_name` | from `display_name` (default: `"Flowise"`) |
| `description` | from `description` (default: `"Flowise Visual AI Workflow Builder"`) |
| `container_image` | `""` (built from Dockerfile; `image_source = "custom"`) |
| `application_version` | from `application_version` (default: `"latest"`) |
| `image_source` | `"custom"` |
| `enable_image_mirroring` | `false` (image is built by Cloud Build, not mirrored) |
| `container_build_config` | `enabled = true`, `dockerfile_path = "Dockerfile"`, `context_path = "."` |
| `container_port` | `3000` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | from `db_name` variable (default: `"flowisedb"`) |
| `db_user` | from `db_user` variable (default: `"flowiseuser"`) |
| `enable_cloudsql_volume` | from `enable_cloudsql_volume` variable (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_resources` | CPU/memory limits from variables; no requests set |
| `min_instance_count` | from `min_instance_count` (default: `1`) |
| `max_instance_count` | from `max_instance_count` (default: `1`) |
| `environment_variables` | Merged map — see §5 |
| `initialization_jobs` | Default `db-init` job or custom override — see §6 |
| `startup_probe` | from `startup_probe` variable |
| `liveness_probe` | from `liveness_probe` variable |

### `storage_buckets`

List with one entry — the Flowise uploads bucket described in §3.

### `secret_ids`

Map of environment variable names to Secret Manager secret IDs. A 30-second `time_sleep` is applied before this output resolves.

```hcl
{
  FLOWISE_PASSWORD = "<resource_prefix>-password"
}
```

### `secret_values`

Sensitive map containing the raw generated admin password. Used by wrapper modules to inject secret values directly into Kubernetes Secrets (GKE) or `module_explicit_secret_values` (Cloud Run), bypassing Secret Manager read-after-write delays.

```hcl
{
  FLOWISE_PASSWORD = "<generated 32-char password>"
}
```

### `path`

The resolved filesystem path of the `Flowise_Common` module directory. Used by wrapper modules to locate the `scripts/` directory:

```hcl
scripts_dir = abspath("${module.flowise_app.path}/scripts")
```

---

## 5. Environment Variables (always injected)

`Flowise_Common` merges the following into `config.environment_variables`, with `var.environment_variables` taking precedence:

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_TYPE` | `"postgres"` | Forces PostgreSQL backend |
| `DATABASE_PORT` | `"5432"` | PostgreSQL default port |
| `FLOWISE_USERNAME` | `var.flowise_username` (default: `"admin"`) | Flowise admin username |
| `APIKEY_STORAGE_TYPE` | `"db"` | Stores Flowise API keys in the database |
| `STORAGE_TYPE` | `"gcs"` | Flowise file storage backend |
| `GCLOUD_PROJECT` | `var.project_id` | GCP project for GCS access |

> **`DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME`, `DATABASE_PASSWORD`**: These are **not** set in the Terraform environment map. They are injected at container startup by `flowise-entrypoint.sh` from platform-injected `DB_*` variables. This approach is required for GKE: env vars are ordered alphabetically in the pod spec, so `$(DB_HOST)` in `DATABASE_HOST` would never be resolved by Kubernetes (since `DB_HOST` is defined after `DATABASE_HOST`). Direct shell assignment in the entrypoint sidesteps this ordering constraint. On Cloud Run the `$(DB_HOST)` substitution still runs, but overwriting with the same value is harmless.

---

## 6. Initialization Job

When `initialization_jobs` is empty (the default), `Flowise_Common` automatically defines a single bootstrap job:

| Field | Value |
|---|---|
| `name` | `"db-init"` |
| `description` | `"Create Flowise Database and User"` |
| `image` | `"postgres:15-alpine"` |
| `execute_on_apply` | `true` |
| `script_path` | `<module_path>/scripts/create-db-and-user.sh` |
| `cpu_limit` | `"1000m"` |
| `memory_limit` | `"512Mi"` |
| `timeout_seconds` | `600` |
| `max_retries` | `1` |

The `create-db-and-user.sh` script:
1. Detects the Cloud SQL Auth Proxy socket (from `DB_HOST`) or falls back to `DB_IP`.
2. Polls PostgreSQL using `pg_isready` until available.
3. Creates (or updates the password of) the Flowise application user.
4. Creates the Flowise database owned by the application user if absent.
5. Grants all necessary privileges on the database and public schema.
6. Signals Cloud SQL Auth Proxy shutdown via `http://127.0.0.1:9091/quitquitquit`.

When `initialization_jobs` is provided by the caller, the custom jobs replace the default `db-init` job entirely.

---

## 7. Scripts Directory

`Flowise_Common` ships three files in `scripts/`:

| File | Purpose |
|---|---|
| `Dockerfile` | Wraps `flowiseai/flowise:latest`. Copies `flowise-entrypoint.sh`, makes it executable, exposes port `3000`, and sets it as the container ENTRYPOINT with `flowise start` as the default CMD. |
| `flowise-entrypoint.sh` | Unconditionally maps platform-injected `DB_*` variables to Flowise's `DATABASE_*` naming convention before calling `exec "$@"`. Handles both Cloud Run (env-var substitution) and GKE (alphabetic ordering). |
| `create-db-and-user.sh` | Bootstrap job script — see §6. |

> **Entrypoint detail**: `flowise-entrypoint.sh` uses direct shell assignment (`export DATABASE_HOST="${DB_HOST:-127.0.0.1}"`) rather than Kubernetes `$(DB_HOST)` substitution. This is intentional: Kubernetes resolves env var references alphabetically, and `DATABASE_HOST` (prefixed `D`) precedes `DB_HOST` in alphabetical order, so `$(DB_HOST)` would be empty when `DATABASE_HOST` is set.

---

## 8. Input Variables

All variables are passed in by the wrapper modules (`Flowise_CloudRun` and `Flowise_GKE`). `Flowise_Common` is not intended to be called directly by end users.

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | *(required)* | GCP project ID. |
| `tenant_deployment_id` | string | `"demo"` | Tenant identifier suffix. |
| `deployment_region` | string | `"us-central1"` | Region for the GCS storage bucket. |
| `deployment_id` | string | `""` | Random deployment ID suffix. |
| `resource_labels` | map(string) | `{}` | Labels applied to created resources. |
| `application_name` | string | `"flowise"` | Application name. |
| `application_version` | string | `"latest"` | Container image version tag. |
| `display_name` | string | `"Flowise"` | Human-readable display name. |
| `description` | string | `"Flowise Visual AI Workflow Builder"` | Application description. |
| `db_name` | string | `"flowisedb"` | PostgreSQL database name. |
| `db_user` | string | `"flowiseuser"` | PostgreSQL application user. |
| `cpu_limit` | string | `"1000m"` | Container CPU limit. |
| `memory_limit` | string | `"1Gi"` | Container memory limit. |
| `min_instance_count` | number | `1` | Minimum instances. |
| `max_instance_count` | number | `1` | Maximum instances. |
| `startup_probe` | object | HTTP `/api/v1/ping`, 30s delay, 30 threshold | Startup probe configuration. |
| `liveness_probe` | object | HTTP `/api/v1/ping`, 15s delay, 3 threshold | Liveness probe configuration. |
| `environment_variables` | map(string) | `{}` | Additional env vars merged over module defaults. |
| `enable_cloudsql_volume` | bool | `true` | Whether to mount the Cloud SQL Auth Proxy sidecar. |
| `initialization_jobs` | list(any) | `[]` | Custom initialization jobs. Replaces the default `db-init` job when non-empty. |
| `flowise_username` | string | `"admin"` | Flowise admin username injected as `FLOWISE_USERNAME`. |

---

## 9. Platform-Specific Differences

| Aspect | Cloud Run (`Flowise_CloudRun`) | GKE (`Flowise_GKE`) |
|---|---|---|
| **`enable_cloudsql_volume` wired** | Passed as-is; controls Cloud Run Cloud SQL sidecar annotation | Passed as-is; controls Cloud SQL Auth Proxy sidecar injection into the pod |
| **`secret_values` usage** | Passed as `module_explicit_secret_values` to App_CloudRun | Passed as `explicit_secret_values` to App_GKE for direct Kubernetes Secret injection |
| **`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`** | Injected via `module_env_vars` in Flowise_CloudRun | Injected via `module_env_vars` in Flowise_GKE |
| **`container_build_config`** | Wrapper merges `dockerfile_path = "Dockerfile"` and `context_path = "."` | Wrapper merges `dockerfile_path = "Dockerfile"` and `context_path = "."` |
| **Scaling** | Serverless; `min_instance_count = 1` to avoid cold starts | Kubernetes Deployment; `min_instance_count = 1` by default |
| **Scripts directory** | `abspath("${module.flowise_app.path}/scripts")` | `abspath("${module.flowise_app.path}/scripts")` |

---

## 10. Implementation Pattern

```hcl
# Example: how Flowise_GKE instantiates Flowise_Common

module "flowise_app" {
  source = "../Flowise_Common"

  project_id           = var.project_id
  tenant_deployment_id = var.tenant_deployment_id
  deployment_id        = local.random_id
  deployment_region    = local.region
  resource_labels      = var.resource_labels

  application_name    = var.application_name
  display_name        = var.application_display_name
  description         = var.application_description
  application_version = var.application_version

  db_name = var.application_database_name
  db_user = var.application_database_user

  cpu_limit    = var.container_resources.cpu_limit
  memory_limit = var.container_resources.memory_limit

  min_instance_count = var.min_instance_count
  max_instance_count = var.max_instance_count

  environment_variables  = var.environment_variables
  enable_cloudsql_volume = var.enable_cloudsql_volume
  initialization_jobs    = var.initialization_jobs

  flowise_username = var.flowise_username

  startup_probe  = var.startup_probe_config
  liveness_probe = var.health_check_config
}

# config and secrets are forwarded to App_GKE
locals {
  application_modules = {
    flowise = merge(module.flowise_app.config, { container_resources = { ... }, image_source = var.container_image_source, ... })
  }
  module_env_vars        = { GOOGLE_CLOUD_STORAGE_BUCKET_NAME = module.flowise_app.storage_buckets[0].name }
  module_secret_env_vars = module.flowise_app.secret_ids
  module_storage_buckets = module.flowise_app.storage_buckets
}
```
