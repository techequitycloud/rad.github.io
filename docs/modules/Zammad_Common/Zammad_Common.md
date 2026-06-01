---
title: "Zammad_Common"
sidebar_label: "Zammad Common"
---

# Zammad_Common

This document provides a reference for the `modules/Zammad_Common` Terraform module. `Zammad_Common` is the shared application-configuration layer used by both `Zammad_CloudRun` and `Zammad_GKE`. It is not deployed directly — it is called as a child module.

---

## Purpose

`Zammad_Common` produces three outputs consumed by the foundation modules (`App_CloudRun` / `App_GKE`):

| Output | Description |
|---|---|
| `config` | Application configuration object: container image, environment variables, probes, DB settings, initialization jobs. |
| `secret_ids` | Map of env var names → Secret Manager secret IDs. Empty for Zammad (`{}`). |
| `storage_buckets` | List of GCS buckets to provision — the `zammad-attachments` bucket. |
| `path` | Absolute path to the `Zammad_Common` module directory. Used to resolve `scripts_dir`. |

---

## Container Image

`Zammad_Common` hardcodes the base image as `zammad/zammad` and sets `enable_image_mirroring = true`. The `container_image_source` is always `'custom'`, meaning Cloud Build builds a custom image from `Zammad_Common/scripts/Dockerfile` before deployment. The Dockerfile extends the official `zammad/zammad` image and replaces the entrypoint with the GCP-specific `entrypoint.sh`.

**Why a custom image?** The official Zammad Docker image expects `POSTGRESQL_*` environment variables directly. The GCP foundation modules inject database credentials as `DB_HOST`, `DB_USER`, `DB_PASSWORD`, etc. The custom `entrypoint.sh` performs this mapping transparently.

---

## Default Environment Variables

`Zammad_Common` sets the following environment variables in the application config, which are injected into every Zammad container:

| Variable | Default Value | Description |
|---|---|---|
| `POSTGRESQL_PORT` | `"5432"` | PostgreSQL TCP port. |
| `RAILS_ENV` | `"production"` | Rails environment. |
| `NODE_ENV` | `"production"` | Node.js environment (for Zammad's front-end assets). |
| `ZAMMAD_RAILSSERVER_HOST` | `"0.0.0.0"` | Bind all interfaces inside the container. |
| `ZAMMAD_RAILSSERVER_PORT` | `"3000"` | Zammad railsserver listen port. |
| `NGINX_SERVER_NAME` | `"_"` | Nginx catch-all server name. |

Additional `environment_variables` passed from the application module are merged on top of these defaults.

---

## Entrypoint Behaviour (`scripts/entrypoint.sh`)

The custom entrypoint performs the following steps on every container start:

1. **Variable mapping:** Maps `DB_*` (Foundation convention) to `POSTGRESQL_*` (Zammad convention). URL-encodes user and password to handle special characters safely in the `postgres://` URI.

2. **Cloud Run TCP workaround:** Zammad's `docker-entrypoint.sh` checks PostgreSQL readiness using a TCP bash socket (`echo > /dev/tcp/"${POSTGRESQL_HOST}"/"${POSTGRESQL_PORT}"`). On Cloud Run, `DB_HOST` is a Unix socket path — not TCP-addressable. The entrypoint uses `DB_IP` (Cloud SQL private IP) instead. On GKE, `DB_HOST = 127.0.0.1` (the Auth Proxy sidecar) which is TCP-addressable — no fallback is needed.

3. **Redis URL construction:** If `REDIS_URL` is not already set and `REDIS_HOST` is present, the entrypoint builds `REDIS_URL` from `REDIS_HOST`, `REDIS_PORT`, and optionally `REDIS_AUTH`.

4. **`zammad-init`:** Runs `/docker-entrypoint.sh zammad-init` — Zammad's DB migration and seed step. This is idempotent: pending migrations are applied, already-run ones are skipped. The `zammad_ready` marker file is written, which the railsserver checks before accepting traffic.

5. **Service start:** Delegates to `/docker-entrypoint.sh "$@"` with the original command arguments.

---

## Initialization Job (`scripts/db-init.sh`)

When `initialization_jobs = []` (default), `Zammad_Common` supplies a single default initialization job:

| Field | Value |
|---|---|
| `name` | `"db-init"` |
| `image` | `postgres:15-alpine` |
| `script_path` | `abspath("${path.module}/scripts/db-init.sh")` |
| `execute_on_apply` | `true` |
| `timeout_seconds` | `600` |
| `max_retries` | `1` |

The `db-init.sh` script creates the Zammad PostgreSQL database and user (idempotently) before the application container starts. It runs as a Cloud Run Job (Cloud Run variant) or Kubernetes Job (GKE variant).

---

## Storage Buckets

`Zammad_Common` always outputs the following storage bucket definition via `storage_buckets`:

```hcl
[
  {
    name_suffix              = "zammad-attachments"
    location                 = var.region
    storage_class            = "STANDARD"
    force_destroy            = true
    versioning_enabled       = false
    lifecycle_rules          = []
    public_access_prevention = "enforced"
  }
]
```

This bucket is provisioned by the foundation module alongside any buckets in `storage_buckets`.

---

## Health Probes

`Zammad_Common` sets default startup and liveness probe configurations targeting `/api/v1/ping`:

**Startup probe:**
```hcl
{
  enabled               = true
  type                  = "HTTP"
  path                  = "/api/v1/ping"
  initial_delay_seconds = 60
  timeout_seconds       = 10
  period_seconds        = 15
  failure_threshold     = 30
}
```

**Liveness probe:**
```hcl
{
  enabled               = true
  type                  = "HTTP"
  path                  = "/api/v1/ping"
  initial_delay_seconds = 60
  timeout_seconds       = 5
  period_seconds        = 30
  failure_threshold     = 3
}
```

**Readiness probe:**
```hcl
{
  enabled               = true
  type                  = "HTTP"
  path                  = "/api/v1/ping"
  initial_delay_seconds = 30
  timeout_seconds       = 5
  period_seconds        = 10
  failure_threshold     = 3
}
```

---

## Variables

`Zammad_Common` accepts the following variables from the calling application module:

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `'zammad'` | Application name for resource naming. |
| `deployment_id` | `string` | `""` | Unique deployment ID. |
| `application_version` | `string` | `'6.4.1'` | Zammad version tag. Used as `APP_VERSION` build arg. |
| `description` | `string` | `'Initialize Zammad helpdesk database schema'` | Description for the default db-init job. |
| `db_name` | `string` | `'zammad'` | PostgreSQL database name. |
| `db_user` | `string` | `'zammad'` | PostgreSQL user. |
| `enable_cloudsql_volume` | `bool` | `true` | Whether the Cloud SQL Auth Proxy volume is present. |
| `gcs_volumes` | `list(object)` | `[]` | GCS volumes to mount via GCS Fuse. |
| `cpu_limit` | `string` | `'2000m'` | CPU limit for container resources. |
| `memory_limit` | `string` | `'4Gi'` | Memory limit for container resources. |
| `environment_variables` | `map(string)` | `{}` | Extra env vars merged into the Zammad container. |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager references merged into the config. |
| `initialization_jobs` | `list(object)` | `[]` | Override initialization jobs. Empty uses the default `db-init` job. |
| `startup_probe` | `object` | (defaults above) | Startup probe configuration. |
| `liveness_probe` | `object` | (defaults above) | Liveness probe configuration. |
| `min_instance_count` | `number` | `1` | Minimum instances/replicas. |
| `max_instance_count` | `number` | `5` | Maximum instances/replicas. |
| `region` | `string` | `'us-central1'` | GCP region for storage bucket location. |

---

## Scripts Directory

The `path` output exposes `path.module`, which is used by the application module to set `scripts_dir`:

```hcl
scripts_dir = abspath("${module.zammad_app.path}/scripts")
```

This ensures initialization job scripts are resolved from the `Zammad_Common/scripts/` directory at apply time, regardless of where the application module is called from.

---

## No Auto-Generated Secrets

`Zammad_Common` returns `secret_ids = {}`. Unlike modules such as Directus or Django, Zammad manages its own internal signing keys at runtime. No `SECRET_KEY_BASE` or equivalent is auto-generated. The DB password and root password are managed by the foundation module.
