---
title: "Castopod on Google Cloud Run"
description: "Configuration reference for deploying Castopod on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Castopod on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Castopod_CloudRun.png" alt="Castopod on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Castopod is an open-source, ActivityPub-native podcast hosting platform built on
CodeIgniter 4 (PHP 8) and served by FrankenPHP/Caddy. This module deploys Castopod on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Castopod uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Castopod costs on RAD, and how that compares

**Castopod on RAD's Cloud Run module costs about US$84 a month in your own Google Cloud project, with no extra licence fee** — Castopod is open source. In a project RAD manages for you, the same deployment is metered at **32 credits a day** (about 960 a month, about US$96 at the top-up price). Or see the [GKE guide](Castopod_GKE.md) for always-on capacity across pods. If you only need Castopod occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Castopod is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6 credits) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$84 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | US$13.16 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$84** |

Cloud SQL and Cloud Run/GKE pod pricing is the same in africa-south1 (Johannesburg); the small VM costs about 10% more there.

- **Scale-to-zero is the default on Cloud Run.** The figure above assumes modest daily use; set `min_instance_count ≥ 1` to keep it always warm (and avoid cold starts), which raises the Cloud Run line but not the rest of the table.

### How it compares, for an independent podcast

Castopod's own team sells official hosting at castopod.com:

| Plan | Per month | Storage |
|---|---|---|
| Starter | €9.96 (about US$11) | 5 GB |
| Podcaster | €24 (about US$26) | more storage and bandwidth |
| Network | €96 (about US$104) | up to 500 GB, multiple shows |

(USD figures are an approximate conversion; the plans are billed in euros.) Castopod's own hosting tiers by storage and bandwidth rather than compute size, so it is not a direct like-for-like with the table above — RAD's module gives you the same open-source Castopod on infrastructure billed by actual Google Cloud usage, plus managed Cloud SQL, Secret Manager and Cloud Monitoring.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Castopod runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
just this module — unlinks its billing first, then asks Google to delete the project outright. Google
keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it
waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the compute resource one
by one: the whole project simply stops.

- **Restoring is a check, not a rebuild.** Within 30 days, the project's owner can ask Google to undelete
  the project and reattach its billing account, then run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds the same resources
  already there, and an Update never charges the module fee again. For a typical 2–3-deployment chain
  this costs only a handful of credits in total (roughly 5–10 credits, under US$1).
