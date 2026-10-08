---
title: "Homebox on GKE Autopilot"
description: "Configuration reference for deploying Homebox on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Homebox on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homebox_GKE.png" alt="Homebox on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Homebox is an open-source, self-hosted home inventory and organization system
with a Go REST API backend (Echo-style, Ent ORM) and a Vue 3/Nuxt frontend
served embedded from the same binary — track items, attach photos, and
organize by location. This module deploys Homebox on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Homebox uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Homebox costs on RAD, and how that compares

**Running Homebox on GKE Autopilot pod in your own Google Cloud project costs about $91.31/month in Google Cloud charges**, on top of a one-off 40-credit RAD module fee charged once at deploy time. Homebox is a small home-inventory app with a modest Postgres database behind it — there is no commercial hosted SaaS for this exact open-source project to name. In a RAD-managed project the module fee drops to 36 credits (10% lower) and the running cost is metered hourly in credits instead of billed directly by Google — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below for the one RAD-managed advantage a self-hosted VPS cannot match — or see the [Cloud Run guide](Homebox_CloudRun.md) for the lower-cost option.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 40 credits | 36 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | $91.31/month, billed by Google at list price | ~85 credits/day, metered at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 1x vCPU / 0.5 GiB | $34.29 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **$91.31** |

*The GKE cluster management fee is excluded from the total above because it is shared across every GKE app in the project — $0 if this is the only one, otherwise roughly $73/month split across however many you run.*

### How it compares

- A self-managed comparison: Hetzner CPX22 (2 vCPU/4GB) runs about $24/mo, a DigitalOcean 2 vCPU/4GB Droplet is the same $24/mo, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about $49/mo — more than this 1 vCPU/0.5 GiB app needs on its own, but the smallest widely-quoted reference point; a cheaper shared-vCPU class would also run it comfortably.
- Most of the running cost above is the dedicated Postgres instance, which a self-managed box would also need to run (and back up) itself.
- The usual trade-off applies: cheaper in cash terms on a VPS, managed backups and patching on RAD.

### Pause it for free: delete a RAD-managed project, restore it when you need it

This is the headline advantage of a RAD-managed project, and it costs nothing while paused.
Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the
project outright — Google's own 30-day recoverable soft delete. Unlike deleting one module,
this does **not** tear down Cloud SQL, any VM, or the compute resource one by one: the whole
project simply stops, and nothing is charged while it waits, because billing is already
unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment to
confirm everything came back. Because nothing was individually destroyed, that Update finds
the same resources already there — it is a check, not a rebuild, and an Update never charges
the module fee again. This costs only a handful of credits (under US$1) in total for a typical
2-3-deployment chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days — after that Google deletes it for good — and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you
delete the project — even though the project itself is recoverable for 30 days. If you've
customised Homebox and want to keep that work, copy a backup out (to Google Drive, or a bucket
outside the project) before deleting. For a default install with nothing irreplaceable in it,
this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once 30 days have passed on a RAD-managed one, there is no free pause —
deleting removes the resources for good, and bringing Homebox back means redeploying from
scratch. That costs about 43-46 credits (the 40-credit module fee plus a build).

Deleting only saves money once Homebox would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — for Homebox, that's about 2 days or
more. Most of that running cost is usually the database (and, where this module uses one, the shared file-server VM or GKE cluster) — those stop only once nothing else in the project uses them, so deleting this app while something else shares the project saves only its own compute share.

Keep data first: nightly backups go to a bucket inside the deployment and are deleted with it,
so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

Lab sessions, for training: a trainer runs a session for a class. Each participant gets the
app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
trainer sets. Either the trainer funds every place, or each participant pays for their own.
Everything is deleted when the session ends and unused credits go back to the trainer.

Managed Environments, for consultancies: a partner runs the app for a client from a
ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Google's project delete/restore documentation](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore claims.

## 1. Overview

Homebox runs as a single Go binary (API + embedded frontend) — one pod,
no sidecars beyond the Cloud SQL Auth Proxy. The deployment wires together a
small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go/Echo pod, 1 vCPU / 512 MiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Homebox reads discrete `HBOX_DATABASE_*` env vars, not a constructed DSN |
| Object storage | Cloud Storage | A `data` bucket is created for item photos/attachments and auto-mounted at `/data` |
| Cache & queue | none | Homebox has no Redis or queue dependency |
| Secrets | Secret Manager | Database password plus `HBOX_AUTH_API_KEY_PEPPER` (a real, app-consumed secret) |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the standardized engine.** `Homebox_Common` fixes
  `database_type = "POSTGRES_15"` and sets `HBOX_DATABASE_DRIVER=postgres`
  explicitly.
