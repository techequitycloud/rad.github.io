---
title: "Gitea on Google Cloud Run"
description: "Configuration reference for deploying Gitea on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Gitea on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gitea_CloudRun.png" alt="Gitea on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gitea is a lightweight, self-hosted Git service and software forge (a community fork of Gogs, 45,000+ GitHub stars) that provides repository hosting, issue tracking, pull requests, code review, a package registry, and a built-in Actions CI/CD system from a single Go binary. This module deploys Gitea on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Gitea uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Gitea costs on RAD, and how that compares

**Running Gitea in your own Google Cloud project costs about US$83.61/month in Google Cloud charges, on top of a one-time 110-credit RAD module fee** (99 credits — 10% lower — in a RAD-managed project). Gitea is a lightweight, self-hosted Git service and source-code hosting platform (a community fork of Gogs) with 45,000+ GitHub stars. If you deploy into a RAD-managed project, you can pause the whole thing for free and pick it back up later — see "Pause it for free" below.

*Gitea is also available on GKE — see the [GKE guide](Gitea_GKE.md) if you need Kubernetes-based orchestration; this guide covers the lower-cost Cloud Run option.*

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee | **110 credits** (one-time) | **99 credits** (one-time, 10% lower) |
| Build time | ~3–6 credits (one-time, per build) | ~3–6 credits (one-time, per build) |
| Google Cloud running cost | ~US$83.61/month, billed to your own Google billing account at list price | ~32 credits/day (~US$3.20/day), metered hourly at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | US$13.16 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$83.61** |

### How it compares

- **Gitea Cloud**'s Enterprise tier starts at US$9.50/user/month (1-year commitment required online; SAML SSO, audit logs, priority support) — verified at [https://about.gitea.com/pricing](https://about.gitea.com/pricing). For a team of five that is roughly US$47.50/month and climbing with headcount; RAD's own-project running cost is a flat ~US$83.61/month (Cloud Run) regardless of how many people use it, on an open-source instance you fully control.
- The honest trade here is cap vs. control, not price: a managed SaaS plan is cheaper at this scale, and RAD's running cost is what real Cloud SQL, compute and networking actually cost at Google's list price with nothing hidden in a bundled seat price.
- RAD is not claiming to be cheaper than a bare VPS in cash terms — it usually is not. The case for RAD is what's managed for you.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Gitea is running in a **RAD-managed project**, you can stop paying for it entirely without destroying
it. Deleting that project first unlinks its billing, then asks Google to delete the project outright —
Google's own 30-day recoverable soft delete. Unlike deleting the Gitea module on its own, this does not
tear down Cloud SQL, any VM or the compute resource one by one: the whole project simply stops, and nothing is
charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project and reattaches
its billing account, then asks you to run Update on each deployment to confirm everything came back. Because
nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a
rebuild, and an Update never charges the module fee again. This costs only a handful of build-time credits in
total — roughly 5–10 credits, under US$1, for a typical 2–3-deployment chain. The 99-credit module
fee is not charged again.

What this needs: you must own the project (not one RAD only manages billing for), you must restore it yourself
within 30 days — after that Google deletes it for good — and restoring is admitted like creating a new
project, so your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier
most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has Cloud Storage's
soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though
the project itself is recoverable for 30 days. If you have customised Gitea and want to keep that work,
copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install
with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

If Gitea is in your own project (or more than 30 days have passed on a RAD-managed one), the way to stop
paying is to delete the deployment and redeploy later when you need it again.

A redeploy costs the module fee again, plus the builds: roughly **110 + ~3–6 credits** (~US$11.45)
in your own project, or **99 + ~3–6 credits** on a RAD-managed one.

Deleting only saves money once Gitea would otherwise sit unused long enough to clear that redeploy cost
against its own running cost: roughly **about 5 days or more** idle in your own project (against its
~US$83.61/month Google Cloud bill), or **about 4 days or more** idle in a RAD-managed project
(against its ~32 credits/day).

Most of Gitea's running cost is the database and the shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute share of the total above.

