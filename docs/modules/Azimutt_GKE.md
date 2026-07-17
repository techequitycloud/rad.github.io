---
title: "Azimutt on GKE Autopilot"
description: "Configuration reference for deploying Azimutt on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Azimutt on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_GKE.png" alt="Azimutt on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt is an open-source, next-generation database-schema explorer and ERD (entity
relationship diagram) tool for real-world databases, built with Elixir/Phoenix. It
lets teams explore, document, and design large schemas (thousands of tables), search
across columns and relations, and share diagrams. This module deploys Azimutt on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Azimutt uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Azimutt runs as a single Elixir/Phoenix web workload listening on port **4000**. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Phoenix pods, horizontally autoscaled; bills for requested CPU/memory |
| Database | Cloud SQL for PostgreSQL 15 | Required — Azimutt does not support MySQL or other engines |
| File storage | Cloud Filestore (NFS) | `enable_nfs = true` by default — Azimutt attachment storage survives pod restarts |
| Object storage | Cloud Storage | A bucket is provisioned (available for an S3-compatible file adapter) |
| Secrets | Secret Manager | Auto-generated Phoenix `SECRET_KEY_BASE`; database password |
| Image build | Cloud Build + Artifact Registry | Thin wrapper FROM `ghcr.io/azimuttapp/azimutt`, mirrored into Artifact Registry |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup. All Azimutt project
  data lives in Postgres.
- **Azimutt connects to Postgres over the Auth Proxy loopback (no SSL).** Ecto cannot
  parse the Cloud SQL socket DSN, so on GKE the entrypoint builds `DATABASE_URL`
  against `127.0.0.1` (the Cloud SQL Auth Proxy sidecar, which terminates TLS) with
  `DATABASE_ENABLE_SSL=false`. `enable_cloudsql_volume = true` is required.
- **`container_port` and probes must be 4000.** On GKE the platform does **not**
  auto-inject `PORT`, so the entrypoint defaults `PORT=4000`; the Service port and
  probes must match or the pod never becomes Ready even though the app is healthy.
