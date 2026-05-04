# Odoo_Common Module

## Overview

`Odoo_Common` is a pure-configuration Terraform module in the RAD Modules ecosystem. It generates a `config` object consumed by platform modules (`App_CloudRun`, `App_GKE`) to deploy Odoo Community Edition on Google Cloud. The module provisions one GCP Secret Manager secret (the Odoo master password), defines one GCS storage bucket for custom addons, and emits all container configuration as Terraform outputs — no compute resources are created directly.

Odoo is a comprehensive open-source ERP platform. This module handles its specific requirements: NFS-backed filestore and sessions, Cloud SQL Auth Proxy socket remapping, an inline startup script that auto-generates `odoo.conf` from environment variables, and optional Redis session store support.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Odoo_Common (Layer 1)                               │
│                                                                              │
│  Inputs: project_id, tenant_deployment_id, deployment_id,                   │
│          application_version, enable_redis, ...                              │
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐    │
│  │  GCP Resources       │    │  Config Output (consumed by Layer 2)    │    │
│  │                      │    │                                         │    │
│  │  Secret Manager API  │    │  container_image: "odoo" (custom build) │    │
│  │  master-password     │    │  container_port: 8069                   │    │
│  │    secret (16-char   │    │  container_command: ["/bin/bash", "-c"] │    │
│  │    alphanumeric)     │    │  container_args: [inline startup script]│    │
│  │                      │    │  database_type: POSTGRES_15             │    │
│  │  GCS Bucket          │    │  enable_nfs: true                       │    │
│  │    odoo-addons       │    │  nfs_mount_path: /mnt                   │    │
│  │    (/mnt/extra-      │    │  gcs_volumes: [odoo-addons]             │    │
│  │     addons)          │    │  initialization_jobs: [nfs-init,        │    │
│  │                      │    │                        db-init]         │    │
│  └──────────────────────┘    │  startup_probe: TCP/180s                │    │
│                              │  liveness_probe: HTTP /web/health/120s  │    │
│                              └─────────────────────────────────────────┘    │
│                                                                              │
│  wrapper_prefix = "app{application_name}{tenant_deployment_id}{             │
│                         random_hex}"   (always internal random_id.hex)      │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        App_CloudRun / App_GKE (Layer 2)
        (Cloud Run service, Cloud SQL, NFS, GCS, jobs)
```

**Volume mounts at runtime:**

| Mount | Source | Path | Purpose |
|-------|--------|------|---------|
| NFS | Filestore | `/mnt` | filestore, sessions, odoo.conf, extra-addons |
| GCS Fuse | `odoo-addons` bucket | `/mnt/extra-addons` | Custom/community addons |
| Cloud SQL | Auth Proxy socket | `/cloudsql` | PostgreSQL via Unix socket |

---

## GCP Resources Created

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_project_service` | `secretmanager.googleapis.com` | Enables Secret Manager API before secret creation |
| `random_password` | — | 16-char alphanumeric master password |
| `google_secret_manager_secret` | `{wrapper_prefix}-master-password` | Stores Odoo master/admin password |
| `google_secret_manager_secret_version` | — | Populates the master password secret |

**GCS Bucket** (defined in `storage_buckets` output, created by Layer 2):

| Bucket Suffix | Location | Storage Class | `public_access_prevention` | Purpose |
|---------------|----------|---------------|---------------------------|---------|
| `odoo-addons` | `deployment_region` | `STANDARD` | `inherited` | Custom and community Odoo addons |

> **Note:** `wrapper_prefix` is computed as `"app{application_name}{tenant_deployment_id}{random_hex}"` where `random_hex` is an internally-generated 8-character hex ID (from `random_id.deployment.hex`). The variable `var.deployment_id` is **not** used in the prefix — even when set — because using an externally-supplied value causes plan-time cycles with Secret Manager's immutable `secret_id`. The result is always stable within a given Terraform state. Example: `appodoodemo1a2b3c4d`.

---

## Module Outputs

| Output | Type | Description |
|--------|------|-------------|
| `config` | object | Full application configuration consumed by App_CloudRun/App_GKE |
| `storage_buckets` | list(object) | GCS bucket specifications (one: `odoo-addons`) |
| `path` | string | Absolute path to this module directory |
| `odoo_master_pass_secret_id` | string | Secret Manager secret ID for the master password |
| `odoo_master_pass_secret_value` | string (sensitive) | Plaintext master password value |

The `config` object contains all fields required by the platform module including `container_command`, `container_args`, `startup_probe`, `liveness_probe`, `gcs_volumes`, and `initialization_jobs`.

---

## Input Variables

