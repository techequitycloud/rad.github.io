---
title: "Kavita on GKE Autopilot"
description: "Configuration reference for deploying Kavita on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Kavita on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kavita_GKE.png" alt="Kavita on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kavita is a fast, feature-rich, self-hosted digital library and reading server for
comics, manga, and e-books — a clean web reading UI, OPDS feeds, collections,
reading lists, and full-text search over your library, built on .NET with an
internal SQLite database. This module deploys Kavita on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Kavita uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Kavita runs as a single .NET web workload with **no external database or cache** —
everything it needs (settings, its internal SQLite database, and the library index)
lives on disk under `/kavita/config`.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | .NET web pod on port 5000, `1000m` CPU / `1Gi` memory by default |
| Database | **None** — internal SQLite | `database_type` is fixed to `NONE` by `Kavita_Common`; no Cloud SQL instance is created |
| State persistence | Per-pod block PVC (StatefulSet) | `/kavita/config` holds the SQLite database (`kavita.db`) and app settings; **on by default** (`stateful_pvc_enabled = true`) |
| Object storage | Cloud Storage | A `storage` bucket is provisioned by `Kavita_Common`, but is only mounted at `/kavita/config` when the block PVC is disabled |
| Secrets | Secret Manager | **None generated** — the first-run setup wizard creates the admin account; `secret_ids`/`secret_values` are empty |
| Ingress | Kubernetes Gateway API | `ClusterIP` Service by default, exposed through the Gateway with a reserved static IP; custom domain supported |

**Sensible defaults worth knowing up front:**

- **SQLite lives on a real block PVC, not GCS FUSE.** `stateful_pvc_enabled` defaults
  to `true`, so Kavita runs as a `StatefulSet` with a per-pod block PVC mounted at
  `/kavita/config`. This is deliberate: gcsfuse corrupts SQLite/media indexes, so the
  GCS FUSE mount (`enable_gcs_storage_volume`) is only used as a fallback when the
  block PVC is turned off. If you ever set `stateful_pvc_enabled = false`, Kavita's
  SQLite database and library metadata move onto the GCS FUSE-backed `storage`
  bucket instead — do this only if you understand the SQLite-on-gcsfuse risk.
- **The `storage` GCS bucket is created either way but only mounted conditionally.**
  `Kavita_Common` always declares a `storage` bucket output, but the GKE wrapper sets
  `enable_gcs_storage_volume = !stateful_pvc_enabled`, so with the default block PVC
  in place that bucket exists but is **not** mounted into the pod.
- **Single replica by default, and it should stay that way.** `min_instance_count =
  1`, `max_instance_count = 1`. Kavita serves one shared SQLite library from one
  volume — there is no clustering or shared-storage coordination, so running more
  than one replica against the same PVC is unsafe.
- **NFS is off by default** (`enable_nfs = false`) — persistence is handled entirely
  by the StatefulSet PVC, not Filestore.
- **No first-boot database setup job.** Kavita has no `db-init`/migration job;
  `initialization_jobs` defaults to an empty list and only custom jobs you supply are
  run.
- **No auto-generated secrets.** Unlike most application modules, Kavita has no
  admin password or API key created in Secret Manager — the admin account is created
  through the web UI's first-run setup wizard the first time you open the service.
- **`session_affinity` is `None` and `service_type` is `ClusterIP`** — external access
  goes through the Gateway API (`enable_custom_domain = true` by default) rather than
  a directly exposed LoadBalancer Service.
- **Redis is forced off.** `App_GKE`'s foundation default for `enable_redis` is
  `true`, but `Kavita_GKE`'s `main.tf` hardcodes `enable_redis = false` — Kavita has
  no use for Redis and this cannot be overridden through the module's variables.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Kavita workload

Kavita runs as a `StatefulSet` by default (auto-selected because `stateful_pvc_enabled
= true`), giving each pod a stable identity and its own PVC. Because it is a
single-replica, single-writer SQLite app, do not scale it horizontally.

- **Console:** Kubernetes Engine → Workloads → select the Kavita workload for pods,
  revisions, and events.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app.kubernetes.io/name~kavita 2>/dev/null || \
    kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent storage — block PVC (SQLite + library metadata)

