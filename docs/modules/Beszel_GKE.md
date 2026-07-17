---
title: "Beszel on GKE Autopilot"
description: "Configuration reference for deploying Beszel on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Beszel on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Beszel_GKE.png" alt="Beszel on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Beszel is a lightweight, open-source server-monitoring hub — historical resource
metrics, Docker container stats, and configurable alerts, built on PocketBase (Go
plus an embedded SQLite database). This module deploys the Beszel hub on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Beszel uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Beszel runs as a single-replica Kubernetes **StatefulSet** on Autopilot, serving its
web UI and REST API on port 8090 and persisting all state to a block Persistent
Volume mounted at `/beszel_data`. The deployment wires together a deliberately small
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go pod, StatefulSet, 1 vCPU / 1 GiB by default, port 8090 |
| Database | **None** | Beszel embeds its own PocketBase/SQLite DB — no Cloud SQL is provisioned |
| Persistent storage | Persistent Disk (PVC) | 20 Gi block PVC at `/beszel_data` for all state (StatefulSet) |
| Cache & queue | **None** | Beszel does not use Redis; `enable_redis` is forced off |
| Secrets | Secret Manager | No app secrets injected — the first admin is created in the UI |
| Ingress | Cloud Load Balancing | `ClusterIP` Service by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Beszel is self-contained — `database_type = "NONE"`,
  `enable_cloudsql_volume = false`, and `enable_redis = false`. All state is the
  embedded SQLite database under `/beszel_data`.
- **StatefulSet with a block PVC by default.** `stateful_pvc_enabled = true` (the
  GKE default), so `workload_type` auto-resolves to `StatefulSet` and a 20 Gi
  Persistent Disk is mounted at `/beszel_data`. A block PVC is the correct durable
  backing for SQLite (unlike a network file mount). Because the PVC covers `/beszel_data`,
  the GCS FUSE volume at the same path is disabled to avoid a double mount.
- **Single replica is deliberate.** `min_instance_count = max_instance_count = 1`.
  Beszel is a single-writer app (one SQLite file); do **not** raise the replica
  count.
- **`Recreate`-style update.** Only one pod may own the SQLite PVC at a time; the
  StatefulSet replaces the pod rather than running two against the same volume.
- **Port 8090.** Beszel's hub listens on 8090; the container port and probes are set
  accordingly.
- **`ClusterIP` by default.** The Service is internal by default; expose the hub
  through the Gateway/Ingress with a custom domain (and managed certificate), or set
  a LoadBalancer, so remote agents and browsers can reach it.
- **Health path `/api/health`.** Startup and liveness probes hit the hub's public,
  unauthenticated health endpoint (200 when ready).
- **The initial admin is created in the UI.** No admin password is stored in Secret
  Manager; open the hub after deploy and complete PocketBase's first-run superuser
  setup.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Beszel workload

Beszel is scheduled as a single-replica StatefulSet on Autopilot, which bills for
the CPU/memory the pod actually requests. Because the app is single-writer, it is
not horizontally scaled.

- **Console:** Kubernetes Engine → Workloads → select the Beszel workload to see the
  pod, StatefulSet, and events. Kubernetes Engine → Services & Ingress shows how it
  is exposed.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=beszel
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent Disk (PVC) — the `/beszel_data` volume

