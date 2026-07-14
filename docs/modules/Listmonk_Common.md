---
title: "Listmonk Common Shared Configuration Module"
description: "Shared configuration reference for the Listmonk module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Listmonk Common Shared Configuration Module

The `Listmonk Common` module defines the Listmonk newsletter manager configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates Secret Manager secrets and produces `config`, `secret_ids`, and `storage_buckets` outputs consumed by platform-specific wrapper modules (`Listmonk CloudRun` and `Listmonk GKE`).

## 1. Overview

**Purpose**: To centralise all Listmonk-specific configuration (container image, PostgreSQL setup, environment variable mapping, health probes, uploads storage bucket, and the admin password secret) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Listmonk_CloudRun  ──┐
└── Listmonk_GKE       ──┤── instantiate Listmonk_Common
                          ↓
               Listmonk_Common (this module)
               Creates: Secret Manager secret (admin password)
               Produces: config, secret_ids, storage_buckets
                          ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                          ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Uses **PostgreSQL 15** — compatible with both Cloud Run and GKE deployment paths.
- Creates **two Secret Manager secrets** — the admin password (`LISTMONK_ADMIN_PASSWORD`, auto-generated) and a **deterministic API token** (`LISTMONK_API_TOKEN`) that the entrypoint re-asserts into the `users` table on every start (see **Self-Healing API User**, §8).
- **Health endpoints:** `/health` returns `{"data":true}` with HTTP 200 and **no auth** (use this for probes). `/api/*` — including `/api/health` — requires an authenticated session and returns `403 {"message":"invalid session"}` unauthenticated. The wrapper modules therefore use a **TCP** startup/liveness probe on port 9000 (Listmonk v6.1.0 gates `/api/health` behind session auth).
- Listmonk uses **double-underscore notation** for configuration via environment variables (`LISTMONK_db__host`, `LISTMONK_db__password`), mapping to nested TOML/JSON config keys.
- `Listmonk_CloudRun` (not `Listmonk_Common`) sets its own `db_password_env_var_name = "LISTMONK_db__password"` so `App CloudRun` injects the database password secret directly under that name in addition to `DB_PASSWORD`. `Listmonk_GKE` leaves this empty and relies solely on `entrypoint.sh` mapping `DB_PASSWORD` → `LISTMONK_db__password` at boot.

---

## 2. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"listmonk"` |
| `application_version` | Version tag (default: `"latest"`) |
| `container_image` | `"listmonk/listmonk"` (Docker Hub image) |
| `image_source` | `"custom"` — a custom wrapper image is built by default |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `true`) — mirrors the image to Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = {}` (empty — the Dockerfile hardcodes `FROM listmonk/listmonk:latest` and does not read `application_version` as a build arg) |
| `container_port` | `9000` |
| `database_type` | `"POSTGRES_15"` — Listmonk requires PostgreSQL |
| `db_name` | Database name (default: `"listmonk"`) |
| `db_user` | Database user (default: `"listmonk"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | List of GCS Fuse volume mounts (empty by default) |
| `container_resources` | CPU: `1000m`, Memory: `512Mi` |
| `environment_variables` | Listmonk configuration env vars (see §7) |
| `secret_environment_variables` | `{ DB_PASSWORD = <database password secret id> }` — merged with any `var.secret_environment_variables`. The admin password and API token are surfaced separately via the `secret_ids` output, not this field. |
| `initialization_jobs` | Default `db-init` job or custom override — see §5 |
| `startup_probe` | HTTP `GET /api/health`, 30s initial delay, 5s timeout, 10s period, 30 failure threshold |
| `liveness_probe` | HTTP `GET /api/health`, 30s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `secret_ids`

A map of Secret Manager secret IDs injected as secret environment variables.

| Key | Value / Description |
|---|---|
| `LISTMONK_ADMIN_PASSWORD` | Secret Manager secret ID for the auto-generated admin password. Drives Listmonk's v3 auto-install of the super admin. |
| `LISTMONK_API_TOKEN` | Secret Manager secret ID for the deterministic API token. The entrypoint re-asserts `sha256_hex(token)` into `users.password` on every start (see §8 and the **Self-Healing API User** notes). |

Two additional (non-secret) outputs support wiring downstream consumers to the same credential:

