---
title: "Maybe Finance on Google Cloud Run"
description: "Configuration reference for deploying Maybe Finance on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Maybe Finance on Google Cloud Run

Maybe (Maybe Finance) is an open-source, self-hosted alternative to Mint/Monarch
for personal finance and wealth management — budgeting, net-worth tracking,
transaction categorization, and multi-account aggregation, built on Ruby on
Rails. This module deploys Maybe on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Maybe uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Maybe runs as a single Rails/Puma container on Cloud Run v2, with a Sidekiq
background-job process started alongside it inside the same container by the
cloud entrypoint. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Rails/Puma on port 3000, 2 vCPU / 4 GiB by default; Sidekiq runs as a background process inside the same container |
| Database | Cloud SQL for PostgreSQL 15 | Required — a plan-time guard accepts only `POSTGRES_13`/`14`/`15` (or `NONE`); MySQL is rejected |
| Background jobs & real-time UI | Redis (via the shared NFS VM, or an explicit host) | Mandatory — a plan-time precondition fails the plan if `enable_redis = false`; powers Sidekiq (account syncing, import processing, notifications) |
| File persistence | Cloud Filestore (NFS) | Attachments persist under `/opt/maybefinance/storage`; also the default source for the Redis host IP |
| Object storage | Cloud Storage | A `storage` bucket is auto-provisioned by `MaybeFinance_Common`; the default `storage_buckets` variable adds a `data` bucket |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE` (Rails session/encryption key); database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` defaults to `POSTGRES_15`
  and a plan-time precondition (`validation.tf`) rejects anything other than
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL is not supported.
- **Redis is mandatory, not optional.** A plan-time precondition fails the
  plan outright if `enable_redis = false`. When `redis_host` is left blank,
  `enable_nfs` must stay `true` so the shared NFS server's IP is used as the
  Redis host.
- **Cloud SQL is reached over private-IP TCP, not a socket, by default.**
  Unlike most Common-module apps, `enable_cloudsql_volume` defaults to
  **`false`** here: Rails' `pg` driver cannot parse the Cloud SQL Unix-socket
  DSN, so the module skips the Auth Proxy sidecar and connects over the
  instance's private IP instead. The cloud entrypoint maps the Foundation's
  `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` onto Maybe's discrete
  `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` env
  vars and sets `PGSSLMODE=require` (Cloud SQL rejects unencrypted private-IP
  TCP); if `enable_cloudsql_volume` is switched on, `DB_HOST` becomes a socket
  directory and the entrypoint falls back to `DB_IP` over TCP instead of
  trying to use the socket path directly.
- **Scale-to-zero is the default (`min_instance_count = 0`,
  `cpu_always_allocated = false`).** This is a cost-first default, but it
  means the co-located Sidekiq worker only runs while an instance happens to
  be alive — set `min_instance_count = 1` and `cpu_always_allocated = true`
  to keep background jobs (account syncing, import processing,
  notifications) running continuously, matching the GKE variant's defaults.
- **Combined web + worker container, not a sidecar.** The cloud entrypoint
  starts `bundle exec sidekiq` in the background and then `exec`s the Rails
  web server in the foreground of the *same* container — Maybe is not
  deployed with a separate `additional_services` worker. If `REDIS_URL`
  resolves empty, the entrypoint skips starting Sidekiq entirely rather than
  crashing.
- **`SECRET_KEY_BASE` is generated once** by `MaybeFinance_Common` and stored
  in Secret Manager, shared identically by the web and Sidekiq processes.
  Rails uses it to sign sessions/cookies and to derive the key that encrypts
  ActiveRecord-encrypted columns.
- **Schema is created by an init job, not on boot.** The
  `maybefinance-migrate` job runs `rails db:prepare` during apply; the
  runtime entrypoint never runs migrations.