Beszel's entire state (the SQLite database, uploaded config, and historical metrics)
lives on a block Persistent Volume claimed by the StatefulSet and mounted at
`/beszel_data` (20 Gi by default).

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims; Compute
  Engine → Disks.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~beszel"
  ```

> **Caution:** This PVC **is** the database. Deleting the StatefulSet with its PVC,
> or deleting the underlying disk, erases all monitoring history and the admin
> account. See [App_GKE](App_GKE.md) for StatefulSet and storage-class details.

### C. Secret Manager

Beszel injects **no** application secrets — there is no encryption key, JWT secret,
or database password to manage (the DB is embedded SQLite, and the admin is created
in the UI). A secret listing shows only whatever the foundation itself creates.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration if you add secrets
via `secret_environment_variables`.

### D. Networking & ingress

By default the workload is exposed as a `ClusterIP` Service (in-cluster only). Enable
a custom domain with a Google-managed certificate, or a LoadBalancer/Gateway, so
remote agents and browsers can reach the hub. A static IP can be reserved so the
address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies. (Note that Beszel itself is a monitoring
product — the GCP monitoring here observes the *hub*, not the machines Beszel watches.)

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Beszel Application Behaviour

- **No init job; schema is self-managed.** Beszel creates and migrates its embedded
  PocketBase/SQLite database automatically on first boot (and on every version
  upgrade). There is no `db-init` job because there is no external database.
- **State lives on the block PVC.** Everything under `/beszel_data` — the SQLite
  database, config, and historical metrics — is persisted to the Persistent Volume.
  Pod restarts and version upgrades reattach the same PVC, so history survives.
- **First-run setup is in the UI.** Reach the service URL and complete PocketBase's
  first-run superuser (admin) account creation. There is no auto-generated admin
  credential in Secret Manager. After creating the admin, add the systems to monitor
  and install the Beszel agent on each (the hub shows the agent install command and
  public key).
- **Single writer — do not scale out.** One SQLite file on one PVC means one pod may
  write. `min = max = 1`, and only one pod may own the PVC at a time. A plan-time
  guard rejects `min_instance_count > max_instance_count`.
- **Health path.** Startup and liveness probes target `/api/health`, which returns
  `200` once the hub is ready. Confirm the injected port/env:
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -i port
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Beszel are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `beszel` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Beszel image tag. `latest` resolves the base image to the pinned `0.9.1`; set an explicit tag to control upgrades. |

### Group — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; Beszel is lightweight, 1 vCPU is ample. |
| `memory_limit` | `1Gi` | Memory per pod; 512 Mi–1 Gi is typical. |
| `min_instance_count` | `1` | Kept at 1 — one SQLite writer. |
| `max_instance_count` | `1` | **Do not increase.** More than one pod corrupts the shared SQLite database. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL Auth Proxy sidecar; Beszel uses embedded SQLite. |
| `enable_image_mirroring` | `true` | Mirror the Beszel image into Artifact Registry. |

### Group — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Internal by default; expose via custom domain / LoadBalancer for external agents. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves to `StatefulSet` because `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Single pod, so sticky routing is unnecessary. |

### Group — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Beszel is stateful — a block PVC backs its SQLite database. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size for `/beszel_data`. |
| `stateful_pvc_mount_path` | `/beszel_data` | Mount path for the SQLite database and metrics history. |

### Group — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off; Beszel persists to the block PVC, not NFS. |
| `gcs_volumes` | `[]` | Extra GCS Fuse mounts (the `/beszel_data` GCS volume is disabled when the PVC is used). |
| `create_cloud_storage` | `true` | Provision the declared storage bucket(s). |

### Group — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` (effective) | The variable itself defaults `true`, but the wrapper's `main.tf` hardcodes `enable_redis = false` in the Foundation call and never forwards `var.enable_redis` — Beszel does not use Redis. |

### Group — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s delay | Startup probe; 10-retry window for first-boot schema creation. |
| `liveness_probe` | HTTP `/api/health` 30s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Optional Cloud Monitoring uptime check against the hub. |

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
| `service_url` | URL to reach Beszel. |
| `statefulset_name` | Name of the Beszel StatefulSet. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `Deployment` workload type combined with `stateful_pvc_enabled = true`, binary-unit ResourceQuota memory values, `min_instance_count > max_instance_count`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| StatefulSet PVC / underlying disk | Never delete | Critical | The PVC **is** the SQLite database — deleting it erases all monitoring history and the admin account. |
| `max_instance_count` | `1` | Critical | Running >1 pod against the shared SQLite PVC causes lock contention and database corruption. |
| `stateful_pvc_enabled` | `true` | Critical | Disabling it drops the durable block volume, so SQLite state is lost on pod restart. |
| `workload_type` | leave `null` (→ StatefulSet) | High | Setting `Deployment` with `stateful_pvc_enabled = true` fails a plan-time guard. |
| `enable_cloudsql_volume` / `database_type` | `false` / no SQL | High | Beszel has no external DB; enabling Cloud SQL provisions an unused instance and misconfigures startup. |
| `service_type` / custom domain | expose deliberately | High | Left as `ClusterIP` with no Ingress, remote agents outside the cluster cannot reach the hub. |
| `enable_iap` | only for the UI, never with off-Google agents | High | IAP blocks all unauthenticated requests, including agent metric reporting. |
| `quota_memory_requests` / `_limits` | binary units (`1Gi`, `1024Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `container_port` | `8090` | Medium | The hub listens only on 8090; changing it without matching the image breaks the probes and Service. |
| `application_version` | pin explicitly | Medium | `latest` resolves the base image to the pinned `0.9.1`; pin a real tag to control upgrades and schema migrations. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Beszel-specific application configuration shared with the Cloud Run variant is
described in **[Beszel_Common](Beszel_Common.md)**.