### Section 1: Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | string | — | GCP project ID (required) |
| `tenant_deployment_id` | string | `"demo"` | Unique tenant identifier, used in resource naming |
| `deployment_id` | string | `""` | Unique deployment identifier |
| `deployment_region` | string | `"us-central1"` | GCP region for GCS bucket and secrets |
| `common_labels` | map(string) | `{}` | Labels applied to all GCP resources |

### Section 2: Application Details

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_version` | string | `"18.0"` | Odoo version (maps to nightly .deb URL) |
| `application_name` | string | `"odoo"` | Application name used in resource naming |
| `display_name` | string | `"Odoo Community Edition"` | Human-readable display name |
| `description` | string | `"Odoo ERP System"` | Application description |
| `db_name` | string | `"odoo"` | PostgreSQL database name |
| `db_user` | string | `"odoo"` | PostgreSQL database user |
| `cpu_limit` | string | `"2000m"` | CPU limit for the container |
| `memory_limit` | string | `"4Gi"` | Memory limit for the container |
| `min_instance_count` | number | `0` | Minimum Cloud Run instances |
| `max_instance_count` | number | `3` | Maximum Cloud Run instances |
| `enable_cloudsql_volume` | bool | `true` | Enable Cloud SQL Auth Proxy sidecar |
| `environment_variables` | map(string) | SMTP defaults | Merged into container environment |
| `initialization_jobs` | list(any) | `[]` | Override default jobs (empty = use defaults) |

**Default `environment_variables`:**

```hcl
{
  SMTP_HOST     = ""
  SMTP_PORT     = "25"
  SMTP_USER     = ""
  SMTP_PASSWORD = ""
  SMTP_SSL      = "false"
  EMAIL_FROM    = "odoo@example.com"
}
```

### Section 3: Health Probes

| Variable | Default | Description |
|----------|---------|-------------|
| `startup_probe` | TCP, 180s initial delay, 60s timeout, 120s period, 3 failures | TCP check on container port |
| `liveness_probe` | HTTP `/web/health`, 120s initial delay, 60s timeout, 120s period | HTTP health endpoint |

> **Note:** Odoo uses a **TCP startup probe** (not HTTP) because the HTTP layer is not available until after the database is initialized and the base module installed, which can take several minutes on first boot. The 180s initial delay accommodates this.

### Section 4: Redis (Optional)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_redis` | bool | `false` | Enable Redis session store in odoo.conf |
| `redis_host` | string | `""` | Redis hostname (falls back to `NFS_SERVER_IP` at runtime) |
| `redis_port` | string | `"6379"` | Redis port |

---

## Initialization Jobs

Two default jobs run at deployment time. They execute in order via explicit dependency:

### Job 1: `nfs-init`

| Property | Value |
|----------|-------|
| Image | `alpine:3.19` |
| `needs_db` | `false` (no Cloud SQL proxy injected) |
| `mount_nfs` | `true` |
| `execute_on_apply` | `true` |
| `depends_on_jobs` | `[]` (runs first) |
| Timeout | 1200s |

**Inline command:**
```sh
mkdir -p /mnt/filestore /mnt/sessions /mnt/extra-addons
chown -R 101:101 /mnt/filestore /mnt/sessions /mnt/extra-addons
chmod -R 777 /mnt/filestore /mnt/sessions /mnt/extra-addons
```

Runs as root (no user override) to create NFS directories owned by UID/GID 101 (the `odoo` system user). The `needs_db = false` flag prevents the Cloud SQL Auth Proxy from being injected into this job, since it has no database dependency.

### Job 2: `db-init`

| Property | Value |
|----------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| `needs_db` | `true` |
| `mount_nfs` | `false` |
| `execute_on_apply` | `true` |
| `depends_on_jobs` | `["nfs-init"]` |
| Timeout | 600s |
| Secret env vars | `DB_PASSWORD`, `ROOT_PASSWORD` |

The `db-init` job waits for `nfs-init` to complete before executing. It creates the PostgreSQL database user and database, then signals the Cloud SQL Auth Proxy to shut down via `POST http://127.0.0.1:9091/quitquitquit`.

**`db-init.sh` flow:**
1. DNS resolution check for public database hosts (skipped for Unix sockets)
2. TCP connectivity check with `nc` (30 retries, 2s intervals)
3. PostgreSQL readiness check with `pg_isready` (60 retries)
4. Create/update database user with `DB_PASSWORD`
5. Grant `DB_USER` role to `postgres` superuser
6. Create/update database owned by `DB_USER`
7. Grant all privileges on database and public schema
8. Signal Cloud SQL Auth Proxy shutdown

