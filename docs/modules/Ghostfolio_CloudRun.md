---
title: "Ghostfolio on Google Cloud Run"
description: "Configuration reference for deploying Ghostfolio on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Ghostfolio on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghostfolio_CloudRun.png" alt="Ghostfolio on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghostfolio is an open-source, AGPL-licensed wealth management application for
tracking net worth, investment portfolios, and asset allocation across multiple
brokerage accounts and platforms — a privacy-first alternative to commercial
portfolio trackers. This module deploys Ghostfolio on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Ghostfolio uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Ghostfolio costs on RAD, and how that compares

**Running Ghostfolio in your own Google Cloud project costs about US$82.03/month in Google Cloud charges, on top of a one-time 110-credit RAD module fee** (99 credits — 10% lower — in a RAD-managed project). Ghostfolio is an open-source wealth management application for tracking net worth, investment portfolios, and asset allocation across multiple accounts and platforms. If you deploy into a RAD-managed project, you can pause the whole thing for free and pick it back up later — see "Pause it for free" below.

*Ghostfolio is also available on GKE — see the [GKE guide](Ghostfolio_GKE.md) if you need Kubernetes-based orchestration; this guide covers the lower-cost Cloud Run option.*

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee | **110 credits** (one-time) | **99 credits** (one-time, 10% lower) |
| Build time | ~3–6 credits (one-time, per build) | ~3–6 credits (one-time, per build) |
| Google Cloud running cost | ~US$82.03/month, billed to your own Google billing account at list price | ~32 credits/day (~US$3.20/day), metered hourly at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | US$11.58 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$82.03** |

### How it compares

- There is no officially hosted/cloud version of Ghostfolio to compare against, so the honest comparison is against self-managed infrastructure, not a competing SaaS.
- A bare VPS sized to roughly 1 vCPU / 1 GiB — a Hetzner CPX22 (2 vCPU/4GB, ~US$24/mo), a DigitalOcean 2 vCPU/4GB Droplet (US$24/mo), or GCP's own Compute Engine e2-standard-2 (2 vCPU/8GB, ~US$49/mo) — usually undercuts RAD's sticker price; a VPS a size or two smaller would undercut it further.
- What that lower price does not include is the admin's own time: patching the OS, rotating database backups, renewing TLS certificates and watching for downtime. RAD's managed Cloud SQL, Secret Manager and monitoring do that for you, which is the actual trade being made, not the sticker price.
- RAD is not claiming to be cheaper than a bare VPS in cash terms — it usually is not. The case for RAD is what's managed for you.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Ghostfolio is running in a **RAD-managed project**, you can stop paying for it entirely without destroying
it. Deleting that project first unlinks its billing, then asks Google to delete the project outright —
Google's own 30-day recoverable soft delete. Unlike deleting the Ghostfolio module on its own, this does not
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
the project itself is recoverable for 30 days. If you have customised Ghostfolio and want to keep that work,
copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install
with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

If Ghostfolio is in your own project (or more than 30 days have passed on a RAD-managed one), the way to stop
paying is to delete the deployment and redeploy later when you need it again.

A redeploy costs the module fee again, plus the builds: roughly **110 + ~3–6 credits** (~US$11.45)
in your own project, or **99 + ~3–6 credits** on a RAD-managed one.

Deleting only saves money once Ghostfolio would otherwise sit unused long enough to clear that redeploy cost
against its own running cost: roughly **about 5 days or more** idle in your own project (against its
~US$82.03/month Google Cloud bill), or **about 4 days or more** idle in a RAD-managed project
(against its ~32 credits/day).

