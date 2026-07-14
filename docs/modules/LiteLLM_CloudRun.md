---
title: "LiteLLM on Google Cloud Run"
description: "Configuration reference for deploying LiteLLM on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# LiteLLM on Google Cloud Run

LiteLLM is an open-source LLM proxy and AI gateway that provides a unified
OpenAI-compatible API across 100+ providers including OpenAI, Anthropic, Google
Gemini, Azure OpenAI, AWS Bedrock, and Ollama. Organizations use it to
centralize AI spend tracking, manage virtual API keys, enforce rate limits, and
gain full visibility over model usage. This module deploys LiteLLM on **Cloud
Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services LiteLLM uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

LiteLLM runs as a Python-based proxy container on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python proxy service, 1 vCPU / 2 GiB by default, request-based billing |
| Database | Cloud SQL for PostgreSQL 15 | Required — LiteLLM's Prisma ORM uses PostgreSQL for virtual keys and spend tracking |
| Object storage | Cloud Storage | Optional — no buckets created by default |
| Cache | Redis | Optional — reduces latency and cost for repeated identical LLM requests |
| Secrets | Secret Manager | Auto-generated master key and salt key; LLM provider API keys injected at runtime |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** LiteLLM's Prisma ORM requires PostgreSQL for
  virtual key management and spend tracking; changing the engine breaks startup.
- **A custom container image is built by Cloud Build.** The image embeds an
  `entrypoint.sh` that assembles `DATABASE_URL` from the `DB_*` environment
  variables injected by the foundation at runtime.
- **`LITELLM_MASTER_KEY` and `LITELLM_SALT_KEY` are auto-generated** and stored
  in Secret Manager. The salt key must never be rotated after virtual keys have
  been issued — all existing virtual keys would become permanently invalid.
- **`STORE_MODEL_IN_DB = "true"` is set automatically**, enabling runtime model
  management and the Admin UI without container restarts.
- **Redis is disabled by default.** Enable it for multi-instance deployments to
  share rate-limit counters and response caches.
- **The startup probe targets `/health/readiness`**, which validates database
  connectivity and confirms Prisma migrations have completed before the service
  is marked ready.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the LiteLLM service

LiteLLM runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency,
execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

LiteLLM stores all virtual keys, usage logs, cost records, and model routing
rules in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP).
On first deploy an initialization job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage

No storage buckets are created by default. Buckets can be declared via
`storage_buckets` and mounted via GCS Fuse using `gcs_volumes` — for example, to
deliver a `config.yaml` to the container without rebuilding the image.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis cache

Redis backs LiteLLM's optional response caching and shared rate-limit counters.
When `enable_redis = true`, the `REDIS_HOST`, `REDIS_PORT`, and (optionally)
`REDIS_PASSWORD` environment variables are injected into the service automatically.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

