---
title: "Focalboard on GKE Autopilot"
description: "Configuration reference for deploying Focalboard on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Focalboard on GKE Autopilot

Focalboard is an open-source, self-hosted project-management and Kanban board tool
from Mattermost — a Trello/Asana/Notion-boards alternative with multiple board views
(kanban, table, gallery, calendar) for organizing tasks with boards and cards. This
module deploys Focalboard on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Focalboard uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Focalboard runs as a single Go/React web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Defaults to a **StatefulSet** (see below), Focalboard server on port `8000`, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — engine locked to PostgreSQL 13/14/15 (or `NONE`); MySQL is rejected at plan time |
| Block storage | Persistent Disk (per-pod PVC) | `10Gi` `standard-rwo` (SSD) PVC mounted at `/data`, backing Focalboard's attachment storage (`FOCALBOARD_FILESPATH`) |
| File persistence | Cloud Filestore (NFS) | Provisioned by default (`enable_nfs = true`) at `/opt/focalboard/storage`, but not the path Focalboard actually writes attachments to — see pitfalls |
| Object storage | Cloud Storage | A `storage`-suffixed bucket is always provisioned; only gcsfuse-mounted at the data dir when the block PVC is disabled |
| Secrets | Secret Manager | Auto-generated `FOCALBOARD_ADMIN_PASSWORD`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; custom domain routing enabled by default |

**Sensible defaults worth knowing up front:**

- **PostgreSQL only.** `database_type` defaults to `POSTGRES_15`; a plan-time
  precondition in `validation.tf` rejects anything other than `POSTGRES_13`,
  `POSTGRES_14`, `POSTGRES_15`, or `NONE` — MySQL is not supported.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** On GKE, `DB_HOST`
  resolves to `127.0.0.1` (the cloud-sql-proxy sidecar), and the entrypoint builds a
  plaintext (`sslmode=disable`) libpq DSN for that case.
- **The workload defaults to a StatefulSet, not a Deployment.** `stateful_pvc_enabled
  = true` by default, which auto-resolves `workload_type` to `StatefulSet` (per the
  repo-wide convention — see [App_GKE](App_GKE.md) Group 7). Each pod replica gets
  its **own isolated** `10Gi` `standard-rwo` PVC mounted at `/data` — attachments are
  **not** shared across replicas.
- **`min_instance_count = 1`, `max_instance_count = 5` by default** — but because
  storage is a per-pod PVC (not a shared filesystem), scaling to more than one
  replica splits uploaded board attachments across isolated volumes; see the
  pitfalls table before raising `max_instance_count`.
- **NFS is provisioned by default but not used by Focalboard's own storage path.**
  `enable_nfs = true` mounts Filestore at `nfs_mount_path`
  (`/opt/focalboard/storage`), a different path from the block-PVC-backed
  `FOCALBOARD_FILESPATH` (`/data`) that the entrypoint actually configures.
- **Session affinity is `ClientIP`** so a client's requests reach the same pod.
- **No separate migration job.** Focalboard runs its own schema migrations on boot
  as the application database user (see `Focalboard_Common/main.tf`); the `db-init`
  job only creates the database, role, and grants.
