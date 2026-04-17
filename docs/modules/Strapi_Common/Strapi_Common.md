---
title: "Strapi Common Shared Configuration Module"
sidebar_label: "Common"
---

# Strapi_Common Module

## Overview

`Strapi_Common` is a pure-configuration Terraform module in the RAD Modules ecosystem. It generates a `config` object consumed by platform modules (`App_CloudRun`, `App_GKE`) to deploy Strapi — an open-source headless CMS — on Google Cloud. The module provisions five GCP Secret Manager secrets (JWT signing keys, token salts, and application keys), defines one GCS bucket for media uploads, and emits all container configuration as Terraform outputs.

Strapi has specific cryptographic requirements: four distinct secrets must be consistent across restarts and instances or existing sessions and tokens become invalid. This module generates all five secrets at provision time and surfaces them through the `secret_ids` output (with a 30-second propagation wait) so that `App_CloudRun`/`App_GKE` can inject them as secret environment variables.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Strapi_Common (Layer 1)                              │
│                                                                              │
│  Inputs: project_id, tenant_deployment_id, deployment_id,                   │
│          enable_redis, redis_auth, ...                                       │
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐    │
│  │  GCP Resources       │    │  Config Output (consumed by Layer 2)    │    │
│  │                      │    │                                         │    │
│  │  Secret Manager API  │    │  container_image: "" (custom build)     │    │
│  │  5 secrets:          │    │  container_port: 1337                   │    │
│  │   jwt-secret         │    │  database_type: POSTGRES_15             │    │
│  │   admin-jwt-secret   │    │  initialization_jobs: [db-init]         │    │
│  │   api-token-salt     │    │  startup_probe: HTTP /_health 30s       │    │
│  │   transfer-token-salt│    │  liveness_probe: HTTP /_health 15s      │    │
│  │   app-keys (4×32)    │    │  REDIS_HOST/PORT/PASSWORD (opt.)        │    │
│  │  30s propagation     │    │                                         │    │
│  │  wait                │    │                                         │    │
│  │                      │    │                                         │    │
│  │  GCS Bucket          │    │                                         │    │
│  │   strapi-uploads     │    │                                         │    │
│  └──────────────────────┘    └─────────────────────────────────────────┘    │
│                                                                              │
│  resource_prefix = "{application_name}-{tenant_deployment_id}-{             │
│                          deployment_id}"                                     │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        App_CloudRun / App_GKE (Layer 2)
```

---

## GCP Resources Created

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_project_service` | `secretmanager.googleapis.com` | Ensures Secret Manager API is active |
| `random_password` × 7 | — | Individual 32-char alphanumeric values |
| `google_secret_manager_secret` | `{prefix}-jwt-secret` | User JWT signing secret |
| `google_secret_manager_secret` | `{prefix}-admin-jwt-secret` | Admin panel JWT signing secret |
| `google_secret_manager_secret` | `{prefix}-api-token-salt` | API token salt |
| `google_secret_manager_secret` | `{prefix}-transfer-token-salt` | Data transfer token salt |
| `google_secret_manager_secret` | `{prefix}-app-keys` | Session keys (4 values, comma-joined) |
| `time_sleep` | — | 30s wait after all secret versions are written |

**GCS Bucket** (defined in `storage_buckets` output, created by Layer 2):

| Bucket Suffix | Location | Purpose |
|---------------|----------|---------|
| `strapi-uploads` | `deployment_region` | Strapi media library uploads via GCS provider |

> **`resource_prefix` format:** `"{application_name}-{tenant_deployment_id}-{deployment_id}"` — uses hyphen separators, unlike most other modules which concatenate without separators. Example: `strapi-prod-a1b2c3d4`.

> **`APP_KEYS` format:** The secret value is four 32-character keys joined with a comma: `key1,key2,key3,key4`. Strapi reads this as an array via `env.array('APP_KEYS')` in `config/server.js`.

---

## Module Outputs

| Output | Type | Description |
|--------|------|-------------|
| `config` | object | Full application configuration for App_CloudRun/App_GKE |
| `storage_buckets` | list(object) | One bucket spec: `strapi-uploads` |
| `secret_ids` | map(string) | Secret IDs for all 5 Strapi secrets (gated by 30s sleep) |
| `secret_values` | map(string) (sensitive) | Plaintext secret values |
| `path` | string | Absolute path to this module directory |

**`secret_ids` keys:**

