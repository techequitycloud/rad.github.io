---
title: "Netdata on GKE Autopilot"
description: "Configuration reference for deploying Netdata on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Netdata on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netdata_GKE.png" alt="Netdata on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Netdata is an open-source, real-time performance and health monitoring agent
that collects thousands of per-second metrics (CPU, memory, disk, network,
containers, services) with zero configuration and visualises them on a
built-in interactive web dashboard. It is written in C for minimal overhead
and exposes a REST API for querying collected data. This module deploys
Netdata on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Netdata uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Netdata runs as a single Kubernetes workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | A single Netdata pod on port `19999`, 1 vCPU / 1 GiB by default |
| Database | None | `database_type = "NONE"` — Netdata keeps its own internal metrics database (dbengine) on disk; no Cloud SQL instance is created |
| File persistence | Per-pod block PVC (default) | `stateful_pvc_enabled = true` provisions a 20Gi `standard-rwo` (SSD) PVC at `/var/lib/netdata`; Cloud Filestore (NFS) is available but off by default |
| Object storage | Cloud Storage | A `storage` bucket is always provisioned, but only mounted at `/var/lib/netdata` via GCS FUSE when the block PVC is disabled |
| Secrets | Secret Manager | Optional `NETDATA_ADMIN_PASSWORD` (off by default) — Netdata's local dashboard has no built-in login |
| Ingress | Kubernetes Service (`ClusterIP` by default) | Optional custom domain via Kubernetes Gateway; `LoadBalancer`/`NodePort` available |

**Sensible defaults worth knowing up front:**

- **No database.** Netdata is not backed by Cloud SQL — all state (the
  dbengine metrics store, alarm/health log, and configuration) lives on the
  mounted persistent volume. The GKE variant hard-forwards
  `enable_cloudsql_volume = false` and there is no `db-init` job.
