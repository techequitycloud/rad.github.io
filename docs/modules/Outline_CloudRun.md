---
title: "Outline on Google Cloud Run"
description: "Configuration reference for deploying Outline on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Outline on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Outline_CloudRun.png" alt="Outline on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Outline is a fast, collaborative, Notion-style team knowledge base and wiki with real-time editing, rich markdown documents, and powerful search — an open-source alternative to Confluence and Notion. This module deploys Outline on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Outline uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Outline costs on RAD, and how that compares

**For a team of ten, Outline on RAD's Cloud Run module costs about US$82 a month with no per-user licence.** Outline's own hosted Cloud Starter plan costs US$10 a month flat for up to 10 members — cheaper in cash than either RAD figure above; see **How it compares** for what RAD trades for that. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that US$82 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | About 19 credits per build (RAD's average build takes about 19 minutes) | The same |
| Google Cloud running cost | Billed by Google to your own billing account (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 credits a month (about US$96 at the top-up price, US$77 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | US$11.58 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$82** |

- Cloud SQL and Cloud Run cost the same in africa-south1 (Johannesburg); the VM costs about 10% more.
- **Scale-to-zero is the default.** The Cloud Run line above already reflects that cost; setting `min_instance_count = 1` keeps an instance warm and raises this line, in exchange for no cold starts.
- **Avoid Filestore for a small deployment.** The module uses a small NFS/cache VM by default. Filestore's smallest instance is 1 TiB, which costs about US$164 a month on its own.

### How it compares

- **Outline sells its own hosted Cloud plan.** The Starter plan is a flat **US$10/month for a team of up to 10 members** (getoutline.com/pricing, 8 October 2026), rising to US$79/month for 11–100 members; both plans include the same features.
- RAD's own-project figure above is higher in cash terms because it is dedicated infrastructure, not a shared multi-tenant service — a dedicated Cloud SQL instance, NFS file server and Cloud Run service, rather than a slice of Outline's own.
- A bare VPS — Hetzner CPX22 or a DigitalOcean 2 vCPU/4 GB Droplet, both about US$24/month — undercuts RAD's own-project figure too, at the cost of running PostgreSQL, Redis, backups and patches yourself. Outline only needs 1 vCPU / 1–2 GiB, so a smaller/cheaper VPS tier than that would likely do.
- Outline Cloud is the cheapest of the three until a team outgrows 10 members or needs the data to stay inside its own Google Cloud project.
- If Outline needs to stay up without scaling to zero, or run beside other Kubernetes workloads, see the [GKE guide](Outline_GKE.md) instead — about US$110 a month in your own project, or 2,850 credits (about US$228–285) a month in one RAD manages.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Outline runs in **a project RAD manages for you**, you have a second option that
goes well beyond scaling to zero: **delete the whole project, and restore it within 30
days for close to nothing.** This suits occasional use — studying for a certification,
a demo environment, a seasonal business — far better than running Outline
continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks
  Google to delete the project. Google does not remove the project immediately: it keeps
  it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged
  while it waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or Cloud Run
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its
  billing account, then asks you to run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds
  the same resources already there — it is a check, not a rebuild, and an Update never
  charges the module fee again. That costs a handful of credits (under US$1) for a
  typical 2–3-deployment chain, against the 115 credits
  (US$11.50) a full redeploy costs below.
- **So a month of occasional use can cost a few dollars, not US$82.**
  Deploy Outline, use it for a while, delete the project. Restore it next time you
  want it, confirm with Update, and delete it again when you're done. You pay only for
  the module fee once, the builds, and whatever time Outline was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only
  manages billing for), and you restore it yourself within the 30 days — after that,
  Google deletes it for good. Restoring is admitted like creating a new project: your
  purchased credit balance must still clear the tier's floor (100 credits for the
  sandbox tier most study and demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Outline's backups are written
  to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's
  soft-delete, so it is very likely gone as soon as you delete the project — even though
  the project itself is recoverable for 30 days. If you have made changes to Outline
  you want to keep, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete, the same as the redeploy workflow below. For a default installation
  with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 115
  credits (US$11.50), because RAD recreates the project and shared
  services before Outline. Deleting saves money only once Outline would otherwise
  sit unused for about 5 days or more, both in your own project (about
  US$2.73 a day) and in a RAD-managed one (32 credits a day).
- **Most of the running cost is usually the database and the shared file/cache VM.**
  They stop only when nothing else in the project uses
  them, so deleting Outline while something else shares the
  project saves only Outline's own compute part.
- **Keep data first.** Backups are written to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you**; you enter the settings again
  when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant
  gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an
  allowance the trainer sets. Either the trainer funds every place, or each participant
  pays for their own. Everything is deleted when the session ends and unused credits go
  back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs
  low, billing pauses and the data is kept, so nobody receives an unexpected charge. At
  the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and
ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and what it says about Cloud Storage objects without soft delete; [Outline pricing](https://www.getoutline.com/pricing).

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
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
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

<!-- related-guides -->

## Related guides

- [Hands-on lab: Outline on Cloud Run](../labs/Outline_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Outline on GKE Autopilot](Outline_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Outline Common — Shared Application Configuration](Outline_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [BookStack on Google Cloud Run](BookStack_CloudRun.md), [Paperless-ngx on Google Cloud Run](Paperless_CloudRun.md), [Stirling-PDF on Google Cloud Run](StirlingPDF_CloudRun.md) in the **Knowledge Base & Documentation** solution.
