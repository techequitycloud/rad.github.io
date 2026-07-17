---
title: "N8N AI on Cloud Run"
description: "Configuration reference for deploying N8N AI on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# N8N AI on Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_AI_CloudRun.png" alt="N8N AI on Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n is an open-source workflow automation platform with a visual node-based interface for
connecting services, running logic, and building AI-powered pipelines. This module deploys
n8n on **Cloud Run v2** alongside two companion AI services — **Qdrant** (vector database
for RAG and semantic search) and **Ollama** (local LLM inference for privacy-first AI) — on
top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services n8n AI uses and how to explore and operate them from
the Google Cloud Console and the command line. For the mechanics common to every Cloud Run
application — service identity, ingress and load balancing, scaling and concurrency, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

n8n AI runs as a Node.js container on Cloud Run v2. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — n8n requires PostgreSQL; the engine is fixed |
| Shared files | Filestore (NFS) | Shared persistent volume for workflow data; default Redis host discovery |
| Object storage | Cloud Storage (GCS Fuse) | Shared AI data bucket mounted at `/mnt/gcs` |
| Cache & queue | Redis | Enabled by default; required for n8n queue mode (multi-instance) |
| Vector database | Qdrant (companion Cloud Run service) | Internal-only Cloud Run service; not publicly accessible |
| LLM inference | Ollama (companion Cloud Run service) | Internal-only Cloud Run service; not publicly accessible |
| Secrets | Secret Manager | Auto-generated `N8N_ENCRYPTION_KEY` and `N8N_SMTP_PASS` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional HTTPS load balancer + custom domain via Cloud Armor |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the common configuration;
  `database_type` defaults to `POSTGRES_15`. Changing it to MySQL breaks n8n startup.
- **`N8N_ENCRYPTION_KEY` is auto-generated** and stored in Secret Manager. Back it up before
  destroying the module — credentials encrypted with one key cannot be decrypted with a
  different key.
- **Qdrant and Ollama are separate Cloud Run services**, deployed in the same project and
  accessible only from within the VPC. They are not publicly reachable.
- **GCS Fuse persistence** keeps Qdrant's vector index and Ollama's model weights durable
  across container restarts and new revisions.
- **`min_instance_count` defaults to `0`** (scale-to-zero). Set to `1` for reliable webhook
  availability and to avoid cold-start latency for AI inference workflows.
- **Redis is enabled by default.** A single n8n instance can run without it, but multiple
  instances require Redis for safe distributed execution.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported
in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the n8n AI service and AI companions

n8n runs as a Cloud Run v2 service. Qdrant and Ollama each run as separate companion Cloud
Run services in the same project, accessible only internally via VPC.

- **Console:** Cloud Run → select each service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service n8nai-<tenant-id> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

n8n stores all workflow definitions, execution history, and credentials in a managed Cloud
SQL for PostgreSQL 15 instance. The service connects privately through the **Cloud SQL Auth
Proxy** sidecar over a Unix socket. On first deploy an initialization Job creates the
application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups,
and password rotation, see [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) and Cloud Storage (GCS Fuse)

**Filestore (NFS)** provides a shared persistent volume mounted into the n8n service for
workflow data and credential persistence across instances. It also doubles as the default
Redis discovery host when `redis_host` is empty.

**Cloud Storage** is mounted via GCS Fuse into all three services (n8n, Qdrant, Ollama) for
AI-specific data persistence:

- Qdrant's vector index at `/mnt/gcs/qdrant`
- Ollama's model weights at `/mnt/gcs/ollama/models`
- n8n workflow data at `/home/node/.n8n`

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<ai-data-bucket>/   # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for NFS mounts, GCS Fuse, and CMEK options.

### D. Redis queue backend

Redis backs n8n's queue mode, enabling reliable multi-instance workflow execution. When no
`redis_host` is configured and NFS is enabled, the NFS server IP is used. For production
with high availability, point to a Cloud Memorystore instance.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  gcloud run services describe n8nai-<tenant-id> \
    --project "$PROJECT" --region "$REGION" \
    --format='yaml(spec.template.spec.containers[0].env)'
  redis-cli -h <redis-host> ping
  ```

### E. Qdrant — vector database

Qdrant provides high-performance vector similarity search for RAG pipelines, document
embeddings, and AI memory within n8n workflows. It runs as an internal-only companion Cloud
Run service, reachable from n8n via the `QDRANT_URL` environment variable.

- **Console:** Cloud Run → select the Qdrant service.
- **CLI:**
  ```bash
  gcloud run services describe qdrant-<tenant-id> --project "$PROJECT" --region "$REGION"
  # Confirm QDRANT_URL in the n8n service
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Ollama — local LLM server

