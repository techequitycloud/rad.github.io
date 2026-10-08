---
title: "Linkwarden on GKE Autopilot"
description: "Configuration reference for deploying Linkwarden on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Linkwarden on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Linkwarden_GKE.png" alt="Linkwarden on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Linkwarden is an open-source, self-hosted bookmark manager that goes beyond
simple link-saving: every bookmark can be automatically archived as a full-page
screenshot, PDF, and single-file "monolith" snapshot using a bundled headless
Chrome, so your links keep working even after the source page changes or
disappears. This module deploys Linkwarden on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Linkwarden uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Linkwarden costs on RAD, and how that compares

**Linkwarden on RAD's GKE Autopilot module costs about US$129 a month in a Google Cloud project you own, plus a one-off 110-credit (US$11.00) module fee.** GKE suits Linkwarden running alongside other Kubernetes workloads; the [Cloud Run module](Linkwarden_CloudRun.md) runs the same Linkwarden for about US$157 a month. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$129 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11.00 at the top-up price) | 99.0 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$129 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **101 credits a day**, about 3030 a month (about US$303 at the top-up price, US$242 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project
RAD manages, the database, file server and network are shared by every
application in the project, so a second application does not add a second
database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 2 GiB | US$72.16 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5.00 |
| Cloud Storage (add-ons, backups) | US$1.00 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$129** |

### How it compares

- **Linkwarden Cloud** ($3/user/month, $2.25 annually, up to 30,000 links/user — [linkwarden.app/pricing](https://linkwarden.app/pricing)) is cheaper in cash for most team sizes than self-hosting on GKE; self-hosting's case is data sovereignty and no per-link limit, not price.
- A GCE e2-standard-2 (2 vCPU/8 GB, about US$49/month) is the closer-sized self-managed comparison, minus the managed Postgres, backups and pod autoscaling RAD includes.
- Or see the [Cloud Run guide](Linkwarden_CloudRun.md) for the lower-cost option.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Linkwarden runs in **a project RAD manages for you**, you have a second option that
goes well beyond scaling to zero: **delete the whole project, and restore it within
30 days for close to nothing.** This suits Linkwarden you only need occasionally — a
course project, a demo, a short-lived evaluation — far better than running it
continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then
  asks Google to delete the project. Google does not remove the project
  immediately: it keeps it, recoverable, for 30 days. Because billing is already
  unlinked, nothing is charged while it waits. Unlike deleting one module, this does
  not tear down Cloud SQL or Linkwarden's own compute one by one — the whole
  project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the
  project's owner can restore it. RAD asks Google to undelete the project and
  reattaches its billing account, then asks you to run **Update** on each
  deployment to confirm everything came back. Because nothing was individually
  destroyed, that Update finds the same resources already there — it is a check,
  not a rebuild, and an Update never charges the module fee again. For Linkwarden
  behind a small Services_GCP and Project_GCP, that is **a handful of credits
  (under US$1)** in total, against the 115 credits a full
  redeploy costs.
- **What this needs.** You must own the project (not a bring-your-own one RAD only
  manages billing for), and you restore it yourself within the 30 days — after
  that, Google deletes it for good. Restoring is admitted like creating a new
  project: your purchased credit balance must still clear the tier's floor (100
  credits for the sandbox tier most study and demo use fits). Google says most
  services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Linkwarden's nightly backups
  are written to a bucket inside the project, and that bucket is **not** protected
  by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete
  the project — even though the project itself is recoverable for 30 days. If
  you've customised Linkwarden and want to keep that work, copy a backup out (to Google
  Drive, or a bucket outside the project) before you delete, the same as the
  redeploy workflow below. For a default installation with nothing irreplaceable
  in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

GKE keeps at least one pod running, so it never scales to zero on its own. The option above only applies to a RAD-managed project; **in your
own project, or once the 30-day window has passed, the way to stop paying is to
delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about
  115 credits (US$11.50), because RAD
  recreates the project and shared services before Linkwarden. Deleting saves money
  only once Linkwarden would otherwise sit unused for about three days
  or more, both in your own project (about US$4.31 a day) and in
  a RAD-managed one (101 credits a day).
- **Delete everything Linkwarden uses.** Most of the running cost is usually the database. It stops only when nothing else in the project uses it, so deleting Linkwarden while something else shares the project saves only Linkwarden's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment
  and are deleted with it, so copy the latest backup out before deleting if you
  want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a Linkwarden session for a class. Each
  participant gets Linkwarden in their own Google Cloud project for 15 minutes to 24
  hours, within an allowance the trainer sets. Either the trainer funds every place
  up front, or each participant pays for their own. Everything is deleted when the
  session ends, and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Linkwarden for a client
  from a ring-fenced wallet it funds, and settles with the client directly. If the
  wallet runs low, billing pauses and the data is kept, so nobody receives an
  unexpected charge. At the end of the engagement the partner hands the project
  over, and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES
and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog
API; RAD fees and the 101-credit daily estimate from
[radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore
projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for
the 30-day recovery window and what it says about Cloud Storage objects without soft
delete.  [Linkwarden Cloud pricing](https://linkwarden.app/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

Linkwarden runs as a single Next.js pod. The web server and a background
archiving worker run side by side in the SAME container (via `concurrently`) —
there is no separate worker Deployment. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js + headless Chrome pod, 2 vCPU / 2 GiB by default, `min_instance_count = 1` |
| Database | Cloud SQL for PostgreSQL 15 | Required — Linkwarden's Prisma schema is Postgres-only |
| Object storage | Cloud Storage (GCS Fuse CSI volume) | Mounted at `/data/data` by default for archived screenshots/PDFs/monoliths |
| Cache & queue | None | The archiving worker polls PostgreSQL directly; no Redis/BullMQ dependency |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate, `reserve_static_ip = true` |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Linkwarden's Prisma schema hardcodes the
  `postgresql` provider; selecting any other engine breaks the first-boot
  migration.
- **`DATABASE_URL` connects over the cloud-sql-proxy loopback.**
  `enable_cloudsql_volume = true` is required — it launches the proxy sidecar
  that answers on `127.0.0.1`, which the cloud entrypoint uses with
  `sslmode=disable` (the proxy already terminates TLS). This differs from the
  Cloud Run variant, which connects over the raw private IP with
  `sslmode=require`.
- **`NEXTAUTH_URL` is derived automatically**, appending the required
  `/api/v1/auth` suffix to the computed service URL.
- **`reserve_static_ip = true` by default.** Linkwarden's `NEXTAUTH_URL` bakes
  in the service URL at container boot, so a stable external IP avoids the
  internal-DNS-fallback race documented for other self-referencing-URL apps
  in this catalogue.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero) so
  the in-container background archiving worker keeps processing the queue.
- **Headless Chrome runs in-process with the web server.** Size
  `container_resources` for the whole container's peak (2 vCPU / 2Gi default;
  bump memory to 4Gi for heavy archiving loads).
- **A GCS volume is mounted automatically at `/data/data`.** This is the
  absolute path Linkwarden's storage code resolves `STORAGE_FOLDER` to. The
  image's whole container runs as root, so no gcsfuse uid/gid mount-option
  override is needed (unlike some other GKE modules in this catalogue).
- **No seeded superuser.** The first user to register through the standard
  NextAuth registration flow becomes the instance owner.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Linkwarden workload

Linkwarden pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request.

- **Console:** Kubernetes Engine → Workloads → select the Linkwarden workload
  to see pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
lifecycle work.

### B. Cloud SQL for PostgreSQL 15

Linkwarden stores all application data (bookmarks, collections, tags, users,
archive metadata) in a managed Cloud SQL for PostgreSQL 15 instance. The
cloud-sql-proxy sidecar (enabled via `enable_cloudsql_volume = true`) listens
on `127.0.0.1`; the cloud entrypoint connects `DATABASE_URL` there with
`sslmode=disable`. On first deploy an initialization Job creates the
application database and user; Linkwarden then runs its own
`prisma migrate deploy` on every container start.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage (archived content)

A dedicated **Cloud Storage** bucket is provisioned automatically and mounted
via the GCS Fuse CSI driver at `/data/data` by default — the absolute path
Linkwarden's storage code resolves `STORAGE_FOLDER` to at runtime.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for GCS Fuse CSI driver options.

### D. Secret Manager

One secret is generated automatically and stored in Secret Manager:
`NEXTAUTH_SECRET` (signs NextAuth session JWTs). It is materialised into the
namespace and injected as a pod env var. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for injection and rotation details.

### E. Networking & ingress

