---
title: "Planka on Google Cloud Run"
description: "Configuration reference for deploying Planka on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Planka on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Planka_CloudRun.png" alt="Planka on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Planka is an open-source, self-hosted, Trello-like kanban board application
with a Node.js (Sails.js) backend and a React frontend, used for team and
personal project management — boards, lists, cards, due dates, labels, and
file attachments. This module deploys Planka on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages
the shared Google Cloud infrastructure.

This guide focuses on the cloud services Planka uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Planka costs on RAD, and how that compares

**Running Planka in your own Google Cloud project costs about US$88.56/month in infrastructure, plus a one-time module fee of 75 RAD credits** (sized at 2 vCPU / 4 GiB on a scale-to-zero Cloud Run instance). RAD charges the module fee once, at deploy time — never again on Update — plus build time metered in credits; Google Cloud usage itself is billed to your own billing account at Google's list price. On a **RAD-managed** project the same resources are metered hourly in credits at list price plus RAD's margin — about 26 credits/day — and the module fee is 10% lower, at 67.50 credits. See "Pause it for free" below for how a RAD-managed Planka deployment can be stopped, at no running cost, until you need it again. (or see the [GKE guide](Planka_GKE.md) if you need Kubernetes)

### What you pay on RAD

| Item | Own project | RAD-managed project |
|---|---|---|
| Module fee | 75 credits (once) | 67.50 credits (once) |
| Build time | ~3-6 credits, metered per build minute | same, metered in credits at list price + RAD's margin |
| Google Cloud running cost | ~$88.56/month, billed to your own billing account at Google's list price | ~26 credits/day, metered hourly at list price + RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | 31.53 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | 51.02 |
| Cloud NAT and networking | 5 |
| Cloud Storage (add-ons, backups) | 1 |
| **Total** | **$88.56** |

### How it compares

- We could not verify a current, directly-comparable commercial SaaS price for this exact open-source project, so the honest comparison is a bare self-managed server: Hetzner CPX22 (2 vCPU/4GB, ~$24/mo), a DigitalOcean 2 vCPU/4GB Droplet (~$24/mo), or a GCP Compute Engine e2-standard-2 (2 vCPU/8GB, ~$49/mo).
- RAD is **not** claiming to beat a bare VPS on sticker price — it usually does not. What RAD adds for the same or a similar dollar figure is a managed database, Secret Manager-held credentials, monitoring, and one-click Update, none of which a bare VPS gives you for free.
- On a bare VPS you are the one applying OS/database security patches, taking and testing backups, and renewing certificates; RAD's managed Cloud SQL, Secret Manager and monitoring handle all three for you.

### Pause it for free: delete a RAD-managed project, restore it when you need it

This is the headline option on a **RAD-managed** project, and it is free while paused. Deleting
a RAD-managed project first unlinks its billing, then asks Google to delete the project itself —
Google's own 30-day recoverable soft delete. Unlike deleting a single module, this does not tear
down the database, any VM, or the compute resource one at a time: the whole project simply
stops, and because billing is already unlinked, nothing is charged while it waits.

Restoring — within 30 days, and only by the project's owner — asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment to
confirm everything came back. Because nothing was individually destroyed, that Update finds the
same resources already there: it is a check, not a rebuild, and an Update never charges the
module fee again. The whole restore costs only a handful of credits (under US$1) in build time
for a typical chain of deployments. What this needs: you must own the project (not merely have
RAD manage its billing), you must restore it yourself within the 30 days — after that Google
deletes it for good — and restoring is admitted like creating a new project, so your purchased
credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and
demo use fits). Google says most services are fully working again within 36 hours of a restore.

**One real gap:** nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so the backup bucket is very likely gone as
soon as you delete the project — even though the project itself is recoverable for 30 days. If
you have customised this deployment and want to keep that work, copy a backup out (to Google
Drive, or a bucket outside the project) before deleting. For a default install with nothing
irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

The other lever, for an **own project** (or a RAD-managed one past its 30-day restore window),
is to delete Planka outright and redeploy it later. A redeploy costs the module fee again
plus the builds — roughly **78-81 credits** in total for this module.

Deleting only saves money once Planka would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — for this module, that is about 3 days or more of being idle,
based on its own US$88.56/month running cost above. Most of that running cost is
usually the database and any shared file/cache VM, and they stop only once nothing else in the
project uses them, so deleting this app alone saves only its own compute share if something else
shares the project.

**Keep data first:** nightly backups go to a bucket inside the deployment and are deleted with
it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the
  app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
  card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Resource Manager: delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics.

