---
title: "Wiki.js Common Shared Configuration Module"
sidebar_label: "Common"
---

# Wikijs_Common Module

## Overview

`Wikijs_Common` is a pure-configuration Terraform module in the RAD Modules ecosystem. It generates a `config` object consumed by platform modules (`App_CloudRun`, `App_GKE`) to deploy Wiki.js — an open-source Node.js wiki platform — on Google Cloud.

Unlike every other `*_Common` module, **Wikijs_Common creates zero GCP resources**. There are no Secret Manager secrets, no IAM bindings, no service enablement. The module consists entirely of `locals` and `output` blocks. Consequently, no `project_id` variable is required.

The database password is not generated here; it is managed by the platform layer (`App_CloudRun`/`App_GKE`) and referenced symbolically as `"database_password_secret"` in the `secret_environment_variables` map, which the platform resolves to the actual secret ID at runtime.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Wikijs_Common (Layer 1)                             │
│                                                                              │
│  Inputs: application_name, db_name, db_user, environment_variables, ...     │
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐    │
│  │  GCP Resources       │    │  Config Output (consumed by Layer 2)    │    │
│  │                      │    │                                         │    │
│  │  (none)              │    │  container_image: "requarks/wiki:2"     │    │
│  │                      │    │  container_port: 3000                   │    │
│  │                      │    │  database_type: POSTGRES_15             │    │
│  │                      │    │  enable_postgres_extensions: true       │    │
│  │                      │    │  postgres_extensions: ["pg_trgm"]       │    │
│  │  GCS Bucket          │    │  secret_environment_variables:          │    │
│  │   wikijs-storage     │    │    DB_PASS → "database_password_secret" │    │
│  │  (created by         │    │  HA_STORAGE_PATH: "/wiki-storage"       │    │
│  │   Layer 2)           │    │  initialization_jobs: [db-init]         │    │
│  │                      │    │  startup_probe: HTTP /healthz 60s       │    │
│  └──────────────────────┘    │  liveness_probe: HTTP /healthz 60s      │    │
│                              └─────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        App_CloudRun / App_GKE (Layer 2)
        (resolves "database_password_secret" → actual Secret Manager ID)
```

---

## GCP Resources Created

**None.** This module creates no GCP resources. All outputs are derived from input variables and local expressions.

**GCS Bucket** (defined in `storage_buckets` output, created by Layer 2):

| Bucket Suffix | Location | Purpose |
|---------------|----------|---------|
| `wikijs-storage` | `deployment_region` | Wiki.js asset storage and uploads |

---

## Module Outputs

| Output | Type | Description |
|--------|------|-------------|
| `config` | object | Full application configuration for App_CloudRun/App_GKE |
| `storage_buckets` | list(object) | One bucket spec: `wikijs-storage` |
| `path` | string | Absolute path to this module directory |

There are no `secret_ids` or `secret_values` outputs — this module creates no secrets.

---

## Input Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | string | `"wikijs"` | Application name |
| `application_version` | string | `"2.5.311"` | Wiki.js version tag |
| `display_name` | string | `"Wiki.js"` | Human-readable display name |
| `db_name` | string | `"wikijs"` | PostgreSQL database name |
| `db_user` | string | `"wikijs"` | PostgreSQL database user |
| `cpu_limit` | string | `"1000m"` | CPU limit |
| `memory_limit` | string | `"2Gi"` | Memory limit (higher than most — Chromium/Puppeteer) |
| `min_instance_count` | number | `1` | Minimum instances (stays warm) |
| `max_instance_count` | number | `3` | Maximum instances |
| `deployment_region` | string | `"us-central1"` | Region for the GCS bucket |
| `tenant_deployment_id` | string | `"demo"` | Tenant identifier |
| `deployment_id` | string | `""` | Deployment identifier |
| `enable_cloudsql_volume` | bool | `true` | Enable Cloud SQL Auth Proxy sidecar |
| `gcs_volumes` | list(any) | `[]` | GCS Fuse volumes (passed through to config) |
| `environment_variables` | map(string) | `{}` | Additional environment variables (merged with module defaults) |
| `secret_environment_variables` | map(string) | `{}` | Additional secret env var references (merged with `DB_PASS` default) |
| `initialization_jobs` | list(any) | `[]` | Override default jobs (empty = use `db-init`) |
| `startup_probe` | object | HTTP `/healthz`, 60s delay | Startup probe config |
| `liveness_probe` | object | HTTP `/healthz`, 60s delay | Liveness probe config |

> **No `project_id` variable:** Wikijs_Common requires no GCP project reference because it creates no GCP resources.

---

## Environment Variables

The module merges caller-supplied `environment_variables` with the following defaults:

| Variable | Value | Purpose |
|----------|-------|---------|
| `DB_TYPE` | `"postgres"` | Database engine selector |
| `DB_PORT` | `"5432"` | PostgreSQL port |
| `DB_USER` | `var.db_user` | Database user |
| `DB_NAME` | `var.db_name` | Database name |
| `DB_SSL` | `"false"` | Disable SSL (Cloud SQL Auth Proxy handles encryption) |
| `HA_STORAGE_PATH` | `"/wiki-storage"` | High-availability shared storage path |

`HA_STORAGE_PATH` is set to `/wiki-storage` to support multi-instance deployments where Wiki.js needs a shared location for sideload modules and assets. This path should be backed by NFS or GCS Fuse in production.

## Secret Environment Variables

The `config.secret_environment_variables` map carries:

| Variable | Reference | Description |
|----------|-----------|-------------|
| `DB_PASS` | `"database_password_secret"` | Symbolic reference resolved by App_CloudRun/App_GKE to the actual database password Secret ID |

Callers may inject additional secret references via `var.secret_environment_variables`, which are merged on top of this default.

---

## PostgreSQL Extension

| Extension | Purpose |
|-----------|---------|
| `pg_trgm` | Trigram-based full-text search — powers Wiki.js page search and fuzzy matching |

`enable_postgres_extensions = true` instructs the platform layer to run the extension creation statement as a superuser before the application connects.

---

## Initialization Job: `db-init`

| Property | Value |
|----------|-------|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| `execute_on_apply` | `true` |
| `max_retries` | 1 |
| Timeout | 600s |
| Secret env vars | `ROOT_PASSWORD = "database_password_secret"`, `DB_PASSWORD = "database_password_secret"` |

Both `ROOT_PASSWORD` and `DB_PASSWORD` are bound to the same platform-managed secret (`database_password_secret`). This is because Cloud SQL's root user password and the application user password are set to the same value in the platform layer.

**`db-init.sh` flow:**

1. Detects Cloud SQL Unix socket under `/cloudsql`, symlinks to `/tmp/.s.PGSQL.5432`, sets `DB_HOST=/tmp`
2. Resolves target host (`DB_IP` → `DB_HOST` fallback)
3. Waits for PostgreSQL with `pg_isready`
4. Creates/updates user with `CREATE USER … WITH PASSWORD` or `ALTER USER … WITH PASSWORD`
5. Grants `"$DB_USER" TO postgres` (required for Cloud SQL where postgres is not a true superuser)
6. Creates database with `CREATE DATABASE … OWNER "$DB_USER"` or updates owner if it exists
7. Grants all privileges on database and public schema
8. Signals Cloud SQL Auth Proxy shutdown via `POST http://127.0.0.1:9091/quitquitquit` (30 retries, 2s intervals)