---

## Container Image

The module builds a custom Docker image from `scripts/Dockerfile` using Ubuntu Noble (24.04) as the base.

### Build Args

| Arg | Value |
|-----|-------|
| `ODOO_VERSION` | `var.application_version` (e.g., `18.0`) |

### Dockerfile Summary

```
Base: ubuntu:noble (24.04)

System packages:
  - python3, python3-pip, python3-psycopg2
  - postgresql-client-16
  - wkhtmltopdf (arch-aware: amd64 / arm64 / ppc64le)
  - tini, curl
  - libxml2, libxslt, libldap, libsasl2, ...

Odoo installation:
  - Downloaded from https://nightly.odoo.com/{version}/nightly/deb/
  - Installed as .deb package (not Docker Hub image)
  - Runs as UID/GID 101 (odoo system user)

Scripts copied:
  - cloudrun-entrypoint.sh → /cloudrun-entrypoint.sh
  - entrypoint.sh          → /entrypoint.sh
  - odoo.conf              → /etc/odoo/odoo.conf
  - wait-for-psql.py       → /usr/local/bin/wait-for-psql.py

Note: odoo-gen-config.sh is NOT copied into the Docker image. It exists in
the module's scripts/ directory as a standalone utility for manual config
generation and reference. The container uses the inline startup script
(container_args) to generate odoo.conf at runtime.

Exposed ports: 8069 (HTTP), 8071 (gevent), 8072 (longpolling)

ENTRYPOINT: ["/usr/bin/tini", "--", "/cloudrun-entrypoint.sh"]
CMD:        ["/entrypoint.sh", "odoo", "--http-port=8069"]
```

> **wkhtmltopdf** is installed for PDF report generation (invoices, sales orders, etc.). The Dockerfile detects the host architecture (`uname -m`) and downloads the corresponding binary.

> Odoo is installed from the official nightly `.deb` repository rather than Docker Hub, enabling exact version pinning to any Odoo Community release by changing `application_version`.

---

## Scripts

### `cloudrun-entrypoint.sh`

The primary Cloud Run entrypoint wrapping the standard Odoo entrypoint:

1. Sets `umask 0000` so new filestore subdirectories are world-writable
2. Ensures NFS directories exist (`/mnt/filestore`, `/mnt/sessions`, `/mnt/extra-addons`)
3. Copies `/etc/odoo/odoo.conf` to `/tmp/odoo.conf` if `/etc/odoo/` is read-only
4. Substitutes the `DB_NAME` placeholder in `odoo.conf` with the `DB_NAME` environment variable
5. Sets `ODOO_RC=/tmp/odoo.conf` (or the writable path)
6. `exec "$@"` — delegates to the CMD (`/entrypoint.sh odoo --http-port=8069`)

### `entrypoint.sh`

The upstream Odoo entrypoint script:

1. Reads `PASSWORD_FILE` if set (Docker secret compatibility)
2. Assembles `DB_ARGS` from `/etc/odoo/odoo.conf` or environment variables (`HOST`, `PORT`, `USER`, `PASSWORD`)
3. Calls `wait-for-psql.py` to wait for PostgreSQL availability
4. `exec odoo "$@"` with assembled arguments

### `wait-for-psql.py`

Python 3 / psycopg2 script that polls PostgreSQL until the connection succeeds. Used by `entrypoint.sh` to gate the Odoo process start until the database is reachable.

### `odoo-gen-config.sh`

Standalone utility script in `scripts/` (not baked into the Docker image). Can be used manually for generating a full `/mnt/odoo.conf`. Key settings it produces:

- `workers = 4` (multi-worker production mode)
- `max_cron_threads = 2`
- `proxy_mode = True` (required behind Cloud Run load balancer)
- `addons_path = /usr/lib/python3/dist-packages/odoo/addons,/mnt/extra-addons`
- `data_dir = /mnt/filestore`
- SMTP section appended conditionally if `SMTP_HOST` is set
- Sets ownership `101:101` on the generated file

### `odoo.conf` (template)

Static template baked into the image at `/etc/odoo/odoo.conf`. Contains a `DB_NAME` placeholder that `cloudrun-entrypoint.sh` substitutes at runtime. Key settings in the template:

```ini
[options]
data_dir = /mnt
proxy_mode = True
addons_path = /extra-addons
db_maxconn = 32
db_name = DB_NAME
limit_memory_hard = 1572864000
limit_memory_soft = 1073741824
limit_request = 8192
limit_time_cpu = 600
limit_time_real = 1200
xmlrpc_port = 8069
```

