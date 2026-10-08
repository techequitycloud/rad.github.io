---
title: "Radicale on GKE Autopilot"
description: "Configuration reference for deploying Radicale on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Radicale on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Radicale_GKE.png" alt="Radicale on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Radicale is an open-source, self-hosted **CalDAV/CardDAV server** for
calendar and contacts sync — a lightweight, pure-Python WSGI application with
no framework and no database. It stores every calendar and address book as
plain iCalendar/vCard files on disk. This module deploys Radicale on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Radicale uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Radicale costs on RAD, and how that compares

**Running Radicale in your own Google Cloud project costs about US$42.08/month in infrastructure, plus a one-time module fee of 75 RAD credits** (sized at 1 vCPU / 1 GiB on GKE Autopilot pods). RAD charges the module fee once, at deploy time — never again on Update — plus build time metered in credits; Google Cloud usage itself is billed to your own billing account at Google's list price. On a **RAD-managed** project the same resources are metered hourly in credits at list price plus RAD's margin — about 67 credits/day — and the module fee is 10% lower, at 67.50 credits. See "Pause it for free" below for how a RAD-managed Radicale deployment can be stopped, at no running cost, until you need it again. (or see the [Cloud Run guide](Radicale_CloudRun.md) for the lower-cost option)

### What you pay on RAD

| Item | Own project | RAD-managed project |
|---|---|---|
| Module fee | 75 credits (once) | 67.50 credits (once) |
| Build time | ~3-6 credits, metered per build minute | same, metered in credits at list price + RAD's margin |
| Google Cloud running cost | ~$42.08/month, billed to your own billing account at Google's list price | ~67 credits/day, metered hourly at list price + RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 1x vCPU / 1 GiB | 36.08 |
| Cloud NAT and networking | 5 |
| Cloud Storage (add-ons, backups) | 1 |
| GKE cluster management fee\* | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **$42.08** |

\* Not included in the total above — it is shared across every GKE app running in the same project, so it is $0 if this is your only GKE cluster.

### How it compares

- We could not verify a current, directly-comparable commercial SaaS price for this exact open-source project, so the honest comparison is a bare self-managed server: Hetzner CPX22 (2 vCPU/4GB, ~$24/mo), a DigitalOcean 2 vCPU/4GB Droplet (~$24/mo), or a GCP Compute Engine e2-standard-2 (2 vCPU/8GB, ~$49/mo). This app's own footprint (1 vCPU or less, 1 GiB or less) is smaller than any of those classes, so a bare self-managed box sized to match would cost less than the figures above — but you would still own every patch, backup and security update yourself.
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
is to delete Radicale outright and redeploy it later. A redeploy costs the module fee again
plus the builds — roughly **78-81 credits** in total for this module.

Deleting only saves money once Radicale would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — for this module, that is about 6 days or more of being idle,
based on its own US$42.08/month running cost above. Most of that running cost is
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

Radicale runs as a single Python WSGI pod. The deployment wires together a
small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Python process pod, 1 vCPU / 1 GiB by default |
| Database | none | Radicale stores every collection as plain files — no Cloud SQL instance is created |
| Object storage | Cloud Storage, or a block PVC | Block PVC by default (`stateful_pvc_enabled = true`); a `storage` GCS bucket is also provisioned and is the mount only if the PVC is turned off |
| Cache & queue | none | Radicale has no Redis or queue dependency |
| Secrets | Secret Manager | A real generated `ADMIN_PASSWORD` — Radicale ships with no default admin account at all |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database of any kind.** `Radicale_Common` fixes `database_type =
  "NONE"` — Radicale is a pure filesystem store.
- **Custom, thin-wrapper build.** `Radicale_Common` layers a cloud entrypoint
  onto the official `ghcr.io/kozea/radicale` image via Cloud Build, then
  mirrors the result into Artifact Registry.
- **Block-storage PVC by default, and required.** `stateful_pvc_enabled = true`
  (auto-resolves `workload_type` to `StatefulSet`) gives Radicale's collections
  filesystem real POSIX file locking and directory renames. On GCS FUSE, creating
  a calendar or address book fails, because gcsfuse cannot rename the temporary
  directory Radicale builds each collection in. `stateful_pvc_storage_class` defaults to `standard` (HDD) rather
  than SSD — collections are small text files with no high-IOPS need.
- **No default admin account — a real generated secret.** `Radicale_Common`
  generates and injects a real `ADMIN_PASSWORD` on every deployment (see the
  [Common guide](Radicale_Common.md)).
- **`max_instance_count` pinned to `1`, `min_instance_count` defaults to
  `0`.** Radicale's storage backend is not designed for concurrent
  multi-instance access, but has no database/index to warm at boot, so
  scale-to-zero is safe and fast.
- **MKCOL works natively here — but the seed job may not reach a PVC.** GKE's
  plain L4 LoadBalancer Service has no MKCOL restriction (unlike Cloud Run),
  but with `stateful_pvc_enabled = true` (the default) the seed job's pre-created
  collections may not appear — see §3.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Radicale workload

- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100    # Deployment mode
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100  # StatefulSet mode
  ```

### B. Storage — Cloud Storage or a block PVC

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
  kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
  ```

