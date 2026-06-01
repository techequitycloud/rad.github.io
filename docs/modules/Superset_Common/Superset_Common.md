---
title: "Superset_Common Shared Configuration Module"
sidebar_label: "Superset Common"
---

# Superset_Common Shared Configuration Module

The `Superset_Common` module defines the Apache Superset configuration for the RAD Modules ecosystem. It is a **configuration and secrets module** — it creates one Secret Manager secret and produces `config`, `secret_ids`, and `storage_buckets` outputs consumed by platform-specific wrapper modules (`Superset_CloudRun` and `Superset_GKE`).

## 1. Overview

**Purpose**: To centralise all Superset-specific configuration (custom container image with psycopg2, PostgreSQL 15 database setup, secret key generation, two-phase initialisation, health probes, and storage bucket) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Superset_CloudRun  ──┐
└── Superset_GKE       ──┤── instantiate Superset_Common
                          ↓
           Superset_Common (this module)
           Creates: Secret Manager secret (SUPERSET_SECRET_KEY)
           Produces: config, secret_ids, storage_buckets
                          ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
```

**Key characteristics**:
- Creates **one Secret Manager secret** — `SUPERSET_SECRET_KEY` (50-char random, no special characters). This key signs Flask sessions — rotating it invalidates all active user sessions.
- **Two-phase initialisation** — `db-init` (database creation) followed by `app-init` (schema migration + admin user creation). Both phases run automatically on first deploy.
- The bundled Dockerfile **pre-installs `psycopg2-binary`** for PostgreSQL connectivity, which requires native library compilation and must be done at image build time.
- Health probes target `/health` — Superset's Gunicorn health endpoint.

---

## 2. Outputs

### `config`

| Field | Value / Description |
|---|---|
| `app_name` | `"superset"` |
| `application_version` | Version tag (default: `"latest"`) |
| `display_name` | `var.display_name` (default: `"Superset"`) |
| `description` | `var.description` |
| `container_image` | `"apache/superset:latest"` |
| `image_source` | `"custom"` — custom image built with psycopg2 pre-installed |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `false`) |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = abspath("${path.module}/scripts")` |
| `container_port` | `8088` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | `var.db_name` (default: `"superset_db"`) |
| `db_user` | `var.db_user` (default: `"superset_user"`) |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` (default `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | `var.gcs_volumes` |
| `container_resources` | CPU: `var.cpu_limit` (default `"2000m"`), Memory: `var.memory_limit` (default `"2Gi"`) |
| `min_instance_count` | `var.min_instance_count` (default `1`) |
| `max_instance_count` | `var.max_instance_count` (default `5`) |
| `environment_variables` | `var.environment_variables` (passed through) |
| `enable_postgres_extensions` | `false` |
| `initialization_jobs` | Default two-phase pipeline or custom override — see §5 |
| `startup_probe` | HTTP `GET /health`, 60s initial delay, 5s timeout, 10s period, 12 failure threshold |
| `liveness_probe` | HTTP `GET /health`, 30s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `secret_ids`

| Key | Secret ID | Description |
|---|---|---|
| `SUPERSET_SECRET_KEY` | `{prefix}-secret-key` | Flask session signing key. 50-char random, no special characters. |

### `storage_buckets`

| Field | Value |
|---|---|
| `name_suffix` | `"superset-data"` |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` |

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"superset"` | Application name |
| `application_version` | `string` | `"latest"` | Superset Docker image tag |
| `display_name` | `string` | `"Superset"` | Human-readable display name |
| `description` | `string` | (see module) | Module description |
| `db_name` | `string` | `"superset_db"` | PostgreSQL database name |
| `db_user` | `string` | `"superset_user"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"2000m"` | Container CPU limit |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit |
| `environment_variables` | `map(string)` | `{}` | Environment variables passed through to the container |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs; empty triggers the default two-phase pipeline |
| `startup_probe` | `object` | see §4 | Startup health probe |
| `liveness_probe` | `object` | see §4 | Liveness health probe |
| `enable_image_mirroring` | `bool` | `false` | Mirror to Artifact Registry |
| `min_instance_count` | `number` | `1` | Minimum running instances |
| `max_instance_count` | `number` | `5` | Maximum running instances |

