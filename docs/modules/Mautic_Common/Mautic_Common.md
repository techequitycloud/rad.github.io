---
title: "Mautic_Common — Internal Configuration Module"
sidebar_label: "Mautic Common"
---

# Mautic_Common — Internal Configuration Module

This document provides a comprehensive reference for the `modules/Mautic_Common` Terraform module. `Mautic_Common` is an **internal shared module** — it is not deployed directly by end users.

---

## 1. Module Overview

`Mautic_Common` centralises all Mautic-specific application configuration in a single module shared by both `Mautic_CloudRun` and `Mautic_GKE`. It creates GCP resources (the admin password secret in Secret Manager) and assembles the `config`, `secret_ids`, and `storage_buckets` outputs consumed by the Foundation Modules.

**Key Responsibilities:**
1. **Secret generation**: Creates `MAUTIC_ADMIN_PASSWORD` in Secret Manager (random 24-character password, no special characters).
2. **`config` assembly**: Builds the full application configuration object — container image, environment variables, database settings, resource limits, probe configuration, and initialization job — forwarded to `App_CloudRun` or `App_GKE` via `application_config`.
3. **`storage_buckets` definition**: Defines the `mautic-media` GCS bucket to be provisioned by the Foundation Module.
4. **`secret_ids` exposure**: Returns `{ MAUTIC_ADMIN_PASSWORD = <secret_id> }` for injection into the Cloud Run/GKE environment via `module_secret_env_vars`.

---

## 2. GCP Resources Created

| Resource | Type | Purpose |
|---|---|---|
| `google_project_service.secretmanager` | Service activation | Ensures Secret Manager API is enabled. |
| `google_secret_manager_secret.mautic_admin_password` | `<prefix>-admin-password` | Stores the Mautic admin password. |
| `google_secret_manager_secret_version.mautic_admin_password` | Secret version | Initial admin password value. |
| `time_sleep.wait_for_secrets` | 30-second delay | Allows Secret Manager global replication before dependent resources proceed. |

> `Mautic_Common` does **not** create Cloud SQL, GCS buckets, NFS, or any compute resources — all infrastructure provisioning is delegated to the Foundation Module (`App_CloudRun` or `App_GKE`).

---

## 3. Outputs

### `config`

The `config` output is a structured object consumed by the Application Module's `application_config` local. Key fields:

