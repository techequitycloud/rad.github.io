---
title: "Calibre-Web on GKE Autopilot"
description: "Configuration reference for deploying Calibre-Web on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Calibre-Web on GKE Autopilot

Calibre-Web is a clean, self-hosted web app for browsing, reading and downloading
ebooks from an existing Calibre library — it serves an in-browser reader, an OPDS
feed, user management and Kobo sync on top of the upstream LinuxServer.io
`calibre-web` image. This module deploys Calibre-Web on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure; `CalibreWeb_GKE` is a thin wrapper that
supplies Calibre-Web's own configuration (image, ports, probes, storage wiring) and
forwards everything else straight through.

This guide focuses on the cloud services Calibre-Web uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Calibre-Web runs as a single, stateful workload. It has **no external database** —
all of its state (the application database, the Calibre library metadata database,
configuration, cache, and logs) lives in internal SQLite files under `/config`. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Calibre-Web pods on port 8083, 1 vCPU / 1 GiB by default |
| Workload type | Kubernetes **StatefulSet** | Auto-selected because `stateful_pvc_enabled = true` by default |
| Config/library persistence | GKE **block Persistent Volume** (`standard-rwo`, SSD-backed) | Mounted at `/config`; holds `app.db`, Calibre's `metadata.db`, config, cache, logs |
| Object storage | Cloud Storage | A `storage`-suffixed bucket is always provisioned, but is **not mounted** while the StatefulSet PVC is in use (see §2.C) |
| Secrets | Secret Manager | Auto-generated `CALIBRE_ADMIN_PASSWORD` — provisioned but **not** the credential Calibre-Web actually authenticates with on first login (see §3) |
| Database | None | `database_type = "NONE"`; no Cloud SQL instance, user, or `db-init` job |
| Ingress | Kubernetes Gateway API (when custom domain configured) or in-cluster `ClusterIP` | `service_type` defaults to `ClusterIP`, **not** `LoadBalancer` (see §2.E) |

**Sensible defaults worth knowing up front:**

- **Stateful, PVC-backed by default.** `stateful_pvc_enabled = true` and
  `workload_type` is left `null`, which auto-resolves to `StatefulSet` (per the
  App_GKE "StatefulSet auto-select" behaviour). A real block PVC is used instead of
  gcsfuse specifically because Calibre-Web's SQLite files (`app.db`,
  `metadata.db`) would be corrupted by GCS FUSE's relaxed consistency model.
- **The PVC storage class defaults to SSD (`standard-rwo`).** This draws from the
  regional `SSD_TOTAL_GB` quota, which is small on quota-constrained projects.
  Calibre-Web doesn't need SSD IOPS for its SQLite workload — consider overriding
  `stateful_pvc_storage_class = "standard"` (HDD `pd-standard`) to preserve SSD
  quota for other apps while keeping the block-device write-locking integrity
  SQLite needs.
- **Single replica by default.** `min_instance_count = 1`, `max_instance_count = 1`.
  Because the StatefulSet uses `volumeClaimTemplates`, each replica gets its **own,
  independent PVC** — scaling beyond 1 does not share `/config` across pods; it
  silently forks the library and config into separate, unsynchronised copies per
  pod. Do not raise `max_instance_count` without an external synchronisation
  strategy.
- **No database.** `database_type = "NONE"`; there is no `db-init` job and none of
  the database-related variables in this module are referenced.
- **No Redis.** `enable_redis` is declared for foundation-variable mirroring but is
  **not forwarded** — `main.tf` hardcodes `enable_redis = false` to the Foundation
  call regardless of the variable's value.
- **`service_type` defaults to `ClusterIP`, not `LoadBalancer`.** Combined with the
  default `application_domains = []`, the deployment has **no external access
  configured out of the box** even though `enable_custom_domain = true` by default
  — the Gateway is provisioned but has no hostname to route until you supply
  `application_domains` or switch `service_type` to `LoadBalancer`.
