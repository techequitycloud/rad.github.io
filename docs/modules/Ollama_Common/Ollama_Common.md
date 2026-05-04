# Ollama_Common Shared Configuration Module

The `Ollama_Common` module defines the Ollama LLM inference server configuration for the RAD
Modules ecosystem. It **creates one GCP resource** (the GCS models bucket, via the
`storage_buckets` output consumed by the caller) and produces a `config` output consumed by
platform-specific wrapper modules (`Ollama_CloudRun` and `Ollama_GKE`).

## 1. Overview

**Purpose**: To centralize all Ollama-specific configuration — including container image,
port, GCS model persistence, automatically injected environment variables, and the optional
model-pull initialization job — in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Ollama_CloudRun  ──┐
└── Ollama_GKE       ──┤── instantiate Ollama_Common
                       ↓
          Ollama_Common (this module)
          Creates: 1 GCS bucket (models)
          Produces: config, storage_buckets, secret_ids (empty),
                    secret_values (empty), path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, storage, secrets, IAM)
```

**Key characteristics**:
- Unlike most `*_Common` modules, `Ollama_Common` creates **no secrets** — Ollama requires
  no database credentials, API keys, or passwords. Both `secret_ids` and `secret_values`
  output empty maps.
- The `ollama-models` GCS bucket is always appended to the `gcs_volumes` list, ensuring the
  models directory is mounted at `/mnt/gcs` in the container regardless of what additional
  volumes the caller provides.
- When `default_model` is set and `initialization_jobs` is empty, the module auto-generates
  a `model-pull` initialization job using `scripts/model-pull.sh`.
- Supports a `container_resources` override object; when `null`, falls back to the top-level
  `cpu_limit` / `memory_limit` variables.

---

## 2. GCP Resources Created

`Ollama_Common` itself creates no GCP resources directly. It produces a `storage_buckets`
output that the calling wrapper module passes to App_CloudRun or App_GKE, which then creates
the bucket.

| Bucket suffix | Content | Mount path |
|---|---|---|
| `models` | Ollama model weight files | `/mnt/gcs/ollama/models` (via GCS Fuse) |

The full bucket name is `<wrapper_prefix>-models`. The bucket uses `STANDARD` storage class,
`force_destroy = true`, no versioning, and `public_access_prevention = "inherited"`.

---

## 3. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | From `application_name` (default: `"ollama"`) |
| `display_name` | From `application_display_name` (default: `"Ollama LLM Server"`) |
| `description` | From `description` |
| `container_image` | `"ollama/ollama"` |
| `application_version` | From `application_version` (default: `"latest"`) |
| `image_source` | `"prebuilt"` |
| `enable_image_mirroring` | From `enable_image_mirroring` (default: `true`) |
| `container_build_config` | `{ enabled=false, dockerfile_path="Dockerfile", context_path="." }` |
| `container_port` | `11434` |
| `database_type` | `"NONE"` — no Cloud SQL instance is provisioned |
| `db_name` | `""` |
| `db_user` | `""` |
| `enable_cloudsql_volume` | `false` |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Merged list: caller's `gcs_volumes` + `ollama-models` bucket at `/mnt/gcs` |
| `container_resources` | From `var.container_resources` if non-null; else `{ cpu_limit, memory_limit }` from top-level variables |
| `min_instance_count` | From `min_instance_count` |
| `max_instance_count` | From `max_instance_count` |
| `environment_variables` | Fixed map — see §4 |
| `enable_postgres_extensions` | `false` |
| `postgres_extensions` | `[]` |
| `initialization_jobs` | Auto-generated `model-pull` job or caller-supplied list — see §5 |
| `startup_probe` | From `startup_probe` variable |
| `liveness_probe` | From `liveness_probe` variable |
| `additional_services` | `[]` — Ollama has no companion services |

### `storage_buckets`

One entry, always included:

| Field | Value |
|---|---|
| `name_suffix` | `"models"` |
| `name` | `<wrapper_prefix>-models` |
| `location` | From `deployment_region` |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` |

### `secret_ids`

Always returns an empty map (`{}`). Ollama requires no application-managed secrets.

### `secret_values`

Always returns an empty sensitive map (`{}`).

### `path`

Absolute path to the module directory. Used by wrapper modules to locate `scripts/`.

---

## 4. Automatically Injected Environment Variables

The following environment variables are always set in the container and must not be overridden
by caller-supplied `environment_variables` (they would be silently overridden by the merge):

