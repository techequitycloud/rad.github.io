---
title: "Ollama on Google Cloud Run"
description: "Configuration reference for deploying Ollama on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Ollama on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ollama_CloudRun.png" alt="Ollama on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ollama is an open-source LLM inference server that serves large language models — Llama,
Mistral, Gemma, Phi, and others — via a REST API. This module deploys Ollama on **Cloud
Run v2** (CPU-only, serverless) on top of the [App_CloudRun](App_CloudRun.md) foundation,
which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Ollama uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every Cloud
Run application — service identity, ingress and load balancing, scaling and concurrency,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather
than repeating them here.

---

## 1. Overview

Ollama runs as a containerised inference server on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 (gen2) | Ollama service, 4 vCPU / 8 GiB by default (3B models), request-based autoscaling |
| Model storage | Cloud Storage + GCS Fuse | Models bucket mounted at `/mnt/gcs`; weights persist across container restarts and new revisions |
| Secrets | Secret Manager | No app-managed secrets — Ollama requires no credentials |
| Ingress | Cloud Run URL (VPC-internal) | Default `internal` ingress; only services in the same VPC can reach the API |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Ollama is stateless beyond its GCS-backed model cache. Neither
  Cloud SQL nor Redis is provisioned.
- **GCS Fuse is the persistence layer.** Model weights are stored in a dedicated GCS bucket
  and mounted into the container at `/mnt/gcs` via GCS Fuse. Container restarts load models
  from GCS rather than re-downloading them.
- **`ingress_settings = "internal"` by default.** Ollama is designed as a shared VPC-internal
  inference endpoint called by other applications (Flowise, N8N, RAGFlow, Django). Setting
  `ingress_settings = "all"` exposes the unauthenticated API to the public internet — always
  pair with IAP in that case.
- **`execution_environment = "gen2"` is required** for GCS Fuse support and cannot be
  downgraded to gen1.
- **Automatic model pull.** When `default_model` is set and no custom `initialization_jobs`
  are provided, a Cloud Run Job named `model-pull` is created on first deployment and stores
  the model in the GCS bucket.
- **Three environment variables are always injected:** `OLLAMA_MODELS`, `OLLAMA_HOST`, and
  `OLLAMA_KEEP_ALIVE`. Do not override `OLLAMA_MODELS` or `OLLAMA_HOST` in
  `environment_variables`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported
in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Ollama service

Ollama runs as a Cloud Run v2 service (gen2) that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision; traffic
can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Send a test inference request from within the VPC:
  curl -s "$OLLAMA_API_URL/api/tags" | jq '.models[].name'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud Storage — model weight persistence

Ollama model weights are stored in a dedicated GCS bucket (named
`<resource_prefix>-models`) and mounted into the container via **GCS Fuse** at `/mnt/gcs`.
The environment variable `OLLAMA_MODELS` is set to `/mnt/gcs/ollama/models` so Ollama
discovers and caches models there.

- **Console:** Cloud Storage → Buckets → select the models bucket to browse downloaded model
  files.
- **CLI:**
  ```bash
  # Bucket name is in the Outputs (models_bucket)
  gcloud storage ls gs://<models-bucket>/ollama/models/
  gcloud storage buckets describe gs://<models-bucket> --project "$PROJECT"
  ```

The bucket name is reported as the `models_bucket` output. See
[App_CloudRun](App_CloudRun.md) for GCS Fuse, CMEK options, and lifecycle policies.

### C. Secret Manager

Ollama requires no application-managed credentials — there is no admin password and no
database password. Secret Manager is available for any custom secrets you inject via
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable by default only from within the same VPC (`ingress_settings =
"internal"`). Any Cloud Run service, GKE pod, or Compute Engine VM in the VPC can call the
Ollama API at the service URL on port 11434. An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be added for external access.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Ollama Application Behaviour

- **No first-deploy database setup.** Ollama has no database. There is no `db-init` job and
  no Cloud SQL instance.
