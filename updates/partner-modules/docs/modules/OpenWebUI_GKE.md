# Open WebUI on Google Kubernetes Engine (GKE Autopilot)

This document provides a comprehensive reference for the `modules/OpenWebUI_GKE` Terraform module. It covers architecture, IAM, configuration variables, Open WebUI-specific behaviours, and operational patterns for deploying Open WebUI on GKE Autopilot.

---

## 1. Module Overview

Open WebUI is a self-hosted AI interface with 90,000+ GitHub stars, providing a polished ChatGPT-style frontend for Ollama, OpenAI-compatible APIs, and dozens of LLM providers. `OpenWebUI_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning and injects Open WebUI-specific application configuration via `OpenWebUI_Common`.

**Key Capabilities:**
*   **Compute**: GKE Autopilot, Kubernetes Deployment, 2 vCPU / 4 Gi by default. HPA scales from `min_instance_count = 0` to `max_instance_count = 3`.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15**. `OpenWebUI_Common` provisions a `db-init` job.
*   **IAM**: Workload Identity binds the Kubernetes SA to a GCP SA for Secret Manager and GCS access.
*   **AI Backend Integration**: `ollama_base_url` and `openai_api_base_url` variables configure backend connections.
*   **Security**: Inherits Cloud Armor, Binary Authorization, and VPC Service Controls from `App_GKE`. `WEBUI_SECRET_KEY` is auto-generated and stored in Secret Manager.
*   **No Redis**: Open WebUI persists sessions and application state in PostgreSQL. No Redis session store required.
*   **StatefulSet option**: PVC-backed StatefulSet is available via `stateful_pvc_enabled = true` if local file persistence is needed alongside PostgreSQL.
*   **Health**: Health probes target `/health`.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'openwebui'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'Open WebUI'` | Human-readable name. |
| `description` | 3 | `string` | `'Open WebUI — self-hosted AI interface...'` | Application description. |
| `application_version` | 3 | `string` | `'latest'` | Open WebUI image version tag. |

**Wrapper architecture:** `OpenWebUI_GKE` calls `OpenWebUI_Common` to produce the application configuration, then forwards `application_modules`, `module_secret_env_vars`, and `module_storage_buckets` to `App_GKE`. `enable_cloudsql_volume` is forwarded through to the OpenWebUI_Common call and merged into the config.

---

## 2. IAM & Access Control

Workload Identity binds the Kubernetes SA to a GCP SA, granting access to Secret Manager secrets (PostgreSQL password, `WEBUI_SECRET_KEY`) and GCS buckets. All IAM provisioning is delegated to `App_GKE`.

---

## 3. Core Service Configuration

### A. Compute (GKE Autopilot)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU for RAG workloads. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. |
| `min_instance_count` | 4 | `0` | Minimum pod replicas (HPA minReplicas). |
| `max_instance_count` | 4 | `3` | Maximum pod replicas (HPA maxReplicas). |
| `container_port` | 4 | `8080` | Open WebUI's HTTP port. |
| `enable_cloudsql_volume` | 4 | `true` | Cloud SQL Auth Proxy sidecar for PostgreSQL connection. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA for automatic resource adjustment. |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` (official image) or `'custom'` (build from source). |
| `container_image` | 4 | `""` | Container image URI override. Leave empty for the official image. |

### B. Open WebUI Settings

| Variable | Group | Default | Description |
|---|---|---|---|
| `ollama_base_url` | 5 | `""` | Base URL for the Ollama backend. Leave empty to disable direct integration. |
| `openai_api_base_url` | 5 | `""` | Base URL for an OpenAI-compatible API. |
| `default_user_role` | 5 | `'pending'` | Default role for new user registrations. |
| `enable_signup` | 5 | `true` | Allow new users to self-register. |
| `webui_auth` | 5 | `true` | Enable the login/authentication system. |

### C. Database (Cloud SQL — PostgreSQL 15)

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | — | `'openwebui_db'` | PostgreSQL database name. |
| `db_user` | — | `'openwebui_user'` | PostgreSQL application user. |

### D. Storage

| Variable | Group | Default | Description |
|---|---|---|---|
| `gcs_volumes` | — | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |

### E. Observability

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | — | `{ path="/health", initial_delay_seconds=30, failure_threshold=30 }` | Startup probe. |
| `liveness_probe` | — | `{ path="/health", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe. |

---

## 4. Integrations

### A. CI/CD

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `service_url` | URL of the Open WebUI deployment. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_password_secret` | Secret Manager secret name for the database password. |
