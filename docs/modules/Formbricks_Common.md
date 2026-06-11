---
title: "Formbricks Common Shared Configuration Module"
---

# Formbricks Common Shared Configuration Module

The `Formbricks Common` module defines the Formbricks survey platform configuration for the RAD Modules ecosystem. It is a **shared application configuration module** — it creates GCS HMAC credentials, provisions secrets in Secret Manager, and produces `config`, `secret_ids`, and `storage_buckets` outputs consumed by the platform-specific wrapper modules (`Formbricks CloudRun` and `Formbricks GKE`).

## 1. Overview

**Purpose**: To centralise all Formbricks-specific configuration (container image, PostgreSQL database setup, auto-generated application secrets, GCS S3-compatible storage wiring, environment variable mapping, health probes, and the `db-init` job definition) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Formbricks_CloudRun  ──┐
└── Formbricks_GKE       ──┤── instantiate Formbricks_Common
                            ↓
               Formbricks_Common (this module)
               Creates: Secret Manager secrets, GCS HMAC key
               Produces: config, secret_ids, storage_buckets
                            ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                            ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Uses **PostgreSQL 15**, consistent with all other modules in this ecosystem except Ghost (which requires MySQL 8.0).
- **Creates Secret Manager secrets** — unlike Ghost Common (which creates no secrets), Formbricks Common auto-generates `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, plus GCS HMAC credentials (`S3_ACCESS_KEY`, `S3_SECRET_KEY`). SMTP and Redis secrets are provisioned conditionally based on configuration.
- Provisions a **GCS `uploads` bucket** and configures Formbricks to use GCS's S3-compatible XML API via HMAC authentication for file storage.
- Exposes a **dedicated health endpoint** at `/api/v2/health` — a Formbricks-native route that reflects both application readiness and active database connectivity.
- The `db-init` job creates the PostgreSQL database and user via the standard PostgreSQL client before Formbricks's Prisma migrations run at container startup.

---

## 2. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"formbricks"` |
| `application_version` | Version tag (default: `"latest"`) |
| `container_image` | `"ghcr.io/formbricks/formbricks"` (upstream GitHub Container Registry image) |
| `image_source` | `"custom"` — a custom wrapper image is built via Cloud Build |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `true`) — mirrors the image into Artifact Registry to avoid ghcr.io rate limits |
| `container_port` | `3000` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (default: `"formbricks"`) |
| `db_user` | Database user (default: `"formbricks"`) |
| `enable_cloudsql_volume` | `false` by default for Cloud Run — Formbricks connects to PostgreSQL via TCP |
| `environment_variables` | Formbricks-specific env vars: `STORAGE_PROVIDER`, `S3_ENDPOINT_URL`, `S3_BUCKET_NAME`, `NEXTAUTH_URL`, `WEBAPP_URL`, `HUB_API_URL`, `CUBEJS_API_URL`, SMTP vars when configured |
| `container_resources` | CPU: `"1000m"` (Cloud Run default) / `"2000m"` (GKE default), Memory: `"2Gi"` |
| `initialization_jobs` | Default `db-init` job (PostgreSQL) or custom override |
| `startup_probe` | HTTP `GET /api/v2/health`, 30s initial delay, 5s timeout, 20s period, 10 failure threshold (Cloud Run) |
| `liveness_probe` | HTTP `GET /api/v2/health`, 15s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `secret_ids`

A map of environment variable names to Secret Manager secret IDs. These are passed as `module_secret_env_vars` to the Foundation Module, which injects them as secret environment variables at runtime. The plaintext values are never accessible via the state file.