| Key | Secret | Purpose |
|-----|--------|---------|
| `JWT_SECRET` | `{prefix}-jwt-secret` | `users-permissions` plugin JWT signing |
| `ADMIN_JWT_SECRET` | `{prefix}-admin-jwt-secret` | Admin panel session JWT |
| `API_TOKEN_SALT` | `{prefix}-api-token-salt` | API token generation salt |
| `TRANSFER_TOKEN_SALT` | `{prefix}-transfer-token-salt` | Data transfer token salt |
| `APP_KEYS` | `{prefix}-app-keys` | Session cookie signing keys |

The `secret_ids` output has `depends_on = [time_sleep.secret_propagation]`, ensuring all five secrets are fully propagated in IAM before downstream modules attempt to bind them to containers.

---

## Input Variables

### Identity & Project

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | string | — | GCP project ID (required) |
| `tenant_deployment_id` | string | `"demo"` | Tenant identifier used in secret naming |
| `deployment_id` | string | `""` | Deployment identifier; auto-generated if empty |
| `deployment_region` | string | `"us-central1"` | Region for the GCS bucket |
| `resource_labels` | map(string) | `{}` | Labels on all GCP resources |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | string | `"strapi"` | Used in resource prefix |
| `application_version` | string | `"latest"` | Application version tag |
| `display_name` | string | `"Strapi CMS"` | Human-readable display name |
| `description` | string | `"Strapi Headless CMS"` | Description |
| `db_name` | string | `"strapi"` | PostgreSQL database name |
| `db_user` | string | `"strapi"` | PostgreSQL database user |

### Resources

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `cpu_limit` | string | `"1000m"` | CPU limit |
| `memory_limit` | string | `"512Mi"` | Memory limit |
| `min_instance_count` | number | `1` | Minimum instances (stays warm — not 0) |
| `max_instance_count` | number | `10` | Maximum instances |
| `enable_cloudsql_volume` | bool | `true` | Enable Cloud SQL Auth Proxy sidecar |
| `environment_variables` | map(string) | `{ NODE_ENV = "production" }` | Base environment variables |
| `initialization_jobs` | list(any) | `[]` | Override default jobs (empty = use `db-init`) |

### Health Probes

| Variable | Default | Description |
|----------|---------|-------------|
| `startup_probe` | HTTP `/_health`, 30s delay, 5s timeout, 10s period, **30 failures** | Startup check (allows up to 330s total) |
| `liveness_probe` | HTTP `/_health`, 15s delay, 5s timeout, 30s period, 3 failures | Ongoing liveness check |

> **`failure_threshold = 30` on startup probe:** Strapi runs database migrations and rebuilds its plugin registry on first boot. The high threshold (30 × 10s = 300s maximum tolerance) prevents premature pod termination while the application initialises.

### Redis (Optional)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_redis` | bool | `false` | Enable Redis session store and REST cache |
| `redis_host` | string | `null` | Redis hostname; falls back to `$(NFS_SERVER_IP)` at runtime |
| `redis_port` | string | `"6379"` | Redis port |
| `redis_auth` | string (sensitive) | `""` | Redis authentication string |

When `enable_redis = true`, the following environment variables are added to the container:

| Variable | Value |
|----------|-------|
| `ENABLE_REDIS` | `"true"` |
| `REDIS_HOST` | `redis_host` if set, otherwise `"$(NFS_SERVER_IP)"` |
| `REDIS_PORT` | `redis_port` |
| `REDIS_PASSWORD` | `redis_auth` |

The `$(NFS_SERVER_IP)` placeholder is expanded at container startup by `strapi-entrypoint.sh`.

---

## Initialization Job: `db-init`

| Property | Value |
|----------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/create-db-and-user.sh` |
| `execute_on_apply` | `true` |
| `max_retries` | 1 |
| Timeout | 600s |

**`create-db-and-user.sh` flow:**

1. Resolves target host (`DB_HOST` → `DB_IP` fallback)
2. Waits for PostgreSQL using `psql -c '\l'` (full connection test, not just `pg_isready`)
3. Creates/updates the database user via a `DO $$` PL/pgSQL block (idempotent)
4. Grants `"$DB_USER" TO postgres` (required for Cloud SQL where postgres is not a true superuser)
5. Grants `CREATEDB` privilege to `DB_USER` (Strapi needs this to manage its own test/migration databases)
6. Grants `ALL PRIVILEGES ON DATABASE postgres` to `DB_USER`
7. Creates database with `CREATE DATABASE … OWNER "$DB_USER"` or updates owner if it already exists
8. Grants all privileges on the database and public schema
9. Signals Cloud SQL Auth Proxy shutdown via `POST http://localhost:9091/quitquitquit` (30 retries, 2s intervals)

