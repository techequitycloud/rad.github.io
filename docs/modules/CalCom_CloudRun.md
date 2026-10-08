---
title: "Cal.com on Google Cloud Run"
description: "Configuration reference for deploying Cal.com on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Cal.com on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalCom_CloudRun.png" alt="Cal.com on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.com is an open-source, AGPL-licensed scheduling platform — the self-hosted
Calendly alternative — built with **Next.js** and **Prisma** on PostgreSQL. This
module deploys Cal.com on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Cal.com uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Cal.com costs on RAD, and how that compares

**Cal.com on RAD's Cloud Run module costs about US$84 a month in your own Google Cloud project, with no extra licence fee** — Cal.com is open source. In a project RAD manages for you, the same deployment is metered at **32 credits a day** (about 960 a month, about US$96 at the top-up price). Or see the [GKE guide](CalCom_GKE.md) for always-on capacity across pods. If you only need Cal.com occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Cal.com is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
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
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$84** |

Cloud SQL and Cloud Run/GKE pod pricing is the same in africa-south1 (Johannesburg); the small VM costs about 10% more there.

- **Scale-to-zero is the default on Cloud Run.** The figure above assumes modest daily use; set `min_instance_count ≥ 1` to keep it always warm (and avoid cold starts), which raises the Cloud Run line but not the rest of the table.

### How it compares, for a team of ten

Cal.com, the project this module deploys, sells its own hosted plans per user:

| Option | Per month (10 users) | Notes |
|---|---|---|
| Cal.com Teams | US$120 (US$12/user) | Hosted by Cal.com |
| Cal.com Organizations | US$280 (US$28/user) | Hosted by Cal.com, adds org-wide admin |
| **RAD, Cloud Run, your own project** | **About US$84**, plus US$7.50 once per deployment | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **About 960 credits (US$96)** | RAD |

- **Cal.com's hosted price grows with every seat; RAD's cost is the infrastructure**, which a growing team only reaches the edge of when it needs more capacity. At ten users RAD's own-project running cost is already below a single month of the Teams plan.
- **A cheap server is cheap until something breaks.** On RAD the database is Cloud SQL with automated backups, and secrets live in Secret Manager. On your own server, that is a job someone has to do.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Cal.com runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
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

