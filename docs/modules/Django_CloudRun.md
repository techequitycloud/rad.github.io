---
title: "Django on Cloud Run"
---

# Django on Cloud Run

Django is a battle-tested Python web framework that encourages rapid development and
clean, pragmatic design, powering some of the world's most demanding web applications.
This module deploys Django on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Django uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every Cloud Run application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md)
rather than repeating them here.

---

## 1. Overview

Django runs as a Python/Gunicorn container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python/Gunicorn container, 1 vCPU / 512 MiB by default; autoscaled to zero |
| Database | Cloud SQL for PostgreSQL 15 | Required — Django's `DB_ENGINE` is fixed to `django.db.backends.postgresql` |
| Shared files | Filestore (NFS) | Shared media across all container instances (requires gen2 execution environment) |
| Object storage | Cloud Storage | A dedicated media bucket provisioned by Django_Common |
| Secrets | Secret Manager | Auto-generated Django `SECRET_KEY` and database password |
| Cache (optional) | Redis / Cloud Memorystore | Disabled by default; enable for session storage and caching |
| Ingress | Cloud Load Balancing | External HTTPS load balancer with optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is fixed.** `Django_Common` hard-wires `DB_ENGINE` to PostgreSQL;
  MySQL and `NONE` are not supported through this module.
- **The Django `SECRET_KEY` is auto-generated** and stored in Secret Manager;
  it is injected at runtime and never set in plain text.
- **Four PostgreSQL extensions are installed automatically** (`pg_trgm`, `unaccent`,
  `hstore`, `citext`) by the `db-init` job, so you do not need to configure them.
- **Two initialization jobs run by default** — `db-init` (creates the database and
  user) and `db-migrate` (runs `manage.py migrate` and `collectstatic`). On Cloud Run
  these run as Cloud Run Jobs triggered on apply.
- **NFS is enabled by default.** All container instances share the same Filestore
  volume for uploaded media files. NFS mounts require
  `execution_environment = "gen2"` (set automatically).
- **Redis is disabled by default.** Enable with `enable_redis = true` and point at a
  Cloud Memorystore instance for production session storage and caching.
- **Scale to zero by default.** `min_instance_count` defaults to `0`; set to `1`
  for production to eliminate cold starts.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT`, `REGION`, and `SERVICE` are set. The service name and
other identifiers are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run v2 — the Django service

Django runs as a Cloud Run service scaled automatically between `min_instance_count`
and `max_instance_count`. Each instance runs a Cloud SQL Auth Proxy sidecar and,
when NFS is enabled, mounts the Filestore share.

- **Console:** Cloud Run → select the service to see revisions, traffic splits, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT"
  gcloud run services list --region "$REGION" --project "$PROJECT"
  # Stream live logs:
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"' \
    --project "$PROJECT" --limit 50
  ```

See [App_CloudRun](App_CloudRun.md) for revision traffic splits, min/max
instances, concurrency, and execution environment configuration.

### B. Cloud SQL for PostgreSQL 15

Django stores all application data in a managed Cloud SQL for PostgreSQL 15 instance.
Container instances reach it through the **Cloud SQL Auth Proxy** over a local Unix
socket, so no public IP is exposed. On first deploy the `db-init` Cloud Run Job
creates the application database and user, installs the required extensions, and
grants privileges. The `db-migrate` job then runs `manage.py migrate` and
`manage.py collectstatic`.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # List the initialization jobs:
  gcloud run jobs list --region "$REGION" --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) and Cloud Storage

Uploaded media is written to a **Filestore (NFS)** share mounted into every container
instance so all replicas see the same files. A dedicated **Cloud Storage** media
bucket is also provisioned automatically by `Django_Common`; the workload service
account is granted access. NFS mounts on Cloud Run require the `gen2` execution
environment, which this module sets by default.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the media bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for NFS provisioning, GCS Fuse volumes,
and CMEK options.

### D. Redis cache

