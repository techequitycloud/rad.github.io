# Open WebUI Common Module

This document provides a reference for the `modules/OpenWebUI_Common` Terraform module. This is the **Common** tier module that provides application-specific configuration shared between `OpenWebUI_CloudRun` and `OpenWebUI_GKE`.

---

## 1. Module Overview

`OpenWebUI Common` is the application-specific configuration layer for Open WebUI. It is called by both `OpenWebUI CloudRun` and `OpenWebUI GKE` to produce the standardised `config`, `secret_ids`, and `storage_buckets` outputs that the Foundation Modules consume.

**Responsibilities:**
*   Defines the Open WebUI container configuration: image (`ghcr.io/open-webui/open-webui`), container port (8080), health probe paths (`/health`), and default environment variables.
*   Auto-generates `WEBUI_SECRET_KEY` and stores it in Secret Manager. Outputs the secret ID via `secret_ids`.
*   Provisions GCS data bucket and outputs it via `storage_buckets`.
*   Sets `DATABASE_URL` from the injected `DB_*` env vars.
*   Configures Open WebUI-specific environment variables: `WEBUI_URL`, `OLLAMA_BASE_URL`, `OPENAI_API_BASE_URL`, `DEFAULT_USER_ROLE`, `ENABLE_SIGNUP`, `WEBUI_AUTH`.
*   Provisions the `db-init` Cloud Run Job that creates the PostgreSQL database and user on first apply.

**Outputs:**

| Output | Description |
|---|---|
| `config` | Open WebUI application configuration object consumed by Foundation Modules. |
| `secret_ids` | Map of env var name → Secret Manager secret ID. Includes `WEBUI_SECRET_KEY`. |
| `storage_buckets` | List of GCS bucket configurations including the data bucket. |

---

## 2. Variables

`OpenWebUI Common` variables are set by the calling Application Module and are not directly user-configurable.

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. Required. |
| `resource_prefix` | — | Prefix for resource naming (passed from App_CloudRun/App_GKE). |
| `tenant_deployment_id` | `'demo'` | Deployment environment identifier. |
| `deployment_id` | `""` | Deployment ID suffix. |
| `region` | `'us-central1'` | GCP region. |
| `labels` | `{}` | Labels for all resources. |
| `application_name` | `'openwebui'` | Internal application name. |
| `application_version` | `'latest'` | Open WebUI image version tag. |
| `display_name` | `'Open WebUI'` | Human-readable display name. |
| `description` | `'Open WebUI — a self-hosted AI interface...'` | Application description. |
| `db_name` | `'openwebui'` | Database name. |
| `db_user` | `'openwebui'` | Database user. |
| `cpu_limit` | `'2000m'` | CPU limit. |
| `memory_limit` | `'4Gi'` | Memory limit. |
| `min_instance_count` | `0` | Minimum instances. |
| `max_instance_count` | `3` | Maximum instances. |
| `startup_probe` | `{ path="/health", initial_delay_seconds=30, failure_threshold=30 }` | Startup probe configuration. |
| `liveness_probe` | `{ path="/health", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe configuration. |
| `service_url` | `""` | The predicted Cloud Run/GKE service URL, used to populate `WEBUI_URL`. |
| `ollama_base_url` | `""` | Ollama backend URL. Injected as `OLLAMA_BASE_URL`. |
| `openai_api_base_url` | `""` | OpenAI-compatible API base URL. Injected as `OPENAI_API_BASE_URL`. |
| `default_user_role` | `'pending'` | Default new-user role. Injected as `DEFAULT_USER_ROLE`. |
| `enable_signup` | `true` | Whether to allow self-registration. |
| `webui_auth` | `true` | Whether to enable the login system (`WEBUI_AUTH`). |
| `environment_variables` | `{}` | Additional environment variables. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. |
| `initialization_jobs` | `[]` | Initialization jobs. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |

---

## 3. Application Module Wiring

```hcl
module "openwebui_app" {
  source = "../OpenWebUI_Common"

  project_id           = var.project_id
  resource_prefix      = local.resource_prefix
  tenant_deployment_id = var.tenant_deployment_id
  deployment_id        = local.random_id
  region               = local.region
  labels               = var.resource_labels

  application_name    = var.application_name
  application_version = var.application_version
  db_name             = var.db_name
  db_user             = var.db_user

  ollama_base_url     = var.ollama_base_url
  openai_api_base_url = var.openai_api_base_url
  default_user_role   = var.default_user_role
  enable_signup       = var.enable_signup
  webui_auth          = var.webui_auth

  service_url = local.predicted_service_url
  # ... other variables
}

locals {
  openwebui_module = merge(
    module.openwebui_app.config,
    { description = var.description, container_port = var.container_port }
  )

  application_modules    = { openwebui = local.openwebui_module }
  module_env_vars        = {}
  module_secret_env_vars = module.openwebui_app.secret_ids
  module_storage_buckets = module.openwebui_app.storage_buckets
}
```
