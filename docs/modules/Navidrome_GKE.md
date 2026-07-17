---
title: "Navidrome on GKE Autopilot"
description: "Configuration reference for deploying Navidrome on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Navidrome on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Navidrome_GKE.png" alt="Navidrome on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Navidrome is a free, open-source, self-hosted music streaming server written in Go.
It exposes a Subsonic/OpenSubsonic-compatible API (so any Subsonic client — DSub,
Symfonium, Sublime Music, play:Sub, etc. — can browse and stream your library) plus
its own web UI, and stores its state in an embedded **SQLite** database rather than
a managed SQL backend. This module deploys Navidrome on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Navidrome uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Navidrome runs as a single Go binary serving HTTP on one port. Because it has no
external database, the deployment wires together a narrower set of Google Cloud
services than a typical database-backed app:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | A `StatefulSet` pod on port `4533`, 1 vCPU / 1 GiB by default |
| Application data | Block-storage PVC (Persistent Disk, via `stateful_pvc_enabled`) | Backs the embedded SQLite DB, artwork cache, and search index at `/data` — **not** Cloud SQL |
| Music library | Operator-supplied GCS FUSE volume or Cloud Filestore (NFS) at `/music` | Read-only source audio files; not provisioned automatically |
| Object storage | Cloud Storage | A `storage` bucket is always created but sits **unmounted** while the default block PVC handles `/data` |
| Secrets | Secret Manager | An auto-generated admin password (`ND_DEVAUTOCREATEADMINPASSWORD`), injected as a native Kubernetes Secret |
| Ingress | Kubernetes Gateway API / ClusterIP | No `LoadBalancer` by default — internal-only until a custom domain or `service_type` change is configured |

**Sensible defaults worth knowing up front:**

- **No SQL database.** `database_type` is fixed to `NONE` by `Navidrome_Common`;
  every `db_*`/`database_*`/`sql_instance_*` variable in this module is forwarded
  to the foundation only for structural compatibility and has no effect.
- **SQLite needs a real block PVC, not `gcsfuse`.** Per this repository's storage
  convention, `gcsfuse` cannot safely back SQLite's write-locking model. GKE gives
  Navidrome a genuine advantage over the Cloud Run variant here: `stateful_pvc_enabled`
  defaults to **`true`**, provisioning a per-pod Persistent Disk mounted at `/data`
  (`ND_DATAFOLDER`) that holds the SQLite database, artwork cache, and search index.
  This auto-resolves the workload to a `StatefulSet`.
- **The PVC storage class defaults to `standard-rwo` (SSD Balanced PD).** This draws
  the tight `SSD_TOTAL_GB` regional quota documented in this repo's storage
  conventions. Navidrome's data directory is metadata/index-sized, not
  bulk-media-sized, so SSD is reasonable here — but on a quota-constrained project
  consider `-var stateful_pvc_storage_class=standard` (HDD `pd-standard`) if you hit
  `Quota 'SSD_TOTAL_GB' exceeded` across a wider campaign of stateful apps.
- **The music library is not mounted automatically.** `ND_MUSICFOLDER=/music` is set
  as an env var, but no volume is attached to `/music` out of the box — you must add
  a read-only GCS FUSE volume (`gcs_volumes`) or an NFS mount (`enable_nfs = true`,
  `nfs_mount_path = "/music"`) pointing at your source audio files. Unlike `/data`,
  `/music` is read-only and holds no SQLite state, so `gcsfuse` is fine for it.
- **Single replica by default.** `min_instance_count = 1`, `max_instance_count = 1`.
  Navidrome serves one shared SQLite library from one PVC; there is no
  multi-writer/clustering mode, so do not scale beyond 1.
- **No external ingress by default.** `service_type = "ClusterIP"` and
  `enable_custom_domain = true` but with an empty `application_domains` list — so
  out of the box Navidrome is reachable only inside the cluster/VPC. Set
  `application_domains` (Gateway + managed cert) or switch `service_type` to
  `LoadBalancer` to expose it externally.
- **Admin account is auto-created.** `enable_admin_password = true` generates a
  random password, stores it in Secret Manager, and injects it as
  `ND_DEVAUTOCREATEADMINPASSWORD` so Navidrome creates the `admin` user on first
  boot. Set it to `false` to use the first-run web setup wizard instead.
- **Health probes hit the public `GET /ping` endpoint** (returns
  `{"status":"ok"}`, no auth required).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Navidrome StatefulSet

With the default `stateful_pvc_enabled = true`, Navidrome deploys as a
`StatefulSet` (not a `Deployment`) so its single pod keeps a stable identity and a
PVC that survives reschedules. Autopilot bills for the CPU/memory the pod actually
requests.

