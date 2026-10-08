---
title: "SparkyFitness on Google Cloud Run"
description: "Configuration reference for deploying SparkyFitness on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# SparkyFitness on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SparkyFitness_CloudRun.png" alt="SparkyFitness on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SparkyFitness is a self-hosted, AI-assisted family food, fitness, water, and health
tracker built as a Node.js/Express backend (`codewithcj/sparkyfitness_server`) with a
separate React frontend served by nginx (`codewithcj/sparkyfitness`). This module
deploys SparkyFitness on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services SparkyFitness uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What SparkyFitness costs on RAD, and how that compares

**Running SparkyFitness in your own GCP project costs about $82.03/month in Google Cloud charges; RAD's module fee is a one-time 75 credits (or 67.5 credits in a RAD-managed project), covering setup and support -- not the ongoing cloud bill, which Google bills you directly in your own project or RAD meters hourly in credits in a RAD-managed one.**
Or see the GKE guide for the alternative deployment target; either way, if you deploy into a RAD-managed project you can pause the whole thing for free when you are not using it -- see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Your own project | RAD-managed project |
|---|---|---|
| Module fee | 75 credits, once | 67.5 credits, once (10% lower) |
| Build time | metered in credits as the build runs (a few credits, typically) | same |
| Google Cloud running cost | ~$82.03/month, billed to your own billing account at Google's list price | ~32 credits/day, metered hourly by RAD at list price plus margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | $11.58 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| NFS/cache file server (small VM) | $13.43 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| **Total** | **$82.03** |

### How it compares

- SparkyFitness's own footprint here (1x vCPU / 1 GiB) is smaller than this reference class, so an even cheaper VPS tier would do just as well, but sized to the smallest commonly-quoted class for comparison: Hetzner CPX22 (2 vCPU/4GB) runs about **$24/month**, a DigitalOcean 2 vCPU/4GB Droplet is also **$24/month**, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about **$49/month** -- plus the admin's own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you -- but RAD's price is never meant to beat a VPS, only to replace the admin time a VPS still needs.
- SparkyFitness is used by a handful of people a few times a day, not a continuously-loaded service, so the running cost below is what actually drives the bill -- not the module fee.

### Pause it for free: delete a RAD-managed project, restore it when you need it

**This is the headline for a RAD-managed project.** Deleting a RAD-managed project first unlinks
its billing, then asks Google to delete the project outright -- Google's own 30-day recoverable
soft delete. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the
compute resource one by one: the whole project simply stops, and nothing is charged while it
waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project
and reattaches its billing account, then asks you to run Update on each deployment to confirm
everything came back. Because nothing was individually destroyed, that Update finds the same
resources already there -- it is a check, not a rebuild, and an Update never charges the module
fee again. This costs only a handful of credits (under US$1) in total for a typical 2-3-deployment
chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days -- after that Google deletes it for good -- and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

**One real gap:** nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete
the project -- even though the project itself is recoverable for 30 days. If you have customised
the app and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the
project) before deleting. For a default install with nothing irreplaceable in it, this does not
matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project (or once you are past the 30-day restore window above), the alternative is to delete SparkyFitness outright and redeploy it later. A redeploy costs the module fee again, plus the builds -- roughly 75 + 3-6 credits of build time.

Deleting saves money only once SparkyFitness would otherwise sit unused long enough to clear that redeploy cost against its own daily running cost -- against the own-project total above, that works out to about 3 days or more. Most of the running cost here is usually the database and the NFS/cache VM; they stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.

**Keep data first:** nightly backups go to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the
  app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
  by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; https://cloud.google.com/resource-manager/docs/delete-restore-projects for the pause/restore mechanics.

## 1. Overview

SparkyFitness runs as **two containers in a single multi-container Cloud Run
service** — a real platform constraint, not a stylistic choice. The upstream frontend
image's nginx config hardcodes a plain `http://` reverse-proxy target
(`proxy_pass http://${SPARKY_FITNESS_SERVER_HOST}:${SPARKY_FITNESS_SERVER_PORT}`),
which cannot reach a *separate* Cloud Run service's HTTPS-only public URL. So:

- The **frontend** (nginx, port 80) is the **main (ingress) container** — it receives
  all public browser traffic and reverse-proxies `/api`, `/uploads`, `/mcp`, and
  `/health-data` requests.
- The **backend** (Node.js, port 3010) runs as an **in-pod `additional_containers`
  sidecar**, reachable by the frontend only at `http://127.0.0.1:3010` — plain loopback
  HTTP, exactly what the vendor nginx config expects.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 (multi-container revision) | Frontend (ingress, ~0.5 vCPU/512Mi) + backend (in-pod sidecar, 1 vCPU/1Gi by default) |