## 1. Overview

Planka runs as a single Node.js container on Cloud Run v2, serving both its
API and its React frontend from one port. The deployment wires together a
small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Planka's Knex query builder supports no other engine |
| Object storage | Cloud Storage | A `storage` bucket is created and mounted at `/app/data` for attachments, avatars and backgrounds |
| Cache & queue | none | Planka has no Redis or queue dependency — real-time updates ride Socket.io in-process |
| Secrets | Secret Manager | `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` — both real, functional secrets — plus the database password |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only supported engine.** `Planka_Common` fixes
  `database_type = "POSTGRES_15"` — Knex has no other backend for Planka.
- **A thin custom build, not the prebuilt image.** Planka needs a cloud
  entrypoint to compose `DATABASE_URL` from the Foundation-injected `DB_*`
  values at runtime (the password is a Secret Manager value, unavailable at
  plan time) and to derive `BASE_URL` from the service URL, so
  `container_image_source = "custom"` builds `FROM
  ghcr.io/plankanban/planka:<version>` via Cloud Build.
- **`DATABASE_URL` is a URL-authority connection string, but SSL is set via
  separate env vars — not a `?sslmode=` query parameter.** Unlike some
  Node/Postgres apps in this catalogue (e.g. Logto), Planka's own
  `.env.sample` states Knex does not parse query parameters from the
  connection string at all. TLS mode is controlled instead by the plain
  `PGSSLMODE` and `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` environment
  variables, which node-postgres reads natively — see the
  [Common guide](Planka_Common.md) for the full socket/loopback/private-IP
  branching logic.
- **Two real, functional application secrets.** `SECRET_KEY` (session/token
  signing, required at boot) and `DEFAULT_ADMIN_PASSWORD` (seeds the initial
  admin account on first, empty-database boot) are both genuinely consumed by
  Planka — confirmed against its own source (`server/.env.sample`,
  `server/db/seeds/default.js`). Planka has **no forced password-reset
  prompt**, so change the seeded password immediately after first deploy.
- **Attachments persist by default.** The module mounts the `storage` GCS
  bucket at Planka's `/app/data` path, which holds every upload type
  (attachments, avatars, backgrounds, favicons). Board/card/list *data* is in
  PostgreSQL.
- **Request-based billing by default.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — Planka's real-time updates ride Socket.io
  in-process on the request-serving process, so it needs no background CPU.
- **No Redis.** Planka has no cache or queue dependency;
  `enable_redis` defaults to `false`.
- **No NFS.** `enable_nfs` defaults to `false` — Planka needs no POSIX
  filesystem sharing; the auto-mounted GCS bucket covers file storage.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Planka service

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected DB_HOST / DB_IP / BASE_URL on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, and traffic
splitting.

### B. Cloud SQL for PostgreSQL 15

Planka stores all boards, lists, cards, and user data in a managed Cloud SQL
for PostgreSQL 15 instance. On first deploy, an initialization Job creates the
application database and role; Planka then runs its own Knex migrations and
seed on every boot via the official image's `start.sh`.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

A `storage` bucket is provisioned automatically for item attachments, avatars,
and backgrounds, and is mounted via GCS FUSE at `/app/data`, Planka's uploads base path (attachments, avatars, background images and favicons all live under it), with `uid=1000`/`gid=1000` so the app's non-root user can write.

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
  ```

### D. Secret Manager

Two application secrets — `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` — plus the
database password are stored here.

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~planka"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

Planka builds all absolute URLs (attachment links, email notifications, and
the optional OIDC redirect URI if SSO is configured) from `BASE_URL`, which the
cloud entrypoint derives from the service URL.

- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Planka Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`
  using `postgres:15-alpine`, idempotently creating the application role and
  database (no `CREATEROLE`/`CREATEDB` needed — Planka's own roles are
  app-level RBAC rows, not Postgres roles).
- **Schema migrations and seed on every boot.** The official image's own
  `start.sh` runs `node db/init.js` (migrations + seed) before starting the
  server — idempotent, so no separate migration job runs at the platform
  layer.
- **Real admin bootstrap credential — no forced reset.** Planka seeds
  `admin@example.com` with the generated `DEFAULT_ADMIN_PASSWORD` on first
  (empty-database) boot. Unlike apps that force a password reset on first
  login, Planka does not — log in and change the password via Planka's own
  UI promptly after deploy.
