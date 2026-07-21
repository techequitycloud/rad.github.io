---
title: "Wallabag on Google Cloud Run"
description: "Configuration reference for deploying Wallabag on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Wallabag on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallabag_CloudRun.png" alt="Wallabag on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallabag is a free, open-source, self-hosted "read it later" article archiving
app — a Pocket alternative. Save articles from a browser extension, bookmarklet,
mobile app, or the REST API, then read them later in a clean, distraction-free
view with full-text search, tagging, annotations, and RSS feeds of your saved
items. This module deploys Wallabag on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Wallabag uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Wallabag runs as a PHP/Symfony container (nginx + php-fpm under s6-overlay) on
Cloud Run v2. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Symfony service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero by default |
| Database | Cloud SQL for MySQL 8.0 | Required — Wallabag_Common fixes the engine; PostgreSQL is not supported |
| Object storage | Cloud Storage | A generic `data` bucket is provisioned, but Wallabag does not read or write it — all content lives in MySQL |
| Secrets | Secret Manager | Auto-generated `APP_SECRET` (Symfony security token); database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by `Wallabag_Common`;
  selecting any other engine breaks the deployment.
- **`enable_cloudsql_volume = false`.** Cloud Run connects to Cloud SQL over
  **private-IP TCP**, not the Auth Proxy Unix socket. The GKE variant instead
  uses the Auth Proxy sidecar on `127.0.0.1`.
- **Single Secret Manager secret.** `APP_SECRET` (a Symfony security token) is
  generated automatically, overriding Wallabag's publicly-known baked-in default.
  There is no separate generated admin-password secret.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `max_instance_count = 1`). Cold starts add latency to the first request after
  idle; set `min_instance_count = 1` to avoid this.
- **`enable_nfs` defaults `true` but is functionally unused.** It mounts Cloud
  Filestore NFS at `/var/lib/wallabag`, but Wallabag's image `WORKDIR` is
  `/var/www/wallabag` — nothing writes to the mounted path. Safe to disable.
- **No separate migration job.** Wallabag's own `bin/console wallabag:install`
  handles both schema creation and first-run setup in one idempotent step.
- **Self-registration is disabled.** `SYMFONY__ENV__FOSUSER_REGISTRATION = "false"`
  — only the bootstrapped administrator account exists until an operator
  explicitly enables sign-up or creates more accounts.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Wallabag service

Wallabag runs as a Cloud Run v2 service that autoscales by request load between
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

### B. Cloud SQL for MySQL 8.0

Wallabag stores all application data (saved articles, tags, users, annotations)
in a managed Cloud SQL for MySQL 8.0 instance. The service connects over the
instance's **private IP via TCP** (not the Auth Proxy socket — Cloud Run's
`enable_cloudsql_volume` defaults `false` for this module). On first deploy, a
`db-init` job creates the application database and user, followed by
`wallabag-install`, which runs Wallabag's own installer to create the schema.

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

A generic `data` bucket is provisioned by default (via the Foundation's
`storage_buckets` input), but Wallabag itself never reads or writes it — all
content lives in MySQL, and `gcs_volumes` (which would fuse-mount a bucket into
the container) is empty by default.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager

One secret is generated automatically and stored in Secret Manager: `APP_SECRET`
(materialised under that simple key; aliased onto the real `SYMFONY__ENV__SECRET`
name by the wrapper entrypoint). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Wallabag Application Behaviour

