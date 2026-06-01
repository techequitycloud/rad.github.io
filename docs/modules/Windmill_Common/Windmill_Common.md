---
title: "Windmill_Common Shared Configuration Module"
sidebar_label: "Windmill Common"
---

# Windmill_Common Shared Configuration Module

The `Windmill_Common` module defines the Windmill developer platform configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates a small set of GCP resources (a Secret Manager secret for SMTP) and produces `config`, `secret_ids`, and `storage_buckets` outputs consumed by platform-specific wrapper modules (`Windmill_CloudRun` and `Windmill_GKE`).

## 1. Overview

**Purpose**: To centralise all Windmill-specific configuration (custom container image, PostgreSQL 16 database setup, environment variable injection, health probes, storage bucket, SMTP secret, and initialisation job) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Windmill_CloudRun  ──┐
└── Windmill_GKE       ──┤── instantiate Windmill_Common
                          ↓
           Windmill_Common (this module)
           Creates: Secret Manager secret (SMTP password placeholder)
           Produces: config, secret_ids, storage_buckets
                          ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                          ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- The only `*_Common` module in the ecosystem that uses **PostgreSQL 16** instead of PostgreSQL 15.
- Creates **one GCP resource** — a Secret Manager secret (`{prefix}-smtp-password`) storing a placeholder 16-character SMTP password. Replace this placeholder in Secret Manager before enabling email features.
- Runs Windmill in **combined `server,worker` mode** — both the API server and script execution workers run in a single process. Suitable for Cloud Run and single-node GKE deployments.
- **`DISABLE_NSJAIL=true`** is always injected — required when the container does not have `CAP_SYS_ADMIN` or user namespaces enabled (Cloud Run, GKE Autopilot).

---

## 2. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"windmill"` |
| `display_name` | `var.display_name` (default: `"Windmill"`) |
| `description` | `var.description` (default: `"Windmill developer platform"`) |
| `application_version` | Version tag (default: `"latest"`) |
| `container_image` | `"ghcr.io/windmill-labs/windmill"` |
| `image_source` | `"custom"` — a custom wrapper image is built |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `false`) |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { APP_VERSION = <version> }` |
| `container_port` | `8000` |
| `database_type` | `"POSTGRES_16"` — Windmill requires PostgreSQL 16 |
| `db_name` | Database name (default: `"windmill"`) |
| `db_user` | Database user (default: `"windmill"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | List of GCS Fuse volume mounts (from `var.gcs_volumes`) |
| `container_resources` | CPU: `var.cpu_limit` (default `"2000m"`), Memory: `var.memory_limit` (default `"2Gi"`) |
| `min_instance_count` | `var.min_instance_count` (default `1`) |
| `max_instance_count` | `var.max_instance_count` (default `3`) |
| `environment_variables` | Windmill defaults merged with `var.environment_variables` — see §3 |
| `initialization_jobs` | Default `db-init` job or custom override — see §5 |
| `startup_probe` | HTTP `GET /api/version`, 30s initial delay, 5s timeout, 10s period, 6 failure threshold |
| `liveness_probe` | HTTP `GET /api/version`, 30s initial delay, 5s timeout, 30s period, 3 failure threshold |
| `readiness_probe` | HTTP `GET /api/version`, 30s initial delay, 5s timeout, 10s period, 3 failure threshold |

### `secret_ids`
A map of environment variable names to Secret Manager secret IDs:

| Key | Secret ID | Description |
|---|---|---|
| `WINDMILL_SMTP_PASS` | `{prefix}-smtp-password` | Placeholder SMTP password. Replace in Secret Manager before enabling email. |

