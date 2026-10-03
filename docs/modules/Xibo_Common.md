---
title: "Xibo Common Shared Configuration Module"
description: "Shared configuration reference for the Xibo module — application-layer settings consumed by the GKE Autopilot deployment."
---

# Xibo Common Shared Configuration Module

The `Xibo Common` module defines the Xibo digital-signage CMS configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates no GCP resources and produces a `config` output consumed by the platform wrapper module `Xibo GKE`.

## 1. Overview

**Purpose**: To centralise all Xibo-specific configuration — the custom container image built from the official ghcr.io release, MySQL 8.0 database settings, the environment corrections needed behind a TLS-terminating ingress and against Cloud SQL, health probes, and the `db-init` job — in one module.

**Architecture**:

```
Layer 3: Application Wrapper
└── Xibo_GKE  ── instantiates Xibo_Common
                           ↓
              Xibo_Common (this module)
              Creates: (no GCP resources)
              Produces: config, secret_ids, secret_values, storage_buckets, path
                           ↓
Layer 2: Platform Module
└── App_GKE       (Kubernetes deployment)
                           ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

There is no Cloud Run variant: Xibo's media library needs a POSIX filesystem (Apache serves it with XSendFile), which points to a persistent volume on GKE rather than object storage.

**Key characteristics**:
- **Image from ghcr.io, not Docker Hub.** `docker.io/xibosignage/xibo-cms` is abandoned — its newest tag is `release23` (2023-05-07) and Xibo 4.x was never published there.
- **MySQL 8.0** (`database_type = "MYSQL_8_0"`), reached over **TCP** at the instance's private IP.
- **Fully non-interactive install.** Xibo's own entrypoint creates the database if absent and runs the phinx install/upgrade on every boot. There is no schema job.
- **No application secrets.** Xibo's only credential is the database account, which the Foundation creates and injects.
- **Probes are supplied by the wrapper.** `Xibo_GKE` passes its `/login` probes into this module's `startup_probe`/`liveness_probe`.

---

## 2. Outputs

### `config`
The application configuration object passed to `App_GKE` via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `var.application_name` (default `"xibo"`) |
| `application_version` | `var.application_version` (default `"release-4.5.2"`) |
| `display_name` / `description` | `var.display_name` / `var.description` |
| `container_image` | `"ghcr.io/xibosignage/xibo-cms"` |
| `image_source` | `"custom"` |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `true`) |
| `container_build_config` | `enabled = true`, `dockerfile_path = "Dockerfile"`, `context_path = scripts/`, `build_args = { XIBO_VERSION = var.application_version }` — an app-specific argument, so the Foundation's generic `APP_VERSION` cannot override it |
| `container_port` | `80` — Apache; the entrypoint never reads `$PORT` |
| `database_type` | `"MYSQL_8_0"` |
| `db_name` / `db_user` | `var.db_name` / `var.db_user` (default `"xibo"` / `"xibo"`) |
| `enable_cloudsql_volume` | `false` (hardcoded — Xibo connects over TCP) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | `var.gcs_volumes`, normalised |
| `container_resources` | `cpu_limit = var.cpu_limit` (`"1000m"`), `memory_limit = var.memory_limit` (`"2Gi"`), requests `null` |
| `min_instance_count` / `max_instance_count` | `var.min_instance_count` (`1`) / `var.max_instance_count` (`3`) |
| `environment_variables` | Module defaults (see §4) merged with `var.environment_variables` |
| `secret_environment_variables` | `var.secret_environment_variables` |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` |
| `initialization_jobs` | Default `db-init` job, or `var.initialization_jobs` when non-empty — see §5 |
| `startup_probe` / `liveness_probe` | `var.startup_probe` / `var.liveness_probe` — see §6 |

### `secret_ids`
`{}` — no application secrets.

### `secret_values` (sensitive)
`{}`.

### `storage_buckets`
One bucket: `name_suffix = "storage"`, `STANDARD`, `force_destroy = true`, versioning off, `public_access_prevention = "enforced"`. `Xibo_GKE` forwards it as `module_storage_buckets`, so it is created alongside the wrapper's own default `data` bucket. Xibo does not read or write it.

