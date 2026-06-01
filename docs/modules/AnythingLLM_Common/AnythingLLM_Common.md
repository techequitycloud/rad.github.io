---
title: "AnythingLLM_Common"
sidebar_label: "AnythingLLM Common"
---

# AnythingLLM_Common

This document provides a reference for the `modules/AnythingLLM_Common` Terraform module. `AnythingLLM_Common` is an **internal shared module** called by both `AnythingLLM_CloudRun` and `AnythingLLM_GKE`. It is not intended to be called directly by users.

---

## 1. Module Overview

`AnythingLLM_Common` encapsulates all AnythingLLM-specific configuration that is shared between the Cloud Run and GKE deployment targets:

- **Secret generation**: Provisions `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, and `SIG_SALT` in Secret Manager.
- **Application config**: Builds the `config` local consumed by `AnythingLLM_CloudRun` and `AnythingLLM_GKE` via their `application_modules` locals.
- **Storage**: Returns a pre-configured `storage_buckets` list containing the `anythingllm-docs` GCS bucket definition.
- **Initialization jobs**: Supplies the default `db-init` Kubernetes/Cloud Run Job when `initialization_jobs` is left empty.
- **Environment variables**: Sets fixed values for `SERVER_PORT`, `STORAGE_DIR`, `UID`, and `GID`.

---

## 2. Secrets Provisioned

`AnythingLLM_Common` creates the following Secret Manager secrets on first apply:

| Secret | Environment Variable | Purpose |
|---|---|---|
| `<prefix>-jwt-secret` | `JWT_SECRET` | Signs AnythingLLM authentication tokens. |
| `<prefix>-auth-token` | `AUTH_TOKEN` | Optional API bearer token for programmatic access. |
| `<prefix>-sig-key` | `SIG_KEY` | HMAC signing key (32 alphanumeric characters). |
| `<prefix>-sig-salt` | `SIG_SALT` | HMAC salt (32 alphanumeric characters). |

All secrets are generated with `random_password` (32 characters, no special characters) and stored in Secret Manager with automatic replication. A `time_sleep` of 30 seconds delays the `secret_ids` output until Secret Manager has fully propagated the new versions. The `secret_ids` output is consumed by the Application Module and forwarded to `App_CloudRun` or `App_GKE` as `module_secret_env_vars`.

---

## 3. Fixed Environment Variables

The following environment variables are injected into every AnythingLLM container by `AnythingLLM_Common`:

| Variable | Value | Purpose |
|---|---|---|
| `SERVER_PORT` | `3001` | AnythingLLM HTTP port. Must match `container_port`. |
| `STORAGE_DIR` | `/app/server/storage` | AnythingLLM document and vector storage directory. |
| `UID` | `1000` | Container user ID. |
| `GID` | `1000` | Container group ID. |

> Do not override these variables via `environment_variables` in the Application Module — they are set by `AnythingLLM_Common` and the Application Module merges them before passing to the Foundation Module.

---

## 4. Default Initialization Job

When `initialization_jobs` is passed as an empty list (`[]`), `AnythingLLM_Common` supplies a single default job:

| Field | Value |
|---|---|
| `name` | `db-init` |
| `description` | `Create AnythingLLM Database and User` |
| `image` | `postgres:15-alpine` |
| `script_path` | `<module_path>/scripts/create-db-and-user.sh` |
| `execute_on_apply` | `true` |
| `cpu_limit` | `1000m` |
| `memory_limit` | `512Mi` |
| `timeout_seconds` | `600` |
| `max_retries` | `1` |

The `create-db-and-user.sh` script idempotently creates the AnythingLLM PostgreSQL database user and database. It connects to Cloud SQL via the Auth Proxy Unix socket (Cloud Run) or TCP `127.0.0.1` (GKE) and uses `ROOT_PASSWORD` from Secret Manager.

To replace the default job, pass a non-empty `initialization_jobs` list to the Application Module.

---

## 5. Storage Bucket

`AnythingLLM_Common` returns a single pre-configured storage bucket definition in its `storage_buckets` output:

| Field | Value |
|---|---|
| `name` | `<resource-prefix>-anythingllm-docs` |
| `name_suffix` | `anythingllm-docs` |
| `storage_class` | `STANDARD` |
| `force_destroy` | `true` |
| `public_access_prevention` | `inherited` |

The Application Module sets `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` to `module.anythingllm_app.storage_buckets[0].name` in `module_env_vars`.

---

## 6. Variables

`AnythingLLM_Common` accepts a subset of the variables from the Application Module. These are passed through from the caller — do not modify `AnythingLLM_Common` directly.

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. |
| `tenant_deployment_id` | `string` | `'demo'` | Deployment environment identifier. |
| `region` | `string` | `'us-central1'` | GCP region. |
| `deployment_id` | `string` | `""` | Unique deployment ID. |
| `resource_labels` | `map(string)` | `{}` | Labels applied to all resources. |
| `application_name` | `string` | `'anythingllm'` | Base name for resources and secrets. |
| `application_version` | `string` | `'latest'` | Container image version tag. |
| `display_name` | `string` | `'AnythingLLM'` | Human-readable application name. |
| `description` | `string` | `'AnythingLLM — Private AI Workspace and RAG Platform'` | Application description. |
| `db_name` | `string` | `'anythingllmdb'` | Database name used in the `db-init` script. |
| `db_user` | `string` | `'anythingllmuser'` | Database user created by the `db-init` script. |
| `cpu_limit` | `string` | `'2000m'` | CPU limit (forwarded to `container_resources`). |
| `memory_limit` | `string` | `'4Gi'` | Memory limit (forwarded to `container_resources`). |
| `min_instance_count` | `number` | `1` | Minimum instances/replicas. |
| `max_instance_count` | `number` | `1` | Maximum instances/replicas. |
| `startup_probe` | `object` | `{ enabled=true, path="/api/ping", initial_delay_seconds=60, ... }` | Startup probe configuration. |
| `liveness_probe` | `object` | `{ enabled=true, path="/api/ping", initial_delay_seconds=30, ... }` | Liveness probe configuration. |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables. Merged with fixed vars. |
| `enable_cloudsql_volume` | `bool` | `true` | Enables Cloud SQL Auth Proxy sidecar. |
| `initialization_jobs` | `list(any)` | `[]` | Custom initialization jobs. Empty triggers the default `db-init`. |

---

## 7. Outputs

| Output | Description |
|---|---|
| `config` | Full application configuration object consumed by Application Module `application_modules` local. |
| `storage_buckets` | List containing the `anythingllm-docs` bucket definition. |
| `secret_ids` | Map of environment variable names to Secret Manager secret IDs: `{ JWT_SECRET, AUTH_TOKEN, SIG_KEY, SIG_SALT }`. |
| `secret_values` | Map of secret plaintext values *(sensitive)*. Used for validation only — not consumed by Application Modules. |
| `path` | Absolute path to the `AnythingLLM_Common` module directory. Used by Application Modules to resolve `scripts_dir`. |
