---
title: "Prowlarr on GKE Autopilot"
description: "Configuration reference for deploying Prowlarr on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Prowlarr on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Prowlarr_GKE.png" alt="Prowlarr on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Prowlarr is the central **indexer manager** for the *arr media-automation
suite — Sonarr, Radarr, Lidarr, and Readarr all point at Prowlarr instead of
configuring indexers separately in each app; Prowlarr syncs indexer
configuration out to every connected app's own API. It is written in .NET,
part of the same Servarr codebase lineage as Sonarr/Radarr, and GPL-3.0
licensed. This module deploys Prowlarr on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

**This is the only platform variant of Prowlarr in this catalogue.** A
`Prowlarr_CloudRun` module was built, deployed, and diagnosed, then removed
entirely — see §3 for the full finding. There is no Cloud Run alternative to
fall back to; GKE is the only supported target.

This guide focuses on the cloud services Prowlarr uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Prowlarr runs as a single .NET process pod backed by an embedded SQLite
database. The deployment wires together a small, focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single .NET process pod, 1 vCPU / 1 GiB by default |
| Database | none | Prowlarr manages indexer/app-sync config in an embedded SQLite database (WAL mode) — no Cloud SQL instance is created |
| Object storage | a block PVC (default), or Cloud Storage | `stateful_pvc_enabled = true` by default — a real block PVC mounted at `/config`; a `storage` GCS bucket exists but is unused as a mount unless the PVC is disabled |
| Cache & queue | none | Prowlarr has no Redis or queue dependency (`enable_redis` hardcoded `false`) |
| Secrets | Secret Manager | **None generated** — Prowlarr has no built-in admin account and no encryption key to protect |
| Ingress | Cloud Load Balancing | External LoadBalancer once `service_type = "LoadBalancer"` is set; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database of any kind.** `Prowlarr_Common` fixes `database_type =
  "NONE"` — Prowlarr's only persistent state is its own embedded SQLite
  file.
- **Official image, unmodified.** `container_image_source = "prebuilt"`
  deploys `lscr.io/linuxserver/prowlarr` directly — no Dockerfile, no
  custom build, no entrypoint translation.
- **Block-storage PVC by default, not GCS FUSE.** `stateful_pvc_enabled =
  true` runs Prowlarr as a StatefulSet with a per-pod PVC mounted at
  `/config`. This is deliberate, not incidental — WAL-mode SQLite needs real
  POSIX file locking, which GCS FUSE does not reliably provide, and this
  catalogue has a documented history of GCS FUSE corrupting other WAL-mode
  SQLite apps (see UptimeKuma). `stateful_pvc_storage_class` defaults to
  `standard` (HDD `pd-standard`), **not** SSD — Prowlarr's config state is
  tiny with no high-IOPS need, so it draws from the much larger
  `DISKS_TOTAL_GB` regional quota instead of the tight `SSD_TOTAL_GB` quota.
- **Single instance, non-negotiable.** `min_instance_count = 1` and
  `max_instance_count = 1` — the embedded SQLite database is a single
  writer.
- **`service_type` needs an explicit override.** The variable's inherited
  Foundation default is `"ClusterIP"`; Prowlarr has a real web UI operators
  need to reach, so set `service_type = "LoadBalancer"` at deploy time.
- **No default login.** There is no generated secret and no built-in admin
  account — configure authentication (if wanted) from the web UI's
  **Settings → General → Security** after first deploy.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Prowlarr workload

- **Console:** GKE → Workloads → select the `prowlarr` StatefulSet for pod
  status, resource usage, and logs.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

### B. Storage — a block PVC (default) or Cloud Storage

- **Console:** Kubernetes Engine → Storage, or Cloud Storage → Buckets
  (filter by the tenant prefix).
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                                    # stateful_pvc_enabled = true (default)
  gcloud storage buckets list --project "$PROJECT" --filter="name~prowlarr"   # only mounted if the PVC is disabled
  ```

### C. Secret Manager

Prowlarr creates no secrets of its own, but the workload's Secret Manager
footprint (shared platform secrets, Workload Identity bindings) is still
worth checking if you add custom `secret_environment_variables`:

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~prowlarr"
  ```