Ollama runs open-source language models (Llama 3, Mistral, Gemma) on your infrastructure,
enabling privacy-first AI inference without external API dependencies. It is an internal-only
Cloud Run service; `OLLAMA_HOST` is injected into n8n.

- **Console:** Cloud Run → select the Ollama service.
- **CLI:**
  ```bash
  gcloud run services describe ollama-<tenant-id> --project "$PROJECT" --region "$REGION"
  # Confirm OLLAMA_HOST in the n8n service
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### G. Secret Manager

The n8n encryption key and SMTP password are generated automatically and stored in Secret
Manager, then injected into the Cloud Run revision at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_CloudRun](App_CloudRun.md) for injection and rotation details.

### H. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer
with a custom domain (using Cloud Armor), Cloud CDN, and ingress/egress VPC controls can be
layered on. For public webhooks, `ingress_settings` must remain `"all"`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe n8nai-<tenant-id> \
    --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for custom domains and static IPs.

### I. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read n8nai-<tenant-id> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. N8N AI Application Behaviour

- **First-deploy database setup.** An initialization Job connects to Cloud SQL through the
  Auth Proxy Unix socket and creates the `n8n_db` PostgreSQL database and `n8n_user` user,
  grants full privileges, then shuts down the proxy cleanly. The job is idempotent and safe
  to re-run.
- **Encryption key.** `N8N_ENCRYPTION_KEY` is auto-generated on first deploy and stored in
  Secret Manager. **Back up this secret before destroying the module.** All n8n credentials
  (API keys, OAuth tokens, workflow passwords) are encrypted with this key; they cannot be
  decrypted after a re-deploy with a different key.
- **Health probes.** The startup probe targets `GET /` on port 5678 with a 120-second initial
  delay, giving n8n time to connect to PostgreSQL and load workflow state. Cloud Run will not
  route traffic until the startup probe succeeds.
- **Webhook and editor URLs.** `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to the
  predicted service URL before the revision is deployed so webhooks work without a post-deploy
  re-apply.
- **Queue mode.** When Redis is enabled, n8n operates in queue mode for reliable workflow
  execution across multiple instances. With a single instance (`max_instance_count = 1`),
  queue mode is optional.
- **Scale-to-zero and cold starts.** With `min_instance_count = 0`, instances shut down when
  idle. The first request after scale-down triggers a cold start that includes n8n
  initializing against the database — this can take 30–60 seconds. Set
  `min_instance_count = 1` to eliminate this delay.
- **SMTP password.** `N8N_SMTP_PASS` is auto-generated as a placeholder. Replace the secret
  value in Secret Manager with real SMTP credentials before enabling email sending.
- **Inspect Cloud Run Jobs:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for n8n AI are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour and defaults.

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
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `n8nai` | Base name for resources. **Do not change after first deploy.** |
| `application_display_name` | `N8N AI Starter Kit` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description annotation. |
| `application_version` | `2.4.7` | n8n image version tag; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per n8n instance. 2 vCPU recommended for AI workflows. |
| `memory_limit` | `4Gi` | Memory per n8n instance. 4 GiB minimum for AI workflows. |
| `min_instance_count` | `0` | Set to `1` for continuous webhook availability. `0` enables scale-to-zero. |
| `cpu_always_allocated` | `true` | Instance-based billing (CPU always on). Required — cron/schedule triggers and queue execution fire without an inbound request. |
| `max_instance_count` | `1` | Maximum instances. Increase only with Redis enabled. |
| `container_port` | `5678` | n8n listens on port 5678. Do not change. |
| `execution_environment` | `gen2` | Required for NFS mounts. Keep as `gen2`. |
| `timeout_seconds` | `300` | Max request duration; increase for long AI inference workflows. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `traffic_split` | `[]` | Split traffic across revisions for safe rollouts. |
| `max_revisions_to_retain` | `7` | Older revisions to keep in Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. **Must be `all` for public webhooks.** |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic routes through VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Note:** enabling IAP blocks public webhooks. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access when IAP is on. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP placeholders | Non-sensitive settings. Core n8n vars are auto-injected; do not set `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `QDRANT_URL`, or `OLLAMA_HOST`. |
| `secret_environment_variables` | `{}` | Secret Manager references. Use for external AI provider API keys. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before deploy. |
| `secret_rotation_period` | `2592000s` | Rotation notification period (30 days). |

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — NFS & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. |

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor HTTPS LB + WAF policy. |
| `application_domains` | `[]` | Custom hostnames; requires `enable_cloud_armor`. |
| `admin_ip_ranges` | `[]` | CIDRs with privileged access. |
| `enable_cdn` | `false` | Cloud CDN on the LB backend. |
| `max_images_to_retain` | `7` | Max container images retained per revision. |
| `delete_untagged_images` | `true` | Purge dangling/untagged images from Artifact Registry. |
| `image_retention_days` | `30` | Age-based image deletion threshold. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for workflow data and Redis host discovery. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `create_cloud_storage` | `true` | Provision GCS buckets. |
| `storage_buckets` | `[]` | Additional buckets beyond the auto-provisioned AI data bucket. |
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. n8n requires PostgreSQL. |
| `db_name` | `n8n_db` | PostgreSQL database name. **Immutable after first deploy.** |
| `db_user` | `n8n_user` | Application user. **Immutable after first deploy.** |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds after rotation to restart instances. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Aliases for connection details injected as additional env vars. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Cloud Run Jobs for workflow exports or maintenance. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` — 120s delay | n8n startup probe; allows DB connect + workflow load. |
| `liveness_probe` | HTTP `/` — 30s delay | n8n liveness probe. |
| `startup_probe_config` | TCP — enabled | App_CloudRun-standard startup probe. |
| `health_check_config` | HTTP — enabled | App_CloudRun-standard liveness probe. |
| `uptime_check_config` | disabled — `/` | Cloud Monitoring uptime check; disabled by default — enable it once the endpoint is publicly reachable. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 21 — Redis Queue Backend

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for n8n queue mode. **Required when `max_instance_count > 1`.** |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly for a Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — AI Components