### Storage & Secrets

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Cloud SQL Auth Proxy sidecar |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts |
| `region` | `string` | `"us-central1"` | Region for GCS bucket |
| `project_id` | `string` | — | GCP project ID (required for Secret Manager) |
| `resource_prefix` | `string` | — | Prefix for the secret-key secret name |
| `labels` | `map(string)` | `{}` | Labels applied to Secret Manager secrets |

---

## 4. Health Probes

| Probe | Path | Initial Delay | Timeout | Period | Failure Threshold |
|---|---|---|---|---|---|
| **Startup** | `/health` | 60s | 5s | 10s | 12 |
| **Liveness** | `/health` | 30s | 5s | 30s | 3 |

The 60-second initial delay and 12-failure threshold give Superset up to 180 seconds of total startup tolerance. Gunicorn worker pool initialisation with psycopg2 connection pooling can be slow on first boot.

---

## 5. Initialization Jobs

`Superset_Common` provides a two-phase init pipeline by default (when `initialization_jobs = []`):

### Phase 1: `db-init`

| Field | Value |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |
| CPU / Memory | `1000m` / `512Mi` |

Creates the `superset_db` database and `superset_user` PostgreSQL user with appropriate privileges.

### Phase 2: `app-init`

| Field | Value |
|---|---|
| Image | `null` (uses the Superset application container) |
| Script | `scripts/app-init.sh` |
| `depends_on_jobs` | `["db-init"]` |
| `execute_on_apply` | `true` |
| Timeout | 1800s (30 minutes), 1 retry |
| CPU / Memory | `1000m` / `512Mi` |

Executes the Superset container to run:
1. `superset db upgrade` — applies Flask-AppBuilder and Superset schema migrations
2. `superset fab create-admin` — creates the initial admin user
3. `superset init` — loads default roles and permissions

**Note:** The single `app-init` job combines both `db upgrade` and admin initialisation into a single pod execution. The 30-minute timeout accommodates complex schema migrations on first run.

Override `initialization_jobs` with a non-empty list to replace this default pipeline entirely.

---

## 6. Scripts and Container Image

### `Dockerfile`
Wraps the public `apache/superset:<version>` image:
- Installs `psycopg2-binary` for PostgreSQL connectivity (requires native compilation — not available as a runtime pip install without build dependencies).
- Copies `app-init.sh` and `db-init.sh` to the container.
- Exposes port `8088`.

### `db-init.sh`
Creates the Superset PostgreSQL database and user via the Cloud SQL Auth Proxy socket.

### `app-init.sh`
Runs the Superset bootstrap sequence: `db upgrade`, `fab create-admin`, `superset init`. Reads admin credentials from environment variables or uses defaults.

---

## 7. Secret Manager Resources

| Resource | Description |
|---|---|
| `google_secret_manager_secret.superset_secret_key` | Secret shell with ID `{prefix}-secret-key`. |
| `google_secret_manager_secret_version.superset_secret_key` | Initial 50-char random value (special=false). |

**Rotation warning:** Rotating `SUPERSET_SECRET_KEY` invalidates all active user sessions. All logged-in users will be logged out immediately.

---

## 8. Platform-Specific Differences

| Aspect | Superset_CloudRun | Superset_GKE |
|---|---|---|
| `min_instance_count` | `1` | `1` |
| `redis_port` type | `number` (6379) | `string` ("6379") |
| `session_affinity` | Not applicable | `"ClientIP"` (recommended) |
| `DB_HOST` | Cloud SQL Auth Proxy socket | Cloud SQL private IP |
| Init jobs timeout | App-init: 1800s | App-init: 1800s |

---

## 9. Implementation Pattern

```hcl
module "superset_app" {
  source = "../Superset_Common"

  application_name    = var.application_name
  application_version = var.application_version
  db_name             = var.db_name
  db_user             = var.db_user
  cpu_limit           = var.cpu_limit
  memory_limit        = var.memory_limit
  startup_probe       = var.startup_probe
  liveness_probe      = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  project_id          = var.project_id
  resource_prefix     = local.resource_prefix
  region              = var.region
  labels              = var.resource_labels
}

locals {
  application_modules    = { superset = module.superset_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.superset_app.secret_ids
  module_storage_buckets = module.superset_app.storage_buckets
  scripts_dir            = abspath("${path.module}/../Superset_Common/scripts")
}
```
