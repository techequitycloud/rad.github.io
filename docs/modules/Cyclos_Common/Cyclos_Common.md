---
title: "Cyclos Common Shared Configuration Module"
sidebar_label: "Common"
---

# Cyclos_Common Shared Configuration Module

The `Cyclos_Common` module defines the Cyclos banking and payment platform configuration for the RAD Modules ecosystem. It is a **configuration library**, not a resource-creating module — it produces a standardized application configuration object consumed by platform-specific wrapper modules (`Cyclos_CloudRun` and `Cyclos_GKE`).

## 1. Overview

**Purpose**: To centralize all Cyclos-specific configuration (container image, database requirements, environment variables, resource limits, health probes, storage buckets, and initialization jobs) in a single module that both Cloud Run and GKE deployments share.

**Architecture**:

```
Layer 3: Application Wrappers
├── Cyclos_CloudRun  ──┐
└── Cyclos_GKE       ──┤── instantiate Cyclos_Common
                       ↓
            Cyclos_Common (this module)
            Produces: config, storage_buckets, path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**What it does NOT do**: It does not create any GCP resources itself. All infrastructure provisioning is performed by the platform modules (`App_CloudRun`, `App_GKE`) and the shared library (`App_Common`) that consume its outputs.

---

## 2. Outputs

`Cyclos_Common` produces three outputs consumed by the wrapper modules.

### `config`
A comprehensive application configuration object passed to the platform module via `application_config`. It includes:

| Field | Value / Description |
|-------|---------------------|
| `app_name` | `"cyclos"` |
| `application_version` | Cyclos version tag (e.g., `"4.16.17"`) |
| `display_name` | Human-readable name (e.g., `"Cyclos Community Edition"`) |
| `container_image` | `"cyclos/cyclos"` (public Docker Hub image) |
| `image_source` | `"prebuilt"` — no custom build step needed |
| `container_build_config` | Dockerfile build settings (context path, build args) for the wrapper image |
| `container_port` | `8080` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Database name (default: `"cyclos"`) |
| `db_user` | Database user (default: `"cyclos"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar |
| `gcs_volumes` | Empty array — Cyclos uses a GCS bucket, not mounted volumes |
| `container_resources` | CPU/memory limits and requests |
| `min_instance_count` | Minimum running instances (default: `1`) |
| `max_instance_count` | Maximum running instances (default: `1`) |
| `environment_variables` | Merged map — see §4 |
| `enable_postgres_extensions` | `true` |
| `postgres_extensions` | Required PostgreSQL extensions — see §5 |
| `initialization_jobs` | List of setup jobs to run on first deploy — see §6 |
| `startup_probe` | HTTP probe with extended timeouts to accommodate schema creation |
| `liveness_probe` | HTTP probe for ongoing health monitoring |

### `storage_buckets`
A list of GCS bucket configuration objects provisioned by the platform module:

| Field | Value |
|-------|-------|
| `name_suffix` | `"cyclos-storage"` → bucket name: `<resource_prefix>-cyclos-storage` |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"enforced"` |

This bucket stores all Cyclos uploaded files, media, and custom field binaries via the GCS Content Manager (`cyclos.storedFileContentManager = gcs`).

### `path`
The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory containing the `Dockerfile`, `cyclos.properties`, `db-init.sh`, and `hazelcast.xml`.

---

## 3. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | `string` | required | GCP project ID |
| `resource_prefix` | `string` | `""` | Prefix for resource naming (e.g., `appcyclos<tenant><random>`) |
| `labels` | `map(string)` | `{}` | Labels applied to all resources |
| `deployment_id` | `string` | `""` | Unique deployment identifier |
| `deployment_id_suffix` | `string` | `""` | Random suffix used in resource name calculations |
| `service_url` | `string` | `""` | Accessible service URL (empty for GKE — URL is not known at plan time) |
| `tenant_deployment_id` | `string` | `"demo"` | Deployment environment identifier (1–20 lowercase alphanumeric characters) |
| `deployment_region` | `string` | `"us-central1"` | Primary GCP region for deployment |

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_version` | `string` | `"4.16.17"` | Cyclos Docker image tag |
| `display_name` | `string` | `"Cyclos Community Edition"` | Human-readable display name |
| `description` | `string` | `"Create required PostgreSQL extensions"` | Module description |
| `db_name` | `string` | `"cyclos"` | PostgreSQL database name |
| `db_user` | `string` | `"cyclos"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"2000m"` | Container CPU limit |
| `memory_limit` | `string` | `"4Gi"` | Container memory limit |
| `min_instance_count` | `number` | `1` | Minimum running instances |
| `max_instance_count` | `number` | `1` | Maximum running instances |
| `application_name` | `string` | `"cyclos"` | Application name used in resource naming |
| `environment_variables` | `map(string)` | see §4 | Environment variables merged into the container spec |
| `enable_cloudsql_volume` | `bool` | `false` | Mount a Cloud SQL Auth Proxy sidecar socket |
| `initialization_jobs` | `list(object)` | `[]` | Custom initialization jobs; if empty, the built-in `db-init` job is used |
| `startup_probe` | `object` | HTTP `/api`, 90s delay, 30s timeout, 10s period, 30 failures | Startup health probe configuration |
| `liveness_probe` | `object` | HTTP `/api`, 120s delay, 10s timeout, 30s period, 3 failures | Liveness health probe configuration |

---

## 4. Environment Variables

The module provides a default set of environment variables that configure the Cyclos runtime:

| Variable | Default Value | Purpose |
|----------|---------------|---------|
| `DB_HOST` | `/var/run/postgresql` | PostgreSQL socket path (overridden per platform) |
| `DB_PORT` | `5432` | PostgreSQL port |
| `CYCLOS_HOME` | `/usr/local/cyclos` | Cyclos home directory inside the container |
| `cyclos.storedFileContentManager` | `gcs` | Enables GCS as the file storage backend |
| `cyclos.storedFileContentManager.bucketName` | `<resource_prefix>-cyclos-storage` | GCS bucket for uploaded files |

Wrapper modules merge additional platform-specific variables (e.g., database connection details, Cloud SQL socket path, secret references) on top of these defaults.

---

## 5. PostgreSQL Extensions

Cyclos requires the following extensions to be created as a superuser before the application connects. The `db-init.sh` script handles this during the initialization job.

| Extension | Purpose |
|-----------|---------|
| `pg_trgm` | Trigram-based text search and similarity matching |
| `uuid-ossp` | UUID generation functions |
| `cube` | Multi-dimensional cube data type (prerequisite for `earthdistance`) |
| `earthdistance` | Geographic distance calculations |
| `postgis` | Full geospatial query support |
| `unaccent` | Unicode accent-insensitive text search |

---

## 6. Initialization Jobs

By default, the module defines a `db-init` initialization job that runs the `scripts/db-init.sh` script. This script:

1. Detects Cloud SQL Auth Proxy socket connections (for Cloud Run) and maps them to the standard PostgreSQL socket path.
2. Polls the database until it is available (timeout-based).
3. Creates (or updates) the Cyclos database user with `CREATEDB` and `INHERIT` privileges.
4. Creates the Cyclos database if it does not exist and grants full privileges to the application user.
5. Creates all required PostgreSQL extensions (listed in §5) as a superuser.
6. Grants schema, table, sequence, and function privileges to the application user and sets defaults for future objects.
7. Sets the database owner to the application user.
8. Signals Cloud SQL Proxy to shut down cleanly via the `/quitquitquit` HTTP endpoint.

Custom jobs can be supplied via the `initialization_jobs` variable to replace or supplement this default.

---

## 7. Scripts and Configuration Files

All supporting files are located in `scripts/`.

### `Dockerfile`
Wraps the public `cyclos/cyclos:<version>` image by copying `cyclos.properties` and `hazelcast.xml` into the container. Accepts an `APP_VERSION` build argument for version overrides. This allows custom property files to be baked into the image without modifying the upstream image.

### `cyclos.properties`
The primary Cyclos server configuration file, pre-configured for containerized cloud deployments:

*   **Database**: HikariCP connection pool using `PGSimpleDataSource`; connection details injected via environment variables; pool size scales automatically with CPU cores.
*   **Schema Management**: `cyclos.db.managed = true` (automatic schema creation and upgrades on startup); `cyclos.db.skipLock = true` for serverless compatibility (no distributed locking).
*   **File Storage**: Pre-configured for GCS; bucket name injected via environment variable. Alternative backends (database, filesystem, S3) are available as commented options.
*   **Search**: Defaults to database-backed search. Can be switched to OpenSearch for large-scale deployments.
*   **Clustering**: Defaults to `none` (single instance). Set to `hazelcast` for multi-instance Kubernetes deployments using the bundled `hazelcast.xml`.
*   **Proxy Headers**: `X-Forwarded-For` and `X-Forwarded-Proto` for correct IP and protocol detection behind load balancers.
*   **Session Management**: `cyclos.sessions.anyAddress = true` to allow session reuse from mobile clients with dynamic IPs.
*   **Background Tasks**: Auto-scaled to CPU core count.
*   **Logging**: Rotating file logs at `/var/log/cyclos` with asynchronous writing.
*   **Cleanup Policies**: Trash (30 days), notifications (30 days), unconfirmed users (7 days), login logs (365 days).
*   **REST API**: Reference page enabled at `/api`.

### `hazelcast.xml`
Optional Hazelcast cluster configuration for multi-instance deployments:
*   Cluster name: `"cyclos"`; network port: `5701`.
*   Join strategy: Kubernetes DNS discovery (configured via `CLUSTER_K8S_DNS` environment variable).
*   Map configurations for initialization state (3 backups, no expiry) and session timeouts (1 backup, read-backup-data enabled).
*   Executor services for recurring and monitoring tasks, pool-sized from `cyclos.properties`.

---

## 8. Platform-Specific Differences

| Aspect | Cyclos_CloudRun | Cyclos_GKE |
|--------|-----------------|------------|
| `service_url` | Set to the Cloud Run service URL | Empty string (not known at plan time) |
| `enable_cloudsql_volume` | Optional (Auth Proxy sidecar) | Not used (TCP connection to Cloud SQL) |
| `DB_HOST` | Cloud SQL Auth Proxy socket path | Cloud SQL private IP |
| NFS | Disabled (`enable_nfs = false`) | Disabled (GCS used instead) |
| Redis | Not supported | Not supported |
| Clustering | Single-instance default | `hazelcast.xml` available for multi-pod |

---

## 9. Implementation Pattern

```hcl
# Example: how Cyclos_CloudRun instantiates Cyclos_Common

module "cyclos_app" {
  source = "../Cyclos_Common"

  project_id         = var.project_id
  resource_prefix    = local.resource_prefix
  deployment_id      = local.deployment_id
  application_version = var.application_version
  cpu_limit          = var.cpu_limit
  memory_limit       = var.memory_limit
  # ... other inputs
}

# The config output is passed directly to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config   = module.cyclos_app.config
  module_storage_buckets = module.cyclos_app.storage_buckets
  scripts_dir          = "${module.cyclos_app.path}/scripts"
  # ... other inputs
}
```
