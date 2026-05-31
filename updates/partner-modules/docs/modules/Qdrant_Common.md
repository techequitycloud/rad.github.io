# Qdrant_Common

This document provides a reference for the `modules/Qdrant_Common` internal sub-module. `Qdrant_Common` is consumed by `Qdrant_CloudRun` and `Qdrant_GKE` — it is not deployed directly.

---

## 1. Purpose

`Qdrant_Common` assembles the Qdrant-specific application configuration consumed by the foundation modules (`App_CloudRun` / `App_GKE`). It provides:

- The `config` output containing the full `qdrant_module` object (image, environment variables, resource limits, probes, storage volumes)
- Optional Secret Manager provisioning for the Qdrant API key
- The `storage_buckets` output describing the GCS storage bucket (`<prefix>-storage`)
- The `secret_ids` and `secret_values` outputs forwarded to the foundation as `module_secret_env_vars` and `module_explicit_secret_values`
- The `api_key_secret_id` output for downstream reference

---

## 2. Fixed Application Defaults

The following values are set by `Qdrant_Common` and cannot be overridden via Application Module variables:

| Setting | Value | Notes |
|---|---|---|
| `container_image` | `qdrant/qdrant` | Official Qdrant Docker Hub image |
| `container_port` | `6333` | Qdrant REST API port |
| `database_type` | `NONE` | Qdrant is a self-contained store with no SQL dependency |
| `QDRANT__STORAGE__STORAGE_PATH` | `/qdrant/storage` | Aligned with the GCS FUSE / PVC mount point |
| `QDRANT__SERVICE__HTTP_PORT` | `6333` | Explicit HTTP port |
| `enable_postgres_extensions` | `false` | Not applicable |
| `additional_services` | `[]` | No sidecar services by default |

**gRPC note:** `QDRANT__SERVICE__GRPC_PORT` is intentionally **not set** by `Qdrant_Common`. Neither the default GKE ClusterIP Service nor Cloud Run expose port 6334. If gRPC is needed on GKE, set `QDRANT__SERVICE__GRPC_PORT = "6334"` via `var.environment_variables` and add a second Service port manually.

---

## 3. API Key

When `enable_api_key = true`:

1. A 32-character random alphanumeric API key is generated via `random_password`.
2. A Secret Manager secret `<wrapper_prefix>-api-key` is created.
3. The key is stored as the secret's first version.
4. A 30-second `time_sleep` resource ensures propagation before dependent resources proceed.
5. The secret ID is exposed in `secret_ids` as `QDRANT__SERVICE__API_KEY`.

The foundation module injects `QDRANT__SERVICE__API_KEY` into the container as a Secret Manager-backed environment variable. Qdrant then enforces API key authentication on all REST and gRPC calls.

---

## 4. Storage Bucket

`Qdrant_Common` always outputs a storage bucket definition:

```
name_suffix: "qdrant-storage"
name: "<wrapper_prefix>-storage"
mount_path: "/qdrant/storage"
```

The `enable_gcs_storage_volume` variable controls whether this bucket is mounted as a GCS FUSE volume. When `Qdrant_GKE` uses a StatefulSet PVC (`stateful_pvc_enabled = true`), the wrapper passes `enable_gcs_storage_volume = false` to avoid mounting both a PVC and a GCS FUSE volume at `/qdrant/storage` simultaneously.

The bucket location is left empty so the foundation resolves it to the auto-discovered deployment region. This matches the tested pattern for Qdrant and preserves region alignment across deployments.

---

## 5. Health Probe Endpoints

Qdrant exposes two distinct health endpoints:

| Endpoint | Purpose | Used by |
|---|---|---|
| `/readyz` | Readiness — reports ready once all collections are fully loaded | Startup probe |
| `/livez` | Liveness — dedicated liveness endpoint, unaffected by collection load state | Liveness probe |

**Critical:** Do **not** use `/readyz` for liveness probes. Qdrant marks itself not-ready while loading large collections from storage. If `/readyz` is the liveness target, Kubernetes will interpret the temporary not-ready state as a container failure and issue spurious restarts, creating a restart loop.

---

## 6. Initialization Jobs

`Qdrant_Common` does **not** inject a default initialization job. Qdrant manages its own embedded storage and requires no database bootstrap. If `var.initialization_jobs` is non-empty, the jobs are passed through to the foundation after normalizing all field types.

---

## 7. Outputs Reference

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full `qdrant_module` config object for the foundation module |
| `secret_ids` | `map(string)` | `{ QDRANT__SERVICE__API_KEY = "<secret-id>" }` (empty when API key disabled) |
| `secret_values` | `map(string)` | Raw API key value for explicit injection (sensitive) |
| `api_key_secret_id` | `string` | Secret Manager secret ID for the API key (empty when disabled) |
| `storage_buckets` | `list(object)` | Single-element list with the Qdrant storage bucket definition |
| `path` | `string` | Module filesystem path for `scripts_dir` resolution |