### D. Networking & ingress

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  echo "$EXTERNAL_IP"
  ```

### E. Cloud Logging & Monitoring

- **Console:** Logging → Logs Explorer, filter
  `resource.type="k8s_container" resource.labels.namespace_name="<namespace>"`.
- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100 -f
  ```

---

## 3. Prowlarr Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — Prowlarr
  creates and migrates its own SQLite schema (`prowlarr.db`, WAL mode) at
  `/config` on first boot.
- **No default admin account.** Authentication is off until you enable it in
  the web UI (**Settings → General → Security**); there is no "admin/admin"
  or well-known first-login credential to change.
- **Health path.** Both the startup and liveness probes target `GET /ping`,
  which returns `200 {"status":"OK"}` unauthenticated. This is a real fix
  over this module's original clone source, which pointed both probes at
  `/api/health` (a path that does not exist on Prowlarr).
- **Inspect job execution** (only relevant if you supply custom
  `initialization_jobs` — none run by default):
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

### ⚠ Why there is no Cloud Run variant: s6-overlay vs. gVisor

This is the most consequential platform-specific finding for this module —
the result of three separate, systematic live diagnostic deploys that ruled
out storage and resources before concluding the root cause was the
container's own init system.

**The problem.** The official `lscr.io/linuxserver/prowlarr` image, like
every LinuxServer.io image, uses **s6-overlay** as PID 1 — a supervision
system that itself execs the application process after running its own
init sequence (permission fixups, service bootstrap, etc.). Cloud Run
executes containers inside **gVisor**, a user-space sandbox that intercepts
and emulates Linux syscalls. On Cloud Run, the Prowlarr container produced
**zero output** — not even the s6-overlay startup banner that normally
prints within milliseconds on any other platform — and Cloud Run reported
**"Application exec likely failed"** every time.

**How it was isolated.** Three live diagnostic deploys, changing one
variable at a time:

1. **Default configuration** — fails identically: no output, exec failure.
2. **With an added GCS volume** (in case the mount itself was the
   blocker) — fails identically.
3. **With increased CPU/memory** (in case s6-overlay's init sequence was
   simply timing out under tight resources) — fails identically.

All three attempts produced the exact same symptom with no variation,
ruling out storage and resource sizing as the cause and isolating the
failure to the init process itself being incompatible with the gVisor
sandbox — not a configuration mistake that could be fixed with different
inputs.

