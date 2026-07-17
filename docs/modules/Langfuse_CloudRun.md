---
title: "Langfuse on Google Cloud Run"
description: "Configuration reference for deploying Langfuse on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Langfuse on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Langfuse_CloudRun.png" alt="Langfuse on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Langfuse is an open-source, MIT-licensed LLM engineering and observability platform —
tracing, prompt management, evaluations, and metrics for applications built on large
language models. This module deploys Langfuse on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Langfuse uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Langfuse runs as a Next.js container on Cloud Run v2. This module deploys the **v2 line**
(Postgres-only); Langfuse v3 additionally requires ClickHouse, Redis, and S3 and is out of
scope. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js service, 2 vCPU / 4 GiB by default, serverless autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Langfuse v2 does not support MySQL or other engines |
| Object storage | Cloud Storage | A dedicated bucket provisioned automatically; optional NFS share for exports |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `SALT`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Langfuse v2 (Postgres-only) is pinned.** The image is built `FROM langfuse/langfuse:2`
  via the `LANGFUSE_VERSION` build ARG. Even `application_version = "latest"` resolves to
  `2`. Deploying v3 would require ClickHouse + Redis + S3 that this module does not provision.
- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared application
  layer; selecting any other engine breaks startup.
- **`NEXTAUTH_SECRET` and `SALT` are generated automatically** and stored in Secret Manager.
  Langfuse's zod env validation refuses to boot without both — `NEXTAUTH_SECRET` signs the
  session JWTs and `SALT` hashes API keys. Rotating them invalidates sessions / stored API
  keys.
- **Prisma migrations run on every start.** The cloud entrypoint composes `DATABASE_URL`
  from the injected `DB_*` vars, then hands off to Langfuse's own startup, which runs
  `prisma migrate deploy`. The `db-init` job only creates the role and database.
- **The first user to sign up becomes the owner.** `AUTH_DISABLE_SIGNUP = "false"` is
  injected; there is no pre-seeded admin credential. Disable sign-up after onboarding.
- **`min_instance_count = 1` with `cpu_always_allocated = true`.** One instance stays warm so
  Langfuse's background processing (batched ingestion, scheduled work) keeps running between
  requests; CPU is not throttled to zero while idle.
- **Public ingress is the default.** `ingress_settings = "all"` so the UI and the
  ingestion/API endpoints are reachable by your LLM app's SDK clients. Enabling IAP will
  block unauthenticated SDK traffic.
- **No Redis.** Langfuse v2 uses a PostgreSQL-backed queue and cache; `enable_redis` stays
  `false`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Langfuse service

