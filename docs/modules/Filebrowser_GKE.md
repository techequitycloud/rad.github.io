---
title: "Filebrowser on GKE Autopilot"
description: "Configuration reference for deploying Filebrowser on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Filebrowser on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Filebrowser_GKE.png" alt="Filebrowser on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

File Browser is a lightweight, open-source web file manager written in Go — it
serves a directory tree over HTTP for browsing, uploading, editing, and sharing
files. This module deploys Filebrowser on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Filebrowser uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Filebrowser runs as a single Go web workload. It is deliberately minimal — no SQL
database, no cache, no queue — so the deployment wires together a small set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go pod, 1 vCPU / 1 GiB by default; `min = max = 1` |
| Persistent state | Cloud Storage (GCS FUSE) **or** a block PVC | Mounted at `/database`; holds the embedded SQLite DB |
| Database | None (embedded SQLite) | `database_type = NONE`; no Cloud SQL is provisioned |
| Cache & queue | None | Filebrowser uses no Redis |
| Secrets | Secret Manager | No app secrets generated; users live in the SQLite DB |
| Ingress | Cloud Load Balancing | `ClusterIP` Service by default; custom domain + managed certificate available |

**Sensible defaults worth knowing up front:**

- **State lives in an embedded SQLite file at `/database`.** Filebrowser has no Cloud
  SQL database. Its users, settings, and share links are stored in
  `/database/filebrowser.db`. By default `/database` is a Cloud Storage bucket mounted
  via GCS FUSE; enabling a StatefulSet swaps it for a block PVC (see below).
- **GCS FUSE vs. block PVC.** With `stateful_pvc_enabled = true` the workload becomes
  a **StatefulSet** with a persistent block PVC (default `20Gi`) mounted at
  `/database`, and the GCS FUSE volume is automatically disabled to avoid a
  double-mount at the same path. A block PVC gives SQLite proper POSIX file locking
  and is the more robust choice for a stateful file manager.
- **Single instance by design.** `min_instance_count = max_instance_count = 1`.
  SQLite does not tolerate concurrent writers — keep a single replica.
- **Default login is `admin` / `admin`.** Filebrowser seeds this on first boot;
  change it in the web UI immediately after deploy.
- **No Redis, no init job.** `enable_redis = false` and no `db-init` job runs; the
  pod is ready as soon as the container starts.
- **Container port 80.** Filebrowser serves plain HTTP/1.1 on port 80.
- **Custom domain is on by default.** `enable_custom_domain = true` and
  `reserve_static_ip = true`; supply `application_domains` to serve a hostname with a
  Google-managed certificate.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Filebrowser workload

Filebrowser runs as a single-replica Deployment (or a StatefulSet when
`stateful_pvc_enabled = true`) scheduled on Autopilot, which bills for the CPU/memory
the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the Filebrowser workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  Service and any external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud Storage / block PVC — persistent state

Filebrowser has no Cloud SQL database. Its embedded SQLite database
(`/database/filebrowser.db`) is stored on the `/database` mount:

- **Default (Deployment):** a dedicated **Cloud Storage** bucket mounted via GCS FUSE
  through the CSI driver.
- **StatefulSet (`stateful_pvc_enabled = true`):** a block **PersistentVolumeClaim**
  (default `20Gi`, StorageClass `standard-rwo`) mounted at `/database`; the GCS FUSE
  volume is disabled to avoid a double-mount.

- **Console:** Cloud Storage → Buckets; or Kubernetes Engine → Storage → PVCs.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"   # GCS FUSE mode
  gcloud storage ls gs://<data-bucket>/filebrowser.db
  kubectl get pvc -n "$NAMESPACE"                                            # PVC mode
  ```

See [App_GKE](App_GKE.md) for CMEK options, GCS FUSE, and StatefulSet PVCs.

### C. Secret Manager

Filebrowser generates **no application secrets** — there is no encryption key or JWT
secret to manage, because all identity state lives in the SQLite database. Secret
Manager is still used by the foundation for platform-managed secrets (e.g. CI/CD
tokens if configured).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~filebrowser"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the Service is `ClusterIP`, with `enable_custom_domain = true` and
`reserve_static_ip = true` so an Ingress with a Google-managed certificate can serve
a supplied hostname on a stable IP. Without a custom domain the workload is reachable
in-cluster at `http://<service>.<namespace>.svc.cluster.local`.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Filebrowser Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no Cloud SQL
  instance. On first start the Filebrowser binary creates its SQLite database at
  `/database/filebrowser.db` if it does not already exist and seeds the default
  `admin`/`admin` user.
- **State persistence.** Users, settings, and share links live entirely in
  `/database/filebrowser.db` on the `/database` mount (GCS FUSE bucket or block PVC),
  surviving restarts and redeploys. `FB_ROOT = /srv` is the file tree the app serves.
- **Default credentials must be changed.** The seeded `admin`/`admin` login is
  well-known. Log in and change the password (and ideally the username) in the web UI
  immediately after the first deploy.
