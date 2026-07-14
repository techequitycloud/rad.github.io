---
title: "Ntfy on GKE Autopilot"
description: "Configuration reference for deploying Ntfy on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Ntfy on GKE Autopilot

ntfy is an open-source, Apache 2.0-licensed pub/sub push-notification server written
in Go. Applications publish messages over a simple REST/HTTP API and clients receive
them instantly over WebSocket or Server-Sent-Events (SSE) streams — no external
database required. This module deploys ntfy on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services ntfy uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

ntfy runs as a single Go web workload. The deployment wires together a deliberately
small set of Google Cloud services — ntfy has no database, cache, or object-storage
dependency of its own:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go Deployment, 1 vCPU / 512 MiB by default |
| Database | **None** | `database_type = "NONE"`; message cache is a local SQLite file, no Cloud SQL provisioned |
| Persistence | Ephemeral disk (default), NFS, or block PVC (StatefulSet) | SQLite cache at `/var/cache/ntfy/cache.db`; NFS or PVC for durable history |
| Object storage | **None** | ntfy stores nothing in Cloud Storage |
| Cache / queue | **None** | No Redis; ntfy uses an in-process message bus |
| Secrets | Secret Manager | No auto-generated secrets; only user-supplied `secret_environment_variables` |
| Ingress | Cloud Load Balancing | External LoadBalancer Service; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** `database_type = "NONE"` — ntfy keeps its message
  cache in a local SQLite file. The database-related variables exist for
  completeness but are inert unless you deliberately opt in to an external database.
- **Stateless Deployment by default.** `workload_type = "Deployment"` with an
  **ephemeral** SQLite cache at `/var/cache/ntfy/cache.db`. Message history is lost
  when a pod restarts. For durability, either enable NFS (`enable_nfs = true`) or
  switch to a **StatefulSet block PVC** (`stateful_pvc_enabled = true` with
  `stateful_pvc_mount_path = "/var/cache/ntfy"`).
- **Single replica by default** (`min_instance_count = 1`, `max_instance_count = 1`).
  A subscriber's stream is anchored to the pod that holds it and there is no shared
  message bus, so scaling out is not the default. Keep max at 1 unless you place a
  shared cache/broker behind ntfy.
- **Exposed via a LoadBalancer Service** (`service_type = "LoadBalancer"`,
  `reserve_static_ip = true`, `enable_custom_domain = true`), so publishers and
  subscribers can reach it from outside the cluster.
- **The health endpoint is `/v1/health`**, which returns `{"healthy":true}` with HTTP
  200 as soon as the server binds its port.
- **The GKE variant runs on its own tenant namespace.** `Ntfy_GKE` appends `-gke` to
  `tenant_deployment_id`, so it can run alongside `Ntfy_CloudRun` on the same tenant
  without a naming collision.
- **Access control is a post-deploy step.** ntfy ships with open access; configure
  users and topic ACLs afterwards via its CLI or `NTFY_AUTH_*` environment variables.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the ntfy workload

ntfy pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. By default the workload is a stateless `Deployment` with a single
replica; switching to a `StatefulSet` provisions a per-pod block PVC for durable
message history.

- **Console:** Kubernetes Engine → Workloads → select the ntfy workload to see pods
  and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistence — the SQLite message cache

ntfy has **no Cloud SQL instance**. Its message cache is a local SQLite file at
`NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), created by the entrypoint on boot.
With the default stateless Deployment the cache is **ephemeral** — message history
does not survive a pod restart. Two ways to make it durable:

- **NFS (Filestore):** `enable_nfs = true`, and point the cache directory at the
  mount.
- **StatefulSet block PVC:** `stateful_pvc_enabled = true` with
  `stateful_pvc_mount_path = "/var/cache/ntfy"` — a per-pod persistent disk holds the
  cache database.

- **Console:** Filestore → Instances (NFS); Kubernetes Engine → Storage →
  PersistentVolumeClaims (block PVC).
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                                   # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /var/cache/ntfy       # cache location
  ```

See [App_GKE](App_GKE.md) for the NFS and StatefulSet PVC models.

### C. Secret Manager

ntfy generates **no** secrets at deploy time — there is no database password or
encryption key to manage. Secret Manager is used only if you supply your own via
`secret_environment_variables` (for example an `NTFY_AUTH_*` value or an upstream
push credential).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP via a
LoadBalancer Service. A custom domain with a Google-managed certificate can be
enabled, and a static IP is reserved by default so the address survives redeploys.
If clients use HTTP/2 streaming, set `container_protocol = "h2c"`.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available. ntfy logs its listen
address and resolved cache path on startup.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Ntfy Application Behaviour

- **No first-deploy database setup.** ntfy has no external database and no migration
  step. The entrypoint prepares the SQLite cache directory and immediately execs
  `ntfy serve`. There is no `db-init` job by default.
- **Persistence depends on the workload type.** A stateless `Deployment` uses an
  ephemeral cache; a `StatefulSet` with a block PVC (or an NFS mount) makes message
  history durable across pod restarts.
- **`imagePullPolicy = Always` for the custom image.** App_GKE sets this for
  custom-built/mirrored images so a rebuild-and-redeploy under an unchanged tag pulls
  the new layers rather than serving a stale node cache.
