# Twenty Common — Shared Application Configuration

This document provides a reference for the `modules/Twenty_Common` Terraform module. `Twenty_Common` is an internal shared module — it is not deployed directly. It is called by `Twenty_CloudRun` and `Twenty_GKE` to produce application configuration, manage secrets, and supply the default database initialisation job.

---

## 1. Purpose

`Twenty Common` has three responsibilities:

1. **Configuration assembly:** Constructs the `config` output object consumed by the Foundation Module (`App CloudRun` or `App GKE`). This includes container image coordinates, environment variables, resource limits, probes, and the database initialisation job definition.

2. **Secret management:** Generates and stores `APP_SECRET` in Secret Manager. Outputs the secret ID for injection into the runtime environment.

3. **Storage bucket definition:** When `enable_gcs_storage = true`, outputs the GCS bucket specification that the Foundation Module provisions.

`Twenty Common` does **not** provision any GCP resources beyond secrets and the `time_sleep` propagation delay — all compute, networking, database, and storage resources are provisioned by the calling Foundation Module.

---

## 2. Outputs

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full application configuration object passed to `App CloudRun` or `App GKE` as `application_config`. Includes image coordinates, env vars, resource limits, probes, and the db-init job. |
| `secret_ids` | `map(string)` | Map of env var name → Secret Manager secret ID for runtime injection. Always contains `{ APP_SECRET = "<secret-id>" }`. |
| `secret_values` | `map(string)` | Sensitive map of env var name → plaintext secret value. Used by `App CloudRun`/`App GKE` for explicit secret value passing where needed. |
| `storage_buckets` | `list(object)` | GCS bucket specifications. Empty list when `enable_gcs_storage = false`. Contains the `twenty-storage` bucket spec when enabled. |
| `path` | `string` | Absolute filesystem path to the `Twenty Common` module directory. Used to resolve `scripts_dir`. |

---

## 3. Config Object Structure

The `config` output contains the following fields (simplified):

```hcl
{
  app_name            = var.application_name          # "twenty"
  display_name        = var.display_name              # "Twenty CRM"
  description         = var.description
  container_image     = "twentycrm/twenty"
  application_version = var.application_version       # e.g., "0.50.0"

  image_source           = "custom"
  enable_image_mirroring = var.enable_image_mirroring

  container_build_config = {
    enabled         = true
    dockerfile_path = "Dockerfile"
    context_path    = "."
    build_args      = { TWENTY_VERSION = var.application_version }
  }

  container_port         = var.container_port         # 3000
  database_type          = "POSTGRES_15"
  db_name                = var.db_name                # "twenty"
  db_user                = var.db_user                # "twenty"
  enable_cloudsql_volume = var.enable_cloudsql_volume
  gcs_volumes            = var.gcs_volumes

  container_resources = {
    cpu_limit    = var.cpu_limit      # "1000m"
    memory_limit = var.memory_limit   # "1Gi"
  }

  min_instance_count = var.min_instance_count
  max_instance_count = var.max_instance_count

  environment_variables = merge(
    {
      MESSAGE_QUEUE_TYPE = var.enable_redis ? "bull-mq" : "pg-boss"
      STORAGE_TYPE       = var.enable_gcs_storage ? "s3" : "local"
      SERVER_URL         = ""     # must be overridden
      FRONT_BASE_URL     = ""     # must be overridden
      REDIS_URL          = ...    # when enable_redis = true
      STORAGE_S3_NAME    = ...    # when enable_gcs_storage = true
      STORAGE_S3_REGION  = ...    # when enable_gcs_storage = true
      STORAGE_S3_ENDPOINT = ...   # when enable_gcs_storage = true
    },
    var.environment_variables      # user-supplied vars — take precedence
  )

  initialization_jobs = [...]      # default db-init job or user-supplied jobs
  startup_probe       = var.startup_probe
  liveness_probe      = var.liveness_probe
}
```

---

## 4. Secret Management

### APP_SECRET

`Twenty Common` generates a random 32-character alphanumeric string using `random_password` and stores it in Secret Manager:

- **Resource name:** `<resource_prefix>-app-secret`
- **Secret ID key:** `APP_SECRET`
- **Propagation delay:** A `time_sleep` of 30 seconds ensures replication before the runtime environment reads the secret.