| Environment Variable | Secret | Condition |
|---|---|---|
| `NEXTAUTH_SECRET` | `<prefix>-nextauth-secret` | Always |
| `ENCRYPTION_KEY` | `<prefix>-encryption-key` | Always |
| `CRON_SECRET` | `<prefix>-cron-secret` | Always |
| `HUB_API_KEY` | `<prefix>-hub-api-key` | Always |
| `CUBEJS_API_SECRET` | `<prefix>-cubejs-api-secret` | Always |
| `S3_ACCESS_KEY` | `<prefix>-s3-access-key` | Always — GCS HMAC access key |
| `S3_SECRET_KEY` | `<prefix>-s3-secret-key` | Always — GCS HMAC secret key |
| `SMTP_PASSWORD` | `<prefix>-smtp-password` | Only when `smtp_host` is configured |
| `REDIS_URL` | `<prefix>-redis-url` | Only when `enable_redis = true` and `redis_auth` is non-empty |

The `<prefix>` is constructed from the application name and deployment ID (e.g., `formbricks-demo`).

### `storage_buckets`

A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|---|---|
| `name_suffix` | `"uploads"` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"enforced"` |

---

## 3. GCS S3-Compatible Storage

Formbricks uses the S3 API protocol for file uploads (survey response attachments, images, custom assets). On GCP, this is satisfied by GCS's XML API combined with HMAC credentials.

**How it works:**

1. `Formbricks Common` creates a GCS HMAC key for the Cloud Run / GKE service account.
2. The HMAC access key and secret key are stored in Secret Manager as `S3_ACCESS_KEY` and `S3_SECRET_KEY`.
3. The following environment variables are injected into the Formbricks container:
   - `STORAGE_PROVIDER=s3` — instructs Formbricks to use the S3 storage driver.
   - `S3_ENDPOINT_URL=https://storage.googleapis.com` — points the S3 client at GCS.
   - `S3_BUCKET_NAME` — the name of the auto-provisioned `uploads` GCS bucket.
   - `S3_ACCESS_KEY` and `S3_SECRET_KEY` — injected as secret environment variables at runtime.
4. Formbricks uploads and retrieves files via standard S3 SDK calls, which are transparently served by GCS.

This approach is transparent to Formbricks — no code changes or plugins are required. Any S3-compatible client that can be pointed at a custom endpoint works identically.

---

## 4. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"formbricks"` | Application name. Used as a prefix for all resource names. |
| `application_version` | `string` | `"latest"` | Formbricks Docker image tag. |
| `description` | `string` | `"Formbricks - Open Source Survey and Experience Management"` | Init job and service description. |
| `deployment_id` | `string` | `""` | Unique deployment identifier. Appended to resource names. |
| `db_name` | `string` | `"formbricks"` | PostgreSQL database name. |
| `db_user` | `string` | `"formbricks"` | PostgreSQL application user. |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit. |
| `memory_limit` | `string` | `"2Gi"` | Container memory limit. |
| `webapp_url` | `string` | `""` | Public URL of the Formbricks instance. Injected as `NEXTAUTH_URL` and `WEBAPP_URL`. Leave empty on first deploy; update after the service URL is known. |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs. Empty list triggers the default `db-init` job. |
| `startup_probe` | `object` | See §5 | Startup health probe targeting `/api/v2/health`. |
| `liveness_probe` | `object` | See §5 | Liveness health probe targeting `/api/v2/health`. |
| `enable_image_mirroring` | `bool` | `true` | Mirror the Formbricks image to Artifact Registry before deployment. |

### Email (SMTP)

| Variable | Type | Default | Description |
|---|---|---|---|
| `smtp_host` | `string` | `""` | SMTP server hostname. When empty, no `SMTP_PASSWORD` secret is created. |
| `smtp_port` | `number` | `587` | SMTP port. |
| `smtp_user` | `string` | `""` | SMTP authentication username. |
| `smtp_password` | `string` | `""` | SMTP password. Auto-generated and stored in Secret Manager if empty. Sensitive. |
| `smtp_secure_enabled` | `bool` | `false` | Enable implicit TLS (`true` for port 465). |
| `mail_from` | `string` | `""` | Sender address in outgoing Formbricks emails. |

