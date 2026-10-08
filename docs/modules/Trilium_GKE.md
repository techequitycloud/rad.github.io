---
title: "Trilium on GKE Autopilot"
description: "Configuration reference for deploying Trilium on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Trilium on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_GKE.png" alt="Trilium on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (the actively maintained **TriliumNext** fork — not the archived
`zadam/trilium`) is an open-source, hierarchical, self-hosted note-taking
application with an embedded SQLite database. This module deploys Trilium on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Trilium uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## What Trilium costs on RAD, and how that compares

**Running Trilium on GKE Autopilot in your own Google Cloud project costs about US$42.08/month in Google Cloud charges** (about US$115.08 if this isn't your only Autopilot cluster), on top of a one-off 75-credit RAD module fee (US$7.50) charged once at deploy time — higher than the Cloud Run module's fee because this variant runs no shared NFS volume and instead relies on the pod's own storage. GKE Autopilot suits Trilium that must stay up or run beside other Kubernetes workloads; for the lowest cost, see the [Cloud Run guide](Trilium_CloudRun.md) instead. In a RAD-managed project the module fee drops to 67.5 credits (10% lower) — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 75 credits | 67.5 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | US$42.08/month, billed by Google at list price | ~67 credits/day (about 2010/month, US$201 at the top-up price), metered at list price plus RAD's margin |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project**

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 1 GiB | US$36.08 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$42.08** |


*The GKE cluster management fee is excluded from the total above because it is shared across every GKE app in the project — $0 if this is the only one, otherwise roughly $73/month split across however many you run.*

### How it compares

- Trilium (the TriliumNext fork) has no official hosted cloud version — it is distributed only as self-hosted software, so there is no vendor SaaS plan to compare against.
- A self-managed comparison, sized to Trilium's 1 vCPU / 1 GiB default: a Hetzner CPX11 or DigitalOcean 1 vCPU/2GB Droplet runs about $6-12/month, cheaper in cash terms than either RAD option here — plus your own time for backups, OS patching and TLS renewal.
- Most of this module's cost is the GKE Autopilot pod itself and its share of the cluster management fee; the lighter [Cloud Run variant](Trilium_CloudRun.md) avoids both.

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
scratch. That costs about 78-81 credits in your own project, or about
70.5-73.5 credits in a RAD-managed one.

Deleting only saves money once Trilium would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — about 6 days or more in your own project
(about US$1.40 a day), or about 1 days or more in a RAD-managed one
(67 credits a day).

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

Trilium runs as a single Node.js/Express pod on GKE Autopilot. The deployment wires
together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 1 vCPU / 1 GiB by default — but see scaling notes below |
| Database | None (embedded SQLite) | Trilium's entire document store is a single SQLite file, `document.db`, on the persistent volume |
| Persistent storage | Block PVC (default) | StatefulSet PVC at `/home/node/trilium-data`; set `stateful_pvc_enabled = false` to fall back to a GCS FUSE volume |
| Secrets | Secret Manager | None generated — Trilium has no env-var-driven credential |
| Ingress | Cloud Load Balancing | External LoadBalancer by default (Trilium is a browser-facing web UI) |

**Sensible defaults worth knowing up front:**

- **No database engine to manage.** `database_type = "NONE"` — there is no Cloud SQL
  instance, no connection string, and nothing to back up separately from the data volume.
- **Single-replica only.** `min_instance_count = max_instance_count = 1`. Trilium's
  embedded SQLite database has no multi-writer support — running more than one pod
  risks database corruption from concurrent writes.
- **`service_type = "LoadBalancer"` by default.** Trilium is a browser-facing web
  UI, so it is exposed externally out of the box (unlike database-style workloads,
  which default to `ClusterIP`).
- **No seeded credential.** Trilium has **no** env-var-driven auth bootstrap. On
  first visit, the app itself presents a "Set Password" screen; complete it before
  sharing the URL.
- **Health probe is `/api/health-check`, not `/`.** The root path (`/`) returns a
  302 redirect to the setup/login screen. Only `/api/health-check` returns an
  unauthenticated `200 {"status":"ok"}` — confirmed live via local container testing.
- **Block PVC by default.** `stateful_pvc_enabled = true` (the default) keeps the
  embedded SQLite file, which runs in WAL mode, off GCS FUSE — SQLite does not
  support WAL on a network filesystem. The `stateful_pvc_storage_class` default is `"standard"`
  (HDD `pd-standard`) — Trilium needs no SSD IOPS, and HDD draws from the much
  larger `DISKS_TOTAL_GB` quota instead of the tight `SSD_TOTAL_GB` quota.
- **`fsGroup`/`mount_options` set to 1000.** Trilium's container runs as the `node`
  user, uid/gid 1000 (confirmed via `docker run ... id node`); without matching
  ownership, the volume mounts root-owned and the app fails to boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Trilium workload

Trilium runs as a single pod (a StatefulSet by default, because
`stateful_pvc_enabled = true`; a Deployment if you turn the PVC off). Because it must stay at exactly one replica, there
is no meaningful horizontal autoscaling to observe.

- **Console:** Kubernetes Engine → Workloads → select the Trilium workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for Autopilot scaling and the workload type
(Deployment vs StatefulSet).

### B. Cloud Storage / block PVC — the Trilium data directory

The entire application state (SQLite `document.db`, attachments, revision history,
settings) lives under `/home/node/trilium-data`, on a StatefulSet block PVC by
default (`stateful_pvc_enabled = true`), or on a GCS FUSE volume if the PVC is
turned off.

- **Console:** Cloud Storage → Buckets (GCS FUSE mode); Kubernetes Engine → Storage
  (PVC mode).
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"          # GCS FUSE mode
  kubectl get pvc -n "$NAMESPACE"                             # PVC mode
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### C. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static IP
can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains and static IP details.

### D. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
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
  returns `200 {"status":"ok"}` once the HTTP server is listening.
- **Single-writer constraint.** Never raise `max_instance_count` above `1` — the
  embedded SQLite database is not safe for concurrent writers from multiple pods.
- **PVC vs GCS FUSE trade-off.** The block PVC (default) gives real POSIX file
  locking and the shared-memory mapping SQLite's WAL mode needs, at the cost of
  consuming regional disk quota (mitigated here by defaulting to HDD, not SSD).
  GCS FUSE needs no disk quota but is not a supported filesystem for SQLite WAL.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Trilium are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `trilium` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Docker image version tag; mapped to a pinned build ARG (`TRILIUM_VERSION`) internally. |
| `enable_password` | `false` | Reserved for parity with other single-user editor modules. **No effect** — Trilium has no env-var-driven password bootstrap. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod; Trilium is lightweight, raise only for very large note collections. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Keep both at 1** — no multi-writer support on the embedded SQLite database. |
| `enable_image_mirroring` | `true` | Mirror the Trilium image into Artifact Registry before deployment. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Trilium is a browser-facing web UI, exposed externally by default. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`, otherwise `Deployment`. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Keep `true` — real POSIX file locking and WAL support for the SQLite document.db. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size. |
| `stateful_pvc_mount_path` | `/home/node/trilium-data` | Container mount path. |
| `stateful_pvc_storage_class` | `standard` | HDD by default — no SSD IOPS need; keeps deployments off the tight `SSD_TOTAL_GB` quota. |
| `stateful_fs_group` | `1000` | Matches Trilium's uid/gid (the `node` user). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Not referenced — Trilium has no SQL database (embedded SQLite only). |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/api/health-check`, 30s delay | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check on `/api/health-check`. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Trilium. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Raising it risks concurrent writers corrupting the embedded SQLite database. |
| `stateful_fs_group` / GCS mount_options | `1000` | Critical | Wrong uid/gid mounts the data directory root-owned; the non-root Trilium process fails to boot. |
| First-visit "Set Password" step | Complete immediately | Critical | An un-set-password Trilium instance on a public LoadBalancer IP is reachable by anyone until the password is set. |
| `startup_probe` / `liveness_probe` path | `/api/health-check` | High | Pointing probes at `/` gets a 302 redirect, which most HTTP health checks treat as a failure, blocking the pod from ever becoming Ready. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Medium | `standard-rwo` (SSD) draws from the tight `SSD_TOTAL_GB` quota unnecessarily for a workload with no IOPS need. |
| `service_type` | `LoadBalancer` for normal use | Medium | Setting `ClusterIP` makes the note-taking UI unreachable from a browser without a port-forward. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Trilium-specific application configuration shared with
the Cloud Run variant is described in **[Trilium_Common](Trilium_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Trilium on GKE Autopilot](../labs/Trilium_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Trilium on Google Cloud Run](Trilium_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Trilium Common — Shared Application Configuration](Trilium_Common.md) — the configuration shared by both deployment targets.