- **Single-writer constraint.** The embedded SQLite database does not support
  concurrent writers. Keep `min_instance_count = max_instance_count = 1`; a StatefulSet
  block PVC gives proper file locking but is still single-replica.
- **Health path.** Startup and liveness probes target **`/health`** — Filebrowser's
  unauthenticated health endpoint, which returns `200` as soon as the server is
  listening:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- wget -qO- http://localhost:80/health
  ```
- **No Redis.** `enable_redis = false`; Filebrowser is a self-contained file manager
  with no queue or cache. The App_GKE default of `enable_redis = true` is explicitly
  overridden.
- **Custom-built image needs `imagePullPolicy = Always`.** The image is a thin wrapper
  built and mirrored into Artifact Registry; App_GKE sets `imagePullPolicy = Always`
  for custom/mirrored images so a rebuild-redeploy always pulls the fresh layer.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Filebrowser are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `filebrowser` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Filebrowser image tag. `latest` resolves to the pinned `v2.32.0` at build time; pin explicitly in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; Filebrowser is lightweight. |
| `memory_limit` | `1Gi` | Memory per pod; 256Mi is ample for the Go server. |
| `min_instance_count` | `1` | Minimum replicas. Keep at 1 — SQLite is single-writer. |
| `max_instance_count` | `1` | **Keep at 1** to prevent concurrent SQLite writers. |
| `container_port` | `80` | Filebrowser's HTTP/1.1 listener. |
| `enable_cloudsql_volume` | `false` | Filebrowser has no Cloud SQL; leave `false`. |
| `enable_image_mirroring` | `true` | Mirror the Filebrowser image into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | How the Kubernetes Service is exposed; front with an Ingress via `enable_custom_domain`. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`, else `Deployment`. |
| `session_affinity` | `None` | Single replica, so sticky routing is unnecessary. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` to store `/database` on a block PVC instead of GCS FUSE (recommended for SQLite file locking). |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/database` | Mount path — must match `FB_DATABASE`'s directory. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass (`standard-rwo` Balanced PD; `premium-rwo` for higher IOPS). |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s delay | Startup probe; Filebrowser exposes `/health` once ready. |
| `liveness_probe` | HTTP `/health` 30s delay | Liveness probe on the unauthenticated `/health` endpoint. |
| `uptime_check_config` | `{enabled=false, path="/health"}` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default; not needed for Filebrowser. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the Filebrowser `/database` bucket (and any extra `storage_buckets`). |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Extra GCS FUSE mounts. The `/database` bucket is added automatically (unless a PVC is used). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Filebrowser uses no Redis; the App_GKE default of `true` is overridden to `false`. |

### Group 16 — Database Backend

Not applicable — Filebrowser has no SQL database. `database_password_length` and
`db_name` / `db_user` are forwarded to the foundation only for compatibility;
`database_type` is fixed to `NONE` by `Filebrowser_Common`.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Filebrowser. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
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
| `service_url` | URL to reach Filebrowser. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/database` bucket in GCS FUSE mode). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any init jobs (empty by default). |
| `statefulset_name` | Name of the StatefulSet (when `stateful_pvc_enabled = true`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no OAuth credentials, `min_instance_count > max_instance_count`, `workload_type = Deployment` alongside `stateful_pvc_enabled = true`, ResourceQuota memory values without binary unit suffixes. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/database` volume (bucket or PVC) | Never delete | Critical | The embedded SQLite DB lives here; deleting it destroys all users, settings, and share links. |
| `admin` / `admin` (seeded login) | Change on first login | Critical | Leaving the default credential lets anyone who can reach the service take full control. |
| `max_instance_count` | `1` | High | >1 puts concurrent writers on the single SQLite database, corrupting it. |
| `stateful_pvc_mount_path` | `/database` | High | Must match `FB_DATABASE`'s directory; a mismatch stores the DB on ephemeral disk and loses state on restart. |
| `stateful_pvc_enabled` + `enable_gcs_storage_volume` | Let Common disable GCS FUSE | High | Both at `/database` double-mount; Common auto-sets `enable_gcs_storage_volume = false` when the PVC is on — do not force both. |
| `container_port` | `80` | High | Filebrowser listens on 80; a different port makes the startup probe fail and the pod never becomes Ready. |
| `startup_probe` / `liveness_probe` path | `/health` | High | Pointing probes at an authenticated path returns 401/403 and the pod never goes Ready. |
| `enable_cloudsql_volume` | `false` | Medium | Filebrowser has no Cloud SQL; enabling adds a useless Auth Proxy sidecar. |
| `enable_redis` | `false` | Medium | Filebrowser has no Redis; the App_GKE default `true` is overridden — leaving it on wires an unused dependency. |
| `enable_iap` | credentials required | High | Enabling IAP without `iap_oauth_client_id`/`secret` silently exposes the service unauthenticated (blocked by a plan-time guard). |
| `application_version` | pin in production | Medium | `latest` resolves to a pinned `v2.32.0` at build time; pin explicitly to control upgrades. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Filebrowser-specific application configuration shared
with the Cloud Run variant is described in
**[Filebrowser_Common](Filebrowser_Common.md)**.
