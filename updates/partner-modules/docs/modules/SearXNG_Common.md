# SearXNG Common Module

This document provides a reference for the `modules/SearXNG_Common` Terraform module. This is the **Common** tier module that provides application-specific configuration shared between `SearXNG_CloudRun` and `SearXNG_GKE`.

---

## 1. Module Overview

`SearXNG_Common` is the application-specific configuration layer for SearXNG. It is called by both `SearXNG_CloudRun` and `SearXNG_GKE` to produce the standardised `config`, `secret_ids`, and `storage_buckets` outputs that the Foundation Modules consume.

**Responsibilities:**
*   Defines the SearXNG container configuration: image (`searxng/searxng`), container port (8080), health probe paths (`/healthz`), and default environment variables.
*   Auto-generates `SEARXNG_SECRET` (session key) and stores it in Secret Manager. Outputs the secret ID and explicit value via `secret_ids`.
*   Outputs an empty `storage_buckets` list (SearXNG is stateless — no GCS bucket required).
*   Sets the `enable_image_mirroring` flag to mirror the SearXNG image into Artifact Registry.

**Note on `SEARXNG_SECRET`:** This secret is the cryptographic session key for SearXNG. All running instances must share the same value. `SearXNG_Common` generates it once and stores it in Secret Manager. For GKE deployments, the explicit value is also output to allow the CSI driver to inject it without read-after-write consistency issues on first apply.

**Outputs:**

| Output | Description |
|---|---|
| `config` | SearXNG application configuration object consumed by Foundation Modules. |
| `secret_ids` | Map containing `SEARXNG_SECRET` → Secret Manager secret ID. |
| `storage_buckets` | Empty list (SearXNG has no persistent storage). |

---

## 2. Variables

`SearXNG_Common` variables are set by the calling Application Module.

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. Required. |
| `deployment_id` | `""` | Deployment ID suffix. |
| `resource_prefix` | `""` | Optional resource prefix override. Pass `App_GKE`'s resource prefix for GKE deployments. |
| `tenant_deployment_id` | `'demo'` | Deployment environment identifier. |
| `resource_labels` | `{}` | Labels for all resources. |
| `application_name` | `'searxng'` | Internal application name used in resource naming. |
| `application_version` | `'latest'` | SearXNG image version tag. |
| `enable_image_mirroring` | `true` | Whether to mirror the container image into Artifact Registry. |
| `cpu_limit` | `'500m'` | CPU limit forwarded to the Foundation Module. |
| `memory_limit` | `'512Mi'` | Memory limit forwarded to the Foundation Module. |
| `min_instance_count` | `0` | Minimum instances. |
| `max_instance_count` | `3` | Maximum instances. |
| `startup_probe` | `{ path="/healthz", initial_delay_seconds=10, failure_threshold=6 }` | Startup probe configuration. |
| `liveness_probe` | `{ path="/healthz", initial_delay_seconds=15, failure_threshold=3 }` | Liveness probe configuration. |
| `environment_variables` | `{}` | Additional plain-text env vars. |

---

## 3. Application Module Wiring

```hcl
module "searxng_app" {
  source = "../SearXNG_Common"

  deployment_id        = local.random_id
  project_id           = var.project_id
  tenant_deployment_id = var.tenant_deployment_id
  resource_labels      = var.resource_labels
  application_name     = var.application_name
  application_version  = var.application_version
  cpu_limit            = var.cpu_limit
  memory_limit         = var.memory_limit
  startup_probe        = var.startup_probe
  liveness_probe       = var.liveness_probe
  environment_variables = var.environment_variables
  enable_image_mirroring = var.enable_image_mirroring
}

locals {
  searxng_module = merge(module.searxng_app.config, {
    min_instance_count = 0   # Cloud Run: hardcoded to 0
    max_instance_count = var.max_instance_count
  })

  application_modules = { searxng = local.searxng_module }

  module_env_vars = {
    SEARXNG_BIND_ADDRESS = "0.0.0.0:8080"
    ENABLE_REDIS         = tostring(var.enable_redis)
    REDIS_URL            = var.enable_redis ? "redis://${coalesce(var.redis_host, "127.0.0.1")}:${var.redis_port}" : ""
  }

  module_secret_env_vars = { SEARXNG_SECRET = module.searxng_app.secret_ids.SEARXNG_SECRET }
  module_storage_buckets = module.searxng_app.storage_buckets
}
```