- **Model pull on first deploy.** When `default_model` is set and `initialization_jobs` is
  empty, a Cloud Run Job named `model-pull` runs once. It starts a local Ollama server in the
  background, pulls the named model, stores it in the GCS bucket, then shuts down. The job
  mounts the `ollama-models` GCS volume so the weights persist. The timeout is controlled by
  `model_pull_timeout_seconds` (default 3600 seconds); large models (7B+) can take 20–30
  minutes on first pull.

  Inspect the job and its executions:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <model-pull-job-name> \
    --project "$PROJECT" --region "$REGION"
  ```

- **Cold-start model loading.** On each instance start, Ollama loads model weights from GCS
  Fuse. This typically takes 30–120 seconds depending on model size. The startup probe uses a
  30 s initial delay with 20 failure attempts (roughly 5 minutes) to accommodate this.
  `OLLAMA_KEEP_ALIVE` is set to `"24h"` so loaded models stay resident between requests.
  Override via `environment_variables`.
- **Automatically injected variables.** `OLLAMA_MODELS` (`/mnt/gcs/ollama/models`),
  `OLLAMA_HOST` (`0.0.0.0:11434`), and `OLLAMA_KEEP_ALIVE` (`24h`) are injected
  automatically. Do not override the first two; the third may be overridden.
- **Health endpoint.** The Ollama root path (`/`) responds with `"Ollama is running"` once
  the server is ready. Both startup and liveness probes target this path.
- **Additional tuning.** Use `environment_variables` to set `OLLAMA_NUM_PARALLEL` (default
  `1`, increase for concurrent callers), `OLLAMA_ORIGINS` (restrict CORS), and other Ollama
  environment variables.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Ollama are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `ollama` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Ollama LLM Server` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Ollama image tag; pin to a specific version (e.g., `0.3.12`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision storage and IAM without deploying the service. |
| `cpu_limit` | `4000m` | CPU per instance. 3B models: `"4000m"`; 7B models: `"8000m"`. Cloud Run max is `"8"`. |
| `memory_limit` | `8Gi` | Memory per instance. 3B models: `"8Gi"`; 7B models: `"16Gi"`. |
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid 60–120 s cold-start model-loading latency. |
| `max_instance_count` | `1` | Maximum instances. LLM inference is CPU-saturating; multiple instances increase cost. |
| `execution_environment` | `gen2` | **Must remain `"gen2"`** — required for GCS Fuse volume mounts. |
| `timeout_seconds` | `3600` | Maximum request duration. Large model inference can be slow; 3600 s is the Cloud Run maximum. |
| `container_protocol` | `http1` | HTTP protocol version. |
| `traffic_split` | `[]` | Traffic allocation across revisions for canary deployments. All entries must sum to 100. |
| `enable_image_mirroring` | `true` | Mirror `ollama/ollama` to Artifact Registry to avoid Docker Hub rate limits. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | **Keep `"internal"`** for VPC-only access. `"all"` exposes the unauthenticated API to the public internet. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Outbound traffic routing through VPC. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Required when `ingress_settings = "all"`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `enable_cloud_armor` | `false` | Attach a Cloud Armor WAF fronted by a Global HTTPS Load Balancer. |
| `application_domains` | `[]` | Custom domain names for the HTTPS load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS load balancer. |
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `OLLAMA_MODELS`, `OLLAMA_HOST`, and `OLLAMA_KEEP_ALIVE` are injected automatically. Use `OLLAMA_NUM_PARALLEL`, `OLLAMA_ORIGINS`, etc. here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 7 — Backup & Maintenance

Not applicable for Ollama — model weights are stored durably in GCS. These variables are
present for interface compatibility only. See [App_CloudRun](App_CloudRun.md).

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — NFS Instance & Custom Initialization

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty and set `default_model` to use the auto-generated model-pull job. Provide a non-empty list to replace it entirely. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs triggered by Cloud Scheduler. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision GCS buckets in `storage_buckets`. The models bucket is always created regardless. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the models bucket. |
| `enable_nfs` | `false` | Not required for Ollama (uses GCS Fuse). |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts. The `ollama-models` bucket at `/mnt/gcs` is always appended automatically. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 12 — Database Backend

Not applicable for Ollama. `database_type` is fixed to `"NONE"` — no Cloud SQL instance is
provisioned. These variables are present for interface compatibility only.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ type="HTTP", path="/", initial_delay_seconds=30, failure_threshold=20 }` | 20-attempt threshold allows ~5 minutes for model loading from GCS. |
| `liveness_probe` | `{ type="HTTP", path="/", initial_delay_seconds=60, failure_threshold=3 }` | 60 s delay avoids false restarts during model load. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |
| `max_revisions_to_retain` | `7` | **Not referenced** — declared for interface compatibility only; has no effect on this module's deployment. |

### Group 19 — Ollama Model Configuration

| Variable | Default | Description |
|---|---|---|
| `default_model` | `""` | Model to pull on first deployment (e.g., `"llama3.2:3b"`, `"mistral"`, `"llama3:8b"`). Leave empty to skip the auto-pull job. |
| `model_pull_timeout_seconds` | `3600` | Timeout for the model-pull Cloud Run Job. Large models (7B+) can take 20–30 minutes. Valid range: 300–7200. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `ollama_api_url` | Ollama REST API base URL — append `/api/generate`, `/api/chat`, etc. Constructed as `<service_url>/api`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `models_bucket` | GCS bucket name where Ollama model weights are persisted. |
| `storage_buckets` | All provisioned Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (including `model-pull` when triggered). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ingress_settings` | `internal` | Critical | `"all"` exposes the unauthenticated Ollama API publicly — any internet caller can query or load models. |
| `enable_iap` | `true` if `ingress_settings = "all"` | Critical | Without IAP, the API is unauthenticated and publicly reachable. Ollama has no built-in auth. |
| `memory_limit` | `8Gi` (3B) / `16Gi` (7B) | Critical | Insufficient memory causes OOM-kill mid-inference; container restarts in a loop. Allocate at least 2× the model's quantised weight size. |
| `execution_environment` | `gen2` (default) | High | Gen1 does not support GCS Fuse mounts. Downgrading silently prevents model persistence. |
| `cpu_limit` | `4000m` (3B) / `8000m` (7B) | High | Too few CPUs makes token generation extremely slow (minutes per token on 7B models). |
| `min_instance_count` | `1` | High | `0` enables scale-to-zero but causes 60–120 s cold starts while the model reloads from GCS. |
| `model_pull_timeout_seconds` | `3600` | High | A short timeout causes the model-pull Job to fail before the download completes for models over 2 GB. |
| `startup_probe.failure_threshold` | `20` (default) | High | Too low a threshold causes Cloud Run to kill and restart the container before Ollama is ready after GCS Fuse mount. |
| `timeout_seconds` | `3600` | High | LLM inference for large prompts can exceed 5 minutes. Requests to long-running generations are terminated with a 504 if too short. |
| `max_instance_count` | `1`–`3` | High | Each instance independently loads the model. Multiple instances are safe but significantly increase cost and GCS read traffic. |
| `default_model` | set to desired model | Medium | Leaving empty is safe for initial deploy but the API returns an error on all inference requests until a model is pulled manually. |
| `environment_variables.OLLAMA_NUM_PARALLEL` | `2`–`4` for shared use | Medium | Default `1` serialises all requests. Increase for shared VPC endpoints with concurrent callers. |
| `environment_variables.OLLAMA_KEEP_ALIVE` | `24h` (injected automatically) | Medium | Ollama's own default (`5m`) evicts models from memory, causing 30–60 s reload delays. The module injects `24h` automatically. |
| `environment_variables.OLLAMA_ORIGINS` | restrict for browser use | Medium | Ollama's default CORS policy accepts any origin. Restrict to specific UI origins when exposed through a load balancer. |
| `gcs_volumes` mount options | include `implicit-dirs` | Medium | Without `implicit-dirs`, GCS Fuse directory listings fail and Ollama cannot discover cached models. |
| `enable_image_mirroring` | `true` | Medium | Disabling pulls from Docker Hub, which is rate-limited. Keep `true` in production. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Ollama-specific
shared application configuration is described in **[Ollama_Common](Ollama_Common.md)**.