Redis is **disabled by default**. When `enable_redis = true`, Django receives
`REDIS_HOST` and `REDIS_PORT` as environment variables. Configure `settings.py` to
use these for `CACHES` and `SESSION_ENGINE`. The module does not provision a Redis
instance — use a Cloud Memorystore instance and set `redis_host` to its private IP.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  # Confirm REDIS_HOST and REDIS_PORT are in the service environment:
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format="json" | jq '.spec.template.spec.containers[0].env[]|select(.name|startswith("REDIS"))'
  ```

### E. Secret Manager

The Django `SECRET_KEY` and the database password are stored as Secret Manager
secrets and injected into container instances at runtime; plaintext never appears in
configuration. The superuser password (if you create one via `DJANGO_SUPERUSER_PASSWORD`)
should also be stored here.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # The database password secret name is in the Outputs:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the secret mounting model, volume
mounts versus env-var references, and rotation.

### F. Networking & ingress

By default the service is exposed through an external Cloud Load Balancing HTTPS
endpoint. A custom domain with a Google-managed certificate can be enabled via
`enable_custom_domain`, and a static IP can be reserved so the address survives
redeploys. Ingress can be restricted to `internal` or `internal-and-cloud-load-balancing`
via `ingress_settings`, and VPC egress can be controlled via `vpc_egress_setting`.

- **Console:** Network services → Load balancing; Cloud Run → service → Networking tab.
- **CLI:**
  ```bash
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format="value(status.url)"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for custom domains, Cloud CDN,
static IP, and VPC egress details.

### G. Cloud Logging & Monitoring

Container stdout/stderr flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Django Application Behaviour

- **First-deploy database setup.** A `db-init` Cloud Run Job creates the PostgreSQL
  database and user, grants privileges, and installs the four required extensions
  (`pg_trgm`, `unaccent`, `hstore`, `citext`) using the `ROOT_PASSWORD` superuser
  secret. The job is idempotent and safe to re-run.
- **Migrations on first deploy.** A `db-migrate` Cloud Run Job runs
  `manage.py migrate` and `manage.py collectstatic --noinput --clear` after `db-init`
  completes. Both jobs are triggered automatically on apply
  (`execute_on_apply = true`). Override `initialization_jobs` with a non-empty list
  to replace them with custom jobs.
- **`SECRET_KEY` management.** A 50-character random key is generated by
  `Django_Common` and stored in Secret Manager. It is injected as `SECRET_KEY`.
  Do not set `SECRET_KEY` in `environment_variables`.
- **Superuser creation.** If `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`,
  and `DJANGO_SUPERUSER_PASSWORD` are present as environment variables when the
  container starts, `entrypoint.sh` creates a Django superuser on first boot. Use
  `secret_environment_variables` for the password:
  ```bash
  # Retrieve the superuser password from Secret Manager:
  gcloud secrets versions access latest --secret=<superuser-secret> --project "$PROJECT"
  ```
- **Health probes.** The startup probe targets `GET /healthz` on port 8080 with a
  60-second initial delay. The liveness probe also targets `GET /healthz` with a
  30-second initial delay. Implement a lightweight `/healthz/` view that returns HTTP
  200 with no redirects. Note that Cloud Run health probe traffic arrives over HTTP;
  avoid setting `SECURE_SSL_REDIRECT = True` in `settings.py` or the probe will
  receive a 301 redirect and the service will never become healthy.
- **Scheduled tasks.** Django management commands (e.g., `clearsessions`) can be
  scheduled as Cloud Run Jobs via the `cron_jobs` variable:
  ```bash
  gcloud run jobs list --region "$REGION" --project "$PROJECT"
  gcloud run jobs execute <job-name> --region "$REGION" --project "$PROJECT"
  ```
- **gen2 execution environment.** NFS mounts require Cloud Run gen2 containers.
  This is set automatically when `enable_nfs = true`. If you disable NFS you may
  override `execution_environment` to `"gen1"`, but gen2 is strongly recommended.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Django are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the Cloud Run service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `django` | Base name for resources. **Do not change after first deploy.** |
| `application_display_name` | `Django Application` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Service description annotation. |
| `application_version` | `latest` | Image version tag; increment to roll out a new revision. Pin to a specific tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build; `prebuilt` deploys an existing image URI. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | Override container image URI. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits per instance. |
| `min_instance_count` | `0` | Minimum warm instances. Set ≥ 1 to eliminate cold starts in production. |
| `max_instance_count` | `1` | Maximum concurrently active instances. |
| `container_port` | `8080` | Django/Gunicorn listens on port 8080. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `execution_environment` | `gen2` | Required for NFS mounts. Do not change unless NFS is disabled. |

### Group 5 — Traffic Management & IAP

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Cloud Run ingress: `all`, `internal`, or `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Egress through the serverless VPC connector. |
| `enable_iap` | `false` | Require Google sign-in in front of Django. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access when IAP is enabled. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not include `SECRET_KEY` or `DB_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g., `DJANGO_SUPERUSER_PASSWORD`). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. Set `enable_backup_import = false` after a successful import. |