Keep data first: nightly backups go to a bucket inside the deployment and are deleted with it, so copy the
latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the app in their
  own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer
  funds every place, or each participant pays for their own. Everything is deleted when the session ends and
  unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a ring-fenced wallet it
  funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so
  nobody receives an unexpected charge. At the end the partner hands the project over and the deployments
  become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank
  transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; [Google's project delete/restore docs](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [Gitea Cloud pricing](https://about.gitea.com/pricing) for the Gitea Cloud figures.

## 1. Overview

Gitea runs as a single Go-binary container on Cloud Run v2. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | 1 vCPU / 2 GiB by default, request-based billing, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Repository metadata, users, issues, PRs — `GITEA__database__DB_TYPE = "postgres"` |
| Shared files | Filestore / NFS | Repositories, LFS objects, and attachments on the shared `/mnt/nfs` volume (gen2 required) |
| Object storage | Cloud Storage | A `data` bucket provisioned by the foundation, plus the automated-backup bucket |
| Secrets | Secret Manager | `SECRET_KEY`, `INTERNAL_TOKEN`, and the database password managed automatically |
| Container image | Artifact Registry + Cloud Build | Thin custom build over the official `gitea/gitea` image |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the wired engine.** `Gitea_Common` sets `GITEA__database__DB_TYPE = "postgres"`; do not switch `database_type` to MySQL.
- **The image is a near-stock custom build.** Cloud Build produces `FROM gitea/gitea:<version>` plus a small platform entrypoint. The entrypoint exists because Cloud Run does **not** interpolate `$(VAR)` env references — it composes `GITEA__database__{HOST,NAME,USER,SSL_MODE}` from the foundation-injected `DB_*` values at container start and picks the right Postgres SSL mode per connection hop.
- **DB user and name are tenant-prefixed.** The foundation creates the role and database as `gitea<tenant><hex>` and injects them as `DB_USER` / `DB_NAME`; the entrypoint maps them into Gitea. Never hardcode `gitea` in database settings.
- **TCP by default.** `enable_cloudsql_volume = false` — Gitea connects to the Cloud SQL private IP over TCP with `SSL_MODE = require` (the entrypoint switches to `disable` automatically on the Unix-socket or proxy-loopback paths).
- **All repository data lives on NFS.** `GITEA__server__APP_DATA_PATH` is set to the NFS mount (`/mnt/nfs`), so repositories, LFS, and attachments survive restarts and are shared across instances.
- **The first-run web installer is skipped.** `GITEA__security__INSTALL_LOCK = "true"` — configuration is fully supplied via environment variables. The **first user to register becomes the administrator**.
- **Self-registration is enabled by default** (`GITEA__service__DISABLE_REGISTRATION = "false"`). Register your admin account immediately after deploy, then disable registration for private forges.
- A **`db-init` job runs on every apply** to idempotently create the Gitea PostgreSQL role and database.
- **Health probes target `/api/healthz`** — Gitea's unauthenticated health endpoint.
- **Scale-to-zero, request-based billing.** `min_instance_count = 0`, `max_instance_count = 1`, `cpu_always_allocated = false`. Set `cpu_always_allocated = true` only if you rely on scheduled mirror sync, repository health cron, or timed webhook delivery.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Gitea service

Gitea runs as a Cloud Run v2 service that autoscales by request load between the minimum and maximum instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Gitea stores all relational data (users, repositories metadata, issues, pull requests, Actions state) in a managed Cloud SQL for PostgreSQL 15 instance, reached over the **private VPC IP** (no public endpoint). On first deploy a `db-init` Job creates the tenant-prefixed application role and database.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=postgres --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Filestore (NFS) and Cloud Storage

Repository data — bare Git repositories, LFS objects, and issue attachments — is written under `GITEA__server__APP_DATA_PATH` on an **NFS** share mounted into the service, so it persists across restarts and revisions. A **Cloud Storage** `data` bucket is also provisioned, and scheduled backups land in the foundation's backup bucket. The gen2 execution environment is required for NFS mounts.

- **Console:** Filestore → Instances (or Compute Engine → VM instances for the self-managed NFS server); Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Secret Manager

Three secrets are managed automatically: the database password (injected as `GITEA__database__PASSWD`), Gitea's `SECRET_KEY` (encrypts sensitive stored data such as 2FA and OAuth2 tokens), and its `INTERNAL_TOKEN` (authenticates Gitea's own internal API calls). All are generated once and injected at runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gitea"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Artifact Registry & Cloud Build