- **The generated admin password is not the working login.** The upstream
  LinuxServer image ships a built-in default login (`admin` / `admin123`); the
  `CALIBRE_ADMIN_PASSWORD` Secret Manager secret is provisioned for a stronger
  credential but is not wired into the container automatically. Change the
  password in the Calibre-Web UI on first sign-in.
- **A Cloud Storage bucket is created but unused by default.** `create_cloud_storage
  = true` always provisions the `storage`-suffixed bucket, but it is only mounted
  at `/config` when `stateful_pvc_enabled = false` (Deployment mode). With the
  default StatefulSet/PVC path, the bucket exists but is not attached to the
  workload.
- **Image version is pinned via an app-specific build ARG.** The Dockerfile reads
  `CALIBREWEB_VERSION` (not the generic `APP_VERSION` the Foundation injects); when
  `application_version = "latest"` the build is pinned to a known-good `0.6.24`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Calibre-Web StatefulSet

Calibre-Web pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The workload runs as a `StatefulSet` (not a `Deployment`)
so it gets a stable pod identity and an ordered restart sequence
(`stateful_pod_management_policy` defaults to `OrderedReady` when left `null`).

- **Console:** Kubernetes Engine → Workloads → select the Calibre-Web workload for
  pods, revisions, and events.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and workload type selection
are managed.

### B. Block storage — the `/config` Persistent Volume Claim

Calibre-Web's SQLite files (`app.db`, Calibre's `metadata.db`), configuration,
cache, and logs live on a per-pod block PVC mounted at `/config`
(`stateful_pvc_mount_path`), sized `20Gi` by default
(`stateful_pvc_size`) on the `standard-rwo` (SSD `pd-balanced`) StorageClass
(`stateful_pvc_storage_class`).

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims; Compute
  Engine → Storage → Disks.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Because SSD PVCs draw the tight `SSD_TOTAL_GB` quota and scaling a stateful app to
zero **keeps** its PVC (only deleting the PVC/namespace reclaims the quota), verify
current usage before a wide campaign of stateful GKE apps. See [App_GKE](App_GKE.md)
for the StatefulSet and PVC lifecycle in general.

### C. Cloud Storage

A **Cloud Storage** bucket (suffix `storage`) is always provisioned when
`create_cloud_storage = true` (the default) and the workload service account is
granted access — but it is only **mounted** into the pod at `/config` via GCS FUSE
when `stateful_pvc_enabled = false` (i.e. when running as a `Deployment` instead of
the default `StatefulSet`). With the default configuration the bucket exists but is
not attached to the running workload.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

See [App_GKE](App_GKE.md) for GCS FUSE mounts and CMEK options.

### D. Secret Manager

One Calibre-Web secret is generated automatically and stored in Secret Manager:
`CALIBRE_ADMIN_PASSWORD` (a 24-character random value, `secret-<prefix>-<app>-admin-password`),
injected into the container as a secret environment variable. On GKE, secrets are
projected via the Secret Store CSI driver / SecretSync; the key has no `__`, so it
is a valid `targetKey`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Note: the injected secret is not automatically applied as the Calibre-Web login —
see §3 for the actual first-login credentials. See [App_GKE](App_GKE.md) for the
Secret Store CSI integration and rotation.

### E. Networking & ingress

`service_type` defaults to **`ClusterIP`** (internal-only), and
`enable_custom_domain = true` by default provisions a Kubernetes Gateway API
resource — but with the default empty `application_domains = []` there is no
hostname for the Gateway to route, so the deployment has **no external access
configured out of the box**. To expose Calibre-Web externally, either set
`application_domains` to a real hostname, or switch `service_type` to
`LoadBalancer` (which additionally picks up the App_GKE default `<reserved-ip>.nip.io`
hostname when `reserve_static_ip = true`).

