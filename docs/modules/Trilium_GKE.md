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

## 1. Overview

Trilium runs as a single Node.js/Express pod on GKE Autopilot. The deployment wires
together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 1 vCPU / 1 GiB by default — but see scaling notes below |
| Database | None (embedded SQLite) | Trilium's entire document store is a single SQLite file, `document.db`, on the persistent volume |
| Object storage | Cloud Storage (default) or block PVC | GCS FUSE volume, or a StatefulSet PVC for larger note collections |
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
- **Block PVC recommended for larger note collections.** Set
  `stateful_pvc_enabled = true` to avoid GCS FUSE I/O overhead/locking quirks on the
  embedded SQLite file. The `stateful_pvc_storage_class` default is `"standard"`
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

Trilium runs as a single pod (Deployment by default, or a StatefulSet when
`stateful_pvc_enabled = true`). Because it must stay at exactly one replica, there
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
settings) lives under `/home/node/trilium-data`, mounted either via GCS FUSE
(default) or a StatefulSet block PVC (`stateful_pvc_enabled = true`, recommended
for larger note collections).

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
- **PVC vs GCS FUSE trade-off.** GCS FUSE (default) is simplest and needs no extra
  quota planning; a StatefulSet block PVC gives real POSIX file locking and lower
  I/O overhead for larger collections, at the cost of consuming regional disk
  quota (mitigated here by defaulting to HDD, not SSD).

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
| `stateful_pvc_enabled` | `null` | Recommended `true` for larger note collections — real POSIX file locking on the SQLite document.db. |
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
