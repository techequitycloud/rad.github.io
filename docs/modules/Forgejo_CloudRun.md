---
title: "Forgejo on Google Cloud Run"
description: "Configuration reference for deploying Forgejo on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Forgejo on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Forgejo_CloudRun.png" alt="Forgejo on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Forgejo is a lightweight, community-managed, self-hosted Git service — a fork of
Gitea — providing repository hosting, issue tracking, pull requests, a built-in
CI/CD (Actions) runner, code review, and a package registry from a single Go
binary. This module deploys Forgejo on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Forgejo uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Forgejo runs as a single Go binary inside a thin custom-build wrapper over the
stock `codeberg.org/forgejo/forgejo` image: the wrapper adds a platform
entrypoint (`/platform-entrypoint.sh`) that composes the database connection at
runtime, then hands off to Forgejo's own entrypoint under `s6`. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go binary on port 3000, 1 vCPU / 2Gi by default, serverless autoscaling; `max_instance_count` defaults to `1` |
| Database | Cloud SQL for PostgreSQL 15 | Locked in practice — `db-init.sh` uses `psql`; the `database_type` dropdown lists MYSQL/NONE as options but they are not supported |
| File persistence | Cloud Filestore (NFS) | Enabled by default; repositories, LFS objects, and attachments live under the NFS mount (`/mnt/nfs`) |
| Object storage | Cloud Storage | A generic, unused `data`-suffixed bucket is provisioned by the foundation default — Forgejo itself stores nothing in GCS |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and `INTERNAL_TOKEN`, plus the database password, all injected directly as `GITEA__` environment variables |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only engine that actually works.** `database_type`
  defaults to `POSTGRES_15`; the `db-init` job's script is written entirely
  against `psql`, so selecting MySQL or `NONE` breaks database setup even though
  the variable metadata lists them as options.
- **Cloud SQL is reached over direct private-IP TCP by default, not a socket.**
  `enable_cloudsql_volume = false` by default for this module (unlike many other
  CloudRun modules), so the platform entrypoint sees a private-IP `DB_HOST` and
  sets `GITEA__database__SSL_MODE=require` for that hop. Set
  `enable_cloudsql_volume = true` to switch to the Cloud SQL Auth Proxy Unix
  socket at `/cloudsql/<connection-name>` instead (`SSL_MODE=disable`).
- **NFS is enabled by default**, mounted at `/mnt/nfs`
  (`GITEA__server__APP_DATA_PATH`) — this is where repositories, Git LFS
  objects, and attachments persist. This module's own default overrides the
  `Forgejo_Common` module's internal default of `/data`.