- **NFS is enabled by default** (`enable_nfs = true`) for Azimutt attachment storage,
  so uploads survive pod restarts and rescheduling.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager.
  Rotating it after first boot signs out every active session; only rotate in a
  maintenance window.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`) — GKE does not
  support scale-to-zero, keeping Azimutt always reachable.
- **Migrations run automatically on every boot** (`/app/bin/migrate && /app/bin/server`);
  allow extra time on the first boot.
- **`application_version = "latest"` maps to Azimutt's `main` tag.** Pin to a specific
  release in production.
- **Sign-up is open by default.** Restrict access after creating your first account.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Azimutt workload

Azimutt pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Azimutt workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> | grep cloud-entrypoint  # resolved DB wiring
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Azimutt stores all application data (schemas, diagrams, layouts, users, sources) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it through the **Cloud SQL
Auth Proxy sidecar** on `127.0.0.1` (TLS terminated by the proxy, so
`DATABASE_ENABLE_SSL=false`). On first deploy an initialization Job creates the
application database and role; Azimutt then runs its own Ecto migrations on boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are all surfaced in the
[Outputs](#5-outputs). For the connection model, backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS) & Cloud Storage

NFS is **enabled by default** (`enable_nfs = true`) so Azimutt's attachment storage
persists across pod restarts and rescheduling; it is mounted at `nfs_mount_path`. A
**Cloud Storage** bucket is also provisioned (available if you switch Azimutt to an
S3-compatible file adapter). Project data itself lives in Postgres.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, CMEK options, and GCS Fuse mounts.

### D. Secret Manager

The Phoenix **`SECRET_KEY_BASE`** is generated automatically and stored in Secret
Manager (used to sign and encrypt session cookies). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Cloud Build & Artifact Registry

Azimutt's image is a thin wrapper built FROM `ghcr.io/azimuttapp/azimutt`; Cloud Build
produces the wrapped image and it is mirrored into Artifact Registry
(`enable_image_mirroring = true`). Because it is a rebuilt/mirrored image, App_GKE sets
`imagePullPolicy = Always` so nodes never serve a stale cached layer.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.
`session_affinity = ClientIP` keeps a client pinned to one pod.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available. The
`cloud-entrypoint` lines show the resolved `DATABASE_URL` path, `PHX_HOST`, and `PORT`.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Azimutt Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role
  (`LOGIN CREATEDB`) and database, grants `ALL` on the database and the `public`
  schema, and `ALTER`s the schema owner — Azimutt needs full DDL rights because it
  runs its own migrations. The job then signals the Auth Proxy sidecar to shut down
  (`/quitquitquit`) so the Job pod completes. Safe to re-run.
- **Migrations run on start.** The container command is
  `/app/bin/migrate && /app/bin/server`, so Ecto applies pending migrations on every
  boot before the Phoenix endpoint binds. Upgrading `application_version` applies
  schema changes automatically.
- **Runtime DB wiring is composed by the entrypoint.** On GKE `DATABASE_URL` is built
  against the Auth Proxy loopback (`127.0.0.1`) with `DATABASE_ENABLE_SSL=false`, and
  `PORT` is defaulted to 4000 (GKE does not auto-inject it). `PHX_HOST` is derived
  from the injected service URL.
- **`SECRET_KEY_BASE` is stable and effectively immutable.** Rotating it invalidates
  every active session cookie — all users are signed out. Only rotate in a maintenance
  window.
- **Health path.** The startup and liveness probes target the Phoenix root `/` with a
  60-second initial delay. The probes and `container_port` must both be **4000** or
  the pod never becomes Ready.
- **First-run setup.** Reach the service via its external LoadBalancer IP (or custom
  domain) and create the first Azimutt account through the sign-up page. Sign-up is
  open by default — restrict access afterwards.
- **Inspect the init job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Azimutt are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `azimutt` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Azimutt` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Azimutt image tag; `latest` maps to the `main` tag. Pin to a release in production. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas; GKE does not support scale-to-zero. |
| `max_instance_count` | `5` | Maximum replicas. |
| `container_port` | `4000` | Phoenix listens on 4000; probes and Service port must match. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar for the `127.0.0.1` DB connection; required. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Deployment by default; auto-resolves to StatefulSet if `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client stays on one pod. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave unset — Azimutt is NFS-backed and stores project data in Postgres. |

All other inputs follow standard App_GKE behaviour.

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |

All other inputs follow standard App_GKE behaviour.

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, 30 × 15s failure window | Startup probe; allow time for first-boot migrations. Must target port 4000. |
| `liveness_probe` | HTTP `/`, 60s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, App_GKE-level infrastructure probes | Structured probes. |
| `uptime_check_config` | disabled, path `/` | Optional Cloud Monitoring uptime check. |

All other inputs follow standard App_GKE behaviour.

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

All other inputs follow standard App_GKE behaviour.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Cloud Filestore for Azimutt attachment storage (on by default). |
| `nfs_mount_path` | `/opt/azimutt/storage` | Mount path inside the container. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default — Azimutt uses PostgreSQL (Oban) for background jobs, not Redis. |
| `redis_host` | `""` | Redis endpoint (only if a downstream feature requires it). |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `azimutt` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `azimutt` | Application database user. Immutable after first deploy. |

All other inputs follow standard App_GKE behaviour.

### Groups 19–22 — Custom Domain, IAP, Cloud Armor, VPC-SC

Standard App_GKE behaviour — `enable_custom_domain`, `reserve_static_ip`,
`enable_iap`, `enable_cloud_armor`, `enable_vpc_sc`, `enable_audit_logging`. See
[App_GKE](App_GKE.md).

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
| `service_url` | URL to reach Azimutt. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`, a bare-integer `quota_memory_*`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-generated) | Never rotate outside a maintenance window | Critical | Rotating it invalidates every active session cookie — all users are signed out. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and orphans all Azimutt data. |
| `container_port` | `4000` | Critical | The entrypoint defaults `PORT=4000` on GKE; a mismatched Service port or probe port hits a dead port and the pod never becomes Ready. |
| `enable_cloudsql_volume` | `true` | Critical | The Auth Proxy sidecar provides the `127.0.0.1` DB connection; disabling it leaves Azimutt with no database and blocks the `db-init` bootstrap. |
| `enable_nfs` | `true` | High | Disabling it puts Azimutt attachments on ephemeral pod disk — they are lost on restart/reschedule. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `application_version` | Pin a release | High | `latest` maps to the rolling `main` tag; an unexpected upstream change can break a redeploy. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, UI sessions bounce between pods. |
| `enable_iap` / custom domain | Restrict after first account | High | Sign-up is open by default; leaving the LoadBalancer publicly reachable lets anyone create an account. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `enable_redis` | `false` | Low | Azimutt uses Postgres/Oban, not Redis — enabling it has no effect on Azimutt itself. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Azimutt-specific
application configuration shared with the Cloud Run variant is described in
**[Azimutt_Common](Azimutt_Common.md)**.
