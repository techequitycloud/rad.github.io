---
title: "Docuseal on GKE Autopilot"
description: "Configuration reference for deploying Docuseal on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Docuseal on GKE Autopilot

DocuSeal is an open-source document-signing platform — a self-hosted DocuSign
alternative for creating, filling, and signing PDF documents with a visual form
builder, reusable templates, and audit trails. This module deploys DocuSeal on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services DocuSeal uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

DocuSeal runs as a single Ruby on Rails (Puma) web workload. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Rails/Puma pods on port 3000, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — DocuSeal does not support MySQL or other engines |
| Persistent documents | Filestore / NFS **or** block PVC | Uploaded documents live at `/data/docuseal` |
| Object storage | Cloud Storage | One bucket provisioned automatically (not the default document store) |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **`container_port = 3000` and the probes must match it.** On GKE the `PORT` env is
  **not** injected (unlike Cloud Run), so Puma uses its config default of 3000. If
  `container_port` or the probes point anywhere else, they hit a dead port and the pod
  never becomes Ready even though the app is healthy.
- **The Auth Proxy sidecar is used on GKE.** `enable_cloudsql_volume = true` runs the
  Cloud SQL Auth Proxy sidecar, so DocuSeal reaches PostgreSQL over `127.0.0.1` (plain
  TCP, TLS terminated by the proxy) — the entrypoint takes the loopback branch.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager. It
  must never be rotated after first boot — doing so invalidates all signed session
  cookies, logging every user out.
- **Uploaded documents need a persistent volume.** By default `enable_nfs = true`
  mounts the shared NFS volume at `/data/docuseal`; alternatively set
  `stateful_pvc_enabled = true` (auto-selects a StatefulSet) with
  `stateful_pvc_mount_path = /data/docuseal` for a per-pod block PVC.
- **Minimum 1 replica** (GKE does not support scale-to-zero); `session_affinity`
  defaults to `ClientIP` and a static IP is reserved so the LoadBalancer address
  survives redeploys.
- **No Redis.** DocuSeal uses a PostgreSQL-backed queue/cache (`enable_redis = false`).
- **Migrations run on boot.** DocuSeal applies its own ActiveRecord migrations on every
  start; the only init job creates the PostgreSQL role and database.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the DocuSeal workload

DocuSeal pods are scheduled on Autopilot, which bills for the CPU/memory the pods
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and
maximum replica counts. When a block PVC is enabled, the workload becomes a
StatefulSet.

- **Console:** Kubernetes Engine → Workloads → select the DocuSeal workload for pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"           # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

DocuSeal stores all application data (templates, submissions, submitters, users, audit
trail) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar over `127.0.0.1`; no public IP is exposed.
On first deploy an initialization Job creates the application database and role.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Persistent documents — NFS or block PVC

DocuSeal writes uploaded documents and attachments to `/data/docuseal`. By default
this is backed by the shared **NFS** volume (`enable_nfs = true`); alternatively a
per-pod **block PVC** (`stateful_pvc_enabled = true`, 10 GiB by default) mounted at the
same path backs it in a StatefulSet.

- **Console:** Filestore → Instances (NFS); Kubernetes Engine → Storage (PVCs).
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /data/docuseal
  ```

See [App_GKE](App_GKE.md) for the NFS discovery model and StatefulSet PVC templates.

### D. Cloud Storage

One **Cloud Storage** bucket (name suffix `storage`) is provisioned automatically and
the workload service account is granted access. DocuSeal's document store defaults to
the persistent volume above, so this bucket is available for auxiliary use rather than
the primary document store.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/           # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`SECRET_KEY_BASE` (used by Rails to sign session cookies and other signed values). The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docuseal"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`) with a reserved static IP so the address survives
redeploys. A custom domain with a Google-managed certificate can be enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr (Rails logs to stdout) flow to Cloud Logging; GKE and Cloud SQL
metrics flow to Cloud Monitoring. Optional uptime checks and alert policies are
available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Docuseal Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `docuseal` role and database, grants full privileges, reassigns
  ownership of the `public` schema to the app role (PostgreSQL 15 no longer grants
  `CREATE` on `public` by default), and signals the proxy sidecar to shut down so the
  Job pod completes. The job is safe to re-run.
- **Migrations on start.** DocuSeal runs its own ActiveRecord migrations automatically
  on every boot as the application role, so upgrading the application version applies
  schema changes without a separate migration step.