| Field | Value | Notes |
|---|---|---|
| `app_name` | `var.application_name` | Used for resource naming. |
| `application_version` | `var.application_version` | Image version tag. |
| `display_name` | `var.display_name` | Human-readable name. |
| `container_image` | `mautic/mautic:<version>-apache` | Official Mautic Apache image. |
| `image_source` | `custom` | Cloud Build is used to extend the base image. |
| `container_build_config.dockerfile_path` | `Dockerfile` | Located in `scripts/`. |
| `container_build_config.context_path` | `abspath("${path.module}/scripts")` | Build context is the `scripts/` directory. |
| `container_build_config.build_args` | `{ APP_VERSION = var.application_version }` | Passed to the Dockerfile. |
| `container_port` | `80` | Mautic/Apache listens on port 80. |
| `database_type` | `MYSQL_8_0` | Fixed — Mautic requires MySQL 8.0. |
| `db_name` | `var.db_name` | MySQL database name. |
| `db_user` | `var.db_user` | MySQL application user. |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` | Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Unix socket mount path. |
| `container_resources.cpu_limit` | `var.cpu_limit` | |
| `container_resources.memory_limit` | `var.memory_limit` | |
| `min_instance_count` | `var.min_instance_count` | |
| `max_instance_count` | `var.max_instance_count` | |
| `environment_variables` | Merged map | See §4. |
| `secret_environment_variables` | Merged map | `MAUTIC_ADMIN_PASSWORD` + caller's secrets. |
| `enable_mysql_plugins` | `false` | Not used by Mautic in this deployment. |
| `mysql_plugins` | `[]` | |
| `initialization_jobs` | Default or caller-provided | See §5. |
| `startup_probe` | `var.startup_probe` | Forwarded from caller. |
| `liveness_probe` | `var.liveness_probe` | Forwarded from caller. |

### `secret_ids`

```hcl
{
  MAUTIC_ADMIN_PASSWORD = google_secret_manager_secret.mautic_admin_password.secret_id
}
```

Returned after the `time_sleep` (30 seconds) to ensure Secret Manager replication is complete.

### `storage_buckets`

```hcl
[
  {
    name_suffix   = "mautic-media"
    location      = var.region
    force_destroy = true
  }
]
```

The Foundation Module provisions this bucket and grants the workload service account read/write access.

### `path`

The absolute filesystem path to the `Mautic_Common` module directory. Used by the Application Module to resolve `scripts_dir`:

```hcl
scripts_dir = abspath("${module.mautic_app.path}/scripts")
```

---

## 4. Environment Variables

`Mautic_Common` injects the following variables into `config.environment_variables`. These are merged with any caller-provided `environment_variables`:

| Variable | Value |
|---|---|
| `MAUTIC_DB_PORT` | `3306` |
| `MAUTIC_ADMIN_EMAIL` | `var.mautic_admin_email` |
| `MAUTIC_ADMIN_LOGIN` | `var.mautic_admin_username` |
| `DOCKER_MAUTIC_ROLE` | `mautic_web` |
| `DOCKER_MAUTIC_RUN_MIGRATIONS` | `true` |
| `MAUTIC_TRUSTED_PROXIES` | `0.0.0.0/0` |
| `MAUTIC_MAILER_FROM_NAME` | `var.mailer_from_name` |
| `MAUTIC_MAILER_FROM_EMAIL` | `var.mailer_from_email` |

**`Mautic_CloudRun` additionally injects (in its `locals` merge):**

| Variable | Value | Reason |
|---|---|---|
| `MAUTIC_SITE_URL` | Predicted Cloud Run service URL | Required for Mautic to generate correct absolute URLs. |
| `HTTPS` | `on` | Tells Apache/PHP that the upstream connection is HTTPS; prevents HTTP→HTTPS redirect loops. |

`MAUTIC_DB_HOST` and `MAUTIC_DB_PASSWORD` are injected by `App_CloudRun`/`App_GKE` from the `db_password_env_var_name = "MAUTIC_DB_PASSWORD"` parameter and the Cloud SQL socket path, respectively.

---

## 5. Default Initialization Job

When `initialization_jobs` is empty (the default), `Mautic_Common` provides the following `db-init` job:

```hcl
{
  name             = "db-init"
  description      = "Create Mautic Database and User"
  image            = "mysql:8.0-debian"
  command          = []
  args             = []
  env_vars         = {}
  secret_env_vars  = {}
  cpu_limit        = "1000m"
  memory_limit     = "512Mi"
  timeout_seconds  = 600
  max_retries      = 3
  task_count       = 1
  execution_mode   = "TASK"
  mount_nfs        = false
  execute_on_apply = true
  script_path      = abspath("${path.module}/scripts/db-init.sh")
}
```

The `db-init` job:
1. Connects to Cloud SQL MySQL via the Auth Proxy Unix socket.
2. Creates the `mautic` database user with the password from Secret Manager.
3. Creates the `mautic` database if it does not exist.
4. Grants the `mautic` user full privileges on the database.

All operations are idempotent — the script uses `CREATE USER IF NOT EXISTS` and `CREATE DATABASE IF NOT EXISTS`.

**Override:** Pass a non-empty `initialization_jobs` list from the Application Module to replace this default entirely.

---

## 6. Health Probe Defaults

Probes are set in `Mautic_Common` and forwarded directly via `var.startup_probe` / `var.liveness_probe`. The Application Module or end user can override them.

| Probe | Default Configuration |
|---|---|
| Startup | `{ enabled=true, type="HTTP", path="/index.php/s/login", initial_delay_seconds=60, timeout_seconds=10, period_seconds=15, failure_threshold=20 }` |
| Liveness | `{ enabled=true, type="HTTP", path="/index.php/s/login", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` |

**Important:** `Mautic_CloudRun` overrides `startup_probe` in its `locals` merge to use `type="TCP"` with `path="/"`. This is because Cloud Run health check traffic arrives over plain HTTP and Apache issues HTTP→HTTPS redirects (301) for HTTP requests, causing HTTP startup probes to never receive a 200 response. TCP probes check only that port 80 is open and are unaffected by application-layer redirects. `Mautic_GKE` retains the HTTP startup probe — GKE probes operate within the pod network and do not trigger the same redirect behaviour.

---

## 7. Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. **Required.** |
| `resource_prefix` | `string` | — | Resource naming prefix (e.g., `appmaticprod1a2b3c4d`). Set by Application Module. |
| `labels` | `map(string)` | `{}` | Labels applied to all resources. |
| `deployment_id` | `string` | `""` | Unique deployment identifier. |
| `application_name` | `string` | `"mautic"` | Application name used in resource naming. |
| `display_name` | `string` | `"Mautic"` | Human-readable name. |
| `description` | `string` | `"Mautic open-source marketing automation platform"` | Application description. |
| `application_version` | `string` | `"5"` | Container image version tag. |
| `tenant_deployment_id` | `string` | `"demo"` | Tenant/environment identifier. |
| `region` | `string` | `"us-central1"` | GCP region for the `mautic-media` storage bucket. |
| `db_name` | `string` | `"mautic"` | MySQL database name. |
| `db_user` | `string` | `"mautic"` | MySQL application username. |
| `cpu_limit` | `string` | `"2000m"` | CPU limit per container instance. |
| `memory_limit` | `string` | `"2Gi"` | Memory limit per container instance. |
| `min_instance_count` | `number` | `1` | Minimum instances. |
| `max_instance_count` | `number` | `3` | Maximum instances. |
| `environment_variables` | `map(string)` | `{}` | Additional plain-text environment variables (merged with Mautic defaults). |
| `secret_environment_variables` | `map(string)` | `{}` | Additional Secret Manager references. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts forwarded to the `config` object. |
| `initialization_jobs` | `list(object)` | `[]` | Custom init jobs. Non-empty list replaces the default `db-init` job entirely. |
| `startup_probe` | `object` | (see §6) | Startup probe configuration. |
| `liveness_probe` | `object` | (see §6) | Liveness probe configuration. |
| `enable_cloudsql_volume` | `bool` | `true` | Enable Cloud SQL Auth Proxy sidecar. |
| `mautic_admin_username` | `string` | `"admin"` | Mautic administrator username. Injected as `MAUTIC_ADMIN_LOGIN`. |
| `mautic_admin_email` | `string` | `"admin@example.com"` | Mautic administrator email. Injected as `MAUTIC_ADMIN_EMAIL`. |
| `mailer_from_name` | `string` | `"Mautic"` | Outgoing email sender display name. |
| `mailer_from_email` | `string` | `"mautic@example.com"` | Outgoing email sender address. |

---

## 8. Scripts Directory

`Mautic_Common/scripts/` contains:

| File | Purpose |
|---|---|
| `Dockerfile` | Extends `mautic/mautic:<version>-apache`. Used by Cloud Build when `container_image_source = 'custom'`. |
| `db-init.sh` | Idempotent MySQL database and user setup script. Creates database, user, and grants privileges. Executed by the `db-init` Cloud Run Job or Kubernetes Job. |
