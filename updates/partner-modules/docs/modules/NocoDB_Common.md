# NocoDB Common Module

This document provides a reference for the `modules/NocoDB_Common` Terraform module. This is the **Common** tier module that provides application-specific configuration shared between `NocoDB_CloudRun` and `NocoDB_GKE`.

---

## 1. Module Overview

`NocoDB_Common` is the application-specific configuration layer for NocoDB. It is called by both `NocoDB_CloudRun` and `NocoDB_GKE` to produce the standardised `config`, `secret_ids`, `storage_buckets`, and `path` outputs that the Foundation Modules (`App_CloudRun` and `App_GKE`) consume.

**Responsibilities:**
*   Defines the NocoDB container configuration: image, version, container port (8080), health probe paths (`/api/v1/health`), and default environment variable structure.
*   Provisions the GCS uploads bucket (`<prefix>-nocodb-uploads`) and outputs it via `storage_buckets`.
*   Outputs NocoDB-specific secret IDs via `secret_ids` (currently empty — NocoDB manages its own JWT keys).
*   Hosts the `scripts/` directory referenced by `scripts_dir` in Application Module wiring.
*   Configures the custom Dockerfile (in `scripts/`) that maps `DB_*` env vars to `NC_DB_*` variables when `container_image_source = 'custom'`.

**Outputs:**

| Output | Description |
|---|---|
| `config` | NocoDB application configuration object consumed by Foundation Modules. |
| `secret_ids` | Map of env var name → Secret Manager secret ID. Empty by default (no app-level secrets auto-generated). |
| `storage_buckets` | List of GCS bucket configurations including the NocoDB uploads bucket. |
| `path` | Absolute path to the `NocoDB_Common` module directory (used by Application Modules to resolve `scripts_dir`). |

---

## 2. Variables

`NocoDB_Common` variables are internal — they are set by the calling Application Module (`NocoDB_CloudRun` or `NocoDB_GKE`) and are not directly user-configurable.

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. Required. |
| `tenant_deployment_id` | `'demo'` | Deployment environment identifier. |
| `region` | `'us-central1'` | GCP region. |
| `deployment_id` | `""` | Deployment ID suffix. |
| `resource_labels` | `{}` | Labels for all resources. |
| `application_name` | `'nocodb'` | Internal application name used in resource naming. |
| `application_version` | `'latest'` | NocoDB image version tag. |
| `display_name` | `'NocoDB'` | Human-readable display name. |
| `description` | `'NocoDB - Open Source Airtable Alternative'` | Application description. |
| `db_name` | `'nocodb'` | Database name. |
| `db_user` | `'nocodb'` | Database user. |
| `cpu_limit` | `'1000m'` | CPU limit forwarded to the Foundation Module. |
| `memory_limit` | `'1Gi'` | Memory limit forwarded to the Foundation Module. |
| `min_instance_count` | `1` | Minimum instances forwarded to the Foundation Module. |
| `max_instance_count` | `10` | Maximum instances forwarded to the Foundation Module. |
| `startup_probe` | `{ path="/api/v1/health", initial_delay_seconds=30, ... }` | Startup probe configuration. |
| `liveness_probe` | `{ path="/api/v1/health", initial_delay_seconds=30, ... }` | Liveness probe configuration. |
| `environment_variables` | `{}` | Additional environment variables merged into the container config. |
| `enable_cloudsql_volume` | `true` | Whether to enable the Cloud SQL Auth Proxy sidecar. |
| `initialization_jobs` | `[]` | Initialization jobs configuration. |
| `enable_redis` | `false` | Enable Redis configuration. |
| `redis_host` | `null` | Redis host. |
| `redis_port` | `'6379'` | Redis port. |
| `redis_auth` | `""` | Redis authentication string. Sensitive. |

---

## 3. Application Module Wiring

Application modules use `NocoDB_Common` as follows:

```hcl
module "nocodb_app" {
  source = "../NocoDB_Common"

  project_id           = var.project_id
  tenant_deployment_id = var.tenant_deployment_id
  deployment_id        = local.random_id
  application_name     = var.application_name
  application_version  = var.application_version
  db_name              = var.application_database_name
  db_user              = var.application_database_user
  # ... other variables
}

locals {
  application_modules    = { nocodb = merge(module.nocodb_app.config, { ... }) }
  module_env_vars        = { GCS_BUCKET_NAME = "<prefix>-nocodb-uploads" }
  module_secret_env_vars = module.nocodb_app.secret_ids
  module_storage_buckets = module.nocodb_app.storage_buckets
  scripts_dir            = abspath("${module.nocodb_app.path}/scripts")
}
```
