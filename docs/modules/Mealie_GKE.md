---
title: "Mealie on GKE Autopilot"
description: "Configuration reference for deploying Mealie on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Mealie on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mealie_GKE.png" alt="Mealie on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mealie is an open-source, self-hosted recipe manager and meal planner with a
FastAPI backend and a Vue frontend, offering automatic recipe import by URL
alongside a manual UI editor. This module deploys Mealie on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Mealie uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Mealie costs on RAD, and how that compares

**Mealie on RAD's GKE Autopilot module costs about US$91 a month in your own project, with no per-household subscription.** RAD charges 40 credits once per deployment in your own project (36 credits, 10% lower, in a project RAD manages), plus build time. The same app also deploys on Cloud Run for about US$68 a month — see the [Cloud Run guide](Mealie_CloudRun.md) for the lower-cost option. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead — see **Pause it for free**, below.


### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4.00 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$91 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **85 credits a day**, about 2,550 a month (about US$255.00 at the top-up price, less on a plan) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 0.5 GiB | US$34 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; US$0 if this is your only cluster, else ~US$73 |
| **Total** | **about US$91** |

### How it compares

- **Plan to Eat**, a hosted recipe manager and meal planner, costs **US$5.95 a
  month** (US$49 a year, about US$4.08 a month billed annually) and covers one household across
  web, iPhone and Android.
- RAD's Mealie module costs about US$91 a month in your own project — more than
  a single Plan to Eat subscription in cash terms for one household. The case for RAD here is
  owning your recipe data outright with no subscription lock-in and full API access, and it
  stops making sense in isolation once a household just wants a cheap meal planner — it fits
  best alongside other self-hosted apps already running in the same project.
- Self-managed comparison: at 1 vCPU / 0.5 GiB with a Postgres
  database, a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB droplet (~US$24/month) is in range, but
  you run Postgres, backups and upgrades yourself.


### Pause it for free: delete a RAD-managed project, restore it when you need it

If Mealie runs in **a project RAD manages for you**, you have a second option that goes
well beyond scaling to zero: **delete the whole project, and restore it within 30 days for
close to nothing.** This suits Mealie you only need occasionally — evaluating it, a demo
environment, a seasonal or intermittent workload — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it,
  recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can
  restore it. RAD asks Google to undelete the project and reattaches its billing account, then
  asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. For Mealie behind Services_GCP (a GKE cluster, a Postgres database) and Project_GCP, that is roughly **a handful of credits (under US$1)** in total, against the about 45 credits (US$4.50) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$91.**
  Deploy Mealie, use it for a while, delete the project. Restore it next time you need it,
  confirm with Update, and delete it again when you're done. You pay only for the module fee
  once, the builds, and whatever time it was actually live.
- **What this needs.** You must own the project (not one RAD only manages billing for), and
  you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still
  clear the tier's floor (100 credits for the sandbox tier most evaluation use fits). Google
  says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups and other generated files are
  written to a bucket inside the project, and that bucket is **not** protected by Cloud
  Storage's soft-delete, so it is very likely gone as soon as you delete the project — even
  though the project itself is recoverable for 30 days. If you have customised Mealie and
  want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete. For a default installation with nothing irreplaceable in it, this does
  not matter.


### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the
30-day window has passed, the way to stop paying is to delete the deployment and deploy it
again when you need it.**

- **What a redeploy costs.** The module fee again, plus the builds — roughly
  45 credits (US$4.50) in total. Deleting saves money
  only once Mealie would otherwise sit unused long enough to clear that redeploy cost
  against its own running cost — about **2 days or more**, both in your own project
  (about US$3.04 a day) and in a RAD-managed one (85 credits a day).
- **Most of the running cost is usually shared.** For Mealie that is the database. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.


### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
card, bank transfer or mobile money.