| Database | Cloud SQL for PostgreSQL 15 | Required — no other engine is supported |
| Secrets | Secret Manager | Auto-generated `SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD`; database password |
| Ingress | Cloud Run URL | Default `run.app` URL on the frontend container; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** No other engine is supported.
- **Two database roles, one Terraform-managed.** `db_user` (default `sparky`) is the
  admin/migration role created by the `db-init` job; `app_db_user` (default
  `sparky_app`) is a limited-privilege role the **backend creates and maintains
  itself** at every boot, using `db_user`'s credentials — there is no Terraform
  resource for it.
- **No separate migrate job.** Unlike many apps in this catalogue, SparkyFitness's
  backend runs its own database migrations on every container start.
- **The frontend image is prebuilt** — `container_image_source = "prebuilt"`, so the
  Foundation builds nothing. The **backend sidecar is built by this module itself**
  (`null_resource.build_backend_sidecar` submits a Cloud Build of
  `SparkyFitness_Common/scripts/Dockerfile` and pushes
  `sparkyfitness-backend:<content-hash>` to the discovered Artifact Registry repo),
  because Cloud Run sidecars get no build pipeline from the Foundation.
- **Scale-to-zero by default** (`cpu_always_allocated = false`, `min_instance_count = 0`)
  — a plain request/response app with no background scheduler.
- **Health probes are real, not guessed.** `GET /api/health` on port 3010 is confirmed
  via the backend's own Dockerfile `HEALTHCHECK` directive.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the SparkyFitness service

A single Cloud Run v2 service runs both containers in one revision. The frontend
container is the one that receives ingress traffic and appears in
`status.url`; the backend is only visible via the revision's container spec.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics. Expand the revision to see both containers (`sparkyfitness` /
  frontend and `backend`).
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.containers[].name)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