The deployment builds a thin custom image (`FROM gitea/gitea:<application_version>` + the platform entrypoint) via Cloud Build and stores it in Artifact Registry. Incrementing `application_version` triggers a rebuild against the matching upstream tag.

- **Console:** Artifact Registry → Repositories; Cloud Build → History.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --limit 5
  ```

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity.

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

## 3. Gitea Application Behaviour

- **First-deploy database setup.** A `db-init` Job (`postgres:15-alpine`) waits for the Cloud SQL instance, then idempotently creates the tenant-prefixed application role (with `CREATEDB`), creates the Gitea database owned by that role, and grants privileges. The job runs on every apply (`execute_on_apply = true`, up to 3 retries) and is safe to re-run.
- **Runtime database wiring.** The platform entrypoint logs a line like `Gitea DB wired: host=… sslmode=… name=… user=…` on every start, then hands off to Gitea's stock entrypoint (which writes all `GITEA__*` env vars into `app.ini` and launches the server under s6). When `DB_HOST` starts with `/` it is treated as the Cloud SQL Auth Proxy socket directory (`SSL_MODE=disable`); a loopback host means a proxy sidecar (`disable`); anything else is the private IP over TCP (`SSL_MODE=require`).
- **Installer skipped; first registrant is admin.** `INSTALL_LOCK=true` suppresses the web installer. Register the first account immediately after deploy — it receives administrator privileges. For private forges, then set `GITEA__service__DISABLE_REGISTRATION = "true"` via `environment_variables`.
- **Clone URLs come from `public_domain` / `public_url`.** These drive `GITEA__server__DOMAIN` and `GITEA__server__ROOT_URL`. The defaults (`localhost` / derived) produce wrong clone URLs and redirects — set them to the service's `run.app` host or your custom domain.
- **HTTPS clone only.** Cloud Run routes only the HTTP `container_port` (3000). The image's bundled SSH daemon is not reachable, so use HTTPS remotes (with a Gitea access token or password); SSH-based `git clone` is not available on this platform.
- **Gitea Actions.** The built-in Actions CI/CD server ships with Gitea, but job execution requires separate `act_runner` compute that this module does not provision.
- **Health path.** Startup and liveness probes target `/api/healthz`, which returns HTTP 200 without authentication once Gitea is serving.
- **Verification CLI:**
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/healthz"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Gitea are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `gitea` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Gitea` | Friendly name shown in the Console. |
| `application_version` | `1` | Upstream `gitea/gitea` image tag the custom build is based on; increment (e.g. `1.24`) to upgrade. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the thin wrapper image (required); `prebuilt` deploys the stock image, which **does not work on Cloud Run** (no `$(VAR)` env interpolation for the DB wiring). |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `container_port` | `3000` | Gitea's HTTP port (`GITEA__server__HTTP_PORT`). |
| `min_instance_count` | `0` | Scale-to-zero by default; set `1` to eliminate cold starts. |
| `max_instance_count` | `1` | Cost ceiling. |
| `cpu_always_allocated` | `false` | Request-based billing. Set `true` if you rely on scheduled mirror sync, repo health cron, or timed webhook delivery. |
| `enable_cloudsql_volume` | `false` | TCP to the Cloud SQL private IP (SSL required by the entrypoint). Set `true` for the Unix-socket Auth Proxy path. |
| `execution_environment` | `gen2` | Required for the NFS mount. |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry to avoid Docker Hub rate limits. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy — note IAP in front of Gitea also gates `git` HTTP clients. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables, Secrets & Public URL

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | placeholder `EMAIL_SMTP_*` map | Extra env vars merged over the module defaults. Gitea itself is configured via `GITEA__<section>__<KEY>` names (e.g. `GITEA__mailer__SMTP_ADDR`, `GITEA__service__DISABLE_REGISTRATION`); the placeholder `EMAIL_SMTP_*` keys are not read by Gitea. |
| `public_domain` | `localhost` | Sets `GITEA__server__DOMAIN` — drives clone URLs. Set to your real host. |
| `public_url` | `""` | Sets `GITEA__server__ROOT_URL`; empty derives `http://<public_domain>/`. Set to `https://<host>/` in production. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