> **`CREATEDB` grant:** This is unique to Strapi_Common. Strapi's Knex-based migration system creates and drops databases during certain operations. Without `CREATEDB`, these operations fail with permission errors.

---

## Container Image

The module builds from `scripts/Dockerfile` using a **two-stage build** on `node:20-alpine`.

### Build stages

**Stage 1 (build):**
```
Base: node:20-alpine
System: build-base, gcc, autoconf, automake, zlib-dev, libpng-dev, nasm, bash, vips-dev
Steps:
  1. npm install (all dependencies)
  2. npm run build  (Strapi admin panel compilation)
Artifacts: /opt/app/build, /opt/app/.strapi
```

**Stage 2 (runtime):**
```
Base: node:20-alpine
System: vips-dev, tini
  + build tools installed temporarily for npm install --omit=dev, then removed
Steps:
  1. npm install --omit=dev  (production deps only)
  2. Copy source files
  3. Remove macOS extended attribute files (._* from tar extraction)
  4. mkdir -p public/uploads  (required by Strapi at runtime)
  5. Copy build artifacts from Stage 1
  6. chown -R node:node /opt/app
  7. USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/strapi-entrypoint.sh"]
EXPOSE 1337
```

The `vips-dev` library is required by the `sharp` npm package (used for image processing/optimisation in the media library).

Build tools (`build-base`, `gcc`, `autoconf`, `automake`, `zlib-dev`, `libpng-dev`, `nasm`, `bash`) are added for the `npm install --omit=dev` step and then removed (`apk del`) to keep the runtime image small.

---

## Scripts

### `strapi-entrypoint.sh`

Minimal entrypoint that resolves the `$(NFS_SERVER_IP)` placeholder in `REDIS_HOST` before starting Strapi:

```sh
if echo "${REDIS_HOST:-}" | grep -q '$(NFS_SERVER_IP)'; then
  export REDIS_HOST=$(echo "$REDIS_HOST" | sed "s/\$(NFS_SERVER_IP)/$NFS_SERVER_IP/g")
fi

exec node node_modules/@strapi/strapi/bin/strapi.js start "$@"
```

Strapi is started via direct `node` invocation of the Strapi CLI rather than `npm start`, which avoids an extra process layer and ensures signals propagate correctly through `tini`.

---

## Strapi Configuration Files

### `config/database.js`

Supports both Strapi-native (`DATABASE_*`) and platform-standard (`DB_*`) environment variables, with Strapi-native taking priority:

| Strapi variable | Platform fallback | Default |
|----------------|-------------------|---------|
| `DATABASE_HOST` | `DB_HOST` | — |
| `DATABASE_PORT` | `DB_PORT` | `5432` |
| `DATABASE_NAME` | `DB_NAME` | — |
| `DATABASE_USERNAME` | `DB_USER` | — |
| `DATABASE_PASSWORD` | `DB_PASSWORD` | — |
| `DATABASE_SSL` | — | `false` |

`DATABASE_SSL` accepts `"true"`, `"false"`, or a JSON-encoded SSL options object (e.g. `{"rejectUnauthorized": false}`).

### `config/admin.js`

Maps secrets to Strapi admin configuration:

| Env var | Source | Purpose |
|---------|--------|---------|
| `ADMIN_JWT_SECRET` | `{prefix}-admin-jwt-secret` | Signs admin panel session JWTs |
| `API_TOKEN_SALT` | `{prefix}-api-token-salt` | Salts generated API tokens |
| `TRANSFER_TOKEN_SALT` | `{prefix}-transfer-token-salt` | Salts data transfer tokens |

### `config/server.js`

| Env var | Default | Purpose |
|---------|---------|---------|
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `1337` | Listen port |
| `STRAPI_URL` | `""` | Public URL (set to Cloud Run service URL) |
| `APP_KEYS` | — | Comma-separated session signing keys (from `{prefix}-app-keys`) |
| `WEBHOOKS_POPULATE_RELATIONS` | `false` | Include relations in webhook payloads |

`proxy: true` is hardcoded — required for Strapi to correctly read `X-Forwarded-Proto` and `X-Forwarded-For` headers behind the Cloud Run load balancer.

### `config/plugins.js`

Configures three plugin areas conditionally:

**GCS Upload (always active):**

