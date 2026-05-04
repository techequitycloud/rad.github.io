# NodeRED_Common Shared Configuration Module

The `NodeRED_Common` module defines the Node-RED flow-based programming tool for the RAD Modules ecosystem. It produces a `config` output consumed by platform-specific wrapper modules (`NodeRED_CloudRun` and `NodeRED_GKE`), along with a `storage_buckets` output that provisions the application's GCS bucket.

## 1. Overview

**Purpose**: To centralise all Node-RED-specific configuration — container image selection, port binding, health probes, flow persistence path, and storage bucket definitions — in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── NodeRED_CloudRun  ──┐
└── NodeRED_GKE       ──┤── instantiate NodeRED_Common
                        ↓
            NodeRED_Common (this module)
            Creates: no GCP resources directly
            Produces: config, storage_buckets, path
                        ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                        ↓
Layer 1: App_Common (networking, storage, secrets, IAM)
```

**Key differences from other Common modules (e.g. N8N_Common)**:
- No GCP resources are created directly — no Secret Manager secrets, no Cloud SQL databases.
- Node-RED does not require a relational database; `database_type = "NONE"` is hardcoded in the config output.
- No initialization jobs are run by default — `initialization_jobs` defaults to an empty list.
- A credential secret (`NODE_RED_CREDENTIAL_SECRET`) is managed entirely by the Foundation Module (`App_CloudRun` / `App_GKE`) via the `database_password_length` variable, not by this module.
- `NODE_RED_ENABLE_SAFE_MODE = "false"` is always injected, merged with any caller-supplied `environment_variables`.

---

## 2. GCP Resources Created

None. `NodeRED_Common` is a pure configuration-composition module. All GCP resource provisioning (secrets, storage, NFS, IAM, container runtime) is delegated to the Foundation Module.

---

## 3. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | from `application_name` (default: `"nodered"`) |
| `application_version` | from `application_version` (default: `"latest"`) |
| `display_name` | from `display_name` (default: `"Node-RED"`) |
| `container_image` | `"nodered/node-red:<application_version>"` (public Docker Hub image) |
| `image_source` | `"prebuilt"` — no custom build; image is used directly |
| `container_build_config` | `enabled = false`; all build fields null or empty |
| `container_port` | `1880` — Node-RED's native HTTP port |
| `database_type` | `"NONE"` — Node-RED requires no relational database |
| `db_name` | `""` |
| `db_user` | `""` |
| `enable_cloudsql_volume` | `false` — no Cloud SQL Auth Proxy |
| `cloudsql_volume_mount_path` | `"/cloudsql"` (unused; kept for API compatibility) |
| `gcs_volumes` | passed through from `var.gcs_volumes` (empty by default) |
| `container_resources` | CPU and memory limits from `cpu_limit` / `memory_limit` variables; requests not set |
| `min_instance_count` | from `min_instance_count` variable (default: `0`) |
| `max_instance_count` | from `max_instance_count` variable (default: `1`) |
| `environment_variables` | `NODE_RED_ENABLE_SAFE_MODE = "false"` merged with caller-supplied `environment_variables` (caller takes precedence) |
| `secret_environment_variables` | passed through from `var.secret_environment_variables` |
| `enable_postgres_extensions` | `false` |
| `postgres_extensions` | `[]` |
| `initialization_jobs` | normalised list from `var.initialization_jobs`; empty by default |
| `startup_probe` | from `var.startup_probe` — HTTP GET `/`, 30s initial delay, 5s timeout, 10s period, 3 failure threshold |
| `liveness_probe` | from `var.liveness_probe` — HTTP GET `/`, 30s initial delay, 5s timeout, 30s period, 3 failure threshold |

### `storage_buckets`

One GCS bucket for Node-RED application data (backups, exports):

| Field | Value |
|-------|-------|
| `name_suffix` | `"nodered-storage"` |
| `location` | from `deployment_region` variable (default: `"us-central1"`) |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `public_access_prevention` | `"inherited"` |

### `path`

Absolute path to the module directory. Wrapper modules use this to resolve `scripts/` relative to the Common module:

```hcl
scripts_dir = abspath("${module.nodered_app.path}/scripts")
```

---

## 4. Environment Variables

The module merges a fixed set of Node-RED defaults with caller-provided `environment_variables`. Caller-supplied values take precedence.

| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_RED_ENABLE_SAFE_MODE` | `"false"` | Ensures Node-RED starts in normal (not safe) mode, allowing flows to execute on startup. Set to `"true"` in `environment_variables` to start with flows disabled — useful for debugging a faulty flow without triggering it. |

