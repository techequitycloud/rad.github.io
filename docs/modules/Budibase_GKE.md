---
title: "Budibase on GKE Autopilot"
description: "Configuration reference for deploying Budibase on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Budibase on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Budibase_GKE.png" alt="Budibase on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Budibase is an open-source low-code platform for building internal tools, business
apps, and workflows on top of your data. This module deploys Budibase on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Budibase uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Budibase runs as a single **all-in-one** pod. The official `budibase/budibase` image
bundles **CouchDB + MinIO + Redis** and the Budibase apps/worker/proxy together and
serves HTTP on **port 80** — there is no external managed database. Because all state
lives on `/data`, the GKE variant runs as a **StatefulSet** with a block PVC mounted
at `/data`. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single all-in-one pod, 2 vCPU / 4 GiB by default; runs as **one** replica (min = max = 1) |
| Persistent state | Persistent Disk (block PVC) | `stateful_pvc_enabled = true` → StatefulSet with a 20 GiB PVC mounted at `/data` |
| Database | None (bundled CouchDB) | `database_type = "NONE"` — CouchDB, MinIO, and Redis all run inside the pod |
| Object storage | Cloud Storage | One data bucket provisioned automatically; Budibase's own asset store is the bundled MinIO |
| Cache & queue | Bundled Redis | Runs inside the pod on loopback; `enable_redis` is off by default |
| Secrets | Secret Manager | Seven auto-generated internal credentials injected as service secret env vars |
| Ingress | Cloud Load Balancing | External LoadBalancer Service by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **StatefulSet with a block PVC on `/data`.** `stateful_pvc_enabled = true` (default),
  which auto-resolves `workload_type` to `StatefulSet`. All CouchDB documents and
  MinIO objects persist to a 20 GiB `standard-rwo` PVC mounted at `/data`, so the data
  survives pod restarts and redeploys.
- **Runs as a single replica.** `min_instance_count = 1` and `max_instance_count = 1`.
  The all-in-one pod holds all state on its own PVC, so multiple replicas would not
  share data (split-brain).
- **Seven internal credentials are generated automatically** and stored in Secret
  Manager (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
  `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). These must never be
  rotated after first boot — the data on `/data` is keyed with them and becomes
  unreadable if they change.
- **Port 80 is fixed.** The all-in-one image's nginx proxy serves the whole app on
  port 80, so `container_port` and the pod probes are pinned to 80.
- **No external database or `db-init` job.** Budibase self-provisions CouchDB and
  MinIO on first boot; `database_type` defaults to `NONE`.
- **External LoadBalancer by default.** `service_type = "LoadBalancer"` exposes an
  external IP; a static IP and custom domain can be layered on.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Budibase workload

Budibase runs as a **StatefulSet** pod on Autopilot, which bills for the CPU/memory
the pod requests. Because it holds all state on its PVC it runs as a single replica.

- **Console:** Kubernetes Engine → Workloads → select the Budibase workload to see
  the pod, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent state (block PVC on `/data`)

All Budibase state — the bundled CouchDB document store and MinIO object store —
persists to a **block Persistent Disk** provisioned via the StatefulSet PVC template
(`stateful_pvc_size = 20Gi`, `stateful_pvc_storage_class = standard-rwo`) and mounted
at `/data`. This is what makes GKE the durable Budibase platform.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims; Compute
  Engine → Disks.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  # Confirm the /data mount inside the pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- df -h /data
  ```

### C. Data store (bundled CouchDB + MinIO)

There is **no Cloud SQL instance** — `database_type = "NONE"`. CouchDB and MinIO run
**inside the pod** and persist to the `/data` PVC. Inspect them via the pod rather
than a managed DB console:

- **CLI:**
  ```bash
  # Confirm database_type=NONE and the bundled-service env in the running pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -Ei 'couch|minio|redis'
  ```

### D. Cloud Storage

A dedicated **Cloud Storage** bucket (name suffix `storage`) is provisioned
automatically. Budibase's own asset/attachment store is the bundled MinIO on `/data`;
this GCS bucket is available for foundation-level storage integration.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Redis (bundled)

Redis runs **inside the pod** on loopback, authenticated with the auto-generated
`REDIS_PASSWORD`. `enable_redis` is **off by default** — do not enable an external
Redis unless deliberately externalising the cache.

- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -i redis
  ```

### F. Secret Manager

Seven internal credentials are generated automatically and stored in Secret Manager,
then injected as service secret env vars: `INTERNAL_API_KEY`, `JWT_SECRET`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, and
`COUCH_DB_PASSWORD`. They must never be rotated after first boot.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~budibase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and
[Budibase_Common](Budibase_Common.md) for what each secret protects.

### G. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = "LoadBalancer"`). A custom domain with a Google-managed certificate
can be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### H. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Budibase Application Behaviour

- **No external database bootstrap.** With `database_type = "NONE"` there is no
  `db-init` job. Budibase self-provisions its bundled CouchDB and MinIO on first boot
  inside the pod. Only user-supplied `initialization_jobs` are honoured.