- **Block-storage PVC is the default persistence mechanism.**
  `stateful_pvc_enabled = true` (and, since no `workload_type` is set, this
  auto-resolves the workload to a **StatefulSet** — see "StatefulSet
  auto-select" in the repository conventions). The PVC uses the `standard-rwo`
  (SSD-backed) StorageClass by default, sized `20Gi`, mounted at
  `/var/lib/netdata`. Real block-device semantics are required because
  Netdata's dbengine files are corrupted by GCS FUSE.
- **The GCS `storage` bucket is created either way but only mounted as a
  fallback.** `Netdata_GKE`'s `main.tf` sets
  `enable_gcs_storage_volume = !stateful_pvc_enabled`, so with the PVC
  default (`true`) the GCS FUSE mount is skipped to avoid a double-mount at
  the same path. Disable `stateful_pvc_enabled` to fall back to the GCS
  bucket instead of a block PVC.
- **Redis is force-disabled.** `Netdata_GKE`'s `main.tf` hardcodes
  `enable_redis = false` in the call to `App_GKE`, overriding the
  variable's own default of `true` — Netdata does not use Redis.
- **Single replica by default.** `min_instance_count = 1`,
  `max_instance_count = 1`. Netdata writes its metrics database to one PVC;
  running multiple replicas against the same volume is not supported.
- **No built-in authentication.** Netdata's local dashboard is
  unauthenticated by default — anyone who can reach the Service can view all
  collected metrics. The optional `enable_admin_password` secret does not
  configure Netdata's own login; it generates a stable credential for an
  operator-managed reverse proxy or Netdata Cloud claim flow layered in
  front of it.
- **`service_type` defaults to `ClusterIP`** (internal-only), so the
  dashboard is not reachable from outside the cluster until you change
  `service_type` or configure a custom domain via `enable_custom_domain`
  (which itself defaults `true` but has no effect until `application_domains`
  is populated).
- **Image is a thin custom build.** `Netdata_Common` ships a minimal
  `Dockerfile` (`FROM netdata/netdata:${NETDATA_VERSION}`) purely so the
  foundation can mirror the upstream image into Artifact Registry;
  `application_version = "latest"` pins the build to a known-good tag
  (`v2.2.6`) via the app-specific `NETDATA_VERSION` build ARG.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Netdata workload

Netdata runs as a single pod scheduled on Autopilot, which bills for the
CPU/memory the pod actually requests. With the default `stateful_pvc_enabled
= true`, the workload is a **StatefulSet** with a stable pod identity and a
dedicated per-pod PVC.

- **Console:** Kubernetes Engine → Workloads → select the Netdata workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the ClusterIP or external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent storage — block PVC (default) or NFS

Netdata's dbengine metrics store, alarm/health log, and configuration live
under `/var/lib/netdata`. By default this is a per-pod **block-storage PVC**
(`stateful_pvc_enabled = true`, `standard-rwo` StorageClass, `20Gi`) —
required because the dbengine's file format needs real block-device
semantics (GCS FUSE corrupts it). Cloud Filestore (NFS) is available as an
alternative shared mount (`enable_nfs`, default `false`) but is not the
recommended path for Netdata's own data files.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims;
  Filestore → Instances (only if NFS is enabled).
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for StatefulSet PVC provisioning, the
`stateful_pvc_storage_class` HDD/SSD tradeoff, and NFS discovery.

### C. Cloud Storage (fallback path)

A **Cloud Storage** bucket (suffix `storage`) is provisioned automatically
regardless of the PVC setting, and the workload service account is granted
access to it. It is only mounted into the pod (via GCS FUSE) when
`stateful_pvc_enabled = false`, as the fallback persistence mechanism for
`/var/lib/netdata`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~netdata"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Netdata has no mandatory generated secrets. The **only** optional secret is
`NETDATA_ADMIN_PASSWORD` (gated behind `enable_admin_password`, default
`false`) — a random 32-character value stored in Secret Manager and injected
as a native Kubernetes Secret (via `explicit_secret_values`, not the
Secret Store CSI/SecretSync path). It does not configure Netdata's own
authentication; it exists as a stable credential for an operator-side
reverse proxy or Netdata Cloud claim step.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~netdata-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed only inside the cluster
(`service_type = ClusterIP`). Set `service_type = LoadBalancer` for an
external IP, or configure `application_domains` (with
`enable_custom_domain`, default `true`) for Gateway-routed access with a
managed certificate.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available
(`uptime_check_config`, off by default; `alert_policies`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Netdata Application Behaviour

- **No initialization jobs by default.** `initialization_jobs` defaults to
  `[]` — Netdata bootstraps its own on-disk metrics database at first boot;
  there is no `db-init` or migration job to wait on. Custom jobs can be
  supplied for data loading/migration tasks if needed.
- **No first-run wizard / no login gate.** The dashboard is reachable and
  fully functional (subject to `service_type`/ingress) as soon as the pod is
  Ready — Netdata does not require an admin account to be created before use.
- **Health probes target `/api/v1/info`.** The startup probe
  (`startup_probe`: `initial_delay=15s`, `timeout=5s`, `period=10s`,
  `failure_threshold=10`) and liveness probe (`liveness_probe`:
  `initial_delay=30s`, `timeout=5s`, `period=30s`, `failure_threshold=3`)
  are both HTTP `GET /api/v1/info`, unauthenticated. The same path is the
  default for the foundation-level `health_check_config`,
  `startup_probe_config`, and `uptime_check_config` variables.
  <!-- TODO: verify exact response body/status contract of /api/v1/info in the deployed image — variable descriptions reference it as Netdata's "dedicated liveness endpoint" but do not specify the payload. -->
- **Single-instance scaling.** `min_instance_count = 1` /
  `max_instance_count = 1` by default — the metrics database on the PVC is
  written by one process; do not scale beyond 1 without verifying Netdata's
  distributed/streaming configuration.
- **Image version pinning.** `application_version = "latest"` resolves to
  the pinned Dockerfile default `v2.2.6` at build time (the app-specific
  `NETDATA_VERSION` build ARG, not the generic `APP_VERSION` the foundation
  injects) — set an explicit version to track a different release.
- **Verify the running workload:**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- wget -qO- http://127.0.0.1:19999/api/v1/info
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 19999:19999
  # then browse http://127.0.0.1:19999
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Netdata are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `netdata` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `netdata/netdata` image tag used as the custom-build base; `latest` is pinned to a known-good tag (`v2.2.6`) at build time. |
| `enable_admin_password` | `false` | Generates a Secret Manager credential for an operator-side auth layer. Netdata's own dashboard remains unauthenticated regardless of this setting. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Raise for larger collection counts / longer retention. |
| `min_instance_count` | `1` | Keep at 1 to avoid cold starts. |
| `max_instance_count` | `1` | **Keep at 1** — one PVC, one writer. |
| `container_port` | `19999` | Fixed by `Netdata_Common`; this variable is informational only and is not forwarded to `App_GKE`. |
| `enable_cloudsql_volume` | `false` | Netdata has no Cloud SQL database — keep `false`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Internal-only by default; set `LoadBalancer` for a public IP. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves to StatefulSet because `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | No sticky routing needed with a single replica. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisions a per-pod block PVC — required so Netdata's dbengine files get real block-device semantics (GCS FUSE corrupts them). |
| `stateful_pvc_size` | `20Gi` | Size to hold your collection retention window plus overhead. |
| `stateful_pvc_mount_path` | `/var/lib/netdata` | Where Netdata persists its metrics DB, alarm log, and config. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Balanced-PD, SSD-backed. Draws the `SSD_TOTAL_GB` quota — override to `standard` (HDD) if quota-constrained; Netdata's write pattern does not require SSD IOPS. |
| `stateful_fs_group` | `3000` | Makes the PVC group-writable; Netdata runs as UID 1000 / GID 2000. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /api/v1/info` | Container-level probes wired through `Netdata_Common`. |
| `health_check_config` / `startup_probe_config` | HTTP `GET /api/v1/info` | Foundation-level probe configuration (same endpoint). |
| `uptime_check_config` | disabled, path `/api/v1/info` | Enable for an external `google_monitoring_uptime_check_config`, only useful once the Service is publicly reachable. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off by default — persistence is handled by the StatefulSet block PVC instead. Enable only if you need a shared NFS mount for a purpose other than Netdata's own dbengine data. |
| `nfs_mount_path` | `/mnt/nfs` | Not the same path as the PVC mount (`/var/lib/netdata`) — avoid pointing NFS at the PVC's path. |

### Group 15 — Redis (not used)

Netdata does not use Redis. `enable_redis` defaults `true` at the variable
level, but `Netdata_GKE`'s `main.tf` unconditionally forwards
`enable_redis = false` to `App_GKE`, so the variable's default is inert for
this module — no Redis connection is ever injected.

### Group 16 — Database Backend (not used)

`database_type` is fixed to `NONE` by `Netdata_Common`; no Cloud SQL
instance, database, or user is created. The `application_database_name`
(`netdatadb`) / `application_database_user` (`netdatauser`) and related
`db_*` variables are declared for foundation-variable-mirroring compatibility
only and have no effect.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Enables Gateway-based routing, but has no effect until `application_domains` is populated. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys, once `service_type = LoadBalancer` or a Gateway is in use. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when `service_type = LoadBalancer` and a static IP is reserved). |
| `service_url` | URL to reach Netdata. |
| `netdata_admin_password_secret_id` | Secret Manager secret ID for the admin-password credential; empty when `enable_admin_password = false`. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any user-supplied initialization jobs (none by default). |
| `statefulset_name` | Name of the StatefulSet (when `stateful_pvc_enabled = true`). |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values *and combinations* at plan time — a `StatefulSet` forced alongside a
> stateless setting, IAP with no authorized identities, `quota_memory_*`
> given as bare integers, an out-of-range `container_port`/
> `backup_retention_days`. `Netdata_GKE` additionally guards
> `min_instance_count <= max_instance_count` and IAP-enabled-without-OAuth-
> credentials at plan time (see `validation.tf`). Invalid configuration fails
> the **plan** with a clear, named error before any resource is created, so
> most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `service_type` (default `ClusterIP`) + `enable_admin_password` | Leave `enable_admin_password=false` internal-only, or add a reverse-proxy/auth layer before exposing externally | Critical | Netdata's dashboard has no built-in login; exposing it externally (`LoadBalancer`, or a configured custom domain) with no operator-added auth layer publishes all collected host/container metrics. |
| `stateful_pvc_enabled` | `true` | Critical | Disabling it falls back to GCS FUSE, which corrupts Netdata's dbengine metrics files — data loss / crash-looping. |
| `max_instance_count` | `1` | High | Netdata's dbengine is written by a single process against one PVC; scaling beyond 1 risks file corruption/lock contention. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Draws the tight `SSD_TOTAL_GB` regional quota; switch to `standard` (HDD) on quota-constrained projects — Netdata's write pattern does not need SSD IOPS. |
| `enable_nfs` | `false` (keep off) | Medium | NFS is not the supported path for Netdata's own data files (`/var/lib/netdata`); only enable it for an unrelated shared mount at a different path. |
| `application_version` | `latest` (→ pinned `v2.2.6`) | Medium | Pinning to an arbitrary tag that doesn't exist upstream fails the Cloud Build image mirror/build step. |
| `memory_limit` | `1Gi` (raise for large collection counts) | Medium | Netdata holds recent metrics in memory; undersizing causes OOM restarts under heavy collection load. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `enable_custom_domain` (default `true`) with empty `application_domains` | Populate `application_domains` or leave both alone | Low | `enable_custom_domain=true` alone has no effect until a domain is listed — not a functional risk, but can be confusing when auditing exposure. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Netdata-specific application configuration shared
with the Cloud Run variant is described in
**[Netdata_Common](Netdata_Common.md)**.
