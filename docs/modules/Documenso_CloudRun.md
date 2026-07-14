---
title: "Documenso on Google Cloud Run"
description: "Configuration reference for deploying Documenso on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Documenso on Google Cloud Run

Documenso is an open-source DocuSign alternative — a Next.js application for
sending, signing, and managing e-signature documents on infrastructure you
control. This module deploys Documenso on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Documenso uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Documenso runs as a single Next.js container on Cloud Run v2, built from a
thin custom image on top of the official `documenso/documenso` image. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js container on port 3000, 1 vCPU / 2 GiB by default; serverless autoscaling, scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — the engine is fixed at `POSTGRES_15`; MySQL is not supported |
| File persistence | Cloud Filestore (NFS) | Enabled by default, mounted at `/mnt/nfs`, but not used for document storage (see below) |
| Object storage | Cloud Storage | An `uploads` bucket + HMAC service account, provisioned for optional S3-compatible upload transport |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, HMAC keys, and (optionally) SMTP password; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain via Cloud Armor |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type = "POSTGRES_15"` is the
  default. Documenso's Next.js + Prisma stack does not support MySQL, but —
  unlike some other modules — this is **not enforced by a plan-time
  precondition** at either the `Documenso_CloudRun` or `App_CloudRun` level;
  changing `database_type` away from Postgres silently breaks the app at
  runtime rather than failing the plan.
- **Custom build, not prebuilt.** `container_image_source = "custom"` builds a
  thin image `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` that
  adds `bash`, `curl`, `postgresql-client`, and `openssl`, plus a custom
  entrypoint. The official image's own `sh start.sh` runs Prisma migrations
  and starts the Next.js server — there is no separate migrate job.
- **Cloud SQL is reached via a Unix socket, not a TCP proxy.** `enable_cloudsql_volume
  = true` mounts the Cloud SQL Auth Proxy as a Unix domain socket at
  `/cloudsql`; the entrypoint assembles `NEXT_PRIVATE_DATABASE_URL` from the
  injected `DB_*` values, branching on socket path, `127.0.0.1` proxy
  (GKE-only), or direct-IP+SSL depending on what is injected.
- **Redis is not required, and the module's own `enable_redis` variable is
  effectively decorative.** Documenso uses a PostgreSQL-backed local jobs
  provider, so it never reads `REDIS_HOST`/`REDIS_PORT`. More importantly,
  `Documenso_CloudRun`'s `enable_redis`/`redis_host`/`redis_port`/`redis_auth`
  variables are forwarded only to `Documenso_Common` (which does not use them
  either) and are **never** passed to the `App_CloudRun` foundation call in
  `main.tf`. The foundation's own `enable_redis` **defaults to `true`**, so
  `REDIS_HOST`/`REDIS_PORT` (pointed at the NFS server IP, since `enable_nfs`
  is also on by default) are injected into every Documenso deployment
  regardless of this module's `enable_redis` setting — harmless because
  Documenso ignores them, but worth knowing if you're auditing environment
  variables.
- **NFS is enabled by default but Documenso doesn't use it for documents.**
  Documents are stored in PostgreSQL by default
  (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`). The Filestore instance this
  provisions is billed whether or not it's written to.
- **A signing certificate is required for actual document signing.**
  `NEXT_PRIVATE_SIGNING_TRANSPORT = "local"` expects a `.p12` certificate. If
  none is supplied, the entrypoint self-generates a throwaway self-signed
  certificate so the app still boots — but signing with it is not
  production-safe.
- **`webapp_url` is empty by default.** Until set, `NEXTAUTH_URL` and
  `NEXT_PUBLIC_WEBAPP_URL` default to `http://localhost:3000`; the entrypoint
  upgrades them to the platform-injected `CLOUDRUN_SERVICE_URL` automatically
  on boot, but setting `webapp_url` explicitly is recommended once a stable
  URL or domain is known.
- **Scale-to-zero by default.** `min_instance_count = 0`,
  `max_instance_count = 1`. Cold starts add latency to the first request
  after idle.
- **Startup probe is TCP, liveness is disabled.** Documenso exposes no
  dedicated health endpoint, so the startup probe gates on the port binding
  rather than an HTTP path, and the liveness probe is off to avoid
  restart-looping a healthy container.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Documenso service

Documenso runs as a Cloud Run v2 service that autoscales by request load
between the minimum and maximum instance counts. Each deployment creates an
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

