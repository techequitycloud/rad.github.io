---
title: "PocketBase on GKE Autopilot"
description: "Configuration reference for deploying PocketBase on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# PocketBase on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PocketBase_GKE.png" alt="PocketBase on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PocketBase is an open-source backend in a single file — an embedded SQLite database with
a realtime REST API, built-in authentication, file storage, and an admin dashboard. This
module deploys PocketBase on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services PocketBase uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to every
GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

PocketBase runs as a single self-contained Go binary. On GKE it is scheduled as a
**StatefulSet** with a block Persistent Volume so its embedded SQLite database gets reliable
POSIX file locking. The deployment wires together a deliberately minimal set of services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go binary as a **StatefulSet** pod, 1 vCPU / 1 GiB by default, port **8090** |
| Database | **Embedded SQLite** | No Cloud SQL — the database lives on a block PVC at `/pb_data` |
| Persistent storage | Persistent Disk (block PVC) | A per-pod ReadWriteOnce PVC (20 GiB default) mounted at `/pb_data` |
| Cache & queue | **None** | PocketBase uses no Redis; `enable_redis = false` |
| Secrets | Secret Manager | None auto-generated — auth lives inside SQLite; secrets optional for your own use |
| Ingress | Cloud Load Balancing | `ClusterIP` by default (internal); optional LoadBalancer / custom domain for external access |

**Sensible defaults worth knowing up front:**

- **The database is embedded SQLite — there is no Cloud SQL.** PocketBase stores every
  record, auth token, and uploaded file under `/pb_data`, which is a **block PVC** on GKE.
- **StatefulSet + block PVC by default.** `stateful_pvc_enabled = true` — with no explicit
  `workload_type` this auto-resolves to `StatefulSet`. Block storage gives SQLite the
  reliable file locking it needs (SQLite over GCS FUSE is unreliable for locking, which is
  why GKE uses a PVC while Cloud Run uses FUSE).
- **The PVC mounts at `/pb_data`** (20 GiB default). The Common layer sets
  `enable_gcs_storage_volume = false` when the PVC is enabled, so there is no double-mount
  at the same path.
- **Single replica.** SQLite is single-writer and the PVC is ReadWriteOnce, so both
  `min_instance_count` and `max_instance_count` default to `1`. Do not raise
  `max_instance_count`.
- **`service_type = ClusterIP` by default** (internal cluster access). Expose PocketBase
  externally with a LoadBalancer Service or a custom domain + managed certificate.
- **The admin account is created interactively on first run at `/_/`.** No admin password
  is injected. Create the superuser immediately after the app is reachable.
- **No secret is auto-generated.** PocketBase issues and stores all auth itself; Secret
  Manager is used only if you add your own secrets.
- **No Redis, no NFS.** All state is the single `/pb_data` PVC.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the PocketBase workload

PocketBase runs as a **StatefulSet** pod on Autopilot, which bills for the CPU/memory the
pod requests. The StatefulSet gives the pod a stable identity and binds it to its `/pb_data`
PVC across restarts.

- **Console:** Kubernetes Engine → Workloads → select the PocketBase StatefulSet to see the
  pod, revisions, and events. Kubernetes Engine → Services & Ingress shows how it is exposed.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs
StatefulSet) are managed.

### B. Database — embedded SQLite (no Cloud SQL)

There is **no Cloud SQL instance**. PocketBase's database is a set of SQLite files on the
block PVC at `/pb_data`. To inspect or back up the database you work with the PVC contents,
not a SQL endpoint.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims → the PocketBase PVC.
- **CLI:**
  ```bash
  # List the PVC bound to the PocketBase pod:
  kubectl get pvc -n "$NAMESPACE"
  # Inspect / copy the SQLite database out of the running pod for backup:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /pb_data
  kubectl cp "$NAMESPACE"/<pod-name>:/pb_data/data.db ./pb_data-backup.db
  ```

### C. Cloud Storage / Persistent storage — the `/pb_data` volume

On GKE the `/pb_data` directory — the SQLite database, uploaded files, and settings — is a
**block PVC** (ReadWriteOnce, 20 GiB default), not a GCS bucket. A Cloud Storage data bucket
is still declared by the Common layer, but on GKE the PVC is authoritative and the FUSE mount
is disabled to avoid a double-mount.

- **Console:** Kubernetes Engine → Storage; Compute Engine → Disks (the backing PD).
- **CLI:**
  ```bash
  kubectl get pvc,pv -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>          # size, StorageClass, bound PV
  ```

See [App_GKE](App_GKE.md) for StatefulSet PVC templates, StorageClasses, and CMEK options.

### D. Secret Manager

