---
title: "Kimai on Google Cloud Run"
description: "Configuration reference for deploying Kimai on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Kimai on Google Cloud Run

Kimai is a free, open-source time-tracking application (Symfony/PHP) used by
freelancers and agencies for billable-hours tracking, timesheets, and
reporting that feeds into invoicing. This module deploys Kimai on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation,
which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Kimai uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Kimai runs as a Symfony/PHP container (the official `kimai/kimai2:apache`
image, wrapped in a thin custom build) on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Symfony/PHP service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero by default |
| Database | Cloud SQL for MySQL 8.0 | Required — `Kimai_Common` fixes the engine; PostgreSQL is not supported |
| Object storage | Cloud Storage | A `storage` bucket, GCS-FUSE-mounted at `/opt/kimai/var/data` for uploaded invoice logos/templates and plugin data |
| Secrets | Secret Manager | Auto-generated `APP_SECRET` (Symfony signing key) and `ADMINPASS` (admin password); database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by
  `Kimai_Common`; selecting any other engine breaks the deployment.
- **Custom wrapper image is required, not optional.** `container_image_source
  = "custom"` builds a thin image `FROM kimai/kimai2` whose entrypoint composes
  Kimai's single `DATABASE_URL` connection string at container startup from
  Foundation-injected secret values — Cloud Run cannot do this at plan time
  (see §3).
- **`container_port = 8001`**, not port 80 — confirmed via local `docker run`
  testing and live deployment. This is the `:apache` image variant's actual
  listening port.
- **`enable_cloudsql_volume = false`.** Cloud Run connects to Cloud SQL over
  the **private IP directly (TCP)**, not the Auth Proxy Unix socket. The GKE
  variant instead runs an Auth Proxy sidecar.
- **Two Secret Manager secrets, generated once.** `APP_SECRET` (Symfony
  CSRF/session signing key) and `ADMINPASS` (initial super-admin password) —
  both re-injected from Secret Manager on every container start, so no
  persistent volume is needed just to keep them stable.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `max_instance_count = 1`). Cold starts add latency to the first request
  after idle; set `min_instance_count = 1` to avoid this.
- **`enable_nfs` defaults `true` but is functionally unused.** It mounts
  Cloud Filestore NFS at `/var/lib/kimai`, but the real persistent storage
  path is the GCS-FUSE-mounted `storage` bucket at `/opt/kimai/var/data`.
  Nothing writes to the NFS mount. Safe to disable.
- **No separate migrate job.** `kimai:install` (schema creation and
  migrations) runs on every container boot, idempotently, as part of the
  vendor's own entrypoint chain — only a single `db-init` job is needed to
  create the database and user beforehand.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource
names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Kimai service

Kimai runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

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

### B. Cloud SQL for MySQL 8.0

Kimai stores all application data (projects, activities, timesheets, users,
invoices) in a managed Cloud SQL for MySQL 8.0 instance. The service connects
over the instance's **private IP via TCP** (not the Auth Proxy socket —
`enable_cloudsql_volume` defaults `false` for this module). On first deploy, a
`db-init` job creates the application database and user; `kimai:install` then
creates the schema on the container's own first boot.

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

### C. Cloud Storage

Two GCS buckets can exist for this deployment: a `storage` bucket provisioned
by `Kimai_Common` and GCS-FUSE-mounted at `/opt/kimai/var/data` (uploaded
invoice logos/templates, plugin data), and a **separate**, generic
Foundation-level bucket (`storage_buckets`, defaulting to a bucket named
`data`) that Kimai does not read or write unless you wire it up explicitly.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager:
`APP_SECRET` (Symfony CSRF/session signing key) and `ADMINPASS` (the initial
super-admin account password). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kimai"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on.

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

## 3. Kimai Application Behaviour

- **A single `DATABASE_URL` composed entirely at runtime, not passed through
  Terraform.** Kimai's Doctrine DBAL layer reads one connection string,
  `DATABASE_URL=mysql://user:pass@host:port/db?charset=utf8mb4&serverVersion=8.0`,
  not discrete `DB_*` variables. Because the database password is a runtime
  secret unknown at plan time, and Cloud Run does not interpolate `$(VAR)`
  references the way Kubernetes does, `Kimai_Common` builds a thin custom
  wrapper image `FROM kimai/kimai2` whose `entrypoint.sh` composes
  `DATABASE_URL` at container start from the Foundation-injected
  `DB_USER`/`DB_NAME`/`DB_PASSWORD`/`DB_IP` env vars — URL-encoding the
  password with `php -r 'echo rawurlencode(...)'` (the image has no
  `python3`; it *is* a PHP image) — before handing off unmodified to the
  vendor's own `docker-php-entrypoint /entrypoint.sh`.
- **`DB_IP`, not the standard `DB_HOST`.** The wrapper reads the host from
  `$DB_IP` (aliased via `db_host_env_var_name = "DB_IP"`), which resolves to
  the raw Cloud SQL private IP on Cloud Run — a plain host with no colons,
  safe to place directly in a `mysql://...` URL authority. The standard
  `DB_HOST` can instead be a Cloud SQL Unix socket-directory path containing
  colons, which would break URL parsing if used the same way.
- **Verified locally before ever touching the cloud.** The password
  URL-encoding step and the vendor's own DB-wait preflight check were both
  confirmed by building the wrapper image and running it locally against a
  real MySQL container with a password containing special characters
  (`@:/?`), catching and fixing issues before the first cloud deploy attempt.
