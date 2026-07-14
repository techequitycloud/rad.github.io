---
title: "Fider on GKE Autopilot"
description: "Configuration reference for deploying Fider on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Fider on GKE Autopilot

Fider is an open-source, self-hosted feedback and feature-voting board — customers
post ideas, vote, and comment, and you prioritise by demand. This module deploys
Fider on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Fider uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Fider runs as a single Go web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go binary, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Fider does not support MySQL or other engines |
| Object storage | Cloud Storage | A dedicated `storage` bucket provisioned automatically |
| File storage | Cloud Filestore (NFS) | Enabled by default for attachment storage |
| Secrets | Secret Manager | Auto-generated `JWT_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer (`database_type = POSTGRES_15`); selecting any other engine breaks
  startup.
- **`JWT_SECRET` is generated automatically** and stored in Secret Manager. It signs
  all authentication and session tokens (including emailed magic sign-in links) and
  **must never be rotated after first boot** — doing so invalidates all active
  sessions and pending sign-in links.
- **Fider is a single Go binary with no background worker.** All state lives in
  PostgreSQL; there is no queue process. A minimum of 1 replica is kept (GKE does not
  support scale-to-zero).
- **No Redis.** Fider uses a PostgreSQL-backed queue and cache (empty `VALKEY_URL`),
  so `enable_redis` defaults to `false`.
- **NFS is enabled by default** (`enable_nfs = true`) to provide a Cloud Filestore
  mount for attachment storage. Because the pod is NFS-backed, App_GKE deploys it with
  the `Recreate` strategy rather than `RollingUpdate` (two pods on the same NFS volume
  can deadlock on updates).
- **The container listens on port 3000.** On GKE the `PORT` env is **not** auto-injected,
  so the entrypoint exports `PORT = 3000`; `container_port` and the Kubernetes probes
  must both be 3000 or the pod never becomes Ready even though the app is healthy.
- **Schema migrations run on boot.** The custom entrypoint runs `./fider migrate`
  before starting the server.
- **Email is disabled for the demo.** Placeholder SMTP values let the app boot;
  sign-up / invite links are printed to the pod log until real SMTP is wired via
  `environment_variables`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Fider workload

Fider pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and
maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Fider workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Fider stores all application data (posts, votes, comments, users, settings) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1` loopback; no public IP is exposed. On
first deploy the `db-init` Job creates the application role and database; Fider then
runs its own migrations on boot.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned automatically.
The workload service account is granted access. Additional buckets can be declared via
`storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Cloud Filestore (NFS)

NFS is **enabled by default** (`enable_nfs = true`) to give Fider a Cloud Filestore
mount for attachment storage. The shared NFS server VM (managed by `Services_GCP`) must
be `RUNNING` before the app deploys, and NFS-backed pods use the `Recreate` update
strategy.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Fider does **not** use Redis — do not expect a Memorystore or Redis endpoint.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`JWT_SECRET` (signs authentication and session tokens). It is delivered into the pod
via the Secret Store CSI integration. The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys. Set
`BASE_URL` (via `environment_variables`) to the external URL once the IP is known.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available. When email is
disabled, sign-up / invite links appear in the pod logs.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Fider Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `fider` role and database, grants privileges, reassigns ownership of the
  `public` schema to the application role, and signals the proxy sidecar to shut down
  so the Job pod completes. The job is safe to re-run.
- **Schema migrations on start.** The custom entrypoint runs `./fider migrate` before
  launching the server (the image's `CMD` is overridden to `./fider` only). Migrations
  are idempotent, so upgrading the application version applies schema changes on the
  next start without a separate migration step.
- **`JWT_SECRET` is immutable after first boot.** It is generated once and written to
  Secret Manager. Changing it invalidates all active user sessions and any pending
  emailed sign-in links. Only rotate during a planned maintenance window.
- **First-run setup.** There are no default credentials. Browse to the LoadBalancer
  external IP / URL to create the site and its admin owner:
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```
- **Email is off by default.** Placeholder SMTP values let Fider boot with
  `EMAIL_NOEMAIL = true`; sign-up and invite links are printed to the pod log. To send
  real mail, set the Fider SMTP variables via `environment_variables` and remove
  `EMAIL_NOEMAIL`.
- **Health path.** Startup and liveness probes target `/_health` — an unauthenticated
  endpoint returning `200`. The `container_port` and probe port must both be **3000**
  (the entrypoint exports `PORT = 3000`; GKE does not auto-inject it).
- **NFS-backed updates use `Recreate`.** A rolling update would briefly run two pods
  against the same NFS volume and shared database; App_GKE therefore sets the strategy
  to `Recreate` for NFS-backed apps.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Fider are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `fider` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Fider image tag (`getfider/fider:<tag>`), mapped to the `FIDER_VERSION` build ARG. `latest` is pinned to `stable` (no `:latest` tag exists); pin to a SHA tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas; GKE does not support scale-to-zero. |
| `max_instance_count` | `5` | Maximum replicas. |
| `container_port` | `3000` | Fider listens on 3000; probes must match. |
| `container_resources` | 2 vCPU / 4 GiB | CPU/memory limits and requests for the Fider container. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for connections. |
| `enable_image_mirroring` | `true` | Mirror the Fider image into Artifact Registry before deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Wire real SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) or the external `BASE_URL` here. Do not set `DATABASE_URL`, `JWT_SECRET`, or `PORT`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Resolves to `Deployment` (the module's built-in logic); Fider is stateless (state lives in PostgreSQL / NFS). |
| `session_affinity` | `ClientIP` | Sticky routing (default). |
| `container_protocol` | `http1` | Fider serves standard HTTP/1.1. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Defaults to the module's built-in logic. Fider stores state in PostgreSQL and NFS, so per-pod PVCs are not required. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Cloud Filestore mount for Fider attachment storage. NFS-backed pods deploy with `Recreate`. |
| `nfs_mount_path` | `/opt/fider/storage` | Mount path inside the container. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Fider is Postgres-backed; leave off unless externalising to Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only relevant if Redis is enabled. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Fider requires PostgreSQL 15+. |
| `application_database_name` | `fider` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `fider` | Application database user. Immutable after first deploy. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Fider. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `JWT_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions and pending emailed sign-in links. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Any non-PostgreSQL engine breaks startup — Fider is Postgres-only. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `container_port` | `3000` | High | GKE does not auto-inject `PORT`; a mismatched port makes probes hit a dead port and the pod never becomes Ready. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity on GKE. |
| `application_version` | pin a SHA tag; `latest` → `stable` | High | `getfider/fider` has no `:latest` tag; the module pins `latest` to `stable`, but pin explicitly for reproducible upgrades. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `enable_nfs` | `true` (default) | Medium | The shared NFS VM must be `RUNNING` before deploy; NFS-backed pods use `Recreate`, so a rollout briefly takes the pod down. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| SMTP (`EMAIL_SMTP_*`) | Configure for real mail | Medium | Left as placeholders, sign-up / invite links only appear in the logs — no email is sent. |
| `enable_iap` | only when public access not needed | High | IAP blocks all unauthenticated requests, including anonymous browsing of the board. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Fider-specific
application configuration shared with the Cloud Run variant is described in
**[Fider_Common](Fider_Common.md)**.
