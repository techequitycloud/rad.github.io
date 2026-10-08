---
title: "Seerr on GKE Autopilot"
description: "Configuration reference for deploying Seerr on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Seerr on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Seerr_GKE.png" alt="Seerr on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Seerr is the 2026 merger of **Jellyseerr** and **Overseerr** — an
open-source, MIT-licensed request UI that sits in front of a Jellyfin, Plex,
or Emby media server. Users browse and request titles; an admin approves the
request, and Seerr calls Sonarr's and Radarr's APIs to trigger acquisition.
This module deploys Seerr on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Seerr uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Seerr costs on RAD, and how that compares

**Running Seerr in your own GCP project costs about $149.81/month in Google Cloud charges; RAD's module fee is a one-time 110 credits (or 99 credits in a RAD-managed project), covering setup and support -- not the ongoing cloud bill, which Google bills you directly in your own project or RAD meters hourly in credits in a RAD-managed one.**
Or see the Cloud Run guide for the alternative deployment target; either way, if you deploy into a RAD-managed project you can pause the whole thing for free when you are not using it -- see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Your own project | RAD-managed project |
|---|---|---|
| Module fee | 110 credits, once | 99 credits, once (10% lower) |
| Build time | metered in credits as the build runs (a few credits, typically) | same |
| Google Cloud running cost | ~$149.81/month, billed to your own billing account at Google's list price | ~111 credits/day, metered hourly by RAD at list price plus margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | $79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| NFS/cache file server (small VM) | $13.43 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~$73 |
| **Total** | **$149.81** |

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

Seerr runs as a single Node.js/Next.js pod. The deployment wires together a
small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Node.js process pod, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL PostgreSQL 15 | Holds request/user data; migrations run automatically on every pod boot |
| Object storage | Cloud Storage | A `storage` bucket mounted at `/app/config` via GCS FUSE (or an optional StatefulSet PVC) — holds `settings.json`, Seerr's own app settings |
| Cache & queue | none | Seerr has no Redis or queue dependency |
| Secrets | Secret Manager | Only the generated database password — Seerr's first admin comes from the app's own web setup wizard |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **Genuinely prebuilt — no custom image.** `Seerr_Common`'s `scripts/`
  directory is empty. `container_image_source = "prebuilt"` deploys
  `ghcr.io/seerr-team/seerr` directly.
- **`DB_TYPE=postgres` is set unconditionally** by `Seerr_Common` — see the
  [Cloud Run guide's §3](Seerr_CloudRun.md#-the-db_type-trap--the-most-important-thing-to-know-about-this-module)
  for the full explanation; the same trap and the same fix apply here.
- **Port 5055, health path `/api/v1/status`.** Confirmed via local `docker run`
  testing and a live deployment (pod reported `3/3 Running`, `GET /api/v1/status`
  returned real JSON via `kubectl exec`).
- **A GKE-specific GCS-FUSE permission bug, found and fixed.** Seerr's
  container runs as `uid=1000/gid=1000`. Cloud Run's own gcsfuse integration
  auto-applies that UID/GID to the mount; the **GKE GCS FUSE CSI driver does
  not** — without an explicit fix, the pod crash-loops on first boot with
  `EACCES: permission denied` trying to create `/app/config/logs/`.
  `Seerr_Common` mounts the volume with `uid=1000`, `gid=1000`,
  `file-mode=0664`, `dir-mode=0775` to fix this. See §3.
- **Two distinct pieces of state.** PostgreSQL holds request/user data.
  Seerr's own app settings (connected media servers, discovery sliders,
  notification agents) live in a plain `settings.json` file under
  `/app/config` — regardless of database backend.
- **`DB_PASS`, not `DB_PASSWORD`.** Seerr's TypeORM datasource reads a
  specifically-named `DB_PASS` environment variable. This module sets
  `db_password_env_var_name = "DB_PASS"` to match.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Seerr workload

- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL — request/user data

- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  ```

### C. Storage — Cloud Storage or a block PVC

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~seerr"
  kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~seerr"
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

## 3. Seerr Application Behaviour

- **No first-deploy database-schema job.** Seerr's `dist/index.js` calls
  `dbConnection.runMigrations()` explicitly on every pod boot, so there is no
  init job in this module and none is needed. `initialization_jobs` is empty
  by default.
- **First-run setup is entirely in the app's own web UI.** There is no seeded
  admin credential of any kind — connect to the service and complete Seerr's
  setup wizard: media server first, then Sonarr/Radarr.
- **Health path.** Startup and liveness probes both target `GET /api/v1/status`.
- **Inspect job execution (should show nothing, by design):**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  ```

### ⚠ The GCS-FUSE UID/GID bug — the GKE-specific gotcha this module fixes

Seerr's container runs as `uid=1000/gid=1000` (the `node` user — confirmed
via `docker run ghcr.io/seerr-team/seerr id`), and on first boot attempts
`mkdir '/app/config/logs/'`.

