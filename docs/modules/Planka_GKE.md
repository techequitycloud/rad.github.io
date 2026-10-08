---
title: "Planka on GKE Autopilot"
description: "Configuration reference for deploying Planka on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Planka on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Planka_GKE.png" alt="Planka on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Planka is an open-source, self-hosted, Trello-like kanban board application
with a Node.js (Sails.js) backend and a React frontend, used for team and
personal project management — boards, lists, cards, due dates, labels, and
file attachments. This module deploys Planka on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Planka uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Planka costs on RAD, and how that compares

**Running Planka in your own Google Cloud project costs about US$136.37/month in infrastructure, plus a one-time module fee of 110 RAD credits** (sized at 2 vCPU / 4 GiB on GKE Autopilot pods). RAD charges the module fee once, at deploy time — never again on Update — plus build time metered in credits; Google Cloud usage itself is billed to your own billing account at Google's list price. On a **RAD-managed** project the same resources are metered hourly in credits at list price plus RAD's margin — about 105 credits/day — and the module fee is 10% lower, at 99 credits. See "Pause it for free" below for how a RAD-managed Planka deployment can be stopped, at no running cost, until you need it again. (or see the [Cloud Run guide](Planka_CloudRun.md) for the lower-cost option)

### What you pay on RAD

| Item | Own project | RAD-managed project |
|---|---|---|
| Module fee | 110 credits (once) | 99 credits (once) |
| Build time | ~3-6 credits, metered per build minute | same, metered in credits at list price + RAD's margin |
| Google Cloud running cost | ~$136.37/month, billed to your own billing account at Google's list price | ~105 credits/day, metered hourly at list price + RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | 79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | 51.02 |
| Cloud NAT and networking | 5 |
| Cloud Storage (add-ons, backups) | 1 |
| GKE cluster management fee\* | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **$136.37** |

\* Not included in the total above — it is shared across every GKE app running in the same project, so it is $0 if this is your only GKE cluster.

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
plus the builds — roughly **113-116 credits** in total for this module.

Deleting only saves money once Planka would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — for this module, that is about 3 days or more of being idle,
based on its own US$136.37/month running cost above. Most of that running cost is
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

Planka runs as a single Node.js web workload, serving both its API and its
React frontend from one port. The deployment wires together a small, focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Planka's Knex query builder supports no other engine |
| Object storage | Cloud Storage | A `storage` bucket is created and mounted at `/app/data` for attachments, avatars and backgrounds |
| Cache & queue | none | Planka has no Redis or queue dependency — real-time updates ride Socket.io in-process |
| Secrets | Secret Manager | `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` — both real, functional secrets — plus the database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, reserved static IP, optional custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the only supported engine.** `Planka_Common` fixes
  `database_type = "POSTGRES_15"`.
- **A thin custom build, not the prebuilt image.** Planka needs a cloud
  entrypoint to compose `DATABASE_URL` and derive `BASE_URL`, so
  `container_image_source = "custom"` builds `FROM
  ghcr.io/plankanban/planka:<version>` via Cloud Build.
- **`DATABASE_URL` is a URL-authority connection string, but SSL is set via
  separate env vars — never a `?sslmode=` query parameter.** Planka has two
  independent DB connection paths (the migration CLI and the running server's
  Sails ORM), each needing SSL configured a different way, and each ignoring
  a URL-embedded `?sslmode=` for its own, unrelated reason. On GKE, the Cloud
  SQL Auth Proxy sidecar listens on `127.0.0.1` and terminates TLS itself, so
  the entrypoint sets **neither** `PGSSLMODE` nor
  `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` for that loopback connection — no
  SSL config is needed at all. See the [Common guide](Planka_Common.md) for
  the full two-path explanation and the private-IP TCP branch.
- **Two real, functional application secrets.** `SECRET_KEY` (session/token
  signing, required at boot) and `DEFAULT_ADMIN_PASSWORD` (seeds the initial
  admin account on first, empty-database boot) are both genuinely consumed by
  Planka. There is **no forced password-reset prompt**, so change the seeded
  password immediately after first deploy.
- **`workload_type` defaults to `Deployment`, not `StatefulSet`.** Planka
  keeps no local state beyond what's already in Cloud SQL.
- **`reserve_static_ip = true`** (overriding the App_GKE default of
  `false`). The cloud entrypoint derives `BASE_URL` from the injected
  `GKE_SERVICE_URL`; without a reserved static IP, `BASE_URL` can fall back
  to unreachable internal `*.svc.cluster.local` DNS, breaking attachment
  links and email notifications.
- **Attachments persist by default.** The module mounts the `storage` GCS
  bucket at Planka's `/app/data` path, which holds every upload type. If you
  enable a block PVC instead (`stateful_pvc_enabled = true`), the bucket mount
  is dropped so the two never collide.
- **No Redis, no NFS.** `enable_redis` and `enable_nfs` both default to
  `false` — Planka needs neither a cache/queue backend nor POSIX filesystem
  sharing.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Planka workload

- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|BASE_URL'
  ```

### B. Cloud SQL for PostgreSQL 15

Pods reach the database privately through the **cloud-sql-proxy** sidecar over
`127.0.0.1`. On first deploy an initialization Job creates the application
database and role; Planka then runs its own migrations and seed on every pod
start.

- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~planka"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP with a reserved static address. Planka's `BASE_URL` (used for attachment
links and email notifications) is derived from this address — update
`BASE_URL` explicitly if a custom domain is layered on afterward.

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Planka Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`,
  idempotently creating the application role and database (no
  `CREATEROLE`/`CREATEDB` needed).