- **Health check behaviour.** Both the startup and liveness probes target
  `GET /en/login` (Kimai's login page), which returns `200` once the
  application is ready. `/` also works generically (Kimai issues a `302`
  redirect from the root path), but `/en/login` is the precise, verified
  target actually configured.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/en/login"   # expect 200
  ```
- **Admin bootstrap runs on every boot, idempotently.** The vendor's own
  entrypoint runs `kimai:user:create admin "$ADMINMAIL" ROLE_SUPER_ADMIN
  "$ADMINPASS"` on every container start whenever `ADMINPASS` is set — a
  no-op once the account exists. **The username is always `admin`**,
  hardcoded by the vendor image regardless of `admin_email`'s value.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Kimai are listed; every other input is
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
| `application_name` | `kimai` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Kimai` | Human-readable name shown in the Console. |
| `description` | `Kimai IT asset management on Cloud Run` | Leftover generic text in the shipped default (inherited from an earlier clone source — Kimai is time tracking, not asset management); cosmetic only, does not affect deployment. |
| `application_version` | `latest` | Image tag driving the `kimai/kimai2` build. `"latest"` maps to the maintained `:apache` rolling tag; any other value maps to `"<version>-apache"`. |
| `admin_email` | `admin@example.com` | Super-admin account email, injected as `ADMINMAIL`. The account username is always `admin`, hardcoded by the vendor entrypoint. |
| `php_memory_limit` | `512M` | PHP `memory_limit` (the vendor entrypoint reads the lowercase `memory_limit` env var directly). |
| `enable_gcs_storage_volume` | `true` | GCS-FUSE-mount the `storage` bucket at `/opt/kimai/var/data`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the `DATABASE_URL`-composing wrapper image via Cloud Build — required, not optional, for this module. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Autoscaling upper bound. |
| `container_port` | `8001` | Kimai's `:apache` image variant listens on 8001, confirmed via local testing and live deployment. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `enable_cloudsql_volume` | `false` | Cloud Run connects over the Cloud SQL private IP directly via TCP instead of the Auth Proxy socket. |
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
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `DATABASE_URL` here — it is composed at runtime by the wrapper entrypoint. |
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

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS
bucket after provisioning. See [App_CloudRun](App_CloudRun.md).

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
| `create_cloud_storage` | `true` | Create the generic `data` GCS bucket. Not read or written by Kimai. |
| `enable_nfs` | `true` | **Functionally unused** — mounted at `/var/lib/kimai`, but Kimai's real persistent storage is the GCS-FUSE-mounted `storage` bucket at `/opt/kimai/var/data`. Safe to disable. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts (requires gen2), merged with the `storage` bucket mount. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `Kimai_Common`. |
| `db_name` / `db_user` | `kimai` | Tenant-prefixed at deploy time. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_host_env_var_name` | `DB_IP` | Aliases the DB host so the wrapper's `DATABASE_URL` composition reads a plain, colon-free host — the standard `DB_HOST` can be a socket-directory path on Cloud Run, which would break URL parsing. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (all four) | **Unused by Kimai** — the wrapper reads the standard `DB_USER`/`DB_NAME`/`DB_PASSWORD` directly and hardcodes port `3306`. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in single `db-init` job. There is no separate migrate job — `kimai:install` runs on every container boot, idempotently. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `GET /en/login`, 30s delay, 20 retries | Generous — covers the DB-wait preflight and `kimai:install` on first boot. |
| `liveness_probe` | `GET /en/login`, 60s delay, 3 retries | Kimai's login page, 200 once ready. |
| `uptime_check_config` | `{ enabled = false }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Kimai has no built-in Redis integration used by this module — its default cache backend is the local filesystem. |
| `redis_host` | `""` | Redis endpoint. |
| `redis_port` | `6379` | Redis port. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
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
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (private IP) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Name of the setup job (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, which
> validates values *and combinations* at plan time. Invalid configuration
> fails the **plan** with a clear, named error before any resource is
> created, so most mistakes below are caught up front rather than at apply or
> runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `container_image_source` | `custom` | **Critical** | Switching to `prebuilt` deploys the stock `kimai/kimai2` image with no wrapper entrypoint — `DATABASE_URL` is never composed, so the app cannot reach MySQL at all (Kimai has no other way to receive a working connection string on Cloud Run). |
| `db_host_env_var_name` | `DB_IP` | Critical | The wrapper composes `DATABASE_URL` from this specific alias. Clearing it, or renaming it away from what `entrypoint.sh` expects, leaves the wrapper reading an empty host and the app cannot connect. |
| `container_port` | `8001` | Critical | The `:apache` image variant listens on 8001, not 80 — pointing the platform at the wrong port makes the service unreachable even though the container is healthy. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all timesheets, projects, and invoices. |
| `APP_SECRET` (auto-generated) | Never hand-edit in Secret Manager after first boot | High | Kimai uses this as a Symfony security-signing key; changing it invalidates CSRF tokens and active sessions. |
| Default administrator account (username always `admin`, password in the `ADMINPASS` secret) | Retrieve the generated password from Secret Manager and log in promptly | High | Unlike some catalogue apps, the admin password here is a real, per-deployment generated secret — not a public well-known default — but it is still worth confirming who has read access to the secret. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency to the first request after idle. |
| `enable_nfs` | `false` unless needed for another purpose | Low / cost | Defaults `true` and provisions a Filestore share that Kimai never uses — a needless recurring cost; real persistence is the GCS-FUSE-mounted `storage` bucket. |
| `enable_cloud_armor` | enable for production | Medium | The service is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Kimai-specific application configuration
shared with the GKE variant is described in
**[Kimai_Common](Kimai_Common.md)**.
