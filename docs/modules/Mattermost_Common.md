---
title: "Mattermost Common Shared Configuration Module"
description: "Shared configuration reference for the Mattermost module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Mattermost Common Shared Configuration Module

The `Mattermost Common` module defines the Mattermost team messaging platform configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates no GCP resources and produces a `config` output consumed by platform-specific wrapper modules (`Mattermost CloudRun` and `Mattermost GKE`).

## 1. Overview

**Purpose**: To centralise all Mattermost-specific configuration (custom container image, PostgreSQL 15 database setup, environment variable mapping, health probes, and initialization job) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Mattermost_CloudRun  ──┐
└── Mattermost_GKE       ──┤── instantiate Mattermost_Common
                           ↓
              Mattermost_Common (this module)
              Creates: (no GCP resources)
              Produces: config, secret_ids, storage_buckets, path
                           ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                           ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Uses **PostgreSQL 15** — Mattermost requires PostgreSQL 13 or later and does not support MySQL.
- Creates **no GCP resources** — no secrets, no IAM bindings. Mattermost generates its own internal signing keys, session secrets, and encryption keys at first startup and persists them in the PostgreSQL database.
- Exposes a **dedicated health endpoint** at `/api/v4/system/ping` — used by both startup and liveness probes for precise health signalling. This is distinct from most other modules that probe the application root path (`/`).
- **`container_image` is hardcoded to `mattermost/mattermost-team-edition`** — `Mattermost_Common` itself has no `edition` variable. Edition-aware image selection (`edition = "enterprise"` → `mattermost/mattermost-enterprise-edition`) is implemented by the wrapper modules (`Mattermost_CloudRun`, `Mattermost_GKE`), which override `container_image` in their own `application_config` merge when `var.edition == "enterprise"`.
- **Redis-aware configuration**: when `enable_redis = true`, injects `MM_CACHEBACKEND=redis`, `MM_REDIS_ADDRESS`, and `MM_REDIS_PASSWORD` environment variables automatically.

---

## 2. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"mattermost"` |
| `application_version` | Version tag (default: `"9.11.2"`) |
| `container_image` | `"mattermost/mattermost-team-edition"` (hardcoded; wrapper modules override this to the enterprise image when `edition = "enterprise"`) |
| `image_source` | `"custom"` — a custom wrapper image is built from the Common module Dockerfile |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `true`) — mirrors the Mattermost Docker Hub image to Artifact Registry before deployment |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { MM_VERSION = <version, "latest" mapped to "9.11.2"> }` (an app-specific arg name so the Foundation's generic `APP_VERSION` injection cannot override it) |
| `container_port` | `8065` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (default: `"mattermost"`) |
| `db_user` | Database user (default: `"mattermost"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | List of GCS Fuse volume mounts passed through from `var.gcs_volumes` |
| `container_resources` | CPU: `2000m`, Memory: `2Gi` (default; higher values recommended for active teams) |
| `environment_variables` | Core Mattermost environment variables (see §4) merged with `var.environment_variables` |
| `secret_environment_variables` | `var.secret_environment_variables` — secret env vars passed to the container; managed externally by default |
| `initialization_jobs` | Default `db-init` job or custom override — see §5 |
| `startup_probe` | HTTP `GET /api/v4/system/ping`, 30s initial delay, 10s timeout, 10s period, 30 failure threshold |
| `liveness_probe` | HTTP `GET /api/v4/system/ping`, 30s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `secret_ids`
An empty map (`{}`). Mattermost Common does not auto-generate application secrets. Mattermost generates its own internal keys at first startup and stores them in PostgreSQL. The wrapper modules' `module_secret_env_vars` is set to this empty map.

### `storage_buckets`
A single-element list declaring one `data` bucket (`name_suffix = "data"`, `STANDARD` class, `force_destroy = true`, versioning off, `public_access_prevention = "enforced"`). The wrapper modules forward this output verbatim as `module_storage_buckets`, so the bucket is actually provisioned — despite this, the module's primary file-storage path is `gcs_volumes` (mounted at `/mattermost/data`), not this bucket.