Kavita's config, its internal SQLite database (`kavita.db`), and library metadata
all live under `/kavita/config`, which by default is a **per-pod block Persistent
Volume Claim** (`stateful_pvc_enabled = true`, `stateful_pvc_size = "20Gi"`,
`stateful_pvc_storage_class = "standard-rwo"`). This is real block storage — not a
GCS FUSE mount — because gcsfuse corrupts SQLite and media index files.

- **Console:** Kubernetes Engine → Storage for the PVC; Compute Engine → Disks for
  the underlying persistent disk.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~kavita"
  ```

`standard-rwo` is SSD-backed (Balanced PD) and draws the project's `SSD_TOTAL_GB`
quota — see [App_GKE](App_GKE.md) and the repository's storage-class guidance for
how to move to HDD (`stateful_pvc_storage_class = "standard"`) if SSD quota is
tight. Losing this PVC loses the entire Kavita library index, settings, and
reading progress.

### C. Cloud Storage (the unmounted `storage` bucket)

`Kavita_Common` provisions a Cloud Storage bucket (suffix `storage`) regardless of
the storage layout in use. With the default block-PVC layout it is created but not
mounted; it is only mounted at `/kavita/config` via GCS FUSE when
`stateful_pvc_enabled = false`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~kavita"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse CSI driver mounts.

### D. Secret Manager

Kavita has **no generated secrets** — no admin password, API key, or signing key is
created by this module. Any custom secrets you configure via
`secret_environment_variables` still flow through Secret Manager and the Secret
Store CSI driver like any other GKE application module.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kavita"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload uses a `ClusterIP` Service (`service_type = "ClusterIP"`)
exposed externally through the Kubernetes Gateway API (`enable_custom_domain =
true`) with a reserved static IP (`reserve_static_ip = true`).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available (`uptime_check_config` is
disabled by default for this module).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Kavita Application Behaviour

- **No database bootstrap job.** Kavita manages its own SQLite storage entirely at
  runtime; `Kavita_Common` injects no `db-init`/migration job, and
  `initialization_jobs` defaults to `[]`.
- **First-boot setup wizard.** There is no seeded admin account or generated
  credential. Open the service URL — the first-run setup wizard walks through
  creating the initial administrator account and adding your first library.
- **Storage layout is controlled by `stateful_pvc_enabled`.** With the default
  `true`, Kavita runs as a `StatefulSet` and `/kavita/config` (config + SQLite
  `kavita.db`) is a block PVC (`stateful_pvc_size = "20Gi"`, storage class
  `standard-rwo`, `stateful_fs_group = 3000` so the volume is group-writable). If
  you disable it, `Kavita_Common` instead mounts the `storage` GCS bucket at the same
  path via GCS FUSE (`enable_gcs_storage_volume = true` in that case).
  `stateful_pod_management_policy` defaults to `null` (App_GKE's `OrderedReady`
  default), which is the safe setting for Kavita's single-writer restarts.
- **Single-writer, single replica.** `min_instance_count = 1` and
  `max_instance_count = 1` by default — Kavita has no distributed/clustering mode,
  so do not raise `max_instance_count` while a single PVC/SQLite database backs the
  workload.
- **Health probe paths.** Both the startup probe (`startup_probe` /
  `startup_probe_config`) and the liveness probe (`liveness_probe` /
  `health_check_config`) are **HTTP `GET /api/health`**, unauthenticated. The startup
  probe uses a longer failure budget (`initial_delay_seconds = 15`,
  `period_seconds = 10`, `failure_threshold = 10`) to tolerate slower first-boot
  library indexing before the liveness probe (`initial_delay_seconds = 30`,
  `period_seconds = 30`, `failure_threshold = 3`) takes over.
- **Redis is force-disabled.** `Kavita_GKE`'s `main.tf` sets `enable_redis = false`
  unconditionally when calling `App_GKE`, overriding the foundation's own
  `enable_redis = true` default — no `REDIS_HOST`/`REDIS_PORT` are ever injected.
- **Custom image build.** The container is built from a thin wrapper Dockerfile
  (`FROM jvmilazz0/kavita:${KAVITA_VERSION}`); `application_version = "latest"`
  resolves to the pinned `KAVITA_VERSION = 0.8.7` build argument (a version bump
  requires editing the pinned value in `Kavita_Common`, not just redeploying).
- **Verify the workload and PVC after deploy:**
  ```bash
  kubectl get statefulset,pvc,pods -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /kavita/config
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 5000:5000
  curl -s http://127.0.0.1:5000/api/health
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Kavita are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `kavita` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Kavita` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Kavita image tag; `latest` builds the pinned `KAVITA_VERSION = 0.8.7`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU limit for the Kavita container. |
| `memory_limit` | `1Gi` | Memory limit; Kavita is a lightweight .NET server, comfortable for large libraries. |
| `min_instance_count` | `1` | Kept at 1 to avoid cold starts during index loading. |
| `max_instance_count` | `1` | **Keep at 1** — Kavita has no clustering/shared-write support. |
| `container_port` | `5000` (fixed by `Kavita_Common`) | Not forwarded to `App_GKE`; the container always listens on 5000. |
| `enable_cloudsql_volume` | `false` | Kavita has no Cloud SQL — leave `false`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | External access goes through the Gateway API, not a direct LoadBalancer. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves to `StatefulSet` because `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | No sticky routing needed with a single replica. |

