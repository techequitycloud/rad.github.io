---
title: "PocketBase on Google Cloud Run"
description: "Configuration reference for deploying PocketBase on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# PocketBase on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PocketBase_CloudRun.png" alt="PocketBase on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PocketBase is an open-source backend in a single file — an embedded SQLite database with
a realtime REST API, built-in authentication, file storage, and an admin dashboard. This
module deploys PocketBase on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services PocketBase uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to every
Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups,
and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md)
rather than repeating them here.

---

## 1. Overview

PocketBase runs as a single self-contained Go binary on Cloud Run v2. The deployment wires
together a deliberately minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go binary, 1 vCPU / 1 GiB by default, listens on port **8090** |
| Database | **Embedded SQLite** | No Cloud SQL — the database lives in `/pb_data`, persisted to Cloud Storage |
| Persistent storage | Cloud Storage (GCS FUSE) | A dedicated data bucket mounted at `/pb_data` (gen2 required) |
| Cache & queue | **None** | PocketBase uses no Redis; `enable_redis = false` |
| Secrets | Secret Manager | None auto-generated — auth lives inside SQLite; secrets optional for your own use |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (`ingress = all`); optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **The database is embedded SQLite — there is no Cloud SQL.** PocketBase stores every
  record, auth token, and uploaded file under `/pb_data`, which is mounted from a Cloud
  Storage bucket via GCS FUSE. Losing or wiping that bucket loses all data.
- **`max_instance_count` must stay at `1`.** SQLite is a single-writer database and the
  `/pb_data` FUSE mount is not safe for concurrent writers. Running more than one instance
  corrupts the database. This is why both min and max default to `1`.
- **`min_instance_count = 1` by default** (no scale-to-zero). Keeping one instance warm
  avoids cold-start latency and keeps the single SQLite writer live. Cloud Run cold starts
  would otherwise add first-request latency after idle.
- **The admin account is created interactively on first run at `/_/`.** No admin password
  is injected. Whoever reaches `/_/` first creates the superuser — open the admin URL and
  create it **immediately** after deploy.
- **No secret is auto-generated.** PocketBase issues and stores all auth itself; Secret
  Manager is used only if you add your own secrets (SMTP, external backup keys, etc.).
- **Public ingress by default.** `ingress_settings = "all"` — PocketBase is a user-facing
  web app (admin UI at `/_/` plus a public REST API). Enabling IAP will block public API
  and app traffic.
- **NFS and Redis are disabled.** PocketBase needs neither; all state is the single
  `/pb_data` volume.
- **gen2 execution environment** is required for the GCS FUSE `/pb_data` mount.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the PocketBase service

PocketBase runs as a Cloud Run v2 service listening on port **8090**. Each deployment
creates an immutable revision; traffic can be split across revisions for safe rollouts.
Keep it at a single instance (see §3).

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Database — embedded SQLite (no Cloud SQL)

There is **no Cloud SQL instance**. PocketBase's database is a set of SQLite files inside
`/pb_data`, which is mounted from the Cloud Storage data bucket. To inspect or back up the
database you work with the bucket contents, not a SQL endpoint.

- **Console:** Cloud Storage → Buckets → the PocketBase data bucket → `pb_data/`.
- **CLI:**
  ```bash
  # Confirm the service reports NO Cloud SQL attachment:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.metadata.annotations)'
  # Copy the SQLite database out of the bucket for an offline backup / inspection:
  gcloud storage cp gs://<data-bucket>/data.db ./pb_data-backup.db
  ```

### C. Cloud Storage — the `/pb_data` volume

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned automatically and
mounted at `/pb_data` via GCS FUSE. It holds the SQLite database, uploaded files, and
settings — everything PocketBase persists.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  gcloud storage du -s gs://<data-bucket>/        # total data size
  ```

See [App_CloudRun](App_CloudRun.md) for GCS FUSE and CMEK options. The bucket enforces
public-access prevention.

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

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress = all`), which allows
the public access PocketBase's app and API need. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. PocketBase Application Behaviour

- **No first-deploy database job.** PocketBase creates its own SQLite database, system
  collections, and schema on first start under `/pb_data`. There is no `db-init` job to run
  or monitor.
- **Migrations apply automatically on start.** PocketBase runs any pending schema
  migrations itself on every startup, so upgrading `application_version` applies schema
  changes with no separate migration step. Always back up `/pb_data` before a version bump.