- **`FOCALBOARD_ADMIN_PASSWORD` is generated automatically** and stored in Secret
  Manager, injected as a container secret env var — see the caveat in
  [Section 3](#3-focalboard-application-behaviour) about whether the Focalboard
  server itself consumes it.
- **The service URL is filled in automatically.** The entrypoint's `serverRoot`
  falls back through `FOCALBOARD_SERVER_ROOT` → `CLOUDRUN_SERVICE_URL` →
  `GKE_SERVICE_URL` → `http://localhost:8000`; App_GKE injects `GKE_SERVICE_URL`
  for every GKE workload, so no manual post-deploy URL step is required.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Focalboard workload

By default Focalboard runs as a **StatefulSet** (because `stateful_pvc_enabled =
true` is the module default), giving the single pod a stable identity and its own
PVC. If you disable the block PVC, the workload resolves to a `Deployment` instead.

- **Console:** Kubernetes Engine → Workloads → select the Focalboard workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app=focalboard --tail=100
  ```

See [App_GKE](App_GKE.md) Group 6 (Backend Config) and Group 7 (StatefulSet/PVC)
for how workload type and Autopilot scaling are resolved.

### B. Cloud SQL for PostgreSQL 15

Focalboard stores all application data (boards, cards, blocks, users) in a managed
Cloud SQL for PostgreSQL 15 instance. Pods reach it through the **Cloud SQL Auth
Proxy** sidecar on `127.0.0.1:5432`; no public IP is exposed. On first deploy, the
`db-init` job (`postgres:15-alpine`) idempotently creates the application database,
role, and grants — Focalboard's own binary then runs schema migrations on boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the
connection model, automated backups, and password rotation.

### C. Block storage (PVC) & Cloud Storage

Uploaded board attachments persist under `FOCALBOARD_FILESPATH` (default `/data`),
backed by a `10Gi` `standard-rwo` (SSD-class Balanced Persistent Disk) PVC created
per pod by the StatefulSet. A separate Cloud Storage bucket is always provisioned
but only gcsfuse-mounted at the data dir when the block PVC is disabled (avoiding a
double-mount, since gcsfuse can corrupt Focalboard's index/media files).

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims; Cloud Storage →
  Buckets.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud storage buckets list --project "$PROJECT" --filter="name~focalboard"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) Group 7 (StatefulSet/PVC), Group 13 (NFS), and Group 14
(Cloud Storage/GCS Fuse) for the general mechanics and CMEK options.

### D. Secret Manager

One Focalboard-specific secret is generated automatically and stored in Secret
Manager: `FOCALBOARD_ADMIN_PASSWORD` (a random 24-character password). The database
password is managed separately by the foundation. On GKE, secrets are projected
into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~focalboard"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true` so the address survives
redeploys) with a Kubernetes Ingress for custom domain routing enabled
(`enable_custom_domain = true`).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available
(`uptime_check_config.enabled` defaults to `false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Focalboard Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It waits for Cloud SQL to accept connections, idempotently
  creates the application role (`CREATEDB` privilege) and database, grants all
  privileges on the database, grants/reassigns the `public` schema to the app user
  (the schema-owner reassignment is non-fatal if it fails), and then signals the
  Cloud SQL Auth Proxy sidecar to shut down (`quitquitquit`) so the Job pod
  completes. The job is safe to re-run (`execute_on_apply = true`).
- **No separate migration job — Focalboard migrates itself on boot.** The
  `Focalboard_Common` module's own comment states this explicitly: "Focalboard runs
  its own schema migrations on boot; no Postgres extensions are required." The
  application user needs full ownership of the `public` schema for this to work,
  which `db-init.sh` grants.
- **Admin account — TODO: not fully confirmed from source.** A `FOCALBOARD_ADMIN_
  PASSWORD` secret is generated and injected as a container secret env var, but the
  `entrypoint.sh` script does **not** reference it when writing `config.json`
  (`authMode` is set to `"native"`). It could not be confirmed from this module's
  source whether the upstream Focalboard binary itself consumes
  `FOCALBOARD_ADMIN_PASSWORD` to bootstrap an admin account, or whether (as is
  common for Focalboard's native auth) the first user to register through the UI
  simply becomes the workspace admin. Retrieve the secret and try it against the
  first login; if it doesn't apply, register the first account through the UI.
- **DB env-var wiring.** `entrypoint.sh` builds a single libpq keyword DSN
  (`dbconfig` in `config.json`) from the Foundation-injected `DB_HOST`/`DB_IP`/
  `DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, branching on the *resolved* host:
  a Cloud Run Unix-socket directory prefers `DB_IP` with `sslmode=require`; a
  loopback host (the GKE proxy sidecar, `127.0.0.1`) uses `sslmode=disable`; any
  other real IP uses `sslmode=require`. On GKE this always resolves to the loopback,
  plaintext-to-the-sidecar case.
- **Attachment storage path.** `FOCALBOARD_FILESPATH` is set to `data_dir`, which
  the GKE variant wires to `stateful_pvc_mount_path` (default `/data`) — the same
  path the per-pod block PVC is mounted at. The Dockerfile pre-creates `/data` with
  `chmod 0777` so a fresh PVC mount is writable at boot regardless of the pod
  running as a non-root UID.
- **Health probes.** Startup probe: **HTTP** `GET /`, `initial_delay_seconds=60`,
  `timeout_seconds=10`, `period_seconds=15`, `failure_threshold=30` (up to ~8.5
  minutes of startup grace). Liveness probe: **HTTP** `GET /`,
  `initial_delay_seconds=60`, `timeout_seconds=5`, `period_seconds=30`,
  `failure_threshold=3`. A readiness probe (**HTTP** `GET /`, `initial_delay=30s`,
  `period=10s`, `failure_threshold=3`) is also hardcoded in `Focalboard_Common` and
  is not exposed as a variable.
- **Service URL resolves automatically.** `serverRoot` in `config.json` falls back
  to `GKE_SERVICE_URL`, which App_GKE injects for every GKE workload — unlike some
  other modules, no manual `environment_variables` patch is required post-deploy
  unless you want a specific custom-domain URL instead.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- cat /opt/focalboard/config.json
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Focalboard are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `focalboard` | Base name for resources. Do not change after first deploy. |
| `application_version` | `7.11.4` | `mattermost/focalboard` image tag used as the custom-build base. Increment to trigger a rebuild; `latest` is pinned to `7.11.4` at build time (not a published upstream tag). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `8000` | Focalboard's native listen port. |
| `container_resources` | `2000m` CPU / `4Gi` memory | Default limits; no explicit request set. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback `127.0.0.1:5432`) — required on GKE. |
| `container_image_source` | `custom` | Built `FROM mattermost/focalboard` as a thin wrapper adding the cloud entrypoint. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Focalboard UI. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves to `StatefulSet` because `stateful_pvc_enabled = true` by default. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 7 — StatefulSet / PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Gives each pod its own block PVC for `/data` (attachments), avoiding gcsfuse corruption of index/media files. Auto-resolves `workload_type` to `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC size. |
| `stateful_pvc_mount_path` | `/data` | Must match Focalboard's `filespath`; also passed as `data_dir` to `Focalboard_Common`, which sets `FOCALBOARD_FILESPATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD-backed Balanced PD; draws the tighter `SSD_TOTAL_GB` quota (see [App_GKE](App_GKE.md) / repo conventions on switching to HDD). |