### Group 7 — StatefulSet / Block PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **On by default.** Provisions the per-pod block PVC that holds Kavita's config + SQLite database. |
| `stateful_pvc_size` | `20Gi` | Size for the config/library/SQLite volume; increase for large collections. |
| `stateful_pvc_mount_path` | `/kavita/config` | Must remain Kavita's data dir (config + `kavita.db`). |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD-backed Balanced PD; draws the `SSD_TOTAL_GB` quota. |
| `stateful_fs_group` | `3000` | Makes the PVC group-writable for Kavita's UID 1000 / GID 2000 process. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Required for safe restarts of the single-writer SQLite workload. |

### Group 15 — Redis (inert for Kavita)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (variable default) | **Overridden to `false`** in `Kavita_GKE`'s `main.tf` regardless of this value — Kavita never uses Redis. |
| `redis_host` / `redis_port` / `redis_auth` | — | Forwarded to the foundation for compatibility only; not applicable to Kavita. |

### Group 16 — Database (not applicable)

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Kavita_Common` — Kavita stores everything in internal SQLite, no Cloud SQL instance is created. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Gateway API ingress is on by default for Kavita. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |
| `enable_nfs` | `false` | Off by default — persistence is via the block PVC, not Filestore. |

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
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Kavita. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `storage` bucket, mounted only when `stateful_pvc_enabled = false`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom initialization jobs you supplied (none by default). |
| `statefulset_name` | Name of the StatefulSet (present since Kavita defaults to the StatefulSet workload type). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
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
| `stateful_pvc_enabled` | `true` (default) | Critical | Disabling it moves Kavita's SQLite database onto a GCS FUSE mount, which risks corrupting the SQLite file/library index under concurrent writes. |
| `stateful_pvc_mount_path` | `/kavita/config` | Critical | Must match Kavita's fixed data directory; changing it separates the app from its config/SQLite state. |
| `max_instance_count` | `1` | Critical | Kavita has no clustering or shared-write coordination; more than one replica against the same PVC risks SQLite corruption. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | SSD draws the tight `SSD_TOTAL_GB` quota; on a quota-constrained project, switch to HDD (`standard`) since Kavita's I/O needs don't require SSD IOPS. |
| `enable_nfs` | `false` | Low | NFS is unnecessary — persistence is via the block PVC; enabling it adds cost with no benefit for this module's default layout. |
| `enable_redis` | forced `false` in `main.tf` | Low | Setting this variable has no effect — Kavita never uses Redis regardless of the value passed. |
| `stateful_fs_group` | `3000` | High | Kavita runs as UID 1000/GID 2000; an incorrect or unset `fsGroup` can leave the PVC unwritable by the container at boot. |
| `memory_limit` | `1Gi` | Medium | Comfortable for large libraries; too low risks OOM during library scans or full-text indexing. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| First-run admin account | Complete the setup wizard promptly after deploy | Medium | Until the wizard runs, the service is reachable but has no admin account and no libraries configured. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and bookmarked OPDS URLs. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention; Kavita has no separate database backup path since its state is entirely on the PVC. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Kavita-specific application configuration shared with the Cloud Run variant is
described in **[Kavita_Common](Kavita_Common.md)**.