- **The admin superuser is created on first run.** Open `https://<service-url>/_/` right
  after deploy and create the administrator account. Until it exists, anyone who reaches
  `/_/` can claim it — treat this as a time-sensitive first-run step.
- **The `/pb_data` volume is the only durable state.** The SQLite database, uploaded files,
  and settings all live there. Protect the data bucket accordingly; back it up on a schedule.
- **Single-instance by design.** SQLite serialises writes through one database file and the
  GCS FUSE mount is single-writer. `min_instance_count` and `max_instance_count` both
  default to `1`; do not raise `max_instance_count`.
- **Health path.** Startup and liveness probes target `/api/health`, PocketBase's public,
  unauthenticated endpoint (returns HTTP `200` / `{"code":200,"message":"API is healthy."}`).
  First boot is fast because there is no external DB to wait on.
- **Verify runtime state:**
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/api/health"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for PocketBase are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

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
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU is comfortable for the single Go binary. |
| `memory_limit` | `1Gi` | Memory per instance; PocketBase is lightweight (512Mi is often enough). |
| `min_instance_count` | `1` | Keep at 1 — avoids cold starts and keeps the single SQLite writer live. |
| `max_instance_count` | `1` | **Do not raise.** SQLite + GCS FUSE are single-writer; >1 corrupts data. |
| `container_port` | `8090` | PocketBase listens on 8090 (HTTP API + admin UI). |
| `execution_environment` | `gen2` | Required for the GCS FUSE `/pb_data` mount. |
| `enable_cloudsql_volume` | `false` | Forced off — PocketBase uses no Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror/build the PocketBase image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access for the app UI and REST API. `internal` restricts to the VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks the public API and admin UI.** |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings for the container (PocketBase needs none for first boot). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (only for your own secrets). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `/pb_data` data bucket and any extra `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `enable_nfs` | `false` | NFS is off — PocketBase persists everything to the `/pb_data` bucket. |
| `gcs_volumes` | `[]` | Extra GCS FUSE volumes (the `/pb_data` volume is added automatically). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — PocketBase uses an embedded SQLite database; no Cloud SQL is created. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, 15s delay | Startup probe; fast because there is no external DB to wait on. |
| `liveness_probe` | HTTP `/api/health`, 30s delay | Liveness probe against the public health endpoint. |
| `uptime_check_config` | disabled, path `/api/health` | Cloud Monitoring uptime check. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `pocketbase_url` | Service URL for the PocketBase HTTP API + admin UI (port 8090). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/pb_data` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any custom setup jobs (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and
> combinations* at plan time — an invalid `container_port`, a `gen1` runtime with GCS FUSE
> mounts, IAP with no authorized identities, out-of-range probe or retention values.
> Invalid configuration fails the **plan** with a clear, named error before any resource is
> created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (never raise) | Critical | SQLite + GCS FUSE are single-writer; more than one instance corrupts the database. |
| The `/pb_data` data bucket | Never delete; back up | Critical | The bucket **is** the database and file store — deleting or wiping it destroys all data. |
| `database_type` | `NONE` (fixed) | Critical | PocketBase has no external DB; selecting an engine provisions unused Cloud SQL and does not change where data lives. |
| Admin account at `/_/` | Create immediately after deploy | Critical | Until the superuser exists, anyone reaching `/_/` can claim it and own the instance. |
| `application_version` bump | Back up `/pb_data` first | High | PocketBase auto-migrates the schema on start; an interrupted upgrade can leave the SQLite DB mid-migration. |
| `execution_environment` | `gen2` | High | gen1 cannot mount the GCS FUSE `/pb_data` volume; the service starts with no persistent data. |
| `ingress_settings` | `all` | High | `internal` blocks the public app UI and REST API from the internet. |
| `enable_iap` | Only for private deployments | High | IAP blocks all unauthenticated requests, including public API clients and the admin UI. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) adds cold-start latency and briefly drops the single SQLite writer between requests. |
| `memory_limit` | `1Gi` (512Mi min) | Low | PocketBase is lightweight; over-provisioning only adds cost. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
PocketBase-specific application configuration shared with the GKE variant is described in
**[PocketBase_Common](PocketBase_Common.md)**.
