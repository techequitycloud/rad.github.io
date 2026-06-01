# Chroma Common

This document provides a reference for the `modules/Chroma_Common` internal sub-module. `Chroma_Common` is consumed by `Chroma_CloudRun` and `Chroma_GKE` — it is not deployed directly.

---

## 1. Purpose

`Chroma Common` assembles the Chroma-specific application configuration consumed by the foundation modules (`App CloudRun` / `App GKE`). It provides:

- The `config` output containing the full `chroma_module` object (image, environment variables, resource limits, probes, storage volumes)
- Optional Secret Manager provisioning for the Chroma authentication token
- The `storage_buckets` output describing the GCS data bucket (`<prefix>-data`)
- The `secret_ids` and `secret_values` outputs forwarded to the foundation as `module_secret_env_vars` and `module_explicit_secret_values`

---

## 2. Fixed Application Defaults

The following values are set by `Chroma Common` and cannot be overridden via Application Module variables:

| Setting | Value | Notes |
|---|---|---|
| `container_image` | `chromadb/chroma` | Official Chroma Docker Hub image |
| `container_port` | `8000` | Chroma REST API default port |
| `database_type` | `NONE` | Chroma is a self-contained store with no SQL dependency |
| `ANONYMIZED_TELEMETRY` | `false` | Telemetry disabled for privacy |
| `CHROMA_SERVER_HTTP_PORT` | `8000` | Explicit port to match container config |
| `enable_postgres_extensions` | `false` | Not applicable |
| `additional_services` | `[]` | No sidecar services by default |

---

## 3. Authentication Token

When `enable_auth_token = true`:

1. A 32-character random alphanumeric token is generated.
2. A Secret Manager secret `<wrapper_prefix>-auth-token` is created.
3. The token is stored as the secret's first version.
4. A 30-second `time_sleep` resource ensures propagation before dependent resources proceed.
5. The secret ID is exposed in `secret_ids` as `CHROMA_SERVER_AUTH_CREDENTIALS`.

The foundation module injects `CHROMA_SERVER_AUTH_CREDENTIALS` into the container as a Secret Manager-backed environment variable. Chroma then enforces token authentication on all API calls.

---

## 4. Storage Bucket

`Chroma Common` always outputs a storage bucket definition:

```
name_suffix: "chroma-data"
name: "<wrapper_prefix>-data"
mount_path: "/data"
```

The `enable_gcs_storage_volume` variable controls whether this bucket is mounted as a GCS FUSE volume. When `Chroma GKE` uses a StatefulSet PVC (`stateful_pvc_enabled = true`), the wrapper passes `enable_gcs_storage_volume = false` to avoid mounting both a PVC and a GCS FUSE volume at `/data` simultaneously.

---

## 5. Health Probes

Both the startup and liveness probes in the `config` object are hard-coded to target `/api/v2/heartbeat`:

```hcl
startup_probe  = merge(var.startup_probe,  { path = "/api/v2/heartbeat" })
liveness_probe = merge(var.liveness_probe, { path = "/api/v2/heartbeat" })
```

The path override is applied regardless of what the caller passes in — Chroma does not expose a configurable health path. Only the timing parameters (`initial_delay_seconds`, `timeout_seconds`, `period_seconds`, `failure_threshold`) can be adjusted from the Application Module.

---

## 6. Initialization Jobs

`Chroma Common` does **not** inject a default initialization job. Chroma manages its own embedded storage and requires no database bootstrap. If `var.initialization_jobs` is non-empty, the jobs are passed through to the foundation after normalizing all field types.

---

## 7. Outputs Reference

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full `chroma_module` config object for the foundation module |
| `secret_ids` | `map(string)` | `{ CHROMA_SERVER_AUTH_CREDENTIALS = "<secret-id>" }` (empty when auth disabled) |
| `secret_values` | `map(string)` | Raw token value for explicit injection (sensitive) |
| `storage_buckets` | `list(object)` | Single-element list with the Chroma data bucket definition |
| `path` | `string` | Module filesystem path for `scripts_dir` resolution |
