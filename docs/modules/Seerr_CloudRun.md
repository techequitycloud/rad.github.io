---
title: "Seerr on Google Cloud Run"
description: "Configuration reference for deploying Seerr on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Seerr on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Seerr_CloudRun.png" alt="Seerr on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Seerr is the 2026 merger of **Jellyseerr** and **Overseerr** — an
open-source, MIT-licensed request UI that sits in front of a Jellyfin, Plex,
or Emby media server. Users browse and request titles; an admin approves the
request, and Seerr calls Sonarr's and Radarr's APIs to trigger acquisition.
This module deploys Seerr on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Seerr uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Seerr costs on RAD, and how that compares

**Running Seerr in your own GCP project costs about $180.87/month in Google Cloud charges; RAD's module fee is a one-time 110 credits (or 99 credits in a RAD-managed project), covering setup and support -- not the ongoing cloud bill, which Google bills you directly in your own project or RAD meters hourly in credits in a RAD-managed one.**
If a lower running cost matters more than the deployment target, see the GKE guide for the lower-cost option; otherwise, if you deploy into a RAD-managed project you can pause the whole thing for free when you are not using it -- see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Your own project | RAD-managed project |
|---|---|---|
| Module fee | 110 credits, once | 99 credits, once (10% lower) |
| Build time | metered in credits as the build runs (a few credits, typically) | same |
| Google Cloud running cost | ~$180.87/month, billed to your own billing account at Google's list price | ~83 credits/day, metered hourly by RAD at list price plus margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | $110.42 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| NFS/cache file server (small VM) | $13.43 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| **Total** | **$180.87** |

### How it compares

- Running it yourself on a bare VPS is still the cheapest cash option -- Hetzner CPX22 (2 vCPU/4GB) runs about **$24/month**, a DigitalOcean 2 vCPU/4GB Droplet is also **$24/month**, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about **$49/month** -- plus the admin's own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you -- but RAD's price is never meant to beat a VPS, only to replace the admin time a VPS still needs.
- Seerr sits in front of a household media server rather than the public internet, so it runs continuously but at low traffic -- note this module needs `alwaysOn` compute to keep request-triggered acquisition responsive, which is why its own running cost is higher than most apps in this batch.

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

In your own project (or once you are past the 30-day restore window above), the alternative is to delete Seerr outright and redeploy it later. A redeploy costs the module fee again, plus the builds -- roughly 110 + 3-6 credits of build time.

Deleting saves money only once Seerr would otherwise sit unused long enough to clear that redeploy cost against its own daily running cost -- against the own-project total above, that works out to about 2 days or more. Most of the running cost here is usually the database and the NFS/cache VM; they stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.

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

