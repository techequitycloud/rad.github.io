# Kestra_Common Shared Configuration Module

The `Kestra_Common` module defines the Kestra workflow orchestration platform for the RAD Modules ecosystem. It **creates GCP resources** (one Secret Manager secret for the admin password) and produces a `config` output consumed by the platform-specific wrapper modules (`Kestra_CloudRun` and `Kestra_GKE`).

## 1. Overview

**Purpose**: To centralise all Kestra-specific configuration — PostgreSQL backend (standalone mode), GCS artifact storage, admin password secret, and a pre-configured `db-init` bootstrap job — in a single module shared by Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Kestra_CloudRun  ──┐
└── Kestra_GKE       ──┤── instantiate Kestra_Common
                       ↓
           Kestra_Common (this module)
           Creates: 1 Secret Manager secret (admin password)
           Produces: config, storage_buckets, secret_ids, secret_values,
                     resource_prefix, path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Kestra runs in **standalone mode**, combining the server, worker, and scheduler into a single container. This is reflected throughout the configuration: PostgreSQL is used for both the queue and repository backends, and `max_instance_count` should be `1` to avoid conflicting state.
- The container image is built from a **custom Dockerfile** that wraps `kestra/kestra:latest`. The Dockerfile installs `socat` and replaces the entrypoint with a custom `entrypoint.sh` that bridges the Cloud SQL Unix socket to TCP (required because Kestra's Java JDBC driver cannot connect via Unix sockets natively).
- Redis is **not used**. Kestra uses PostgreSQL as its queue and repository backend in standalone mode. The wrapper modules explicitly set `enable_redis = false` and pass empty `redis_host`/`redis_auth` values.

---

## 2. GCP Resources Created

| Resource | ID / Name | Purpose |
|---|---|---|
| `random_password.admin_password` | *(24 chars, no special chars)* | Auto-generated password for the Kestra admin UI |
| `google_secret_manager_secret.admin_password` | `<resource_prefix>-admin-password` | Secret Manager secret holding the admin password |
| `google_secret_manager_secret_version.admin_password` | *(latest version)* | Stores the generated admin password value |
| `google_project_service.secretmanager` | `secretmanager.googleapis.com` | Enables Secret Manager API in the target project |
| `time_sleep.wait_for_secrets` | *(30s delay)* | Waits after secret creation before the `secret_ids` output resolves, allowing Secret Manager global replication |

---

## 3. Storage Buckets

`Kestra_Common` produces a single GCS bucket definition via the `storage_buckets` output:

| Field | Value |
|---|---|
| `name_suffix` | `"kestra-storage"` |
| `name` | `<resource_prefix>-kestra-storage` |
| `location` | `var.deployment_region` |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` |

This bucket is injected as `KESTRA_STORAGE_GCS_BUCKET` in the application environment variables, providing GCS-backed storage for flows, executions, and artifacts.

---

## 4. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | from `application_name` (default: `"kestra"`) |
| `display_name` | from `display_name` |
| `description` | from `description` |
| `container_image` | `"kestra/kestra"` (base image for custom build) |
| `application_version` | from `application_version` |
| `image_source` | `"custom"` |
| `enable_image_mirroring` | from `enable_image_mirroring` (default: `true`) |
| `container_build_config` | `enabled = true`, `dockerfile_path = "Dockerfile"`, `context_path = "."` |
| `container_port` | `8080` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | from `db_name` (default: `"kestra"`) |
| `db_user` | from `db_user` (default: `"kestra"`) |
| `enable_cloudsql_volume` | from `enable_cloudsql_volume` |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | from `gcs_volumes` |
| `container_resources` | CPU/memory limits; no requests set |
| `min_instance_count` | from `min_instance_count` (default: `1`) |
| `max_instance_count` | from `max_instance_count` (default: `1` — see standalone mode note) |
| `environment_variables` | Merged map — see §5 |
| `enable_postgres_extensions` | `false` |
| `postgres_extensions` | `[]` |
| `initialization_jobs` | Default `db-init` job or custom override — see §6 |
| `startup_probe` | from `startup_probe` variable |
| `liveness_probe` | from `liveness_probe` variable |

### `storage_buckets`

List with one entry — the Kestra GCS storage bucket described in §3.

### `secret_ids`

Map of environment variable names to Secret Manager secret IDs. A 30-second `time_sleep` is applied before this output resolves.

```hcl
{
  KESTRA_BASICAUTH_PASSWORD = "<resource_prefix>-admin-password"
}
```

### `secret_values`

Sensitive map containing the raw generated admin password. Used by wrapper modules to inject secret values directly into Kubernetes Secrets (GKE) or `module_explicit_secret_values` (Cloud Run), bypassing Secret Manager read-after-write delays.

```hcl
{
  KESTRA_BASICAUTH_PASSWORD = "<generated 24-char password>"
}
```

### `path`

The resolved filesystem path of the `Kestra_Common` module directory. Used by wrapper modules to locate the `scripts/` directory:

```hcl
scripts_dir = abspath("${module.kestra_app.path}/scripts")
```

### `resource_prefix`

The computed resource naming prefix (`app<application_name><tenant_deployment_id><deployment_id>`). Useful for downstream referencing.

---

## 5. Environment Variables (always injected)

`Kestra_Common` merges the following into `config.environment_variables`, with `var.environment_variables` taking precedence:

| Variable | Value | Purpose |
|---|---|---|
| `MICRONAUT_SERVER_PORT` | `"8080"` | Kestra/Micronaut HTTP server port |
| `KESTRA_QUEUE_TYPE` | `"postgres"` | Use PostgreSQL as the internal queue |
| `KESTRA_REPOSITORY_TYPE` | `"postgres"` | Use PostgreSQL as the flow/execution repository |
| `KESTRA_STORAGE_TYPE` | `"gcs"` | Use Google Cloud Storage for artifact storage |
| `KESTRA_STORAGE_GCS_BUCKET` | `<resource_prefix>-kestra-storage` | GCS bucket name for flows and artifacts |
| `KESTRA_BASICAUTH_ENABLED` | `"true"` | Enables Kestra's built-in basic auth |
| `KESTRA_BASICAUTH_USERNAME` | `"admin"` | Default admin username |
| `DATASOURCES_POSTGRES_DRIVERCLASSNAME` | `"org.postgresql.Driver"` | JDBC driver class (required by Micronaut) |
| `ENDPOINTS_ALL_PORT` | `"8080"` | Exposes management endpoints (including `/health`) on port 8080 so startup/liveness probes can reach them |
| `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE` | `"true"` | Prevents Flyway failure on Cloud SQL's pre-populated public schema |
| `FLYWAY_DATASOURCES_POSTGRES_BASELINE_VERSION` | `"0"` | Baselines at v0, then applies all Kestra migrations |

> **DATASOURCES_POSTGRES_URL, DATASOURCES_POSTGRES_USERNAME, DATASOURCES_POSTGRES_PASSWORD**: These are **not** set by `Kestra_Common`. They are constructed at container startup by `entrypoint.sh` from the platform-injected `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` variables. Do not set them in `environment_variables`.

---

## 6. Initialization Job

When `initialization_jobs` is empty (the default), `Kestra_Common` automatically defines a single bootstrap job:

| Field | Value |
|---|---|
| `name` | `"db-init"` |
| `description` | `"Create Kestra Database and User"` |
| `image` | `"postgres:15-alpine"` |
| `execute_on_apply` | `true` |
| `script_path` | `abspath("${path.module}/scripts/db-init.sh")` |
| `cpu_limit` | `"1000m"` |
| `memory_limit` | `"512Mi"` |
| `timeout_seconds` | `600` |

The `db-init.sh` script:
1. Detects the Cloud SQL socket or TCP host.
2. Waits for PostgreSQL to be ready.
3. Creates the Kestra database user (or updates the password if it exists).
4. Creates the Kestra database (or updates the owner if it exists).
5. Grants all necessary privileges on the database and public schema.
6. Resets the public schema on fresh deployments (no Flyway history) so that Flyway can run all 52 Kestra migrations cleanly, bypassing the Cloud SQL extension objects that would otherwise fail the "non-empty schema" check.
7. Signals the Cloud SQL Auth Proxy to shut down via `http://127.0.0.1:9091/quitquitquit`.

When `initialization_jobs` is provided by the caller, the custom jobs replace the default `db-init` job entirely.

---

## 7. Scripts Directory

`Kestra_Common` ships three files in `scripts/`:

| File | Purpose |
|---|---|
| `Dockerfile` | Wraps `kestra/kestra:latest`. Installs `socat`, copies `entrypoint.sh`, and sets it as the container entrypoint. Exposes port `8080`. |
| `entrypoint.sh` | Bridges the Cloud SQL Unix socket to TCP `127.0.0.1:5432` using `socat` (required for Java JDBC). Constructs `DATASOURCES_POSTGRES_URL`, `DATASOURCES_POSTGRES_USERNAME`, and `DATASOURCES_POSTGRES_PASSWORD` from platform `DB_*` variables. Launches `kestra server standalone`. |
| `db-init.sh` | Bootstrap job script — see §6. |

> **Socket bridge detail**: Cloud Run's Cloud SQL Auth Proxy creates a Unix socket at `${DB_HOST}/.s.PGSQL.5432`. Java JDBC cannot connect via Unix socket, so `entrypoint.sh` uses `socat` to expose the socket as TCP on `127.0.0.1:5432`. A symlink (`/tmp/cloudsql.sock`) is created first because `socat` uses colons as delimiters and the Cloud SQL socket path contains colons (the connection name). On GKE, the Cloud SQL Auth Proxy sidecar already listens on TCP `127.0.0.1:5432`, so the bridge logic is skipped.

---

## 8. Input Variables

All variables are passed in by the wrapper modules (`Kestra_CloudRun` and `Kestra_GKE`). `Kestra_Common` is not intended to be called directly by end users.

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | *(required)* | GCP project ID. |
| `resource_prefix` | string | *(required)* | Naming prefix for all resources. Computed by the wrapper as `app<app_name><tenant_id><random_id>`. |
| `labels` | map(string) | `{}` | Labels applied to created resources. |
| `tenant_deployment_id` | string | `"demo"` | Tenant identifier suffix. |
| `deployment_id` | string | `""` | Random deployment ID suffix. |
| `deployment_region` | string | `"us-central1"` | Region for the GCS storage bucket. |
| `application_name` | string | `"kestra"` | Application name. |
| `application_version` | string | `"latest"` | Container image version tag. |
| `display_name` | string | `"Kestra Data Orchestration"` | Human-readable display name. |
| `description` | string | `"Kestra is an open-source data orchestration and scheduling platform"` | Application description. |
| `db_name` | string | `"kestra"` | PostgreSQL database name. |
| `db_user` | string | `"kestra"` | PostgreSQL user name. |
| `cpu_limit` | string | `"2000m"` | CPU limit per container. |
| `memory_limit` | string | `"4Gi"` | Memory limit per container. Kestra (Java) requires at least 2Gi. |
| `min_instance_count` | number | `1` | Minimum instance count. |
| `max_instance_count` | number | `3` | Maximum instance count. |
| `startup_probe` | object | *(HTTP `/health`, 30s delay, 20s period, 40 retries)* | Startup probe configuration. |
| `liveness_probe` | object | *(HTTP `/health`, 180s delay, 30s period, 5 retries)* | Liveness probe configuration. |
| `environment_variables` | map(string) | `{}` | Additional env vars merged over the defaults. |
| `enable_cloudsql_volume` | bool | `true` | Whether to mount the Cloud SQL Auth Proxy sidecar. |
| `initialization_jobs` | list(any) | `[]` | Custom initialization jobs. Replaces the default `db-init` job when non-empty. |
| `service_url` | string | `""` | Predicted service URL injected by the wrapper module. |
| `db_host` | string | `null` | Database host. Defaults to `/cloudsql` when `enable_cloudsql_volume` is true. |
| `enable_image_mirroring` | bool | `true` | Mirror the container image into Artifact Registry. |
| `gcs_volumes` | list(object) | `[]` | GCS Fuse volume mounts. |

---

## 9. Platform-Specific Differences

| Aspect | Cloud Run (`Kestra_CloudRun`) | GKE (`Kestra_GKE`) |
|---|---|---|
| **Socket bridge** | `entrypoint.sh` bridges Unix socket → TCP via `socat` | Cloud SQL Auth Proxy sidecar listens on TCP `127.0.0.1:5432` directly — bridge logic skipped |
| **`enable_cloudsql_volume` wired** | Passed as-is; controls Cloud Run Cloud SQL sidecar annotation | Passed as-is; controls Cloud SQL Auth Proxy sidecar injection into the pod |
| **Service URL** | Pre-computed HTTPS URL: `https://<resource_prefix>-<project_number>.<region>.run.app` | Pre-computed internal DNS: `http://<service_name>.<namespace>.svc.cluster.local` |
| **`secret_values` usage** | Passed as `module_explicit_secret_values` to App_CloudRun | Passed as `explicit_secret_values` to App_GKE for direct Kubernetes Secret injection |
| **Scripts directory** | `abspath("${module.kestra_app.path}/scripts")` | `abspath("${module.kestra_app.path}/scripts")` |
| **`kestra.tf` extras** | Passes `container_port` override | Also passes `enable_cloudsql_volume` override in `kestra_module` merge |