Documenso stores all application data (users, documents, recipients, audit
events) in a managed Cloud SQL for PostgreSQL 15 instance. The service
connects privately through the **Cloud SQL Auth Proxy** over a Unix socket; no
public IP is exposed. On first deploy the `db-init` job creates the
application role and database; the official Documenso image then runs its own
Prisma migrations at container startup.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~documenso"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage & file persistence

A dedicated **Cloud Storage** bucket (suffix `uploads`, CORS-enabled for
browser-direct access) and a service account holding an **HMAC key** are
provisioned automatically, granting the storage SA `roles/storage.objectAdmin`
on the bucket. This is opt-in infrastructure: Documenso only writes to it if
you set `NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` and wire the `S3_ACCESS_KEY` /
`S3_SECRET_KEY` secret env vars — by default documents are stored in
PostgreSQL. Separately, an **NFS (Cloud Filestore)** volume is mounted at
`/mnt/nfs` but is not written to by the application in its default
configuration.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

Documenso requires three secrets at boot — `NEXTAUTH_SECRET`,
`NEXT_PRIVATE_ENCRYPTION_KEY`, and `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` —
all Zod-validated by the Next.js app, which will not start without them.
Additionally `S3_ACCESS_KEY` / `S3_SECRET_KEY` (HMAC credentials, only used if
S3 upload transport is enabled) and, when `smtp_host` is set,
`NEXT_PRIVATE_SMTP_PASSWORD` are generated. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~documenso"
  gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows public
access. An external HTTPS load balancer with a custom domain, Cloud CDN, and
Cloud Armor can be layered on; ingress settings and VPC egress control
connectivity.

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

## 3. Documenso Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It waits for Cloud SQL to accept connections, then
  idempotently creates the application role and database (`CREATEDB`
  privilege, ownership set on the target database), grants schema privileges,
  and finally signals the Cloud SQL Auth Proxy sidecar (`POST
  /quitquitquit`) so the job can complete. The job is safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **Migrations run automatically, no separate job.** The official Documenso
  image's own `start.sh` runs Prisma migrations against
  `NEXT_PRIVATE_DATABASE_URL` on every container start, then launches the
  Next.js standalone server.
- **`NEXT_PRIVATE_DATABASE_URL` is assembled at boot.** The custom entrypoint
  builds it from the platform-injected `DB_USER`/`DB_PASSWORD`/`DB_HOST`/
  `DB_NAME`/`DB_PORT`, branching on whether `DB_HOST` is a Unix socket path
  (the normal Cloud Run case, `enable_cloudsql_volume = true`), a `127.0.0.1`
  Auth Proxy loopback (GKE only), or a direct IP (in which case
  `sslmode=require` is forced). `NEXT_PRIVATE_DIRECT_DATABASE_URL` mirrors it.
- **Three secrets are immutable in practice.** `NEXTAUTH_SECRET` and both
  encryption keys are Zod-validated at boot and generated once into Secret
  Manager. `NEXTAUTH_SECRET` can be rotated (invalidates sessions);
  `NEXT_PRIVATE_ENCRYPTION_KEY` must never be regenerated in place — rotate
  only via the secondary-key slot.
- **No bootstrap admin account.** This module does not create a Documenso
  admin/owner user. The first person to complete sign-up through the app's own
  web UI becomes the account owner — standard upstream Documenso behaviour,
  not something this module provisions.
- **Signing certificate is a required post-deploy step for real signing.**
  With no certificate supplied, the entrypoint self-generates a throwaway
  self-signed `.p12` at `/opt/documenso/cert.p12` so the app boots and
  non-signing features work, logging a loud warning. For production signing,
  supply a real certificate via `secret_environment_variables` mapping
  `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (base64-encoded `.p12`) and
  `NEXT_PRIVATE_SIGNING_PASSPHRASE`.
- **Webapp URL resolution.** `NEXTAUTH_URL` / `NEXT_PUBLIC_WEBAPP_URL` default
  to `http://localhost:3000`. If still at that default when the container
  starts, the entrypoint overwrites both with the platform-injected
  `CLOUDRUN_SERVICE_URL`. Set `webapp_url` explicitly once the Cloud Run URL
  or a custom domain is known so OAuth/email links stay stable across
  redeploys.
- **Health path.** Startup probe is **TCP** on port 3000 (30s initial delay,
  20s period, 10 failures allowed) — it succeeds as soon as the container
  binds its port, since the HTTP alternative would require full app+DB
  readiness and risks never passing. The liveness probe is **disabled** by
  default; Documenso has no dedicated health endpoint.