| Output | Description |
|---|---|
| `api_user` | The API username the entrypoint seeds (`var.api_username`, default `rad-api`). |
| `api_token_secret_id` | `secret_id` of the deterministic API token; point n8n's `LISTMONK_API_TOKEN` at this secret (`:latest`). |

### `storage_buckets`

`Listmonk Common` does not provision a default GCS bucket. The `storage_buckets` output is an empty list by default. Wrapper modules (`Listmonk CloudRun`, `Listmonk GKE`) manage GCS bucket provisioning via the `storage_buckets` and `gcs_volumes` variables directly.

If uploads bucket provisioning is desired, configure `storage_buckets` in the wrapper module and mount the resulting bucket via `gcs_volumes` at `/listmonk/uploads`.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"listmonk"` | Application name. Used as a prefix for the admin password secret. |
| `application_version` | `string` | `"latest"` | Listmonk Docker image tag. Set to a specific version (e.g., `"v3.0.0"`) for pinned production deployments. |
| `display_name` | `string` | `"Listmonk"` | Human-readable display name. |
| `description` | `string` | `"Listmonk is a self-hosted newsletter and mailing list manager"` | Application description. Used in the `db-init` job description. |
| `db_name` | `string` | `"listmonk"` | PostgreSQL database name. Must match `application_database_name` in the wrapper module. |
| `db_user` | `string` | `"listmonk"` | PostgreSQL application user. Must match `application_database_user` in the wrapper module. |
| `admin_username` | `string` | `"listmonk"` | Declared but currently unused by `main.tf` — the seeded super-admin username is hardcoded to `"admin"` via `LISTMONK_ADMIN_USER`, regardless of this variable's value. |
| `api_username` | `string` | `"rad-api"` | Username of the self-healing programmatic API user seeded into `users` on every start. Paired with the deterministic `api_token` secret so downstream consumers never hold a stale token. |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit. |
| `memory_limit` | `string` | `"512Mi"` | Container memory limit. |
| `min_instance_count` | `number` | `1` | Minimum running instances. |
| `max_instance_count` | `number` | `3` | Maximum running instances. |
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket. |
| `enable_image_mirroring` | `bool` | `true` | Mirror the container image to Artifact Registry before deployment. |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables merged into the Listmonk config. |
| `secret_environment_variables` | `map(string)` | `{}` | Additional secret env vars, merged with the module-managed `DB_PASSWORD` reference. The admin password and API token are surfaced via `secret_ids`, not this variable. |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs; empty triggers the default `db-init` job. |
| `startup_probe` | `object` | See §4 | Startup health probe configuration. |
| `liveness_probe` | `object` | See §4 | Liveness health probe configuration. |

### Infrastructure

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. **Required.** Used to create the admin password secret. |
| `resource_prefix` | `string` | — | Prefix for Secret Manager secret names. **Required.** Typically `app<listmonk><tenant><id>`. |
| `tenant_deployment_id` | `string` | `"demo"` | Deployment environment identifier. |
| `region` | `string` | `"us-central1"` | GCP region for resource deployment. |
| `labels` | `map(string)` | `{}` | Labels applied to created resources (secrets). |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts (name, bucket_name, mount_path, readonly, mount_options). |

---

## 4. Health Probes

`Listmonk_Common`'s own `startup_probe`/`liveness_probe` **input variable defaults** are an HTTP `GET /api/health` check (shown below) — but as of Listmonk v6.1.0, `/api/health` sits behind session auth and returns `403 {"message":"invalid session"}` to an unauthenticated probe. Both wrapper modules (`Listmonk_CloudRun`, `Listmonk_GKE`) therefore **override** these variables with a **TCP** probe on port 9000 before passing them through to `Listmonk_Common` — see §9. `/health` (no `/api` prefix) is the actual unauthenticated 200 endpoint, but is not used as the default probe path.

`Listmonk_Common`'s variable defaults, if left unoverridden:

| Probe | Path | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|---|
| **Startup** | `/api/health` | 30s | 5s | 10s | 30 | Allows up to 330 seconds total (30s delay + 30 × 10s) for Listmonk to complete `--install` schema creation on first boot |
| **Liveness** | `/api/health` | 30s | 5s | 30s | 3 | Restarts the container if Listmonk becomes unresponsive or loses database connectivity |

In practice, deployed probes are the TCP probes configured at the wrapper-module level (see §9 and each variant's own guide), not this HTTP default.

---

## 5. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets required | `DB_PASSWORD` (app user), optionally `ROOT_PASSWORD` (superuser for user creation) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |

`db-init.sh` behaviour:
1. Resolves the target PostgreSQL host from `DB_HOST` or falls back to `DB_IP`.
2. Detects connection type: if `DB_HOST` starts with `/`, uses a Unix socket (`PGHOST`); otherwise uses TCP.
3. Polls PostgreSQL using `pg_isready` (up to 30 retries, 2s apart).
4. Creates the `listmonk` database user if it does not exist, assigning the password from `DB_PASSWORD`.
5. Creates the `listmonk` database owned by the application user if it does not exist.
6. Verifies the application user can connect to the database.
7. Signals Cloud SQL Proxy shutdown after completion.

**Listmonk handles schema installation itself.** The `db-init` job only creates the database and user — it does not run SQL migrations. On first startup, Listmonk detects a fresh database and automatically runs `--install` to create tables, indexes, seed data, and the admin user defined by `admin_username` / `LISTMONK_app__admin_password`.

Override `initialization_jobs` with a non-empty list to replace this default with custom jobs. Each custom job must specify at least one of `command`, `args`, or `script_path`.

---

## 6. Secret Manager Secret

`Listmonk Common` creates one Secret Manager secret:

| Secret Name Pattern | Value | How Set |
|---|---|---|
| `secret-<resource_prefix>-<app>-admin-password` | Random password (alphanumeric, 16 chars) | Auto-generated (`random_password`) on first apply |
| `secret-<resource_prefix>-<app>-api-token` | Random API token (alphanumeric, 48 chars) | Auto-generated (`random_password`) on first apply |

Both are injected as container **secret env vars** via the `secret_ids` output — `LISTMONK_ADMIN_PASSWORD` and `LISTMONK_API_TOKEN` (single-underscore names, valid GKE SecretSync keys). Cloud Run / GKE reads the values from Secret Manager at revision/pod start — they are never written to Terraform state.

The admin **username** is set via the plain-text `LISTMONK_ADMIN_USER` env var (default `"admin"`); together with `LISTMONK_ADMIN_PASSWORD` it drives Listmonk's v3 auto-install of the super admin. The API **username** is `LISTMONK_API_USER` (from `var.api_username`, default `"rad-api"`).

---

## 7. Environment Variables

Listmonk reads configuration from environment variables using double-underscore notation, mapping to nested config keys:

| Environment Variable | Default Value | Purpose |
|---|---|---|
| `LISTMONK_app__address` | `"0.0.0.0:9000"` | Bind address and port for the Listmonk HTTP server |
| `LISTMONK_ADMIN_USER` | `"admin"` | Super-admin username for v3 auto-install (single underscore = valid GKE SecretSync key) |
| `LISTMONK_API_USER` | `var.api_username` (default `"rad-api"`) | Username of the self-healing programmatic API user (see §8) |
| `LISTMONK_db__port` | `"5432"` | PostgreSQL port |
| `LISTMONK_db__ssl_mode` | `"disable"` | SSL mode for the Cloud SQL Auth Proxy connection (proxy handles TLS) |
| `LISTMONK_upload__provider` | `"filesystem"` | Upload storage provider. `"filesystem"` stores files on the mounted path |
| `LISTMONK_upload__filesystem__upload_path` | `"/listmonk/uploads"` | Path where uploads are stored. Mount a GCS Fuse volume at this path for persistence |

> **`LISTMONK_db__user` / `LISTMONK_db__database` are intentionally NOT set.** The Foundation creates the DB user/database under tenant-scoped names and injects `DB_USER`/`DB_NAME`; the entrypoint maps them only when unset. Pre-setting them to `"listmonk"` overrides the real names and causes `password authentication failed for user listmonk`.

**Secret env vars (from `secret_ids`):**

| Environment Variable | Source |
|---|---|
| `LISTMONK_ADMIN_PASSWORD` | Admin-password secret managed by this module (drives v3 auto-install) |
| `LISTMONK_API_TOKEN` | Deterministic API-token secret managed by this module (re-asserted into `users.password` by the entrypoint) |
| `DB_PASSWORD` | Platform-injected database password secret (managed by `App CloudRun`/`App GKE`); `entrypoint.sh` maps it onto `LISTMONK_db__password` at boot when the latter is unset. On Cloud Run, `Listmonk_CloudRun` additionally sets `db_password_env_var_name = "LISTMONK_db__password"` so the Foundation injects the same secret directly under that name too. |

**Note on DB_HOST:** The `LISTMONK_db__host` environment variable is populated at runtime via `entrypoint.sh`, which maps the platform-injected `DB_HOST` onto it when unset. When `enable_cloudsql_volume = true`, the Auth Proxy socket path is mapped to the appropriate Listmonk config key.

---

## 8. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as the Docker build context.

### `Dockerfile`

Wraps the official `listmonk/listmonk:latest` (Alpine) image — the tag is hardcoded, not parameterized from `application_version`:
- `apk add postgresql-client` — `psql` is required by the entrypoint to set `app.root_url` and to seed the API user.
- Copies `entrypoint.sh` to `/entrypoint.sh` (`chmod +x`).
- Sets the working directory to `/listmonk` and uses `/entrypoint.sh` as the ENTRYPOINT.

### `entrypoint.sh`

Runs before `exec ./listmonk` to configure the runtime environment:

**1. Database variable mapping** — maps platform-injected `DB_HOST`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` onto `LISTMONK_db__*` **only when unset** (so the Foundation's tenant-scoped names win). Cloud SQL Unix-socket hosts (`/...`) set `ssl_mode=disable`.

**2. Idempotent schema install** — runs `./listmonk --install --idempotent --yes` on every start. `--idempotent` is **mandatory**: a bare `--install --yes` is destructive (drops+recreates all tables every start, wiping subscribers); with it, install is a no-op once the DB is set up (`skipping install as database appears to be already setup`).

**3. Public root URL** — sets `settings.app.root_url` in the DB to `CLOUDRUN_SERVICE_URL`/`GKE_SERVICE_URL` (a DB setting, not an env override), so public links don't point at `localhost:9000`.

**4. Self-healing API user** — when `LISTMONK_API_USER` + `LISTMONK_API_TOKEN` are set, UPSERTs that user into the persistent `users` table (idempotent `ON CONFLICT (username) DO UPDATE`), storing `sha256_hex(token)` in `users.password`. Listmonk verifies API tokens with **SHA-256 + `ConstantTimeCompare`** (not bcrypt), so `sha256sum` is all that's needed. The SQL is fed to `psql` on **stdin** (psql `-c` doesn't interpolate `:'var'`) and guarded as `if SEED_OUT=$(...)` so a failure can't abort the entrypoint under `set -e`. Token/hash are never logged. This makes the credential deterministic across restarts/cold-starts/DB-reseeds, so n8n's campaign-sender (referencing the same secret) never desyncs.