| Variable | Value | Purpose |
|---|---|---|
| `OLLAMA_MODELS` | `"/mnt/gcs/ollama/models"` | Points Ollama at the GCS Fuse subdirectory where model weights are stored. This directory persists across container restarts. |
| `OLLAMA_HOST` | `"0.0.0.0:11434"` | Binds Ollama to all interfaces so Cloud Run's ingress or the Kubernetes service proxy can forward traffic to the container. |
| `OLLAMA_KEEP_ALIVE` | `"24h"` | Keeps the loaded model resident in memory for 24 hours between requests, eliminating per-request model-load latency. |

Caller-supplied `environment_variables` are merged **after** these defaults, so callers can
override `OLLAMA_KEEP_ALIVE` (e.g. to `"-1"` for permanent residency) or add tuning
variables such as `OLLAMA_NUM_PARALLEL`.

---

## 5. Model-Pull Initialization Job

`Ollama_Common` implements a two-path initialization job strategy:

**Path 1 — Custom jobs provided** (`initialization_jobs` is non-empty): The caller's jobs are
used verbatim. The auto-generated model-pull job is **not created**.

**Path 2 — Auto-generated job** (`initialization_jobs = []` and `default_model` is non-empty):
A single `model-pull` job is created with the following configuration:

| Field | Value |
|---|---|
| `name` | `"model-pull"` |
| `description` | `"Pull <default_model> into the GCS models bucket"` |
| `image` | `null` (uses the main Ollama service image) |
| `command` | `[]` |
| `args` | `[]` |
| `env_vars` | `{ OLLAMA_MODELS="/mnt/gcs/ollama/models", OLLAMA_HOST="0.0.0.0:11434", OLLAMA_MODEL=<default_model> }` |
| `cpu_limit` | From `cpu_limit` variable |
| `memory_limit` | From `memory_limit` variable |
| `timeout_seconds` | From `model_pull_timeout_seconds` variable |
| `max_retries` | `2` |
| `task_count` | `1` |
| `execution_mode` | `"TASK"` |
| `mount_nfs` | `false` |
| `mount_gcs_volumes` | `["ollama-models"]` |
| `depends_on_jobs` | `[]` |
| `execute_on_apply` | `true` |
| `script_path` | `<module_path>/scripts/model-pull.sh` |

**Path 3 — Skip job** (`initialization_jobs = []` and `default_model = ""`): An empty job
list is produced. No initialization job is created.

---

## 6. Scripts

All supporting scripts are in `scripts/`. The wrapper modules set `scripts_dir` to this
directory.

### `Dockerfile`

A minimal extension of the upstream Ollama image:

```dockerfile
FROM ollama/ollama:latest
EXPOSE 11434
ENTRYPOINT ["/bin/ollama"]
CMD ["serve"]
```

This Dockerfile is used when `container_image_source = "custom"` in the wrapper module. For
the default `"prebuilt"` source, the upstream `ollama/ollama` image is used directly and
the Dockerfile is not built.

### `model-pull.sh`

Pulls a named model into the GCS-backed models directory. Logic:

1. Checks that `OLLAMA_MODEL` is set; exits cleanly if not.
2. Creates `$OLLAMA_MODELS` directory if absent.
3. Starts `ollama serve` in the background.
4. Polls `http://localhost:11434/` up to 30 times (3-second interval) until the server is ready.
5. Runs `ollama pull $OLLAMA_MODEL`.
6. Kills the background server and waits for clean shutdown.

The script uses `set -euo pipefail` and exits with a non-zero code if the server fails to
start within the retry window.

---

## 7. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | **required** | GCP project ID. |
| `wrapper_prefix` | `string` | **required** | Prefix for GCS bucket names. Must match the `resource_prefix` used by the calling App_CloudRun or App_GKE module. |
| `deployment_id` | `string` | `""` | Unique deployment identifier. |
| `common_labels` | `map(string)` | `{}` | Labels applied to resources created by this module. |
| `deployment_region` | `string` | `"us-central1"` | Region for the GCS models bucket. |

