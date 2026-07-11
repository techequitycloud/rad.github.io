---
title: "InvoiceNinja Common Shared Configuration Module"
description: "Shared configuration reference for the InvoiceNinja module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# InvoiceNinja Common Shared Configuration Module

The `InvoiceNinja Common` module defines the Invoice Ninja application configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates no GCP resources directly and produces a `config` output consumed by platform-specific wrapper modules (`InvoiceNinja CloudRun` and `InvoiceNinja GKE`).

## 1. Overview

**Purpose**: To centralise all Invoice Ninja-specific configuration (container image, MySQL 8.0 database setup, environment variable mapping, health probes, storage bucket, auto-generated secrets, and initialisation job definitions) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── InvoiceNinja_CloudRun  ──┐
└── InvoiceNinja_GKE       ──┤── instantiate InvoiceNinja_Common
                              ↓
               InvoiceNinja_Common (this module)
               Creates: APP_KEY secret in Secret Manager
               Produces: config, secret_ids, storage_buckets, path
                              ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                              ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- One of the few modules in the ecosystem that uses **MySQL 8.0** instead of PostgreSQL. Invoice Ninja's Laravel application only supports MySQL.
- **Auto-generates the `APP_KEY` secret** — a base64-encoded 32-byte random Laravel encryption key, stored in Secret Manager as `base64:<value>`. This is generated once on first apply and is not regenerated on subsequent applies.
- Defines **two initialisation jobs** (`db-init` and `artisan-migrate`) that run sequentially on deployment.
- Configures **snappdf PDF generation** with Chromium bundled in the `invoiceninja/invoiceninja:5` container.
- Injects `TRUSTED_PROXIES=*` to correctly handle Cloud Run and GKE reverse proxy headers in Laravel.

---

