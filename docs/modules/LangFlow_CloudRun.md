---
title: "LangFlow on Google Cloud Run"
description: "Configuration reference for deploying LangFlow on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# LangFlow on Google Cloud Run

LangFlow is an open-source, low-code visual builder for AI agents and workflows,
built on LangChain — you assemble language-model chains, RAG pipelines, and agents by
dragging and wiring components on a canvas, then expose them as APIs. This module
deploys LangFlow on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services LangFlow uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

LangFlow runs as a single Python (FastAPI + React) container on Cloud Run v2. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python service on port **7860**, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — LangFlow persists all flows, components, and credentials in Postgres |
| Object storage | Cloud Storage | A `data` bucket is provisioned by default (`storage_buckets`) but left unmounted (`gcs_volumes = []`) — LangFlow keeps all application state in PostgreSQL |
| Cache & queue | Redis (optional) | Not required by LangFlow; wired for forward compatibility only |
| Secrets | Secret Manager | Auto-generated `LANGFLOW_SECRET_KEY` and `LANGFLOW_SUPERUSER_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer (`database_type = "POSTGRES_15"`); selecting any other engine
  breaks startup.
- **`LANGFLOW_SECRET_KEY` is generated automatically** and stored in Secret Manager.
  It encrypts every stored credential embedded in a flow. It must never be rotated
  after first boot — rotating it permanently breaks all stored credentials, which
  then have to be re-entered in each flow.
- **The admin account is provisioned from a generated password.**
  `LANGFLOW_AUTO_LOGIN = "false"` turns on authentication; LangFlow creates the initial
  admin (`admin` by default) using the `LANGFLOW_SUPERUSER_PASSWORD` secret. Retrieve
  it from Secret Manager to log in.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Cold starts add
  several seconds of latency — plus first-boot Alembic migrations on a fresh instance.
  Set `min_instance_count = 1` to keep the canvas warm for interactive editing.
- **`max_instance_count = 1` by default.** LangFlow keeps in-process session and flow
  state; run a single instance unless you have externalised state and understand the
  implications.
- **Public ingress by default.** `ingress_settings = "all"` exposes the `run.app` URL.
  Enabling IAP places Google sign-in in front of the whole service, including its API.
- **No NFS, and the default GCS bucket is unmounted.** All application state lives in
  PostgreSQL; NFS is off by default, and the auto-provisioned `data` bucket is not
  mounted into the container (`gcs_volumes = []`) — it exists for you to wire up only
  if a custom component needs object storage.
- **`LANGFLOW_DATABASE_URL` is composed at runtime** by the container entrypoint from
  the injected `DB_*` variables (TCP DSN, `sslmode=require` on Cloud Run) — you do not
  set it yourself.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the LangFlow service

LangFlow runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~langflow"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

LangFlow stores all application data (flows, components, credentials, run history,
users) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately over the instance **private IP** (the entrypoint composes a TCP DSN with
`sslmode=require`); the Cloud SQL Auth Proxy Unix socket is also mounted. On first
deploy an initialization Job creates the application database, role, and grants.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~langflow"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Redis (optional — not used by LangFlow)

Redis is **disabled by default** and LangFlow does not require it; the `enable_redis`
inputs are wired for forward compatibility only. Leave `enable_redis = false` unless a
future feature needs it.

- **CLI (only if enabled):**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager:
`LANGFLOW_SECRET_KEY` (encrypts all stored credentials) and
`LANGFLOW_SUPERUSER_PASSWORD` (the initial admin login password). The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~langflow"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. LangFlow Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs the
  Foundation's generic `db-init.sh` script using `postgres:15-alpine`. It waits for
  PostgreSQL, then idempotently creates the application role and database, sets
  ownership, and grants privileges on the database. It is safe to re-run.
- **Schema migrations on start.** LangFlow runs its **Alembic migrations on every
  container start**, so the tables are created and upgraded by the application itself —
  the `db-init` job only handles role/database/grants. Allow extra time on first boot.
- **`LANGFLOW_SECRET_KEY` is immutable after first boot.** It is generated once and
  written to Secret Manager. Changing it permanently breaks every stored credential
  embedded in a flow; they can no longer be decrypted. Only rotate during a planned
  maintenance window with a plan to re-enter credentials.
- **Initial admin account.** With `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow creates the
  superuser (`admin` by default, set via `langflow_username`) using the
  `LANGFLOW_SUPERUSER_PASSWORD` secret. Retrieve the password and log in:
  ```bash
  gcloud secrets versions access latest \
    --secret=<langflow-password-secret> --project "$PROJECT"
  ```
