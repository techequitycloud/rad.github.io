---
title: "Fider on Google Cloud Run"
description: "Configuration reference for deploying Fider on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Fider on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Fider_CloudRun.png" alt="Fider on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Fider is an open-source, self-hosted feedback and feature-voting board — customers
post ideas, vote, and comment, and you prioritise by demand. This module deploys
Fider on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation,
which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Fider uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Fider costs on RAD, and how that compares

**In a Google Cloud project you own, Fider on RAD's Cloud Run module costs about US$89 a month, plus US$11 once per deployment and no per-user licence.** GKE Autopilot is the alternative for workloads that must stay up continuously or run beside other Kubernetes apps; see the [GKE guide](Fider_GKE.md), about US$136 a month. Fider is an open-source feedback and feature-voting board where customers suggest, discuss and vote on ideas. Figures are as at 8 October 2026; sources are listed at the end of this section.

If this runs in a project RAD manages for you, it can be deleted and restored within 30 days for a few credits instead of sitting there running — so an occasional-use deployment costs a few dollars a month, not US$89. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$89 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **26 credits a day**, about 780 a month (about US$78 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2 vCPU / 4 GiB, scaling to zero | US$32 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| Cloud NAT gateway and IP address | US$5 |
| Cloud Storage for backups | US$1 |
| **Total** | **about US$89** |


### How it compares

Fider has its own official hosted plan, **Fider Pro**: Fider's own hosted Pro plan is $25/month (unlimited feedback items plus content moderation, month-to-month) — read 8 October 2026.

| Option | Per month | Who runs it |
|---|---|---|
| Fider Pro (official hosted plan) | US$25/mo | Fider |
| **RAD, Cloud Run, your own project** | **US$89**, plus US$11 once | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **about 780 credits (US$78)** | RAD |
| RAD, GKE Autopilot | about US$136; see the [GKE Autopilot guide](Fider_GKE.md) | RAD |

Fider Pro's price was read from its own pricing page on 8 October 2026 and may have changed since — check the source before relying on the figure.

- **Fider Pro is the fixed comparison; a self-managed server is the flexible one.** On your own Hetzner or DigitalOcean box (2 vCPU/4GB, about US$24/month) or a GCP Compute Engine e2-standard-2 (2 vCPU/8GB, about US$49/month) you would pay less in cash than either option, but you run the operating system, the database, backups, security patches and upgrades yourself — exactly what RAD's managed Cloud SQL, Secret Manager and monitoring do for you.
- **A cheap server is cheap until something breaks.** On RAD, backups, point-in-time recovery, password rotation through Secret Manager, and logging and monitoring come from Google Cloud by default. On your own server, or on a fixed-price hosted plan with no infrastructure control, each of those is a job someone still has to do or a limit you cannot change.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Fider runs in **a project RAD manages for you**, you have an option beyond scaling down: **delete the whole project, and restore it within 30 days for close to nothing.** This suits a deployment you only need occasionally — studying for a certification, a demo, a seasonal need — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove it immediately: it keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud SQL, the VM or Cloud Run one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That costs a handful of build-time credits in total (under US$1) for a typical 2–3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$89.** Deploy Fider, use it for a session, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside the project, and that bucket has Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you've customised this deployment and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests, so most of its own compute cost stops on its own when nobody is using it. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 115 credits (US$11.50). Deleting saves money if Fider would otherwise sit unused for about 4 days or more in your own project (about US$2.95 a day), or about 4 days or more in a RAD-managed one (26 credits a day).
- **Delete everything Fider uses.** Most of the running cost is usually the database and any shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
- **Keep data first.** Nightly backups go to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets Fider in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanism; [Fider Pro pricing](https://fider.io/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

Fider runs as a single Go container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go binary, 2 vCPU / 4 GiB by default, serverless autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Fider does not support MySQL or other engines |
| Object storage | Cloud Storage | A dedicated `storage` bucket provisioned automatically |
| File storage | None by default | Fider stores attachments as blobs in PostgreSQL; the optional NFS mount (`enable_nfs`) is off by default and unused |
| Secrets | Secret Manager | Auto-generated `JWT_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer (`database_type = POSTGRES_15`); selecting any other engine breaks
  startup.
- **`JWT_SECRET` is generated automatically** and stored in Secret Manager. It signs
  all authentication and session tokens (including emailed magic sign-in links) and
  **must never be rotated after first boot** — doing so invalidates all active
  sessions and pending sign-in links.
- **Fider is a single Go binary with no background worker.** All state lives in
  PostgreSQL, so there is no queue process to keep warm. The module ships
  `min_instance_count = 1` with `cpu_always_allocated = true` for a consistently warm
  service; because there is no background work, setting `min_instance_count = 0`
  (scale-to-zero) is data-safe if you prefer to trade a cold start for lower cost.
- **No Redis.** Fider uses a PostgreSQL-backed queue and cache (empty `VALKEY_URL`),
  so `enable_redis` defaults to `false`. Leave it off unless you deliberately
  externalise to Redis.
- **NFS is off by default** (`enable_nfs = false`). Fider stores attachments as
  blobs in PostgreSQL (its default), and this module never switches it to
  filesystem mode, so an NFS share would receive nothing.
- **The container listens on port 3000.** The entrypoint exports `PORT = 3000`;
  Cloud Run also auto-injects `PORT = <container_port>`.
- **Schema migrations run on boot.** The custom entrypoint runs `./fider migrate`
  before starting the server, so upgrading the version applies schema changes with no
  separate step.
- **Email is disabled for the demo.** Placeholder SMTP values let the app boot;
  sign-up / invite links are printed to the container log until real SMTP is wired via
  `environment_variables`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Fider service

Fider runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~fider"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Fider stores all application data (posts, votes, comments, users, settings) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through
the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed. On first
deploy the `db-init` Job creates the application role and database and grants
privileges; Fider then runs its own migrations on boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned automatically.
Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Cloud Filestore (NFS)

NFS is **off by default** (`enable_nfs = false`): Fider keeps attachments as blobs
in PostgreSQL, so it needs no shared filesystem. If you enable it anyway, the shared
NFS server VM (managed by `Services_GCP`) must be `RUNNING` before the app deploys,
and the share stays empty unless you also switch Fider to filesystem blob storage.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount path injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Fider does **not** use Redis — do not expect a Memorystore or Redis endpoint.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`JWT_SECRET` (signs authentication and session tokens). The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; ingress settings and VPC egress control connectivity. Set a custom
`BASE_URL` via `environment_variables` when serving from a custom domain.

> **Use the numeric-project URL, not `status.url`.** Every Cloud Run service is
> reachable at two equally-valid hostnames: a numeric-project form
> (`https://<service>-<project-number>.<region>.run.app`) and a random-suffix form
> (`https://<service>-<random8>-<regioncode>.a.run.app`, what `gcloud run services
> describe --format='value(status.url)'` reports). Fider's own Content-Security-Policy
> header is scoped to whichever hostname it was booted against — normally the
> numeric-project form — so a browser landing on the random-suffix `status.url` gets
> every asset request (CSS, JS) blocked by the CSP and renders a completely blank
> page. Always share/visit the numeric-project form.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. Note that when email is
disabled, sign-up / invite links appear in the logs.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Fider Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `fider` role and database, grants privileges, and reassigns ownership of
  the `public` schema to the application role. The job is safe to re-run.
- **Schema migrations on start.** The custom entrypoint runs `./fider migrate` before
  launching the server (the image's `CMD` is overridden to `./fider` only). Migrations
  are idempotent, so upgrading the application version applies schema changes on the
  next start without a separate migration step.
- **`JWT_SECRET` is immutable after first boot.** It is generated once and written to
  Secret Manager. Changing it invalidates all active user sessions and any pending
  emailed sign-in links. Only rotate during a planned maintenance window.
- **First-run setup.** There are no default credentials. The first visit to the
  service URL walks an operator through creating the site and its admin owner. Complete
  this immediately after deploy — use the **numeric-project** URL, not the
  `status.url` random-suffix form (see the CSP/blank-page warning under
  [Networking & ingress](#f-networking--ingress)):
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(metadata.annotations."run.googleapis.com/urls")'
  ```
- **Email is off by default.** Placeholder SMTP values let Fider boot with
  `EMAIL_NOEMAIL = true`; sign-up and invite links are printed to the container log.
  To send real mail, set the Fider SMTP variables (`EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`,
  `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `EMAIL_NOREPLY`) via
  `environment_variables` and remove `EMAIL_NOEMAIL`.
- **Health path.** Startup and liveness probes target `/_health` — an unauthenticated
  endpoint returning `200`. Allow ~7 minutes on first boot (the default startup probe
  provides a 30-second initial delay plus a 30-failure retry window at a 15-second
  period).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Fider are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `fider` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Fider` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Fider image tag (`getfider/fider:<tag>`), mapped to the `FIDER_VERSION` build ARG. `latest` is pinned to `stable` (there is no `:latest` tag); pin to a specific SHA tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `0` | Scale-to-zero. Fider has no background worker, so idling at zero is data-safe; set `1` if you want a warm baseline and will accept the always-on cost. |
| `max_instance_count` | `5` | Cost ceiling; must be ≥ `min_instance_count`. |
| `cpu_always_allocated` | `false` | Instance-based billing for a consistently warm service; safe to set `false` for request-based billing since Fider does no background work. |
| `container_port` | `3000` | Fider listens on 3000; Cloud Run auto-injects `PORT`. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Fider image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access; required to reach the site from browsers. |
| `enable_iap` | `false` | Require Google sign-in in front of Fider. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Wire real SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) or a custom `BASE_URL` here. Do not set `DATABASE_URL`, `JWT_SECRET`, or `PORT`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the GCS buckets defined in `storage_buckets`. |
| `enable_nfs` | `false` | Leave off — Fider stores attachments in PostgreSQL, not on a filesystem. |
| `nfs_mount_path` | `/opt/fider/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Fider requires PostgreSQL. |
| `db_name` | `fider` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `fider` | Application database user. Password auto-generated in Secret Manager. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, 30s delay | Allow ~7 minutes on first boot. |
| `liveness_probe` | HTTP `/_health`, 30s period | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Fider is Postgres-backed; leave off unless externalising to Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only relevant if Redis is enabled. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `JWT_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions and pending emailed sign-in links. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Any non-PostgreSQL engine breaks startup — Fider is Postgres-only. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `container_port` | `3000` | High | A mismatched port makes probes hit a dead port and the revision never becomes Ready. |
| `application_version` | pin a SHA tag; `latest` → `stable` | High | `getfider/fider` has no `:latest` tag; the module pins `latest` to `stable`, but pin explicitly for reproducible upgrades. |
| `memory_limit` | `4Gi` (default) | Medium | Undersizing risks OOM under load; Fider itself is lightweight. |
| `enable_nfs` | `false` (default) | Medium | Fider stores attachments in PostgreSQL, so enabling NFS adds a boot dependency on the shared NFS VM (which must be `RUNNING`) and stores nothing. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` (default) | Low | Fider has no background worker — `0` / `false` is data-safe and cheaper, at the cost of cold starts. |
| SMTP (`EMAIL_SMTP_*`) | Configure for real mail | Medium | Left as placeholders, sign-up / invite links only appear in the logs — no email is sent. |
| `enable_iap` | only when public access not needed | High | IAP blocks all unauthenticated requests, including anonymous browsing of the board. |
| Which Cloud Run URL to visit | numeric-project form, not `status.url` | High | Fider's CSP is scoped to the numeric-project hostname; visiting the random-suffix `status.url` form gets every asset blocked by the browser, rendering a blank page. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Fider-specific application configuration shared
with the GKE variant is described in **[Fider_Common](Fider_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Fider on Cloud Run](../labs/Fider_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Fider on GKE Autopilot](Fider_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Fider Common — Shared Application Configuration](Fider_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Chatwoot on Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout on Google Cloud Run](FreeScout_CloudRun.md), [BookStack on Google Cloud Run](BookStack_CloudRun.md), [Gotify on Google Cloud Run](Gotify_CloudRun.md) in the **Customer Support Desk** solution.
