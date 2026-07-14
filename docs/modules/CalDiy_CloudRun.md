---
title: "Cal.diy on Google Cloud Run"
description: "Configuration reference for deploying Cal.diy on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Cal.diy on Google Cloud Run

Cal.diy is the MIT-licensed, self-hostable fork of Cal.com — the open-source scheduling
platform used by millions worldwide to eliminate back-and-forth meeting coordination.
This module deploys Cal.diy on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Cal.diy uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Cal.diy runs as a Next.js (Node.js) container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js service, 2 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Cal.diy uses Prisma ORM targeting PostgreSQL |
| Object storage | Cloud Storage | A `data` bucket provisioned by default |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Selecting MySQL or `NONE` breaks startup.
- **Scale-to-zero is the default** (`min_instance_count = 0`). Cal.diy's first-boot
  startup takes 4–5 minutes; set `min_instance_count = 1` for production to avoid
  cold-start latency.
- **A custom wrapper image is built by default.** `CalDiy_Common` always sets
  `image_source = "custom"` and provides a Dockerfile. The entrypoint assembles
  `DATABASE_URL` from the `DB_*` environment variables injected by the platform,
  making the connection robust regardless of which image version is deployed.
- **Three initialization jobs run on first deploy:** `db-init` (PostgreSQL setup),
  `db-migrate` (Prisma schema migrations), and `seed-app-store` (seeds the Cal.diy
  app store table). All are idempotent.
- **`NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`** are generated automatically and
  stored in Secret Manager; you never set them in plain text.
- **`NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL`** are auto-computed from the predicted
  Cloud Run service URL. Override via `environment_variables` when using a custom
  domain.
- **`calcom/cal.diy` has no `latest` tag** — always pin `application_version` to a
  versioned release (e.g., `v6.2.0`).
- **Redis is disabled by default.** NextAuth.js sessions are stored in PostgreSQL.
  Enable Redis for high-concurrency multi-instance deployments.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Cal.diy service

Cal.diy runs as a Cloud Run v2 service that autoscales by request load between the
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

Cal.diy stores all application data (bookings, users, schedules, integrations) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through
the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy a
sequence of Cloud Run Jobs creates the database and user, runs Prisma schema
migrations, and seeds the app store.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage

A default Cloud Storage bucket (suffix `data`) is provisioned and the service account
is granted access automatically. Cal.diy does not require shared NFS storage by
default — the database stores all booking state.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Secret Manager

`NEXTAUTH_SECRET` (NextAuth.js session signing) and `CALENDSO_ENCRYPTION_KEY` (Cal.diy
data encryption) are generated automatically and stored as Secret Manager secrets.
The database password is also managed here. Secrets are injected into the service at
runtime; plaintext never appears in configuration.

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

## 3. Cal.diy Application Behaviour

- **First-deploy initialization sequence.** Three Cloud Run Jobs execute in order
  before the service serves traffic:

  | Job | Image | Purpose |
  |---|---|---|
  | `db-init` | `postgres:15-alpine` | Creates the PostgreSQL database and user, grants privileges |
  | `db-migrate` | Cal.diy app image | Runs `prisma migrate deploy` to apply the full schema |
  | `seed-app-store` | Cal.diy app image | Seeds the `App` table with available integrations |

  All three are idempotent and safe to re-run. Inspect their executions:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

- **`DATABASE_URL` assembly.** The entrypoint script assembles `DATABASE_URL` and
  `DATABASE_DIRECT_URL` from `DB_*` environment variables at container start, then
  launches the Next.js server. This makes database connectivity independent of which
  image variant is deployed.

- **Startup probe.** Health probes target `/api/auth/session` (HTTP 200 when NextAuth
  is ready). `CalDiy_Common` sets a 6-minute total startup window
  (`initial_delay=180s`, `failure_threshold=18`, `period=10s`) to accommodate
  `replace-placeholder.sh` (~2.5 min), `db-migrate` (~60s), and `seed-app-store`
  (~30s) that run on the first boot inside the container's `start.sh`.

- **Public URL wiring.** `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` are auto-computed
  from the predicted Cloud Run service URL. Override both in `environment_variables`
  when using a custom domain so OAuth callbacks and booking links point to the correct
  host.

- **Email (SMTP).** Cal.diy uses SMTP for booking confirmations, cancellation notices,
  reminders, and password resets. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `EMAIL_FROM` in `environment_variables` and store `SMTP_PASSWORD` as a
  `secret_environment_variables` reference before going live.

