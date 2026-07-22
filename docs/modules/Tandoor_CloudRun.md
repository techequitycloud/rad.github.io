---
title: "Tandoor on Google Cloud Run"
description: "Configuration reference for deploying Tandoor on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Tandoor on Google Cloud Run

Tandoor Recipes is an open-source, AGPL-3.0-licensed self-hosted recipe manager
and meal planner with a Python/Django REST API backend and a bundled Vue 3
frontend. This module deploys Tandoor on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Tandoor uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Tandoor runs as a single all-in-one container on Cloud Run v2 — nginx runs
*inside* the container and proxies to gunicorn over a Unix socket, so no
sidecar or `additional_services` entry is needed. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single all-in-one container (nginx + gunicorn), 1 vCPU / 512Mi by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Tandoor has no supported production fallback engine |
| Object storage | Cloud Storage | A dedicated `data` bucket provisioned automatically (for recipe images), not auto-mounted |
| Cache | Redis (optional) | Genuinely optional — Django falls back to local-memory cache when unset; no Celery/background worker |
| Secrets | Secret Manager | Auto-generated Django `SECRET_KEY` and initial superuser password; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `Tandoor_Common` fixes `database_type =
  "POSTGRES_15"` and `DB_ENGINE = django.db.backends.postgresql`. Tandoor's
  `boot.sh` polls `pg_isready` before proceeding — no lazy-connect — so the
  database must be reachable at container start.
- **Discrete Postgres env vars, not a DSN.** Tandoor reads `POSTGRES_USER` /
  `POSTGRES_PASSWORD` / `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB`
  directly. The platform's standard `DB_*` values are aliased onto these names
  via the `db_*_env_var_name` Foundation variables. No URL-encoding or custom
  entrypoint is needed.
- **`SECRET_KEY` and the superuser password are generated automatically** and
  stored in Secret Manager. `SECRET_KEY` must never be rotated after first
  boot without a maintenance window — rotating it invalidates all active
  sessions and any signed tokens (e.g. password-reset links) in flight.
- **No fixed/hardcoded admin credential.** Unlike this catalogue's other
  recipe-manager module (Mealie, which ships an undocumented, unconfigurable
  `changeme@example.com`/`MyPassword`), Tandoor has a `create-superuser` init
  job that bootstraps a real, unique credential from Secret Manager on every
  deployment.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Tandoor has no background worker or
  scheduled task runner — its recipe URL-import scraping runs synchronously
  within the triggering request — so request-based billing needs no
  override.
- **Redis is genuinely optional and disabled by default.** `CACHES['default']`
  only switches to Redis if `REDIS_HOST` is set; otherwise Django's built-in
  local-memory cache is used. There is no Celery worker or queue to keep warm.
- **Recipe image storage is not GCS-mounted by default.** A `data` bucket is
  created but not automatically mounted — add a `gcs_volumes` entry at
  `/opt/recipes/mediafiles` if uploaded recipe images need to persist across
  revisions.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Tandoor service

Tandoor runs as a Cloud Run v2 service that autoscales by request load between
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

### B. Cloud SQL for PostgreSQL 15

Tandoor stores all application data (recipes, meal plans, shopping lists,
users) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket (though the
`db_host_env_var_name` alias used by Tandoor's own `POSTGRES_HOST` resolves to
the raw private IP on Cloud Run — see the Pitfalls table). On first deploy, an
initialization Job creates the application database and user, and a second job
bootstraps the superuser account.

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

A dedicated **Cloud Storage** `data` bucket is provisioned automatically for
recipe images, but is **not** auto-mounted into the container. Additional
buckets can be declared via `storage_buckets`; mount the data bucket by adding
an entry to `gcs_volumes` targeting `/opt/recipes/mediafiles`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (optional cache)

Redis is **disabled by default**. Tandoor has no Celery worker or background
queue — enabling Redis only switches Django's cache backend from local-memory
to a shared Redis instance, useful for multi-instance deployments that need a
shared cache.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager

Two application secrets are generated automatically and stored in Secret
Manager: the Django `SECRET_KEY` (cryptographic signing for sessions, CSRF
tokens, password-reset links) and `DJANGO_SUPERUSER_PASSWORD` (the initial
superuser login). The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=secret-<prefix>-tandoor-superuser-password --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity.

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

## 3. Tandoor Application Behaviour

- **First-deploy database setup.** The `db-init` initialization Job runs using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user and grants
  privileges. The job is safe to re-run.
- **Superuser bootstrap.** The `create-superuser` init job depends on
  `db-init`. It applies Django migrations (idempotent — a safety net, since
  `boot.sh` also migrates on every container start of the main service, but
  the init job may run before that first boot completes) and then runs
  `python manage.py createsuperuser --noinput`, reading
  `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` /
  `DJANGO_SUPERUSER_PASSWORD` from the environment. It checks for an existing
  account first, so re-applying the module does not error on an
  already-bootstrapped instance.
- **Migrations on every start.** Tandoor's own `boot.sh` applies Django
  migrations on every container start (idempotent), so upgrading
  `application_version` applies schema changes automatically.