- **Database URL is composed at runtime.** The entrypoint builds `LANGFLOW_DATABASE_URL`
  from the injected `DB_*` vars over TCP (`DB_IP`, `sslmode=require` on Cloud Run) — do
  not set it manually unless you intend to override the whole DSN.
- **Health path.** Startup and liveness probes target **`/health`**, LangFlow's public
  liveness endpoint that returns `200` once the server is up. The default startup probe
  allows a 60-second initial delay plus a 60 × 10s (600s) failure window to cover
  first-boot component loading and Alembic migrations.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for LangFlow are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `langflow` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `LangFlow` | Human-readable name shown in the Console. |
| `application_version` | `latest` | LangFlow image version tag; pins base image `1.10.2` when `latest`. Pin explicitly in production. |
| `langflow_username` | `admin` | Initial superuser (admin) username; the password is auto-generated in Secret Manager. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | LangFlow is built from the wrapped image via Cloud Build. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; keep ≥ 1 GiB for the Python runtime. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to keep the canvas warm. |
| `max_instance_count` | `1` | Keep at `1` — LangFlow holds in-process state. |
| `container_port` | `7860` | LangFlow listens on port 7860. |
| `execution_environment` | `gen2` | Gen2 required for NFS/GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy socket mount. |
| `enable_image_mirroring` | `true` | Mirrors the container image into Artifact Registry before deployment. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` exposes the public `run.app` URL. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the whole service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged over the LangFlow defaults. Do not set `LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD`, or `LANGFLOW_DATABASE_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. LLM provider API keys). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

All other inputs follow standard App_CloudRun behaviour.

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated Cloud SQL backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & Initialization

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | One `data` bucket is declared by default; extend the list for custom components. |
| `enable_nfs` | `false` | NFS is off by default; LangFlow keeps state in PostgreSQL. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container (when NFS is enabled). |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — LangFlow requires PostgreSQL 15. |
| `application_database_name` | `langflowdb` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `langflowuser` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length. |
| `enable_postgres_extensions` / `postgres_extensions` | off | Optional Postgres extensions. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", image = "postgres:15-alpine", script_path = "scripts/db-init.sh", execute_on_apply = true }]` | Built-in job that creates the application role, database, and grants on first deploy. Override with a non-empty list to run different jobs. |
| `cron_jobs` | `[]` | Scheduled Cloud Run jobs (none required by LangFlow). |
| `additional_services` | `[]` | Sidecar/helper services deployed alongside LangFlow. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 60s delay, 60 × 10s failure window | Startup probe. The generous 600s window past the 60s delay accounts for LangFlow's first boot (loading all components + seeding starter projects before uvicorn binds — 2–4 minutes) as well as first-boot Alembic migrations. |
| `liveness_probe` | HTTP `/health`, 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/health`, enabled | App_CloudRun-level structured probe (parallel to `startup_probe`, which is passed to LangFlow_Common). |
| `health_check_config` | HTTP `/health`, enabled | App_CloudRun-level structured liveness probe (parallel to `liveness_probe`). |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check; enable for production monitoring. |
| `alert_policies` | `[]` | Metric alert policies. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache (optional)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used by LangFlow; wired for forward compatibility only. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis connection settings (only if enabled). |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_CloudRun behaviour.

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
| `storage_buckets` | Created Cloud Storage buckets (a `data` bucket by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`, and more. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `LANGFLOW_SECRET_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently breaks every stored credential embedded in a flow — they cannot be decrypted and must be re-entered. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all flows and credentials. |
| `database_type` | `POSTGRES_15` | Critical | LangFlow requires PostgreSQL 15; any other engine breaks startup. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `LANGFLOW_SUPERUSER_PASSWORD` (auto-generated) | Retrieve from Secret Manager | High | This is the admin login; losing it means no way to sign in until it is reset. |
| `memory_limit` | `2Gi` | High | Values below 1 GiB risk OOM kills for the Python runtime under load. |
| `max_instance_count` | `1` | High | LangFlow keeps in-process session/flow state; scaling beyond 1 splits state across instances and causes inconsistent behaviour. |
| `enable_iap` | only when API auth not needed externally | High | IAP puts Google sign-in in front of the whole service, including its programmatic API. |
| `container_port` | `7860` | High | LangFlow listens on 7860; a mismatched port fails all health probes. |
| `min_instance_count` | `1` for interactive use | Medium | Scale-to-zero (`0`) adds cold-start latency plus first-boot migration time on a fresh instance. |
| `enable_cloudsql_volume` | `true` | Medium | Disabling removes the socket mount; the entrypoint then relies solely on the private-IP TCP path. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The UI and API are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image building — see
**[App_CloudRun](App_CloudRun.md)**. LangFlow-specific application configuration shared
with the GKE variant is described in **[LangFlow_Common](LangFlow_Common.md)**.
