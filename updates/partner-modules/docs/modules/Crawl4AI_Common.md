# Crawl4AI_Common Shared Configuration Module

The `Crawl4AI_Common` module defines the Crawl4AI web crawler configuration for the RAD Modules ecosystem. It is a **pure configuration module** — it creates no GCP resources and produces a `config` output consumed by platform-specific wrapper modules (`Crawl4AI_CloudRun` and `Crawl4AI_GKE`).

## 1. Overview

**Purpose**: To centralise all Crawl4AI-specific configuration (prebuilt container image, embedded Redis + Gunicorn supervisord setup, environment variable mapping, health probes, and the stateless no-database architecture) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Crawl4AI_CloudRun  ──┐
└── Crawl4AI_GKE       ──┤── instantiate Crawl4AI_Common
                          ↓
               Crawl4AI_Common (this module)
               Creates: (no GCP resources)
               Produces: config, secret_ids, storage_buckets
                          ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                          ↓
Layer 1: App_Common (networking, storage, secrets, IAM)
```

**Key characteristics**:
- **No external database** — `database_type = "NONE"`. Cloud SQL is not provisioned.
- **Creates no GCP resources** — no secrets, no IAM bindings, no storage buckets.
- **Embedded Redis** — supervisord starts Redis (priority 10) then Gunicorn (priority 20) inside the same container. Redis listens on `localhost:6379` and must NOT be overridden via environment variables.
- **Chromium memory management** — the default `config.yml` includes `--disable-dev-shm-usage` in Chrome's extra_args. On Cloud Run, Chromium redirects shared memory to `/tmp`; on GKE, a proper `/dev/shm` emptyDir volume is mounted by `App_GKE`.
- `secret_ids` returns an empty map — no secrets are auto-generated.
- `storage_buckets` returns an empty list — no GCS buckets are auto-provisioned.

---

## 2. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `var.application_name` |
| `display_name` | `var.application_display_name` |
| `description` | `var.description` |
| `container_image` | `"unclecode/crawl4ai"` |
| `application_version` | `var.application_version` (default: `"latest"`) |
| `image_source` | `"prebuilt"` — uses the upstream Docker Hub image directly |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default: `true`) |
| `container_build_config` | `enabled = false` — no Cloud Build step |
| `container_port` | `11235` — Crawl4AI REST API port |
| `database_type` | `"NONE"` — no external database |
| `db_name` | `""` |
| `db_user` | `""` |
| `enable_cloudsql_volume` | `false` — no Cloud SQL sidecar |
| `cloudsql_volume_mount_path` | `"/cloudsql"` (unused) |
| `gcs_volumes` | `var.gcs_volumes` |
| `enable_postgres_extensions` | `false` |
| `postgres_extensions` | `[]` |
| `container_resources` | See below |
| `min_instance_count` | `var.min_instance_count` |
| `max_instance_count` | `var.max_instance_count` |
| `startup_probe` | `var.startup_probe` (HTTP `/health`, 40 s delay) |
| `liveness_probe` | `var.liveness_probe` (HTTP `/health`, 60 s delay) |
| `initialization_jobs` | `var.initialization_jobs` |
| `additional_services` | `[]` |

### `container_resources`

When `container_resources` is provided directly, it takes precedence over `cpu_limit` and `memory_limit`. The merged object includes:

| Field | Default |
|---|---|
| `cpu_limit` | `var.cpu_limit` (`"4000m"` on Cloud Run, `"4"` on GKE) |
| `memory_limit` | `var.memory_limit` (`"8Gi"`) |
| `cpu_request` | `null` |
| `mem_request` | `null` |
| `ephemeral_storage_request` | `null` |
| `ephemeral_storage_limit` | `null` |

### `environment_variables` (within `config`)

| Variable | Value | Description |
|---|---|---|
| `PYTHONUNBUFFERED` | `"1"` | Ensures Python log output is not buffered |
| `REDIS_TASK_TTL` | `tostring(var.redis_task_ttl_seconds)` | TTL for task results in embedded Redis |

Additional environment variables from `var.environment_variables` are merged after the above defaults.

> **Do NOT override `REDIS_HOST` or `REDIS_PORT`** — these must remain at `localhost`/`6379` to connect to the bundled Redis instance inside the container.

### `secret_ids`

Empty map — Crawl4AI_Common creates no secrets. Use `secret_environment_variables` in the wrapper module to inject `SECRET_KEY` and LLM API keys.

### `storage_buckets`

Empty list — no GCS buckets are auto-provisioned.

---

## 3. Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. |
| `wrapper_prefix` | `string` | — | Prefix for GCS bucket resource naming. Must match the resource_prefix used by the calling module. |
| `deployment_id` | `string` | `""` | Unique deployment ID. |
| `common_labels` | `map(string)` | `{}` | Labels to apply to resources. |
| `region` | `string` | `"us-central1"` | GCP region for resource deployment. |
| `application_name` | `string` | `"crawl4ai"` | Application name used in resource naming. |
| `application_display_name` | `string` | `"Crawl4AI Web Crawler"` | Human-readable application name. |
| `description` | `string` | (Crawl4AI description) | Application description. |
| `application_version` | `string` | `"latest"` | Crawl4AI Docker image tag. |
| `redis_task_ttl_seconds` | `number` | `3600` | TTL for task results in embedded Redis. Range: 300–86400. |
| `cpu_limit` | `string` | `"4000m"` | CPU limit for the container. |
| `memory_limit` | `string` | `"8Gi"` | Memory limit for the container. Minimum 4 Gi. |
| `container_resources` | `any` | `null` | Full container resources override. Takes precedence over `cpu_limit`/`memory_limit`. |
| `min_instance_count` | `number` | `1` | Minimum number of instances. |
| `max_instance_count` | `number` | `3` | Maximum number of instances. |
| `gcs_volumes` | `list(any)` | `[]` | Additional GCS volume mounts. |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables. `PYTHONUNBUFFERED` and `REDIS_TASK_TTL` are set automatically. Do NOT override `REDIS_HOST` or `REDIS_PORT`. |
| `initialization_jobs` | `list(any)` | `[]` | Custom initialisation jobs. |
| `startup_probe` | `object` | (HTTP `/health`, 40 s delay) | Startup probe configuration. |
| `liveness_probe` | `object` | (HTTP `/health`, 60 s delay) | Liveness probe configuration. |
| `enable_image_mirroring` | `bool` | `true` | Mirror the Crawl4AI image to Artifact Registry. |

---

## 4. Recognised Environment Variables

The following environment variables are recognised by Crawl4AI at runtime (sourced from `server.py`, `utils.py`, and `auth.py`):

| Variable | Description |
|---|---|
| `SECRET_KEY` | JWT signing secret (default: `"mysecret"`). Override via `secret_environment_variables` for production. |
| `REDIS_PASSWORD` | Redis auth password (default: `""` — no password for embedded Redis). |
| `REDIS_TASK_TTL` | TTL in seconds for task data in Redis (default: `3600`). Set automatically by this module. |
| `LLM_PROVIDER` | Override the default LLM provider (e.g., `"anthropic/claude-3-haiku"`). |
| `LLM_API_KEY` | Set the LLM API key. Prefer provider-specific keys below. |
| `LLM_BASE_URL` | Override the LLM API base URL (for proxy or custom endpoints). |
| `LLM_TEMPERATURE` | Override LLM sampling temperature. |
| `OPENAI_API_KEY` | OpenAI API key for extraction tasks. |
| `ANTHROPIC_API_KEY` | Anthropic API key for extraction tasks. |
| `DEEPSEEK_API_KEY` | DeepSeek API key for extraction tasks. |
| `GROQ_API_KEY` | Groq API key for extraction tasks. |
| `GEMINI_API_KEY` | Google Gemini API key for extraction tasks. |
| `CRAWL4AI_HOOKS_ENABLED` | Enable custom hook execution (default: `"false"`). **Warning: RCE risk.** Only enable in fully trusted environments. |

---

## 5. Internal Process Architecture

```
Container startup
└── supervisord (PID 1)
    ├── [priority=10] Redis server  → localhost:6379
    │                               (task queue, result store)
    └── [priority=20] Gunicorn      → 0.0.0.0:11235
                      └── 1 worker × 4 threads
                          └── FastAPI (crawl4ai.server)
                              ├── POST /crawl          (async crawl job)
                              ├── GET  /task/{id}      (task status & result)
                              ├── POST /crawl/sync     (synchronous crawl)
                              ├── GET  /health         (health check)
                              └── GET  /playground     (interactive UI)
```

Chromium is launched on-demand per crawl request. The default `config.yml` sets `crawler.pool.max_pages = 40` (maximum concurrent browser pages per container instance).
