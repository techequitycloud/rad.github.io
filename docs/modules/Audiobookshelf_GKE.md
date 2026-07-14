---
title: "Audiobookshelf on GKE Autopilot"
description: "Configuration reference for deploying Audiobookshelf on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Audiobookshelf on GKE Autopilot

Audiobookshelf is a self-hosted audiobook and podcast server — it organises your audio library, streams to the web UI and the official mobile apps, and keeps per-user listening progress in sync. This module deploys Audiobookshelf on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Audiobookshelf uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics that are common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Audiobookshelf runs as a single Node.js workload on GKE Autopilot. Unusually for this catalogue, it needs **no external database, no Redis, and no application secrets** — the deployment footprint is deliberately small:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 1 vCPU / 1 GiB by default, single replica |
| Database | None | Audiobookshelf embeds its own SQLite database under `CONFIG_PATH` — no Cloud SQL |
| Persistent state | Persistent Volume Claim (block storage) | A StatefulSet PVC mounted at `/data`, backing both `CONFIG_PATH` and `METADATA_PATH` |
| Container image | Cloud Build + Artifact Registry | Thin wrapper built `FROM ghcr.io/advplyr/audiobookshelf` and mirrored into your registry |
| Secrets | Secret Manager | No application secrets — the admin user is created in the first-run web UI |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain |

**Sensible defaults worth knowing up front:**

- **No external database.** `database_type = "NONE"` and `enable_cloudsql_volume = false` are fixed by `Audiobookshelf_Common`; Audiobookshelf creates and migrates its internal SQLite database on first boot. No `db-init` job runs.
- **A real block PVC, not GCS FUSE, backs `/data`.** `stateful_pvc_enabled = true` by default — gcsfuse corrupts SQLite and the media file index, so Audiobookshelf requires a genuine block device. When the PVC is enabled, the variant automatically disables the GCS-FUSE storage volume at the same path (`enable_gcs_storage_volume = !stateful_pvc_enabled`) to avoid a double-mount conflict at `/data`. This is the key difference from `Audiobookshelf_CloudRun`, which has no PVC option and uses GCS FUSE instead.
- **`stateful_pvc_enabled = true` with no explicit `workload_type` resolves to `StatefulSet`.** One PVC per pod, provisioned from the `standard-rwo` (SSD, Balanced PD) StorageClass by default — see §6 for the SSD-quota implication.
- **One persistent mount covers everything.** `CONFIG_PATH = /data/config` (SQLite DB + app config) and `METADATA_PATH = /data/metadata` (cover art, cached metadata) are both redirected under the single `stateful_pvc_mount_path` (`/data`). Losing this PVC loses all Audiobookshelf state.
- **Single replica.** `min_instance_count = 1` and `max_instance_count = 1` — one shared SQLite library must be served by exactly one writer. Do not raise the maximum without verifying multi-writer safety (there is none).
- **Custom (thin-wrapper) image.** Cloud Build wraps the upstream `ghcr.io/advplyr/audiobookshelf` image so it is mirrored into Artifact Registry. The Dockerfile reads the app-specific `AUDIOBOOKSHELF_VERSION` build ARG (not the generic `APP_VERSION` the foundation injects); `application_version = "latest"` resolves to the pinned `2.17.0`.
- **No generated secrets.** The initial **root** user is created interactively in the first-run web UI, and API tokens are minted in the UI afterwards — `Audiobookshelf_Common` exposes empty `secret_ids`/`secret_values`.
- **Health probes target `/healthcheck`**, Audiobookshelf's unauthenticated 200 endpoint (startup: 15 s initial delay, 10-second period, 10 failures allowed; liveness: 30 s delay, 30-second period, 3 failures).
- **No Redis.** The variant's `main.tf` overrides the foundation's `enable_redis` default to `false` for this module.
- **Custom domain enabled by default.** `enable_custom_domain = true` (unlike most other GKE modules, which default this off) — supply `application_domains` to attach a hostname, or it falls back to the LoadBalancer IP.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Audiobookshelf StatefulSet

Audiobookshelf runs as a single-pod **StatefulSet** (the default resolved workload type when `stateful_pvc_enabled = true`), giving it a stable pod identity and an ordered restart — appropriate for a single-writer SQLite workload.

- **Console:** Kubernetes Engine → Workloads → select the Audiobookshelf workload for pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs StatefulSet) are managed.

### B. Persistent Volume Claim — the `/data` block storage

All Audiobookshelf state — the SQLite database, application config, cover art, and cached metadata — lives under `/data`, backed by a **block Persistent Volume Claim** provisioned per-pod by the StatefulSet. gcsfuse is explicitly avoided here because it corrupts SQLite and the media file index. Additional media libraries (for example a read-only audiobook bucket) can still be attached through `gcs_volumes` at a different mount path.