- **What this needs.** You must own the project (not one RAD only manages billing for), restore it
  yourself within 30 days — after that Google deletes it for good — and clear the tier's admission floor
  again (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside the project,
  and that bucket has Cloud Storage's soft-delete turned off, so it is very likely gone as soon as the
  project is deleted — even though the project itself is recoverable for 30 days. Copy a backup out (to
  Google Drive, or a bucket outside the project) before deleting if there is anything in it worth
  keeping; for a default install with nothing irreplaceable, this does not matter.

Source: [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window above has passed, the way to stop paying is to
delete the deployment and deploy it again when you need it.

- **What a redeploy costs.** The module fee again, plus the builds: about 114 credits
  (about US$11.40) at the top-up price, and roughly 15–20 minutes of build time (RAD's
  own platform average). Deleting saves money only once Castopod would otherwise sit unused for about
  **4 days or more** — in your own project that is about US$2.79 a day, and
  in a RAD-managed one it is 32 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Castopod while another application shares the project saves only Castopod's own compute part.
- **Keep data first.** Nightly backups go to a bucket inside the deployment and are deleted with it, so
  copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in
  their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either
  the trainer funds every place, or each participant pays for their own. Everything is deleted when the
  session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced
  wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the
  data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over
  and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card,
bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and backup-bucket caveat;
[Castopod hosting](https://castopod.com/); prices change, check each source before relying on a figure.

## 1. Overview

Castopod runs as a PHP/FrankenPHP container on Cloud Run v2, listening on port 8080.
The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | FrankenPHP/Caddy service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — Castopod does not support PostgreSQL or other engines |
| Media storage | Cloud Storage + Cloud Filestore (NFS) | A `media` bucket is provisioned; NFS is enabled by default to persist uploads across restarts |
| Cache | Redis (optional) | File cache (`CP_CACHE_HANDLER = file`) is the default; Redis is opt-in |
| Secrets | Secret Manager | Auto-generated `CP_ANALYTICS_SALT`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed (`database_type = "MYSQL_8_0"`)
  by the module; selecting PostgreSQL or any other engine breaks startup.
- **The database config is written into Castopod's `.env`, not env vars.** Castopod
  (CodeIgniter 4) reads dot-notated keys (`database.default.hostname` …) that cannot be
  Cloud Run env var names. The container entrypoint materialises them into `.env` from
  the injected `DB_*` variables, and resolves a TCP host (`DB_IP`) because CI4's `mysqli`
  driver cannot use the Cloud SQL socket directory.
- **`CP_ANALYTICS_SALT` is generated automatically** and stored in Secret Manager. Keep
  it stable — it anonymises listener analytics, and changing it breaks de-duplication
  continuity for previously recorded listeners.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Cold starts add a
  few seconds of latency to the first request after idle. Set `min_instance_count = 1`
  to keep Castopod always warm.
- **`max_instance_count = 1` by default.** Do not scale beyond one instance unless the
  shared media filesystem (NFS/GCS) and a shared cache are confirmed multi-instance-safe.
- **NFS is enabled by default** (`enable_nfs = true`) to persist uploaded media across
  container restarts. Castopod stores episode audio and artwork on the filesystem, not
  in the database.
- **The base URL is derived automatically.** The entrypoint sets `CP_BASEURL` from the
  runtime `CLOUDRUN_SERVICE_URL`, so podcast feed and media URLs reflect the real
  service address.
- **CodeIgniter migrations run on container start** — there is no separate migrate job,
  because the platform wrapper entrypoint (`Castopod_Common/scripts/entrypoint.sh`)
  explicitly runs `php spark migrate --all` on every boot; the base `castopod/castopod`
  image does **not** do this automatically. The schema is created on first boot after
  the `db-init` job provisions the DB and user (see §3 below).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Castopod service

Castopod runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~castopod"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for MySQL 8.0

Castopod stores all application data (podcasts, episodes, users, analytics) in a
managed Cloud SQL for MySQL 8.0 instance. The service connects privately — the
entrypoint dials the Cloud SQL private IP over TCP (CodeIgniter's `mysqli` driver
cannot use the Auth Proxy socket directory); no public IP is exposed. On first deploy an
initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~castopod"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs).
See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

### C. Cloud Storage & media persistence

A dedicated **Cloud Storage** `media` bucket is provisioned automatically. Because
Castopod writes uploaded audio and artwork to the container filesystem under
`/var/www/html/public/media`, **Cloud Filestore (NFS)** is enabled by default
(`enable_nfs = true`, mounted at `nfs_mount_path`) so those files survive restarts.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~media"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Redis (object cache)

Redis is **disabled by default** — Castopod uses a filesystem cache
(`CP_CACHE_HANDLER = file`). When `enable_redis = true`, the module injects `REDIS_HOST`
and `REDIS_PORT` for Castopod's object cache. When `redis_host` is left empty and
`enable_nfs` is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected cache/redis env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`CP_ANALYTICS_SALT` (used to anonymise podcast listener analytics). The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows public access
required for public podcast feeds and media downloads. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Castopod Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects through the Cloud SQL Auth Proxy socket (or private-IP
  TCP fallback) and idempotently creates the application database and user, grants
  privileges, and verifies the app user can connect. The job is safe to re-run.
- **Migrations run on container start — via the platform entrypoint, not the base
  image.** The `castopod/castopod` image (built on `serversideup/php`) has no
  CodeIgniter migration hook of its own; its only automatic migration behaviour is
  Laravel-specific (`php artisan migrate`, gated behind `AUTORUN_ENABLED`, default
  `false`) and would not run CI4's `spark migrate` even if enabled. The platform
  wrapper entrypoint (`Castopod_Common/scripts/entrypoint.sh`) explicitly runs `php
  spark migrate --all` — idempotent, safe on every boot — once `.env`/DB connectivity
  is written, so the schema is created on first boot and upgrading the application
  version applies schema changes on the next start, without a separate migration job.
  If this explicit call is ever removed, every request 500s with
  `Table '...' doesn't exist` even though `db-init` succeeded — check `entrypoint.sh`
  first when debugging that symptom.
- **Database config lives in `.env`, injected at runtime.** The entrypoint writes
  `database.default.hostname|database|username|password|port` and `app.baseURL` into
  Castopod's `.env` from the foundation-injected `DB_*` and `CLOUDRUN_SERVICE_URL`
  values. It resolves the DB host to the private-IP TCP address because CI4's `mysqli`
  driver cannot use the Cloud SQL socket directory.
- **`CP_ANALYTICS_SALT` should be stable after first boot.** It is generated once and
  written to Secret Manager; changing it breaks de-duplication continuity for previously
  recorded listeners. Only rotate deliberately.
- **Health path.** The startup probe is **TCP** on the container port and the liveness
  probe is **HTTP `GET /`** — Castopod's unauthenticated homepage returns 200 once booted
  and connected to MySQL. Allow several minutes on first boot for the CodeIgniter
  migrations to complete (the startup probe provides a 30-second initial delay plus a
  20-retry window).
- **First-run setup.** After deploy, open the service URL and complete Castopod's web
  install wizard to create the first super-admin account and set the instance name and
  podcast defaults. Media uploads then persist to the NFS-backed media directory.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Castopod are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `castopod` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Castopod` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Castopod image tag; `latest` is pinned to the current stable release (`1.15.5`). Pin explicitly in production. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; Castopod needs a minimum of 1 vCPU. |
| `memory_limit` | `2Gi` | Memory per instance; minimum 512Mi, 2Gi recommended for large media libraries. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to keep Castopod always warm. |
| `max_instance_count` | `1` | Keep at 1 unless shared media/cache is confirmed multi-instance-safe. |
| `container_port` | `8080` | FrankenPHP/Caddy listens on port 8080. |
| `enable_cloudsql_volume` | `false` | Leave disabled — the entrypoint connects over private-IP TCP for MySQL, not the Cloud SQL Auth Proxy socket. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for public podcast feeds and media downloads. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Cloud Filestore to persist uploaded media across restarts; required for durable media. |
| `nfs_mount_path` | `/var/www/html/public/media` | Container mount path for the NFS volume. |
| `gcs_volumes` | `[]` | Optional GCS Fuse volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed MySQL 8.0 engine. Do not change — Castopod does not support PostgreSQL. |
| `db_name` | `castopod` | MySQL database name. Immutable after first deploy. |
| `db_user` | `castopod` | Application database user. Password auto-generated in Secret Manager. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay | TCP startup probe on the container port; 20-retry window covers first-boot migrations. |
| `liveness_probe` | HTTP `/` 300s delay | Liveness probe against Castopod's unauthenticated homepage (returns 200 when booted). |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Switch Castopod's object cache to Redis; injects `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

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
| `storage_buckets` | Created Cloud Storage buckets (includes the `media` bucket). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match the engine, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Castopod is MySQL-only; any other engine breaks startup and migrations. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all podcast data. |
| `enable_nfs` | `true` | Critical | With NFS off, uploaded episode audio and artwork live on ephemeral disk and are lost on every restart/redeploy. |
| `CP_ANALYTICS_SALT` (auto-generated) | Do not change after first boot | High | Changing it breaks listener de-duplication continuity for previously recorded analytics. |
| `max_instance_count` | `1` unless shared state confirmed | High | Scaling beyond 1 without a shared media filesystem and cache causes inconsistent media and cache across instances. |
| `memory_limit` | `2Gi` | High | Below 512Mi Castopod (PHP 8) fails to boot; large media libraries need more headroom. |
| `ingress_settings` | `all` | High | `internal` blocks public podcast feed and media access. |
| `enable_iap` | only for private instances | High | IAP blocks all unauthenticated access, including public RSS feeds and media downloads. |
| `CP_BASEURL` (auto-derived) | Actual service URL | High | A wrong base URL produces broken feed/media links; the entrypoint derives it from `CLOUDRUN_SERVICE_URL`. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency to the first request after idle. |
| `enable_cloud_armor` | enable for production | Medium | The public UI and admin are reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Castopod-specific application configuration shared with the GKE variant is described in
**[Castopod_Common](Castopod_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Castopod on Cloud Run](../labs/Castopod_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Castopod on GKE Autopilot](Castopod_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Castopod Common — Shared Application Configuration](Castopod_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Ghost on Google Cloud Run](Ghost_CloudRun.md), [PeerTube on Google Cloud Run](PeerTube_CloudRun.md), [WriteFreely on Google Cloud Run](WriteFreely_CloudRun.md), [GoToSocial on Google Cloud Run](GoToSocial_CloudRun.md) in the **Creator & Media Publishing** solution.