- **Two-stage init chain, not a Laravel-style separate migrate step.**
  `db-init` (`mysql:8.0-debian`) creates the empty application database and user
  and grants privileges. `wallabag-install` then depends on `db-init` and reuses
  the same custom app image (so the wrapper entrypoint's env aliasing still runs)
  with its command overridden to `bin/console wallabag:install --env=prod -n`.
  This single command performs both schema creation *and* first-run setup
  (including seeding the default administrator account) — there is no separate
  migration job to run on upgrades; re-running `wallabag:install` against an
  already-installed database is safe and idempotent.
- **Health check behaviour.** The startup probe is **TCP** on port 80 — it only
  needs nginx to bind, independent of installer progress. The liveness probe is
  **HTTP `GET /`**: an unauthenticated request to the root path returns an
  **HTTP 302 redirect to `/login`**, which both Cloud Run's and Kubernetes'
  health-check semantics treat as a passing response (any 2xx–3xx). Do not expect
  a bare 200 from `/` — a 302 to `/login` is the expected, healthy result.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
  ```
- **First-run administrator account.** `wallabag:install --env=prod -n` creates
  Wallabag's own default administrator account using Wallabag's documented
  installation defaults (username and password both `wallabag`) — there is no
  Secret Manager secret holding a generated admin password. **Change this
  password immediately after first login** (Settings → your account → change
  password, or `bin/console fos:user:change-password wallabag` inside the
  container). New accounts cannot self-register (`SYMFONY__ENV__FOSUSER_REGISTRATION
  = "false"`) — create additional users from the admin UI or with `bin/console
  fos:user:create`.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Wallabag are listed; every other input is
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
| `application_name` | `wallabag` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Wallabag` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Base image tag for `wallabag/wallabag`. `"latest"` maps to a pinned tag (`2.6.14`) at build time via the app-specific `WALLABAG_VERSION` build ARG. |
| `php_memory_limit`, `upload_max_filesize`, `post_max_size` | `512M` / `64M` / `64M` | Declared for convention parity but **not forwarded** anywhere — setting these has no effect on the deployed container. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the wrapper image via Cloud Build. `"prebuilt"` skips the DB/secret-aliasing wrapper entirely — do not use without your own translation. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Autoscaling upper bound. |
| `container_port` | `80` | Wallabag's nginx listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `enable_cloudsql_volume` | `false` | Cloud Run connects over private-IP TCP instead of the Auth Proxy socket. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress by default. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not override `SYMFONY__ENV__DATABASE_*` here — they're computed by the wrapper entrypoint at container start. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

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

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the generic `data` GCS bucket. Not read or written by Wallabag. |
| `enable_nfs` | `true` | **Functionally unused** — mounted at `/var/lib/wallabag`, but Wallabag's image writes nothing there. Safe to disable. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). Empty by default — nothing is mounted. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `Wallabag_Common`. |
| `db_name` / `db_user` | `wallabag` | Tenant-prefixed at deploy time. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (all empty) | **Unused by Wallabag** — the wrapper entrypoint reads the standard `DB_*` vars directly and aliases them onto `SYMFONY__ENV__DATABASE_*` itself. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `wallabag-install` chain. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, port 80, 30s delay, 20 retries | Only needs nginx to bind. |
| `liveness_probe` | HTTP `GET /`, 300s delay, 3 retries | Wallabag returns a 302 redirect to `/login` — a passing response. |
| `uptime_check_config` | `{ enabled = true }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Purely optional — only used by Wallabag's asynchronous bulk-import feature (Pocket/Instapaper import). Normal save/read/API usage never touches Redis. |
| `redis_host` | `""` | Redis endpoint. |
| `redis_port` | `6379` | Redis port. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
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
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `wallabag-install`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| DB driver env var (`SYMFONY__ENV__DATABASE_DRIVER`, hardcoded in `entrypoint.sh`) | must be set explicitly (`pdo_mysql` here) | **Critical** | Wallabag's shipped `parameters.yml` defaults `database_driver` to `pdo_sqlite`. Setting only `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` with no explicit driver var still silently installs against a throwaway local SQLite file — the install "succeeds," the app appears to work, but all data lives in an ephemeral file wiped on every restart or redeploy, and MySQL is never touched. No error is raised. **If this module is ever cloned as a template for another Symfony-based application, verify the DB driver env var is set explicitly** — this class of failure is undetectable from the outside; only comparing the container's boot logs (`"Configuring the SQLite database..."` vs. a MySQL connection line) reveals it. See [App_CloudRun](App_CloudRun.md) and [App_GKE](App_GKE.md) for how the Foundation injects DB env vars generically — the app-specific translation and any missing pieces are always the calling module's responsibility. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all saved articles. |
| `APP_SECRET` (auto-generated) | Never hand-edit in Secret Manager after first boot | High | Wallabag uses this as a Symfony security-signing key; changing it invalidates CSRF tokens and any signed URLs already issued. |
| Default administrator credentials (`wallabag` / `wallabag`, seeded by `wallabag:install`) | Change immediately after first login | High | The installer seeds Wallabag's own well-known default credentials — anyone who knows the service URL and the public default can log in until the password is changed. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `container_image_source` | `custom` | Critical | Switching to `prebuilt` deploys the stock `wallabag/wallabag` image with no wrapper entrypoint — the DB and secret env-var aliasing never runs, so the app cannot reach MySQL at all. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency to the first request after idle. |
| `enable_nfs` | `false` unless needed for another purpose | Low / cost | Defaults `true` and provisions a Filestore share that Wallabag never uses — a needless recurring cost. |
| `enable_cloud_armor` | enable for production | Medium | The service is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Wallabag-specific application configuration
shared with the GKE variant is described in
**[Wallabag_Common](Wallabag_Common.md)**.