## 2. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"invoiceninja"` |
| `application_version` | Version tag (default: `"5"`) |
| `container_image` | `"invoiceninja/invoiceninja"` (public Docker Hub image) |
| `image_source` | `"prebuilt"` by default — the official image is deployed directly without a custom build step |
| `container_port` | `80` — Invoice Ninja uses nginx on port 80 |
| `database_type` | `"MYSQL_8_0"` — Invoice Ninja requires MySQL 8.0+ |
| `db_name` | Database name (default: `"invoiceninja"`) |
| `db_user` | Database user (default: `"invoiceninja"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | List of GCS Fuse volume mounts (empty by default) |
| `container_resources` | CPU: `2000m`, Memory: `2Gi` — Chromium PDF generation requires significant resources |
| `environment_variables` | Passed through from `var.environment_variables` merged with Invoice Ninja-specific defaults (see §4) |
| `secret_environment_variables` | Contains `APP_KEY` reference plus any additional secrets from `var.secret_environment_variables` |
| `initialization_jobs` | Default `db-init` + `artisan-migrate` jobs or custom override (see §5) |
| `startup_probe` | HTTP `GET /`, 90s initial delay, 10s timeout, 15s period, 30 failure threshold |
| `liveness_probe` | HTTP `GET /`, 120s initial delay, 10s timeout, 30s period, 3 failure threshold |

### `secret_ids`
A map containing the Secret Manager secret IDs for secrets created by this module:

| Key | Description |
|---|---|
| `APP_KEY` | Laravel application encryption key. Secret ID in the format `projects/PROJECT_ID/secrets/APP_KEY_SECRET_NAME`. |

> **Note:** Unlike most modules where `secret_ids` is passed through via `module_secret_env_vars` in the wrapper's `main.tf`, the `APP_KEY` for Invoice Ninja is wired directly inside `InvoiceNinja Common` into the `config.secret_environment_variables` field. The wrapper does not need to separately handle this secret.

### `storage_buckets`
A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|---|---|
| `name_suffix` | `"data"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"enforced"` |

### `path`
The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. Required for Secret Manager resource creation. |
| `resource_prefix` | `string` | — | Prefix used for naming Secret Manager resources. |
| `application_name` | `string` | `"invoiceninja"` | Application name. Used as base for resource naming. |
| `display_name` | `string` | `"Invoice Ninja"` | Human-readable application name. |
| `description` | `string` | `"Invoice Ninja open-source invoicing platform"` | Description passed to init job definitions. |
| `application_version` | `string` | `"5"` | Invoice Ninja Docker image tag. Increment to deploy a new release. |
| `tenant_deployment_id` | `string` | `"demo"` | Deployment identifier appended to resource names. |
| `region` | `string` | `"us-central1"` | GCP region for the storage bucket location. |
| `db_name` | `string` | `"invoiceninja"` | MySQL database name. **Do not change after initial deployment.** |
| `db_user` | `string` | `"invoiceninja"` | MySQL application user. |
| `cpu_limit` | `string` | `"2000m"` | Container CPU limit passed into `config.container_resources`. |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit. Minimum 2 Gi for Chromium PDF generation. |
| `environment_variables` | `map(string)` | `{}` | Additional plain-text environment variables. Merged with Invoice Ninja defaults. |
| `secret_environment_variables` | `map(string)` | `{}` | Additional Secret Manager references. Merged with the auto-generated `APP_KEY` reference. |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs. Empty triggers the default `db-init` + `artisan-migrate` pair. |
| `startup_probe` | `object` | see §6 | Startup health probe configuration. |
| `liveness_probe` | `object` | see §6 | Liveness health probe configuration. |
| `invoiceninja_admin_email` | `string` | `"admin@example.com"` | Administrator email for login and system notifications. |
| `mail_from_name` | `string` | `"Invoice Ninja"` | Display name for outgoing emails. |
| `mail_from_address` | `string` | `"ninja@example.com"` | Sender email address for outgoing emails. |

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket into the container. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |
| `labels` | `map(string)` | `{}` | Labels to apply to all created resources. |

---

## 4. Auto-Injected Environment Variables

`InvoiceNinja Common` injects the following environment variables into the application config automatically. These cannot be overridden via `environment_variables` at the wrapper level — they are merged with lower precedence than user-supplied values.

| Variable | Value | Purpose |
|---|---|---|
| `APP_ENV` | `"production"` | Laravel environment mode. |
| `APP_DEBUG` | `"false"` | Disables Laravel debug output in production. |
| `DB_CONNECTION` | `"mysql"` | Laravel database driver selection. |
| `TRUSTED_PROXIES` | `"*"` | Required for Cloud Run and GKE load balancer reverse proxy headers (X-Forwarded-For, X-Forwarded-Proto). Without this, Laravel generates HTTP links even when the client accesses via HTTPS. |
| `PDF_GENERATOR` | `"snappdf"` | Selects the snappdf Chromium-based PDF renderer. |
| `SNAPPDF_EXECUTABLE_PATH` | `"/usr/local/bin/chrome"` | Path to the bundled Chromium executable inside the `invoiceninja/invoiceninja:5` container. |
| `MAIL_FROM_NAME` | `var.mail_from_name` | Display name for outgoing Invoice Ninja emails. |
| `MAIL_FROM_ADDRESS` | `var.mail_from_address` | Sender email address for outgoing emails. |

The `APP_KEY` secret reference is injected via `secret_environment_variables` (not `environment_variables`) — it is resolved at runtime by Cloud Run or Kubernetes from Secret Manager.

---

## 5. Initialization Jobs

Two jobs are provisioned by default when `initialization_jobs = []`:

### Job 1: `db-init`

| Field | Value |
|---|---|
| Image | `mysql:8.0-debian` |
| Script | `scripts/db-init.sh` |
| Secrets required | `ROOT_PASSWORD` (MySQL root), `DB_PASSWORD` (app user) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |
| CPU / Memory | `1000m` / `512Mi` |

`db-init.sh` behaviour:
1. Connects to Cloud SQL MySQL via the Auth Proxy Unix socket (path from `DB_HOST`).
2. Polls MySQL until available (up to 30 retries, 2s apart).
3. Creates the `invoiceninja` database with `utf8mb4` charset and `utf8mb4_0900_ai_ci` collation (required for MySQL 8.0 compatibility with Laravel).
4. Creates (or updates) the `invoiceninja` user with `mysql_native_password` authentication — chosen for compatibility with Laravel's PDO MySQL driver.
5. Grants `ALL PRIVILEGES` on the `invoiceninja` database.
6. Verifies the application user can connect.
7. Signals Cloud SQL Proxy shutdown.

### Job 2: `artisan-migrate`

| Field | Value |
|---|---|
| Image | Invoice Ninja application image (`invoiceninja/invoiceninja:5`) |
| Command | `php artisan migrate --seed --force` |
| `execute_on_apply` | `true` |
| `depends_on_jobs` | `["db-init"]` |
| Timeout | 600s, 2 retries |
| CPU / Memory | `1000m` / `512Mi` |

`artisan-migrate` runs Laravel's database migration system. On first deployment it creates all Invoice Ninja tables and seeds initial data (default payment types, currencies, tax rates, etc.). On subsequent deployments it applies any new migrations introduced by Invoice Ninja version upgrades. The `--force` flag suppresses the interactive confirmation prompt in production mode. The `--seed` flag runs database seeders on first run and is idempotent on subsequent runs.

Override `initialization_jobs` with a non-empty list to replace both default jobs with custom jobs. When `initialization_jobs` is non-empty, `InvoiceNinja Common` does not inject either default job.

---

## 6. Health Probes

All probes target `GET /` (the Invoice Ninja login page or dashboard, which returns HTTP 200 when the application is fully ready). Invoice Ninja does not expose a dedicated `/healthz` endpoint.

| Probe | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|
| **Startup** | 90s | 10s | 15s | 30 | Allows up to 540s total for Invoice Ninja to complete PHP-FPM initialisation, configuration caching, and first-boot database migrations |
| **Liveness** | 120s | 10s | 30s | 3 | Restarts the container if Invoice Ninja becomes unresponsive after a full start sequence |

The generous startup probe thresholds accommodate Invoice Ninja's `artisan-migrate` process, which runs synchronously on the first boot when `APP_ENV=production` and no existing schema is detected.

**Compared to `App CloudRun`/`App GKE` defaults:**

| Field | App CloudRun | InvoiceNinja Common | Reason |
|---|---|---|---|
| `path` | `/healthz` | `/` | Invoice Ninja has no `/healthz` endpoint. |
| Startup `initial_delay_seconds` | `10` | `90` | PHP-FPM + Laravel bootstrap + optional migration takes 30–90 seconds. |
| Startup `failure_threshold` | `3` | `30` | 30 × 15s = 450s of additional tolerance after the 90s delay. |
| Liveness `initial_delay_seconds` | `15` | `120` | Prevents premature liveness failures before the startup sequence is complete. |

---

## 7. APP_KEY Secret Management

The `APP_KEY` is Laravel's application encryption key. It is used to encrypt cookies, session data, and other sensitive values. All encrypted data becomes unreadable if the key is changed or lost.

**Generation:** `InvoiceNinja Common` generates a 32-byte cryptographically random value, base64-encodes it, and stores it in Secret Manager as `base64:<value>`. This format is required by Laravel's `Crypt` facade.

**Injection:** The `APP_KEY` secret is referenced in `config.secret_environment_variables` as:

```
{ APP_KEY = "<secret-manager-secret-id>" }
```

Cloud Run and GKE resolve this reference at container start, injecting the plaintext value as an environment variable. The plaintext is never written to state.

**Rotation:** The `APP_KEY` is a one-time generated secret — it is created on the first apply and never rotated automatically. Changing the `APP_KEY` after initial deployment invalidates all existing user sessions, encrypted cookies, and any data encrypted with the old key. Do not rotate this key unless you have a migration plan for re-encrypting existing data.

---

## 8. Platform-Specific Differences

| Aspect | InvoiceNinja CloudRun | InvoiceNinja GKE |
|---|---|---|
| `container_image_source` | `"prebuilt"` default | `"prebuilt"` default |
| `min_instance_count` | `1` (configurable) | `1` (configurable) |
| `max_instance_count` | `3` (configurable) | `5` (configurable) |
| `enable_cloudsql_volume` | Optional (default `true`) | Optional (default `true`) |
| `DB_HOST` at runtime | Cloud SQL Auth Proxy socket path under `/cloudsql` | Cloud SQL private IP (GKE pods use sidecar or direct connection) |
| Redis variables | Group 21 | Group 15 |
| Session affinity | Not applicable (Cloud Run manages routing) | `"ClientIP"` default — prevents admin session drops across pod replicas |
| NFS | Enabled by default (`enable_nfs = true`) | Enabled by default (`enable_nfs = true`) |

---

## 9. Implementation Pattern

```hcl
# Example: how InvoiceNinja_CloudRun instantiates InvoiceNinja_Common

module "invoiceninja_app" {
  source = "../InvoiceNinja_Common"

  project_id             = var.project_id
  resource_prefix        = local.resource_prefix
  application_version    = var.application_version
  db_name                = var.application_database_name
  db_user                = var.application_database_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  description            = var.application_description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  invoiceninja_admin_email = var.invoiceninja_admin_email
  mail_from_name         = var.mail_from_name
  mail_from_address      = var.mail_from_address
  environment_variables  = var.environment_variables
}

locals {
  application_modules    = { invoiceninja = module.invoiceninja_app.config }
  module_secret_env_vars = module.invoiceninja_app.secret_ids
  module_storage_buckets = module.invoiceninja_app.storage_buckets
  scripts_dir            = abspath("${module.invoiceninja_app.path}/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config          = local.application_modules
  module_secret_env_vars      = local.module_secret_env_vars
  module_storage_buckets      = local.module_storage_buckets
  scripts_dir                 = local.scripts_dir
  # ... other inputs
}
```