### Application Details

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"ollama"` | Application name used in resource naming. |
| `application_display_name` | `string` | `"Ollama LLM Server"` | Human-readable application name. |
| `description` | `string` | `"Ollama — standalone open-source LLM inference server..."` | Application description. |
| `application_version` | `string` | `"latest"` | Ollama Docker image tag. |

### Model Configuration

| Variable | Type | Default | Description |
|---|---|---|---|
| `default_model` | `string` | `""` | Ollama model to pull during first deployment (e.g. `"llama3.2:3b"`, `"mistral"`, `"phi3:mini"`). Leave empty to skip the model-pull initialization job. Models are stored in GCS and persist across container restarts. |
| `model_pull_timeout_seconds` | `number` | `3600` | Timeout in seconds for the model-pull initialization job. Valid range: 300–7200. |

### Resources

| Variable | Type | Default | Description |
|---|---|---|---|
| `cpu_limit` | `string` | `"8000m"` | CPU limit for the Ollama container. Used for both the main container and the model-pull job. 7B models need at least 6 vCPU for tolerable latency; 3B models work at 4 vCPU. Note: this is the Common module internal default; the CloudRun and GKE wrapper modules have their own defaults (`"4000m"` and `"8"` respectively). |
| `memory_limit` | `string` | `"16Gi"` | Memory limit for the Ollama container. 3B models need ~4 Gi; 7B models need ~8–16 Gi. |
| `container_resources` | `any` | `null` | Full container resources override. When non-null, takes precedence over `cpu_limit` and `memory_limit`. |
| `min_instance_count` | `number` | `1` | Minimum instances. Set to `1` to keep a warm instance for low-latency inference. |
| `max_instance_count` | `number` | `3` | Maximum instances. |

### Storage

| Variable | Type | Default | Description |
|---|---|---|---|
| `gcs_volumes` | `list(any)` | `[]` | Additional GCS volume mounts. The `ollama-models` bucket at `/mnt/gcs` is always appended automatically. |

### Environment & Probes

| Variable | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Additional environment variables merged into the container spec after the fixed Ollama variables. |
| `initialization_jobs` | `list(any)` | `[]` | Custom initialization jobs. When non-empty, overrides the default model-pull job entirely. |
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=30, timeout_seconds=5, period_seconds=15, failure_threshold=20 }` | Startup probe. The 20-attempt threshold allows up to ~5 minutes for model loading from GCS. |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. 60 s initial delay avoids false restarts during model-load phase. |
| `enable_image_mirroring` | `bool` | `true` | Mirror the Ollama image to Artifact Registry before deployment. |

---

## 8. GCS Volume Layout

The `<wrapper_prefix>-models` GCS bucket is mounted at `/mnt/gcs` in the container:

```
<wrapper_prefix>-models/       ← GCS bucket root
└── ollama/
    └── models/                ← /mnt/gcs/ollama/models (OLLAMA_MODELS)
        ├── llama3.2:3b/       ← example model directory
        ├── mistral/
        └── ...
```

The `gcs_volumes` entry appended by this module:

```hcl
{
  name        = "ollama-models"
  bucket_name = "<wrapper_prefix>-models"
  mount_path  = "/mnt/gcs"
  read_only   = false
}
```

---

## 9. Platform-Specific Differences

| Aspect | Ollama_CloudRun | Ollama_GKE |
|---|---|---|
| `deployment_region` | Hard-coded to `"us-central1"` in `main.tf` | Auto-discovered from VPC subnets via `app_networking`; falls back to `var.deployment_region` |
| Model-pull job type | Cloud Run Job | Kubernetes Job |
| `mount_gcs_volumes` | `["ollama-models"]` mounted in the Cloud Run Job | `["ollama-models"]` mounted in the Kubernetes Job |
| GCS Fuse driver | GCS Fuse (Cloud Run gen2) | GCS Fuse CSI driver (GKE) |
| Additional services | none | `additional_services = []` (can be extended by caller) |
| Service networking | Direct VPC Egress (Cloud Run) | ClusterIP service (Kubernetes) |
| Scaling | Serverless instances | Kubernetes pods with HPA |

---

## 10. Implementation Pattern

```hcl
# Example: how Ollama_CloudRun instantiates Ollama_Common

module "ollama_app" {
  source = "../Ollama_Common"

  project_id    = var.project_id
  deployment_id = local.random_id
  common_labels = local.common_labels

  wrapper_prefix    = local.wrapper_prefix
  deployment_region = "us-central1"

  application_name         = var.application_name
  application_display_name = var.application_display_name
  description              = var.description
  application_version      = var.application_version

  default_model              = var.default_model
  model_pull_timeout_seconds = var.model_pull_timeout_seconds

  cpu_limit          = var.cpu_limit
  memory_limit       = var.memory_limit
  min_instance_count = var.min_instance_count
  max_instance_count = var.max_instance_count

  gcs_volumes            = var.gcs_volumes
  environment_variables  = var.environment_variables
  initialization_jobs    = var.initialization_jobs
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_image_mirroring = var.enable_image_mirroring
}

# config is passed to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = { ollama = module.ollama_app.config }
  module_env_vars        = {}
  module_secret_env_vars = {}
  module_storage_buckets = module.ollama_app.storage_buckets
  scripts_dir            = abspath("${module.ollama_app.path}/scripts")
  # ... other inputs
}
```