---

## Container Image

The module wraps the official `requarks/wiki:2` image with Chromium and a custom entrypoint.

```
Base: requarks/wiki:2 (official Wiki.js image, Alpine-based)

Additional packages (as root):
  - chromium
  - nss
  - freetype
  - harfbuzz
  - ca-certificates
  - ttf-freefont

Environment variables:
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

Entrypoint: /scripts/entrypoint.sh  (custom)
CMD:        ["node", "server"]
User:       1000 (wiki)
```

Chromium is installed for **PDF export** — Wiki.js uses Puppeteer to render pages to PDF via a headless Chromium instance. `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` prevents Puppeteer from attempting to download its own Chromium bundle during `npm install`, pointing it to the system-installed binary instead.

No `tini` is used — `requarks/wiki:2` manages its own process lifecycle.

---

## `entrypoint.sh`

A thin wrapper that maps platform-standard variable names to Wiki.js's expected names before starting the server:

1. **`DB_PASSWORD` → `DB_PASS`:** Wiki.js reads `DB_PASS`; the platform injects `DB_PASSWORD`. Maps only if `DB_PASS` is not already set.
2. **`DB_IP` → `DB_HOST`:** Maps only if `DB_HOST` is not already set.
3. **Unix socket detection:** Logs the Unix socket path when `DB_HOST` starts with `/`. Unlike other modules, no symlink is created — Wiki.js's underlying PostgreSQL driver (`pg`) resolves the socket file at `$DB_HOST/.s.PGSQL.$DB_PORT` automatically when given a directory path.
4. **`exec "${@:-node server}"`** — passes the CMD (`node server`) through, or any override.

---

## Platform-Specific Differences

| Aspect | Wikijs_CloudRun | Wikijs_GKE |
|--------|-----------------|------------|
| `service_url` | Computed Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | Optional (Auth Proxy sidecar, default `true`) | Optional (Auth Proxy sidecar, default `true`) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path (resolved natively by `pg` driver) | Cloud SQL private IP |
| NFS / shared storage | GCS Fuse via `gcs_volumes` (`HA_STORAGE_PATH = /wiki-storage`) | GCS Fuse or NFS mount via `gcs_volumes` |
| Redis | Not supported | Not supported |
| Clustering | Multi-instance ready via `HA_STORAGE_PATH` shared storage | Multi-instance ready via `HA_STORAGE_PATH` shared storage |
| `DB_PASS` secret | Symbolic reference `"database_password_secret"` resolved by `App_CloudRun` | Symbolic reference resolved by `App_GKE` |

---

## Usage Example

```hcl
module "wikijs_common" {
  source = "./modules/Wikijs_Common"

  deployment_region    = "us-central1"
  tenant_deployment_id = "prod"
  application_version  = "2.5.311"

  environment_variables = {
    WIKI_ADMIN_EMAIL = "admin@example.com"
  }
}

module "wikijs_cloudrun" {
  source = "./modules/App_CloudRun"

  config          = module.wikijs_common.config
  storage_buckets = module.wikijs_common.storage_buckets
  # No secret_ids to wire — platform handles DB_PASS automatically
}
```

### Config Preset Files

The module ships three example `.tfvars` files in `config/` as deployment starting points:

| File | Description |
|------|-------------|
| `config/basic.tfvars` | Minimal single-instance configuration |
| `config/advanced.tfvars` | Production-ready multi-instance with Redis and NFS |
| `config/custom.tfvars` | Template for custom deployments |
