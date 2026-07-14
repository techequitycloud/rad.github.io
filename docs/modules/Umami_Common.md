---
title: "Umami Common Shared Configuration Module"
description: "Shared configuration reference for the Umami module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Umami Common Shared Configuration Module

The `Umami Common` module defines the Umami analytics platform configuration for the RAD Modules ecosystem. It is a **shared configuration and secrets module** — it creates Secret Manager secrets and produces a `config` output consumed by platform-specific wrapper modules (`Umami CloudRun` and `Umami GKE`).

## 1. Overview

**Purpose**: To centralise all Umami-specific configuration (container image, PostgreSQL database setup, environment variable mapping, health probes, application secret, and initialization job) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Umami_CloudRun  ──┐
└── Umami_GKE       ──┤── instantiate Umami_Common
                      ↓
           Umami_Common (this module)
           Creates: Secret Manager secret (APP_SECRET)
           Produces: config, secret_ids, storage_buckets, path
                      ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                      ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Generates one Secret Manager secret: `APP_SECRET` (injected as the `APP_SECRET` environment variable) — the Next.js application secret key used by Umami for session signing and security.
- **Stateless analytics service**: Umami stores all data in PostgreSQL. No GCS storage buckets are provisioned.
- **No Redis required**: Umami uses only PostgreSQL. `storage_buckets` returns an empty list.
- **`/api/heartbeat` health endpoint**: All probes target Umami's built-in heartbeat endpoint rather than a generic root path.
- Database migrations are run automatically by Umami itself at container startup via Prisma — the `db-init` job only pre-creates the database and user.

---

## 2. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"umami"` |
| `application_version` | Version tag (default: `"postgresql-latest"`) |
| `container_image` | `"ghcr.io/umami-software/umami"` (GitHub Container Registry source image) |
| `image_source` | `"custom"` — a wrapper image is built via Cloud Build to map DB_* variables to `DATABASE_URL` |
| `enable_image_mirroring` | `true` (hardcoded) — mirrors the image from GitHub Container Registry into Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { UMAMI_VERSION = <version> }` |
| `container_port` | `3000` |
| `database_type` | `"POSTGRES_15"` — Umami requires PostgreSQL |
| `db_name` | Database name (default: `"umami"`) |
| `db_user` | Database user (default: `"umami"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_resources` | CPU: `1000m`, Memory: `512Mi` — Umami is lightweight |
| `min_instance_count` | `var.min_instance_count` (default `1`) |
| `max_instance_count` | `var.max_instance_count` (default `10`) |
| `environment_variables` | Passed through from `var.environment_variables` |
| `initialization_jobs` | Default `db-init` job (when `var.initialization_jobs = []`), or the user-supplied list |
| `startup_probe` | HTTP `GET /api/heartbeat`, 30s initial delay, 10s timeout, 10s period, 30 failure threshold |
| `liveness_probe` | HTTP `GET /api/heartbeat`, 30s initial delay, 10s timeout, 30s period, 3 failure threshold |

### `secret_ids`
Map of environment variable names to Secret Manager secret IDs:

```hcl
{
  APP_SECRET = "secret-<tenant_resource_prefix>-<application_name>-app-secret"
}
```

This map is passed directly as `module_secret_env_vars` to the Foundation Module and injected into the container at runtime as `APP_SECRET`.

### `storage_buckets`
Returns an empty list `[]`. Umami is a stateless analytics service — all data lives in PostgreSQL. No dedicated application storage buckets are provisioned.

### `path`
The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory.

---

## 3. Secret Created

| Secret ID Pattern | Description |
|---|---|
| `secret-<tenant_resource_prefix>-<application_name>-app-secret` | 32-character alphanumeric `APP_SECRET` for Umami (no special characters). Injected as `APP_SECRET`. |

The secret is created with `replication { auto {} }` (automatic multi-region replication). A propagation wait is inserted after creation to prevent race conditions when the Cloud Run service or GKE pod first reads the secret at startup.

---

## 4. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. **Required.** |
| `application_name` | `string` | `"umami"` | Application name. Used as a base name for resources. |
| `application_version` | `string` | `"postgresql-latest"` | Umami image tag. Must be a `postgresql-` prefixed tag. |
| `display_name` | `string` | `"Umami"` | Human-readable display name. |
| `description` | `string` | `"Umami - Privacy-focused web analytics"` | Application description. |
| `tenant_deployment_id` | `string` | `"demo"` | Unique identifier for the deployment environment. Used in secret IDs. |
| `resource_labels` | `map(string)` | `{}` | Common labels to apply to all resources. |
| `db_name` | `string` | `"umami"` | PostgreSQL database name. |
| `db_user` | `string` | `"umami"` | PostgreSQL application user. |
| `cpu_limit` | `string` | `"1000m"` | Container CPU limit included in the `config` output. |
| `memory_limit` | `string` | `"512Mi"` | Container memory limit included in the `config` output. |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables passed directly to the container. |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs. Empty triggers the default `db-init` job. |
| `startup_probe` | `object` | (see §5) | Startup health probe configuration. |
| `liveness_probe` | `object` | (see §5) | Liveness health probe configuration. |
| `min_instance_count` | `number` | `1` | Minimum number of running instances. |
| `max_instance_count` | `number` | `10` | Maximum number of running instances. |

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket. |
| `region` | `string` | `"us-central1"` | GCP region (used as bucket location if storage were provisioned). |

---

## 5. Health Probes

Umami exposes `/api/heartbeat` as its dedicated health endpoint. This endpoint returns HTTP 200 when Umami is fully initialised and connected to PostgreSQL.

| Probe | Path | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|---|
| **Startup** | `/api/heartbeat` | 30s | 10s | 10s | 30 | Allows up to 5 minutes total for Umami to start and run Prisma migrations on a fresh database |
| **Liveness** | `/api/heartbeat` | 30s | 10s | 30s | 3 | Restarts the container if Umami becomes unresponsive |

The startup probe's high `failure_threshold` (30 × 10s = 300s after the initial delay) accommodates fresh database provisioning where Prisma migrations must run and apply the full Umami schema. Subsequent restarts are faster because migrations are already applied.

Umami exposes `/api/heartbeat` specifically for health checks — use this path rather than the generic root path `/` for probe configuration.

---

## 6. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/create-db-and-user.sh` |
| Secrets required | `DB_PASSWORD` (application user password), `ROOT_PASSWORD` (postgres superuser) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 retry |