> **Note:** The startup script's inline auto-generated `odoo.conf` (written to `/mnt/odoo.conf`) is more comprehensive than this baked-in template and takes precedence at runtime because Odoo is started with `-c /mnt/odoo.conf`. The baked-in template is only used as a fallback reference.

---

## Startup Script (`container_command` / `container_args`)

Rather than a simple entrypoint, Odoo_Common overrides `container_command` and `container_args` in the `config` output with an inline bash script. This script runs as the container's startup command and handles all first-boot initialization:

1. **Auto-generate `odoo.conf`** if `/mnt/odoo.conf` does not exist — writes a full configuration file from environment variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ODOO_MASTER_PASS`
2. **Append Redis config** to auto-generated conf if `ENABLE_REDIS=true` and a Redis host is available (`REDIS_HOST` or fallback `NFS_SERVER_IP`)
3. **Ensure required NFS directories** exist (`/mnt/filestore`, `/mnt/sessions`, `/mnt/extra-addons`)
4. **Set permissive umask** (`umask 0000`) and `chmod -R 777` on filestore/sessions
5. **Verify write access** to `/mnt/filestore` — exits with diagnostic output if NFS is not writable
6. **Remap Cloud SQL socket** — detects Unix socket under `/cloudsql`, symlinks to `/tmp/.s.PGSQL.5432`, sets `DB_HOST=/tmp`, and updates any existing `odoo.conf` `db_host` line
7. **`exec odoo -c /mnt/odoo.conf -i base`** — starts Odoo; the `-i base` flag triggers database initialization on first run (no-op if already initialized)

This inline approach avoids a separate init container while handling the Cloud SQL socket remapping and NFS validation before Odoo starts.

---

## Redis Support

When `enable_redis = true`, the module sets `ENABLE_REDIS=true` in container environment variables. The startup script checks this flag and appends Redis configuration to `odoo.conf`:

```ini
redis_host = <REDIS_HOST or NFS_SERVER_IP>
redis_port = <REDIS_PORT, default 6379>
```

The `redis_host_final` local is computed at Terraform plan time: if `var.redis_host` is explicitly set it is used directly; otherwise the value is empty and the runtime script falls back to `NFS_SERVER_IP` (the Filestore NFS server IP, which typically co-locates a Redis instance).

---

## Platform-Specific Differences

| Aspect | Odoo_CloudRun | Odoo_GKE |
|--------|---------------|----------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | Optional (Auth Proxy sidecar); default `true` | Optional (Auth Proxy sidecar); default `true` — GKE pods can use either socket or TCP depending on cluster networking |
| `DB_HOST` | Cloud SQL Auth Proxy socket path (remapped to `/tmp`) | Cloud SQL Auth Proxy socket path or Cloud SQL private IP |
| NFS | Mandatory (`enable_nfs = true` hardcoded) | Mandatory (`enable_nfs = true` hardcoded) |
| Init job sequence | `nfs-init` (no DB) → `db-init` (with DB) | `nfs-init` (no DB) → `db-init` (with DB) |
| Redis | Optional; appended to `odoo.conf` at runtime if enabled | Optional; appended to `odoo.conf` at runtime if enabled |
| GCS volumes | `odoo-addons` at `/mnt/extra-addons` | `odoo-addons` at `/mnt/extra-addons` |
| Startup probe | TCP port 8069, 180s initial delay | TCP port 8069, 180s initial delay |

---

## Usage Example

```hcl
module "odoo_common" {
  source = "./modules/Odoo_Common"

  project_id           = var.project_id
  tenant_deployment_id = "prod"
  deployment_id        = random_id.deployment.hex
  deployment_region    = "us-central1"
  application_version  = "18.0"

  cpu_limit    = "4000m"
  memory_limit = "8Gi"

  enable_redis = true
  # redis_host left empty — runtime falls back to NFS_SERVER_IP

  environment_variables = {
    SMTP_HOST     = "smtp.example.com"
    SMTP_PORT     = "587"
    SMTP_USER     = "odoo@example.com"
    SMTP_PASSWORD = var.smtp_password
    SMTP_SSL      = "true"
    EMAIL_FROM    = "odoo@example.com"
  }
}

module "odoo_cloudrun" {
  source = "./modules/App_CloudRun"

  config          = module.odoo_common.config
  storage_buckets = module.odoo_common.storage_buckets
  # ...
}
```

The `odoo_master_pass_secret_id` output can be passed to App_CloudRun as a secret environment variable:

```hcl
secret_env_vars = {
  ODOO_MASTER_PASS = module.odoo_common.odoo_master_pass_secret_id
}
```