### Group 10 — Observability

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, 30 retries @ 15s | Governs the actual container startup probe (wired via `Focalboard_Common`, not the generic `startup_probe_config`). |
| `liveness_probe` | HTTP `/`, 60s delay, 3 retries @ 30s | Governs the actual container liveness probe. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Filestore, but Focalboard's own attachment path (`FOCALBOARD_FILESPATH`) is the block PVC at `stateful_pvc_mount_path`, not the NFS mount — see [Section 1](#1-overview). |
| `nfs_mount_path` | `/opt/focalboard/storage` | Where the (currently unused by Focalboard) NFS volume is mounted. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Locked to PostgreSQL 13/14/15 (or `NONE`) by a plan-time precondition — MySQL is rejected. |
| `application_database_name` | `focalboard` | Database name. Effectively immutable after first deploy (renaming orphans existing data). |
| `application_database_user` | `focalboard` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress for custom domain routing is on by default (differs from many other modules, which default this off). |
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
| `service_url` | URL to reach Focalboard. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`) and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (or `13`/`14`) | Critical | A `validation.tf` precondition rejects MySQL and other non-Postgres engines at plan time. |
| `application_database_name` / `application_database_user` | Set once | Critical | Effectively immutable after first deploy; renaming recreates the DB/user and orphans all boards/cards. |
| `max_instance_count` | `1` unless you re-architect storage | Critical | With the default `stateful_pvc_enabled = true`, each replica gets its **own isolated** PVC — attachments uploaded to one pod are invisible from another. Scaling beyond 1 silently splits data, it does not error. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE. |
| `stateful_pvc_enabled` | `true` | High | Disabling it (and relying on gcsfuse instead) risks corrupting Focalboard's index/media files under concurrent writes — this is exactly why the Common module skips the gcsfuse mount when the block PVC is enabled. |
| `stateful_pvc_mount_path` | `/data` (must equal Focalboard's `filespath`) | High | Changing it without also updating `FOCALBOARD_FILESPATH` wiring mounts the PVC somewhere Focalboard never writes to, making it effectively ephemeral. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, requests bounce between pods, which matters more once multiple replicas exist. |
| `enable_nfs` | `true` (but consider `false`) | Medium | Provisions a Filestore instance that Focalboard's own attachment path does not use — an avoidable cost unless something else in your deployment needs it. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Draws the tight `SSD_TOTAL_GB` quota (Qwiklabs ≈ 500 GB); a campaign of stateful modules can exhaust it. Override to `standard` (HDD `pd-standard`) if IOPS aren't needed. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `FOCALBOARD_ADMIN_PASSWORD` (auto-generated) | Retrieve before first login | Medium | Not confirmed to bootstrap a login on its own (see [Section 3](#3-focalboard-application-behaviour)) — the practical first-run step may instead be registering the first user through the UI. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any bookmarked URL. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Focalboard-specific application configuration shared with the Cloud Run variant is
described in **[Focalboard_Common](Focalboard_Common.md)**.