- **Inspect the init job and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform
(matching each variable's `{{UIMeta group=N}}` tag in `variables.tf`). Only
settings specific to or notable for Documenso are listed; every other input is
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
| `application_name` | `documenso` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Documenso` | Human-readable name shown in the Console. |
| `description` | `Documenso - The Open Source DocuSign Alternative` | Service description. |
| `application_version` | `latest` | Sets the `DOCUMENSO_VERSION` build arg for the custom-build `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` base image. |
| `webapp_url` | `""` | Public URL of the instance. Set after first deploy (or once a custom domain is registered) so NextAuth callbacks and email links are stable. Until set, the entrypoint upgrades `localhost:3000` to the live `CLOUDRUN_SERVICE_URL` on every boot. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the thin wrapper image via Cloud Build. `prebuilt` deploys the official image directly (no entrypoint, so `NEXT_PRIVATE_DATABASE_URL` and the signing-cert fallback would not be assembled). |
| `container_image` | `""` | Override image URI; leave blank to use the built-in Documenso image. |
| `container_build_config` | `{ enabled = true }` | Cloud Build configuration; `Documenso_Common` supplies `dockerfile_path`/`context_path`/`build_args` (`DOCUMENSO_VERSION`). |
| `cpu_limit` | `1000m` | 1 vCPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; the Cloud Run gen2 floor is 512Mi regardless of billing mode. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Cost ceiling; Documenso has no documented multi-instance caveat like Listmonk/Activepieces, but raise cautiously. |
| `container_port` | `3000` | Documenso's Next.js server port. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | **Should be set `true`** for the entrypoint's default Unix-socket DB connection path; the module ships this default `false` unlike most database-backed modules (see [Pitfalls](#6-configuration-pitfalls--sensible-defaults)). |
| `enable_image_mirroring` | `true` | Mirror the Documenso image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access, Networking & Email

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all`, `internal`, or `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `smtp_host` | `""` | SMTP server hostname. Leave empty to disable email (invitations, signing notifications). |
| `smtp_port` / `smtp_secure_enabled` | `587` / `false` | Use `465` + `true` for implicit TLS, otherwise STARTTLS on `587`. |
| `smtp_user` | `""` | SMTP authentication username. |
| `smtp_password` | `""` | Auto-generates a Secret Manager value when left empty and `smtp_host` is set. |
| `mail_from` | `""` | Sender address; falls back to `noreply@documenso.local` when `smtp_host` is set but this is empty. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP placeholder keys (`EMAIL_SMTP_*`) | Leftover default set from the module's shared template; Documenso itself reads the `NEXT_PRIVATE_SMTP_*` names assembled from Group 5's `smtp_*` variables, not these `EMAIL_SMTP_*` keys — setting these directly has no effect on Documenso's mailer. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. **This is where you wire a real signing certificate**: `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (base64 `.p12`) and `NEXT_PRIVATE_SIGNING_PASSPHRASE`. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

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

### Group 9 — Custom SQL Scripts & NFS Instance Targeting

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` | `""` | Target an existing NFS GCE VM directly instead of auto-discovering one. |
| `nfs_instance_base_name` | `app-nfs` | Base name for an inline NFS VM when none is found. |

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
| `storage_buckets` | one `data` bucket | Overridden in practice: `documenso.tf` supplies the actual `uploads` bucket (CORS-enabled) via `Documenso_Common`'s `storage_buckets` output, not this variable's default. |
| `enable_nfs` | `true` | Provisions Filestore by default. Not used for document storage — see [Overview](#1-overview). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container (unused by the app's default configuration). |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Not plan-validated at any level** — changing this away from Postgres breaks Documenso's Prisma schema at runtime rather than failing `tofu plan`. |
| `db_name` | `documenso` | The database actually created and injected as `DB_NAME`. Immutable after first deploy. |
| `db_user` | `documenso` | The role actually created and injected as `DB_USER`; password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Target an existing Cloud SQL instance or name an inline one. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Declared for convention parity but **not forwarded** anywhere in `main.tf` or `documenso.tf` — setting any of these has no effect. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job supplied by `Documenso_Common`. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks are defined for Documenso. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, port 3000, `initial_delay_seconds=30`, `failure_threshold=10` | Documenso-specific probe forwarded through `Documenso_Common`'s `config` output. TCP rather than HTTP because no HTTP endpoint reliably signals full readiness without risking a permanently-failing probe. |
| `liveness_probe` | `enabled = false` | Disabled — an HTTP probe against `/` would restart-loop a healthy container before the app is ready. |
| `startup_probe_config` | disabled | Alternative structured probe (disabled by default; `startup_probe` takes effect). |
| `health_check_config` | HTTP `/` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis / Job Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | **Not forwarded to `App_CloudRun`.** Only passed to `Documenso_Common`, which does not reference it either — this variable has no effect on the deployed service. Documenso uses a PostgreSQL-backed local jobs provider and never reads `REDIS_HOST`. The foundation's own `enable_redis` (default `true`, not exposed here) still injects `REDIS_HOST`/`REDIS_PORT` regardless — see [Overview](#1-overview). |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Same caveat — inert at this module's level. |
| `cubejs_api_url` | `http://localhost:4000` | Inert leftover from the shared variable template this module was cloned from (Cube.js API URL — not a Documenso concept); not read by any Dockerfile, entrypoint, or environment mapping in this module. |
| `hub_api_url` | `http://localhost:8080` | Same — inert leftover, not read anywhere in this module. |

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
| `database_host` / `database_port` | DB endpoint (via the Auth Proxy socket) / port. |
| `storage_buckets` | Created Cloud Storage buckets (the `uploads` bucket). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — `min_instance_count > max_instance_count`, IAP enabled with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created. `Documenso_CloudRun` itself adds no additional `validation.tf` beyond the per-variable checks in `variables.tf` — so `database_type` away from Postgres is **not** caught at any level, only at runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Not validated at plan time by this module or the foundation — switching to MySQL/SQL Server breaks Prisma and every query at runtime. |
| Signing certificate (`NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`) | Supply a real `.p12` post-deploy | Critical | Without it, the entrypoint self-signs a throwaway cert — documents "sign" but the signature is untrusted by PDF readers; not production-safe. |
| `NEXT_PRIVATE_ENCRYPTION_KEY` / `_SECONDARY_KEY` (auto-generated) | Never change directly | Critical | These encrypt Documenso data; rotate only via the secondary-key slot, never by regenerating the primary in place. |
| `enable_cloudsql_volume` | `true` | Critical | Defaults to `false` in this module, but the entrypoint's default DB-connection branch expects the Cloud SQL Auth Proxy Unix socket at `/cloudsql`. Leaving this `false` while relying on the default connection path can leave the app unable to reach the database over a socket. |
| `db_name` / `db_user` | Set once | High | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `webapp_url` | Set once the URL/domain is known | High | Left unset, `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` track whatever `CLOUDRUN_SERVICE_URL` resolves to at each boot; an explicit value keeps auth callbacks and email links stable across redeploys. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | Leave unset | Low | Declared but never forwarded to any module — setting them has zero effect. |
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | Leave as-is | Low | Not forwarded to `App_CloudRun`; the foundation's own `enable_redis` (default `true`, not exposed by this module) injects `REDIS_HOST`/`REDIS_PORT` regardless — Documenso ignores them either way, so this is a documentation trap, not a functional risk. |
| `cubejs_api_url` / `hub_api_url` | Leave as default | Low | Inert leftovers from the shared variable template; Documenso never reads them. |
| `environment_variables` default (`EMAIL_SMTP_*` keys) | Use `smtp_host`/`smtp_user`/etc. instead | Medium | The `EMAIL_SMTP_*` keys in the default map are not read by Documenso — configure email via the Group 5 `smtp_*` variables, which are translated into `NEXT_PRIVATE_SMTP_*` by `Documenso_Common`. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start delay on the first request after idle. |
| `enable_nfs` | `true` (default) or `false` if not needed | Medium | Filestore is billed whether or not the app writes to it; Documenso does not use the NFS mount in its default configuration. |
| `smtp_host` | Set for production | Medium | Left empty, no `NEXT_PRIVATE_SMTP_*` variables are injected — no invitation or signing-notification emails are sent. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `container_image_source` | `custom` (default) | High | Switching to `prebuilt` deploys the official image directly, skipping the custom entrypoint that assembles `NEXT_PRIVATE_DATABASE_URL`, resolves the webapp URL, and self-generates a fallback signing certificate. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Documenso-specific application
configuration shared with the GKE variant (secrets, the `db-init` job, and the
custom entrypoint) is defined in `Documenso_Common` (module source:
`modules/Documenso_Common`).
