---
title: "Cal_Common"
sidebar_label: "Cal Common"
---

# Cal_Common

This document provides a reference for the `modules/Cal_Common` Terraform module. `Cal_Common` is the shared application configuration module for Cal.diy deployments. It is called by both `Cal_CloudRun` and `Cal_GKE` — never deployed directly.

---

## 1. Module Overview

`Cal_Common` serves as the application-specific configuration layer for Cal.diy. It performs the following functions:

1. **Generates application secrets** — `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` — using `random_password` and stores them in Secret Manager.
2. **Assembles the `config` output** consumed by the Foundation Module (`App_CloudRun` or `App_GKE`) via `application_config`.
3. **Defines the default `db-init` Kubernetes/Cloud Run Job** using `postgres:15-alpine` and the `db-init.sh` script from `Cal_Common/scripts/`.
4. **Exposes the `path` output** so the Application Module can resolve `scripts_dir` to the correct absolute path.

`Cal_Common` does **not** provision any GCP compute resources (no Cloud Run service, no GKE workload). It only creates Secret Manager secrets and assembles output objects consumed downstream.

---

## 2. Secrets Created

| Secret ID Pattern | Description |
|---|---|
| `<application_name>-<deployment_id>-nextauth-secret` | 32-character alphanumeric `NEXTAUTH_SECRET` for NextAuth.js. |
| `<application_name>-<deployment_id>-encryption-key` | 32-character alphanumeric `CALENDSO_ENCRYPTION_KEY` for Cal.diy data encryption. |

Both secrets are created with `replication { auto {} }` (automatic multi-region replication). A `time_sleep` of 30 seconds is inserted after creating both secrets before the module outputs are available. This prevents race conditions when the Cloud Run service or GKE pod first reads the secrets at startup.

---

## 3. Outputs

### `config`

The primary output consumed by Application Modules. Contains the following fields:

| Field | Value |
|---|---|
| `app_name` | `var.application_name` |
| `container_image` | `"calcom/cal.com"` (base image name for Cloud Build) |
| `application_version` | `var.application_version` |
| `enable_image_mirroring` | `var.enable_image_mirroring` |
| `image_source` | `"custom"` (always — Cal.diy requires a Cloud Build step to bake the URL into static chunks) |
| `container_build_config` | `{ enabled=true, dockerfile_path="Dockerfile", context_path=".", build_args={ APP_VERSION = var.application_version } }` |
| `container_port` | `3000` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | `var.db_name` |
| `db_user` | `var.db_user` |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | `var.gcs_volumes` |
| `container_resources` | `{ cpu_limit=var.cpu_limit, memory_limit=var.memory_limit, ... }` |
| `min_instance_count` | `var.min_instance_count` |
| `max_instance_count` | `var.max_instance_count` |
| `environment_variables` | `var.environment_variables` |
| `secret_environment_variables` | `var.secret_environment_variables` |
| `enable_mysql_plugins` | `false` |
| `mysql_plugins` | `[]` |
| `initialization_jobs` | Default `db-init` job (when `var.initialization_jobs = []`), or the user-supplied list. |
| `startup_probe` | `var.startup_probe` |
| `liveness_probe` | `var.liveness_probe` |
| `readiness_probe` | `{ enabled=true, type="HTTP", path="/api/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=10, failure_threshold=3 }` |

### `secret_ids`

Map of environment variable names to Secret Manager secret IDs:

```hcl
{
  NEXTAUTH_SECRET         = "<application_name>-<deployment_id>-nextauth-secret"
  CALENDSO_ENCRYPTION_KEY = "<application_name>-<deployment_id>-encryption-key"
}
```

This map is passed directly as `module_secret_env_vars` to the Foundation Module and injected into the container at runtime.

### `storage_buckets`

Returns an empty list `[]`. Cal.diy does not require dedicated application storage buckets beyond what the Application Module's `storage_buckets` variable provides.

### `path`

Returns `path.module` — the absolute path to the `Cal_Common` module directory. Used by Application Modules to resolve `scripts_dir`:

```hcl
scripts_dir = abspath("${module.cal_app.path}/scripts")
```

---

## 4. Default Initialization Job

