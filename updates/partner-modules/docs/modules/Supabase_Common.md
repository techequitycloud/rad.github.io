# Supabase_Common Shared Configuration Module

The `Supabase_Common` module defines the Supabase configuration for the RAD Modules ecosystem. It is a **configuration and secrets module** — it creates three Secret Manager secrets (JWT secret, anon key, service role key) and produces `config`, `secret_ids`, `storage_buckets`, and `path` outputs consumed by `Supabase_GKE`.

## 1. Overview

**Purpose**: To centralise all Supabase-specific configuration (Kong gateway setup, PostgreSQL 15 database connection, JWT key management, storage bucket, and database initialisation job) in a single module.

**Architecture**:

```
Layer 3: Application Wrapper
└── Supabase_GKE  ──── instantiates Supabase_Common
                             ↓
           Supabase_Common (this module)
           Creates: 3 Secret Manager secrets (JWT, anon key, service role key)
           Produces: config, secret_ids, storage_buckets, path
                             ↓
Layer 2: App_GKE  (Kubernetes infrastructure)
```

**Key characteristics**:
- Creates **three Secret Manager secrets**: `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_KEY`.
- **Auto-generates** the JWT secret (32-char random) if `jwt_secret` is not provided; uses **placeholders** for the anon key and service role key if not provided.
- After deployment, you must generate valid JWTs signed with the `SUPABASE_JWT_SECRET` and update the anon key and service role key secrets in Secret Manager.
- Kong runs in **declarative (database-less) mode** — all routing is defined in `/home/kong/kong.yml`.
- Image mirroring is always enabled (`enable_image_mirroring = true`).

---

## 2. Outputs

### `config`

| Field | Value / Description |
|---|---|
| `app_name` | `"supabase"` |
| `application_version` | Version tag (default: `"latest"`) |
| `display_name` | `var.display_name` (default: `"Supabase"`) |
| `description` | `var.description` |
| `container_image` | `"kong:2.8"` (Kong API gateway image) |
| `image_source` | `"custom"` |
| `enable_image_mirroring` | `true` (always; overrides `var.enable_image_mirroring`) |
| `container_build_config` | Dockerfile from `Supabase_Common/scripts` |
| `container_port` | `8000` (Kong HTTP port) |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | `var.db_name` (default: `"postgres"`) |
| `db_user` | `var.db_user` (default: `"supabase_admin"`) |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` (default `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_resources` | CPU: `var.cpu_limit` (default `"1000m"`), Memory: `var.memory_limit` (default `"2Gi"`) |
| `min_instance_count` | `var.min_instance_count` (default `1`) |
| `max_instance_count` | `var.max_instance_count` (default `3`) |
| `environment_variables` | Kong configuration env vars merged with `var.environment_variables` |
| `initialization_jobs` | Default `db-init` job or custom override — see §5 |
| `startup_probe` | HTTP `GET /health`, 30s initial delay, 5s timeout, 10s period, 6 failure threshold |
| `liveness_probe` | HTTP `GET /health`, 30s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `secret_ids`

| Key | Secret ID | Description |
|---|---|---|
| `SUPABASE_JWT_SECRET` | `{prefix}-jwt-secret` | JWT signing secret. Auto-generated (32-char) if `jwt_secret = ""`. |
| `SUPABASE_ANON_KEY` | `{prefix}-anon-key` | Public anon JWT. Placeholder `"placeholder-replace-with-signed-jwt"` if `anon_key = ""`. |
| `SUPABASE_SERVICE_KEY` | `{prefix}-service-role-key` | Service role JWT. Placeholder if `service_role_key = ""`. |

### `storage_buckets`

| Field | Value |
|---|---|
| `name_suffix` | `"supabase-storage"` |
| `storage_class` | `"STANDARD"` |
| `public_access_prevention` | `"inherited"` |

### `path`

The absolute path to the `Supabase_Common` module directory, used by `Supabase_GKE` to locate the `scripts/` directory.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"supabase"` | Application name |
| `application_version` | `string` | `"latest"` | Kong image version tag |
| `display_name` | `string` | `"Supabase"` | Human-readable name |
| `description` | `string` | `"Supabase open-source Firebase alternative"` | Module description |
| `db_name` | `string` | `"postgres"` | PostgreSQL database name (Supabase default is `postgres`) |
| `db_user` | `string` | `"supabase_admin"` | PostgreSQL admin user |
| `cpu_limit` | `string` | `"1000m"` | Kong container CPU limit |
| `memory_limit` | `string` | `"2Gi"` | Kong container memory limit |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs; empty triggers the default `db-init` job |
| `startup_probe` | `object` | see §4 | Startup health probe |
| `liveness_probe` | `object` | see §4 | Liveness health probe |
| `enable_image_mirroring` | `bool` | `true` | Always `true` — images are always mirrored |
| `min_instance_count` | `number` | `1` | Minimum running instances |
| `max_instance_count` | `number` | `3` | Maximum running instances |