The secret is **not** refreshed on subsequent applies unless the Terraform resource is explicitly tainted. The `random_password` resource is marked `keepers = {}` — the value is fixed at first apply and does not rotate automatically.

To rotate `APP_SECRET` manually, taint the `random_password.app_secret` resource and re-apply. All active Twenty sessions will be invalidated after rotation since `APP_SECRET` is used for JWT signing.

### Secret Outputs

- `secret_ids`: `{ APP_SECRET = "<secret-resource-id>" }` — passed to the Foundation Module to inject the secret at runtime via Secret Manager native bindings.
- `secret_values`: `{ APP_SECRET = "<plaintext-value>" }` — sensitive output used for explicit value passing where the Foundation Module requires plaintext (e.g., for Cloud Run Job environment variables during `db-init`).

---

## 5. Default Initialization Job

When `initialization_jobs = []` (the default), `Twenty Common` supplies a single `db-init` job:

```hcl
{
  name            = "db-init"
  description     = "Create Twenty CRM Database and User"
  image           = "postgres:15-alpine"
  execute_on_apply = true
  max_retries     = 3
  timeout_seconds = 600
  secret_env_vars = { ROOT_PASSWORD = "ROOT_PASSWORD" }
  script_path     = "<module_path>/scripts/db-init.sh"
}
```

The `db-init.sh` script performs:
1. Connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket using `ROOT_PASSWORD`.
2. Creates the application user (`db_user`) with a randomly generated password.
3. Creates the application database (`db_name`) owned by the application user.
4. Grants all privileges on the database to the application user.

All operations are idempotent — re-running `db-init` on an existing database does not cause errors.

---

## 6. GCS Storage Bucket

When `enable_gcs_storage = true`, `Twenty Common` outputs a bucket specification:

```hcl
[
  {
    name_suffix              = "twenty-storage"
    location                 = var.region
    storage_class            = "STANDARD"
    force_destroy            = true
    versioning_enabled       = false
    lifecycle_rules          = []
    public_access_prevention = "inherited"
  }
]
```

The Foundation Module provisions this bucket as `<resource_prefix>-twenty-storage`. The `public_access_prevention = "inherited"` setting allows objects to be publicly accessible if the project-level policy allows it — appropriate for a CRM file attachment store fronted by the Twenty S3 API.

---

## 7. Variables

`Twenty Common` variables are internal to the module and are not user-configurable directly. They are all passed from the calling Application Module (`Twenty CloudRun` or `Twenty GKE`). See the calling module's `variables.tf` for the full set.

Key variables consumed by `Twenty Common`:

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. |
| `resource_prefix` | — | Resource naming prefix constructed by the Application Module. |
| `region` | `'us-central1'` | GCP region for the GCS storage bucket. |
| `application_name` | `'twenty'` | Application name. |
| `application_version` | `'latest'` | Container image version tag. |
| `display_name` | `'Twenty CRM'` | Display name. |
| `db_name` | `'twenty'` | PostgreSQL database name. |
| `db_user` | `'twenty'` | PostgreSQL user. |
| `container_port` | `3000` | Container port. |
| `cpu_limit` | `'1000m'` | CPU limit. |
| `memory_limit` | `'1Gi'` | Memory limit. |
| `min_instance_count` | `1` | Minimum instances/replicas. |
| `max_instance_count` | `3` | Maximum instances/replicas. |
| `enable_redis` | `false` | Whether to use bull-mq (Redis). |
| `redis_host` | `""` | Redis host. |
| `redis_port` | `'6379'` | Redis port. |
| `redis_auth` | `""` | Redis password. Sensitive. |
| `enable_gcs_storage` | `false` | Whether to provision GCS storage. |
| `enable_image_mirroring` | `true` | Mirror image into Artifact Registry. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. |
| `environment_variables` | `{}` | User-supplied env vars. Merged last — take precedence. |
| `initialization_jobs` | `[]` | Custom init jobs. Empty triggers default `db-init`. |
| `startup_probe` | (see CloudRun/GKE variables.tf) | Startup probe config. |
| `liveness_probe` | (see CloudRun/GKE variables.tf) | Liveness probe config. |