- **What a redeploy costs.** The module fee again, plus the builds: about 79 credits
  (about US$7.90) at the top-up price, and roughly 15–20 minutes of build time (RAD's
  own platform average). Deleting saves money only once Cal.com would otherwise sit unused for about
  **3 days or more** — in your own project that is about US$2.79 a day, and
  in a RAD-managed one it is 32 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Cal.com while another application shares the project saves only Cal.com's own compute part.
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
[Cal.com pricing](https://cal.com/pricing); prices change, check each source before relying on a figure.

## 1. Overview

Cal.com runs as a Next.js container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Cal.com (Prisma/`pg`) targets PostgreSQL only |
| Object storage | Cloud Storage (none by default) | Cal.com stores all state in PostgreSQL; no uploads bucket is created |
| Cache | Redis (optional) | Off by default; used for caching / rate limiting |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Cal.com's Prisma schema targets PostgreSQL only.
- **`NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` are generated automatically** and
  stored in Secret Manager. Never rotate them after first boot without a maintenance
  window — rotating `CALENDSO_ENCRYPTION_KEY` renders all stored calendar/OAuth
  credentials undecryptable, and rotating `NEXTAUTH_SECRET` invalidates all sessions.
- **The public URL is validated at startup.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  default to this service's deterministic `run.app` URL; leaving them at the image's
  `localhost:3000` default makes the server refuse to boot. Set `webapp_url` to a
  custom domain before sharing booking links.
- **The schema is created on boot, not by a migration job.** The `db-init` job only
  provisions the empty database and role; Cal.com runs `prisma migrate deploy` on
  every start. Allow several minutes on the first boot.
- **Memory floor is 2 GiB.** Cal.com (Next.js 16) OOM-crashes at startup below 2 GiB.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max = 1`,
  request-based billing). Cold starts add latency to the first request after idle; set
  `min_instance_count = 1` to avoid them.
- **The Cloud SQL Auth Proxy socket is used by default** (`enable_cloudsql_volume = true`).
  A direct private-IP TCP connection fails Prisma's server-certificate verification
  against Cloud SQL's untrusted CA — the socket avoids this (the proxy does the mTLS).
- **Redis is disabled by default.** Enable it only for cache / rate-limit backing.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Cal.com service

Cal.com runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Cal.com stores all application data (users, event types, bookings, connected calendar
credentials) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is
exposed. On first deploy an initialization Job creates the application database and
role, and Cal.com applies its schema via Prisma on boot.

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

Cal.com keeps all state in PostgreSQL, so **no data bucket is created by default**
(`storage_buckets` is empty). Additional buckets can still be declared via
`storage_buckets` if needed for custom integrations.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (optional cache)

Redis is **disabled by default** (`enable_redis = false`). When enabled, Cal.com uses
it as a cache / rate-limit backend. When `redis_host` is left empty and `enable_nfs`
is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`NEXTAUTH_SECRET` (signs NextAuth.js session tokens) and `CALENDSO_ENCRYPTION_KEY`
(encrypts stored calendar/OAuth credentials). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be
layered on; ingress settings and VPC egress control connectivity. Because Cal.com bakes
its public URL into generated booking and OAuth links, set `webapp_url` to the final
domain before going live.

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

## 3. Cal.com Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application role and database and grants privileges on the `public`
  schema. It does **not** create the application schema — that is Cal.com's job.
- **Schema migrations on boot.** The image's start script runs `prisma migrate deploy`
  on every start, creating the schema on first boot and applying new migrations on
  version upgrades — no separate migration step. Budget several minutes for the first
  boot before the service becomes Ready.
- **`NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` are immutable after first boot.**
  Changing `CALENDSO_ENCRYPTION_KEY` makes all stored calendar/OAuth credentials
  undecryptable (every integration must be re-authorised); changing `NEXTAUTH_SECRET`
  logs out every user. Only rotate during a planned maintenance window.
- **Public URL is validated at startup.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  default to the deterministic `run.app` URL and are corrected at runtime from
  `CLOUDRUN_SERVICE_URL`. Verify the deployed value:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **First-run setup.** Open the service URL and complete the Cal.com onboarding to
  create the initial administrator/owner account, then configure at least one
  connected calendar. Self-hosted Cal.com allows self-service sign-up by default —
  restrict it (or front the service with IAP) if the instance should not be public.
- **Startup probe is TCP, not HTTP.** The `/` endpoint only returns 2xx once Cal.com
  reports FULL readiness (DB + Redis + deps), which never passed an HTTP startup probe
  even though Next.js was already listening on the port — so the default probe is a
  30 s-delay TCP check (20 s period, 30 failure retries ≈ 10 minutes) that succeeds as
  soon as the app binds the port. **The liveness probe is disabled by default** for the
  same reason: Cloud Run liveness can't use a TCP socket, and the HTTP `/` endpoint
  would restart-loop an otherwise-healthy container while it's still reaching full
  readiness.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Cal.com are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `calcom` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Cal.com` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Cal.com image tag (sets `CALCOM_VERSION`); pin to a specific release in production. |
| `webapp_url` | `""` | Public URL for `NEXT_PUBLIC_WEBAPP_URL`/`NEXTAUTH_URL`. Empty → the deterministic `run.app` URL; set to a custom domain once known. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_port` | `3000` | Port Cal.com listens on. |
| `cpu_limit` | `1000m` | CPU per instance; Cal.com needs ≥ 1 vCPU. |
| `memory_limit` | `2Gi` | **Minimum 2 GiB** — Next.js 16 OOM-crashes below it. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Cost ceiling; raise for higher concurrency. |
| `cpu_always_allocated` | `false` | Request-based billing. Set `true` only if you run background reminder/notification workers. |
| `execution_environment` | `gen2` | Gen2 required for NFS/GCS Fuse mounts. |
| `enable_cloudsql_volume` | `true` | Auth Proxy socket. **Keep `true`** — direct-IP TCP fails Prisma cert verification. |
| `enable_image_mirroring` | `true` | Mirror the Cal.com image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access. Set `internal`/`internal-and-cloud-load-balancing` to restrict. |
| `enable_iap` | `false` | Require Google sign-in in front of Cal.com. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, or `DATABASE_URL` here — they are managed automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. SMTP or OAuth app credentials). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets` (none by default). |
| `storage_buckets` | `[]` | Additional GCS buckets. |
| `enable_nfs` | `true` | Optional shared volume; also hosts co-located Redis when enabled. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `calcom` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `calcom` | Application database user. Password auto-generated in Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixed to PostgreSQL 15; other engines are unsupported. |
| `database_password_length` | `32` | Generated password length. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | **TCP** on the container port, 30s delay, 20s period, 30 retries (~10 min) | TCP, not HTTP — the `/` endpoint only 2xxs once Cal.com is fully ready (DB + Redis + deps), which never passed as an HTTP gate even though the app was already listening. |
| `liveness_probe` | HTTP `/`, **disabled by default** | Disabled — the HTTP `/` endpoint would restart-loop a healthy container still reaching full readiness, and Cloud Run liveness can't use TCP. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis as the cache / rate-limit backend. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

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
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `CALENDSO_ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all stored calendar/OAuth credentials undecryptable — every integration must be re-authorised. |
| `NEXTAUTH_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Cal.com's Prisma schema targets PostgreSQL only; any other engine breaks startup. |
| `webapp_url` | Final public URL | Critical | A wrong or unset URL is baked into every booking/OAuth link, and the image default (`localhost:3000`) makes the server refuse to boot. |
| `enable_cloudsql_volume` | `true` | High | Direct private-IP TCP fails Prisma's cert verification against Cloud SQL's CA — every query 500s. Keep the Auth Proxy socket. |
| `memory_limit` | `2Gi` | High | Below 2 GiB, Next.js 16 OOM-crashes at startup and the revision never becomes Ready. |
| `enable_iap` | only for private instances | High | IAP blocks all unauthenticated requests — including embeds and public booking pages. |
| Open sign-up | disable for private instances | High | Self-hosted Cal.com allows self-service sign-up; leaving it open lets anyone with the URL create an account. |
| `min_instance_count` | `1` for latency-sensitive use | Medium | Scale-to-zero (`0`) adds cold-start delay on the first request after idle. |
| `startup_probe` type | keep `TCP` | Medium | Switching to HTTP against `/` fails until Cal.com reports full readiness (DB + Redis + deps), wedging the rollout even though the app is already listening. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Cal.com-specific application configuration shared
with the GKE variant is described in **[CalCom_Common](CalCom_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Cal.com on Cloud Run](../labs/CalCom_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Cal.com on GKE Autopilot](CalCom_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [CalCom Common — Shared Application Configuration](CalCom_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [OpenProject on Google Cloud Run](OpenProject_CloudRun.md), [Kimai on Google Cloud Run](Kimai_CloudRun.md), [Documenso on Google Cloud Run](Documenso_CloudRun.md), [Invoice Ninja on Google Cloud Run](InvoiceNinja_CloudRun.md) in the **Professional Services Automation** solution.