- **No scheduled tasks required.** Cal.diy does not require separately scheduled
  background jobs — bookings and reminders are handled by Next.js API routes.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Cal.diy are listed; every other input is
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
| `application_name` | `caldiy` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Cal.com Scheduling` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `v6.2.0` | Cal.diy image version tag — **no `latest` tag exists**, always pin to a versioned release. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the wrapper image via Cloud Build (required for Cloud Run — assembles `DATABASE_URL`); `prebuilt` deploys the official image directly. |
| `container_image` | `""` | Override container image URI. Leave empty to use default. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; raise to `4Gi` for production multi-user load. |
| `container_port` | `3000` | Cal.diy's native Next.js port. Do not change. |
| `execution_environment` | `gen2` | Gen2 recommended; required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum duration per request. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Cal.diy image into Artifact Registry. |
| `min_instance_count` | `0` | Minimum instances (0 = scale-to-zero). Set to `1` to avoid cold-start latency in production. |
| `max_instance_count` | `5` | Maximum instances. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. All entries must sum to 100. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service: `all`, `internal`, or `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP skeleton | Plain-text settings. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` here. Also set `NEXT_PUBLIC_WEBAPP_URL` once a custom domain is known. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification period. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. Set `false` after a successful import. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB with Cloud Armor WAF. Required for custom domains and DDoS protection. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom hostnames for the external load balancer. When set, also update `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL`. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the default `data` bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets to provision. |
| `enable_nfs` | `false` | NFS is not required for Cal.diy. Enable only if custom shared storage is needed (requires `gen2`). |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Cal.diy requires PostgreSQL. |
| `db_name` | `calcom` | Database name. Immutable after first deploy. |
| `db_user` | `calcom` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Alias env var names alongside the standard `DB_*` variables. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init`, `db-migrate`, and `seed-app-store` jobs. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs triggered by Cloud Scheduler. Cal.diy does not require scheduled tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/auth/session`, initial_delay=180s, failure_threshold=18 | Generous window for first-boot `start.sh` (URL rewrite + migrations + seed). |
| `liveness_probe` | HTTP `/api/auth/session`, initial_delay=60s | Liveness probe after startup. |
| `uptime_check_config` | disabled, path `/api/auth/session` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Use Redis for session caching. Recommended when `max_instance_count > 1`. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true`. |
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
| `database_type` | `POSTGRES_15` | Critical | Cal.diy requires PostgreSQL with Prisma; MySQL or `NONE` breaks schema migrations and startup. |
| `container_port` | `3000` | Critical | Cal.diy's Next.js server listens on 3000; any other value misdirects Cloud Run health checks and traffic routing. |
| `enable_cloudsql_volume` | `true` | Critical | Cal.diy connects via Unix socket; disabling removes the socket and all DB connections fail. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans existing data. |
| `application_version` | pinned release | Critical | `calcom/cal.diy` has no `latest` tag; an invalid version fails the image pull. |
| `NEXT_PUBLIC_WEBAPP_URL` | match public URL | Critical | Cal.diy embeds this in Next.js static chunks via `replace-placeholder.sh`; a mismatch breaks OAuth callbacks and booking links. |
| `NEXTAUTH_URL` | match public URL | Critical | NextAuth validates OAuth redirect URIs against this; a mismatch blocks all logins. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job and may overwrite live data on subsequent applies. |
| `startup_probe.initial_delay_seconds` | `180` (via CalDiy_Common) | High | Cal.diy `start.sh` runs URL rewrite (~2.5 min) + Prisma migrations + seed before serving requests; too short a window causes a restart loop. |
| `startup_probe.failure_threshold` | `18` at `period=10s` | High | Gives ~6 minutes total; reducing below 12 kills the container before initialization completes. |
| `container_image_source` | `custom` | High | Cloud Run requires the wrapper image that assembles `DATABASE_URL`; using `prebuilt` without the wrapper entrypoint leaves `DATABASE_URL` unset and all DB queries fail. |
| `memory_limit` | `2Gi` minimum | High | Cal.diy startup (URL rewrite + migrations) requires ≥ 2 GiB; OOM kills before the app is ready. |
| `enable_redis` | `true` for multi-instance | High | Without Redis, sessions are per-instance; users are logged out when scale-to-zero or instance rotation occurs. |
| `redis_host` | required when `enable_redis=true` | High | Empty `redis_host` with Redis enabled injects a malformed URL; session operations fail at runtime. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero is the default; Cal.diy's 4–5 minute cold start adds unacceptable latency for production scheduling. |
| `SMTP_HOST` / `EMAIL_FROM` | real SMTP config | Medium | Without valid SMTP, booking confirmations, reminders, and password resets are never delivered. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Medium | If using Memorystore Redis, its private IP may not be in default VPC ranges; change to `ALL_TRAFFIC` or ensure correct VPC routing. |
| `organization_id` | set explicitly for VPC-SC | Medium | VPC-SC perimeter is only activated when `organization_id` is set; `enable_vpc_sc = true` alone has no effect. |
| `execution_environment` | `gen2` | Medium | `gen1` does not support NFS mounts; if `enable_nfs = true`, `gen2` is required. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Cal.diy-specific application configuration shared
with the GKE variant is described in **[CalDiy_Common](CalDiy_Common.md)**.