### Secrets (Sensitive)

| Variable | Type | Default | Description |
|---|---|---|---|
| `jwt_secret` | `string` (sensitive) | `""` | JWT signing secret. Leave empty for auto-generation. |
| `anon_key` | `string` (sensitive) | `""` | Pre-generated anon JWT. Leave empty; replace placeholder in Secret Manager. |
| `service_role_key` | `string` (sensitive) | `""` | Pre-generated service role JWT. Leave empty; replace placeholder in Secret Manager. |

### Storage & Infrastructure

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Cloud SQL Auth Proxy sidecar |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts |
| `region` | `string` | `"us-central1"` | Region for GCS bucket |
| `project_id` | `string` | — | GCP project ID (required for Secret Manager) |
| `resource_prefix` | `string` | — | Prefix for secret names |
| `labels` | `map(string)` | `{}` | Labels applied to secrets |

---

## 4. Health Probes

| Probe | Path | Initial Delay | Timeout | Period | Failure Threshold |
|---|---|---|---|---|---|
| **Startup** | `/health` | 30s | 5s | 10s | 6 |
| **Liveness** | `/health` | 30s | 5s | 30s | 3 |

Kong's `/health` endpoint confirms the gateway process is ready and routing is configured.

---

## 5. Initialization Job

One `db-init` job runs by default:

| Field | Value |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |
| CPU / Memory | `1000m` / `512Mi` |

`db-init.sh` creates the Supabase PostgreSQL database and admin user, enables required extensions (`pgvector`, `uuid-ossp`, `pgcrypto`), and sets up the Supabase schema.

---

## 6. JWT Key Management

Supabase uses signed JWTs for client authentication. `Supabase_Common` creates three secrets:

### Post-Deployment JWT Setup

After initial deployment:

1. Retrieve the auto-generated `SUPABASE_JWT_SECRET`:
   ```bash
   gcloud secrets versions access latest --secret="{prefix}-jwt-secret" --project=PROJECT_ID
   ```

2. Generate a valid anon key JWT signed with the secret:
   ```bash
   # Use jwt.io or the Supabase JWT generator:
   # https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
   ```

3. Update the placeholder anon key in Secret Manager:
   ```bash
   echo -n "your-anon-jwt-here" | gcloud secrets versions add {prefix}-anon-key --data-file=-
   ```

4. Similarly update the service role key.

5. Restart the Supabase pods to pick up the new secrets.

### Providing Keys at Deploy Time

If you have pre-generated JWTs, pass them via `jwt_secret`, `anon_key`, and `service_role_key` variables. These are marked sensitive and are never stored in Terraform state in plaintext.

---

## 7. Kong Configuration

Kong runs in declarative mode (`KONG_DATABASE=off`) using a `kong.yml` file at `/home/kong/kong.yml`. The Dockerfile in `scripts/` copies this file into the Kong image.

Kong routes requests to Supabase microservices by path prefix:
- `/auth/v1/*` → GoTrue (Auth service, port 9999)
- `/rest/v1/*` → PostgREST (port 3000)
- `/realtime/v1/*` → Realtime (port 4000)
- `/storage/v1/*` → Storage API (port 5000)

---

## 8. Platform-Specific Differences

| Aspect | Supabase_GKE | Notes |
|---|---|---|
| Platform | GKE Autopilot only | No Cloud Run variant |
| Additional microservices | Via `additional_services` in `Supabase_GKE` | Auth, PostgREST, Realtime, Storage, Studio |
| JWT management | Auto-generated secret; placeholder anon/service keys | Replace placeholders post-deployment |
| Image mirroring | Always `true` | Cannot be disabled |

---

## 9. Implementation Pattern

```hcl
module "supabase_app" {
  source = "../Supabase_Common"

  application_name    = var.application_name
  application_version = var.application_version
  db_name             = var.db_name
  db_user             = var.db_user
  jwt_secret          = var.jwt_secret
  anon_key            = var.anon_key
  service_role_key    = var.service_role_key
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
  application_modules    = { supabase = module.supabase_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.supabase_app.secret_ids
  module_storage_buckets = module.supabase_app.storage_buckets
  scripts_dir            = abspath("${module.supabase_app.path}/scripts")
}
```