**No secret is auto-generated** for PocketBase — its auth is stored inside SQLite. Secret
Manager is used only if you inject your own secrets (for example, SMTP credentials or
external backup keys) via `secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~pocketbase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration.

### E. Networking & ingress

By default the workload is exposed via a `ClusterIP` Service (internal only). To reach
PocketBase from outside the cluster, set `service_type = LoadBalancer` or enable a custom
domain with a Google-managed certificate; a static IP can be reserved so the address
survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional
uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. PocketBase Application Behaviour

- **No first-deploy database job.** PocketBase creates its own SQLite database, system
  collections, and schema on first start under `/pb_data`. There is no `db-init` job to run
  or monitor.
- **Migrations apply automatically on start.** PocketBase runs any pending schema migrations
  itself on every startup, so upgrading `application_version` applies schema changes with no
  separate migration step. Always back up the PVC before a version bump.
- **The admin superuser is created on first run.** Once PocketBase is reachable, open
  `/_/` and create the administrator account. Until it exists, anyone who reaches `/_/` can
  claim it — treat this as a time-sensitive first-run step.
- **The `/pb_data` PVC is the only durable state.** The SQLite database, uploaded files, and
  settings all live on the block PVC. It survives pod restarts and rescheduling; protect it
  and back it up on a schedule.
- **Single-replica StatefulSet.** SQLite serialises writes through one file and the PVC is
  ReadWriteOnce. `min_instance_count` and `max_instance_count` both default to `1`; do not
  raise `max_instance_count`.
- **Health path.** Startup and liveness probes target `/api/health`, PocketBase's public,
  unauthenticated endpoint (returns HTTP `200` / `{"code":200,"message":"API is healthy."}`).
  First boot is fast because there is no external DB to wait on.
- **Verify runtime state:**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- \
    wget -qO- http://127.0.0.1:8090/api/health
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | sort
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for PocketBase are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `pocketbase` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image tag; `latest` resolves to the pinned `0.22.21` build ARG. Pin an explicit release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; 1 vCPU is comfortable for the single Go binary. |
| `memory_limit` | `1Gi` | Memory per pod; PocketBase is lightweight. |
| `min_instance_count` | `1` | Keep at 1 — GKE requires min ≥ 1 and SQLite is single-writer. |
| `max_instance_count` | `1` | **Do not raise.** SQLite + ReadWriteOnce PVC are single-writer; >1 corrupts data. |
| `container_port` | `8090` | PocketBase listens on 8090 (HTTP API + admin UI). |
| `enable_cloudsql_volume` | `false` | No Cloud SQL Auth Proxy — PocketBase uses no external DB. |
| `enable_image_mirroring` | `true` | Mirror/build the PocketBase image into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Internal by default; use `LoadBalancer` for external access. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves to StatefulSet because `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Single replica, so stickiness is unnecessary. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Strongly recommended** — gives the SQLite DB durable block storage with reliable locking. |
| `stateful_pvc_size` | `20Gi` | Size the PVC for the SQLite DB plus uploaded files and overhead. |
| `stateful_pvc_mount_path` | `/pb_data` | Must be PocketBase's data directory — do not change. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, 15s delay | Startup probe; fast because there is no external DB to wait on. |
| `liveness_probe` | HTTP `/api/health`, 30s delay | Liveness probe against the public health endpoint. |
| `uptime_check_config` | disabled, path `/api/health` | Optional Cloud Monitoring uptime check. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off — PocketBase persists everything to the `/pb_data` PVC. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` / `db_user` | _(empty)_ | Inert — PocketBase uses an embedded SQLite database; no Cloud SQL role/database is created. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate (serves only when `application_domains` is set). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach PocketBase. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs (none by default). |
| `statefulset_name` | Name of the PocketBase StatefulSet. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready (false on the first apply of a new inline cluster). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan
> time — a `Deployment` workload type alongside `stateful_pvc_enabled = true`, bare-integer
> ResourceQuota memory values, IAP with no authorized identities, out-of-range probe or
> retention values. Invalid configuration fails the **plan** with a clear, named error before
> any resource is created, so most mistakes below are caught up front rather than at apply or
> runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (never raise) | Critical | SQLite is single-writer and the PVC is ReadWriteOnce; a second replica cannot mount the volume and concurrent writers corrupt the database. |
| `stateful_pvc_enabled` | `true` | Critical | Without a block PVC, SQLite falls back to GCS FUSE-style storage with unreliable locking → database corruption. |
| The `/pb_data` PVC | Never delete; back up | Critical | The PVC **is** the database and file store — deleting it destroys all data. |
| `stateful_pvc_mount_path` | `/pb_data` (fixed) | Critical | Mounting the PVC anywhere else leaves PocketBase writing its DB to ephemeral pod storage, lost on restart. |
| Admin account at `/_/` | Create immediately after access | Critical | Until the superuser exists, anyone reaching `/_/` can claim it and own the instance. |
| `application_version` bump | Back up the PVC first | High | PocketBase auto-migrates the schema on start; an interrupted upgrade can leave the SQLite DB mid-migration. |
| `workload_type` | leave `null` (auto StatefulSet) | High | Forcing `Deployment` with `stateful_pvc_enabled = true` fails the plan-time validation. |
| `service_type` | `ClusterIP` (internal) or `LoadBalancer` (external) | High | Leaving `ClusterIP` when external access is needed leaves the app unreachable from outside the cluster. |
| `enable_iap` | Only for private deployments | High | IAP blocks all unauthenticated requests, including public API clients and the admin UI. |
| `stateful_pvc_size` | `20Gi` (raise for heavy file uploads) | Medium | Too small a PVC fills up as uploaded files accumulate, and PVCs cannot always be shrunk. |
| `memory_limit` | `1Gi` | Low | PocketBase is lightweight; over-provisioning only adds cost on Autopilot. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. PocketBase-specific application configuration
shared with the Cloud Run variant is described in **[PocketBase_Common](PocketBase_Common.md)**.