### `storage_buckets`
A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|---|---|
| `name_suffix` | `"windmill-data"` |
| `location` | Deployment region (`var.region`) |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` |
| `force_destroy` | `true` |

---

## 3. Environment Variables

`Windmill_Common` injects the following environment variables into the container. These are hardcoded defaults merged with user-supplied `var.environment_variables`.

| Variable | Value | Description |
|---|---|---|
| `MODE` | `server,worker` | Combined server and worker mode. Runs both the Windmill API and script execution workers in a single process. Suitable for Cloud Run and single-container GKE deployments. |
| `NUM_WORKERS` | `3` | Number of concurrent worker threads per instance. |
| `WORKER_GROUP` | `default` | Worker group assignment. |
| `DISABLE_NSJAIL` | `true` | Disables Linux namespace isolation. Required on Cloud Run and GKE Autopilot where `CAP_SYS_ADMIN` is not available. |
| `JSON_FMT` | `true` | Structured JSON logging for Cloud Logging compatibility. |
| `RUST_LOG` | `windmill=info` | Rust log level for the Windmill server process. |
| `BASE_URL` | `var.service_url` | Public-facing service URL. Used for OAuth redirects and webhook callbacks. |
| `BASE_INTERNAL_URL` | `var.service_url` | Internal service URL. |
| `METRICS_ADDR` | `:9001` | Prometheus metrics endpoint. |

User-supplied variables from `var.environment_variables` are merged on top of these defaults — user values take precedence where keys overlap.

---

## 4. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"windmill"` | Application name |
| `application_version` | `string` | `"latest"` | Windmill Docker image tag |
| `display_name` | `string` | `"Windmill"` | Human-readable display name |
| `description` | `string` | `"Windmill developer platform"` | Module description |
| `db_name` | `string` | `"windmill"` | PostgreSQL database name |
| `db_user` | `string` | `"windmill"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"2000m"` | Container CPU limit |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables merged with Windmill defaults |
| `service_url` | `string` | `""` | Public URL for `BASE_URL` and `BASE_INTERNAL_URL` |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs; empty triggers the default `db-init` job |
| `startup_probe` | `object` | see above | Startup health probe configuration |
| `liveness_probe` | `object` | see above | Liveness health probe configuration |
| `enable_image_mirroring` | `bool` | `false` | Mirror the container image to Artifact Registry before deployment |
| `min_instance_count` | `number` | `1` | Minimum running instances |
| `max_instance_count` | `number` | `3` | Maximum running instances |

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts |
| `region` | `string` | `"us-central1"` | Region for the `windmill-data` storage bucket |

### Secrets

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID (required for Secret Manager resources) |
| `resource_prefix` | `string` | — | Prefix for the SMTP secret name |
| `labels` | `map(string)` | `{}` | Labels applied to Secret Manager secrets |

---

## 5. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|---|---|
| Image | `postgres:16-alpine` |
| Script | `scripts/db-init.sh` |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |
| CPU / Memory | `1000m` / `512Mi` |

`db-init.sh` creates the Windmill PostgreSQL database and user via the Cloud SQL Auth Proxy socket, granting the application user full privileges on the database. Override `initialization_jobs` with a non-empty list to replace this default with custom jobs.

---

## 6. Health Probes

All three probe types target `GET /api/version`, which returns HTTP 200 with the Windmill version string when the service is healthy:

| Probe | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|
| **Startup** | 30s | 5s | 10s | 6 | Allows up to 90s total for Windmill to start and connect to PostgreSQL |
| **Liveness** | 30s | 5s | 30s | 3 | Restarts the container if Windmill becomes unresponsive |
| **Readiness** | 30s | 5s | 10s | 3 | Removes the instance from the load balancer while temporarily unhealthy |

---

## 7. Secret Manager Resources

`Windmill_Common` creates the following Secret Manager resources:

| Resource | Type | Description |
|---|---|---|
| `google_secret_manager_secret.windmill_smtp_password` | Secret (empty shell) | Stores the SMTP password for Windmill email integration. Secret ID: `{prefix}-smtp-password`. |
| `google_secret_manager_secret_version.windmill_smtp_password` | Initial version | Placeholder 16-character random password. **Replace this value before enabling email features.** |
| `time_sleep.wait_for_secrets` | 30s delay | Waits for Secret Manager replication before dependent resources proceed. |

---

## 8. Platform-Specific Differences

| Aspect | Windmill_CloudRun | Windmill_GKE |
|---|---|---|
| `MODE` | `server,worker` (single process) | `server,worker` (single process per pod) |
| `min_instance_count` | `1` | `1` |
| `max_instance_count` | `3` | `3` |
| `DB_HOST` | Cloud SQL Auth Proxy socket path | Cloud SQL private IP |
| Worker scaling | Scale Cloud Run instances (`max_instance_count`) | Scale pod replicas or define separate worker Deployments |
| `DISABLE_NSJAIL` | Always `true` (Cloud Run lacks `CAP_SYS_ADMIN`) | Always `true` (GKE Autopilot lacks `CAP_SYS_ADMIN`) |

---

## 9. Implementation Pattern

```hcl
# Example: how Windmill_CloudRun instantiates Windmill_Common

module "windmill_app" {
  source = "../Windmill_Common"

  application_name    = var.application_name
  application_version = var.application_version
  display_name        = var.display_name
  description         = var.description
  db_name             = var.db_name
  db_user             = var.db_user
  cpu_limit           = var.cpu_limit
  memory_limit        = var.memory_limit
  service_url         = var.service_url
  environment_variables = var.environment_variables
  startup_probe       = var.startup_probe
  liveness_probe      = var.liveness_probe
  project_id          = var.project_id
  resource_prefix     = local.resource_prefix
  region              = var.region
  labels              = var.resource_labels
}

locals {
  application_modules    = { windmill = module.windmill_app.config }
  module_env_vars        = {}   # All env vars are in Windmill_Common
  module_secret_env_vars = module.windmill_app.secret_ids
  module_storage_buckets = module.windmill_app.storage_buckets
}
```