- **Health path.** Startup and liveness probes target `/v1/health`, which returns
  `{"healthy":true}` and HTTP 200 as soon as the server binds port 80. Verify from
  inside the cluster:
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s http://<service-name>.$NAMESPACE.svc.cluster.local/v1/health   # {"healthy":true}
  ```
- **Publish / subscribe smoke test** (against the external IP):
  ```bash
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  curl -d "hello from ntfy" "http://$EXTERNAL_IP/mytopic"    # publish
  ```
- **Access is open until you lock it down.** By default any client can publish to and
  subscribe from any topic. Configure users and per-topic ACLs post-deploy via ntfy's
  CLI (`ntfy user add`, `ntfy access`) or the `NTFY_AUTH_*` environment variables.
- **Public base URL for attachments / web push.** If you use attachments or browser
  web-push, set `NTFY_BASE_URL` (via `environment_variables`) to the external URL so
  generated links resolve correctly.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for ntfy are listed; every other input is inherited
from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 / 3 — Deployment Environment & Application Identity

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix; `Ntfy_GKE` appends `-gke` internally so it can coexist with the Cloud Run variant. |
| `application_name` | `ntfy` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image version tag; `latest` maps to a pinned `v2.11.0` base. Pin `v2.x.y` in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the wrapper image via Cloud Build; `prebuilt` deploys an image directly. |
| `min_instance_count` | `1` | Minimum replicas (GKE has no scale-to-zero). |
| `max_instance_count` | `1` | **Keep at 1** — streams are pod-local with no shared broker. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Per-pod CPU/memory. |
| `container_port` | `80` | ntfy listens on port 80. |
| `container_protocol` | `http1` | Set `h2c` for end-to-end HTTP/2 streaming. |
| `workload_type` | `Deployment` | Stateless default; `StatefulSet` for a durable per-pod PVC. |
| `enable_cloudsql_volume` | `false` | Off — ntfy has no database. |
| `enable_image_mirroring` | `true` | Mirror the ntfy image into Artifact Registry. |

### Group 5 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in. **Blocks unauthenticated publish/subscribe.** Needs `iap_oauth_client_id` / `_secret`. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `NTFY_*` settings (e.g. `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (optional; none required). |

### Group 6 — GKE Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Leave empty to auto-discover the Services_GCP cluster. |
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `None` | Set `ClientIP` to pin a client's stream to one pod if you scale replicas. |

### Group 7 — StatefulSet (durable message history)

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` for a per-pod block PVC — durable message cache across restarts. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | Mount path; matches `NTFY_CACHE_FILE`'s directory. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass for the PVC. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/v1/health` | Startup probe. ntfy becomes healthy within seconds. |
| `health_check_config` | HTTP `/v1/health` | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |

### Group 13 / 14 — Filesystem & Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Enable to back the SQLite cache with NFS for durable history (alternative to a PVC). |
| `nfs_mount_path` | `/mnt/nfs` | NFS mount path. |
| `storage_buckets` | `[]` | Not required — ntfy uses no object storage. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy has no external database; leave `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inert unless an external database is deliberately enabled. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — ntfy has no Redis dependency. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

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
| `service_url` | URL to reach ntfy. |
| `database_instance_name` / `database_name` / `database_user` | Database identifiers — empty for the default `NONE` engine. |
| `database_password_secret` / `database_host` / `database_port` | Database endpoint fields — unused for `NONE`. |
| `storage_buckets` | Created Cloud Storage buckets (none by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of any setup and import jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no OAuth credentials, `enable_cloudsql_volume = true` with `database_type = "NONE"`, `min_instance_count > max_instance_count`, `quota_memory_*` without binary units. The GKE variant's own `validation.tf` enforces these guards. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` / `enable_nfs` (for durable history) | Enable one when history matters | High | With the default stateless Deployment and ephemeral cache, all message history is lost on every pod restart. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | High | Mounting the PVC anywhere other than the `NTFY_CACHE_FILE` directory persists the wrong path and the cache stays ephemeral. |
| `max_instance_count` | `1` | High | Scaling beyond 1 splits subscribers across pods with no shared bus, so a message published to one pod is not delivered to subscribers on another. |
| `enable_cloudsql_volume` | `false` | High | Setting `true` with `database_type = "NONE"` starts an Auth Proxy sidecar with no instance to reach — rejected by the plan-time guard. |
| `session_affinity` | `ClientIP` if you scale | High | Without stickiness, a reconnecting subscriber lands on a different pod and misses cached messages held by the original pod. |
| `enable_iap` | only when auth-gated | High | IAP requires Google sign-in for every request, blocking unauthenticated publish/subscribe. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values, and 0 would leave no pod to hold streams. |
| `NTFY_BASE_URL` | Actual external URL | Medium | Unset, attachment and web-push links resolve to the wrong host. |
| ntfy access control | Configure post-deploy | Medium | Left default, any client can publish to and subscribe from any topic on a public IP. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `application_version` | Pin `v2.x.y` in prod | Low | `latest` maps to a pinned base (`v2.11.0`); pin explicitly to control upgrades. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
ntfy-specific application configuration shared with the Cloud Run variant is
described in **[Ntfy_Common](Ntfy_Common.md)**.