- **`DATABASE_URL` composed by the cloud entrypoint.** Because the database
  password is only available as a runtime Secret Manager value, the cloud
  entrypoint builds `DATABASE_URL` at container startup rather than at plan
  time, branching on the resolved `DB_HOST` (socket directory → private IP;
  loopback → plain TCP; private IP → encrypted, no cert verification). See
  [Planka_Common](Planka_Common.md) for the full detail.
- **Health path.** Startup and liveness probes are configured via the
  `startup_probe`/`liveness_probe` variables. Planka's own `server/healthcheck.js`
  targets the **root path `/`** with no auth, and this module's
  `startup_probe`/`liveness_probe` variables now correctly default to
  `path = "/"` to match.
- **Inspect job execution:**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Planka are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `planka` | Base name for resources. |
| `application_version` | `latest` | Used as the `PLANKA_VERSION` build ARG for the thin custom image. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Planka needs the cloud-entrypoint wrapper — keep `custom`. |
| `container_port` | `1337` | Planka's native default port — a single port serves the API and frontend. |
| `cpu_always_allocated` | `false` | Request-based billing. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Scale-to-zero default. |
| `memory_limit` | `4Gi` | Planka requires at least 2Gi for reliable operation. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage` bucket | Created and auto-mounted at `/app/data`. |
| `gcs_volumes` | `[]` | Not needed for uploads — the module already mounts its bucket at `/app/data`. |
| `enable_nfs` | `false` | Not needed — Planka has no POSIX filesystem requirement. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Knex supports no other engine. |
| `db_name` / `db_user` | `planka` / `planka` | PostgreSQL database name and application username. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/`, 60s delay | Fixed to Planka's real, unauthenticated health target (per `server/healthcheck.js`), which plainly GETs `/` with no path and checks for HTTP 200. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, 60s delay | Foundation-level defaults; superseded by `startup_probe`/`liveness_probe` above whenever `application_config` supplies one (it always does here) — effectively inert. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Planka has no cache/queue dependency. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` | Cloud Run service name and default `run.app` URL. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `storage` bucket for attachments. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `custom` (default) | High | `"prebuilt"` deploys the official image directly, skipping the cloud entrypoint — Planka boots with no `DATABASE_URL` and cannot reach the database. |
| `DEFAULT_ADMIN_PASSWORD` (generated secret) | Log in and change it immediately after first deploy | **Critical** | Unlike apps with a forced password-reset prompt, Planka does not force a reset — anyone who obtains the seeded password (e.g. via Secret Manager access) can log in as admin indefinitely until it's changed. |
| `DATABASE_URL` / SSL config | Never hand-edit — controlled by the cloud entrypoint via `PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` env vars, NOT a `?sslmode=` query param | **Critical** | Planka has two independent DB connection paths with different SSL mechanisms, confirmed by tracing the actual dependency chain (not just Planka's `.env.sample`): (1) the migration CLI (`server/db/knexfile.js`) reads `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`; (2) the running server's Sails ORM (`sails-postgresql` → `machinepack-postgresql`) parses `DATABASE_URL` with Node's legacy `url.parse()`, which silently **drops every query parameter** including `?sslmode=` — so a URL-embedded sslmode does nothing for the runtime path. With no explicit `ssl` config, raw `pg` falls back to the `PGSSLMODE` *environment variable*, where `require` means "encrypt AND verify" (not "encrypt only" like classic libpq) — only `PGSSLMODE=no-verify` skips certificate verification. Cloud SQL's self-signed cert isn't in Node's CA bundle, so anything but `no-verify` fails at boot with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and the Sails `orm` hook never loads (confirmed live: two earlier attempts using `?sslmode=no-verify` in the URL and `PGSSLMODE=require` both failed this way before the correct `PGSSLMODE=no-verify` env var was identified). |
| `gcs_volumes` at `/app/data` | Leave empty | Medium | The module already mounts its `storage` bucket at `/app/data`; a second mount at the same path conflicts. Without that mount, uploads would live on Cloud Run's ephemeral filesystem and not survive a revision restart — board/card/list text data is unaffected. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Planka-specific application configuration
shared with the GKE variant is described in
**[Planka_Common](Planka_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Planka on Cloud Run](../labs/Planka_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Planka on GKE Autopilot](Planka_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Planka Common — Shared Application Configuration](Planka_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Plane on Google Cloud Run](Plane_CloudRun.md), [Vikunja on Google Cloud Run](Vikunja_CloudRun.md), [Kimai on Google Cloud Run](Kimai_CloudRun.md) in the **Project & Task Delivery** solution.