Uses `@strapi-community/strapi-provider-upload-google-cloud-storage` for the Strapi media library. Required environment variables:

| Variable | Description |
|----------|-------------|
| `GCS_BUCKET_NAME` | Name of the `strapi-uploads` GCS bucket (injected by App_CloudRun/App_GKE) |
| `GCS_BASE_URL` | Public base URL for served assets |
| `GCS_PUBLIC_FILES` | Whether uploaded files are public (default: `true`) |
| `GCS_UNIFORM` | Use uniform bucket-level access (default: `true`) |

**Redis plugin (conditional on `REDIS_HOST`):**

When `REDIS_HOST` is set, enables `strapi-plugin-redis` with a `default` connection:

| Setting | Value |
|---------|-------|
| Max connections | 32767 |
| Connect timeout | 5000ms |
| Max retries per request | 3 |
| Lazy connect | `true` |
| Retry strategy | Exponential backoff, max 2000ms, give up after 3 attempts |

Also enables `strapi-plugin-rest-cache` with `strapi-provider-rest-cache-redis` for HTTP response caching. Content types to cache are configured via the `contentTypes` array (empty by default).

**Email / SMTP (conditional on `SMTP_HOST`):**

When `SMTP_HOST` is set, enables the `nodemailer` email provider:

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (default: 587) |
| `SMTP_USERNAME` | SMTP authentication user |
| `SMTP_PASSWORD` | SMTP authentication password |
| `EMAIL_FROM` | Default sender address |
| `EMAIL_REPLY_TO` | Default reply-to address |

---

## npm Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@strapi/strapi` | 4.24.2 | Core Strapi framework |
| `@strapi/plugin-users-permissions` | 4.24.2 | User authentication |
| `@strapi/plugin-i18n` | 4.24.2 | Internationalisation |
| `@strapi/plugin-cloud` | 4.24.2 | Cloud deployment tooling |
| `@strapi-community/strapi-provider-upload-google-cloud-storage` | ^4.0.0 | GCS media upload |
| `strapi-plugin-redis` | 1.1.0 | Redis connection management |
| `strapi-plugin-rest-cache` | 4.2.8 | REST API response caching |
| `strapi-provider-rest-cache-redis` | 4.2.8 | Redis backend for REST cache |
| `pg` | 8.11.3 | PostgreSQL driver (Knex) |
| `sharp` | ^0.32.6 | Image processing (requires libvips) |

Node.js requirement: `>=18.0.0 <=20.x.x`.

---

## Platform-Specific Differences

| Aspect | Strapi_CloudRun | Strapi_GKE |
|--------|-----------------|------------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | Optional (Auth Proxy sidecar) | Not used (TCP to Cloud SQL private IP) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path | Cloud SQL private IP |
| NFS | Disabled | Disabled |
| Redis | Optional; disabled by default | Optional; disabled by default |
| GCS media uploads | `strapi-uploads` bucket (always enabled) | `strapi-uploads` bucket (always enabled) |
| Secret injection | `secret_ids` map from `module.strapi_app` | Secret values injected directly |
| Scaling | Serverless (`min_instance_count = 1`, `max = 10`) | Kubernetes Deployment with configurable replicas |

---

## Usage Example

```hcl
module "strapi_common" {
  source = "./modules/Strapi_Common"

  project_id           = var.project_id
  tenant_deployment_id = "prod"
  deployment_id        = random_id.deployment.hex
  deployment_region    = "us-central1"

  enable_redis = true
  # redis_host omitted — resolves to NFS_SERVER_IP at runtime

  environment_variables = {
    NODE_ENV     = "production"
    STRAPI_URL   = "https://cms.example.com"
    GCS_BASE_URL = "https://storage.googleapis.com/my-project-strapi-uploads"
  }
}

module "strapi_cloudrun" {
  source = "./modules/App_CloudRun"

  config          = module.strapi_common.config
  storage_buckets = module.strapi_common.storage_buckets

  secret_env_vars = {
    JWT_SECRET          = module.strapi_common.secret_ids["JWT_SECRET"]
    ADMIN_JWT_SECRET    = module.strapi_common.secret_ids["ADMIN_JWT_SECRET"]
    API_TOKEN_SALT      = module.strapi_common.secret_ids["API_TOKEN_SALT"]
    TRANSFER_TOKEN_SALT = module.strapi_common.secret_ids["TRANSFER_TOKEN_SALT"]
    APP_KEYS            = module.strapi_common.secret_ids["APP_KEYS"]
  }
}
```