### Redis

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `true` | When `true`, a `REDIS_URL` secret is created if `redis_auth` is non-empty. |
| `redis_host` | `string` | `""` | Redis server hostname or IP. |
| `redis_port` | `string` | `"6379"` | Redis port. |
| `redis_auth` | `string` | `""` | Redis AUTH password. Sensitive. |

### Formbricks Hub & Cube.js

| Variable | Type | Default | Description |
|---|---|---|---|
| `hub_api_url` | `string` | `"http://localhost:8080"` | Formbricks Hub API URL. Injected as `HUB_API_URL`. |
| `cubejs_api_url` | `string` | `"http://localhost:4000"` | Cube.js analytics API URL. Injected as `CUBEJS_API_URL`. |

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `false` | Mount Cloud SQL Auth Proxy sidecar socket. Default `false` for Formbricks (TCP connection). |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts (name, bucket_name, mount_path, readonly, mount_options). |
| `deployment_region` | `string` | `"us-central1"` | Region for the `uploads` storage bucket. |

---

## 5. Health Probes

Formbricks exposes `/api/v2/health` — a dedicated API endpoint that returns `HTTP 200` only when the Next.js application is running and the PostgreSQL database connection is active. Both probe types target this endpoint.

| Probe | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|
| **Startup** | 30s | 5s | 20s | 10 | Allows up to 230s total for Formbricks to run Prisma migrations and initialise on first boot |
| **Liveness** | 15s | 5s | 30s | 3 | Restarts the container if Formbricks becomes unresponsive or loses its database connection |

The startup probe thresholds accommodate Prisma's database schema migration process, which runs automatically on each container start and can be slow on the first boot against a fresh database.

**Comparison with other modules:**

| Module | Health Endpoint | Startup Initial Delay | Reason |
|---|---|---|---|
| Formbricks | `/api/v2/health` | 30s | Prisma migrations are fast; Next.js compilation is pre-built |
| Ghost | `/` | 90s | Ghost compiles themes and runs schema migrations on startup |
| Django | `/healthz` | 10s | Django startup is lightweight with no compilation step |

---

## 6. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|---|---|
| Image | PostgreSQL-compatible client image |
| Script | `scripts/db-init.sh` |
| Secrets required | `ROOT_PASSWORD` (PostgreSQL superuser, optional), `DB_PASSWORD` (app user) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |

`db-init.sh` performs the following idempotent operations:

1. Resolves the PostgreSQL host from `DB_HOST` or falls back to `DB_IP`.
2. Polls for PostgreSQL availability (up to 30 retries, 2 seconds apart) before proceeding.
3. When `ROOT_PASSWORD` is present: creates the `formbricks` database with UTF-8 encoding, creates the `formbricks` application user, and grants full privileges on the database.
4. When `ROOT_PASSWORD` is absent: skips creation and proceeds to verification.
5. Verifies the application user can connect and queries PostgreSQL version info.
6. Signals the Cloud SQL Auth Proxy sidecar to shut down after completion.

Formbricks's Prisma migrations then run automatically when the container starts — the `db-init` job only ensures the database and user exist before Prisma attempts to connect.

---

## 7. Secrets Lifecycle

Unlike Ghost Common (which creates no secrets), Formbricks Common creates and manages all application-level secrets:

**Always-created secrets:**
- `NEXTAUTH_SECRET` — 32-character cryptographically random string. Used by NextAuth.js to sign and encrypt JWT session tokens. Regenerating this value invalidates all active user sessions.
- `ENCRYPTION_KEY` — Formbricks data encryption key. Used to encrypt sensitive survey response data at rest within the application.
- `CRON_SECRET` — Token passed by Cloud Scheduler to the Formbricks cron endpoint to authenticate scheduled jobs. Must be kept confidential.
- `HUB_API_KEY` — API key for authenticating to the Formbricks Hub service (used from v5+).
- `CUBEJS_API_SECRET` — JWT signing secret for Cube.js analytics API authentication.
- `S3_ACCESS_KEY` — GCS HMAC access key. Generated from the Cloud Run / GKE service account and used by Formbricks's S3 client to authenticate file upload requests to GCS.
- `S3_SECRET_KEY` — GCS HMAC secret key. The HMAC key pair is created once; rotation requires reprovisioning.

