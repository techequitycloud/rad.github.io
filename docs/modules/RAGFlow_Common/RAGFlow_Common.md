# RAGFlow_Common Module — Configuration Guide

`RAGFlow_Common` is the **shared configuration sub-module** for RAGFlow deployments. It is not deployed directly — it is called by `RAGFlow_GKE` (and future CloudRun variants) to produce the three standard outputs that the Foundation module (`App_GKE`) expects: `config`, `storage_buckets`, and `path`.

RAGFlow is an open-source document intelligence and Retrieval-Augmented Generation (RAG) platform. It ingests PDFs, Word documents, HTML pages, and other formats, chunks and embeds them, stores vectors in Elasticsearch, and exposes a REST API for question-answering, knowledge base management, and enterprise search.

> `RAGFlow_Common` is a **sub-module** — it is called as a child module by `RAGFlow_GKE`. Do not deploy it directly. It contains no `provider` or `backend` blocks and creates no GCP resources itself.

---

## §1 · Module Overview

### What `RAGFlow_Common` provides

- A **`config` output** containing the complete application configuration object consumed by `App_GKE`'s `application_config` input. This includes the container image reference, port, database type, resource limits, health probes, and initialization jobs.
- A **`storage_buckets` output** — a single GCS bucket with the suffix `ragflow-documents` in the deployment region, used for document ingestion and storage.
- A **`path` output** — the absolute path to the module directory. `RAGFlow_GKE` uses `"${module.ragflow_app.path}/scripts"` as its `scripts_dir`.

### How the image is built

Unlike most application modules that pull a prebuilt image, `RAGFlow_Common` sets `image_source = "custom"` unconditionally. The `container_build_config` instructs Cloud Build to run the `Dockerfile` located at `scripts/Dockerfile` using `.` as the context, passing `APP_VERSION` as a build argument. The result is pushed to Artifact Registry and deployed to GKE.

### Database

RAGFlow requires **MySQL 8.0** (`database_type = "MYSQL_8_0"`). The `db_name` and `db_user` values from the caller are forwarded directly into the config output. The Cloud SQL Auth Proxy sidecar is always enabled (`enable_cloudsql_volume = true`) and mounts the socket at `/cloudsql`. The `MYSQL_HOST` environment variable is set to `127.0.0.1` in `RAGFlow_GKE`'s locals so RAGFlow connects via the proxy.

### Initialization job

When `initialization_jobs = []` (the default), `RAGFlow_Common` generates a single `db-init` Kubernetes Job that runs the `scripts/db-init.sh` script using the `mysql:8.0-debian` image. This job is marked `execute_on_apply = true` and has a 600-second timeout and 1 retry. Providing any non-empty `initialization_jobs` list disables the auto-generated job.

### Health probes

All probes target the `/v1/health` endpoint. RAGFlow loads embedding models at startup, so the startup probe allows up to 180 seconds (`initial_delay_seconds=60` + 18 attempts at 10-second intervals) before the liveness probe takes over.

| Probe | Path | initial_delay_seconds | period_seconds | failure_threshold |
|---|---|---|---|---|
| Startup | `/v1/health` | 60 | 10 | 18 |
| Liveness | `/v1/health` | 120 | 30 | 3 |
| Readiness | `/v1/health` | 30 | 10 | 3 |

### Scripts directory

`RAGFlow_Common` bundles three files in `scripts/`:

| File | Purpose |
|---|---|
| `Dockerfile` | Builds the RAGFlow image from `infiniflow/ragflow:${APP_VERSION}`, generating `service_conf.yaml` from environment variables at container startup via `entrypoint.sh`. |
| `db-init.sh` | MySQL initialization script run by the `db-init` Kubernetes Job. Creates the RAGFlow database and user if they do not exist. |
| `entrypoint.sh` | Container entrypoint. Generates `/ragflow/conf/service_conf.yaml` from injected environment variables and then starts the RAGFlow processes. |

---