`create-db-and-user.sh` behaviour:
1. Connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket or TCP as appropriate.
2. Creates the `umami` database user with the password from Secret Manager.
3. Creates the `umami` database if it does not exist.
4. Grants the `umami` user full privileges on the database.

**Note:** Umami runs its own Prisma-based database migrations on container startup. The `db-init` job only pre-creates the database shell and user — Umami populates the schema itself. This means the `db-init` job must complete successfully before the Umami container starts.

---

## 7. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as the Docker build context when `container_image_source = "custom"`.

### `Dockerfile`
Wraps the official `ghcr.io/umami-software/umami:<version>` image:
- Accepts `UMAMI_VERSION` as a build argument.
- Copies a custom entrypoint script that assembles `DATABASE_URL` from platform-injected DB_* environment variables.
- Exposes port `3000`.

### Entrypoint
The custom entrypoint runs before the Umami process to:

1. **Construct `DATABASE_URL`**: Assembles the PostgreSQL connection string from `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, and `DB_NAME` — the standard variables injected by the platform's `App_CloudRun` / `App_GKE` modules. When `DB_HOST` is a Unix socket path (starts with `/`), the entrypoint resolves it to TCP `127.0.0.1` (the Cloud SQL Auth Proxy also listens on localhost), because socket paths cannot appear in a `postgresql://` URL. The password is URL-encoded so special characters in the generated secret do not break Prisma's URL parser.

2. **Set `DATABASE_URL`**: Exports the assembled connection string as `DATABASE_URL` for Umami's Prisma ORM.

3. **Start Umami**: Locates and `exec`s the Umami Node server (`/app/server.js`, falling back to the Next.js standalone server or `yarn start`).

This approach avoids exposing a plaintext connection string as an environment variable or storing it in Terraform state.

---

## 8. DATABASE_URL Assembly

Umami uses the `DATABASE_URL` environment variable for all database connectivity. The platform injects individual DB_* variables:

| Platform env var | Role |
|---|---|
| `DB_HOST` | PostgreSQL host (socket path when using Auth Proxy) |
| `DB_USER` | PostgreSQL application username |
| `DB_PASSWORD` | PostgreSQL application password (from Secret Manager) |
| `DB_NAME` | PostgreSQL database name |
| `DB_PORT` | PostgreSQL port (5432 for standard connections) |

The custom entrypoint assembles these into `DATABASE_URL` using the format:

```
postgresql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME
```

When `DB_HOST` is a Unix socket path (Cloud SQL Auth Proxy, the default), the entrypoint substitutes `127.0.0.1` as the host — the Auth Proxy also listens on TCP localhost — so the URL stays parseable:

```
postgresql://DB_USER:DB_PASSWORD@127.0.0.1:5432/DB_NAME
```

This is why `container_image_source = "custom"` is the recommended default — the `"prebuilt"` mode using the official Umami image requires manually providing a fully-formed `DATABASE_URL` in `environment_variables`.

---

## 9. Platform-Specific Differences

| Aspect | Umami CloudRun | Umami GKE |
|---|---|---|
| `min_instance_count` | `0` (scale-to-zero supported) | `1` (always at least one pod running) |
| `max_instance_count` | `3` (Cloud Run default) | `10` (GKE HPA default) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path (`/cloudsql/...`) | Cloud SQL private IP or Auth Proxy sidecar socket |
| Health probe registration | Cloud Run startup/liveness probe configuration | Kubernetes probe spec via `App GKE` |
| Uptime checks | Disabled by default (`uptime_check_config.enabled = false`) | Disabled by default (`uptime_check_config.enabled = false`) |
| Redis | Not used (`enable_redis = false`) | Not used (the mirrored `enable_redis` declaration defaults `true` but is not forwarded to the Foundation) |
| Storage buckets | None (empty list returned) | None (empty list returned) |

---

## 10. Implementation Pattern

```hcl
# Example: how Umami_CloudRun instantiates Umami_Common

module "umami_app" {
  source = "../Umami_Common"

  project_id           = var.project_id
  application_name     = var.application_name
  application_version  = var.application_version
  tenant_deployment_id = var.tenant_deployment_id
  db_name              = var.application_database_name
  db_user              = var.application_database_user
  cpu_limit            = var.cpu_limit
  memory_limit         = var.memory_limit
  description          = var.application_description
  startup_probe        = var.startup_probe
  liveness_probe       = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  initialization_jobs  = var.initialization_jobs
}

# The wrapper assembles the four locals the Foundation Module consumes
# (config is merged with wrapper-level overrides such as image_source)
locals {
  application_modules    = { umami = merge(module.umami_app.config, { image_source = var.container_image_source }) }
  module_env_vars        = {}
  module_secret_env_vars = module.umami_app.secret_ids
  module_storage_buckets = module.umami_app.storage_buckets
}

# config is passed to App_CloudRun via application_config
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_env_vars        = local.module_env_vars
  module_secret_env_vars = local.module_secret_env_vars
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = abspath("${module.umami_app.path}/scripts")
  # ... other inputs
}
```

---

## 11. First-Login Instructions

After deployment, navigate to the Umami service URL. The default credentials are:

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `umami` |

**Change these immediately after first login.** The default credentials are publicly known and will expose your analytics dashboard if left unchanged.

To change the admin password:
1. Log in with the default credentials.
2. Navigate to **Settings → Profile**.
3. Update the username and password.
4. Click **Save**.

---

## 12. Adding Websites for Tracking

After logging in:
1. Navigate to **Settings → Websites**.
2. Click **Add website**.
3. Enter the website name and domain.
4. Click **Save** to generate a tracking ID.
5. Embed the tracking script in the target website's `<head>`:

```html
<script async src="https://<your-umami-url>/script.js" data-website-id="<your-website-id>"></script>
```

The tracking script collects page views, sessions, referrers, browser and device information, and custom events without using cookies or storing personal data.

---

## 13. Custom Events API

Umami supports custom event tracking via a client-side function call or direct API:

```javascript
// Track a custom event
umami.track('button-click', { label: 'sign-up', page: '/home' });
```

Custom events appear in the Umami dashboard under **Events**. Use them to track conversions, button clicks, form submissions, or any user interaction.

The Umami REST API (`/api`) also allows programmatic retrieval of analytics data for integration with dashboards or reporting tools. Authenticate with a bearer token obtained from `POST /api/auth/login`.

---

## 14. Team Workspaces

Umami supports multiple users, multiple websites, and role-based access control:

- **Admin**: Full access to all settings, users, and websites.
- **View-only**: Read access to analytics dashboards.

To add team members:
1. Navigate to **Settings → Users**.
2. Click **Create user**.
3. Assign the appropriate role.

Multiple websites can be tracked within a single Umami instance — each website gets its own tracking ID and isolated analytics view.