**5. Startup** — `exec ./listmonk`.

### `db-init.sh`

PostgreSQL database and user creation script. See §5 for full behaviour description.

---

## 9. Platform-Specific Differences

| Aspect | Listmonk CloudRun | Listmonk GKE |
|---|---|---|
| Secret injection | `App CloudRun` injects `LISTMONK_ADMIN_PASSWORD` from Secret Manager natively at revision start | `App GKE` uses the Secrets Store CSI Driver to mount secrets from Secret Manager as env vars in pods |
| `DB_HOST` | Cloud SQL Auth Proxy socket path (Unix socket under `/cloudsql`) | Cloud SQL private IP address (TCP connection) |
| `min_instance_count` | Default `0` (scale-to-zero, paired with `cpu_always_allocated = true` so an async campaign send completes when the instance wakes) | Default `1` (always one pod running) |
| Health probes | Cloud Run **TCP** startup probe on port 9000; liveness probe disabled (Cloud Run has no TCP liveness option and `/api/health` 403s an HTTP probe) | Kubernetes `tcpSocket` startup and liveness probes on port 9000 via `App GKE` |
| Session affinity | Handled at Cloud Run level | Kubernetes Service `sessionAffinity: "ClientIP"` for consistent admin session routing |
| Upload persistence | GCS Fuse volume via `gcs_volumes` (Cloud Run Gen2) | GCS Fuse CSI Driver via `gcs_volumes` (GKE native) |