### `path`
The module directory, used by the wrapper to locate `scripts/`.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"xibo"` | Application name. |
| `application_version` | `string` | `"release-4.5.2"` | Image tag on `ghcr.io/xibosignage/xibo-cms`. The wrapper's value wins. Pin an exact release. |
| `display_name` | `string` | `"Xibo CMS"` | Display name. (`Xibo_GKE` passes its own `application_display_name`, whose default is `"Wiki.js"`.) |
| `description` | `string` | `"Xibo — open-source digital signage CMS: layouts, playlists, scheduling and media distribution to player devices."` | Description. |
| `db_name` | `string` | `"xibo"` | MySQL database name. |
| `db_user` | `string` | `"xibo"` | MySQL user. |
| `cpu_limit` | `string` | `"1000m"` | CPU limit. |
| `memory_limit` | `string` | `"2Gi"` | Memory limit. |
| `min_instance_count` | `number` | `1` | Minimum replicas. |
| `max_instance_count` | `number` | `3` | Maximum replicas. |
| `php_memory_limit` | `string` | `"512M"` | `CMS_PHP_MEMORY_LIMIT` and `CMS_PHP_CLI_MEMORY_LIMIT`. Not exposed by `Xibo_GKE`; override through `environment_variables`. |
| `environment_variables` | `map(string)` | `{}` | Merged **over** the module defaults. |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager references. |
| `enable_image_mirroring` | `bool` | `true` | Mirror the image into Artifact Registry. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse mounts. Not suitable for the library. |
| `initialization_jobs` | `list(object)` | `[]` | Custom jobs; empty uses `db-init`. |
| `startup_probe` / `liveness_probe` | `object` | see §6 | Container probes. |

### Declared but unused

`project_id`, `resource_prefix`, `labels`, `deployment_id_suffix`, `service_url`, `admin_username`, `admin_email`, `tenant_id` (validated, not otherwise used), `region`, `enable_cloudsql_volume` (the config hardcodes `false`) and `enable_gcs_storage_volume` are declared for interface consistency but not read by `main.tf`. `admin_username` does not create or rename an account: the image seeds a fixed `xibo_admin` user on first install.

---

## 4. Environment Variables

### Set in `config.environment_variables`

| Variable | Value | Purpose |
|---|---|---|
| `MYSQL_PORT` | `"3306"` | Database port. |
| `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` | `"false"` | The image ships `true` with `MYSQL_ATTR_SSL_CA=none` — verification demanded with no CA to verify against — so PDO refuses the connection as shipped. Cloud SQL over the private IP presents no certificate the container can verify; the VPC private range is the boundary protecting this traffic. |
| `CMS_PHP_COOKIE_SECURE` | `"On"` | The image ships `Off`. The ingress terminates TLS and the container only sees HTTP, so it would never set this itself. |
| `CMS_PHP_MEMORY_LIMIT` | `var.php_memory_limit` (`"512M"`) | The shipped 2G upload limit paired with a 256M PHP memory limit fails on large layout imports. |
| `CMS_PHP_CLI_MEMORY_LIMIT` | `var.php_memory_limit` | Same, for PHP CLI. |

### Set by `scripts/entrypoint.sh` at start-up

| Variable | Value |
|---|---|
| `MYSQL_HOST` | `$DB_IP` — the private IP. `DB_HOST` may be a socket directory, which Xibo cannot use. |
| `MYSQL_PORT` | `${DB_PORT:-3306}` |
| `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | `$DB_NAME` / `$DB_USER` / `$DB_PASSWORD` |
| `CMS_SERVER_NAME` | Only when unset or `localhost`: the host of the first of `CLOUDRUN_SERVICE_URL`, `GKE_SERVICE_URL`, `SERVICE_URL` that is set, with `http://`/`https://` stripped. |

The entrypoint exits immediately if `DB_IP`, `DB_NAME`, `DB_USER` or `DB_PASSWORD` is unset, prints a `[startup]` line with the database endpoint, `server_name` and `XMR_HOST`, then `exec`s the vendor `/entrypoint.sh`. It notes that without Xibo's XMR companion (not deployed by this module) players **poll** rather than receive pushed updates.

---

## 5. Initialization Job

One `db-init` job runs by default (when `initialization_jobs = []`):

| Field | Value |
|---|---|
| Image | `mysql:8.0-debian` |
| Script | `scripts/db-init.sh` |
| Secrets required | `DB_PASSWORD`, `ROOT_PASSWORD` (both injected by the Foundation; also read from `/mnt/secrets-store/` when the CSI mount is present) |
| `execute_on_apply` | `true` |
| CPU / Memory | `1000m` / `512Mi` |
| Timeout / retries | 600s / 3 |

