---
title: "Trilium on Google Cloud Run"
description: "Configuration reference for deploying Trilium on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Trilium on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_CloudRun.png" alt="Trilium on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (the actively maintained **TriliumNext** fork — not the archived
`zadam/trilium`) is an open-source, hierarchical, self-hosted note-taking
application with an embedded SQLite database. This module deploys Trilium on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Trilium uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Trilium costs on RAD, and how that compares

**Running Trilium on Cloud Run in your own Google Cloud project costs about US$32.57/month in Google Cloud charges**, on top of a one-off 40-credit RAD module fee (US$4) charged once at deploy time. Trilium keeps all of its own state in an embedded SQLite database on a shared NFS volume, so it needs no separate managed database — its running cost is close to the floor of what any Cloud Run deployment with persistent storage costs. In a RAD-managed project the module fee drops to 36 credits (10% lower) — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below — or see the [GKE guide](Trilium_GKE.md) if you'd rather run it on Kubernetes.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 40 credits | 36 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | US$32.57/month, billed by Google at list price | ~15 credits/day (about 450/month, US$45 at the top-up price), metered at list price plus RAD's margin |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project**

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$32.57** |


### How it compares

- Trilium (the TriliumNext fork) has no official hosted cloud version — it is distributed only as self-hosted software, so there is no vendor SaaS plan to compare against.
- A self-managed comparison, sized to Trilium's 1 vCPU / 1 GiB default: a Hetzner CPX11 or DigitalOcean 1 vCPU/2GB Droplet runs about $6-12/month, cheaper in cash terms than either RAD option here — plus your own time for backups, OS patching and TLS renewal, which RAD's managed Secret Manager and monitoring cover for you.
- Because Trilium needs no managed database, the gap between RAD and a bare VPS is mostly the NFS volume, networking and the ability to pause it for free in a RAD-managed project (see below) — not database administration.

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
customised Trilium and want to keep that work, copy a backup out (to Google Drive, or a bucket
outside the project) before deleting. For a default install with nothing irreplaceable in it,
this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once 30 days have passed on a RAD-managed one, there is no free pause —
deleting removes the resources for good, and bringing Trilium back means redeploying from
scratch. That costs about 43-46 credits in your own project, or about
39-42 credits in a RAD-managed one.

Deleting only saves money once Trilium would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — about 4 days or more in your own project
(about US$1.09 a day), or about 3 days or more in a RAD-managed one
(15 credits a day).

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

Trilium runs as a single Node.js/Express container on Cloud Run v2. The deployment
wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, serverless autoscaling — but see scaling notes below |
| Database | None (embedded SQLite) | Trilium's entire document store is a single SQLite file, `document.db`, on the persistent volume |
| Data directory | Cloud Filestore (NFS) | `/home/node/trilium-data` is on the shared NFS volume by default; a GCS FUSE bucket is mounted there only if NFS is turned off |
| Secrets | Secret Manager | None generated — Trilium has no env-var-driven credential |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database engine to manage.** `database_type = "NONE"` — there is no Cloud SQL
  instance, no connection string, and nothing to back up separately from the data bucket.
- **Single-instance only.** `min_instance_count = max_instance_count = 1`. Trilium's
  embedded SQLite database has no multi-writer support — running more than one
  instance risks database corruption from concurrent writes.
- **No seeded credential.** Unlike apps with a Secret Manager-backed password,
  Trilium has **no** env-var-driven auth bootstrap. On first visit, the app itself
  presents a "Set Password" screen; complete it before sharing the URL.
- **Health probe is `/api/health-check`, not `/`.** The root path (`/`) returns a
  302 redirect to the setup/login screen. Only `/api/health-check` returns an
  unauthenticated `200 {"status":"ok"}` — confirmed live via local container testing.
- **The data directory is everything.** `/home/node/trilium-data` holds the SQLite
  database, all attachments, revision history, and settings. Losing this volume
  loses everything. It is on the NFS volume by default (`enable_nfs = true`,
  `nfs_mount_path = /home/node/trilium-data`). Keep it there: Trilium runs SQLite in WAL
  mode, which needs shared-memory locking that GCS FUSE cannot provide, so on GCS FUSE
  recent writes are silently lost when the container is replaced.