- **State persists on the `/data` PVC.** CouchDB documents and MinIO objects are
  written to the block PVC mounted at `/data`, so data survives pod restarts,
  reschedules, and version upgrades. Size the PVC generously
  (`stateful_pvc_size = 20Gi` default) — it grows with app data and attachments.
- **Internal credentials are immutable after first boot.** The seven generated
  secrets key the data on `/data`. Changing `API_ENCRYPTION_KEY` corrupts all
  encrypted stored data; changing `JWT_SECRET` invalidates all sessions; changing the
  MinIO or CouchDB credentials breaks access to the object/document stores on the PVC.
  Only rotate during a planned reset.
- **First-run setup.** Budibase self-hosted ships with **no default admin account**.
  Reach the LoadBalancer URL after deploy and create the initial administrator
  (email + password) through the setup screen before use.
- **Health path.** Startup and liveness probes target the unauthenticated root `/`,
  which returns `200` once the bundled services are up. Allow up to ~8-9 minutes on
  first boot (the startup probe uses a 60-second initial delay plus a 30-retry window
  at a 15-second period) — the pod must start CouchDB, MinIO, Redis, and the app tier.
- **Single-replica StatefulSet.** Keep `min_instance_count = max_instance_count = 1`;
  the data store is bound to one PVC and cannot be shared across replicas.
- **Verify the running workload:**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- curl -s -o /dev/null -w '%{http_code}' localhost:80/
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Budibase are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `budibase` | Base name for resources. Do not change after first deploy. |
| `application_version` | `3.39.29` | Budibase image tag; used as `FROM budibase/budibase:<tag>` for the thin wrapper build. Increment to trigger a new build. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_port` | `80` | The all-in-one image's nginx proxy serves the whole app on port 80 — the container_port and probes must be 80. |
| `container_resources` | `2000m` / `4Gi` | CPU and memory per pod; the bundled CouchDB/MinIO/Redis + app tier need generous memory. |
| `min_instance_count` | `1` | Keep at 1 — the data store is bound to a single PVC. |
| `max_instance_count` | `1` | Keep at 1 — replicas would not share `/data`. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposes an external IP for the UI. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves to `StatefulSet` because `stateful_pvc_enabled = true`. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Must stay true.** Budibase keeps all state on `/data`; a block PVC is mounted there. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; grows with app data and attachments — size generously. |
| `stateful_pvc_mount_path` | `/data` | Where the PVC is mounted — Budibase's CouchDB + MinIO data dir. |
| `stateful_pvc_storage_class` | `standard-rwo` | Block StorageClass for the PVC. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Redis runs inside the pod; leave off unless externalising the cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only used if an external Redis is enabled. |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Budibase bundles its own CouchDB; no external managed database is provisioned. |

All other inputs follow standard App_GKE behaviour.

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
| `service_url` | URL to reach Budibase. |
| `database_instance_name` / `database_name` / `database_user` | Populated only if a managed DB is used; empty for Budibase (`database_type = NONE`). |
| `database_password_secret` / `database_host` / `database_port` | DB secret / endpoint / port (unused for Budibase). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of any user-supplied setup and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true`, `quota_memory_*` without binary unit suffixes, an out-of-range `container_port`, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | With it false Budibase has no durable `/data` — all CouchDB + MinIO state is lost on any pod restart/reschedule. |
| `API_ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it corrupts all encrypted stored data — it cannot be decrypted. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `COUCH_DB_PASSWORD` (auto-generated) | Never rotate after first boot | Critical | Rotating breaks access to the bundled object/document stores on the `/data` PVC. |
| `max_instance_count` | `1` | Critical | More than one replica cannot share the single `/data` PVC — split-brain and data loss. |
| `JWT_SECRET` (auto-generated) | Only rotate in a maintenance window | High | Rotating it invalidates all active user sessions, forcing immediate re-login. |
| `workload_type` | `null` (auto → StatefulSet) | High | Forcing `Deployment` with `stateful_pvc_enabled = true` fails the plan; a Deployment cannot template per-pod PVCs. |
| `container_port` | `80` | High | The nginx proxy serves the app on 80; any other port fails the probes and the pod never becomes Ready. |
| `database_type` | `NONE` | High | Selecting an external engine provisions an unused Cloud SQL instance; Budibase never connects to it. |
| `memory_limit` | `4Gi` | High | Running CouchDB + MinIO + Redis + the app tier below ~2 GiB causes OOM kills at startup. |
| `stateful_pvc_size` | `20Gi`+ | Medium | Undersizing risks the PVC filling as app data/attachments grow, wedging CouchDB/MinIO writes. |
| First admin account | Create immediately after deploy | High | Budibase self-hosted ships with no default admin — an unclaimed instance can be claimed by anyone who reaches the URL. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Budibase-specific application configuration shared with the Cloud Run variant is
described in **[Budibase_Common](Budibase_Common.md)**.
