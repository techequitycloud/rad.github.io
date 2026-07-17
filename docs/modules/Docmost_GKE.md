---
title: "Docmost on GKE Autopilot"
description: "Configuration reference for deploying Docmost on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Docmost on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docmost_GKE.png" alt="Docmost on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Docmost is an open-source, real-time collaborative wiki and documentation platform
(a Confluence/Notion alternative) built on NestJS. This module deploys Docmost on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Docmost uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Docmost runs as a Node.js (NestJS) web workload on port 3000. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | NestJS pods on port 3000, horizontally autoscaled between 1 and 3 replicas |
| Database | Cloud SQL for PostgreSQL 15 | Required — Docmost does not support MySQL or other engines |
| Cache & collaboration | Redis | **Required** for real-time editing and background queues; enabled by default |
| File storage | Filestore / NFS | Attachments written to the NFS-backed volume at `/app/data/storage` |
| Object storage | Cloud Storage | A data bucket provisioned automatically (unused by the default `local` driver) |
| Secrets | Secret Manager | Auto-generated `APP_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Redis is required and on by default.** Docmost uses Redis for real-time
  collaborative editing and background job queues. `enable_redis = true` is the
  default; leaving `redis_host` empty co-locates Redis on the NFS server VM.
- **NFS is enabled by default** (`enable_nfs = true`, `nfs_mount_path = /app/data/storage`).
  Docmost's `local` storage driver writes uploaded attachments there so they survive
  pod restarts and are shared across replicas.
- **`APP_SECRET` is generated automatically** and stored in Secret Manager (also
  materialised into a Kubernetes Secret via the explicit-secret-values path). It signs
  and encrypts sessions and sensitive data and must never be rotated after first boot
  without a maintenance window.
- **The database is reached via the Cloud SQL Auth Proxy sidecar on `127.0.0.1`**
  (plaintext loopback, `sslmode=disable`) — the entrypoint branches on `DB_HOST` to
  pick the right connection form and SSL mode per platform.
- **A custom image is built via Cloud Build** (`container_image_source = "custom"`,
  base `docmost/docmost:latest`) wrapping the official image with the entrypoint that
  assembles `DATABASE_URL` / `REDIS_URL` / `APP_URL`. Rebuilt images deploy with
  `imagePullPolicy=Always`.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`; GKE does not support
  scale-to-zero) to keep the wiki and collaboration endpoint always reachable.
- **First-run setup is via the UI.** Docmost has no default credentials — the first
  visitor creates the initial workspace and administrator account.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Docmost workload

Docmost pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts. Because attachments live on the shared NFS volume, the
Deployment uses the `Recreate` strategy for updates to avoid two pods writing the same
NFS/DB state during a rollout.