- **Console:** Network services → Load balancing / Gateways; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Uptime checks are disabled by default (`uptime_check_config.enabled = false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Calibre-Web Application Behaviour

- **No initialization job by default.** `initialization_jobs` defaults to `[]`;
  Calibre-Web manages its own SQLite storage and needs no database bootstrap
  (there is no `db-init` job because `database_type = "NONE"`). Only user-supplied
  jobs run.
- **Thin-wrapper image, no custom entrypoint.** The Dockerfile is
  `FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}` with no added
  entrypoint script — the upstream LinuxServer s6-based init runs unchanged.
  `image_source = "custom"` is set purely so the Foundation builds/mirrors the
  image into Artifact Registry.
- **First-boot storage layout.** The LinuxServer image drops privileges to
  `PUID=1000`/`PGID=1000` and keeps all state under `/config`
  (`app.db`, Calibre's `metadata.db`, config, cache, logs); the ebook library
  itself lives under `/books` (empty on first run — the in-app setup wizard points
  Calibre-Web at it). `stateful_fs_group` defaults to `3000` (the CalibreWeb Helm
  chart convention) so the PVC is group-writable.
- **Login credentials.** The upstream image's built-in first-login credentials are
  `admin` / `admin123`. The Secret-Manager-generated `CALIBRE_ADMIN_PASSWORD` is
  **not** applied automatically — it exists so a strong password is available in
  Secret Manager and so a future image/entrypoint can consume it. Change the admin
  password in the Calibre-Web UI immediately after first sign-in.
- **Health probes.** Both the startup and liveness probes issue an **HTTP GET `/`**
  (Calibre-Web's login page), which returns `200` with no authentication required —
  so probes pass as soon as the server is serving, independent of any login state.
  Startup: `initial_delay=15s`, `timeout=5s`, `period=10s`, `failure_threshold=10`.
  Liveness: `initial_delay=30s`, `timeout=5s`, `period=30s`, `failure_threshold=3`.
- **Scaling constraint.** `min_instance_count = 1` / `max_instance_count = 1` by
  default. Because the StatefulSet provisions a distinct PVC per replica
  (`volumeClaimTemplates`), raising `max_instance_count` does **not** give pods a
  shared library — each pod gets its own independent, unsynchronised `/config`.
- **Verify the deployment:**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /config
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Calibre-Web are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `calibreweb` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `lscr.io/linuxserver/calibre-web` tag used as the custom-build base; `latest` is pinned to a known-good tag (`0.6.24`) at build time via the app-specific `CALIBREWEB_VERSION` build ARG. |
| `application_display_name` | `Calibre-Web` | Human-readable name for display purposes. |
| `description` | `Calibre-Web — a web app for browsing, reading and downloading ebooks from a Calibre library.` | Populates the GKE workload description. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Memory limit for the Calibre-Web container. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Keep at 1 — see §3 scaling constraint (per-replica PVC forking). |
| `container_port` | `8083` | Fixed by `CalibreWeb_Common`; the module variable is not forwarded to App_GKE and has no effect. |
| `enable_cloudsql_volume` | `false` | Correctly left off — Calibre-Web does not use Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirrors the image into Artifact Registry to avoid Docker Hub rate limits. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Internal-only by default — see §2.E for the ingress gotcha this creates in combination with `application_domains = []`. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolved because `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | No sticky routing by default (single replica makes this moot at default scale). |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisions a block PVC per pod — required because gcsfuse would corrupt Calibre-Web's SQLite files. |
| `stateful_pvc_size` | `20Gi` | Size for `/config` plus the Calibre library. |
| `stateful_pvc_mount_path` | `/config` | Where Calibre-Web stores its SQLite databases, config, cache, and logs. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Draws the regional `SSD_TOTAL_GB` quota. Calibre-Web's SQLite workload does not need SSD IOPS — consider `standard` (HDD `pd-standard`) to conserve SSD quota. |
| `stateful_fs_group` | `3000` | Matches the CalibreWeb Helm chart convention so the PVC is group-writable by `PUID:PGID=1000:1000`. |