- **`SECRET_KEY` is immutable after first boot.** Generated once and written
  to Secret Manager. Rotating it invalidates all active sessions and any
  in-flight signed tokens (e.g. password-reset links). Only rotate during a
  planned maintenance window.
- **Health path.** The startup probe targets `/accounts/login/` — Django's
  public, unauthenticated login view — since Tandoor has no dedicated
  health/info endpoint. It only renders 200 once the app has connected to
  Postgres and applied migrations, making it a genuine readiness signal. The
  liveness probe uses a plain TCP (port-listening) check instead, so a
  transient DB hiccup doesn't flap an already-healthy instance.
- **Log in with the generated credential.** Retrieve
  `DJANGO_SUPERUSER_PASSWORD` from Secret Manager and log in at
  `/accounts/login/` with the configured `admin_username` (default `admin`).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Tandoor are listed; every other input is
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
| `application_name` | `tandoor` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Tandoor` | Human-readable name shown in the Console. |
| `application_description` | `Tandoor recipe manager on Cloud Run` | Service description. |
| `application_version` | `latest` | Tandoor publishes a genuine `latest` tag — passes straight through as the image tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Tandoor uses the official image directly — no custom build needed. |
| `container_image` | `""` | Leave empty for the module default (`vabene1111/recipes`). |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance. |
| `min_instance_count` | `0` | Scale-to-zero by default. |
| `max_instance_count` | `1` | Raise for concurrent traffic. |
| `container_port` | `80` | Tandoor's nginx listens on port 80 (`TANDOOR_PORT`). |
| `cpu_always_allocated` | `false` | Request-based billing — no background worker to keep warm. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Tandoor image into Artifact Registry. |

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
| `environment_variables` | `{}` | Extra non-secret settings. `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, `DJANGO_SUPERUSER_USERNAME`/`EMAIL` are set automatically — do not override these here unless you know what you're changing. |
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

### Group 9 — Custom SQL Scripts

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
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `data` bucket. |
| `gcs_volumes` | `[]` | Add an entry mounted at `/opt/recipes/mediafiles` to persist recipe images across revisions. |
| `enable_nfs` | `false` | NFS is off by default. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Tandoor_Common`; not forwarded. |
| `application_database_name` | `tandoor` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `tandoor` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_host_env_var_name` | `POSTGRES_HOST` | Tandoor's Postgres host env var name. |
| `db_user_env_var_name` | `POSTGRES_USER` | Tandoor's Postgres user env var name. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Tandoor's Postgres password env var name. |
| `db_name_env_var_name` | `POSTGRES_DB` | Tandoor's Postgres database env var name. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Tandoor's Postgres port env var name. |
| `admin_username` | `admin` | Initial superuser username (`DJANGO_SUPERUSER_USERNAME`). |
| `admin_email` | `admin@techequity.cloud` | Initial superuser email (`DJANGO_SUPERUSER_EMAIL`). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `create-superuser` job pair. |
| `cron_jobs` | `[]` | Not used — Tandoor has no platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/accounts/login/` 30s delay | Startup probe — passes once Postgres connectivity and migrations succeed. |
| `liveness_probe` | TCP 30s delay | Liveness probe — a plain port-listening check. |
| `startup_probe_config` | HTTP `/accounts/login/` | Alternative structured probe forwarded directly to the Foundation. |
| `health_check_config` | TCP | Alternative structured liveness probe forwarded directly to the Foundation. |
| `uptime_check_config` | `{ enabled=false }` | Cloud Monitoring uptime check; enable explicitly to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 16 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Tandoor does not require Redis; leave `false` unless integrating an external instance. |
| `redis_host` | `""` | Redis endpoint. |
| `redis_port` | `6379` | Redis port. |

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
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `create-superuser`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
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
> created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions and any signed tokens (e.g. password-reset links) in flight. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `startup_probe` path | `/accounts/login/` | Critical | Pointing the probe at an authenticated/admin endpoint returns 401/403 and the revision never becomes Ready — Tandoor has no other unauthenticated health endpoint. |
| `gcs_volumes` bucket_name formula | `gcs-tandoor<tenant_prefix>-data` | High | A wrong prefix mounts a non-existent bucket, leaving the pod stuck at Init. |
| `DJANGO_SUPERUSER_PASSWORD` (auto-generated) | Retrieve from Secret Manager before first login | Medium | Without retrieving it, you cannot log in — there is no fallback credential like Mealie's fixed default. |
| `db_ssl_mode` (`PGSSLMODE`, set internally) | `require` on Cloud Run | High | The `db_host_env_var_name` alias resolves to the raw Cloud SQL private IP on Cloud Run (not a socket), which rejects unencrypted TCP — this module hardcodes `require` in its wiring so this should not need manual attention, but do not override it to `disable`. |
| `enable_redis` | `false` unless needed | Low | Tandoor has no background worker; Redis only affects Django's cache backend. |
| `ingress_settings` | `all` for a public app | Medium | Setting to `internal` blocks browser access unless paired with IAP or a private network path. |
| `memory_limit` | `≥512Mi` | Medium | Gen2 execution environment enforces a 512Mi floor regardless of billing mode; values below this are rejected at apply. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Tandoor-specific application
configuration shared with the GKE variant is described in
**[Tandoor_Common](Tandoor_Common.md)**.
