---
title: "Ghostfolio on GKE Autopilot"
description: "Configuration reference for deploying Ghostfolio on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Ghostfolio on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghostfolio_GKE.png" alt="Ghostfolio on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghostfolio is an open-source, AGPL-licensed wealth management application for
tracking net worth, investment portfolios, and asset allocation across multiple
brokerage accounts and platforms — a privacy-first alternative to commercial
portfolio trackers. This module deploys Ghostfolio on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Ghostfolio uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Ghostfolio costs on RAD, and how that compares

**Running Ghostfolio in your own Google Cloud project costs about US$106.53/month in Google Cloud charges, on top of a one-time 110-credit RAD module fee** (99 credits — 10% lower — in a RAD-managed project). Ghostfolio is an open-source wealth management application for tracking net worth, investment portfolios, and asset allocation across multiple accounts and platforms. If you deploy into a RAD-managed project, you can pause the whole thing for free and pick it back up later — see "Pause it for free" below.

*Ghostfolio is also available on Cloud Run — see the [Cloud Run guide](Ghostfolio_CloudRun.md) for the lower-cost option; this guide covers the GKE variant.*

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee | **110 credits** (one-time) | **99 credits** (one-time, 10% lower) |
| Build time | ~3–6 credits (one-time, per build) | ~3–6 credits (one-time, per build) |
| Google Cloud running cost | ~US$106.53/month, billed to your own Google billing account at list price | ~92 credits/day (~US$9.20/day), metered hourly at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 1x vCPU / 1 GiB | US$36.08 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **US$106.53** |

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
against its own running cost: roughly **about 4 days or more** idle in your own project (against its
~US$106.53/month Google Cloud bill), or **about 2 days or more** idle in a RAD-managed project
(against its ~92 credits/day).

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

Ghostfolio runs as a NestJS (Prisma ORM) web workload. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | NestJS API + Angular frontend, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Ghostfolio's Prisma ORM does not support MySQL |
| Cache & queue | Redis (**required**, not optional) | Market-data caching, sessions, and Bull queue/job management |
| Secrets | Secret Manager | Auto-generated `ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY`; database password |
| Ingress | Cloud Load Balancing | External `LoadBalancer` Service by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Ghostfolio's Prisma ORM does not support other engines.
- **Redis is mandatory, not optional.** Ghostfolio's own health endpoint checks
  Redis connectivity directly, so the app never reports healthy without it.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are generated automatically** and
  stored in Secret Manager. Both are boot-blocking. Rotating `ACCESS_TOKEN_SALT`
  after first boot invalidates every previously issued anonymous Security Token.
- **No seeded admin account.** The first visitor to the deployed URL clicks
  "Get Started" and the app mints a random Security Token as the account owner —
  there is no email/password form or first-run wizard to complete.
- **`service_type = "LoadBalancer"` by default.** Ghostfolio is a browser-facing
  web UI, so unlike internal-only apps (databases, admin tools) it needs a
  publicly reachable Service.
- **No bulk file/media storage is provisioned.** `enable_nfs` defaults `false` and
  `storage_buckets` is always empty.
- **`DATABASE_URL` is composed at runtime.** Ghostfolio's Prisma connection string
  is a URL-authority DSN; on GKE the cloud entrypoint uses the cloud-sql-proxy
  sidecar's `127.0.0.1` loopback with `sslmode=disable` when
  `enable_cloudsql_volume = true` (the default).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. Resource names are reported
in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Ghostfolio workload

Ghostfolio runs as a Kubernetes Deployment behind a Service. Autopilot manages node
provisioning and bin-packing automatically.

- **Console:** Kubernetes Engine → Workloads → select the Deployment.
- **CLI:**
  ```bash
  kubectl get deployment -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE" -o wide
  kubectl describe deployment <deployment-name> -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app=<app-label> --tail=100
  ```

See [App_GKE](App_GKE.md) for scaling, rollout strategy, and pod disruption
budgets.

### B. Cloud SQL for PostgreSQL 15

Ghostfolio stores all application data in a managed Cloud SQL for PostgreSQL 15
instance, reached via a cloud-sql-proxy sidecar listening on `127.0.0.1`. On first
deploy an initialization Job creates the application database and role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Redis (required)

Redis backs market-data caching, sessions, and Bull queue/job management.

- **CLI:**
  ```bash
  kubectl exec -it -n "$NAMESPACE" <pod-name> -- sh -c 'echo -e "PING\r" | nc $REDIS_HOST $REDIS_PORT'
  # Confirm the pod's injected Redis env vars:
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep REDIS
  ```

