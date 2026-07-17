---
title: "ToolJet on Google Cloud Run"
description: "Configuration reference for deploying ToolJet on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# ToolJet on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_CloudRun.png" alt="ToolJet on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet is an open-source, low-code platform for building and deploying internal
tools — dashboards, admin panels, CRUD apps, and workflows — with a drag-and-drop
builder over your own databases and APIs. This module deploys ToolJet on **Cloud Run
v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services ToolJet uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

ToolJet runs as a single NestJS + React container on Cloud Run v2 — the backend API
and the compiled client are served from the same process (`SERVE_CLIENT = "true"`) on
port 80. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default; `min_instance_count = 1` keeps the in-process worker warm |
| Database | Cloud SQL for PostgreSQL 15 | Required — **two** databases on one instance (metadata + ToolJet Database) |
| ToolJet Database | In-container PostgREST | Serves the second DB (`tooljet_db`) to app queries; signed with `PGRST_JWT_SECRET` |
| Cache & queue | Redis | Enabled by default; backs ToolJet's BullMQ queues; NFS VM co-hosts Redis when `redis_host` is empty |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Two databases are created.** The first-deploy `db-init` job creates the metadata
  database (`tooljet`) and the second "ToolJet Database" (`tooljet_db`), and grants
  the shared application role the **`CREATEROLE`** attribute (ToolJet creates a role
  per workspace for PostgREST access).
- **Schema migrations run on start.** The container entrypoint runs
  `npm run db:migrate:prod` (TypeORM) **before** launching the server — ToolJet's
  `start:prod` does not migrate on its own.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, and `PGRST_JWT_SECRET` are generated
  automatically** and stored in Secret Manager. These keys must never be rotated
  after first boot — rotating `LOCKBOX_MASTER_KEY` makes every stored datasource
  credential undecryptable, and rotating `SECRET_KEY_BASE` invalidates all sessions.
- **Redis is enabled by default** (`enable_redis = true`) and, with an empty
  `redis_host`, the foundation injects the NFS server VM's IP as `REDIS_HOST`
  (`enable_nfs = true` provisions that VM).
- **Always-on, min=1.** ToolJet runs an in-process background worker, so
  `cpu_always_allocated = true` and `min_instance_count = 1` keep one instance warm.
- **Sign-up is disabled by default.** `DISABLE_SIGNUPS = "true"` ships on; first run
  is a **setup wizard** that creates the initial admin user and workspace.
- **Public ingress by default.** `ingress_settings = "all"` so the builder UI and
  any app webhooks are reachable; enabling IAP restricts access to Google identities.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the ToolJet service

ToolJet runs as a Cloud Run v2 service that autoscales by request load between the
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

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15 — two databases

ToolJet stores all application data — apps, datasource configs, users, workspaces,
sessions — in a managed Cloud SQL for PostgreSQL 15 instance, and uses a **second
database** (`tooljet_db`) on the same instance for the built-in ToolJet Database
feature. The service connects privately through the **Cloud SQL Auth Proxy** over a
Unix socket; no public IP is exposed. On first deploy an initialization Job creates
both databases, the shared `CREATEROLE` role, the `pgcrypto` extension, and an
app-owned `postgrest` schema.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet_db --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Redis (queue & cache)

Redis is **enabled by default** and backs ToolJet's BullMQ queues (background jobs,
notifications, and the multiplayer editor). When `redis_host` is left empty and
`enable_nfs = true`, the NFS server VM's private IP is injected as `REDIS_HOST`; set
`redis_host` explicitly to point at a Memorystore instance instead.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the injected host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager

