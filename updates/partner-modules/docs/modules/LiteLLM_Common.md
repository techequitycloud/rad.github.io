# LiteLLM_Common

This document provides a reference for the `modules/LiteLLM_Common` Terraform module — the shared application configuration layer consumed by both `LiteLLM_CloudRun` and `LiteLLM_GKE`.

---

## 1. Overview

`LiteLLM_Common` is the **application-specific shared layer** for LiteLLM deployments. It is not deployed directly by users; it is called as a child module by `LiteLLM_CloudRun` and `LiteLLM_GKE`.

**Responsibilities:**
- Provisions `LITELLM_MASTER_KEY` and `LITELLM_SALT_KEY` in Secret Manager.
- Builds the `config` output consumed by the Foundation Module (`App_CloudRun` / `App_GKE`).
- Assembles LiteLLM environment variables including `PROXY_BASE_URL`, `STORE_MODEL_IN_DB`, Redis settings, and `HOST`.
- Provides the default `db-init` Cloud Run Job (using `postgres:15-alpine`) that creates the LiteLLM PostgreSQL database and user when `initialization_jobs` is left empty.
- Declares the `litellm-data` GCS bucket in `storage_buckets` output.

---

## 2. Secrets Provisioned

| Secret Name | Env Var | Purpose |
|---|---|---|
| `<prefix>-master-key` | `LITELLM_MASTER_KEY` | Primary admin API key (prefixed `sk-`). Required for `/key/generate` and admin operations. |
| `<prefix>-salt-key` | `LITELLM_SALT_KEY` | Salt for hashing virtual keys. **Do not rotate after virtual keys have been issued.** |

A `time_sleep` of 30 seconds is applied after secret creation for Secret Manager replication.

---

## 3. Default Database Initialization Job

When `initialization_jobs` is empty, `LiteLLM_Common` injects a single `db-init` job:

```
name:         "db-init"
image:        "postgres:15-alpine"
script_path:  <LiteLLM_Common>/scripts/db-init.sh
execute_on_apply: true
```

The `db-init.sh` script idempotently creates the LiteLLM database and user using the `DB_*` environment variables injected by the Foundation Module. It connects to Cloud SQL via the Auth Proxy Unix socket.

Override `initialization_jobs` with a non-empty list to replace this default.

---

## 4. Config Output

Key fields in the `config` output:

| Field | Value |
|---|---|
| `container_image` | `ghcr.io/berriai/litellm` |
| `image_source` | `custom` |
| `container_build_config.enabled` | `true` |
| `container_port` | `4000` |
| `database_type` | `POSTGRES_15` |
| `enable_cloudsql_volume` | `true` (default) |
| `STORE_MODEL_IN_DB` | `"true"` |
| `PROXY_BASE_URL` | Caller-supplied service URL |
| `REDIS_HOST` | Injected when `enable_redis = true` and `redis_host != ""` |
| `REDIS_PORT` | Injected when `enable_redis = true` |
| `REDIS_PASSWORD` | Injected when `redis_auth != ""` |

---

## 5. Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. |
| `resource_prefix` | `string` | — | Prefix for resource naming. |
| `labels` | `map(string)` | `{}` | Labels applied to all resources. |
| `tenant_deployment_id` | `string` | `'demo'` | Deployment identifier. |
| `deployment_id` | `string` | `""` | Random deployment ID suffix. |
| `region` | `string` | `'us-central1'` | GCP region. |
| `application_name` | `string` | `'litellm'` | Application name. |
| `application_version` | `string` | `'main-stable'` | Container image version tag. |
| `display_name` | `string` | `'LiteLLM AI Gateway'` | Display name. |
| `description` | `string` | `'LiteLLM AI Gateway...'` | Application description. |
| `db_name` | `string` | `'litellm_db'` | PostgreSQL database name. |
| `db_user` | `string` | `'litellm_user'` | PostgreSQL application user. |
| `cpu_limit` | `string` | `'2000m'` | CPU limit. |
| `memory_limit` | `string` | `'2Gi'` | Memory limit. |
| `min_instance_count` | `number` | `1` | Minimum instances. |
| `max_instance_count` | `number` | `3` | Maximum instances. |
| `startup_probe` | `object` | `{ path="/health/readiness", ... }` | Startup probe configuration. |
| `liveness_probe` | `object` | `{ path="/health/liveliness", ... }` | Liveness probe configuration. |
| `environment_variables` | `map(string)` | `{}` | Additional env vars merged with LiteLLM defaults. |
| `enable_cloudsql_volume` | `bool` | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `initialization_jobs` | `list(any)` | `[]` | Custom jobs. Empty = inject default `db-init`. |
| `service_url` | `string` | `""` | Service URL for `PROXY_BASE_URL`. |
| `enable_redis` | `bool` | `false` | Enable Redis response caching. |
| `redis_host` | `string` | `null` | Redis hostname or IP. |
| `redis_port` | `string` | `'6379'` | Redis port. |
| `redis_auth` | `string` (sensitive) | `""` | Redis AUTH password. |
| `enable_image_mirroring` | `bool` | `true` | Mirror image to Artifact Registry. |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volumes. |

---

## 6. Outputs

| Output | Description |
|---|---|
| `config` | Application configuration object for the Foundation Module. |
| `secret_ids` | Map of `LITELLM_MASTER_KEY` and `LITELLM_SALT_KEY` → Secret Manager secret IDs. |
| `storage_buckets` | List containing the `litellm-data` bucket definition. |
