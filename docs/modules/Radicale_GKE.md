---
title: "Radicale on GKE Autopilot"
description: "Configuration reference for deploying Radicale on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Radicale on GKE Autopilot

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

## 1. Overview

Radicale runs as a single Python WSGI pod. The deployment wires together a
small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Python process pod, 1 vCPU / 1 GiB by default |
| Database | none | Radicale stores every collection as plain files — no Cloud SQL instance is created |
| Object storage | Cloud Storage, or a block PVC | `storage` GCS bucket by default; `stateful_pvc_enabled = true` swaps in a real block PVC (recommended for production) |
| Cache & queue | none | Radicale has no Redis or queue dependency |
| Secrets | Secret Manager | A real generated `ADMIN_PASSWORD` — Radicale ships with no default admin account at all |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database of any kind.** `Radicale_Common` fixes `database_type =
  "NONE"` — Radicale is a pure filesystem store.
- **Custom, thin-wrapper build.** `Radicale_Common` layers a cloud entrypoint
  onto the official `ghcr.io/kozea/radicale` image via Cloud Build, then
  mirrors the result into Artifact Registry.
- **Block-storage PVC recommended.** Set `stateful_pvc_enabled = true` (auto-
  resolves `workload_type` to `StatefulSet`) so Radicale's collections
  filesystem gets real POSIX file locking, which GCS FUSE does not reliably
  support. `stateful_pvc_storage_class` defaults to `standard` (HDD) rather
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
  but with `stateful_pvc_enabled = true` the default seed job's pre-created
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

- **With `stateful_pvc_enabled = true`** (the recommended production
  setting): the seed job's writes land in the otherwise-unused GCS bucket,
  and the "Default Calendar"/"Default Address Book" will **not** appear on
  the running pod's PVC-backed filesystem. This is harmless — create your
  first calendar via a real CalDAV client, or `curl -X MKCOL` (confirmed
  working), instead of expecting the pre-seeded defaults.
- **Without a PVC** (GCS-backed Deployment mode — not the recommended
  production configuration): the seed job's writes land in the same bucket
  the running pod mounts, so the defaults do appear.

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
| `stateful_pvc_enabled` | `null` | **Recommended `true`** for production — gives Radicale's collections filesystem real POSIX file locking. Auto-resolves `workload_type` to `StatefulSet`. |
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
| `stateful_pvc_enabled` | `true` for production | Medium | Without it, `/var/lib/radicale` is GCS FUSE-backed — acceptable given the single-instance cap, but not a real POSIX-locking filesystem. |
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
