---
title: "Open WebUI on Google Cloud Run"
description: "Configuration reference for deploying Open WebUI on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Open WebUI on Google Cloud Run

Open WebUI is a self-hosted AI interface providing a polished ChatGPT-style frontend for
Ollama, OpenAI-compatible APIs, and dozens of other LLM providers. This module deploys
Open WebUI on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation,
which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Open WebUI uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Open WebUI runs as a Python web container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python web service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — sessions, conversations, and RAG data all live here |
| Shared files | Filestore (NFS) | Optional — needed only when multiple instances share uploaded files |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated `WEBUI_SECRET_KEY` and database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** Open WebUI does not support MySQL or any other engine;
  the database type is fixed internally.
- **No Redis.** Open WebUI persists sessions and all application state in PostgreSQL.
  The `enable_redis` variable defaults to `false` and no Redis environment variables
  are injected.
- **`WEBUI_SECRET_KEY` is auto-generated** and stored in Secret Manager. It signs all
  user sessions; rotating it invalidates every active session simultaneously. Treat it
  as immutable after first use.
- **New users require admin approval by default.** `default_user_role = "pending"`
  means self-registered accounts cannot access the UI until an admin promotes them.
- **Scale-to-zero is enabled.** `min_instance_count` defaults to `0`; set it to `1`
  for a warm instance in interactive team deployments.
- **Health probes target `/health`.** Open WebUI exposes this path natively; both
  startup and liveness probes use HTTP against it.
- **`DATABASE_URL` is assembled automatically.** The custom entrypoint constructs it
  from the platform-injected `DB_*` environment variables — do not set it manually.
- **Gen2 execution environment is required** for NFS mounts and Direct VPC Egress.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Open WebUI service

Open WebUI runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Open WebUI stores all application data — user accounts, conversations, RAG indices,
and uploaded document embeddings — in a managed Cloud SQL for PostgreSQL 15 instance.
The service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket
(no public IP). On first deploy an initialization Job creates the application database
and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
    --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`openwebui-data`) is provisioned automatically
for Open WebUI's backend data directory. The workload service account is granted access
automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Filestore (NFS) — optional shared storage

NFS is enabled by default. It provides shared persistent storage across all instances,
which is important when running more than one instance and uploaded files must be
visible everywhere. NFS requires the Gen2 execution environment.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount and Gen2 requirements.

### E. Secret Manager

`WEBUI_SECRET_KEY` (session signing key) and the database password are stored in
Secret Manager and injected into the service at runtime; plaintext never appears in
configuration or logs.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Open WebUI Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs
  `postgres:15-alpine` against the Cloud SQL instance through the Auth Proxy. It
  idempotently creates the application database and user before the service starts.
- **Database migrations on start.** Open WebUI runs its own Alembic schema migrations
  on every startup, so upgrading `application_version` applies any new schema changes
  automatically. On first boot this can take 30–60 seconds.
- **`DATABASE_URL` assembly.** The custom entrypoint (`entrypoint.sh`) assembles the
  `DATABASE_URL` from the platform-injected `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and
  `DB_NAME` environment variables. The password is URL-encoded to handle special
  characters. Do not override `DATABASE_URL` directly.
- **`WEBUI_SECRET_KEY` is immutable.** The key signs all user sessions. Rotating it
  immediately logs out every active user and invalidates all remember-me tokens.
  Treat it as permanent after the first login.
- **AI backend connection.** Open WebUI connects to an Ollama instance or an
  OpenAI-compatible API at startup. If neither `ollama_base_url` nor
  `openai_api_base_url` is configured, the UI starts but has no AI backend — all model
  inference requests fail. Supply API keys (e.g. `OPENAI_API_KEY`) via
  `secret_environment_variables`, not `environment_variables`.
- **User registration flow.** With `default_user_role = "pending"` (the default) all
  self-registered accounts must be promoted by an admin before they can use the UI.
  The first admin account must be created directly through the signup page on first
  boot.
- **Health path.** Both startup and liveness probes use HTTP against `/health`, which
  returns 200 once the application and database connection are ready. The startup probe
  allows up to 300 seconds (30 failures × 10-second period) for first-boot migration
  to complete.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Open WebUI are listed; every other input is
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
| `application_name` | `openwebui` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Open WebUI` | Friendly name shown in the Console. |
| `description` | `Open WebUI — self-hosted AI interface for Ollama and OpenAI-compatible APIs` | Service description. |
| `application_version` | `latest` | Open WebUI image version tag. Pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended for RAG workloads. |
| `memory_limit` | `4Gi` | Memory per instance; 4 GiB recommended (RAG pipelines can use 3–6 GiB). |
| `min_instance_count` | `0` | Minimum instances; set `1` to keep a warm instance for interactive use. |
| `max_instance_count` | `3` | Maximum instances. |
| `container_port` | `8080` | Open WebUI's HTTP port (matches the official image's `EXPOSE`). |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts and Direct VPC Egress. |
| `timeout_seconds` | `300` | Max request duration. Increase to `600`–`3600` for document ingestion or slow LLM backends. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — must be `true` when connecting to Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror the Open WebUI image into Artifact Registry (avoids GHCR rate limits). |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. |