- **Schema migrations and seed on every boot.** The official image's own
  `start.sh` runs `node db/init.js` (migrations + seed) before starting the
  server.
- **Real admin bootstrap credential — no forced reset.** Planka seeds
  `admin@example.com` with the generated `DEFAULT_ADMIN_PASSWORD` on first
  (empty-database) boot, with no forced password-reset prompt — log in and
  change the password via Planka's own UI promptly after deploy.
- **`DATABASE_URL` composed by the cloud entrypoint.** Built at container
  startup from the Foundation-injected `DB_*` values (the password is a
  runtime Secret Manager value, unavailable at plan time). See
  [Planka_Common](Planka_Common.md) for the full detail.
- **Health path.** Startup and liveness probes are configured via the
  `startup_probe`/`liveness_probe` variables. Planka's own
  `server/healthcheck.js` targets the **root path `/`** with no auth, and
  this module's `startup_probe`/`liveness_probe` variables now correctly
  default to `path = "/"` to match.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Planka are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `planka` | Base name for resources. |
| `application_version` | `latest` | Used as the `PLANKA_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Planka needs the cloud-entrypoint wrapper — keep `custom`. |
| `container_port` | `1337` | Planka's native default port; container port and probes must match. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | HPA scaling bounds. |
| `container_resources.memory_limit` | `4Gi` | Planka requires at least 2Gi for reliable operation. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `workload_type` | `null` (→ `Deployment`) | Planka is stateless at the pod level. |
| `service_type` | `LoadBalancer` | Public-facing kanban app — a `ClusterIP` override has no reason here. |
| `session_affinity` | `ClientIP` | Sticky routing so a client stays on one pod. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage` bucket | Created and auto-mounted at `/app/data` (unless a block PVC is enabled). |
| `gcs_volumes` | `[]` | Not needed for uploads — the module already mounts its bucket at `/app/data`. |

### Group 16 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Knex supports no other engine. |
| `application_database_name` / `application_database_user` | `planka` / `planka` | PostgreSQL database name and application username. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/`, 60s delay | The probes actually applied to the deployed pod, now matching Planka's real, unauthenticated health target (`server/healthcheck.js`). |
| `startup_probe_config` / `health_check_config` | HTTP `/`, 60s delay | Foundation-level defaults; superseded by `startup_probe`/`liveness_probe` above — effectively inert. |

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not needed — Planka has no POSIX filesystem requirement. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Planka has no cache/queue dependency. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions an Ingress + managed certificate. |
| `reserve_static_ip` | `true` | Overrides the App_GKE default (`false`) so `BASE_URL` resolves to a real, reachable address — see §1. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `storage` bucket for attachments. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all data. |
| `container_image_source` | `custom` (default) | High | `"prebuilt"` deploys the official image directly, skipping the cloud entrypoint — Planka boots with no `DATABASE_URL`. |
| `startup_probe` / `liveness_probe` path | `/` (the module default) | **High** | Matches Planka's real, unauthenticated health target (per `server/healthcheck.js`, a plain HTTP GET to `/` checking for 200). If overridden to another path, the pod can fail to become Ready. |
| `reserve_static_ip` | `true` (already the module default) | High | `false` can leave `BASE_URL` pointed at unreachable internal `*.svc.cluster.local` DNS, breaking attachment links and email notifications. |
| `DEFAULT_ADMIN_PASSWORD` (generated secret) | Log in and change it immediately after first deploy | **Critical** | Planka does not force a password reset — anyone who obtains the seeded password can log in as admin indefinitely until it's changed. |
| `DATABASE_URL` / SSL config | Never hand-edit — controlled by the cloud entrypoint via `PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` env vars, NOT a `?sslmode=` query param | **Critical** | Planka has two independent DB connection paths with different SSL mechanisms, confirmed by tracing the actual dependency chain: (1) the migration CLI (`server/db/knexfile.js`) reads `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`; (2) the running server's Sails ORM (`sails-postgresql` → `machinepack-postgresql`) parses `DATABASE_URL` with Node's legacy `url.parse()`, which silently **drops every query parameter** including `?sslmode=` — so a URL-embedded sslmode does nothing for the runtime path. With no explicit `ssl` config, raw `pg` falls back to the `PGSSLMODE` *environment variable*, where `require` means "encrypt AND verify" (not "encrypt only" like classic libpq) — only `PGSSLMODE=no-verify` skips certificate verification. Cloud SQL's self-signed cert isn't in Node's CA bundle, so anything but `no-verify` fails at boot with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and the Sails `orm` hook never loads. The GKE loopback connection (Cloud SQL Auth Proxy sidecar) needs neither var set — the proxy already terminates TLS. |
| `gcs_volumes` at `/app/data` | Leave empty | Medium | The module already mounts its `storage` bucket at `/app/data`; a second mount at the same path conflicts. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Planka-specific application configuration shared
with the Cloud Run variant is described in
**[Planka_Common](Planka_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Planka on GKE Autopilot](../labs/Planka_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Planka on Google Cloud Run](Planka_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Planka Common — Shared Application Configuration](Planka_Common.md) — the configuration shared by both deployment targets.