The service is exposed via a `LoadBalancer` Kubernetes Service with a reserved
static IP by default (`reserve_static_ip = true`). An Ingress with a custom
domain and managed certificate, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Kubernetes Engine → Services & Ingress; Network services → Load
  balancing.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Linkwarden Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`
  using `postgres:15-alpine`. It connects through the cloud-sql-proxy sidecar
  and idempotently creates the application database and user and grants
  privileges. The job is safe to re-run.
- **Schema migrations run on every boot.** Linkwarden's base image `CMD` runs
  `prisma migrate deploy` before starting the web and worker processes, so
  upgrading the application version applies schema changes automatically.
- **`NEXTAUTH_SECRET` is immutable after first boot.** Generated once and
  written to Secret Manager. Rotating it invalidates every active session.
- **No pre-seeded admin account.** The first user to register through the
  standard NextAuth registration flow becomes the instance owner.
- **Background archiving worker.** A separate process (`worker.ts`, run via
  `concurrently` alongside the web server in the same container) polls
  PostgreSQL directly and processes queued links in batches
  (`ARCHIVE_TAKE_COUNT`, default `5`). Each batch launches headless Chrome
  instances for screenshot/PDF/monolith capture.
- **Health path.** Startup and liveness probes default to `/` — Linkwarden has
  no confirmed dedicated health endpoint. The startup probe allows a generous
  window for Next.js cold start plus headless Chrome/Playwright
  initialization.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Linkwarden are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 1 / 2 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for regional resources. |
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `linkwarden` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Linkwarden` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Linkwarden publishes a genuine `latest` tag upstream. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="2Gi" }` | Headless Chrome archiving runs in-process; bump memory to `4Gi` for heavy workloads. |
| `min_instance_count` | `1` | GKE has no scale-to-zero; keeps the archiving worker alive. |
| `max_instance_count` | `5` | HPA upper bound. |
| `container_port` | `3000` | Linkwarden (Next.js) listens on port 3000. |
| `enable_cloudsql_volume` | `true` | Required — launches the cloud-sql-proxy sidecar the entrypoint connects to. |
| `enable_image_mirroring` | `true` | Mirror the Linkwarden image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Static env vars. `DATABASE_URL`, `NEXTAUTH_URL` are set automatically — do not set them here. |
| `disable_browser` | `false` | Sets `DISABLE_BROWSER` — skips all headless-Chrome archiving tasks. |
| `archive_take_count` | `5` | Links processed per background-worker batch (`ARCHIVE_TAKE_COUNT`). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Public-facing web UI needs external exposure. |
| `session_affinity` | `ClientIP` | Sticky routing for NextAuth session cookies. |
| `namespace_name` | `""` | Leave empty to auto-generate. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off by default — Linkwarden uses a GCS volume instead for simplicity. |
| `nfs_mount_path` | `/data/data` | Only used when `enable_nfs = true`. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `gcs_volumes` | `[]` (falls back to a built-in default) | A default "storage" volume mounted at `/data/data` is wired automatically unless you supply your own list, which fully replaces it. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Linkwarden's Prisma schema is Postgres-only. |
| `application_database_name` | `linkwarden` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `linkwarden` | Application database user. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Linkwarden's `NEXTAUTH_URL` bakes in the service URL at boot — a stable IP avoids an internal-DNS fallback race. |
| `enable_custom_domain` | `true` | Provision Ingress + managed certificate for custom hostnames. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used by Linkwarden — its archiving worker polls PostgreSQL directly. Kept for Foundation-variable parity. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` / `service_external_ip` | In-cluster / external IP. |
| `service_url` | URL to reach Linkwarden. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. Most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every active session, forcing all users to log in again. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` (fixed) | Critical | Any other engine breaks the first-boot Prisma migration entirely. |
| `enable_cloudsql_volume` | `true` (required) | Critical | Disabling it removes the cloud-sql-proxy sidecar the entrypoint depends on — `DATABASE_URL` connects to nothing. |
| `min_instance_count` | `1` | High | Scaling to 0 (not supported by default on GKE) would stop the background archiving worker. |
| `container_resources.memory_limit` | `2Gi` minimum | High | Headless Chrome archiving OOMs below this floor; the web server may still respond while archiving silently fails. |
| `service_type` | `LoadBalancer` | High | Setting `ClusterIP` on a public-facing bookmark UI makes it unreachable from a browser (a known copy-paste bug pattern elsewhere in this catalogue). |
| `reserve_static_ip` | `true` | Medium | `false` risks Linkwarden's baked-in `NEXTAUTH_URL` resolving to unreachable internal DNS if the ephemeral IP isn't known at apply time. |
| `disable_browser` | `false` unless Chrome misbehaves | Medium | Leaving it `true` unnecessarily disables all screenshot/PDF/monolith archiving. |
| `gcs_volumes` | Use the built-in default | Medium | Supplying a custom list without matching the `/data/data` mount path leaves archived content unwritable or split across storage backends. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Linkwarden-specific application configuration shared with the Cloud Run
variant is described in **[Linkwarden_Common](Linkwarden_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Linkwarden on GKE Autopilot](../labs/Linkwarden_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Linkwarden on Google Cloud Run](Linkwarden_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Linkwarden Common — Shared Application Configuration](Linkwarden_Common.md) — the configuration shared by both deployment targets.