SparkyFitness stores all application data in a managed Cloud SQL for PostgreSQL 15
instance. The backend sidecar receives the connection details via the
`SPARKY_FITNESS_DB_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` env vars (renamed from
the Foundation's standard `DB_*` names).

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Secret Manager

Three cryptographic secrets are generated automatically:

- **`SPARKY_FITNESS_API_ENCRYPTION_KEY`** — 64-char hex, encrypts stored external
  data-source credentials.
- **`BETTER_AUTH_SECRET`** — signs sessions and encrypts 2FA/TOTP data.
- **`SPARKY_FITNESS_APP_DB_PASSWORD`** — password for the self-healing, limited-privilege
  `app_db_user` role.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

### D. Networking & ingress

The frontend container is reachable at the service's `run.app` URL by default. An
external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be
layered on.

```bash
gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
```

### E. Cloud Logging & Monitoring

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

The backend sidecar's logs appear in the same Cloud Logging stream, tagged with its
container name — filter on `resource.labels.container_name="backend"` to isolate them.

---

## 3. SparkyFitness Application Behaviour

- **First-deploy database setup.** A single `db-init` initialization Job (using
  `postgres:15-alpine`) creates the **admin** role (`db_user`) and database
  (`db_name`). It does not create `app_db_user` — the backend does that itself.
- **Migrations run on every boot.** The backend applies its own schema migrations at
  startup using the admin `db_user` credentials — there is no separate migrate job to
  monitor.
- **`app_db_user` is self-healing.** The backend creates or updates this
  limited-privilege role at every start, so it survives a full container recreation
  with no manual intervention.
- **First-run account creation.** Sign up via the web UI to create the first user
  account. Set `admin_email` to that user's email and redeploy to grant admin
  privileges — `SPARKY_FITNESS_ADMIN_EMAIL` only elevates an **existing** account, it
  does not create one.
- **Disable signup after first use.** Set `disable_signup = true` once the admin
  account exists, to prevent unauthenticated users from self-registering.
- **Health path.** `GET /api/health` on port 3010 (backend) — confirmed via the
  upstream Dockerfile's own `HEALTHCHECK` directive, not guessed.
- **Immutable secrets.** `BETTER_AUTH_SECRET` must never change after users enable
  2FA (it locks them out); `SPARKY_FITNESS_API_ENCRYPTION_KEY` must never change
  after external data sources are connected (it invalidates the encrypted
  credentials).
- **Cloud SQL TLS.** The backend sidecar's `SPARKY_FITNESS_DB_HOST` always resolves
  to the raw Cloud SQL private IP on Cloud Run (this Foundation's
  `additional_containers`/`inherit_app_env` mechanism always uses the raw IP,
  regardless of `enable_cloudsql_volume`), and Cloud SQL rejects that connection
  unencrypted. Upstream's `pg` pools set no `ssl` option and the app has no env-var
  toggle, so the backend image is a thin custom build that patches all three
  `pg.Pool` constructors to enable SSL for any non-loopback host (see
  [SparkyFitness_Common](SparkyFitness_Common.md) §4).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for SparkyFitness are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `sparkyfitness` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Tags BOTH the frontend and backend images identically. Use `latest` or a `v`-prefixed tag exactly as published upstream (e.g. `v0.17.3` — a bare `0.17.3` does not exist). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Resource limits for the **backend sidecar**. |
| `min_instance_count` / `max_instance_count` | `0` / `2` | Instance scaling bounds. |
| `container_port` | `3010` | Backend's listening port inside its sidecar. |
| `cpu_always_allocated` | `false` | Request-based billing — no background work needed at steady state. |
| `enable_cloudsql_volume` | `true` | See the Cloud SQL TLS note in §3 — the backend sidecar always gets the raw private IP regardless of this flag on Cloud Run. |

### Group 5 — SparkyFitness Application Config

| Variable | Default | Description |
|---|---|---|
| `app_db_user` | `sparky_app` | Limited-privilege runtime role name, self-created by the backend. |
| `disable_signup` | `false` | Disable new self-registration. |
| `admin_email` | `""` | Grants admin to an EXISTING user on startup; does not create the account. |
| `public_api_docs` | `false` | Expose Swagger docs publicly. |
| `allow_private_network_cors` | `false` | Only enable on a private network. |
| `log_level` | `ERROR` | Backend log verbosity. |
| `timezone` | `Etc/UTC` | Backend TZ. |

### Group 7 — SMTP (optional)

| Variable | Default | Description |
|---|---|---|
| `smtp_enabled` | `false` | Enable password-reset/notification email. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_from` / `smtp_secure` | see `variables.tf` | Set all fields together when enabling SMTP; supply the password via `secret_environment_variables` (`SPARKY_FITNESS_EMAIL_PASS`). |

### Group 13 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — no other engine supported. |
| `db_name` | `sparkyfitness_db` | Database name. Immutable after first deploy. |
| `db_user` | `sparky` | Admin/migration role — the backend runs its own migrations with this role. |

### Group 15 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (admin role + database only). |

### Group 16 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/health`, port 3010 | Targets the **backend**; the frontend main container gets its own plain TCP probe (hardcoded in the wiring file, not user-configurable). |

### Group 17 — Redis (not used natively)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | SparkyFitness does not use Redis; left available as a generic Foundation capability. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `app_url` | URL of the application (frontend/ingress container) — open this in a browser. |
| `backend_url` | Internal loopback address of the backend sidecar (`http://127.0.0.1:3010`). |
| `database_instance_name` / `database_name` / `database_user` | Cloud SQL identifiers. |
| `database_password_secret` | Secret Manager secret holding the admin DB password. |
| `storage_buckets` | Created Cloud Storage buckets (none by default). |
| `container_image` | Deployed frontend image. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `BETTER_AUTH_SECRET` (auto-generated) | Never rotate after users enable 2FA | Critical | Rotating it locks out every user with 2FA enabled. |
| `SPARKY_FITNESS_API_ENCRYPTION_KEY` (auto-generated) | Never rotate after first connection | Critical | Rotating it invalidates all stored external-data-source credentials. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; changing recreates the DB and destroys all data. |
| `application_version` | Use upstream's exact tag (`v0.17.3`) | High | A bare `0.17.3` (no `v` prefix) does not exist upstream — pull fails. |
| `admin_email` | Set only after the account exists | Medium | Setting it before signup has no effect — it elevates an existing account, never creates one. |
| `enable_cloudsql_volume` | leave at `true` | High | The Cloud Run backend sidecar always receives the raw Cloud SQL private IP (not the socket) regardless of this flag; the SSL-patched backend image is what makes that connection work. |
| `disable_signup` | `true` after first admin | Medium | Leaving signup open lets anyone with the URL create an account. |
| `smtp_enabled` | Set ALL smtp_* fields together | Medium | A partially-configured SMTP block can leave password-reset email non-functional. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. SparkyFitness-specific application configuration
shared with the GKE variant is described in
**[SparkyFitness_Common](SparkyFitness_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: SparkyFitness on Cloud Run](../labs/SparkyFitness_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [SparkyFitness on GKE Autopilot](SparkyFitness_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [SparkyFitness Common — Shared Application Configuration](SparkyFitness_Common.md) — the configuration shared by both deployment targets.
