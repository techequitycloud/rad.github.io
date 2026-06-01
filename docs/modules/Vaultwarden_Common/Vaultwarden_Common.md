---
title: "Vaultwarden_Common Shared Configuration Module"
sidebar_label: "Vaultwarden Common"
---

# Vaultwarden_Common Shared Configuration Module

The `Vaultwarden_Common` module defines the Vaultwarden password manager configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates no GCP resources and produces `config` and `storage_buckets` outputs consumed by platform-specific wrapper modules (`Vaultwarden_CloudRun` and `Vaultwarden_GKE`).

## 1. Overview

**Purpose**: To centralise all Vaultwarden-specific configuration (container image, database engine detection, health probes, storage bucket, and database initialisation job) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Vaultwarden_CloudRun  ──┐
└── Vaultwarden_GKE       ──┤── instantiate Vaultwarden_Common
                              ↓
           Vaultwarden_Common (this module)
           Creates: (no GCP resources)
           Produces: config, storage_buckets
                              ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
```

**Key characteristics**:
- Supports **both PostgreSQL 15 (default) and MySQL 8.0** — detected automatically via `database_type` regex matching.
- Creates **no GCP resources** — no Secret Manager secrets, no IAM bindings.
- Application-specific environment variables (`ROCKET_PORT`, `SIGNUPS_ALLOWED`, `DATA_FOLDER`, `DOMAIN`) are **injected by the wrapper modules** (`vaultwarden.tf`), not by `Vaultwarden_Common`.
- Health probes target `/alive` — Vaultwarden's dedicated lightweight health endpoint.

---

## 2. Outputs

### `config`

| Field | Value / Description |
|---|---|
| `app_name` | `"vaultwarden"` |
| `application_version` | Version tag (default: `"1.32.7"`) |
| `display_name` | `var.display_name` (default: `"Vaultwarden"`) |
| `description` | `var.description` (default: `"Vaultwarden password manager"`) |
| `container_image` | `"vaultwarden/server"` (public Docker Hub image) |
| `image_source` | `"custom"` — a custom wrapper image is built |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `false`) |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = abspath("${path.module}/scripts")` |
| `container_port` | `var.container_port` (default `80`) |
| `database_type` | `var.database_type` (default `"POSTGRES_15"`) |
| `db_name` | Database name (default: `"vaultwarden"`) |
| `db_user` | Database user (default: `"vaultwarden"`) |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` (default `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | `var.gcs_volumes` |
| `container_resources` | CPU: `var.cpu_limit` (default `"1000m"`), Memory: `var.memory_limit` (default `"512Mi"`) |
| `min_instance_count` | `var.min_instance_count` (default `1`) |
| `max_instance_count` | `var.max_instance_count` (default `3`) |
| `environment_variables` | `var.environment_variables` (passed through directly) |
| `secret_environment_variables` | `var.secret_environment_variables` (default `{}`) |
| `enable_postgres_extensions` | `false` |
| `enable_mysql_plugins` | `false` |
| `initialization_jobs` | Default `db-init` job (database-type-aware) or custom override — see §5 |
| `startup_probe` | `var.startup_probe` |
| `liveness_probe` | `var.liveness_probe` |

### `storage_buckets`

| Field | Value |
|---|---|
| `name_suffix` | `"vaultwarden-data"` (inferred from module defaults) |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` |

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"vaultwarden"` | Application name |
| `application_version` | `string` | `"1.32.7"` | Vaultwarden Docker image tag |
| `display_name` | `string` | `"Vaultwarden"` | Human-readable display name |
| `description` | `string` | `"Vaultwarden password manager"` | Module description |
| `database_type` | `string` | `"POSTGRES_15"` | Database engine. Options: `"POSTGRES_15"`, `"MYSQL_8_0"`. Controls the db-init job image. |
| `db_name` | `string` | `"vaultwarden"` | Database name |
| `db_user` | `string` | `"vaultwarden"` | Database user |
| `container_port` | `number` | `80` | Vaultwarden's HTTP listen port |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit |
| `memory_limit` | `string` | `"512Mi"` | Container memory limit |
| `environment_variables` | `map(string)` | `{}` | Environment variables passed through to the container |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager references |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs; empty triggers the default `db-init` job |
| `startup_probe` | `object` | see §4 | Startup health probe configuration |
| `liveness_probe` | `object` | see §4 | Liveness health probe configuration |
| `enable_image_mirroring` | `bool` | `false` | Mirror the container image to Artifact Registry |
| `min_instance_count` | `number` | `1` | Minimum running instances |
| `max_instance_count` | `number` | `3` | Maximum running instances |

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts |
| `region` | `string` | `"us-central1"` | Region for GCS bucket |