When `initialization_jobs = []` (the default), `Cal_Common` synthesises a single `db-init` job:

| Field | Value |
|---|---|
| `name` | `"db-init"` |
| `description` | `var.description` |
| `image` | `"postgres:15-alpine"` |
| `timeout_seconds` | `600` |
| `max_retries` | `1` |
| `task_count` | `1` |
| `execute_on_apply` | `true` |
| `script_path` | `abspath("${path.module}/scripts/db-init.sh")` |

The `db-init.sh` script connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket and performs idempotent setup (create database, user, grant privileges).

To replace the default job, pass a non-empty `initialization_jobs` list to the Application Module.

---

## 5. Default Probe Configuration

`Cal_Common` sets generous startup probe defaults to accommodate Cal.diy's first-boot operations:

**Startup probe defaults** (when not overridden):

| Field | Value | Rationale |
|---|---|---|
| `initial_delay_seconds` | `180` | Allows time for `replace-placeholder.sh` (~2.5 min on Cloud Run). |
| `timeout_seconds` | `10` | Health endpoint may be slow during migration. |
| `period_seconds` | `10` | Poll every 10 seconds. |
| `failure_threshold` | `18` | Up to 180 seconds after initial delay = 6 minutes total window. |

**Liveness probe defaults:**

| Field | Value |
|---|---|
| `initial_delay_seconds` | `120` |
| `timeout_seconds` | `5` |
| `period_seconds` | `30` |
| `failure_threshold` | `3` |

**Readiness probe** (hardcoded, not user-configurable via `Cal_Common`):
- `path = "/api/health"`, `initial_delay_seconds = 30`, `period_seconds = 10`, `failure_threshold = 3`.

---

## 6. Variables

`Cal_Common` accepts the following variables, which are passed to it by the Application Module:

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | `""` | GCP project ID. |
| `application_name` | `string` | `"cal"` | Application name. Used in secret IDs. |
| `deployment_id` | `string` | `""` | Deployment ID suffix. Used in secret IDs. |
| `application_version` | `string` | `"v6.2.0"` | Container image version tag. |
| `db_name` | `string` | `"calcom"` | PostgreSQL database name. |
| `db_user` | `string` | `"calcom"` | PostgreSQL database user. |
| `enable_cloudsql_volume` | `bool` | `true` | Included in the `config` output. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volumes included in the `config` output. |
| `cpu_limit` | `string` | `"2000m"` | CPU limit for `container_resources` in the `config` output. |
| `memory_limit` | `string` | `"2Gi"` | Memory limit for `container_resources` in the `config` output. |
| `environment_variables` | `map(string)` | `{}` | Additional env vars merged into the `config` output. |
| `secret_environment_variables` | `map(string)` | `{}` | Additional secret references merged into the `config` output. |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs. Empty = use default `db-init` job. |
| `description` | `string` | `"Initialize Cal.com database with PostgreSQL settings"` | Description attached to the default `db-init` job. |
| `startup_probe` | `object` | (see §5) | Startup probe config. |
| `liveness_probe` | `object` | (see §5) | Liveness probe config. |
| `enable_image_mirroring` | `bool` | `false` | Image mirroring flag included in the `config` output. |
| `min_instance_count` | `number` | `0` | Minimum instances in the `config` output. |
| `max_instance_count` | `number` | `3` | Maximum instances in the `config` output. |
| `region` | `string` | `"us-central1"` | GCP region (passed to GKE variant). |

---

## 7. Scripts

`Cal_Common/scripts/` contains the following:

| Script | Purpose |
|---|---|
| `db-init.sh` | Idempotent PostgreSQL setup: creates the database, user, and grants privileges. Executes via the `db-init` Cloud Run Job or Kubernetes Job at first deployment. |
| `Dockerfile` | Custom Docker build file for building a Cal.diy container image via Cloud Build. Bakes `APP_VERSION` as a build argument. |

> The `Dockerfile` is referenced by `container_build_config` in the `config` output when `container_image_source = "custom"`. This is always set to `"custom"` by `Cal_Common`, meaning the Application Module must override `container_image_source = "prebuilt"` in the local merge if the official prebuilt image is preferred.