## §2 · Input Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"ragflow"` | Base name used for Kubernetes resources and GCS buckets. |
| `deployment_id` | `string` | `""` | Unique deployment ID suffix. Passed from the calling module. |
| `application_version` | `string` | `"v0.13.0"` | RAGFlow version tag. Used as the `APP_VERSION` build arg in Cloud Build. |
| `db_name` | `string` | `"rag_flow"` | MySQL database name forwarded into `config.db_name`. |
| `db_user` | `string` | `"ragflow"` | MySQL user forwarded into `config.db_user`. |
| `enable_cloudsql_volume` | `bool` | `true` | Injects the Cloud SQL Auth Proxy sidecar. Should always be `true` for RAGFlow. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volumes mounted into the container. Forwarded as-is into `config.gcs_volumes`. |
| `cpu_limit` | `string` | `"4000m"` | CPU limit for the RAGFlow container. Document parsing is CPU-intensive. |
| `memory_limit` | `string` | `"8Gi"` | Memory limit for the RAGFlow container. Embedding models require significant RAM. |
| `environment_variables` | `map(string)` | `{}` | Additional plain-text env vars merged into `config.environment_variables`. |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager secret references forwarded into `config.secret_environment_variables`. |
| `initialization_jobs` | `list(object)` | `[]` | Custom initialization jobs. When empty, the auto-generated `db-init` job is used. |
| `description` | `string` | `"Initialize RAGFlow MySQL 8.0 database"` | Description embedded in the `db-init` job and Kubernetes annotations. |
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/v1/health", initial_delay_seconds=60, timeout_seconds=10, period_seconds=10, failure_threshold=18 }` | Startup probe forwarded into `config.startup_probe`. |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/v1/health", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Liveness probe forwarded into `config.liveness_probe`. |
| `enable_image_mirroring` | `bool` | `false` | Mirror the source image to Artifact Registry before the build. |
| `min_instance_count` | `number` | `1` | Minimum pod replicas forwarded into `config.min_instance_count`. |
| `max_instance_count` | `number` | `3` | Maximum pod replicas forwarded into `config.max_instance_count`. |
| `deployment_region` | `string` | `"us-central1"` | GCP region used for the `ragflow-documents` GCS bucket location. |

---

## §3 · Outputs

| Output | Description |
|---|---|
| `config` | Complete application configuration object consumed by `App_GKE`'s `application_config` input. Contains `app_name`, `container_image`, `container_port=80`, `database_type="MYSQL_8_0"`, `db_name`, `db_user`, `enable_cloudsql_volume`, `container_resources`, `min_instance_count`, `max_instance_count`, `environment_variables`, `secret_environment_variables`, `initialization_jobs`, `startup_probe`, `liveness_probe`, and `readiness_probe`. |
| `storage_buckets` | List containing one GCS bucket configuration object: `{ name_suffix = "ragflow-documents", location = var.deployment_region, storage_class = "STANDARD", force_destroy = true, versioning_enabled = false }`. |
| `path` | Absolute path to the `RAGFlow_Common` module directory. Used by `RAGFlow_GKE` to resolve `scripts_dir`. |

---

## §4 · Hard-Coded Values

The following values are fixed inside `RAGFlow_Common` and cannot be overridden by callers:

| Setting | Value | Reason |
|---|---|---|
| `container_image` | `"infiniflow/ragflow"` | Always built from this source image. |
| `image_source` | `"custom"` | RAGFlow requires a custom `entrypoint.sh` to generate `service_conf.yaml`. |
| `container_port` | `80` | RAGFlow's Nginx frontend listens on port 80. |
| `database_type` | `"MYSQL_8_0"` | RAGFlow requires MySQL 8.0. |
| `enable_mysql_plugins` | `false` | RAGFlow does not require MySQL plugins. |
| `readiness_probe.path` | `"/v1/health"` | Fixed readiness check endpoint. |
| `build_args.APP_VERSION` | `var.application_version` | Version is always passed to the Dockerfile as a build argument. |
| Default `db-init` job image | `"mysql:8.0-debian"` | Standard MySQL client image for schema initialization. |

---

## §5 · Usage Pattern

`RAGFlow_Common` is called exclusively by `RAGFlow_GKE`:

```hcl
module "ragflow_app" {
  source              = "../RAGFlow_Common"
  deployment_id       = local.random_id
  deployment_region   = local.region
  application_name    = var.application_name
  application_version = var.application_version
  db_name             = var.db_name
  db_user             = var.db_user
  cpu_limit           = var.cpu_limit
  memory_limit        = var.memory_limit
  description         = var.description
  startup_probe       = var.startup_probe
  liveness_probe      = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
}

locals {
  application_modules    = { ragflow = merge(module.ragflow_app.config, { ... }) }
  module_storage_buckets = module.ragflow_app.storage_buckets
  scripts_dir            = abspath("${module.ragflow_app.path}/scripts")
}
```

Do not call `RAGFlow_Common` directly from a root module — it has no `provider` or `backend` block and does not create any GCP resources itself.
