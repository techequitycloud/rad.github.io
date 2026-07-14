---
title: "CloudBeaver on GKE Autopilot"
description: "Configuration reference for deploying CloudBeaver on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# CloudBeaver on GKE Autopilot

CloudBeaver is a web-based, browser-accessible database manager from the DBeaver
project — a single administrative console for connecting to and querying PostgreSQL,
MySQL, SQL Server, Oracle, SQLite and many other engines. This module deploys
CloudBeaver on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services CloudBeaver uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

CloudBeaver runs as a single JVM web workload. Because CloudBeaver keeps all of its
own state in a persistent workspace and provisions no application database, the
deployment wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single JVM pod, 1 vCPU / 1 GiB by default, port 8978 |
| Persistent workspace | Persistent Disk (block PVC) via StatefulSet | **Recommended:** a per-pod block PVC mounted at `/opt/cloudbeaver/workspace` backs the embedded H2 store |
| Database | **None provisioned** | `database_type = "NONE"` — CloudBeaver stores its own state; it *connects out* to databases you configure in the UI |
| Cache & queue | **None** | CloudBeaver uses no Redis; `enable_redis` is forced off |
| Secrets | Secret Manager | No app-level secret is generated — the admin account is created via the first-run setup wizard |
| Ingress | Cloud Load Balancing | **`ClusterIP` by default** (in-cluster); use `LoadBalancer` / a custom domain for external access |

**Sensible defaults worth knowing up front:**

- **No application database is provisioned.** `database_type = "NONE"`. CloudBeaver
  keeps its metadata in an embedded H2 store inside the workspace volume. The
  databases it *manages* are added by an operator in the UI after deploy.
- **Use a block PVC for the workspace, not GCS FUSE.** `stateful_pvc_enabled = true`
  is strongly recommended: a block Persistent Disk — not GCS FUSE — is the correct
  backing store for CloudBeaver's embedded H2 database. When the PVC is enabled the
  module automatically skips the GCS FUSE volume at the same path to avoid a
  double-mount.
- **StatefulSet is auto-selected.** Setting `stateful_pvc_enabled = true` without an
  explicit `workload_type` resolves the workload to a `StatefulSet` for stable pod
  identity and orderly restarts.
- **Single instance by design.** `min_instance_count = 1` (avoid slow JVM cold starts,
  and GKE has no scale-to-zero) and `max_instance_count = 1` (the workspace is a
  single-writer store). Do **not** raise `max_instance_count`.
- **Service is `ClusterIP` by default.** In-cluster only — appropriate for a database
  admin console. For browser access from outside the cluster, use
  `service_type = "LoadBalancer"` or an Ingress with a custom domain (and IAP).
- **The admin account is claimed by the first visitor.** CloudBeaver has no seeded
  admin — complete the setup wizard immediately once the service is reachable.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the CloudBeaver workload

CloudBeaver pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. With a block PVC enabled the workload runs as a **StatefulSet**
(port 8978) for stable pod identity. Because the workspace is single-writer, keep the
workload at a single replica.

- **Console:** Kubernetes Engine → Workloads → select the CloudBeaver workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows how it is exposed.
- **CLI:**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe statefulset -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent Disk — the workspace volume (block PVC)

CloudBeaver's entire state — its embedded H2 metadata database, saved connections,
users, and configuration — persists under `/opt/cloudbeaver/workspace`. The
recommended backing store is a **block Persistent Disk** provisioned per-pod by the
StatefulSet's PVC template and mounted at that path. This is the durable heart of the
deployment and the correct store for the embedded H2 database.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Inspect the workspace contents inside the pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /opt/cloudbeaver/workspace
  ```

When `stateful_pvc_enabled = true`, the module sets `enable_gcs_storage_volume = false`
so the GCS FUSE volume is not also mounted at the same path. A `storage` Cloud Storage
bucket is still declared by CloudBeaver_Common for parity with the Cloud Run variant.

### C. Cloud Storage

A `storage` **Cloud Storage** bucket is declared for the deployment. With the
recommended block-PVC setup the workspace lives on the Persistent Disk rather than the
bucket, but the bucket is still provisioned and available for auxiliary storage.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Database connectivity (no managed instance)

This module provisions **no Cloud SQL instance** — `gcloud sql instances list` will
not show one created by CloudBeaver. Instead, CloudBeaver connects out to whatever
databases you register in its UI. To reach the deployment's own shared Cloud SQL (or
any private database), the target must be reachable on the VPC from the pod.

- **CLI (test reachability from within the pod):**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- sh -c 'nc -zv <db-private-ip> 5432'
  ```

### E. Secret Manager

CloudBeaver generates **no application-level secret** — there is no encryption key, no
JWT secret, and no database password to manage (there is no database). The admin
account is created through the first-run setup wizard, and all state lives in the
workspace.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed as a **`ClusterIP`** Service — reachable only from
inside the cluster, which suits a database administration console. For browser access
from outside the cluster, use `service_type = "LoadBalancer"` or enable an Ingress
with a custom domain and Google-managed certificate (optionally with IAP, Cloud Armor,
and a reserved static IP).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional
uptime checks and alert policies are available (uptime checks require a publicly
reachable endpoint, e.g. a LoadBalancer Service).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. CloudBeaver Application Behaviour