- **No custom container build.** The official prebuilt image
  (`ghcr.io/sysadminsmedia/homebox`) is used directly.
- **Open self-registration, not a default admin account.** Homebox does not
  ship a hardcoded credential: the first person to submit the "Register"
  form on a fresh instance becomes the initial admin user. See the
  [Common guide](Homebox_Common.md) for detail. Operators should set
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` after completing registration.
- **`workload_type = "Deployment"`, not `StatefulSet`.** Homebox keeps no
  local state beyond what's already in Cloud SQL — no PVC, no NFS mount
  required.
- **Item photos are persisted by default.** `Homebox_Common` declares a
  `gcs_volumes` entry mounting the `data` GCS bucket at `/data`, so uploaded
  item photos and attachments survive a pod restart. If you enable the block
  PVC instead (`stateful_pvc_enabled = true`, mounted at `/data`), the GCS FUSE
  mount is dropped automatically so the two never collide.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Homebox workload

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
  gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~homebox"
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

## 3. Homebox Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh`, idempotently creating the application role and
  database.
- **Schema migrations on start.** Homebox's Ent ORM applies its own internal
  migrations automatically on every pod start.
- **Open self-registration — no default admin credential.** The first
  visitor to complete the "Register" form becomes the admin. There is no
  credential to retrieve, reset, or rotate — set
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` once the admin account exists to
  close public signups.
- **Health path.** Startup and liveness probes target `/api/v1/status` —
  Homebox's real, unauthenticated status endpoint.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Homebox are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `homebox` | Base name for resources. |
| `application_version` | `latest` | Homebox publishes a genuine `latest` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed. |
| `container_port` | `7745` | Homebox's native default port. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | HPA scaling bounds. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `data` bucket | Created and auto-mounted at `/data`. |
| `stateful_pvc_enabled` | `null` (auto, disabled) | Optional. Setting `true` mounts a block PVC at `/data` and drops the GCS FUSE mount there; the default bucket mount already persists photos. |

### Group 12 (16) — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Aliases the platform `DB_HOST` onto Homebox's expected name. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Aliases `DB_PORT`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/v1/status` | Probes target Homebox's real status endpoint. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `data` bucket for item photos and attachments. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` (default) | High | `"custom"` triggers an unnecessary Cloud Build with no Dockerfile in this module. |
| First registration | Complete promptly after deploy | **Medium** | The first person to register on a fresh, publicly reachable instance becomes the admin — until you register and set `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, anyone who discovers the URL can claim the admin account. |
| `gcs_volumes` for item photos | Leave empty (use the module's own `/data` mount) | **High** | `Homebox_Common` already mounts the `data` bucket at `/data`. Supplying a non-empty `gcs_volumes` list replaces that mount entirely — if the replacement does not also cover `/data`, uploaded item photos and attachments fall back to the pod's ephemeral filesystem and do not survive a restart. |
| `db_*_env_var_name` variables | Leave at their Homebox-specific defaults | Critical | Changing/clearing these breaks Homebox's Postgres connection — it reads `HBOX_DATABASE_*`, not `DB_*`. |
| `HBOX_DATABASE_SSL_MODE` | `disable` (already set by this module) | Critical | On GKE, `DB_HOST` resolves to `127.0.0.1` (the cloud-sql-proxy sidecar), which terminates TLS itself and serves plaintext on loopback. Homebox's Postgres client defaults `HBOX_DATABASE_SSL_MODE` to `require` and **panics on boot** (`tls error: server refused TLS connection`) unless told the local connection is unencrypted. `Homebox_GKE` sets this via `module_env_vars` — do not clear it. Not needed on Cloud Run, which connects over a Unix socket (no TLS negotiation applies there regardless of this setting). |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Homebox-specific
application configuration shared with the Cloud Run variant is described in
**[Homebox_Common](Homebox_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Homebox on GKE Autopilot](../labs/Homebox_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Homebox on Google Cloud Run](Homebox_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Homebox Common — Shared Application Configuration](Homebox_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Grocy on GKE Autopilot](Grocy_GKE.md), [Mealie on GKE Autopilot](Mealie_GKE.md), [Wallos on GKE Autopilot](Wallos_GKE.md), [LubeLogger on GKE Autopilot](LubeLogger_GKE.md) in the **Home & Life Management** solution.