- **Console:** Kubernetes Engine → Workloads → select the Navidrome workload for
  pods, revisions, and events. Confirm the workload type reads `StatefulSet`.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot scheduling and the
`StatefulSet`-vs-`Deployment` auto-resolution work in general.

### B. Block-storage PVC — the SQLite data volume

The per-pod PersistentVolumeClaim at `/data` is the single source of truth for
Navidrome: the SQLite database, the metadata/artwork cache, transcode temp files
(if enabled), and the search index all live here. Losing this PVC loses your
library metadata, playlists, ratings, and users (the source audio itself is
unaffected, since `/music` is a separate, operator-supplied mount).

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims and
  PersistentVolumes; Compute Engine → Disks to see the underlying Persistent Disk.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

See [App_GKE](App_GKE.md) Group 7 for the full `stateful_pvc_*` mechanics
(storage class, pod management policy, update strategy).

### C. Music library storage (GCS FUSE or NFS)

`/music` is where Navidrome scans for audio files. Nothing is mounted there by
default — wire up either a **read-only GCS FUSE volume** (`gcs_volumes`, CSI
driver-backed, fine here since `/music` holds no SQLite state) pointing at a bucket
of uploaded audio, or a **Cloud Filestore (NFS)** share (`enable_nfs = true`,
`nfs_mount_path = "/music"`) if you need write access from another host to add
files. A separate, always-created `storage` GCS bucket exists for compatibility
with the Cloud Run variant but sits unmounted while the block PVC serves `/data`.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~<service-name>"
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls /music
  ```

See [App_GKE](App_GKE.md) Groups 13–14 for NFS and GCS Fuse volume mechanics.

### D. Secret Manager

One secret is generated automatically: the admin password, stored under
`secret-<prefix>-navidrome-admin-password` and injected into the pod as a native
Kubernetes Secret (not via the Secret Store CSI driver) for the env var
`ND_DEVAUTOCREATEADMINPASSWORD`, which Navidrome reads on first boot to create the
`admin` account.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the general Secret Manager / Secret Store CSI
integration used by other apps' secrets.

### E. Networking & ingress

By default `service_type = "ClusterIP"` and `application_domains` is empty, so
Navidrome is reachable only from inside the VPC/cluster
(`http://<service>.<namespace>.svc.cluster.local`). Set `application_domains` (with
`enable_custom_domain = true`, already the module default) to provision a
Kubernetes Gateway with a managed TLS certificate, or switch `service_type` to
`LoadBalancer` for a plain external IP.

- **Console:** Kubernetes Engine → Services & Ingress; Network services → Load
  balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) Group 19 for the Gateway API, static IP, and default