All other Node-RED runtime configuration (e.g. `NODE_OPTIONS`, `NODE_RED_ENABLE_PROJECTS`, log levels) must be passed via the caller's `environment_variables` map.

**`NODE_RED_CREDENTIAL_SECRET`** is generated and injected by the Foundation Module — do not set it in `environment_variables`.

---

## 5. Container Image

Node-RED uses the official `nodered/node-red` image published on Docker Hub. No custom Dockerfile is bundled with this module. The image is selected at runtime using the `application_version` variable as the image tag:

```
nodered/node-red:<application_version>
```

Image mirroring into Artifact Registry is controlled by `enable_image_mirroring` in the wrapper module (default: `true`), which delegates the mirroring step to the Foundation Module.

---

## 6. No Initialization Jobs

Unlike database-backed applications, Node-RED requires no schema initialisation, user creation, or data seeding before first start. The `initialization_jobs` variable defaults to an empty list. Pass custom jobs only for specific post-deployment automation tasks such as importing a flow archive or configuring a custom palette.

---

## 7. Input Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"nodered"` | Internal application name; used as base for resource naming. |
| `application_version` | `string` | `"latest"` | Container image tag for `nodered/node-red`. |
| `display_name` | `string` | `"Node-RED"` | Human-readable display name for UI and dashboards. |
| `environment_variables` | `map(string)` | `{}` | Additional plain-text environment variables merged with module defaults. |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager references injected as environment variables. |
| `cpu_limit` | `string` | `"1000m"` | CPU limit for the container. |
| `memory_limit` | `string` | `"512Mi"` | Memory limit for the container. |
| `min_instance_count` | `number` | `0` | Minimum number of container instances. |
| `max_instance_count` | `number` | `1` | Maximum number of container instances. |
| `gcs_volumes` | `list(any)` | `[]` | GCS Fuse volume mount definitions. |
| `initialization_jobs` | `list(any)` | `[]` | One-time jobs to run during deployment. |
| `startup_probe` | `any` | HTTP `/`, 30s initial delay, 5s timeout, 10s period, 3 threshold | Startup probe configuration. |
| `liveness_probe` | `any` | HTTP `/`, 30s initial delay, 5s timeout, 30s period, 3 threshold | Liveness probe configuration. |
| `deployment_region` | `string` | `"us-central1"` | GCP region; used as the storage bucket location. |
| `tenant_deployment_id` | `string` | `"demo"` | Tenant identifier appended to resource names. |
| `deployment_id` | `string` | `""` | Unique deployment ID. |

---

## 8. Platform-Specific Differences

| Aspect | NodeRED_CloudRun | NodeRED_GKE |
|--------|------------------|-------------|
| `module_env_vars` passed to Foundation | `{}` (empty) | `{}` (empty) |
| `module_secret_env_vars` passed to Foundation | `{}` (empty — no auto-generated secrets) | `{}` (empty) |
| `deployment_region` source | not passed (Foundation auto-discovers region) | resolved from `module.network_discovery` before being passed |
| NFS | enabled by default (`enable_nfs = true`, mount at `/data`) | enabled by default (`enable_nfs = true`, mount at `/data`) |
| Scaling | Serverless; scale-to-zero supported (`min_instance_count = 0`) | Kubernetes Deployment; minimum 1 replica recommended |
| Credential secret | Managed by App_CloudRun via `database_password_length` | Managed by App_GKE via `database_password_length` |

---

## 9. Implementation Pattern

```hcl
# How NodeRED_CloudRun instantiates NodeRED_Common
module "nodered_app" {
  source = "../NodeRED_Common"

  deployment_id                = local.random_id
  application_name             = var.application_name
  application_version          = var.application_version
  display_name                 = var.display_name
  environment_variables        = var.environment_variables
  cpu_limit                    = var.cpu_limit
  memory_limit                 = var.memory_limit
  min_instance_count           = var.min_instance_count
  max_instance_count           = var.max_instance_count
  gcs_volumes                  = var.gcs_volumes
  initialization_jobs          = var.initialization_jobs
  startup_probe                = var.startup_probe
  liveness_probe               = var.liveness_probe
  tenant_deployment_id         = var.tenant_deployment_id
  secret_environment_variables = var.secret_environment_variables
}

# config and storage_buckets are passed to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = { nodered = module.nodered_app.config }
  module_env_vars        = {}
  module_secret_env_vars = {}
  module_storage_buckets = module.nodered_app.storage_buckets
  scripts_dir            = abspath("${module.nodered_app.path}/scripts")
  # ... other inputs
}
```