### C. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~radicale"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### D. Networking & ingress

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### E. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Radicale Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — Radicale
  has no database to bootstrap.
- **`seed-default-collections` runs at deploy time.** A one-shot
  initialization Job (`execute_on_apply = true`) writes a "Default Calendar"
  and "Default Address Book" directly onto the storage volume for the admin
  user.
- **No default admin account.** Radicale's auth defaults to `denyall` until
  an htpasswd file exists. `Radicale_Common` generates a real
  `ADMIN_PASSWORD` and the cloud entrypoint writes both the INI config and a
  bcrypt htpasswd entry **on every pod boot**.
- **Health path.** Startup and liveness probes target `/`.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

### ⚠ MKCOL works on GKE — but check where your seed job's writes land

Unlike Cloud Run, GKE's plain L4 LoadBalancer Service does **not** restrict
the WebDAV `MKCOL` method — confirmed live (`201 Created`). A real
CalDAV/CardDAV client can create new collections directly with no
workaround needed, which is one reason `Radicale_GKE` is the better fit for
heavier or production use.

However, the default `seed-default-collections` init job is a shared
Cloud-Run/GKE Common-module job and only mounts the shared GCS `storage`
bucket — it **cannot** attach to a StatefulSet's block PVC (a Kubernetes Job
can't mount a `ReadWriteOnce` PVC already held by a running Pod). So:

- **With `stateful_pvc_enabled = true`** (the default): the seed job's writes land in the otherwise-unused GCS bucket,
  and the "Default Calendar"/"Default Address Book" will **not** appear on
  the running pod's PVC-backed filesystem. This is harmless — create your
  first calendar via a real CalDAV client, or `curl -X MKCOL` (confirmed
  working), instead of expecting the pre-seeded defaults.
- **Without a PVC** (GCS-backed Deployment mode): the seed job's writes land in
  the same bucket the running pod mounts, so the defaults do appear — but
  creating any further collection fails on GCS FUSE.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Radicale are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `radicale` | Base name for resources. |
| `application_display_name` | `Radicale` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Resolves to the pinned build `RADICALE_VERSION=3.7.7` — GHCR tags have no `v` prefix. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `5232` | Fixed via `Radicale_Common`; this variable is not forwarded to `App_GKE`. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | HPA scaling bounds; `max` is pinned to `1` non-negotiably. |
| `enable_image_mirroring` | `true` | Mirrors the built image into Artifact Registry. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Keep `true`** — gives Radicale's collections filesystem real POSIX file locking and directory renames; on GCS FUSE, creating a collection fails. Auto-resolves `workload_type` to `StatefulSet`. |
| `stateful_pvc_mount_path` | `/var/lib/radicale` | Must match the base image's own `VOLUME` declaration. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, not SSD — collections are small text files with no high-IOPS need; avoids the tight `SSD_TOTAL_GB` quota. |
| `stateful_fs_group` | `3000` | Makes the PVC group-writable; Radicale runs as UID 1000 / GID 2000. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage` bucket | Mounted at `/var/lib/radicale` via GCS FUSE **unless** `stateful_pvc_enabled = true`, in which case the PVC takes over the same mount path. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Radicale_Common` — Radicale has no database of any kind. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `seed-default-collections` (injected by `Radicale_Common`) | See §3 for the GKE+PVC caveat. Providing a custom list replaces this default entirely. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Radicale's unauthenticated 302 redirect to its web UI; both probe types treat 2xx–3xx as healthy. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `storage_buckets` | The `storage` bucket (unused as a mount when `stateful_pvc_enabled = true`). |
| `statefulset_name` | Name of the StatefulSet, when `workload_type = "StatefulSet"`. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (default) | High | Without it, `/var/lib/radicale` is GCS FUSE-backed, and creating a calendar or address book fails (gcsfuse cannot rename directories). |
| Expecting default collections on a PVC-backed deployment | Create the first calendar via a real CalDAV client or `curl -X MKCOL` | Medium | The `seed-default-collections` job cannot mount a StatefulSet's `ReadWriteOnce` PVC, so its writes land in the unused GCS bucket instead — the pre-seeded defaults silently don't appear on the running pod's filesystem. |
| `max_instance_count` | Leave at `1` | **Critical** | Radicale's storage backend is not designed for concurrent multi-instance access; raising this risks data corruption. |
| `stateful_pvc_storage_class` | Leave at `standard` (HDD) | Low–Medium | Switching to `standard-rwo`/`premium-rwo` (SSD) draws from the far tighter `SSD_TOTAL_GB` quota for no real benefit — Radicale's I/O pattern doesn't need SSD IOPS. |
| Admin credential | Retrieve from Secret Manager after first deploy | **Critical** | Unlike apps with a well-known default login, Radicale generates a real secret — there is no way to log in until you retrieve `ADMIN_PASSWORD`. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Radicale-specific
application configuration shared with the Cloud Run variant is described in
**[Radicale_Common](Radicale_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Radicale on GKE Autopilot](../labs/Radicale_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Radicale on Google Cloud Run](Radicale_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Radicale Common — Shared Application Configuration](Radicale_Common.md) — the configuration shared by both deployment targets.