- **`container_image_source = "custom"`.** Cloud Build builds a thin wrapper
  image `FROM ghcr.io/maybe-finance/maybe:<version>`. `application_version`
  defaults to `"stable"`; a `"latest"` request is mapped to the pinned
  `stable` channel via the app-specific `MAYBE_VERSION` build ARG (the
  Foundation's generic `APP_VERSION` build arg is intentionally not used).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource
names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Maybe service (web + Sidekiq)

Maybe runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. The Rails/Puma web server and the
Sidekiq worker run as two processes inside the same container, sharing
`SECRET_KEY_BASE` and the Redis connection. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Maybe stores all application data (accounts, transactions, budgets, users) in
a managed Cloud SQL for PostgreSQL 15 instance. Unlike the GKE variant (which
reaches Cloud SQL through a loopback Auth Proxy sidecar), the Cloud Run
service connects over the instance's **private IP with `sslmode=require`** —
`enable_cloudsql_volume` defaults `false` because Rails cannot parse the
socket-style DSN the proxy would otherwise present. On first deploy the
`db-init` job creates the application database and user, grants the app role
`cloudsqlsuperuser` (so Maybe's own migration can create Postgres extensions
without superuser access), and pre-creates the `pgcrypto` extension;
`maybefinance-migrate` then runs `rails db:prepare`.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Filestore (NFS) & Redis

**Cloud Filestore (NFS)** is mounted at `/opt/maybefinance/storage`
(`enable_nfs = true` by default) so uploaded attachments persist across
revisions. Maybe also requires **Redis**, which is mandatory — a plan-time
precondition blocks `enable_redis = false`. When `redis_host` is left blank,
the injected `REDIS_HOST` resolves to the shared NFS server's IP (the NFS VM
co-hosts Redis in this repo's platform convention), which is why `enable_nfs`
must stay `true` unless an explicit `redis_host` is supplied.

- **Console:** Filestore → Instances; Compute Engine → VM instances (the NFS
  VM, if it also runs Redis).
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for NFS discovery/provisioning and Redis
injection mechanics.

### D. Cloud Storage

A **`storage`** bucket is provisioned automatically by `MaybeFinance_Common`,
and the default `storage_buckets` variable adds a second **`data`** bucket.
Neither is mounted into the container filesystem by default — `gcs_volumes`
is empty out of the box — so they exist as provisioned storage but are inert
until explicitly wired up.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### E. Secret Manager

One Maybe-specific secret is generated automatically and stored in Secret
Manager: `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`),
a 64-character random value shared by the Rails web process and the Sidekiq
worker. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings
= "all"`). An external HTTPS load balancer with a custom domain, Cloud CDN,
and Cloud Armor can be layered on; ingress settings and VPC egress control
connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs (`RAILS_LOG_TO_STDOUT = "true"`) flow to Cloud Logging; Cloud
Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime
checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Maybe Finance Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It connects over private-IP TCP (`sslmode=require`),
  idempotently creates the application database and user, grants privileges,
  grants the app role `cloudsqlsuperuser` (Cloud SQL's app users aren't real
  superusers, so this lets Maybe's own migration create Postgres extensions),
  and pre-creates `pgcrypto` as a belt-and-suspenders step. The job is safe
  to re-run.
- **Schema migration is a separate init job.** `maybefinance-migrate` runs
  `bundle exec rails db:prepare` against the built Maybe image (`image = null`
  in its job spec, so it reuses the image and toolchain built for the app),
  depends on `db-init` completing first, and retries up to 3 times
  (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **First-run admin registration, not an auto-created secret.**
  `SELF_HOSTED = "true"` enables Maybe's self-host UI, which lets the first
  visitor register the initial admin account through the web UI — there is
  no auto-generated admin password secret to retrieve.
  <!-- TODO: verify whether a first-run invite/registration lock exists after the first admin is created -->
- **`SECRET_KEY_BASE` is immutable in practice.** It is generated once by
  `MaybeFinance_Common` and shared by the web and Sidekiq processes. Rotating
  it after first boot invalidates existing sessions and makes
  ActiveRecord-encrypted columns unreadable.
- **DB env-var mapping happens in the cloud entrypoint, not a URL DSN.** The
  platform injects `DB_HOST` (the instance private IP on Cloud Run, since
  `enable_cloudsql_volume` defaults `false`), `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`, and `DB_IP`; the entrypoint maps these onto
  `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (Maybe's Rails
  `config/database.yml` convention) and sets `PGSSLMODE=require` because the
  resolved host is a real private IP, not loopback.
- **Redis wiring.** `REDIS_URL` is built from the injected `REDIS_HOST`/
  `REDIS_PORT`/`REDIS_AUTH` if not already set. If `REDIS_URL` ends up empty
  (Redis unreachable), the entrypoint skips starting Sidekiq entirely —
  background jobs silently stop running rather than crashing the container.
- **Background jobs need an always-warm instance.** Because Sidekiq is
  started in-process by the entrypoint, it only runs while a container
  instance is alive. With the CloudRun defaults (`min_instance_count = 0`,
  `cpu_always_allocated = false`), scale-to-zero periods and CPU throttling
  between requests both interrupt background job processing.