### Group 8 — CI/CD & GitHub Integration

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_cdn` | `false` | Enable Cloud CDN on the load balancer. |
| `application_domains` | `[]` | Hostnames to serve (also used for custom domain). |
| `enable_custom_domain` | `false` | Provision HTTPS load balancer for custom hostnames. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 11 — Filesystem (NFS) & Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Django media (keep enabled for multi-instance). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. Must match `MEDIA_ROOT` in `settings.py`. |
| `create_cloud_storage` | `true` | Provision the additional data bucket. The media bucket is always provisioned by `Django_Common`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the auto-provisioned media bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **PostgreSQL 15 required.** Django does not support MySQL through this module. |
| `application_database_name` | `django_db` | Database name. Immutable after first deploy. |
| `application_database_user` | `django_user` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_user_env_var_name` / `db_name_env_var_name` | `""` | Override the env var name used to inject the DB user/name. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `enable_postgres_extensions` | `false` | Set `true` only to install **additional** extensions beyond the four auto-installed (`pg_trgm`, `unaccent`, `hstore`, `citext`). |
| `postgres_extensions` | `[]` | Additional PostgreSQL extensions (e.g., `postgis`, `uuid-ossp`). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | _(built-in `db-init`)_ | By default, one `db-init` Cloud Run Job is defined. The `db-migrate` job is always added by `Django_Common`. Provide a non-empty list to replace the default `db-init` with custom jobs. |
| `cron_jobs` | `[]` | Scheduled Cloud Run Jobs (e.g., `clearsessions`, `cleartokens`). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /healthz`, 60s initial delay | Startup probe passed to `Django_Common`. Increase delay for large migration sets. **Do not use a redirect path.** |
| `liveness_probe` | HTTP `GET /healthz`, 30s initial delay | Liveness probe. Use a lightweight endpoint that returns 200 with no body. |
| `startup_probe_config` | `/healthz`, 10m timeout | App_CloudRun-level infrastructure startup probe. |
| `health_check_config` | `/healthz`, 1s timeout | App_CloudRun-level infrastructure health check. |
| `uptime_check_config` | enabled, path `/` | Optional Cloud Monitoring uptime check. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session storage and caching. |
| `redis_host` | `""` | Redis host IP or hostname. |
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

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | HTTPS URL to reach Django. |
| `service_location` | Region the service is deployed in. |
| `stage_services` | Map of Cloud Deploy stage service names and URLs. |
| `load_balancer_ip` / `load_balancer_url` | External IP and HTTPS URL (when a static IP is reserved). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of the setup Cloud Run Jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `uptime_check_names` | Names of provisioned Cloud Monitoring uptime checks. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Django requires PostgreSQL; MySQL or `NONE` will fail the `db-init` job. |
| `application_name` / `tenant_deployment_id` | set once | Critical | Embedded in resource names; changing recreates all named resources and destroys data. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `startup_probe` path | `/healthz` (no redirect) | Critical | Cloud Run probe traffic is plain HTTP; a redirect returns 301, Cloud Run never sees 200, service never starts. |
| `SECURE_SSL_REDIRECT` in `settings.py` | `False` or exempt `/healthz` | Critical | `True` redirects every HTTP request including the startup probe; service stuck in `STARTING`. |
| `enable_backup_import` | `false` after restore | High | Leaving `true` re-runs the import on every apply, overwriting live data with stale backup. |
| `enable_nfs` | `true` (default) | High | Disabling with `max_instance_count > 1` means each instance has isolated ephemeral storage; uploads are lost on instance teardown. |
| `execution_environment` | `gen2` (default when NFS enabled) | High | `gen1` does not support NFS volume mounts; service fails to start. |
| `nfs_mount_path` | `/mnt/nfs` — must match `MEDIA_ROOT` | High | Mismatch causes Django to write media to ephemeral storage; files lost on instance teardown. |
| `container_resources` memory | ≥ `512Mi`; raise for ORM-heavy workloads | High | Too little memory: instance exits with OOM (exit 137) on large querysets or file processing. |
| `min_instance_count` | `1` for production | Medium | `0` causes cold starts (>60 s) on first request after idle; cron jobs may find no warm instance. |
| `application_version` | pinned tag, not `latest` | Medium | `latest` makes rollback ambiguous; Cloud Run cannot tell two `latest` pulls apart. |
| `enable_redis` | `true` when using Redis-backed sessions | Medium | Left `false` with Redis-configured `settings.py`: `ConnectionRefusedError` on every cache/session access. |
| `ingress_settings` | `internal-and-cloud-load-balancing` for load-balanced private services | Medium | `all` allows direct invocation of the Cloud Run endpoint URL bypassing Cloud Armor/IAP. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | Django admin UI is otherwise publicly reachable at the service URL. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Django-specific application configuration shared
with the GKE variant is described in **[Django_Common](Django_Common.md)**.