### D. Secret Manager

Two cryptographic secrets are generated automatically: `ACCESS_TOKEN_SALT` and
`JWT_SECRET_KEY`. The database password is managed separately by the foundation and
synced into the cluster via `SecretSync`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

The default `LoadBalancer` Service exposes an external IP. A Kubernetes Ingress
with a custom domain and managed certificate can be layered on via
`enable_custom_domain`.

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl get ingress -n "$NAMESPACE"
  ```

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging automatically via the GKE logging agent;
metrics flow to Cloud Monitoring.

- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" resource.labels.namespace_name="'"$NAMESPACE"'"' --project "$PROJECT" --limit 50
  ```

---

## 3. Ghostfolio Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`, idempotently creating the application role, database, and
  grants.
- **Migrations and seeding run on EVERY container boot**, inside the same process
  as the server. The upstream `docker/entrypoint.sh` runs `prisma migrate deploy`,
  then `prisma db seed`, then starts the server — a failed migration crashes the
  container loudly instead of shipping a healthy pod against an empty database.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are immutable after first boot.**
  Rotating `ACCESS_TOKEN_SALT` invalidates every previously issued Security Token.
  Rotating `JWT_SECRET_KEY` logs everyone out.
- **No first-run form to fill in.** The first visitor mints their own Security
  Token via "Get Started" — no admin bootstrap step is required.
- **Health path.** Startup and liveness probes target `GET /api/v1/health`, which
  checks BOTH the database AND Redis connections and returns `503` until both are
  healthy.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Ghostfolio are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Docker Hub's `ghostfolio/ghostfolio` publishes a real `latest` tag — pin for reproducible builds. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | 1 vCPU / 1 GiB is sufficient for typical usage. |
| `container_port` | `3333` | Ghostfolio's `DEFAULT_PORT`. |
| `enable_cloudsql_volume` | `true` | Runs the cloud-sql-proxy sidecar; `DB_IP` resolves to `127.0.0.1` and the cloud entrypoint uses `sslmode=disable`. |
| `container_image_source` | `custom` | Cloud Build wraps the prebuilt `ghostfolio/ghostfolio` image with a thin cloud entrypoint. |

### Group 6 — Kubernetes Placement & Networking

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Ghostfolio is a browser-facing web UI — do not switch to `ClusterIP` without a separate ingress path. |
| `namespace_name` | (auto-generated) | Kubernetes namespace. |

### Group 15 — Database

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `ghostfolio` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `ghostfolio` | Application database user. Password auto-generated in Secret Manager. |

### Group 13 — Jobs & NFS

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. No separate migrate job — migrations run inside the app container on every boot. |
| `enable_nfs` | `false` | Not required — Ghostfolio has no bulk file/media storage. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/v1/health`, 30s delay, 12-failure threshold | Checks BOTH database AND Redis connectivity. |
| `health_check_config` | HTTP `/api/v1/health`, 30s delay, 3-failure threshold | Same endpoint as the startup probe. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | REQUIRED — always forward unconditionally, never gate on `redis_host != ""`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP. |
| `redis_auth` | `""` | Redis auth password (sensitive). Aliased at runtime onto Ghostfolio's own `REDIS_PASSWORD` env var. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `service_url` | URL of the deployed application (LoadBalancer IP, custom domain, or internal DNS). |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `storage_buckets` | Always empty — Ghostfolio needs no bulk file/media storage. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every previously issued Security Token. |
| `JWT_SECRET_KEY` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_redis` | `true`, always forwarded unconditionally | Critical | Without it, Ghostfolio's health endpoint never reports healthy. |
| `service_type` | `LoadBalancer` | High | Switching to `ClusterIP` without a separate ingress path makes the app unreachable from outside the cluster. |
| `enable_cloudsql_volume` | `true` | High | Disabling it removes the proxy sidecar, so `DB_IP` falls back to the raw private IP and the cloud entrypoint's `sslmode` branching no longer matches a loopback connection. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |

---

For the foundation behaviour referenced throughout — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Ghostfolio-specific application
configuration shared with the Cloud Run variant is described in
**[Ghostfolio_Common](Ghostfolio_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Ghostfolio on GKE Autopilot](../labs/Ghostfolio_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Ghostfolio on Google Cloud Run](Ghostfolio_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Ghostfolio Common — Shared Application Configuration](Ghostfolio_Common.md) — the configuration shared by both deployment targets.
