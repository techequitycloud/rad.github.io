# LibreChat_Common

This document provides a reference for the `modules/LibreChat_Common` Terraform module — the shared application configuration layer consumed by both `LibreChat_CloudRun` and `LibreChat_GKE`.

---

## 1. Overview

`LibreChat_Common` is the **application-specific shared layer** for LibreChat deployments. It is not deployed directly by users; instead, it is called as a child module by `LibreChat_CloudRun` and `LibreChat_GKE`.

**Responsibilities:**
- Provisions and manages all LibreChat-specific Secret Manager secrets: `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MONGO_URI`, and optionally `SCRAM_PASSWORD` and `FIRESTORE_HOST`.
- Builds the `config` output consumed by the Foundation Module (`App_CloudRun` / `App_GKE`), assembling LibreChat environment variables, probe configuration, image settings, and resource limits.
- Manages MongoDB connectivity via three mutually exclusive paths:
  1. Explicit `mongodb_uri` (MongoDB Atlas, self-hosted).
  2. Manual Firestore configuration (`firestore_mongodb_host` + SCRAM credentials).
  3. Automatic Firestore ENTERPRISE database provisioning when no URI or host is supplied.
- Auto-injects a `init-firestore-scram-user` Cloud Run Job when Firestore is in use.
- Declares the `librechat-uploads` GCS bucket in `storage_buckets` output for the Foundation Module to provision.

---

## 2. Firestore MongoDB Auto-Provisioning

When neither `mongodb_uri` nor `firestore_mongodb_host` is supplied, `LibreChat_Common` follows a three-step discovery/creation pattern:

1. **Discovery** — scans for an externally-managed ENTERPRISE Firestore database labeled `managed-by=services-gcp`.
2. **Create if not found** — runs an idempotent `gcloud firestore databases create --edition=enterprise` command via a `null_resource`. Treats HTTP 409 (already exists) as success.
3. **Post-create info** — a `data "external"` source reads back the connection host after creation completes.

This pattern is resilient to partial applies: if the database was created in GCP but state was not saved, the script detects the existing database and skips creation rather than returning a 409 error.

> **Important:** Firestore ENTERPRISE databases are **never deleted on destroy** (ABANDON policy), matching Cloud SQL behaviour in the repo. This prevents data loss on `tofu destroy`.

---

## 3. Secrets Provisioned

| Secret Name | Purpose | Rotation |
|---|---|---|
| `<prefix>-creds-key` | 32-byte hex AES-GCM key for encrypting saved provider credentials (`CREDS_KEY`) | Manual |
| `<prefix>-creds-iv` | 16-byte hex IV for AES-GCM encryption (`CREDS_IV`) | Manual |
| `<prefix>-jwt-secret` | Signs user access tokens (`JWT_SECRET`). Rotation invalidates all active sessions. | Manual |
| `<prefix>-jwt-refresh-secret` | Signs long-lived refresh tokens (`JWT_REFRESH_SECRET`) | Manual |
| `<prefix>-mongo-uri` | Effective MongoDB connection string (`MONGO_URI`) | Manual |
| `<prefix>-scram-password` | SCRAM password for Firestore MongoDB user (Firestore path only) | Manual |
| `<prefix>-firestore-host` | Firestore connection host (Firestore path only). Stored as secret for plan-time stability. | N/A |

A `time_sleep` of 30 seconds is applied after all secret versions are created to allow Secret Manager global replication before dependent resources proceed.

---

## 4. Config Output

The `config` output is a Terraform object passed to the Foundation Module as part of `application_config`. Key fields:

| Field | Value |
|---|---|
| `container_image` | `ghcr.io/danny-avila/librechat` |
| `image_source` | `prebuilt` |
| `container_port` | `3080` |
| `database_type` | `NONE` |
| `enable_cloudsql_volume` | `false` |
| `environment_variables` | `HOST`, `NODE_ENV`, `APP_TITLE`, `TRUST_PROXY`, `ALLOW_REGISTRATION`, `ALLOW_SOCIAL_LOGIN`, `ALLOW_SOCIAL_REGISTRATION` plus caller-supplied extras |

---

## 5. Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID. |
| `resource_prefix` | `string` | `""` | Prefix for resource naming. Auto-calculated if empty. |
| `labels` | `map(string)` | `{}` | Labels applied to all resources. |
| `tenant_deployment_id` | `string` | — | Unique tenant/deployment identifier. |
| `deployment_id` | `string` | `""` | Random deployment ID suffix. |
| `application_name` | `string` | `'librechat'` | Application name. |
| `application_version` | `string` | `'latest'` | Container image version tag. |
| `region` | `string` | `'us-central1'` | GCP region. |
| `mongodb_uri` | `string` (sensitive) | `""` | Explicit MongoDB connection URI. Leave empty for Firestore auto-discovery. |
| `firestore_mongodb_host` | `string` | `""` | Manual Firestore endpoint override. |
| `firestore_mongodb_database` | `string` | `""` | Firestore database ID. Defaults to `'librechat'`. |
| `firestore_mongodb_username` | `string` | `""` | SCRAM username. Defaults to `'librechat'`. |
| `firestore_mongodb_password` | `string` (sensitive) | `""` | SCRAM password. Auto-generated when not set. |
| `app_title` | `string` | `'LibreChat'` | LibreChat UI title. |
| `allow_registration` | `bool` | `true` | Allow self-registration. |
| `allow_social_login` | `bool` | `false` | Enable social login providers. |
| `enable_image_mirroring` | `bool` | `true` | Mirror GHCR image to Artifact Registry. |
| `cpu_limit` | `string` | `'2000m'` | CPU limit. |
| `memory_limit` | `string` | `'2Gi'` | Memory limit. |
| `min_instance_count` | `number` | `1` | Minimum instances. |
| `max_instance_count` | `number` | `5` | Maximum instances. |
| `environment_variables` | `map(string)` | `{}` | Additional env vars merged with LibreChat defaults. |
| `initialization_jobs` | `list(any)` | `[]` | Custom jobs appended after the auto-injected Firestore SCRAM job. |
| `startup_probe` | `any` | `null` | Startup probe config. |
| `liveness_probe` | `any` | `null` | Liveness probe config. |
| `service_url` | `string` | `""` | Service URL for `DOMAIN_CLIENT` / `DOMAIN_SERVER` injection. |
| `impersonation_service_account` | `string` | `""` | SA for gcloud discovery commands. |
| `gcs_volumes` | `list(any)` | `[]` | GCS Fuse volumes. |
| `enable_cloudsql_volume` | `bool` | `false` | Always false — LibreChat does not use Cloud SQL. |

---

## 6. Outputs

| Output | Description |
|---|---|
| `config` | Application configuration object for the Foundation Module. |
| `secret_ids` | Map of env var name → Secret Manager secret ID for all auto-generated secrets. |
| `storage_buckets` | List containing the `librechat-uploads` bucket definition. |
| `secret_values` | Sensitive map of explicit secret values for `module_explicit_secret_values`. |
| `path` | Module source path (used to resolve `scripts_dir` in parent modules). |