- **On Cloud Run**, the platform's own gcsfuse integration automatically
  applies `uid:1000/gid:1000` to the mounted volume, so this works with no
  extra configuration.
- **On GKE**, the **GCS FUSE CSI driver does not default to a writable UID.**
  A bare `gcs_volumes` mount is root-owned, and the non-root container
  crash-loops with `EACCES: permission denied`.

`Seerr_Common` fixes this by setting explicit `mount_options` on the storage
volume it declares for `/app/config`:

```hcl
mount_options = [
  "implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s",
  "uid=1000", "gid=1000", "file-mode=0664", "dir-mode=0775",
]
```

This is a known bug class in this catalogue — the same shape of failure was
previously found and fixed on Paperless, CodeServer, and CloudBeaver's GKE
variants (see the repository `CLAUDE.md`'s "GKE gcsfuse UID/GID permission
denied" finding). Seerr is the latest confirmed instance, now fixed at the
`Seerr_Common` layer so both Application Modules inherit the fix uniformly.

**Diagnostic tell**, if you ever see this symptom on a fork of this module:

```bash
kubectl describe pod -n "$NAMESPACE" <seerr-pod>
# Look for: EACCES: permission denied, mkdir '/app/config/logs/'
```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Seerr are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `seerr` | Base name for resources. |
| `application_display_name` | `Seerr` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Pulled directly as the `ghcr.io/seerr-team/seerr` image tag — no build step involved. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `5055` | Confirmed via local `docker run` and live deployment; the K8s Service and probes must all agree on this value. |
| `container_image_source` | `prebuilt` | Seerr only supports the official image; `Seerr_Common` also hardcodes this internally. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | See §6 below. |

### Group 31 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | `settings.json` is small, whole-file JSON state — safe on a GCS FUSE volume at `max_instance_count = 1`, so a block PVC is optional here, unlike WAL-mode-SQLite apps in this catalogue. |
| `stateful_pvc_mount_path` | `/app/config` | Matches the GCS FUSE default mount path. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` — `settings.json` has no high-IOPS need. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Required — Seerr has no non-Postgres path. |
| `application_database_name` / `application_database_user` | `seerr` / `seerr` | Forwarded to `Seerr_Common`, injected as `DB_NAME`/`DB_USER`. |
| `db_password_env_var_name` | `DB_PASS` | **Critical** — Seerr's datasource reads `DB_PASS` specifically, not the Foundation's default `DB_PASSWORD`. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Empty and typically stays that way — `dbConnection.runMigrations()` runs on every pod boot inside the app itself. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `gcs_volumes` | `[]` | The permission-corrected `storage` bucket mount at `/app/config` is added automatically (see §3); use this for *additional* volumes only. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` (via `Seerr_Common`) | Unauthenticated `200` JSON status endpoint; the variant's own `variables.tf` default (HTTP `/`) is superseded by `Seerr_Common`'s more accurate default. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Cloud SQL instance and Seerr database identifiers. |
| `storage_buckets` | The `storage` bucket backing `/app/config` (unused as a mount if `stateful_pvc_enabled = true`). |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `DB_TYPE` environment variable | Leave `Seerr_Common`'s default (`postgres`) untouched | **Critical** | Missing/overridden `DB_TYPE` silently drops Seerr onto a per-pod SQLite file wiped on every restart. |
| GCS FUSE `mount_options` on `/app/config` | Leave `Seerr_Common`'s `uid=1000`/`gid=1000` fix in place | **Critical** | Without it, the pod crash-loops with `EACCES: permission denied` on first boot — a GKE-only failure mode not seen on Cloud Run. |
| `db_password_env_var_name` | Leave at `DB_PASS` | **Critical** | Seerr's TypeORM datasource only reads `DB_PASS`; the Foundation's default `DB_PASSWORD` alone is never read. |
| `max_instance_count` | Set `1` if settings changes must never race | Medium | `settings.json` is a single mutable file — concurrent writers from multiple pods risk a lost write. The module default is `5`, looser than the single-writer-safe value. |
| `stateful_pvc_enabled` | Leave `false` unless you have a specific reason for block storage | Low | `settings.json` doesn't need POSIX file locking the way a WAL-mode SQLite app would; GCS FUSE is an appropriate default here, unlike apps that genuinely require a real block device. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Seerr-specific
application configuration shared with the Cloud Run variant is described in
**[Seerr_Common](Seerr_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Seerr on GKE Autopilot](../labs/Seerr_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Seerr on Google Cloud Run](Seerr_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Seerr Common — Shared Application Configuration](Seerr_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Jellyfin on GKE Autopilot](Jellyfin_GKE.md), [Prowlarr on GKE Autopilot](Prowlarr_GKE.md), [Jellystat on GKE Autopilot](Jellystat_GKE.md), [Homepage on GKE Autopilot](Homepage_GKE.md) in the **Media Server** solution.