### Group 9 — PodDisruptionBudget

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | On by default (unlike most modules). |
| `pdb_min_available` | `1` | With `max_instance_count = 1`, a PDB of `1` effectively blocks voluntary eviction of the sole pod until it can be rescheduled. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` (from `CalibreWeb_Common`) | HTTP `/` | Login page, `200`, no auth required — passes as soon as the server is serving. |
| `uptime_check_config.enabled` | `false` | Uptime checks are off by default. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is **not** used by Calibre-Web — persistence is via the StatefulSet PVC (or GCS FUSE in Deployment mode) instead. |
| `network_tags` | `["nfsserver"]` | Defaults to including the `nfsserver` tag even though NFS is disabled by default; harmless but only relevant if you separately enable NFS. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Always provisions the `storage`-suffixed bucket, but see §2.C — it is unmounted while `stateful_pvc_enabled = true` (the default). |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (declared) | **Inert** — `main.tf` hardcodes `enable_redis = false` on the Foundation call regardless of this variable's value. Calibre-Web does not use Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Declared for foundation-variable mirroring but **not forwarded** to App_GKE at all. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `CalibreWeb_Common`; no Cloud SQL instance, database, or user is created. All other `database_*`/`sql_*` variables in this group are explicitly "Not referenced." |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions the Gateway API resource, but does nothing externally useful without `application_domains` set (see §2.E). |
| `application_domains` | `[]` | Empty by default — set this to get a working external hostname while `service_type = ClusterIP`. |
| `reserve_static_ip` | `true` | Ties into the App_GKE default `<reserved-ip>.nip.io` hostname only when `service_type = LoadBalancer`; behaviour when combined with the default `ClusterIP` is not explicitly documented by the Foundation. <!-- TODO: confirm whether reserve_static_ip provisions/attaches an address when service_type stays ClusterIP with enable_custom_domain=true --> |

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
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved and `service_type = LoadBalancer`). |
| `service_url` | URL to reach Calibre-Web. |
| `calibreweb_admin_password_secret_id` | Secret Manager secret ID holding the generated `CALIBRE_ADMIN_PASSWORD` (see §3 for why this is not the initial login). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any user-supplied initialization jobs (none by default). |
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
| `max_instance_count` | `1` | Critical | Each StatefulSet replica gets its own PVC (`volumeClaimTemplates`) — scaling up forks `/config` into independent, unsynchronised copies per pod, not a shared library. |
| `stateful_pvc_enabled` | `true` (keep) | Critical | Switching to `false`/`Deployment` mode moves `/config` onto GCS FUSE, which can corrupt Calibre-Web's SQLite files (`app.db`, `metadata.db`) under its access patterns. |
| `service_type` + `application_domains` | Set `application_domains`, or use `LoadBalancer` | High | With the defaults (`ClusterIP` + empty `application_domains`), the deployment has **no external access configured** despite `enable_custom_domain = true`. |
| `stateful_pvc_storage_class` | `standard` (HDD) for quota-constrained projects | Medium | The default `standard-rwo` (SSD) draws the tight `SSD_TOTAL_GB` quota; a campaign of stateful GKE apps can exhaust it around app #8. Scaling to zero does **not** free the PVC — only deleting it does. |
| `CALIBRE_ADMIN_PASSWORD` (auto-generated) | Change the login in the UI on first sign-in | High | The generated secret is not applied automatically; the working first-login credential is the upstream default `admin`/`admin123` until changed manually. |
| `enable_resource_quota` | Understand before enabling | Medium | This module's `quota_cpu_*`/`quota_memory_*`/`quota_max_*` variables are declared but **not forwarded** to App_GKE — enabling the quota uses the Foundation's own defaults (4 CPU / 4Gi–8Gi memory / 20 pods), not any value set on this module. |
| `enable_redis` | Ignore — inert | Low | `main.tf` hardcodes `enable_redis = false` regardless of this variable; Calibre-Web has no Redis dependency. |
| `create_cloud_storage` | `false` if you don't need the fallback bucket | Low | With the default StatefulSet path the `storage` bucket is provisioned but never mounted — a small, avoidable cost if you don't plan to switch to Deployment mode. |
| `memory_limit` | `1Gi` (raise for large libraries) | Medium | Calibre-Web loads library/collection indexes into memory; undersizing risks OOM under a large Calibre library. |
| `quota_memory_requests` / `_limits` (foundation-level, if enabling quotas directly on App_GKE) | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Calibre-Web-specific application configuration shared across platform variants is
described in **[CalibreWeb_Common](CalibreWeb_Common.md)**.