- **`mount_options` set `uid=1000,gid=1000`** on the GCS FUSE fallback. Trilium's
  container runs as the `node` user; without matching mount options, GCS FUSE mounts
  the directory root-owned and the app fails to boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Trilium service

Trilium runs as a single Cloud Run v2 service. Because it must stay at exactly one
instance, there is no meaningful autoscaling to observe — the interesting signal is
revision health and cold-start behaviour.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. The Trilium data directory

The entire application state (SQLite `document.db`, attachments, revision history,
settings) lives in `/home/node/trilium-data`, which is the NFS mount path by default.
A dedicated Cloud Storage bucket is also provisioned; it is mounted at that path via
GCS FUSE only when `enable_nfs = false` or `nfs_mount_path` points elsewhere, so the
directory always has exactly one owner. Avoid that fallback — GCS FUSE cannot hold a
WAL-mode SQLite database safely.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount options and CMEK.

### C. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Trilium Application Behaviour

- **No first-deploy database setup job.** Trilium creates and migrates its own
  SQLite schema on first web visit, via its own setup wizard — there is no
  Terraform-managed `db-init` job to inspect.
- **First-run "Set Password" screen.** Navigating to the root URL for the first
  time presents a password-setup form (no default admin/username — Trilium is a
  single-user app). There is no pre-seeded credential in Secret Manager to look up.
- **Health path.** Startup and liveness probes target `/api/health-check`, which
  returns `200 {"status":"ok"}` once the HTTP server is listening — regardless of
  whether the SQLite database has been initialized yet (that only happens after the
  operator completes the Set Password step).
- **Single-writer constraint.** Never raise `max_instance_count` above `1` — the
  embedded SQLite database is not safe for concurrent writers from multiple
  instances.
- **Inspect the running revision:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Trilium are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `trilium` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Trilium Notes` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Docker image version tag; mapped to a pinned build ARG (`TRILIUM_VERSION`) internally, not passed through as `latest` to the Dockerfile. |
| `enable_password` | `false` | Reserved for parity with other single-user editor modules. **No effect** — Trilium has no env-var-driven password bootstrap. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; Trilium is lightweight, raise only for very large note collections. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Keep both at 1** — no multi-writer support on the embedded SQLite database. |
| `container_port` | `8080` | Trilium's default HTTP port. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `enable_image_mirroring` | `true` | Mirror the Trilium image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default; restrict to `internal` for a private deployment. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Trilium. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the Trilium data bucket. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volumes beyond the auto-mounted data bucket. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Not referenced — Trilium has no SQL database (embedded SQLite only). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/api/health-check`, 30s delay | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check on `/api/health-check`. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `trilium_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Raising it risks concurrent writers corrupting the embedded SQLite database — there is no query-layer protection against this. |
| `enable_nfs` / `nfs_mount_path` | `true` / `/home/node/trilium-data` (the defaults) | Critical | Turning NFS off or moving the mount puts `document.db` on GCS FUSE, where WAL writes are silently lost on container replacement. |
| Data bucket / `gcs_volumes` mount_options (GCS FUSE fallback only) | `uid=1000,gid=1000` | Critical | Wrong uid/gid mounts the data directory root-owned; the non-root Trilium process fails to boot with a permission error. |
| First-visit "Set Password" step | Complete immediately | Critical | An un-set-password Trilium instance left on a public URL is reachable by anyone until the password is set. |
| `startup_probe` / `liveness_probe` path | `/api/health-check` | High | Pointing probes at `/` gets a 302 redirect, which most HTTP health checks treat as a failure, blocking the revision from ever becoming Ready. |
| `ingress_settings` | `internal` for private use | Medium | `all` (default) makes the (initially unauthenticated, pre-Set-Password) instance reachable from the public internet. |
| `memory_limit` | `1Gi` | Low | Trilium is lightweight; only raise for very large note/attachment collections. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Trilium-specific application configuration
shared with the GKE variant is described in **[Trilium_Common](Trilium_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Trilium on Cloud Run](../labs/Trilium_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Trilium on GKE Autopilot](Trilium_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Trilium Common — Shared Application Configuration](Trilium_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Memos on Google Cloud Run](Memos_CloudRun.md), [Linkwarden on Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag on Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS on Google Cloud Run](FreshRSS_CloudRun.md) in the **Personal Knowledge & Reading** solution.