**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics and what it says about Cloud Storage objects without soft delete; [Plan to Eat](https://www.plantoeat.com/pricing/). Prices change; check each source before relying on a figure.


## 1. Overview

Mealie runs as a single FastAPI/Vue web workload. The deployment wires
together a small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | FastAPI pod, 1 vCPU / 512 MiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Mealie reads discrete `POSTGRES_*` env vars, not a constructed DSN |
| Object storage | Cloud Storage | A `data` bucket is created for recipe images and auto-mounted at `/app/data` |
| Cache & queue | none | Mealie has no Redis or queue dependency |
| Secrets | Secret Manager | Database password only — Mealie has no env-configurable admin credential |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the standardized engine.** `Mealie_Common` fixes
  `database_type = "POSTGRES_15"` and sets `DB_ENGINE=postgres` explicitly.
- **No custom container build.** The official prebuilt image
  (`ghcr.io/mealie-recipes/mealie`) is used directly.
- **Default admin account, not first-registration — and it is NOT
  configurable.** Mealie's initial credential can no longer be set via
  environment variables as of v3.x (see the
  [Common guide](Mealie_Common.md)). Every deployment boots the same
  well-known account: `changeme@example.com` / `MyPassword`. Log in immediately
  after first deploy and complete the forced password reset.
- **`workload_type = "Deployment"`, not `StatefulSet`.** Mealie keeps no local
  state beyond what's already in Cloud SQL — no PVC, no NFS mount required.
- **Recipe images are persisted by default.** `Mealie_Common` declares a
  `gcs_volumes` entry mounting the `data` GCS bucket at `/app/data`, so
  uploaded recipe images survive a pod restart.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Mealie workload

- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL for PostgreSQL 15

Pods reach the database privately through the **cloud-sql-proxy** sidecar over
`127.0.0.1`.

- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mealie"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

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

## 3. Mealie Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh`, idempotently creating the application role and
  database.
- **Schema migrations on start.** Mealie applies its own internal migrations
  automatically on every pod start.
- **Fixed default admin credential — not configurable.** Mealie creates
  `changeme@example.com` / `MyPassword` on first database initialisation. This is
  a hardcoded upstream default (no env var overrides it as of v3.x), not a
  generated secret — a password reset is forced on first login, and operators
  must complete it immediately after deploy.
- **Health path.** Startup and liveness probes target `/api/app/about`.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Mealie are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `mealie` | Base name for resources. |
| `application_version` | `latest` | Mealie publishes a genuine `latest` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed. |
| `container_port` | `9000` | Mealie's native default port. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | HPA scaling bounds. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `data` bucket | Created and auto-mounted at `/app/data`. |
| `stateful_pvc_enabled` | `null` (auto, disabled) | Not used — Mealie is stateless at the pod level. |

### Group 12 (16) — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Mealie_Common`. |
| `db_host_env_var_name` | `POSTGRES_SERVER` | Aliases the platform `DB_HOST` onto Mealie's expected name. |
| `db_user_env_var_name` | `POSTGRES_USER` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `POSTGRES_DB` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Aliases `DB_PORT`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/app/about` | Probes target Mealie's real info endpoint. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `data` bucket for recipe images. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` (default) | High | `"custom"` triggers an unnecessary Cloud Build with no Dockerfile in this module. |
| Default admin credential (`changeme@example.com` / `MyPassword`) | Log in and change it immediately after first deploy | **Critical** | This is a fixed, publicly documented upstream default — not a generated secret — as soon as the DB initialises, anyone who knows Mealie's default credential can log in until you complete the forced first-login password reset. |
| `gcs_volumes` for recipe images | Leave empty (use the module's own `/app/data` mount) | Medium | `Mealie_Common` already mounts the `data` bucket at `/app/data`. Supplying a non-empty `gcs_volumes` list replaces that mount entirely — if the replacement does not also cover `/app/data`, uploaded recipe images fall back to the pod's ephemeral filesystem and do not survive a restart. |
| `db_*_env_var_name` variables | Leave at their Mealie-specific defaults | Critical | Changing/clearing these breaks Mealie's Postgres connection — it reads `POSTGRES_*`, not `DB_*`. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Mealie-specific
application configuration shared with the Cloud Run variant is described in
**[Mealie_Common](Mealie_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Mealie on GKE Autopilot](../labs/Mealie_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Mealie on Google Cloud Run](Mealie_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Mealie Common — Shared Application Configuration](Mealie_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Grocy on GKE Autopilot](Grocy_GKE.md), [Homebox on GKE Autopilot](Homebox_GKE.md), [Wallos on GKE Autopilot](Wallos_GKE.md), [LubeLogger on GKE Autopilot](LubeLogger_GKE.md) in the **Home & Life Management** solution.