**The outcome.** `Prowlarr_CloudRun` was built, deployed, diagnosed, and
then **removed from the catalogue entirely** — the same disposition already
applied to Kopia, RocketChat, and LobeChat, each removed for its own
platform-level incompatibility rather than left in a permanently-broken
state. `Prowlarr_GKE` has no such restriction: GKE runs containers on real
Linux nodes (Autopilot's managed nodes), so s6-overlay execs exactly as it
does on any standard Docker host — confirmed live, pod reports `1/1
Running` and `/ping` returns `200` both internally
(`kubectl exec ... wget`) and externally once the LoadBalancer IP
provisions.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform.
Only settings specific to or notable for Prowlarr are listed; every other
input is inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `prowlarr` | Base name for resources. |
| `application_display_name` | `Prowlarr` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Passed straight through as the official image's tag — no custom build, so no version-pin build ARG exists. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys `lscr.io/linuxserver/prowlarr` directly. Correctly forwarded to `App_GKE` (unlike some prebuilt modules where this variable is inert). |
| `container_port` | `9696` | Fixed via `Prowlarr_Common`; not forwarded to `App_GKE` directly. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Both pinned at `1` — the embedded SQLite database is a single writer. |
| `enable_image_mirroring` | `true` | Mirrors the official image into Artifact Registry to avoid Docker Hub rate limits, even though the image itself is unmodified. |

### Group 6 — GKE Backend Configuration

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | **Override to `LoadBalancer`.** The inherited default is written with internal/database-style workloads in mind; Prowlarr has a real web UI that needs external reachability. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true` (the default) — no need to set both. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Deliberate default** — gives the embedded WAL-mode SQLite database real POSIX file locking, which GCS FUSE does not reliably provide. |
| `stateful_pvc_mount_path` | `/config` | Where Prowlarr keeps `prowlarr.db` and all other app state. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, not SSD — Prowlarr's config/SQLite state is small with no high-IOPS need; avoids the tight `SSD_TOTAL_GB` quota in favor of the much larger `DISKS_TOTAL_GB` quota. |
| `stateful_fs_group` | `3000` | Makes the PVC group-writable; Prowlarr runs as UID 1000 / GID 2000. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/ping` | The probes actually applied to the Pod (forwarded through `Prowlarr_Common`). Confirmed live: `200 {"status":"OK"}`, unauthenticated. |
| `startup_probe_config` / `health_check_config` | HTTP `/api/health` (stale) | **Inert for Prowlarr** — `App_GKE` always prefers the per-app `startup_probe`/`liveness_probe` above when a module supplies one, so these top-level variables never reach the Pod spec despite their stale-looking default. |
| `uptime_check_config` | `{ enabled = false, path = "/api/health" }` | **Not inert.** Disabled by default, but if you enable the Cloud Monitoring uptime check, override `path = "/ping"` — this variable is applied as-is, unlike the two above. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage` bucket | Provisioned but **unused as a mount** while `stateful_pvc_enabled = true` (the default) — the block PVC takes over `/config` instead. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Prowlarr_Common` — Prowlarr has no SQL database. |

### Group 19 — Custom Domain & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | The tested/reference deployment used `false` (ephemeral IP) after hitting the project's global static-IP quota ceiling — safe to leave `false` for Prowlarr, which bakes no self-referencing URL into its own configuration at boot. |

All other inputs follow standard App_GKE behaviour.

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `storage_buckets` | The `storage` bucket (unused as a mount while `stateful_pvc_enabled = true`). |
| `statefulset_name` | Name of the StatefulSet (the default workload type). |
| `kubernetes_ready` | Whether the workload reached Ready state. |
| `container_image` / `container_registry` | The deployed image reference and Artifact Registry repository. |

---

## 6. Configuration Pitfalls & Sensible Defaults

Plan-time validation catches the min/max scaling conflict, the IAP
credential requirement, and the StatefulSet/`workload_type` conflict before
apply — but several settings that pass validation still have a wrong-looking
or unsafe default worth knowing before you deploy.

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `service_type` | `LoadBalancer` | High | The inherited default is `ClusterIP` — Prowlarr's web UI is unreachable from outside the cluster until this is set explicitly. |
| Deploying on Cloud Run | Don't — use `Prowlarr_GKE` (the only supported variant) | Critical | The image's s6-overlay init process cannot exec inside Cloud Run's gVisor sandbox — confirmed via 3 diagnostic deploys, all failing identically with zero container output. There is no configuration fix; a `Prowlarr_CloudRun` module was built, tested, and removed for exactly this reason. |
| `stateful_pvc_enabled` | `true` (the default) | High | Disabling it falls back to a GCS FUSE mount at `/config`, which does not reliably support the POSIX file locking Prowlarr's WAL-mode SQLite database needs — this catalogue has a documented history of GCS FUSE corrupting other WAL-mode SQLite apps. |
| `stateful_pvc_storage_class` | Leave at `standard` (HDD) | Low–Medium | Switching to `standard-rwo`/`premium-rwo` (SSD) draws from the far tighter `SSD_TOTAL_GB` quota for no real benefit — Prowlarr's config-file I/O pattern doesn't need SSD IOPS. |
| `max_instance_count` | Leave at `1` | Critical | The embedded SQLite database is a single writer; raising this risks database corruption. |
| `uptime_check_config.path` | Override to `/ping` if enabling uptime checks | Medium | The variable's default `path` is a stale `/api/health` left over from this module's clone source — unlike `startup_probe`/`liveness_probe`, this one is *not* overridden elsewhere, so an uptime check enabled with the default path will fail against a path that doesn't exist. |
| Authentication | Enable it from the web UI's Settings → General → Security after first deploy | High | Prowlarr ships with no built-in admin account and no generated secret — an internet-reachable, unauthenticated instance is exposed by default until you configure it. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Prowlarr-specific application configuration is described in
**[Prowlarr_Common](Prowlarr_Common.md)**.