- **`SECRET_KEY_BASE` is immutable after first boot.** It is generated once and written
  to Secret Manager. Rotating it invalidates all signed session cookies, forcing every
  user to log in again. Only rotate during a planned maintenance window.
- **Health path.** Startup, liveness, and readiness probes target `/up` — Rails'
  built-in health endpoint, which returns an unauthenticated `200` once the app is up.
  The probes run on port 3000; because GKE does not inject `PORT`, `container_port` and
  the probe port must both be 3000.
- **First-run setup.** DocuSeal has no default credentials. After the LoadBalancer IP
  is assigned, open the service URL and complete the setup screen to create the initial
  administrator account (email + password) before inviting users or creating templates.
- **Persistent documents.** Uploaded documents live at `/data/docuseal` on the NFS
  volume (or the block PVC). Inspect the mount from a pod:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /data/docuseal
  ```
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for DocuSeal are listed; every other input is inherited from
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
| `application_name` | `docuseal` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | DocuSeal image tag (`FROM docuseal/docuseal:<tag>`); pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/memory limits and requests for the DocuSeal container. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1. |
| `max_instance_count` | `5` | Maximum replicas. |
| `container_port` | `3000` | Puma listens on 3000; probes must match. Do not change. |
| `enable_image_mirroring` | `true` | Mirror the DocuSeal image into Artifact Registry. |
| `container_image_source` | `custom` | Thin wrapper built from `docuseal/docuseal`. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core values (`RAILS_LOG_TO_STDOUT`, `WORKDIR`) are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `SECRET_KEY_BASE` is injected automatically. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Auto-selects Deployment; becomes StatefulSet when `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Sticky routing for UI sessions. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `database_type` | `POSTGRES_15` | Fixed PostgreSQL 15 engine. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar → loopback TCP. Keep on. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` for a per-pod block PVC (auto-selects StatefulSet) as an alternative to NFS. |
| `stateful_pvc_mount_path` | `/data/docuseal` | PVC mount path — must match DocuSeal's `WORKDIR`. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_fs_group` | `0` | fsGroup applied to the PVC volume. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, 60s delay, 10s timeout, 15s period, 30 retries | Startup probe against the Rails health endpoint. |
| `liveness_probe` | HTTP `/up`, 60s delay, 5s timeout, 30s period, 3 retries | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check; disabled by default. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (creates role + database). |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Mount the shared NFS volume at `/data/docuseal` for persistent documents (the default persistence model). |
| `nfs_mount_path` | `/data/docuseal` | Mount path — must match DocuSeal's `WORKDIR`. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | DocuSeal uses a PostgreSQL-backed queue/cache; leave off. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `docuseal` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `docuseal` | Application database user. Immutable after first deploy. |

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
| `service_url` | URL to reach DocuSeal. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `Deployment` `workload_type` alongside `stateful_pvc_enabled = true`, non-binary `quota_memory_*` units, IAP with no authorized identities, a `database_type` that does not match an enabled extension. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-generated) | Never rotate after first boot | Critical | Rotating invalidates all signed session cookies — every user is logged out. |
| `enable_nfs` / `stateful_pvc_enabled` | Exactly one enabled | Critical | With neither, documents write to the ephemeral pod disk and are lost on restart/reschedule. |
| `nfs_mount_path` / `stateful_pvc_mount_path` | `/data/docuseal` | Critical | Must match DocuSeal's `WORKDIR`; a mismatched path means documents write to non-persistent storage. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_port` | `3000` | High | GKE does not inject `PORT`; a mismatched port makes probes hit a dead port and the pod never becomes Ready. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar provides the loopback path the entrypoint expects; disabling it breaks DB connectivity on GKE. |
| `workload_type` | `null` / `StatefulSet` | High | Forcing `Deployment` with `stateful_pvc_enabled = true` fails at plan time. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, multi-step signing sessions may route to different pods. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `memory_limit` | `4Gi` | Medium | PDF rendering/signing is memory-hungry; shrinking too far risks OOM under load. |
| `application_version` | Pin in production | Medium | `latest` can pull a new major on redeploy, applying migrations you did not review. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. DocuSeal-specific
application configuration shared with the Cloud Run variant is described in
**[Docuseal_Common](Docuseal_Common.md)**.