- **`max_instance_count` defaults to `1`.** Combined with NFS-backed repository
  storage and a single Postgres role, this avoids concurrent-writer races
  without needing a Kubernetes-style `Recreate` rollout strategy (Cloud Run has
  no equivalent concept — a new revision only receives traffic once its health
  checks pass, and the previous revision's instances are then drained).
- **No separate migration job.** `GITEA__security__INSTALL_LOCK = "true"` skips
  Forgejo's web installer; the `forgejo/forgejo` image creates and migrates its
  own schema on container start against the empty database the `db-init` job
  prepared.
- **No admin account is bootstrapped by Terraform.** There is no init job that
  creates a Forgejo admin user — see [Section 3](#3-forgejo-application-behaviour)
  for the operator-side options.
- **`SECRET_KEY` and `INTERNAL_TOKEN` are auto-generated** and stored in Secret
  Manager. On Cloud Run there is no SecretSync CRD restriction (that only
  applies to GKE), so they are injected directly as the `GITEA__security__` env
  vars — no CSI-mounted file indirection is needed.
- **`public_domain` / `public_url` default to `localhost`.** Even though the
  service gets a real `run.app` URL at deploy time, `GITEA__server__DOMAIN` /
  `GITEA__server__ROOT_URL` are not automatically synced to it — set
  `public_domain` (and optionally `public_url`) to the real external hostname so
  clone URLs and links resolve correctly.
- **Self-registration is open by default** (`GITEA__service__DISABLE_REGISTRATION = "false"`).
- **Redis is provisioned but not actually wired into Forgejo's config.**
  `enable_redis = true` by default and the foundation injects `REDIS_HOST` /
  `REDIS_PORT` into the container, but `Forgejo_Common` sets no
  `GITEA__cache__*` / `GITEA__session__*` / `GITEA__queue__*` variables to
  consume them — Forgejo falls back to its built-in cache/session defaults
  unless you add that wiring yourself via `environment_variables`.
- **Git-over-SSH is not reachable.** Cloud Run only routes HTTP(S) traffic on a
  single container port (3000, HTTP). Forgejo's internal `sshd` (also
  supervised by `s6`, per the Dockerfile) has no path to the outside world on
  this platform — use `https://` clone URLs, not `git+ssh://`.
- **The base image tag is driven by an app-specific build ARG.** The Dockerfile
  build arg is `FORGEJO_VERSION`, not the generic `APP_VERSION` the foundation
  injects into `build_args` (and which would otherwise win the merge and
  resolve to `forgejo:latest`). `application_version = "latest"` maps to the
  pinned tag `11` in `Forgejo_Common`'s config.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Forgejo service

Forgejo runs as a Cloud Run v2 service that autoscales by request load between
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

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Forgejo stores all application metadata (users, repositories, issues, pull
requests, Actions runs) in a managed Cloud SQL for PostgreSQL 15 instance. By
default (`enable_cloudsql_volume = false`) the service connects over **direct
private-IP TCP** with `sslmode=require`; setting `enable_cloudsql_volume = true`
switches to the Cloud SQL Auth Proxy Unix socket instead (`sslmode=disable`).
On first deploy, a `db-init` Cloud Run Job creates the application role and
database and grants schema privileges; Forgejo then creates and migrates its
own schema on first container start.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Filestore (NFS) — repository storage

Forgejo's repository data, Git LFS objects, and attachments live on **NFS
(Cloud Filestore)**, mounted inside the container at `/mnt/nfs` by default
(`GITEA__server__APP_DATA_PATH`). This is where all durable, non-database
application state lives — the container filesystem itself is ephemeral.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for NFS discovery/creation details.

### D. Cloud Storage

A generic **Cloud Storage** `data`-suffixed bucket is provisioned by the
foundation's `storage_buckets` default, but Forgejo does not use GCS for
anything — `Forgejo_Common` always reports an empty `storage_buckets` output.
Set `create_cloud_storage = false` to skip provisioning it if it is not needed.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~data"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### E. Redis (provisioned, not wired)

Redis is **enabled by default** (`enable_redis = true`); when `redis_host` is
left empty, the NFS server VM's IP is used as the Redis endpoint. The
foundation injects `REDIS_HOST` / `REDIS_PORT` into the container, but
`Forgejo_Common` does not set any `GITEA__cache__*` / `GITEA__session__*` /
`GITEA__queue__*` configuration to actually use them — Forgejo runs on its
built-in in-memory cache/session/queue defaults unless you add the matching
`environment_variables` yourself.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager

Two Forgejo secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY` (encrypts sensitive data such as 2FA and OAuth tokens) and
`INTERNAL_TOKEN` (authenticates Forgejo's own internal API calls). The database
password is the foundation-managed secret, aliased to
`GITEA__database__PASSWD` via `db_password_env_var_name` in `main.tf`. On Cloud
Run all three arrive as `GITEA__` environment variables directly — there is no
SecretSync CRD restriction (that only applies to GKE), so no CSI-mounted file
indirection is used.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~forgejo"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### G. Networking & ingress

The service is reachable at its `run.app` URL by default
(`ingress_settings = "all"`), which allows public access to the web UI and
`https://` Git clone/push endpoints. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on. Only the HTTP port
(3000) is exposed by Cloud Run — Forgejo's internal `sshd` has no way to be
reached from this platform, so `git+ssh://` clone URLs are not available;
clone over `https://` instead.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Forgejo Application Behaviour

- **First-deploy database setup.** The `db-init` Cloud Run Job runs
  `db-init.sh` using `postgres:15-alpine`. It waits for Cloud SQL to accept
  connections, idempotently creates (or re-passwords) the application role with
  `CREATEDB`, creates the database owned by that role, and grants full
  database + `public` schema privileges (PG15+). No Postgres extensions are
  installed by the script — Forgejo's own migrations create everything it
  needs. The job is safe to re-run (`execute_on_apply = true`,
  `max_retries = 3`).
- **No separate migration job — schema creation happens on container boot.**
  With `GITEA__security__INSTALL_LOCK = "true"`, Forgejo's web installer is
  skipped; the stock `forgejo/forgejo` entrypoint creates and migrates the
  schema in the empty database on first start, and applies further migrations
  on subsequent version upgrades.
- **No admin account is created automatically.** No initialization job runs a
  `forgejo admin user create` (or equivalent) step, and self-registration is
  enabled (`GITEA__service__DISABLE_REGISTRATION = "false"`), so anyone who can
  reach the service can create an account. Unlike GKE, Cloud Run has **no
  equivalent to `kubectl exec`** into a running instance, so the operator-side
  bootstrap options differ: either add a one-off entry to `initialization_jobs`
  that runs the Forgejo/Gitea `admin user create` CLI against the same
  database (image: the deployed Forgejo image; requires the DB env vars this
  module already injects), or rely on Forgejo/Gitea's own first-user-becomes-
  admin behaviour if applicable to the deployed version. TODO: confirm the
  exact CLI invocation and whether the deployed Forgejo version still grants
  admin rights to the first self-registered account before relying on either
  path — this was not verified from this repository's source.
- **DB connection env-var wiring.** The foundation injects `DB_HOST` (the
  private IP by default, or the Cloud SQL Auth Proxy socket directory when
  `enable_cloudsql_volume = true`), `DB_NAME`, `DB_USER`, and the `DB_PASSWORD`
  secret (aliased to `GITEA__database__PASSWD`). Because Kubernetes-style
  `$(VAR)` references are not interpolated by Cloud Run,
  `/platform-entrypoint.sh` composes `GITEA__database__{HOST,NAME,USER,SSL_MODE}`
  at runtime from the injected `DB_*` values, branching on the shape of
  `DB_HOST` itself (leading `/` → socket, `disable`; `127.0.0.1`/`localhost` →
  loopback proxy, `disable`; anything else → direct private-IP TCP,
  `require`) — the same entrypoint also works unmodified on the GKE variant.
- **Single-instance by default keeps NFS-backed writes safe.**
  `max_instance_count` defaults to `1`, so only one Forgejo instance runs
  against the shared NFS repository data and Postgres database at a time.
  Raising it is not something this module has tested for concurrent Git-write
  correctness — treat it with the same caution as any shared-filesystem
  workload.
- **Health path.** Both probes are **HTTP** `GET /api/healthz`, which Forgejo
  serves without authentication once database migrations complete: startup
  probe `initial_delay_seconds=30`, `timeout_seconds=5`, `period_seconds=20`,
  `failure_threshold=10`; liveness probe `initial_delay_seconds=15`,
  `timeout_seconds=5`, `period_seconds=30`, `failure_threshold=3`.
- **Inspect job execution and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep GITEA__
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Forgejo are listed; every other input is
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
| `application_name` | `forgejo` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Forgejo` | Human-readable name shown in the Console. |
| `description` | `Forgejo - Self-hosted Git service and source-code hosting` | Service description. |
| `application_version` | `11` | `codeberg.org/forgejo/forgejo` image tag, applied via the app-specific `FORGEJO_VERSION` build arg; `latest` maps to the pinned `11`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the thin wrapper `FROM codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}`. `prebuilt` will not work on Cloud Run — no `$(VAR)` env interpolation. |
| `container_port` | `3000` | Forgejo HTTP port; also sets `GITEA__server__HTTP_PORT`. |
| `cpu_limit` | `1000m` | 1 vCPU per instance (minimum for reliable operation). |
| `memory_limit` | `2Gi` | Minimum 512Mi; 2Gi recommended for production. |
| `cpu_always_allocated` | `false` | Request-based billing by default. Set `true` only if relying on scheduled mirror sync, repo health cron, or timed webhook delivery. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Keeps a single instance writing to the shared NFS repository data and database. |
| `execution_environment` | `gen2` | Required for NFS mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Direct private-IP TCP by default (`sslmode=require`); set `true` for the Cloud SQL Auth Proxy Unix socket instead. |
| `enable_image_mirroring` | `true` | Mirror the Forgejo image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for public Git clone/push over HTTPS and web access. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks Git CLI clone/push**, which cannot complete a Google OAuth browser flow. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables, Secrets & Public URL

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP placeholders | Extra non-secret settings. Core `GITEA__*` values are set automatically — do not set `GITEA__database__*` or the auto-generated secret keys here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |
| `public_domain` | `localhost` | Sets `GITEA__server__DOMAIN`; used to build clone URLs and links. Override in production. |
| `public_url` | `""` → `http://<public_domain>/` | Sets `GITEA__server__ROOT_URL`. |

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