`db-init.sh` behaviour:
1. Uses a Cloud SQL Unix socket if one appears under `/cloudsql` within 30 seconds; otherwise connects over TCP to `DB_IP` (or a non-socket `DB_HOST`), waiting for port 3306.
2. Adds `--get-server-public-key` on TCP so Cloud SQL MySQL 8's `caching_sha2_password` default works.
3. Creates the application user if absent and (re)sets its password to `DB_PASSWORD`.
4. Creates the database if absent and grants the user all privileges on it.
5. Verifies the application user can connect (which also primes the `caching_sha2_password` cache).
6. Asks any Cloud SQL Proxy sidecar to exit (`/quitquitquit`, then `SIGKILL`) so the Job completes.

Xibo then installs its schema itself on first boot. Overriding `initialization_jobs` with a non-empty list replaces this job; custom jobs default to a 1200s timeout.

---

## 6. Health Probes

| Probe | `Xibo_Common` default | As deployed by `Xibo_GKE` (wrapper default) |
|---|---|---|
| Startup | HTTP `/`, 30s delay, 10s timeout, 15s period, 20 failures | HTTP `/login`, 60s delay, 5s timeout, 10s period, 3 failures |
| Liveness | HTTP `/`, 60s delay, 10s timeout, 30s period, 3 failures | HTTP `/login`, 60s delay, 5s timeout, 30s period, 3 failures |

Xibo ships no health endpoint. `/` answers with a 302 to `/login`; `/login` returns 200 and proves the CMS rendered. The Foundation's generic `/healthz` returns 404 and must not be used.

---

## 7. Scripts and Container Image

All supporting files are in `scripts/`, which is the Docker build context.

### `Dockerfile`
- `ARG XIBO_VERSION=release-4.5.2`, `FROM ghcr.io/xibosignage/xibo-cms:${XIBO_VERSION}`.
- Copies `entrypoint.sh` to `/cloud-entrypoint.sh` and makes it the `ENTRYPOINT`. The vendor image has no `ENTRYPOINT` (its `CMD` is `/entrypoint.sh`), so the wrapper runs first and then `exec`s the vendor script.
- A rebuild under an unchanged tag produces no Terraform diff and therefore no rollout — pin exact releases.

### `entrypoint.sh`
Maps the Foundation's `DB_*` variables onto Xibo's `MYSQL_*` names and derives `CMS_SERVER_NAME` (see §4).

### `db-init.sh`
Creates the MySQL user and database (see §5).

---

## 8. The Media Library

`/var/www/cms/library` is the directory that matters: Xibo's entrypoint stores it as the `LIBRARY_LOCATION` setting, and it holds all uploaded media plus `certs/` (the player OAuth signing keys), `brand/`, `playersoftware/` and `temp/`. Apache serves it via XSendFile, which needs real POSIX semantics, so a StatefulSet PVC is the intended backing rather than GCS Fuse.

`Xibo_Common` itself declares no volume for this path; the PVC comes from the wrapper's `stateful_pvc_*` variables, and with `Xibo_GKE`'s defaults (`stateful_pvc_enabled = null`, `stateful_pvc_mount_path = "/data"`) nothing is mounted there. See the [Xibo GKE guide](Xibo_GKE.md#group-7-stateful-workloads) for the settings that persist it.

---

## 9. Implementation Pattern

`Xibo_GKE` instantiates `Xibo_Common` like this (abridged):

```hcl
module "xibo_app" {
  source = "../Xibo_Common"

  application_name             = var.application_name
  application_version          = var.application_version
  display_name                 = var.application_display_name
  db_name                      = var.application_database_name
  db_user                      = var.application_database_user
  environment_variables        = var.environment_variables
  cpu_limit                    = var.container_resources.cpu_limit
  memory_limit                 = var.container_resources.memory_limit
  min_instance_count           = var.min_instance_count
  max_instance_count           = var.max_instance_count
  gcs_volumes                  = var.gcs_volumes
  initialization_jobs          = var.initialization_jobs
  startup_probe                = var.startup_probe_config
  liveness_probe               = var.health_check_config
  secret_environment_variables = var.secret_environment_variables
  # ... other inputs
}

module "app_gke" {
  source = "../App_GKE"

  application_config     = { xibo = local.xibo_module }
  module_secret_env_vars = {}
  module_storage_buckets = module.xibo_app.storage_buckets
  scripts_dir            = abspath("${module.xibo_app.path}/scripts")
  # ... other inputs
}
```

<!-- related-guides -->

## Related guides

- [Xibo GKE Module — Configuration Guide](Xibo_GKE.md) — this configuration deployed on GKE.
- [Hands-on lab: Xibo on GKE Autopilot](../labs/Xibo_GKE.md) — deploy and operate it step by step.