### `path`
The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"mattermost"` | Application name — used as base name for resources. |
| `application_version` | `string` | `"9.11.2"` | Mattermost Docker image tag. Increment to deploy a new release. |
| `description` | `string` | `"Initialize Mattermost database schema"` | Description used in the default `db-init` job. |
| `db_name` | `string` | `"mattermost"` | PostgreSQL database name. |
| `db_user` | `string` | `"mattermost"` | PostgreSQL application user. |
| `cpu_limit` | `string` | `"2000m"` | CPU limit for the Mattermost container. |
| `memory_limit` | `string` | `"2Gi"` | Memory limit for the Mattermost container. |
| `environment_variables` | `map(string)` | `{}` | Extra environment variables merged into the core Mattermost configuration. |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs. Empty list triggers the default `db-init` job. |
| `startup_probe` | `object` | see §6 | Startup health probe configuration. |
| `liveness_probe` | `object` | see §6 | Liveness health probe configuration. |
| `enable_image_mirroring` | `bool` | `true` | Mirror the container image to Artifact Registry before deployment. |
| `min_instance_count` | `number` | `1` | Minimum number of running instances. Default `1` prevents scale-to-zero in Cloud Run. |
| `max_instance_count` | `number` | `3` | Maximum number of running instances. |
| `region` | `string` | `"us-central1"` | GCP region for resource deployment. |
| `site_url` | `string` | `""` | The public URL where Mattermost is accessible. Sets `MM_SERVICESETTINGS_SITEURL`. |

> `edition` is **not** a `Mattermost_Common` variable — it is declared on the wrapper modules (`Mattermost_CloudRun`, `Mattermost_GKE`) and used there to select the container image. See §9.

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts. Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Mount at `/mattermost/data` for persistent file uploads. |

### Redis Integration

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `false` | Enable Redis for Mattermost caching and session storage. When `true`, injects Redis-specific environment variables automatically. |
| `redis_host` | `string` | `""` | Redis hostname or IP address. Required when `enable_redis = true`. |
| `redis_port` | `string` | `"6379"` | Redis server TCP port. |
| `redis_auth` | `string` | `""` | Redis AUTH password. Marked `sensitive` in Terraform, but injected as a **plain** `MM_REDIS_PASSWORD` environment variable (not a Secret Manager reference) when non-empty — `secret_environment_variables` is always `{}` from this module. |

---

## 4. Environment Variables

Mattermost Common injects a set of core environment variables into every deployment. All Mattermost configuration uses the `MM_` prefix with double-underscore path notation for nested settings.

### Core Service Settings

| Variable | Value / Source | Purpose |
|---|---|---|
| `MM_SERVICESETTINGS_LISTENADDRESS` | `:8065` | Binds Mattermost's HTTP server to all interfaces on port 8065. |
| `MM_METRICSSETTINGS_LISTENADDRESS` | `:8067` | Prometheus-format metrics endpoint. Integrate with Cloud Monitoring via remote write. |
| `MM_SERVICESETTINGS_SITEURL` | `var.site_url` (when non-empty) | The public URL for link generation in emails, webhooks, and OAuth callbacks. |
| `MM_SERVICESETTINGS_TRUSTEDPROXYIPHEADER` | `X-Forwarded-For` | Tells Mattermost to trust the `X-Forwarded-For` header from Cloud Run's and the load balancer's proxy layer for correct client IP extraction. |

### File Storage

| Variable | Value | Purpose |
|---|---|---|
| `MM_FILESETTINGS_DRIVERTYPE` | `local` | Instructs Mattermost to use local filesystem storage. When a GCS FUSE volume is mounted at `/mattermost/data`, this resolves to durable object storage transparently. |
| `MM_FILESETTINGS_DIRECTORY` | `/mattermost/data/` | File storage path — must match the GCS FUSE or NFS mount point. |

### Logging

| Variable | Value | Purpose |
|---|---|---|
| `MM_LOGSETTINGS_CONSOLELEVEL` | `INFO` | Log level written to stdout. Cloud Run and GKE capture stdout to Cloud Logging automatically. |
| `MM_LOGSETTINGS_ENABLEFILE` | `false` | Disables file-based logging. File logs are not appropriate for containerised deployments — all log output goes to stdout and is captured by Cloud Logging. |

### Email Batching

| Variable | Value | Purpose |
|---|---|---|
| `MM_EMAILSETTINGS_ENABLEEMAILBATCHING` | `false` | Disabled for Cloud Run compatibility. Email batching requires an in-memory queue that does not survive container restarts or scale-to-zero events. |

### Redis Cache (injected when `enable_redis = true`)

| Variable | Value / Source | Purpose |
|---|---|---|
| `MM_CACHEBACKEND` | `redis` | Switches Mattermost's cache backend from in-process memory to the external Redis instance. |
| `MM_REDIS_ADDRESS` | `<redis_host>:<redis_port>` | Connection string for the Redis server. |
| `MM_REDIS_PASSWORD` | `var.redis_auth` (when non-empty) | Redis AUTH password, injected as a secret env var when set. |

When `enable_redis = false`, `MM_CACHEBACKEND` is set to `memory` and no Redis connection variables are injected.

---

## 5. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets required | `DB_PASSWORD` (application user password), `ROOT_PASSWORD` (PostgreSQL superuser, optional) |
| `execute_on_apply` | `true` |
| CPU / Memory | `1000m` / `512Mi` |
| Timeout | 600s, 1 retry |

`db-init.sh` behaviour:
1. Connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket or TCP.
2. Creates the `mattermost` user with the password from Secret Manager if it does not exist.
3. Creates the `mattermost` database if it does not exist.
4. Grants the `mattermost` user full privileges on the database.
5. Verifies connectivity by running a simple `SELECT 1` query as the application user.

Mattermost then runs its own schema migrations on startup — the `db-init` job only creates the empty database and user; it does not initialise the Mattermost schema. This is by design: Mattermost's built-in migration system handles schema setup and version upgrades automatically.

Override `initialization_jobs` with a non-empty list to replace this default job entirely.

---

## 6. Health Probes

Mattermost Common configures startup and liveness probes targeting the `/api/v4/system/ping` endpoint. This endpoint is part of Mattermost's REST API and returns `HTTP 200` when the server is fully initialised, database-connected, and ready to serve requests.

This is a more precise health signal than probing the root path (`/`): the ping endpoint validates that Mattermost has successfully connected to PostgreSQL and completed any pending schema migrations.

| Probe | Path | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|---|
| **Startup** | `/api/v4/system/ping` | 30s | 10s | 10s | 30 | Allows up to 330 seconds total for Mattermost to complete database migration and initialise. Generous threshold accommodates first-run schema creation on a fresh database. |
| **Liveness** | `/api/v4/system/ping` | 30s | 5s | 30s | 3 | Restarts the container if Mattermost becomes unresponsive or loses its database connection. |

The GKE module (`Mattermost_GKE`) uses the same probe paths and defaults. The Cloud Run module (`Mattermost_CloudRun`) also includes `startup_probe_config` and `health_check_config` variables that configure the service-level probes independently — these default to the same paths.

---

## 7. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as the Docker build context.

### `Dockerfile`
Wraps the official `mattermost/mattermost-team-edition:${MM_VERSION}` image:
- Accepts only `MM_VERSION` as a Docker build argument (default `9.11.2`); there is no `EDITION` build arg, and the `FROM` line is always `mattermost-team-edition` regardless of the wrapper module's `edition` variable.
- Switches to `root` only to install the entrypoint wrapper, then drops back to the image's built-in `mattermost` uid (`2000`).
- Copies `entrypoint.sh` to `/usr/local/bin/mm-entrypoint.sh` and uses it as the `ENTRYPOINT` — this wrapper maps the Foundation's `DB_*` variables into `MM_SQLSETTINGS_DATASOURCE` before starting the server; all other `MM_*` settings are injected directly as environment variables.
- Exposes port `8065` (HTTP).

### `db-init.sh`
Creates the PostgreSQL database and user before Mattermost's first startup:
1. Resolves the PostgreSQL connection from `DB_HOST` (Unix socket path for Auth Proxy, or TCP hostname).
2. Connects using `ROOT_PASSWORD` or falls back to peer authentication if the root password is not available.
3. Creates the application user with `DB_PASSWORD` from Secret Manager.
4. Creates the `mattermost` database owned by the application user.
5. Verifies connectivity as the application user.
6. Signals the Cloud SQL Proxy to shut down cleanly.

---

## 8. Platform-Specific Differences

| Aspect | Mattermost CloudRun | Mattermost GKE |
|---|---|---|
| **Default `min_instance_count`** | `1` — prevents scale-to-zero from disconnecting WebSocket sessions. | `1` — always at least one pod running. |
| **Default `max_instance_count`** | `5` | `5` |
| **Health probe path** | `/` (Cloud Run module default); override to `/api/v4/system/ping` for precise signalling. | `/api/v4/system/ping` — GKE module uses the precise Mattermost health endpoint by default. |
| **Cloud SQL connectivity** | Auth Proxy Unix socket via `enable_cloudsql_volume = true` (default). | `enable_cloudsql_volume = true` by default in GKE too — but this injects a `cloud-sql-proxy` sidecar listening on TCP `127.0.0.1`, not a Unix socket; `entrypoint.sh` connects over that loopback TCP address. |
| **File storage** | GCS FUSE volumes (`gcs_volumes`) or NFS. GCS FUSE is preferred for Cloud Run. | GCS FUSE volumes via CSI driver (`gcs_volumes`) or NFS. GCS FUSE or StatefulSet PVC for GKE. |
| **WebSocket timeout** | Cloud Run's 60-min max request timeout limits WebSocket lifetime. Set `timeout_seconds = 3600`. | No timeout constraint — GKE connections persist indefinitely. Better choice for production. |
| **Session affinity** | Not applicable to Cloud Run (serverless). | `session_affinity = "ClientIP"` default — required for consistent Mattermost admin sessions across pod replicas. |
| **`site_url`** | Set after first deploy once the Cloud Run `*.run.app` URL is known. | Set to the load balancer IP or custom domain after first deploy. |

---

## 9. Edition Selection

The `edition` variable is declared on the **wrapper modules** (`Mattermost_CloudRun`, `Mattermost_GKE`), not on `Mattermost_Common` — see §3. When `edition = "enterprise"`, the wrapper overrides the merged `container_image` field to `mattermost/mattermost-enterprise-edition`. Note this does **not** change what `Mattermost_Common`'s static `Dockerfile` builds `FROM` (see §7) — that file always pulls `mattermost-team-edition:${MM_VERSION}` regardless of `edition`, since it has no `EDITION` build argument.

| `edition` | Image | Notes |
|---|---|---|
| `"team"` (default) | `mattermost/mattermost-team-edition:<version>` | Free. Supports up to unlimited users with standard messaging, channels, integrations, and webhooks. |
| `"enterprise"` | `mattermost/mattermost-enterprise-edition:<version>` | Requires a paid licence key. Unlocks LDAP/AD sync, SAML SSO, advanced compliance controls, custom retention, multi-region HA clustering, and enterprise security features. |

To activate Enterprise features, set `edition = "enterprise"` and provide the licence key via `environment_variables`:

```hcl
edition = "enterprise"