- **Health path.** Startup probe is **HTTP** `GET /up` with a generous
  allowance for a slow first boot (`initial_delay_seconds = 60`,
  `period_seconds = 15`, `failure_threshold = 30` — roughly 8 minutes of
  headroom). Liveness probe is also **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <maybefinance-migrate-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform (the
`{{UIMeta group=N}}` tag in each variable's description in `variables.tf`).
Only settings specific to or notable for Maybe are listed; every other input
is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour
and defaults.

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
| `application_name` | `maybefinance` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Maybe` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `stable` | `ghcr.io/maybe-finance/maybe` image tag used as the custom-build base; `latest` is mapped to the pinned `stable` release channel via `MAYBE_VERSION`. |

`application_display_name`/`application_description` are inert Foundation
mirror declarations (never forwarded to the Foundation call) — the effective
identity comes from `display_name`/`description` above.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Thin wrapper image built FROM the upstream GHCR image. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance; Maybe recommends at least 2Gi. |
| `cpu_always_allocated` | `false` | Cost-first cold-start default. Set `true` (with `min_instance_count >= 1`) to keep Sidekiq processing continuously. |
| `container_resources` | _(null)_ | Overrides `cpu_limit`/`memory_limit` when set. |
| `min_instance_count` | `0` | Scale-to-zero by default — differs from the GKE variant's `min=1`; stops the co-located Sidekiq worker between requests. |
| `max_instance_count` | `5` | Cost ceiling. |
| `container_port` | `3000` | Maybe's native Rails/Puma port. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | **Off by default for Maybe** — Rails can't parse the Cloud SQL socket DSN, so the app connects over private-IP TCP instead. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Only relevant if `enable_cloudsql_volume` is switched on. |
| `container_protocol` | `http1` | HTTP protocol version. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |
| `enable_image_mirroring` | `true` | Always true — the GHCR base image is mirrored into Artifact Registry before the wrapper build. |
| `container_build_config` | `{ enabled = true }` | Build settings; `MAYBE_VERSION` build ARG is set from `application_version` in `MaybeFinance_Common`, not exposed as a top-level variable. |
| `additional_services` / `additional_containers` | `[]` | Not used by Maybe (Sidekiq runs in-process, not as a sidecar or separate service). |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public reachability for the web UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `network_name` | `""` | Auto-discovers the Services_GCP-managed VPC network. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core Rails/Maybe values (`RAILS_ENV`, `SELF_HOSTED`, `RAILS_LOG_TO_STDOUT`, etc.) are set automatically by `MaybeFinance_Common`. |
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

### Group 9 — Custom Initialization & SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS
bucket after provisioning. See [App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS bucket beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `true` | Attachments persist and are shared across revisions; also the default source for the Redis host IP. |
| `nfs_mount_path` | `/opt/maybefinance/storage` | Where Maybe stores uploaded attachments. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto-discover)_ | Existing/inline NFS VM naming. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2); not used out of the box. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | A plan-time precondition restricts this to `POSTGRES_13`/`14`/`15`/`NONE`; MySQL is rejected. |
| `db_name` | `maybefinance` | Effective PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `maybefinance` | Effective application database user; password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Left off — `db-init.sh` already pre-creates `pgcrypto` via the `cloudsqlsuperuser` grant. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Unused — Maybe is PostgreSQL-only. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | **Inert** Foundation-mirror declarations (never forwarded to `main.tf`) — the real database name/user come from `db_name`/`db_user` above via `MaybeFinance_Common`. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `maybefinance-migrate` jobs. |
| `cron_jobs` | `[]` | Not forwarded — Maybe has no platform-scheduled recurring tasks; its own background work runs in-process via Sidekiq. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, 60s delay, 30 retries | Startup probe. Allow roughly 8 minutes on first boot. |
| `liveness_probe` | HTTP `/up`, 60s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/up` | Alternative structured probes. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default, enable explicitly to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Mandatory** — a plan-time precondition fails the plan if set to `false`. |
| `redis_host` | `""` | Leave blank to use the NFS server IP (requires `enable_nfs = true`). |
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

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

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
| `database_host` / `database_port` | DB endpoint (private IP on Cloud Run) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `maybefinance-migrate`). |
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

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, plus its own
> `validation.tf` guards (`min` ≤ `max`, Redis mandatory, a Redis host must be
> resolvable, PostgreSQL-only `database_type`, no Auth Proxy without a real
> database). Invalid configuration fails the **plan** with a clear, named
> error before any resource is created, so most mistakes below are caught up
> front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (or `13`/`14`) | Critical | A non-PostgreSQL engine is rejected at plan time; forcing one around the guard breaks the installer and every query. |
| `enable_redis` | `true` | Critical | The plan-time precondition blocks `false` outright — Maybe has no functioning background-job queue without Redis. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `SECRET_KEY_BASE` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all sessions and makes ActiveRecord-encrypted columns unreadable. |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Critical | Switching it on changes `DB_HOST` to a socket directory Rails cannot parse directly; the entrypoint falls back to `DB_IP`, but a mis-set `database_type = "NONE"` combined with `enable_cloudsql_volume = true` is blocked at plan time because the proxy sidecar would have no instance to connect to. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but `enable_nfs` is off and no host is set, the plan-time precondition fails; if `enable_nfs` is disabled after a working deploy, uploaded attachments become ephemeral and the Redis host may go stale. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` for production | High | With the cost-first defaults (`0` / `false`), the co-located Sidekiq worker only runs while an instance happens to be alive — account syncing, import processing, and notifications silently stop firing between requests and during scale-to-zero windows. |
| `memory_limit` | `4Gi` (default) | High | The combined Rails + Sidekiq process is memory-hungry under import/sync workloads; Maybe recommends at least 2Gi. |
| `SELF_HOSTED` (auto-injected `"true"`) | Register the first admin promptly | High | Leaving the deployment reachable before an admin registers allows anyone with the URL to claim the initial administrator account. |
| `ingress_settings` | `all` | Medium | Setting to `internal` blocks access to the web UI for anyone outside the VPC. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The admin UI is publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Maybe-specific application configuration
shared with the GKE variant lives in the `MaybeFinance_Common` module (its
own `docs/modules/MaybeFinance_Common.md` guide has not been published yet).