Langfuse runs as a Cloud Run v2 service that autoscales by request load between the minimum
and maximum instance counts. Each deployment creates an immutable revision; traffic can be
split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Langfuse stores all application data (traces, observations, scores, prompts, users,
projects, API keys) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed.
On first deploy an initialization Job creates the application role and database; Langfuse
then applies its schema via `prisma migrate deploy` on start.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See
[App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket is provisioned automatically. Langfuse v2 keeps all
trace and observability data in PostgreSQL; the bucket (and the optionally-mounted NFS share)
are available for exports and media rather than primary state.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`NEXTAUTH_SECRET` (signs the auth session JWTs) and `SALT` (hashes API keys). Both are
injected as secret env vars and are required at boot. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public access
your LLM app's SDK clients need to POST traces to the ingestion API. An external HTTPS load
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

## 3. Langfuse Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently creates
  the application role and database and grants privileges. It does **not** create tables — the
  job is safe to re-run.
- **Prisma migrations on start.** The cloud entrypoint composes `DATABASE_URL` and then
  delegates to Langfuse's own startup, which runs `prisma migrate deploy` before launching the
  server. Upgrading the application version therefore applies schema changes without a separate
  migration step — allow extra time on the first boot after an upgrade.
- **`NEXTAUTH_SECRET` and `SALT` are immutable after first boot.** They are generated once and
  written to Secret Manager. Changing `NEXTAUTH_SECRET` invalidates all active sessions;
  changing `SALT` permanently invalidates all existing API keys (SDK clients then get `401`).
  Only rotate during a planned maintenance window.
- **First user is the owner.** On first visit, the Langfuse sign-up page creates the initial
  account, which becomes the instance owner (no seeded credential). After onboarding, set
  `AUTH_DISABLE_SIGNUP = "true"` in `environment_variables` and apply via **Update** to prevent
  further self-service registration.
- **Ingestion endpoints.** The default `ingress_settings = "all"` lets your LLM app's SDK
  clients POST traces to the public ingestion API. Enabling IAP blocks these unauthenticated
  calls — keep IAP off if SDKs must reach the service, or authorize the callers explicitly.
- **Health path.** Startup and liveness probes default to `/` in `variables.tf` — not the app's
  dedicated `/api/public/health` endpoint, which is not wired in as the default. Allow a generous
  window on first boot (the startup probe uses a wide failure threshold and a 60s initial delay)
  so Prisma migrations finish; consider overriding `path` to `/api/public/health` for a more
  precise readiness signal.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Langfuse are listed; every other input is inherited from
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
| `application_name` | `langfuse` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Langfuse Helpdesk` | Human-readable name shown in the Console. Leftover clone-rot text in `variables.tf` (Langfuse is an LLM observability platform, not a helpdesk) — override with e.g. `"Langfuse"` for an accurate display name. |
| `description` | `Langfuse - Open-source helpdesk and customer support platform` | Service description. Same clone-rot leftover as `display_name` — override for an accurate description. |
| `application_version` | `2` | Langfuse image tag. Pinned to the v2 (Postgres-only) line. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Langfuse builds a thin wrapper image from `langfuse/langfuse:2`. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance; minimum 2 GiB. |
| `cpu_always_allocated` | `true` | Keep CPU allocated so background processing runs between requests. |
| `min_instance_count` | `1` | Keeps one instance warm for background processing. |
| `max_instance_count` | `5` | Autoscaling upper bound. |
| `container_port` | `3000` | Langfuse (Next.js) listens on port 3000. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Langfuse image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for public SDK ingestion endpoints. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks unauthenticated SDK ingestion.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `NEXTAUTH_SECRET`, `SALT`, or `DATABASE_URL` here — they are managed by the module. Set `AUTH_DISABLE_SIGNUP = "true"` here after onboarding. |
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
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets to provision. |
| `enable_nfs` | `true` | Mount an NFS share at `/opt/langfuse/storage` for optional exports/media. |
| `nfs_mount_path` | `/opt/langfuse/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 11 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Langfuse requires PostgreSQL. |
| `db_name` | `langfuse` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `langfuse` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Cloud Scheduler + Cloud Run Jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, wide failure threshold | Startup probe. Allow generous time for first-boot Prisma migrations. |
| `liveness_probe` | HTTP `/`, 60s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Alternative structured probes. |
| `uptime_check_config` | `{ enabled=false }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Langfuse v2 uses a PostgreSQL-backed queue and cache — leave `false`. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only used if externalizing to Redis. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions, forcing immediate re-login for everyone. |
| `SALT` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently invalidates all existing API keys — every SDK client using them gets `401` until re-keyed. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all trace data. |
| `application_version` | `2` (v2 line) | Critical | Setting a v3 tag points the build at an image needing ClickHouse + Redis + S3 that this module does not provision — the service fails to start. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup fails the import job. |
| `memory_limit` | `4Gi` (≥ 2Gi) | High | Below 2 GiB, Langfuse's Next.js server OOM-kills during first-boot migrations or under ingestion load. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks all external SDK ingestion calls. |
| `enable_iap` | only when SDK ingestion not needed | High | IAP blocks all unauthenticated requests, including SDK trace ingestion. |
| `AUTH_DISABLE_SIGNUP` (auto-injected `"false"`) | Disable after first owner | High | Leaving sign-up open lets anyone with the URL create an account. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) stops background processing and adds cold-start latency to the first request after idle. |
| `cpu_always_allocated` | `true` | Medium | Request-based billing throttles background processing to ~0 CPU between requests. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The UI and ingestion endpoints are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Langfuse-specific application configuration shared with the GKE variant is described in
**[Langfuse_Common](Langfuse_Common.md)**.