environment_variables = {
  MM_LicenseKey = "your-enterprise-licence-key"
}
```

Or use `secret_environment_variables` to avoid storing the licence key in plaintext:

```hcl
secret_environment_variables = {
  MM_LicenseKey = "mattermost-licence-key"
}
```

---

## 10. Implementation Pattern

The following example illustrates how `Mattermost_CloudRun` instantiates `Mattermost_Common`:

```hcl
module "mattermost_app" {
  source = "../Mattermost_Common"

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  description            = var.description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  gcs_volumes            = var.gcs_volumes
  site_url               = var.site_url
  enable_redis           = var.enable_redis
  redis_host             = var.redis_host
  redis_port             = var.redis_port
  redis_auth             = var.redis_auth
  environment_variables  = var.environment_variables
  initialization_jobs    = var.initialization_jobs
}

locals {
  mattermost_module = merge(
    module.mattermost_app.config,
    var.edition == "enterprise" ? { container_image = "mattermost/mattermost-enterprise-edition" } : {},
    # ... other container_image/container_port/container_resources overrides
  )
  application_modules    = { mattermost = local.mattermost_module }
  module_env_vars        = {}
  module_secret_env_vars = module.mattermost_app.secret_ids  # {}
  module_storage_buckets = module.mattermost_app.storage_buckets  # [{ name_suffix = "data" }]
  scripts_dir            = abspath("${module.mattermost_app.path}/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... other inputs
}
```

Key differences from Ghost Common's pattern:
- `module_secret_env_vars` is always empty (`{}`) — Mattermost manages its own secrets internally.
- `module_storage_buckets` is a single `data` bucket, forwarded verbatim from `Mattermost_Common`'s output — unlike most Common modules, the bucket is declared in Common rather than the wrapper.
- `edition` is **not** passed into `module "mattermost_app"` at all — it exists only on the wrapper module and is consumed locally to override `container_image` in the merge shown above. Redis variables, by contrast, genuinely are forwarded into `Mattermost_Common`.
