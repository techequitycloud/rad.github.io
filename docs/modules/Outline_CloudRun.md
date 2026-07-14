---
title: "Outline on Google Cloud Run"
description: "Configuration reference for deploying Outline on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Outline on Google Cloud Run

Outline is a fast, collaborative, Notion-style team knowledge base and wiki with real-time editing, rich markdown documents, and powerful search — an open-source alternative to Confluence and Notion. This module deploys Outline on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Outline uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Outline runs as a Node.js container on Cloud Run v2, built from a custom image (`outlinewiki/outline` plus a platform entrypoint). The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, request-based billing, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Required — connected via the Cloud SQL Auth Proxy Unix socket; `pg_trgm` extension enabled |
| Cache & sessions | Redis | **Required by Outline**; enabled by default, served from the shared NFS host unless `redis_host` is set |
| Shared files | Filestore (NFS) | Uploaded attachments (`FILE_STORAGE=local`) persist across restarts and instances (gen2 required) |
| Object storage | Cloud Storage | A dedicated `storage` bucket provisioned automatically |
| Secrets | Secret Manager | `SECRET_KEY`, `UTILS_SECRET`, and the DB password managed automatically |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Outline is a Sequelize/PostgreSQL application; MySQL is not supported.
- **`DATABASE_URL` and `REDIS_URL` are assembled at container start.** The platform injects the individual pieces (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_NAME`, `REDIS_HOST`, …) and the custom entrypoint builds the connection URLs — never set `DATABASE_URL` yourself.
- **The service URL is injected as `URL`.** `service_url_env_var_name` defaults to `URL` because Outline needs its own public URL to build the OIDC `redirect_uri`. Without it Outline registers **zero** auth providers.
- **An authentication provider is an operator step.** The `OIDC_*` environment variables ship **intentionally blank** — until you configure an OIDC identity provider post-deploy, the login page is empty and the wiki is unusable. See [§3](#3-outline-application-behaviour).
- **Redis is required, not optional.** `enable_redis` defaults to `true`; when `redis_host` is empty the foundation points `REDIS_URL` at the shared NFS host, which co-hosts Redis.
- **Uploads go to NFS.** `FILE_STORAGE=local` with `FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data`, backed by the Filestore mount at the same path (25 MiB per-upload cap by default).
- **`FORCE_HTTPS=false` is set deliberately.** TLS is terminated upstream by Cloud Run; Outline's default HTTPS redirect would break the HTTP health probes.
- **A `db-init` job runs on every apply** to idempotently create the Outline PostgreSQL database and user.
- **Scale-to-zero by default.** `min_instance_count = 0`, `max_instance_count = 1`, request-based billing (`cpu_always_allocated = false`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Outline service

Outline runs as a Cloud Run v2 service listening on port 3000 that autoscales by request load between the minimum and maximum instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts. An open collaborative-editing WebSocket counts as an active request, so CPU stays allocated while someone is editing even under request-based billing.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Outline stores all application data (documents, collections, users, revisions) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP); the entrypoint assembles the socket-form `DATABASE_URL` automatically and the `pg_trgm` extension is enabled for search. On first deploy a `db-init` Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Filestore (NFS) and Cloud Storage

Uploaded attachments and images are written to a **Filestore (NFS)** share mounted at `/var/lib/outline/data` so all instances share the same files and uploads survive restarts. A dedicated **Cloud Storage** bucket (suffix `storage`) is also provisioned automatically. The gen2 execution environment is required for NFS mounts.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis

Outline **requires** Redis for sessions, caching, and its background queue — it will not start without a reachable Redis endpoint. When no external Redis host is configured, the foundation injects a `REDIS_URL` pointing at the shared NFS host, which co-hosts Redis.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

Three secrets are managed automatically: the database password (created by the foundation) plus Outline's `SECRET_KEY` and `UTILS_SECRET` — two 64-hex-character values (the `openssl rand -hex 32` format upstream requires) created by `Outline_Common` and injected into the service at runtime. Plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~outline"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity. Remember that Outline's `URL` must match the host users actually browse to — if you front the service with a custom domain, set `URL` accordingly.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Outline Application Behaviour

- **First-deploy database setup.** A `db-init` Job (`postgres:15-alpine`) connects to Cloud SQL via the Auth Proxy socket and idempotently creates the Outline database and user, grants privileges, and grants the user's role to `postgres` so ownership can be set. The job runs on every apply and is safe to re-run.
- **Migrations on every start.** Outline does not auto-migrate. The custom entrypoint waits for PostgreSQL (`pg_isready`, up to ~3 minutes), then runs the Sequelize migrations (`sequelize db:migrate --env=production-ssl-disabled`) before starting the server, so version upgrades apply schema changes without a manual step.
- **Connection URLs are assembled, not configured.** The entrypoint builds `DATABASE_URL` from the platform-injected `DB_*` variables — socket form (`?host=/cloudsql/…&sslmode=disable`) on Cloud Run — and `REDIS_URL` from `REDIS_HOST`/`REDIS_PORT` with an NFS-host fallback. Do not set either variable manually.
- **`URL` is injected automatically.** The foundation injects the predicted service URL as `URL` (via `service_url_env_var_name = "URL"`). Outline uses it to build the OIDC `redirect_uri` and every absolute link. Override it only when serving from a custom domain.
- **Authentication is a REQUIRED post-deploy step.** The `OIDC_*` placeholders ship blank, and with them blank the login page shows **zero providers** — the deploy is healthy but nobody can sign in. To wire Google as the IdP, for example:
  ```bash
  gcloud run services update <service-name> --project "$PROJECT" --region "$REGION" \
    --update-env-vars=OIDC_AUTH_URI=https://accounts.google.com/o/oauth2/v2/auth,\
  OIDC_TOKEN_URI=https://oauth2.googleapis.com/token,\
  OIDC_USERINFO_URI=https://openidconnect.googleapis.com/v1/userinfo,\
  OIDC_USERNAME_CLAIM=email
  ```
  Then bind the client credentials as secrets. **Gotcha:** `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` ship as *plain empty env vars*, and gcloud refuses to convert an env var to a secret reference in one step ("already set with a different type") — remove them first, then update:
  ```bash
  gcloud run services update <service-name> --region "$REGION" \
    --remove-env-vars=OIDC_CLIENT_ID,OIDC_CLIENT_SECRET
  gcloud run services update <service-name> --region "$REGION" \
    --update-secrets=OIDC_CLIENT_ID=<client-id-secret>:latest,OIDC_CLIENT_SECRET=<client-secret-secret>:latest
  ```
  Register `<URL>/auth/oidc.callback` as an authorized redirect URI on the **same host** as `URL` — the URL, the registered callback, and the browser must all agree on one hostname.
- **HTTPS redirect disabled on purpose.** `FORCE_HTTPS=false` because TLS is terminated by Cloud Run's front end; Outline's own 301-to-HTTPS redirect would send the HTTP health probes to a port with no listener and crash-loop the container. Operators terminating TLS themselves can override via `environment_variables`.
- **Health path.** Startup and liveness probes target `/`, which responds once migrations have completed and Redis is connected. The startup probe allows a 60-second initial delay plus six 10-second retries.
- **Verification.** Confirm the deployed revision received the injected `URL` and DB wiring:
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format="json(spec.template.spec.containers[0].env)" | grep -E '"URL"|DB_HOST|REDIS'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Outline are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `outline` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Outline` | Friendly name shown in the Console. |
| `application_version` | `latest` | Outline image version tag; increment to trigger a new build and revision. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU minimum for Outline. |
| `memory_limit` | `1Gi` | Memory per instance; 2 GiB recommended for production (full-text search, asset handling). |
| `cpu_always_allocated` | `false` | Request-based billing. An open editing WebSocket counts as an active request; set `true` only if you rely on Outline's background queue (email notifications, backlink indexing) running between requests. |
| `min_instance_count` | `0` | Scale-to-zero by default; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Cost ceiling; raise for heavier concurrent editing. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy socket. Required — Outline's Postgres connection uses the socket form. |
| `execution_environment` | `gen2` | Required for the NFS mount. |
| `timeout_seconds` | `300` | Per-request timeout; raise for large exports. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `ingress_settings` | `all` | Which networks may reach the service (all / internal / LB-only). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic routes through the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Merged over the built-in Outline config. This is where you configure the **required** auth provider (`OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI`, …) and optionally override `URL`. Do **not** set `DATABASE_URL`/`REDIS_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (use for `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`). |
| `secret_rotation_period` | `2592000s` | Rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see [App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — Custom SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. Outline must know its public URL — set `URL` to match. |
| `enable_cdn` / `enable_cloud_armor` / `admin_ip_ranges` | off | CDN / WAF options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for uploaded files. Requires gen2. |
| `nfs_mount_path` | `/var/lib/outline/data` | Mount path — must match `FILE_STORAGE_LOCAL_ROOT_DIR`. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. The `storage` bucket is always provisioned automatically. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Outline requires PostgreSQL — do not change to MySQL. |
| `db_name` | `outline` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `outline` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `service_url_env_var_name` | `URL` | Injects the predicted service URL as `URL`. **Do not blank this** — without `URL` Outline registers zero auth providers. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s initial delay, 6 failures | Allows time for first-boot migrations and Redis connection. |
| `liveness_probe` | HTTP `/`, 60s initial delay, 30s period | Restarts the container after 3 consecutive failures. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required** — Outline will not run without Redis. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the shared NFS host (co-hosts Redis). |
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

Returned on a successful deployment — the quickest way to locate and explore the running resources.

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
| `storage_buckets` | Created Cloud Storage buckets (includes the `storage` bucket). |
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
| `OIDC_*` environment variables | configured post-deploy | Critical | Ship intentionally blank — until an IdP is configured the login page shows **zero providers** and the wiki is unusable, even though the deploy is healthy. |
| `service_url_env_var_name` | `URL` | Critical | Blanking it removes the injected `URL`; Outline cannot build the OIDC `redirect_uri` and registers no auth providers. |
| `database_type` | `POSTGRES_15` | Critical | Outline requires PostgreSQL; MySQL breaks startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all documents. |
| `enable_redis` | `true` | Critical | Outline requires Redis for sessions and its queue; without it the container never becomes healthy. |
| `enable_nfs` | `true` | Critical | Without shared storage, uploaded attachments are lost between instances/restarts. |
| `enable_cloudsql_volume` | `true` | Critical | The entrypoint's Postgres connection uses the Auth Proxy socket; direct private-IP TCP is rejected by Cloud SQL without SSL config. |
| `DATABASE_URL` / `REDIS_URL` in `environment_variables` | never set | High | The entrypoint assembles both correctly per platform; a hand-set value overrides it with the wrong host form. |
| `FORCE_HTTPS` | `false` (module default) | High | Re-enabling makes Outline 301-redirect the HTTP health probes → probe failure → crash loop. TLS is already terminated by Cloud Run. |
| OIDC secret binding | remove-then-update | High | `OIDC_CLIENT_ID`/`SECRET` are plain empty env vars; a single `--update-secrets` fails with "already set with a different type" — `--remove-env-vars` them first. |
| OIDC redirect URI | `<URL>/auth/oidc.callback` on the same host as `URL` | High | Host mismatch between `URL`, the registered callback, and the browser breaks the OAuth round-trip. |
| `nfs_mount_path` | `/var/lib/outline/data` | High | Must match `FILE_STORAGE_LOCAL_ROOT_DIR`, or uploads land on ephemeral disk and vanish. |
| `startup_probe` initial_delay_seconds | `60` | High | Reducing it kills Outline before first-boot Sequelize migrations finish. |
| `execution_environment` | `gen2` | High | NFS mounts require gen2; gen1 cannot mount Filestore. |
| `memory_limit` | `1Gi`+ (`2Gi` prod) | Medium | Too little memory OOMs Node.js during search indexing or large exports. |
| `min_instance_count` | `0` (dev) / `1` (prod) | Medium | `0` adds a cold start (with migration check) to the first request after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Outline-specific application configuration shared with the GKE variant is described in **[Outline_Common](Outline_Common.md)**.