### Group 5 — Open WebUI Settings & Access

| Variable | Default | Description |
|---|---|---|
| `ollama_base_url` | `""` | Base URL for the Ollama backend (e.g. `http://ollama:11434`). Leave empty if not using Ollama directly. |
| `openai_api_base_url` | `""` | Base URL for an OpenAI-compatible API (e.g. `https://api.openai.com/v1`). Must include `/v1` suffix. |
| `default_user_role` | `pending` | Role assigned to new self-registered accounts. `pending` requires admin approval; `user` grants immediate access. |
| `enable_signup` | `true` | Allow the signup page. Set `false` after admin accounts are created in production. |
| `webui_auth` | `true` | Enable the login form. Only set `false` for single-user or fully air-gapped deployments. |
| `ingress_settings` | `all` | Which traffic sources may reach the service (`all`, `internal`, `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not override `DATABASE_URL` or `WEBUI_SECRET_KEY`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `OPENAI_API_KEY` and similar sensitive values. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

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
| `enable_nfs` | `true` | Shared Filestore volume — needed when multiple instances share uploaded files. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` | `[]` | Additional buckets beyond the automatically provisioned data bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts for extra bucket-backed directories. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Open WebUI requires PostgreSQL 15. |
| `db_name` | `openwebui_db` | Database name. Immutable after first deploy. |
| `db_user` | `openwebui_user` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Open WebUI has no required scheduled commands; add any app-specific recurring tasks here. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 30s delay, 5s timeout, 10s period, 30 retries | Allows up to ~5 minutes for first-boot startup. |
| `liveness_probe` | HTTP `/health`, 60s delay, 5s timeout, 30s period, 3 retries | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Redis is not needed — Open WebUI persists all state in PostgreSQL. |
| `redis_host` | `""` | Redis endpoint (only relevant if `enable_redis` is set to `true`). |

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
| `enable_cloudsql_volume` | `true` | Critical | Disabling breaks all database connections when using Cloud SQL. Only disable when connecting to an external PostgreSQL over TCP. |
| `WEBUI_SECRET_KEY` (auto-generated) | immutable after first use | Critical | Rotating the key immediately logs out every active user and invalidates all remember-me tokens. |
| `webui_auth` | `true` | Critical | Disabling removes the login form — anyone who can reach the URL has full admin access with no credentials. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; changing recreates the database/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `database_type` (fixed) | `POSTGRES_15` | Critical | Open WebUI requires PostgreSQL; any other engine breaks migrations and startup. |
| `ollama_base_url` / `openai_api_base_url` | at least one set | High | Without a backend URL, Open WebUI starts but all model inference requests fail immediately. |
| `default_user_role` | `pending` | High | `user` auto-approves all self-registrations; on a publicly exposed service this allows unrestricted sign-up. |
| `enable_signup` | `true` (set `false` in prod after onboarding) | High | Combined with `default_user_role = "user"`, any visitor can self-register and access all models. |
| `memory_limit` | `4Gi` | High | RAG pipelines can consume 3–6 GiB under load; insufficient memory causes OOM kills mid-ingestion. |
| `backup_schedule` | `0 2 * * *` | High | Without automated backups, the PostgreSQL database (users, conversations, RAG data) is unprotected. |
| `ingress_settings` | restrict in prod | High | `all` exposes the UI to the public internet — combine with `webui_auth = true` and `default_user_role = "pending"`. |
| `execution_environment` | `gen2` | High | NFS mounts and Direct VPC Egress are not supported in gen1. |
| `application_version` | pinned release in prod | Medium | `latest` risks an unintended upgrade with a schema change that crashes startup. |
| `min_instance_count` | `1` for interactive use | Medium | `0` adds 20–40 s cold-start latency when the first request arrives. |
| `enable_nfs` | `true` when `max_instance_count > 1` | Medium | Without shared storage, uploaded files are instance-local and invisible to other replicas. |
| `timeout_seconds` | `300` (raise for RAG/LLM) | Medium | Document ingestion and large model responses are cut off at the Cloud Run timeout. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | Without them, the UI is publicly reachable with only Open WebUI's built-in auth as a gate. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Open WebUI-specific application configuration shared
with the GKE variant is described in **[OpenWebUI_Common](OpenWebUI_Common.md)**.