Most of Ghostfolio's running cost is the database and the shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute share of the total above.

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

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; [Google's project delete/restore docs](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics.

## 1. Overview

Ghostfolio runs as a NestJS (Prisma ORM) container on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | NestJS API + Angular frontend served from one container, 1 vCPU / 1 GiB by default, request-based billing, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Required — Ghostfolio's Prisma ORM does not support MySQL |
| Cache & queue | Redis (**required**, not optional) | Market-data caching, sessions, and Bull queue/job management |
| Secrets | Secret Manager | Auto-generated `ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Ghostfolio's Prisma ORM does not support other engines.
- **Redis is mandatory, not optional.** Unlike many apps in this catalogue where
  Redis is an opt-in performance feature, Ghostfolio's health endpoint itself
  checks Redis connectivity and the app will not serve real traffic without it.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are generated automatically** and
  stored in Secret Manager. Both are boot-blocking — Ghostfolio has no sane default
  for either. Rotating `ACCESS_TOKEN_SALT` after first boot invalidates every
  previously issued Security Token (see §3).
- **No seeded admin account.** Ghostfolio has no email/password login form and no
  first-run setup wizard to fill in — the first visitor to the deployed URL clicks
  "Get Started" and the app mints a random anonymous Security Token as the account
  owner.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Ghostfolio's API is pure request/response with
  no in-process background scheduler of its own, so request-based billing applies
  cleanly.
- **No bulk file/media storage is provisioned.** Ghostfolio has no equivalent of
  user-uploaded attachments; `storage_buckets` is always empty.
- **`DATABASE_URL` is composed at runtime, never via a Unix socket.** Ghostfolio's
  Prisma connection string is a URL-authority DSN
  (`postgresql://user:pass@host:port/db`), and a Cloud SQL socket path's colons
  break that format — the container's cloud entrypoint always connects over TCP
  using the Cloud SQL private IP, with `sslmode=require`.
- **`application_version = "latest"` is genuinely valid.** Unlike several other
  prebuilt-image modules in this catalogue, Docker Hub's `ghostfolio/ghostfolio`
  publishes a real `latest` tag, so no version-pinning workaround is required
  (pinning is still recommended for reproducible builds).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Ghostfolio service

Ghostfolio runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Ghostfolio stores all application data (accounts, holdings, activities, market data
cache, user records) in a managed Cloud SQL for PostgreSQL 15 instance. On first
deploy an initialization Job creates the application database and role; Ghostfolio's
own container entrypoint runs Prisma migrations on every subsequent boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Redis (required)

Redis backs market-data caching, sessions, and Bull queue/job management —
Ghostfolio will not start correctly without a reachable Redis instance. When
`redis_host` is left empty, the platform NFS VM's IP is used as the Redis
endpoint (requires `enable_nfs = true` or a discovered `Services_GCP` NFS server).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the running revision's Redis env vars:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`ACCESS_TOKEN_SALT` (hashes the anonymous Security Token login credential) and
`JWT_SECRET_KEY` (signs auth JWTs). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Ghostfolio Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects to Cloud SQL and idempotently creates the
  application role, database, and grants. The job is safe to re-run.
- **Migrations and seeding run on EVERY container boot**, inside the same process
  as the server — not as a separate init job. The upstream `docker/entrypoint.sh`
  runs `prisma migrate deploy`, then `prisma db seed`, then starts the NestJS
  server. A failed migration crashes the container loudly (the upstream script uses
  `set -ex`) rather than shipping a healthy service against an empty database.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are immutable after first boot.**
  These are generated once and written to Secret Manager. `ACCESS_TOKEN_SALT`
  hashes the anonymous Security Token — rotating it invalidates every previously
  issued token (users must re-register). `JWT_SECRET_KEY` signs session JWTs —
  rotating it logs everyone out.
- **No first-run form to fill in.** The first visitor to the deployed URL sees a
  "Get Started" button; clicking it mints a random Security Token that becomes the
  account owner's login credential. There is no email/password to set or admin
  account to bootstrap.
- **Health path.** Startup and liveness probes target `GET /api/v1/health`, which
  checks BOTH the database AND Redis connections and returns `503` until both are
  healthy — this doubles as a genuine readiness gate, not just a liveness ping.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Ghostfolio are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Ghostfolio` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Deployment-tracking tag. Docker Hub's `ghostfolio/ghostfolio` publishes a real `latest` tag, so this is directly usable — pin to a specific release (e.g. `2.153.0`) for reproducible builds. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU is sufficient for typical usage. |
| `memory_limit` | `1Gi` | 1 GiB is sufficient for typical usage. |
| `min_instance_count` | `0` | Scale-to-zero — Ghostfolio's API is pure request/response. |
| `container_port` | `3333` | Ghostfolio's `DEFAULT_PORT` (`libs/common/src/lib/config.ts`). |
| `cpu_always_allocated` | `false` | Request-based billing — no in-process background scheduler to throttle. |
| `enable_cloudsql_volume` | `true` | Mounts a Cloud SQL Auth Proxy sidecar, but Ghostfolio's cloud entrypoint never connects through the socket path directly — see §1. |
| `container_image_source` | `custom` | Cloud Build wraps the prebuilt `ghostfolio/ghostfolio` image with a thin cloud entrypoint. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `DATABASE_URL`, `PORT`, and `REDIS_PASSWORD` (aliased from `REDIS_AUTH`) are composed by the cloud entrypoint — do not set them here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. a custom market-data provider API key). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `ghostfolio` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `ghostfolio` | Application database user. Password auto-generated in Secret Manager. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. No separate migrate job exists — migrations run inside the app container on every boot. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/health`, 30s delay, 12-failure threshold | Checks BOTH database AND Redis connectivity. |
| `liveness_probe` | HTTP `/api/v1/health`, 30s delay, 3-failure threshold | Same endpoint as the startup probe. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | REQUIRED — always forward unconditionally, never gate on `redis_host != ""`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `"6379"` | Redis port. |
| `redis_auth` | `""` | Redis auth password (sensitive). Aliased at runtime onto Ghostfolio's own `REDIS_PASSWORD` env var. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Always empty — Ghostfolio needs no bulk file/media storage. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through
> the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values
> *and combinations* at plan time. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every previously issued Security Token — every user must re-register. |
| `JWT_SECRET_KEY` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions, forcing immediate re-login. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_redis` | `true`, always forwarded unconditionally | Critical | Ghostfolio's health endpoint checks Redis directly — without it the app never reports healthy, regardless of `redis_host`. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but no host resolves (NFS off, no explicit host), `REDIS_HOST` is empty and the app fails its own health check. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `application_version` | Pin for production | Medium | `latest` is genuinely valid here (unlike most modules), but still floats to whatever Docker Hub currently tags as latest — pin for reproducible deploys. |
| `min_instance_count` | `0` is fine for most deployments | Low | Scale-to-zero adds a brief cold-start delay on the first request after idle; set `1` only if that latency matters. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Ghostfolio-specific application configuration
shared with the GKE variant is described in
**[Ghostfolio_Common](Ghostfolio_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Ghostfolio on Cloud Run](../labs/Ghostfolio_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Ghostfolio on GKE Autopilot](Ghostfolio_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Ghostfolio Common — Shared Application Configuration](Ghostfolio_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Firefly III on Google Cloud Run](FireflyIII_CloudRun.md), [Wallos on Google Cloud Run](Wallos_CloudRun.md), [ActualBudget on Google Cloud Run](ActualBudget_CloudRun.md) in the **Finance & Wealth Tracking** solution.