- **No first-deploy database setup.** There is no db-init job and no application
  database. CloudBeaver initialises its own embedded metadata store inside the
  workspace on first start.
- **State is entirely in the workspace volume.** The embedded H2 database, saved
  connections, managed users, and configuration all live under
  `/opt/cloudbeaver/workspace`, backed by the block PVC. The PVC survives pod
  restarts and rescheduling, which is why a StatefulSet + block PVC is strongly
  recommended over GCS FUSE for the embedded H2 store.
- **First-run setup wizard.** On first access CloudBeaver presents a setup wizard to
  create the server configuration and the administrator account. There is no seeded
  admin — whoever completes the wizard first becomes the admin. Do this immediately,
  and keep the Service internal until you have.
- **Adding databases to manage.** After logging in as admin, add connections in the UI
  (New Connection → choose the driver → supply host/port/credentials). To reach private
  databases, ensure they are reachable on the VPC from the pod.
- **Health path.** Startup and liveness probes target `/` (the CloudBeaver web UI),
  which returns HTTP 200 once the JVM has finished starting.
- **Single-writer scaling.** Keep `max_instance_count = 1`. The workspace store cannot
  be shared safely by concurrent pods.
- **Inspect the running configuration:**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | sort
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for CloudBeaver are listed; every other input is inherited from
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
| `application_name` | `cloudbeaver` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `CloudBeaver` | Human-readable name shown in the Console. |
| `application_version` | `latest` | CloudBeaver image tag (built from `dbeaver/cloudbeaver:<version>`); pin for reproducibility. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `min_instance_count` | `1` | Keep 1 warm replica (GKE has no scale-to-zero; avoids slow JVM cold starts). |
| `max_instance_count` | `1` | **Keep at 1.** The workspace is a single-writer store; concurrent pods corrupt it. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod. CloudBeaver runs on the JVM — size accordingly. |
| `container_port` | `8978` | Fixed by CloudBeaver_Common; not forwarded to App_GKE and has no effect here. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | In-cluster by default (recommended for a DB console). Use `LoadBalancer` for external access. |
| `workload_type` | `null` | Leave unset — with `stateful_pvc_enabled = true` it auto-resolves to `StatefulSet`. |
| `session_affinity` | _(set)_ | Sticky routing for UI sessions. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Set `true`** — a block PVC (not GCS FUSE) is the correct store for CloudBeaver's embedded H2 DB. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; hold the workspace plus overhead. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | Must be CloudBeaver's workspace directory. |
| `stateful_pvc_storage_class` | _(set)_ | Kubernetes StorageClass for the PVC. |
| `stateful_headless_service` | _(set)_ | Headless Service for stable pod DNS names. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | Startup probe against the CloudBeaver UI. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe against the CloudBeaver UI. |
| `uptime_check_config` | _(set)_ | Cloud Monitoring uptime check — requires a publicly reachable endpoint (e.g. a LoadBalancer Service). |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off — CloudBeaver's workspace is on the block PVC, not NFS. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the declared GCS buckets. |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `enable_image_mirroring` | `true` | Mirror the CloudBeaver image into Artifact Registry before deployment. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour. Note that
`enable_redis` is forced to `false` and no application database is provisioned
(`database_type = NONE`) by this module.

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
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved / `LoadBalancer` is used). |
| `service_url` | URL to reach CloudBeaver. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any initialization jobs (empty by default). |
| `statefulset_name` | Name of the StatefulSet. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true`, `quota_memory_requests`/`_limits` without binary unit suffixes, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (block PVC) | Critical | Without a persistent block PVC the workspace (embedded H2 DB, connections, users, config) is lost on pod restart. GCS FUSE is not a safe store for the embedded H2 database. |
| Workspace PVC | Preserve across redeploys | Critical | The PVC holds all CloudBeaver state; deleting it wipes every saved connection and setting. |
| `max_instance_count` | `1` | Critical | The workspace is single-writer; two pods writing the embedded H2 store concurrently corrupt it. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | High | CloudBeaver's workspace path is baked into the image; mounting elsewhere leaves state on ephemeral storage. |
| First-run setup wizard | Complete immediately | High | There is no seeded admin — anyone who reaches the UI first can claim the administrator account. |
| `service_type` | `ClusterIP` (or LB+IAP) | High | `LoadBalancer` without IAP/Cloud Armor exposes a database admin console to the public internet. |
| `memory_limit` | `1Gi` | High | CloudBeaver is JVM-based; too little memory causes OOM kills. |
| `min_instance_count` | `1` | Medium | GKE requires min ≥ 1; a warm replica avoids slow JVM cold starts. |
| `application_version` | Pin a tag in production | Medium | `latest` can shift the CloudBeaver version between rebuilds; pin for reproducibility. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_redis` / `database_type` | Leave as set (off / `NONE`) | Low | CloudBeaver uses neither; overriding has no benefit and is unsupported here. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
CloudBeaver-specific application configuration shared with the Cloud Run variant is
described in **[CloudBeaver_Common](CloudBeaver_Common.md)**.