All other inputs follow standard App_CloudRun behaviour.

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated database/NFS backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Groups 8–11 — CI/CD, Custom SQL, Domain/CDN/WAF, Storage

Standard App_CloudRun behaviour — see [App_CloudRun](App_CloudRun.md). Gitea-notable entries:

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Keep enabled** — repositories, LFS, and attachments live on the NFS share. |
| `nfs_mount_path` | `/data` | Mount path; also becomes `GITEA__server__APP_DATA_PATH`. |
| `storage_buckets` | one `data` bucket | Foundation-provisioned GCS bucket. |
| `application_domains` | `[]` | Custom hostnames for the external LB — keep in sync with `public_domain`. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Gitea is wired for PostgreSQL — do not change. |
| `db_name` | `gitea` | Base database name; the foundation tenant-prefixes it and injects it as `DB_NAME`. |
| `db_user` | `gitea` | Base application user; tenant-prefixed and injected as `DB_USER`. The password is injected as `GITEA__database__PASSWD`. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Automated DB password rotation. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, 30 s delay, 10 failures | Startup probe against Gitea's health endpoint. |
| `liveness_probe` | HTTP `/api/healthz`, 15 s delay | Liveness probe. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check — enable for production. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

The Redis inputs (`enable_redis`, `redis_host`, `redis_port`, `redis_auth`) are declared for platform convention but are **not forwarded** by this module — Gitea does not use Redis here; setting them has no effect.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter. |
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
| `database_name` / `database_user` | Tenant-prefixed application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
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
| `database_type` | `POSTGRES_15` | Critical | The module wires `GITEA__database__DB_TYPE=postgres`; another engine breaks startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all forge data. |
| `enable_nfs` | `true` | Critical | Without the NFS share, repositories/LFS/attachments live on ephemeral disk and vanish on restart or scale-to-zero. |
| `container_image_source` | `custom` | Critical | The stock image has no platform entrypoint; Gitea tries to dial a host literally named `$(DB_HOST)` and never starts. |
| `container_port` | `3000` | Critical | Mismatching Gitea's HTTP port fails every probe. |
| Database settings via env | never hardcode `gitea` | Critical | The real `DB_USER`/`DB_NAME` are tenant-prefixed; hardcoding fails with `password authentication failed`. |
| `GITEA__service__DISABLE_REGISTRATION` | `true` after first admin | High | Left open, anyone who finds the URL can register on your forge (the very first registrant is admin — claim it immediately). |
| `public_domain` / `public_url` | real host | High | Defaults (`localhost`) produce broken clone URLs and redirects in the UI. |
| `execution_environment` | `gen2` | High | NFS mounts require gen2. |
| `enable_cloudsql_volume` | `false` (TCP) | High | If flipped to socket mode, the entrypoint adapts — but mismatched manual `GITEA__database__HOST` overrides break the SSL-mode selection. |
| `cpu_always_allocated` | `false`, or `true` for mirrors/cron | Medium | Request-based billing throttles background work; scheduled mirror sync and timed webhooks stall while idle. |
| `min_instance_count` | `0` (or `1` for teams) | Medium | Scale-to-zero adds a cold start to the first `git` operation after idle. |
| `uptime_check_config` | enable for production | Medium | Disabled by default; no external availability signal. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Gitea-specific application configuration shared with the GKE variant is described in **[Gitea_Common](Gitea_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Gitea on Cloud Run](../labs/Gitea_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Gitea on GKE Autopilot](Gitea_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Gitea Common — Shared Application Configuration](Gitea_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Woodpecker CI on GKE Autopilot](Woodpecker_GKE.md), [Hoppscotch on Google Cloud Run](Hoppscotch_CloudRun.md), [GlitchTip on Google Cloud Run](GlitchTip_CloudRun.md) in the **Source Control & CI/CD** solution.