| Variable | Default | Description |
|---|---|---|
| `enable_ai_components` | `true` | Master toggle. Set `false` to deploy n8n without Qdrant or Ollama. |
| `enable_qdrant` | `true` | Deploy Qdrant as an internal Cloud Run service. |
| `qdrant_version` | `latest` | Qdrant image tag. Pin to a specific version for production stability. |
| `enable_ollama` | `true` | Deploy Ollama as an internal Cloud Run service. |
| `ollama_version` | `latest` | Ollama image tag. Pin to a specific version for production stability. |
| `ollama_model` | `llama3.2` | Declared default model. Note: this variable is not currently forwarded to the Ollama service — models must be pulled separately at the Ollama API level. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `organization_id` | `""` | Required when `enable_vpc_sc = true`. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name for n8n. |
| `service_url` | Default `run.app` URL of the n8n service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS LB IP / URL (when Cloud Armor is enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets (including the AI data bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` (auto-generated) | Back up immediately | Critical | Changing after first run permanently destroys all saved n8n credentials. |
| `application_name` | `n8nai` — set once | Critical | Immutable after first deploy; renaming recreates all GCP resources with data loss. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming points n8n at a new empty database, losing all workflows. |
| `database_type` | `POSTGRES_15` | Critical | n8n requires PostgreSQL; changing to MySQL or NONE breaks startup. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job and blocks startup. |
| `enable_qdrant` | `true` | High | Active RAG workflows fail at runtime with connection errors if Qdrant is removed. |
| `enable_ollama` | `true` | High | Workflows using the local LLM node fail; only disable when using external AI providers exclusively. |
| `enable_redis` | `true` | High | Without Redis, multiple instances conflict on workflow state; split-brain execution corrupts runs. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but both `redis_host` and NFS are unset, n8n fails to start. |
| `memory_limit` | `4Gi` | High | AI workflows (embedding, vector search, LLM chaining) cause OOM kills below 4 GiB. |
| `ingress_settings` | `all` for public webhooks | High | `internal` or `internal-and-cloud-load-balancing` block external webhook delivery. |
| `max_instance_count` | `1` unless Redis configured | High | Scaling above 1 without Redis causes split-brain; increasing with Redis is safe. |
| `min_instance_count` | `1` for webhooks | Medium | `0` causes cold-start delays (30–60s); webhooks miss the first event during warmup. |
| `enable_nfs` | `true` | High | Without NFS, workflow data is not shared across instances and Redis host discovery fails. |
| `enable_iap` | only with valid OAuth creds | High | Enabling without `iap_authorized_users` / `iap_authorized_groups` blocks all access. IAP also blocks public webhooks. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `execution_environment` | `gen2` | High | `gen1` does not support NFS mounts; Filestore integration requires `gen2`. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency,
ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups,
and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. n8n AI-specific application
configuration shared with the GKE variant is described in
**[N8N_AI_Common](N8N_AI_Common.md)**.