`nip.io` hostname mechanics.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available (`uptime_check_config`
defaults to `false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Navidrome Application Behaviour

- **No init/migration job.** Navidrome has no external database, so there is no
  `db-init` or migration Job — the SQLite schema is created by the binary itself on
  first start against the empty `/data` PVC. `initialization_jobs` defaults to `[]`
  and is only for custom, operator-supplied tasks.
- **Admin bootstrap.** With `enable_admin_password = true` (default), the container
  starts with `ND_DEVAUTOCREATEADMINPASSWORD` set from the generated secret, and
  Navidrome auto-creates the `admin` user with that password on first boot. With
  `enable_admin_password = false`, the first person to open the web UI completes the
  setup wizard and chooses their own admin credentials — recommended only for
  cluster-internal, trusted-access deployments.
- **Immutable-ish PVC identity.** Because the pod is a `StatefulSet`, the PVC is
  bound to the pod's stable identity (`<service-name>-0`) and survives pod
  reschedules/restarts. Scaling `max_instance_count` beyond 1 is not supported —
  Navidrome has no multi-writer SQLite mode.
- **Health path.** Both the startup probe and the liveness probe are **HTTP**
  `GET /ping`, an unauthenticated endpoint returning `{"status":"ok"}`. Allow a few
  minutes on first boot while the library scan runs (large libraries take longer).
- **Library scan.** Navidrome scans `/music` on startup and on a periodic schedule
  thereafter; scan progress and results are visible in pod logs and the web UI.
- **Verify the running config and library mount:**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep ^ND_
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls /music
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=50 | grep -i scan
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Navidrome are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `navidrome` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `deluan/navidrome` image tag used as the custom-build base; `latest` is pinned to a known-good tag (`0.54.3`) at build time. |
| `application_display_name` | `Navidrome Music Server` | Human-readable name shown in the platform UI. |
| `enable_admin_password` | `true` | Auto-generates the admin password and creates the `admin` user on first boot via `ND_DEVAUTOCREATEADMINPASSWORD`. Set `false` to use the first-run web wizard instead. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU; raise for on-the-fly transcoding, which is CPU-bound. |
| `memory_limit` | `1Gi` | Navidrome holds its search index in memory; size to library scale. |
| `min_instance_count` | `1` | Keep at 1 — avoids cold starts during index/library loading. |
| `max_instance_count` | `1` | **Keep at 1.** No multi-writer SQLite support. |
| `enable_cloudsql_volume` | `false` | Navidrome has no Cloud SQL database — keep `false`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `workload_type` | `null` → `StatefulSet` | Auto-resolves to `StatefulSet` because `stateful_pvc_enabled = true`. |
| `service_type` | `ClusterIP` | Internal-only by default; no external IP unless changed or a custom domain is configured. |
| `session_affinity` | `None` | No sticky routing needed with a single replica. |

### Group 7 — StatefulSet / PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisions a real block PVC at `/data` — required so `gcsfuse` never backs the embedded SQLite DB. |
| `stateful_pvc_size` | `20Gi` | Sized for the SQLite DB, metadata cache, and search index (not the music library, which mounts separately). |
| `stateful_pvc_mount_path` | `/data` | Must match Navidrome's `ND_DATAFOLDER`. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD Balanced PD by default; switch to `standard` (HDD) if `SSD_TOTAL_GB` quota is constrained. |
| `stateful_fs_group` | `3000` | Matches the Navidrome Helm chart's UID 1000/GID 2000 convention, ensuring the PVC is group-writable. |

### Group 13 — NFS Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Enable and set `nfs_mount_path = "/music"` to mount a writable, shared music library via Cloud Filestore. |
| `nfs_mount_path` | `/mnt/nfs` | Not `/music` by default — must be overridden if using NFS for the library. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Always creates the `storage` bucket; it stays unmounted while the default block PVC serves `/data`. |
| `gcs_volumes` | `[]` | Add a read-only entry with `mount_path = "/music"` to source your library from GCS instead of NFS. |

### Group 16 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Navidrome_Common` — Navidrome has no SQL database; every other `database_*`/`sql_*` variable is inert. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions the Gateway resource, but has no effect until `application_domains` is non-empty. |
| `application_domains` | `[]` | Set to expose Navidrome externally via Gateway + managed certificate. |
| `reserve_static_ip` | `true` | Stable IP once external ingress (LoadBalancer or Gateway) is configured. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when `service_type = LoadBalancer` and a static IP is reserved). |
| `service_url` | URL to reach Navidrome. |
| `navidrome_admin_password_secret_id` | Secret Manager secret ID for the generated admin password (empty when `enable_admin_password = false`). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any operator-supplied initialization jobs. |
| `statefulset_name` | Name of the StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Disabling it (or otherwise backing `/data` with `gcsfuse`) risks corrupting SQLite's write-locking model — DB corruption, lost library metadata. |
| `stateful_pvc_storage_class` | `standard-rwo` (or `standard` under quota pressure) | High | SSD draws the tight `SSD_TOTAL_GB` regional quota; a wide campaign of stateful apps can exhaust it — switch to HDD `standard` if so. |
| `max_instance_count` | `1` | Critical | Navidrome has no multi-writer SQLite mode; scaling beyond 1 risks concurrent writes to the same PVC and DB corruption. |
| `/music` volume (`gcs_volumes` or `enable_nfs`) | Configure explicitly | High | Nothing is mounted at `/music` by default — the library scan finds no files and Navidrome serves an empty catalogue until a volume is added. |
| `enable_admin_password` | `true` for any externally reachable deployment | High | `false` leaves the first-run wizard exposed to whoever reaches the URL first — they become admin. |
| `application_domains` / `service_type` | Set one to expose externally | Medium | The default `ClusterIP` + empty `application_domains` leaves Navidrome reachable only inside the VPC — expected for internal use, surprising if you wanted public access. |
| `stateful_pvc_size` | `20Gi` (raise for very large libraries) | Medium | Undersizing risks the SQLite DB/cache/index filling the PVC on large libraries; the pod does not auto-expand storage. |
| `quota_cpu_requests` / `quota_memory_requests` / etc. | N/A | Low | These `quota_*` variables are declared but **not forwarded** to the foundation by this module — setting them has no effect; only `enable_resource_quota` is wired through (falling back to App_GKE's own quota defaults). |
| `memory_limit` | `1Gi` | Medium | Below ~512Mi the pod risks OOM while holding the search index in memory during a large library scan. |
| `stateful_fs_group` | `3000` | Medium | A mismatched `fsGroup` can leave the PVC unwritable by Navidrome's non-root UID, blocking DB writes at boot. |
| `backup_retention_days` | `7` (raise for prod) | Low | Too short for compliance retention of `/data` backups. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Navidrome-specific application configuration shared with the Cloud Run variant is
described in **[Navidrome_Common](Navidrome_Common.md)**.