Three cryptographic secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY_BASE` (signs sessions), `LOCKBOX_MASTER_KEY` (encrypts all stored
datasource credentials), and `PGRST_JWT_SECRET` (signs the internal PostgREST JWTs).
The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. `TOOLJET_HOST` (which drives generated
links and OAuth redirect URIs) defaults to the computed service URL and can be
overridden via `environment_variables` for a custom domain.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Storage & NFS

ToolJet stores apps, datasource configs, and uploads in PostgreSQL, so **no data
bucket is provisioned**. NFS is enabled by default only because its VM co-hosts Redis
when `redis_host` is empty; the ToolJet container itself is stateless.

- **Console:** Cloud Storage → Buckets; Compute Engine → VM instances (NFS server).
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. ToolJet Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the metadata database and the ToolJet Database, the shared `CREATEROLE`
  role, grants `cloudsqlsuperuser`, pre-creates `pgcrypto`, and resets the
  `postgrest` schema as app-owned. The job is safe to re-run.
- **Migrations run before the server starts.** `cloud-entrypoint.sh` runs
  `npm run db:migrate:prod` (TypeORM `migration:run`) first. ToolJet's `start:prod`
  is literally `node dist/src/main` and does **not** migrate — without the explicit
  step the metadata DB stays empty and every DB-backed action fails
  (`relation "user_sessions" does not exist`). The startup probe budget (30 × 15 s)
  absorbs this on first boot.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, and `PGRST_JWT_SECRET` are immutable
  after first boot.** Changing `LOCKBOX_MASTER_KEY` permanently corrupts all stored
  datasource credentials; changing `SECRET_KEY_BASE` invalidates all sessions. Only
  touch them in a planned maintenance window.
- **First run is a setup wizard.** With `DISABLE_SIGNUPS = "true"`, open the service
  URL and complete the wizard: it creates the first admin user and workspace, then
  lands you in the app builder. There is no pre-seeded admin credential in Secret
  Manager.
- **The ToolJet Database feature.** Apps can query a built-in no-code database
  (`tooljet_db`) exposed through an in-container PostgREST process. It reconfigures a
  `postgrest` schema on every start as the app user — which is why `db-init` resets
  that schema to be app-owned.
- **Health path.** Startup, liveness, and readiness probes target `/` — a
  public, unauthenticated endpoint. Allow several minutes on first boot for the
  migration step.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for ToolJet are listed; every other input is
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
| `application_name` | `tooljet` | Base name for resources. Do not change after first deploy. |
| `display_name` | `ToolJet` | Human-readable name shown in the Console. |
| `application_version` | `latest` | `tooljet/tooljet-ce` image tag; pin to a specific release in production. |
| `db_name` | `tooljet` | Metadata database name. Immutable after first deploy. |
| `db_user` | `tooljet` | Application database user (shared by both databases). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | ToolJet ships as a thin custom build on `tooljet/tooljet-ce`. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `1` | Keeps the in-process worker warm; do not set `0` unless the worker is externalised. |
| `max_instance_count` | `5` | Autoscaling upper bound. |
| `cpu_always_allocated` | `true` | Required — ToolJet's background worker runs without an inbound request. |
| `container_port` | `80` | ToolJet serves the API + client on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the ToolJet image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress for the builder UI and app endpoints. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET`, or `PG_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 10 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | One `data` bucket is declared by default; ToolJet itself is stateless and does not use it. |
| `enable_nfs` | `true` | On by default; its VM co-hosts Redis when `redis_host` is empty. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 11 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (both databases + `CREATEROLE` role). |
| `cron_jobs` | `[]` | Scheduled Cloud Scheduler + Cloud Run Jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60 s delay, 30 × 15 s | Startup probe. Wide budget for first-boot migrations. |
| `liveness_probe` | HTTP `/`, 30 s period | Liveness probe. |
| `startup_probe_config` / `health_check_config` | _(set)_ | Alternative structured probes. |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Backs ToolJet's BullMQ queues. Forwarded unchanged. |
| `redis_host` | `""` | Leave empty to use the NFS server IP (requires `enable_nfs = true`), or set a Memorystore endpoint. |
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
| `database_name` / `database_user` | Metadata database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty for ToolJet). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently corrupts every stored datasource credential — they cannot be decrypted and must all be re-entered. |
| `SECRET_KEY_BASE` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions, forcing immediate re-login for everyone. |
| `PGRST_JWT_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it breaks the ToolJet Database query layer until every instance restarts and PostgREST is reconfigured. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| App role `CREATEROLE` (set by `db-init`) | Leave as provisioned | High | Without it, ToolJet workspace creation fails `permission denied to create role`. |
| Schema migrations (entrypoint) | Leave as provisioned | High | Skipping `db:migrate:prod` leaves the metadata DB empty — the app boots and answers the `/` health probe but every DB-backed action fails. |
| `min_instance_count` | `1` | High | Setting `0` lets the in-process background worker be throttled to zero between requests, stalling queued jobs. |
| `cpu_always_allocated` | `true` | High | Request-based billing throttles the background worker between requests. |
| `memory_limit` | `4Gi` | High | ToolJet + PostgREST + worker under load can OOM below ~2 GiB. |
| `ingress_settings` | `all` | High | `internal` blocks the builder UI and any external app callbacks. |
| `enable_redis` | `true` | Medium | With Redis off, BullMQ falls back and background features degrade. |
| `redis_host` | `""` (NFS) or explicit | Medium | Redis on but NFS off and no host set leaves `REDIS_HOST` blank. |
| `DISABLE_SIGNUPS` (auto-injected `"true"`) | Keep on after first admin | High | Opening sign-up lets anyone with the URL create an account. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The builder UI is publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. ToolJet-specific application configuration
shared with the GKE variant is described in **[ToolJet_Common](ToolJet_Common.md)**.