---

## 4. Health Probes

Default probe values (used when `startup_probe` and `liveness_probe` are not overridden):

| Probe | Path | Initial Delay | Timeout | Period | Failure Threshold |
|---|---|---|---|---|---|
| **Startup** | `/alive` | 30s | 5s | 10s | 6 |
| **Liveness** | `/alive` | 30s | 5s | 30s | 3 |

Vaultwarden starts quickly as a compiled Rust binary, so the probe delays are shorter than Node.js or Python-based modules.

---

## 5. Initialization Job

`Vaultwarden_Common` detects the database engine from `database_type` and supplies an appropriate `db-init` job:

| `database_type` | Job Image | Description |
|---|---|---|
| `POSTGRES_15` (or any non-MySQL value) | `postgres:15-alpine` | Initialises Vaultwarden PostgreSQL database and user |
| `MYSQL_8_0` (or any value starting with `MYSQL`) | `mysql:8.0-debian` | Initialises Vaultwarden MySQL database and user |

Detection logic: `is_mysql = length(regexall("^MYSQL", upper(database_type))) > 0`

| Field | Value |
|---|---|
| Job name | `db-init` |
| `execute_on_apply` | `true` |
| Timeout | 600s |
| Max retries | `3` |
| CPU / Memory | `1000m` / `512Mi` |
| `env_vars` | `{ DB_ENGINE = "mysql" or "postgres" }` |

Override `initialization_jobs` with a non-empty list to replace this default.

---

## 6. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as the Docker build context.

### `Dockerfile`
Wraps the public `vaultwarden/server:<version>` image. Copies any runtime configuration scripts needed for the Auth Proxy integration.

### `db-init.sh`
Database initialisation script. Creates the Vaultwarden database and user, granting full privileges. Behaviour adapts based on the `DB_ENGINE` environment variable (`mysql` or `postgres`).

---

## 7. Platform-Specific Differences

| Aspect | Vaultwarden_CloudRun | Vaultwarden_GKE |
|---|---|---|
| `workload_type` | Cloud Run service | StatefulSet (default) |
| `DATA_FOLDER` | `/data` (injected by wrapper) | `/data` (PVC mount at `/data`) |
| `min_instance_count` | `1` | `1` |
| `session_affinity` | Not applicable (Cloud Run) | `"ClientIP"` (default) |
| PVC | Not applicable | `10Gi` at `/data` (default) |
| `DB_HOST` | Cloud SQL Auth Proxy socket | Cloud SQL private IP |

---

## 8. Implementation Pattern

```hcl
# Example: how Vaultwarden_CloudRun instantiates Vaultwarden_Common

module "vaultwarden_app" {
  source = "../Vaultwarden_Common"

  application_name    = var.application_name
  application_version = var.application_version
  display_name        = var.display_name
  description         = var.description
  database_type       = var.database_type
  db_name             = var.db_name
  db_user             = var.db_user
  container_port      = var.container_port
  cpu_limit           = var.cpu_limit
  memory_limit        = var.memory_limit
  startup_probe       = var.startup_probe
  liveness_probe      = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  gcs_volumes         = var.gcs_volumes
  region              = var.region
}

# Application-specific env vars are injected by the wrapper (not Vaultwarden_Common)
locals {
  module_env_vars = merge(
    {
      ROCKET_PORT       = tostring(var.container_port)
      SIGNUPS_ALLOWED   = tostring(var.signups_allowed)
      WEB_VAULT_ENABLED = tostring(var.web_vault_enabled)
      DATA_FOLDER       = "/data"
    },
    var.domain != "" ? { DOMAIN = var.domain } : {}
  )
  module_secret_env_vars = module.vaultwarden_app.secret_ids
  module_storage_buckets = module.vaultwarden_app.storage_buckets
}
```