**Conditionally-created secrets:**
- `SMTP_PASSWORD` — Created and stored in Secret Manager only when `smtp_host` is non-empty. If `smtp_password` is left blank, an auto-generated random value is stored — useful for accounts that require an SMTP password but where the value is managed externally.
- `REDIS_URL` — Created only when `enable_redis = true` and `redis_auth` is non-empty. Contains the full `redis://:password@host:port` URL.

**Secret rotation:** All auto-generated secrets are created with the `secret_rotation_period` rotation notification enabled. This triggers a Pub/Sub notification but does not automatically rotate the secrets — Formbricks application secrets must be rotated manually or via a custom rotation Lambda. Only `DB_PASSWORD` has an automated rotation pipeline when `enable_auto_password_rotation = true`.

---

## 8. Platform-Specific Differences

| Aspect | Formbricks CloudRun | Formbricks GKE |
|---|---|---|
| `enable_cloudsql_volume` | `false` (TCP connection to Cloud SQL private IP) | `true` (Auth Proxy sidecar via Unix socket) |
| `DB_HOST` | Cloud SQL private IP via TCP | Auth Proxy socket path at `/cloudsql` |
| `min_instance_count` | `0` (scale-to-zero) | `0` (scale-to-zero; Kubernetes HPA) |
| `max_instance_count` | `1` (configurable) | `3` (configurable; HPA maxReplicas) |
| `cpu_limit` | `"1000m"` default | `"2000m"` default |
| `memory_limit` | `"2Gi"` default | `"2Gi"` default |
| NFS | Enabled by default (`enable_nfs = true`) | Enabled by default (`enable_nfs = true`) |
| Redis | Enabled by default (`enable_redis = true`) | Enabled by default (`enable_redis = true`) |
| Session affinity | Not applicable (Cloud Run routes per revision) | `ClientIP` — required for stable admin sessions |
| Startup probe initial delay | 30s | 0s (Kubernetes startup probe has no `initialDelaySeconds`; uses `failureThreshold × periodSeconds` instead) |

---

## 9. Implementation Pattern

```hcl
# Example: how Formbricks_CloudRun instantiates Formbricks_Common

module "formbricks_app" {
  source = "../Formbricks_Common"

  application_name    = var.application_name
  application_version = var.application_version
  deployment_id       = local.deployment_id
  db_name             = var.db_name
  db_user             = var.db_user
  cpu_limit           = var.cpu_limit
  memory_limit        = var.memory_limit
  description         = var.description
  startup_probe       = var.startup_probe
  liveness_probe      = var.liveness_probe
  webapp_url          = var.webapp_url
  smtp_host           = var.smtp_host
  smtp_port           = var.smtp_port
  smtp_user           = var.smtp_user
  smtp_password       = var.smtp_password
  smtp_secure_enabled = var.smtp_secure_enabled
  mail_from           = var.mail_from
  enable_redis        = var.enable_redis
  redis_host          = var.redis_host
  redis_port          = var.redis_port
  redis_auth          = var.redis_auth
  hub_api_url         = var.hub_api_url
  cubejs_api_url      = var.cubejs_api_url
  enable_image_mirroring = var.enable_image_mirroring
}

# The four locals consumed by App_CloudRun
locals {
  application_modules    = { formbricks = module.formbricks_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.formbricks_app.secret_ids
  module_storage_buckets = module.formbricks_app.storage_buckets
  scripts_dir            = abspath("${path.module}/../Formbricks_Common/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_secret_env_vars = local.module_secret_env_vars
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... all other variables forwarded from var.*
}
```