- **Console:** Kubernetes Engine → Workloads → select the workload → the Volumes/Storage tab. Compute Engine → Disks also lists the underlying Persistent Disk.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

See [App_GKE](App_GKE.md) §7 (StatefulSet / PVC) for StorageClass options, and §6 below for the SSD-quota pitfall.

### C. Cloud Build & Artifact Registry — the container image

The module builds a thin wrapper image `FROM ghcr.io/advplyr/audiobookshelf:${AUDIOBOOKSHELF_VERSION}` via Cloud Build and stores it in the tenant's Artifact Registry, insulating deploys from upstream registry rate limits and pinning the version.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project "$PROJECT"
  ```

### D. Secret Manager

Audiobookshelf itself needs no injected secrets — there is no database password, master key, or JWT secret. Secret Manager remains available for any custom `secret_environment_variables` you add. On GKE, secrets are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~audiobookshelf"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP (`service_type = ClusterIP` by default at the foundation level, but Audiobookshelf's ingress is normally reached via `enable_custom_domain = true` and a reserved static IP; set `service_type = LoadBalancer` for a direct external IP without a custom domain). A custom domain with a Google-managed certificate is enabled by default for this module.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional uptime checks and alert policies are available (uptime checks are disabled by default and only pass against a publicly reachable endpoint).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Audiobookshelf Application Behaviour

- **Self-contained first boot, no init job.** On first start Audiobookshelf creates its SQLite database and directory layout under `CONFIG_PATH`/`METADATA_PATH` — no init job, migration job, or database provisioning is involved. Because both paths sit under the persistent PVC mount, the database survives pod restarts and application-version upgrades. `Audiobookshelf_Common` injects no default `initialization_jobs`; custom jobs can still be supplied for one-off data loads.
- **First-run setup wizard.** Open the service URL (`/`) — Audiobookshelf prompts you to create the initial **root** user interactively. There is no environment-based admin bootstrap; API tokens are minted in the web UI afterwards (Settings → Users).
- **Single writer, single replica.** SQLite over a block PVC tolerates exactly one writer. The module pins `min_instance_count = 1` / `max_instance_count = 1`; a StatefulSet with `stateful_pod_management_policy = OrderedReady` further ensures pods are not started concurrently during scaling events.
- **Health endpoint.** `/healthcheck` returns HTTP 200 unauthenticated once the server is ready; it backs the **HTTP** startup probe (15 s initial delay, 10-second period, up to 10 failures ≈ 115 s of first-boot grace) and the **HTTP** liveness probe (30 s initial delay, 30-second period, 3 failures). The web UI is at `/`.
- **Scaling constraints.** As a StatefulSet with a single-writer SQLite backend, do not scale beyond 1 replica. The default `stateful_update_strategy` and `stateful_pod_management_policy` (both `null` → foundation defaults of `RollingUpdate`/`OrderedReady`) are adequate at replica count 1; they only matter if you experiment with more than one pod, which is not supported by the application.
- **Verification CLI:**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  SERVICE=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[?(@.metadata.labels.application=="audiobookshelf")].metadata.name}')
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- wget -qO- http://localhost:80/healthcheck
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 8080:80
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthcheck   # expect 200
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Audiobookshelf are listed; every other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `audiobookshelf` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `ghcr.io/advplyr/audiobookshelf` image tag used as the custom-build base; `latest` resolves to the pinned `2.17.0` via the app-specific `AUDIOBOOKSHELF_VERSION` build ARG. |
| `application_display_name` | `Audiobookshelf Vector Database` | Human-readable display name. <!-- TODO: confirm whether this default string is intentional; it reads as leftover copy from a different (vector-database) module template rather than an audiobook/podcast server. --> |
| `description` | `Audiobookshelf Vector Database — high-performance similarity search for AI applications` | Workload description. <!-- TODO: same leftover-template concern as application_display_name — this text does not describe Audiobookshelf's actual audiobook/podcast server function. --> |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU per pod. Library scans are CPU-bound — size up for large imports. |
| `memory_limit` | `1Gi` | Memory per pod; size up for large libraries. |
| `min_instance_count` | `1` | Keep at 1 to avoid cold starts during library/index loading. |
| `max_instance_count` | `1` | **Keep at 1** — one SQLite library, one writer. |
| `container_port` | `80` | Audiobookshelf's HTTP port (fixed by `Audiobookshelf_Common`; this variable is not itself forwarded to App_GKE). |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — keep `false`; Audiobookshelf does not use it. |
| `enable_image_mirroring` | `true` | Mirror the upstream image into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Kubernetes Service type; set `LoadBalancer` for a direct external IP. |
| `workload_type` | `null` → `StatefulSet` (via `stateful_pvc_enabled = true`) | Recommended for Audiobookshelf's stable pod identity and ordered restarts. |
| `session_affinity` | `None` | Single-replica deployment, so sticky sessions are not required. |
| `network_tags` | `["nfsserver"]` | Foundation-inherited default; Audiobookshelf does not use NFS, so this tag has no practical effect unless `enable_nfs` is also enabled. |

### Group 7 — StatefulSet / PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Required — gcsfuse corrupts Audiobookshelf's SQLite database and media file index, so a real block PVC backs `/data`. |
| `stateful_pvc_size` | `20Gi` | Size to hold the full audio library index plus overhead (the PVC holds config/metadata, not necessarily raw audio files if those are mounted separately via `gcs_volumes`). |
| `stateful_pvc_mount_path` | `/data` | Both `CONFIG_PATH` (`/data/config`) and `METADATA_PATH` (`/data/metadata`) live under this mount. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD, Balanced PD) | See §6 — consider `standard` (HDD) to avoid exhausting the `SSD_TOTAL_GB` quota; Audiobookshelf's SQLite/media workload does not need SSD IOPS. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Required for safe restarts of a single-writer workload. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | Only matters if replica count is (unsupportedly) raised above 1. |
| `stateful_fs_group` | `3000` | Matches the Audiobookshelf Helm chart's fsGroup convention (the app runs as UID 1000/GID 2000) so the PVC is group-writable. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not used by default — Audiobookshelf's state lives on the block PVC, not NFS. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisions the Common module's `storage` bucket; unused for the primary `/data` mount when `stateful_pvc_enabled = true` (the PVC replaces GCS FUSE at that path), but still created and available for `gcs_volumes` overrides. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts, e.g. a read-only media library bucket at a separate path. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (foundation default) → forced to `false` by `main.tf` | Audiobookshelf does not use Redis; the variant hardcodes `enable_redis = false` in its `App_GKE` call regardless of this variable's value. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Audiobookshelf has no SQL database; all other database inputs are forwarded for foundation compatibility only and have no effect. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Enabled by default for this module (unlike most GKE modules, which default this off). |
| `application_domains` | `[]` | Custom hostnames + managed certificate; supply one to use the custom domain. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires org-level permissions). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

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
| `service_url` | URL to reach Audiobookshelf. |
| `statefulset_name` | Name of the StatefulSet. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs (none by default). |
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
| `max_instance_count` | `1` | Critical | Multiple pods write the same SQLite database over the shared PVC — database corruption. |
| `stateful_pvc_enabled` | `true` | Critical | Disabling it falls back toward a GCS-FUSE-style mount for `/data`; gcsfuse corrupts Audiobookshelf's SQLite database and media file index. |
| `CONFIG_PATH` / `METADATA_PATH` (via `environment_variables`) | leave defaults | Critical | Changing them after first boot orphans the existing SQLite database and cached metadata. |
| `stateful_pvc_mount_path` | `/data` | Critical | Must stay in sync with `CONFIG_PATH`/`METADATA_PATH`; a mismatch means the SQLite DB is never actually persisted to the PVC. |
| `stateful_pvc_storage_class` | `standard` (HDD) recommended over the `standard-rwo` (SSD) default | High | This module currently defaults to `standard-rwo`, which draws the tight `SSD_TOTAL_GB` regional quota (e.g. only 500 GB on Qwiklabs); Audiobookshelf's SQLite/media workload does not need SSD IOPS. A campaign of several SSD-backed stateful apps can exhaust the quota — pass `-var stateful_pvc_storage_class=standard` to use HDD (`pd-standard`) instead. Scaling the workload to zero does **not** release the PVC; only deleting it does. |
| `container_port` | `80` | Critical | Audiobookshelf listens on 80 (`PORT=80` injected by `Audiobookshelf_Common`); a mismatch fails every health probe. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace (only relevant if `enable_resource_quota = true`). |
| `enable_redis` | forced `false` regardless of input | Low | Audiobookshelf has no use for Redis; the variant ignores this variable and always passes `false` to the foundation. |
| `application_version` | pinned tag | Medium | `latest` silently resolves to the pinned `2.17.0`; pin explicitly to control upgrades. |
| `enable_custom_domain` / `application_domains` | `true` / set a hostname | Medium | Left `true` with no `application_domains`, the module falls back to the internal cluster URL or LoadBalancer IP rather than a stable hostname. |
| `enable_cloudsql_volume` | `false` | Low | No Cloud SQL exists; enabling wastes a sidecar. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Audiobookshelf-specific application configuration shared with the Cloud Run variant is
described in **[Audiobookshelf_Common](Audiobookshelf_Common.md)**.
