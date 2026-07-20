---
title: "Memos on GKE Autopilot"
description: "Configuration reference for deploying Memos on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Memos on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_GKE.png" alt="Memos on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos is an open-source, MIT-licensed, self-hosted note-taking service built for
quick markdown capture — a single ~20MB Go binary with a React frontend. This
module deploys Memos on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Memos uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common
to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Memos runs as a single Go web workload. The deployment wires together a
deliberately small set of Google Cloud services — Memos has no queue, no cache, and
no background workers:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go pod, 1 vCPU / 512 MiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — this module standardizes on Postgres via a single `MEMOS_DSN` connection URL |
| Object storage | none | Not provisioned by this module — see the attachments note below |
| Cache & queue | none | Memos has no queue or cache dependency |
| Secrets | Secret Manager | Only the database password (managed by the Foundation); Memos itself has no app-level secret |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the standardized engine.** `Memos_Common` fixes
  `database_type = "POSTGRES_15"`.
- **No admin-bootstrap secret exists.** The **first account created through the web
  UI becomes the host/admin** — there is no `DEFAULTUSER`-style env var and nothing
  to retrieve from Secret Manager for first login.
- **`workload_type = "Deployment"`, not `StatefulSet`.** Memos keeps no local state
  that must survive a pod restart beyond what's already in Cloud SQL — no PVC, no
  NFS mount required.
- **Session affinity is not required.** Memos has no in-process WebSocket state
  tied to a specific pod (unlike Activepieces or Gotify's live-push patterns), so
  the default `session_affinity = "None"` is correct.
- **`min_instance_count = 0` / `max_instance_count = 1`.** GKE Autopilot bills per
  running pod; the HPA can scale to zero replicas when idle.
- **The database DSN is computed at container start**, not baked into the image.
  `memos-entrypoint.sh` reads the platform-injected `DB_*` variables — on GKE,
  `DB_HOST` arrives as `127.0.0.1` (the cloud-sql-proxy sidecar) — and builds the
  single `MEMOS_DSN` connection URL Memos expects.
- **No object storage is provisioned.** This module does not declare a GCS bucket,
  volume, or PVC for uploaded file attachments. Text notes persist fully in
  PostgreSQL, but binary attachments would live on the pod's ephemeral filesystem
  and would **not** survive a pod restart.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Memos workload

Memos pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Memos workload to see
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

Memos stores all application data (notes, tags, users, resources metadata) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over `127.0.0.1`; no public IP is exposed. On
first deploy an initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
backups, and password rotation.

### C. Secret Manager

Only the database password secret exists for this module — managed entirely by the
Foundation, not by `Memos_Common`. Memos generates its own internal session-signing
key and stores it in its own database on first boot.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Networking & ingress

The service is exposed via a Kubernetes Service (`LoadBalancer` by default) with an
external IP. A Gateway/Ingress with a custom domain and managed TLS certificate can
be layered on.

- **Console:** Kubernetes Engine → Services & Ingress; Network services → Load
  balancing.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Memos Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh` using `postgres:15-alpine`. It connects through the
  cloud-sql-proxy sidecar and idempotently creates the application role and
  database. The job is safe to re-run.
- **Schema migrations on start.** Memos applies its own internal GORM auto-migrate
  schema setup on every pod start — no separate migration job is needed.
- **No admin-bootstrap credential to retrieve.** The first account created through
  the web UI's sign-up form becomes the host/admin.
- **Database DSN is computed, not static.** `memos-entrypoint.sh` builds
  `MEMOS_DSN` from `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` at
  container start — the loopback branch (`DB_HOST=127.0.0.1`, `sslmode=disable`)
  is taken on GKE, since the cloud-sql-proxy sidecar already terminates TLS. See
  [Memos_Common](Memos_Common.md) for the full branching logic.
- **Health path.** Startup and liveness probes target `/` — Memos's public
  login/landing page, reachable without authentication.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Memos are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the cluster and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `memos` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Memos` | Human-readable name shown in the Console. |
| `application_description` | `Memos note-taking service on GKE` | Workload description. |
| `application_version` | `latest` | Deployment-tracking tag. `Memos_Common` maps `"latest"` to the pinned `MEMOS_VERSION = "0.28.0"` Dockerfile build arg. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the wrapper image with the computed-DSN entrypoint. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `512Mi` | Memory per pod — sufficient for Memos's small footprint. |
| `min_instance_count` | `0` | HPA minReplicas. |
| `max_instance_count` | `1` | HPA maxReplicas; raise for higher concurrent load. |
| `container_port` | `5230` | Memos's native default port — no remapping performed. |
| `enable_cloudsql_volume` | `true` | cloud-sql-proxy sidecar for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Memos image into Artifact Registry. |
| `session_affinity` | `None` | No pod-level session required. |

### Group 5 — Access & Ingress Control

Standard App_GKE service exposure and IAP settings — see [App_GKE](App_GKE.md).
Key inputs: `service_type` (`LoadBalancer` by default), `enable_iap`,
`iap_authorized_users`.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Any `MEMOS_*` value Memos documents can be set here. The database connection (`MEMOS_DSN`, `MEMOS_DRIVER`) is computed automatically — do not set them here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` | `false` | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_GKE Cloud Build integration — see [App_GKE](App_GKE.md).

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[]` | No bucket provisioned by default. |
| `enable_nfs` | `false` | Not used — Memos keeps no state outside PostgreSQL in this module's wiring. |
| `stateful_pvc_enabled` | `false` | Memos is stateless at the pod level; no block PVC needed. |
| `gcs_volumes` | `[]` | Add an entry here (mounted at Memos's data directory) if attachment persistence is required. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Memos_Common`. |
| `application_database_name` | `memos` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `memos` | Application database user. Password auto-generated in Secret Manager. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 30s delay | Startup probe — targets the public login page. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false }` | Cloud Monitoring uptime check; requires a publicly reachable endpoint. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Kubernetes namespace. |
| `service_cluster_ip` | ClusterIP of the Service. |
| `service_external_ip` | External LoadBalancer IP (when `service_type = "LoadBalancer"`). |
| `service_url` | URL of the deployed service. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets — empty by default. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of the setup jobs (includes `db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `kubernetes_ready` | Whether the Kubernetes workload reached Ready state. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| First account created via sign-up | Create it immediately after deploy | Critical | The **first** account to register becomes host/admin — if left open, any visitor who reaches the external IP first claims that role. |
| Public self-registration | Disable after first admin | High | Memos ships with open sign-up by default. |
| `container_image_source` | `custom` (default) | High | `"prebuilt"` deploys the official image directly, which has no logic to compute `MEMOS_DSN` — it must be wired manually or the pod CrashLoopBackOffs on a failed DB connection. |
| `stateful_pvc_enabled` | `false` (default) | Low | Memos needs no block storage; enabling it adds unnecessary SSD quota consumption. |
| `gcs_volumes` for attachments | Add explicitly if needed | Medium | Without it, uploaded binary attachments live on the pod's ephemeral filesystem and do not survive a pod restart. |
| `min_instance_count` | `0` (default) | Low | Scale-to-zero briefly delays the first request after idle while a new pod schedules — Autopilot cold start, not an app bug. |

---

For the foundation behaviour referenced throughout — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Memos-specific application
configuration shared with the Cloud Run variant is described in
**[Memos_Common](Memos_Common.md)**.