### Group 9 — Custom Initialization & SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS
bucket after provisioning. Forgejo's own schema does not require any custom
SQL. See [App_CloudRun](App_CloudRun.md).

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
| `create_cloud_storage` | `true` | Creates the default `data`-suffixed GCS bucket, which Forgejo never uses. Set `false` to skip it. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned (unused) data bucket. |
| `enable_nfs` | `true` | NFS is on by default so repositories, LFS objects, and attachments persist. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container; sets `GITEA__server__APP_DATA_PATH`. Overrides `Forgejo_Common`'s own internal default of `/data`. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto-discover)_ | Target or name an existing/inline NFS server. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2); unused by Forgejo out of the box. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `forgejo` | Database name, injected as `GITEA__database__NAME`. Immutable after first deploy. |
| `db_user` | `forgejo` | Database user, injected as `GITEA__database__USER`. Password auto-generated and aliased to `GITEA__database__PASSWD` (via a `main.tf`-level `db_password_env_var_name`, not a user-facing variable). |
| `database_type` | `POSTGRES_15` | The only engine `db-init.sh` supports — do not change. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `sql_instance_name` / `sql_instance_base_name` | _(auto-discover)_ | Target or name an existing/inline Cloud SQL instance. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not used — Forgejo has no platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, `initial_delay_seconds=30`, `period_seconds=20`, `failure_threshold=10` | App-specific startup probe. |
| `liveness_probe` | HTTP `/api/healthz`, `initial_delay_seconds=15`, `period_seconds=30`, `failure_threshold=3` | App-specific liveness probe. |
| `startup_probe_config` | disabled | Alternative structured Cloud-Run-level probe (disabled by default; `startup_probe` takes effect). |
| `health_check_config` | HTTP `/` | Alternative structured Cloud-Run-level liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default, enable explicitly to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Injects `REDIS_HOST` / `REDIS_PORT`, but `Forgejo_Common` sets no `GITEA__cache__*`/`session__*`/`queue__*` config to consume them — see [Section 1](#1-overview). |
| `redis_host` | `""` | Override to point at Cloud Memorystore or another Redis instance; defaults to the NFS server IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` (sensitive) | Optional Redis auth password. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs — including the inert foundation-variable mirrors
(`additional_containers`, `additional_services`, `container_resources`,
`enable_postgres_extensions`/`postgres_extensions`, `enable_mysql_plugins`/`mysql_plugins`,
`network_name`, etc.) declared for convention parity but not forwarded to the
Forgejo deployment — follow standard [App_CloudRun](App_CloudRun.md) behaviour.

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
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (unused by Forgejo). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `timeout_seconds`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | `db-init.sh` is `psql`-only; MySQL/`NONE` breaks database setup even though the variable metadata lists them. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all repositories, issues, and PRs stored against the old role. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (auto-generated) | Never change | Critical | Rotating these invalidates 2FA/OAuth-encrypted data and Forgejo's own internal API auth, breaking Git and API operations. |
| `enable_nfs` | `true` | Critical | Disabling it makes repositories, LFS objects, and attachments ephemeral — lost when the container instance is replaced. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_cloudsql_volume` | `false` (default) or `true` | High | Default connects over direct private-IP TCP requiring SSL — make sure `vpc_egress_setting` and firewall rules allow it. Setting `true` switches to the Unix socket; the entrypoint's SSL-mode selection assumes whichever mode is actually active. |
| `public_domain` / `public_url` | Real external hostname | High | Defaults to `localhost` / `http://localhost/`, producing wrong Git clone URLs and broken links until overridden. |
| `GITEA__service__DISABLE_REGISTRATION` (via `environment_variables`) | `true` for non-public instances | High | Self-registration is open by default and no admin account is auto-created — anyone reaching the service can sign up. |
| Initial admin account | Create manually post-deploy | High | No init job bootstraps an admin; Cloud Run has no `kubectl exec` equivalent, so recovery requires a one-off `initialization_jobs` entry or the CLI run against the same DB. |
| `enable_iap` | only when Git CLI access is not needed | High | IAP requires an interactive Google sign-in that the `git` CLI cannot complete — clone/push over HTTPS breaks for all non-browser clients. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks all external Git clone/push and web access. |
| `enable_redis` | `true`, but confirm it is actually needed | Medium | `REDIS_HOST`/`REDIS_PORT` are injected with no effect unless you also add the matching `GITEA__cache__*`/`GITEA__session__*` config — provisioning Redis capacity for no benefit otherwise. |
| `max_instance_count` | `1` (default) | Medium | Raising it lets multiple instances share the same NFS-backed Git data directory and Postgres DB; multi-instance correctness for concurrent Git writes is not documented or tested here. |
| `application_version` | `11` or a specific pinned tag | Medium | `latest` does not track upstream — the Dockerfile's `FORGEJO_VERSION` build arg maps `"latest"` to the pinned tag `11`, so a plain `latest` setting silently stays on that pin. |
| `memory_limit` | `2Gi` | Medium | Minimum 512Mi; lower values risk OOM kills under concurrent repository operations. |
| `storage_buckets` / `create_cloud_storage` | Leave as-is or set `create_cloud_storage = false` | Low | The default `data`-suffixed bucket is provisioned but unused by Forgejo (all app data lives on NFS/Postgres) — minor unnecessary cost if left enabled needlessly. |
| Git-over-SSH | Not available on this platform | Low | Cloud Run exposes only the HTTP(S) port; `git+ssh://` clone URLs will not work regardless of configuration — use `https://`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Forgejo-specific application
configuration (database wiring, secrets, and NFS layout) is defined in the
`Forgejo_Common` module and shared with the GKE variant of this application.