`LITELLM_MASTER_KEY` (the primary admin API key, prefixed `sk-`) and
`LITELLM_SALT_KEY` (used to hash virtual keys) are generated automatically and
stored in Secret Manager. LLM provider API keys are injected by referencing
pre-existing secrets via `secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master key:
  gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. LiteLLM Application Behaviour

- **First-deploy database setup.** An initialization job creates the LiteLLM
  database and user before the service starts. It is idempotent and connects to
  Cloud SQL through the Auth Proxy Unix socket.
- **Prisma migrations on start.** LiteLLM runs its Prisma ORM migrations on
  each instance start, so upgrading the version applies schema changes
  automatically. The startup probe waits until `/health/readiness` returns 200,
  confirming migrations are complete before routing traffic to the service.
- **Admin UI.** The LiteLLM Admin UI is available at `/ui` on the service URL.
  Authenticate with the `LITELLM_MASTER_KEY` (retrieve it from Secret Manager).
  From the UI you can add models, create virtual keys, set budgets, and view
  usage dashboards — all without redeploying the service.
- **Adding LLM provider keys.** Provider API keys are not managed by this
  module. Supply them at deploy time via `secret_environment_variables` (mapping
  each env var to a pre-existing Secret Manager secret), or add them after
  deployment via the Admin UI or the `/model/new` API endpoint using the master
  key.
- **Virtual key management.** Use the `/key/generate` API with the master key
  to issue per-team or per-user virtual keys with rate limits and spend budgets.
  These keys are stored in PostgreSQL and salted with `LITELLM_SALT_KEY`.

  ```bash
  # Retrieve the master key then create a virtual key:
  MASTER_KEY=$(gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT")
  curl -X POST "https://<service-url>/key/generate" \
    -H "Authorization: Bearer $MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d '{"key_alias": "team-a", "max_budget": 10.0}'
  ```
- **IAP and programmatic API calls.** IAP (`enable_iap = true`) requires a
  browser OAuth flow and blocks direct LLM API calls. Use IAP only if restricting
  access to the Admin UI; for API gateway use, prefer `ingress_settings =
  "internal"` with VPN or mutual authentication.
- **Health endpoints.** `/health/readiness` validates database connectivity and
  Prisma migration completion; `/health/liveliness` confirms the proxy process
  is running. These are used as the startup and liveness probes respectively.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for LiteLLM are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `litellm` | Base name for resources. Do not change after first deploy. |
| `display_name` | `LiteLLM AI Gateway` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `main-stable` | LiteLLM image version tag; pin to a specific release for production stability. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; do not shrink below 2Gi — LiteLLM OOM-crashes on startup below that. |
| `cpu_always_allocated` | `false` | Request-based billing by default — LiteLLM is a stateless proxy with no in-process background work. |
| `min_instance_count` | `0` | Minimum instances. Defaults to scale-to-zero; set ≥ 1 to eliminate cold starts on the API gateway. |
| `max_instance_count` | `3` | Maximum instances. |
| `container_port` | `4000` | LiteLLM's native port. |
| `execution_environment` | `gen2` | Cloud Run execution generation; gen2 is required for NFS and Direct VPC Egress. |
| `timeout_seconds` | `600` | Max request duration; increase for long-running LLM inference calls (max 3600). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for Unix socket connections. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service; set to `internal` for VPC-only API gateway use. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy (blocks direct API calls). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Extra non-secret settings. Core LiteLLM vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use to inject LLM provider API keys. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning.
See [App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision buckets declared in `storage_buckets`. |
| `storage_buckets` | `[]` | No buckets created by default. |
| `enable_nfs` | `false` | NFS is not required for LiteLLM; enable only for shared config file delivery. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts for config file delivery. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change; LiteLLM requires PostgreSQL 15. |
| `db_name` | `litellm_db` | Database name. Immutable after first deploy. |
| `db_user` | `litellm_user` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(set)_ | Additional env var names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in database setup job from LiteLLM_Common. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs for maintenance or housekeeping tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/health/readiness` | HTTP probe; validates DB connectivity and Prisma migrations before marking the service ready. |
| `liveness_probe` | `/health/liveliness` | HTTP probe; confirms the proxy process is running. |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check against `/health/liveliness`; enable explicitly to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for response caching and shared rate-limit counters. |
| `redis_host` | `""` | Redis endpoint; required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
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
| `database_type` | `POSTGRES_15` | Critical | LiteLLM requires PostgreSQL; changing the engine breaks the Prisma ORM and prevents startup. |
| `enable_cloudsql_volume` | `true` | Critical | The Auth Proxy sidecar is required for database connectivity; disabling it causes Prisma to fail at startup. |
| `LITELLM_SALT_KEY` | auto-generated, never rotated | Critical | Rotating the salt key invalidates every previously issued virtual key; all API consumers lose access immediately. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all virtual keys and spend data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `ingress_settings` | restrict for production | Critical | `"all"` exposes the master key endpoint publicly; use `"internal"` for VPC-only API gateway deployments. |
| `LITELLM_MASTER_KEY` | auto-generated | High | Treat as a credential; rotating it breaks all existing integrations holding the key until they are updated. |
| `enable_redis` | `true` for multi-instance | High | Without Redis, rate-limit counters are per-instance and not shared; quotas are not enforced across replicas. |
| `redis_host` | set when Redis enabled | High | An empty host with `enable_redis = true` causes connection errors on every request. |
| `min_instance_count` | `1` | High | Cold starts add 20–40 s latency and queue all dependent services. |
| `timeout_seconds` | `600` | High | Large language model inference can take minutes; too-short timeout causes 504 errors on slow models. |
| `enable_iap` | `false` for API endpoints | High | IAP blocks all direct programmatic API calls; only use IAP if accessing the Admin UI exclusively. |
| `execution_environment` | `gen2` | High | NFS mounts and Direct VPC Egress are gen2-only; downgrading breaks networking. |
| `application_version` | pin for production | Medium | LiteLLM releases frequently; unpinned versions may change the Prisma schema or break virtual key formats. |
| `NUM_WORKERS` | `1` (raise for throughput) | Medium | A single worker serialises all requests; increase to 2–4 and scale `cpu_limit` proportionally for high-traffic gateways. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_auto_password_rotation` | `false` unless ready | Medium | Enabling without adequate `rotation_propagation_delay_sec` can cause a race condition where the service restarts before the new password propagates. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. LiteLLM-specific application configuration
shared with the GKE variant is described in **[LiteLLM_Common](LiteLLM_Common.md)**.