---

## 10. Implementation Pattern

```hcl
# How Listmonk_CloudRun instantiates Listmonk_Common

module "listmonk_app" {
  source = "../Listmonk_Common"

  project_id           = var.project_id
  resource_prefix      = local.resource_prefix
  tenant_deployment_id = var.tenant_deployment_id
  region               = var.region
  labels               = var.resource_labels

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  admin_username         = var.admin_username
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  min_instance_count     = var.min_instance_count
  max_instance_count     = var.max_instance_count
  description            = var.description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  enable_image_mirroring = var.enable_image_mirroring
  gcs_volumes            = var.gcs_volumes
}

# The wrapper assembles the four locals consumed by App_CloudRun
locals {
  application_modules    = { listmonk = module.listmonk_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.listmonk_app.secret_ids
  module_storage_buckets = module.listmonk_app.storage_buckets
  scripts_dir            = abspath("${path.module}/../Listmonk_Common/scripts")
}

# Passed to App_CloudRun via application_config
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... other inputs
}
```

---

## 11. Exploring with the GCP Console

After deployment, use the GCP Console to verify the secrets and configuration generated by `Listmonk Common`.

**Secret Manager**

Navigate to **Secret Manager** in the console. Filter by the deployment name or `listmonk` to locate the module-managed secrets:

- `secret-<resource_prefix>-listmonk-admin-password` (injected as `LISTMONK_ADMIN_PASSWORD`) — select the secret, click **Secret versions**, and verify that version 1 exists with status `Enabled`. The **Permissions** tab shows that the Cloud Run or GKE service account has `Secret Manager Secret Accessor` (`roles/secretmanager.secretAccessor`) — this was granted automatically by `App CloudRun`/`App GKE`.
- `secret-<resource_prefix>-listmonk-api-token` (injected as `LISTMONK_API_TOKEN`) — the deterministic API-token secret.

Do not view the secret value in the console for production deployments. Retrieve it only for initial admin login or break-glass access.

**Cloud Run environment (verifying variable injection)**

Navigate to **Cloud Run** → select the Listmonk service → **YAML tab**. Locate the `env` section in the container spec. Confirm:
- `LISTMONK_app__address`, `LISTMONK_ADMIN_USER`, `LISTMONK_API_USER`, `LISTMONK_db__port`, `LISTMONK_db__ssl_mode`, `LISTMONK_upload__provider`, `LISTMONK_upload__filesystem__upload_path` appear as plain-text `value:` env vars. (`LISTMONK_db__user` / `LISTMONK_db__database` are intentionally absent — the entrypoint maps them from `DB_USER`/`DB_NAME` at boot.)
- `LISTMONK_ADMIN_PASSWORD`, `LISTMONK_API_TOKEN`, and `DB_PASSWORD` appear as `valueFrom.secretKeyRef:` entries — confirming they are sourced from Secret Manager and not stored in plaintext in the revision spec.

**Listmonk Admin UI**

After deployment, the Listmonk admin interface is accessible at the Cloud Run service URL (from the `service_url` output or the **Cloud Run** console). Navigate to the root path `/` — Listmonk serves the admin UI directly. Log in with username `admin` (hardcoded via `LISTMONK_ADMIN_USER`, independent of the `admin_username` variable) and the password from Secret Manager.

From the admin UI, verify:
- **Settings → General**: Confirms the application address and root URL.
- **Settings → Performance**: Shows concurrency and batch size defaults for campaign sending.
- **Lists**: Initially empty. Create a list to begin subscriber management.

---

## 12. Exploring with gcloud

```bash
# List all Secret Manager secrets in the project related to this Listmonk deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~listmonk" \
  --format="table(name,replication.automatic.customerManagedEncryption,createTime)"

# Confirm a secret version exists and is enabled for the admin password secret
gcloud secrets versions list SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime,destroyTime)"

# Check which service accounts have access to the admin password secret
gcloud secrets get-iam-policy SECRET_NAME \
  --project=PROJECT_ID

# View the Listmonk container's environment variable names (not values)
# to confirm all required Listmonk config vars are present
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(spec.template.spec.containers[0].env)"

# Verify Secret Manager secret accessor binding for the Cloud Run service account
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role=roles/secretmanager.secretAccessor" \
  --format="table(bindings.members)"

# Access the admin password for initial login (use with caution)
gcloud secrets versions access latest \
  --secret=ADMIN_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID

# Verify the PostgreSQL database and user exist after db-init completes
# (requires Cloud SQL Auth Proxy access or a bastion)
gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID

gcloud sql users list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,type)"
```