Seerr runs as a single Node.js/Next.js container on Cloud Run v2. The
deployment wires together a small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Node.js process, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL PostgreSQL 15 | Holds request/user data; migrations run automatically on every boot |
| Object storage | Cloud Storage | A `storage` bucket mounted at `/app/config` via GCS FUSE — holds `settings.json`, Seerr's own app settings |
| Cache & queue | none | Seerr has no Redis or queue dependency |
| Secrets | Secret Manager | Only the generated database password — Seerr seeds no credentials of its own (its first admin comes from the app's own web setup wizard) |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Genuinely prebuilt — no custom image.** `Seerr_Common`'s `scripts/`
  directory is empty. `container_image_source = "prebuilt"` deploys
  `ghcr.io/seerr-team/seerr` directly; there is no Cloud Build step for the
  main image.
- **`DB_TYPE=postgres` is set unconditionally.** Seerr's own datasource logic
  (`process.env.DB_TYPE === 'postgres'`, confirmed via `/app/dist/datasource.js`
  in the actual image) falls back to an in-container SQLite file — wiped on
  every restart, with no error — if this variable is ever missing. `Seerr_Common`
  sets it as a static environment variable so a stock deployment is always correct.
- **Port 5055, health path `/api/v1/status`.** Confirmed via local `docker run`
  testing and a live deployment: `GET /api/v1/status` returns an unauthenticated
  `200` with JSON (`{"version":...,"commitTag":...}`) once the app is ready.
- **Two distinct pieces of state.** PostgreSQL holds request/user data. Seerr's
  own app settings (connected media servers, discovery sliders, notification
  agents) are written to a plain `settings.json` file under `/app/config`
  **regardless of the database backend** — confirmed by direct container
  filesystem inspection. This module mounts a persistent GCS volume at that
  path in addition to the Postgres connection.
- **`DB_PASS`, not `DB_PASSWORD`.** Seerr's TypeORM datasource reads a
  specifically-named `DB_PASS` environment variable for the database password.
  This module sets `db_password_env_var_name = "DB_PASS"` to match.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource
names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Seerr service

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, and traffic
splitting.

### B. Cloud SQL — request/user data

- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  ```

### C. Cloud Storage — the settings volume

The `storage` bucket is mounted at `/app/config` via GCS FUSE. It holds
`settings.json` (and `settings.old.json`, a `db/` directory, and `logs/`) —
Seerr's own application-level configuration, separate from anything stored in
PostgreSQL.

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~seerr"
  gcloud storage ls "gs://<bucket-name>/"
  ```

### D. Secret Manager

Only the auto-generated database password lives here — Seerr has no
admin-credential secret of its own.

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~seerr"
  ```

### E. Networking & ingress

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

## 3. Seerr Application Behaviour

- **No first-deploy database-schema job.** Seerr's `dist/index.js` calls
  `dbConnection.runMigrations()` explicitly on every boot, so there is no
  `db-init`/migrate job in this module and none is needed. `initialization_jobs`
  is empty by default.
- **First-run setup is entirely in the app's own web UI.** There is no seeded
  admin credential of any kind — visit the service URL after first deploy and
  complete Seerr's setup wizard: connect Jellyfin/Plex/Emby, then Sonarr/Radarr.
- **Health path.** Startup and liveness probes both target `GET /api/v1/status`
  — an unauthenticated `200` with JSON payload once the app has finished
  booting and connecting to Postgres.
- **Inspect job execution (should show nothing, by design):**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### ⚠ The DB_TYPE trap — the most important thing to know about this module

Seerr's datasource selection is a single, easy-to-miss environment variable
check, confirmed by reading `/app/dist/datasource.js` inside the actual
running image:

```js
exports.isPgsql = process.env.DB_TYPE === 'postgres';
```

If `DB_TYPE` is not set to exactly `postgres`, Seerr **silently** falls back
to an in-container SQLite database file — no error, no warning in the logs,
and a deployment that otherwise looks completely healthy (the container
boots, the health check passes, the UI loads). Every write — including the
entire first-run setup — goes to a file wiped clean on the next restart or
cold start.

`Seerr_Common` closes this gap with a static environment variable set
unconditionally ahead of any caller-supplied `environment_variables`:

```hcl
environment_variables = merge(
  { DB_TYPE = "postgres" },
  var.environment_variables
)
```

A stock deployment of this module is correct out of the box. The risk
surfaces only if you fork the Common module or replace `environment_variables`
wholesale instead of layering additions on top — verify `DB_TYPE=postgres`
survives any such change with:

```bash
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].env)' | grep DB_TYPE
```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Seerr are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `seerr` | Base name for resources. |
| `display_name` | `Seerr` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Pulled directly as the `ghcr.io/seerr-team/seerr` image tag — no build step involved. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `5055` | Confirmed via local `docker run` and live deployment. |
| `container_image_source` | `prebuilt` | Seerr only supports the official image; `Seerr_Common` also hardcodes this internally. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | See §6 below — `max_instance_count = 5` is a looser default than Seerr's single-writer settings model would suggest. |
| `enable_image_mirroring` | `true` | Mirrors the image into Artifact Registry (avoids GHCR rate limits). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `data` bucket | Additional bucket, separate from the automatic `storage` bucket. |
| `gcs_volumes` | `[]` | The `storage` bucket mount at `/app/config` is added automatically; use this for *additional* volumes only. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Required — Seerr has no non-Postgres path. |
| `db_name` / `db_user` | `seerr` / `seerr` | Forwarded to `Seerr_Common`, injected as `DB_NAME`/`DB_USER`. |
| `db_password_env_var_name` | `DB_PASS` | **Critical** — Seerr's datasource reads `DB_PASS` specifically, not the Foundation's default `DB_PASSWORD`. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Empty and typically stays that way — `dbConnection.runMigrations()` runs on every boot inside the app itself. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` (via `Seerr_Common`) | Unauthenticated `200` JSON status endpoint; the variant's own `variables.tf` default (HTTP `/`) is superseded by `Seerr_Common`'s more accurate default. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` | Cloud Run service name and URL. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Cloud SQL instance and Seerr database identifiers. |
| `storage_buckets` | The `storage` bucket backing `/app/config`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Created initialization job names (empty for Seerr). |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `DB_TYPE` environment variable | Leave `Seerr_Common`'s default (`postgres`) untouched | **Critical** | Missing/overridden `DB_TYPE` silently drops Seerr onto a per-container SQLite file wiped on every restart — the app looks healthy, but nothing persists. |
| `db_password_env_var_name` | Leave at `DB_PASS` | **Critical** | Seerr's TypeORM datasource only reads `DB_PASS`; the Foundation's default `DB_PASSWORD` alone is never read, and the app cannot authenticate to Postgres. |
| `max_instance_count` | Set `1` if settings changes (media-server config, discovery sliders, notification agents) must never race | Medium | `settings.json` is a single mutable file, not a transactional database — concurrent writers from multiple instances risk a lost write. The module default is `5`, looser than the single-writer-safe value. |
| `gcs_volumes` / storage at `/app/config` | Leave the automatic `storage` mount in place | **Critical** | Removing or misconfiguring this volume loses every app-level setting (media servers, sliders, notification agents) on the next cold start, even though Postgres data is untouched. |
| Probe path | Leave at `/api/v1/status` | High | An authenticated or nonexistent probe path would leave the revision permanently unhealthy even though the app booted fine. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Seerr-specific application configuration
shared with the GKE variant is described in **[Seerr_Common](Seerr_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Seerr on Cloud Run](../labs/Seerr_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Seerr on GKE Autopilot](Seerr_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Seerr Common — Shared Application Configuration](Seerr_Common.md) — the configuration shared by both deployment targets.