- **Console:** Kubernetes Engine → Workloads → select the Docmost workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Docmost stores all application data (spaces, pages, comments, users, permissions) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over `127.0.0.1` (plaintext loopback); no public IP
is exposed. On first deploy an initialization Job creates the application database and
user; Docmost then applies its own schema migrations automatically on boot.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database (`docmost`), user (`docmost`), and the Secret Manager
secret holding the password are all surfaced in the [Outputs](#5-outputs). For the
connection model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Redis (real-time collaboration & queues)

Redis is **enabled by default** and is required for Docmost's real-time collaborative
editor and background job processing. When `redis_host` is left empty and `enable_nfs`
is true, the NFS server VM's IP is used as the Redis endpoint; set `redis_host`
(and optionally `redis_auth`) to point at a managed/external Redis instead.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_URL is assembled inside the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_URL
  ```

### D. Cloud Storage & NFS file storage

Docmost writes uploaded attachments to its `local` storage driver at
`/app/data/storage`, backed by the **NFS** volume so files persist across pod restarts
and are shared across replicas. A dedicated **Cloud Storage** data bucket is also
provisioned automatically (available if you switch Docmost to an object-storage driver).

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`APP_SECRET` (used to sign and encrypt sessions and sensitive data). On GKE it is also
materialised into a Kubernetes Secret. The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docmost"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Docmost Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application database and user and grants privileges, then signals the
  proxy sidecar to shut down so the Job can complete. The job is safe to re-run.
- **Migrations run automatically on start.** Docmost runs its own schema migrations on
  every boot via its default `pnpm start` command, so upgrading the application version
  applies schema changes with no separate migration step.
- **`APP_SECRET` is immutable after first boot.** It is generated once and written to
  Secret Manager (and a Kubernetes Secret). Rotating it invalidates all existing
  sessions and makes data encrypted under the old value unrecoverable — only rotate in
  a planned maintenance window.
- **`APP_URL` must match the reachable URL.** It is injected as the internal/predicted
  service URL and used for absolute links and the collaboration WebSocket. After the
  external LoadBalancer IP (or custom domain) is known, set `APP_URL` to that external
  URL via `environment_variables` (or patch the Deployment):
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" APP_URL="https://docmost.example.com"
  ```
- **Health path.** Startup and liveness probes target `/api/health` — Docmost's public
  200 endpoint. Allow ~2 minutes on first boot while migrations run.
- **First-run account creation.** Docmost ships with no default credentials. Browse to
  the LoadBalancer IP / domain and complete the setup form to create the first
  workspace and admin user. Do this promptly after deploy.
- **Custom-build rebuilds.** Because the image is custom-built, rebuilt images reuse a
  version tag; App_GKE sets `imagePullPolicy=Always` so nodes pull the fresh image
  rather than serving a stale cached layer.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Docmost are listed; every other input is inherited from
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
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `docmost` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Docmost` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Docmost image tag (mapped to the `DOCMOST_VERSION` build ARG); pin to a specific release in production. |

### Group 4 — Container & Scale

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Docmost is built from a custom Dockerfile wrapping the official image. |
| `container_image` | `docmost/docmost:latest` | Upstream base image the custom build wraps. |
| `container_port` | `3000` | Docmost listens on port 3000. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1 (no scale-to-zero). |
| `max_instance_count` | `3` | Maximum replicas. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for the loopback connection. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry before deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core values (`NODE_ENV`, `STORAGE_DRIVER`, `APP_URL`) are set automatically — do not set `APP_SECRET`, `DATABASE_URL`, or `REDIS_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Resolves to `Deployment` (stateless; state is in Postgres/NFS). |
| `session_affinity` | `ClientIP` | Sticky routing keeps a client's collaboration WebSocket on one pod. |
| `namespace_name` | `""` | Namespace (defaults to the derived per-app namespace). |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave off — Docmost keeps state in PostgreSQL and shared NFS, not per-pod PVCs. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC size (only if a StatefulSet is chosen). |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` / `quota_memory_requests` / `quota_memory_limits` | `false` / `""` / `""` | **Not referenced** — the whole Group 8 block is declared for interface compatibility only; it has no effect on this module's deployment. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health` 60s delay | Startup probe. Allow ~2 minutes on first boot. |
| `health_check_config` | HTTP `/api/health` | Liveness probe. |
| `uptime_check_config` | _(set)_ | Optional Cloud Monitoring uptime check (public endpoint). |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is **on** by default — backs the `/app/data/storage` attachment path. |
| `nfs_mount_path` | `/app/data/storage` | Mount path matching Docmost's local storage driver. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional buckets beyond the auto-provisioned data bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required** — Docmost uses Redis for real-time editing and queues. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Docmost requires PostgreSQL 15. |
| `application_database_name` | `docmost` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `docmost` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length. |

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
| `service_url` | URL to reach Docmost. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`, a bare-integer memory quota. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all sessions and makes data encrypted under the old value unrecoverable. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Docmost requires PostgreSQL 15; any other engine breaks startup. |
| `enable_redis` | `true` | Critical | Docmost's real-time editor and job queues need Redis; disabling it prevents the app from working correctly. |
| `enable_nfs` | `true` | High | With NFS off, uploaded attachments land on ephemeral pod disk and are lost on restart / not shared across replicas. |
| `APP_URL` | External LoadBalancer / domain URL | High | A wrong URL breaks absolute links and the collaboration WebSocket endpoint. |
| `session_affinity` | `ClientIP` | High | Without stickiness, a client's collaboration WebSocket can reconnect to a different pod. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for the loopback PostgreSQL connection. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; keeping 1 ensures the wiki is always reachable. |
| `stateful_pvc_enabled` | leave off | Medium | Per-pod PVCs are unnecessary — Docmost keeps state in Postgres/NFS; enabling adds cost/complexity. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Docmost-specific
application configuration shared with the Cloud Run variant is described in
**[Docmost_Common](Docmost_Common.md)**.
