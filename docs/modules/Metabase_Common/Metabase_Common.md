---
title: "Metabase_Common Module"
sidebar_label: "Metabase Common"
---

# Metabase_Common Module

`Metabase_Common` is the shared application configuration module for Metabase deployments. It is called internally by `Metabase_CloudRun` and `Metabase_GKE` — it is not deployed directly.

---

## Purpose

`Metabase_Common` assembles the four values consumed by the Foundation Modules (`App_CloudRun` and `App_GKE`):

- **`config`** — The application configuration object containing the container image, port, resource limits, database settings, probes, environment variables, and initialization jobs.
- **`storage_buckets`** — Returns an empty list. Metabase does not require dedicated GCS storage — all state is stored in the PostgreSQL application database.
- **`path`** — The filesystem path to this module, used to resolve the `db-init.sh` script path.

> **Note:** Unlike Grafana_Common, Metabase_Common does not expose a `secret_ids` output — `metabase.tf` sets `module_secret_env_vars = {}` directly.

---

## Container Configuration

`Metabase_Common` sets the following fixed values in its `config` output:

| Field | Value | Notes |
|---|---|---|
| `container_image` | `metabase/metabase` | Official Metabase Docker Hub image. |
| `image_source` | `custom` | Cloud Build compiles a custom image with the platform entrypoint script. |
| `container_port` | `3000` | Metabase's Jetty port. Must match `MB_JETTY_PORT`. |
| `database_type` | `POSTGRES_15` | PostgreSQL 15 is required. Fixed — cannot be overridden. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Cloud SQL Auth Proxy Unix socket mount path. |
| `enable_mysql_plugins` | `false` | Not applicable for PostgreSQL. |
| `enable_postgres_extensions` | `false` | Not required for Metabase. |

---

## Fixed Environment Variables

`Metabase_Common` merges the following environment variables into the `config.environment_variables` output. Do not override these in the parent module:

| Variable | Value | Notes |
|---|---|---|
| `MB_JETTY_PORT` | `"3000"` | Metabase Jetty HTTP port. Must match `container_port`. |
| `JAVA_TIMEZONE` | `"UTC"` | JVM timezone. UTC ensures consistent timestamp handling in dashboards. |

---

## Health Probes

Both the startup and liveness probes target `/api/health`. Metabase requires a generous initial delay due to JVM startup time:

| Probe | Path | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|
| Startup | `/api/health` | 120s | 10s | 15 (total tolerance: ~270s) |
| Liveness | `/api/health` | 120s | 30s | 3 |
| Readiness | `/api/health` | 60s | 15s | 3 |

---

## Default Initialization Job

When `initialization_jobs` is empty (the default), `Metabase_Common` provides a default `db-init` job:

| Field | Value |
|---|---|
| `name` | `db-init` |
| `image` | `postgres:15-alpine` |
| `execute_on_apply` | `true` |
| `script_path` | `Metabase_Common/scripts/db-init.sh` |
| `max_retries` | `3` |
| `cpu_limit` | `1000m` |
| `memory_limit` | `512Mi` |

The `db-init.sh` script idempotently creates the Metabase PostgreSQL database and user before Metabase first boots. Override `initialization_jobs` with a non-empty list to replace this default entirely.

---

## Storage Buckets

`Metabase_Common` returns an empty storage buckets list. Metabase stores all application state in PostgreSQL. Add buckets via the `storage_buckets` variable in the parent CloudRun or GKE module if required (e.g., for Metabase Enterprise Edition S3-compatible storage or custom plugin artifacts).

---

## Variables

| Variable | Default | Description |
|---|---|---|
| `application_name` | `'metabase'` | Application name used in resource naming. |
| `deployment_id` | `""` | Unique deployment ID passed from the parent module. |
| `application_version` | `'v0.51.3'` | Metabase version tag for the container build. |
| `db_name` | `'metabase'` | PostgreSQL database name. |
| `db_user` | `'metabase'` | PostgreSQL application user. |
| `enable_cloudsql_volume` | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `cpu_limit` | `'2000m'` | CPU limit for the container. Minimum 1 vCPU; 2 vCPU recommended. |
| `memory_limit` | `'4Gi'` | Memory limit for the container. Minimum 2 Gi for the JVM. |
| `environment_variables` | `{}` | Additional plain-text environment variables. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references. |
| `initialization_jobs` | `[]` | Initialization jobs. Leave empty for the default `db-init` job. |
| `description` | `'Metabase — open-source business intelligence and analytics platform'` | Application description. |
| `startup_probe` | (see above) | Startup probe configuration. |
| `liveness_probe` | (see above) | Liveness probe configuration. |
| `enable_image_mirroring` | `false` | Enable mirroring to Artifact Registry. |
| `min_instance_count` | `1` | Minimum instances. |
| `max_instance_count` | `3` | Maximum instances. |
| `region` | `'us-central1'` | GCP region for resource deployment. |

---

## Scripts

The `Metabase_Common/scripts/` directory contains:
- `db-init.sh` — PostgreSQL initialization script executed by the default `db-init` Cloud Run Job or Kubernetes Job. Creates the Metabase database and user idempotently.
- `Dockerfile` — Docker build context for the custom Metabase image built by Cloud Build.
