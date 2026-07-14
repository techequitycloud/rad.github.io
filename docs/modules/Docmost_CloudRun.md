---
title: "Docmost on Google Cloud Run"
description: "Configuration reference for deploying Docmost on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Docmost on Google Cloud Run

Docmost is an open-source, real-time collaborative wiki and documentation platform
(a Confluence/Notion alternative) built on NestJS. This module deploys Docmost on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Docmost uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Docmost runs as a Node.js (NestJS) container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | NestJS service on port 3000, 1 vCPU / 1 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Docmost does not support MySQL or other engines |
| Cache & collaboration | Redis | **Required** for real-time editing and background queues; enabled by default |
| File storage | Filestore / NFS | Attachments written to the NFS-backed volume at `/app/data/storage` |
| Object storage | Cloud Storage | A data bucket provisioned automatically (unused by the default `local` driver) |
| Secrets | Secret Manager | Auto-generated `APP_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Redis is required and on by default.** Docmost uses Redis for real-time
  collaborative editing and background job queues. `enable_redis = true` is the
  default; leaving `redis_host` empty co-locates Redis on the NFS server VM.
- **NFS is enabled by default** (`enable_nfs = true`, `nfs_mount_path = /app/data/storage`).
  Docmost's `local` storage driver writes uploaded attachments there so they survive
  restarts and are shared across instances.
- **`APP_SECRET` is generated automatically** and stored in Secret Manager. It signs
  and encrypts sessions and sensitive data and must never be rotated after first boot
  without a maintenance window — rotating it logs everyone out and makes data
  encrypted under the old value unrecoverable.
- **The database is reached over the private IP, not the socket.** Docmost's
  `postgres.js` driver cannot use the Cloud SQL Unix socket path (its colons break URL
  parsing), so the entrypoint connects to the Cloud SQL **private IP over TCP with
  `sslmode=require`**. `enable_cloudsql_volume = true` still mounts the socket for the
  `db-init` job.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max_instance_count = 1`).
  Cold starts add a few seconds of latency after idle; set `min_instance_count = 1` to
  keep the collaboration endpoint warm.
- **`APP_URL` is injected as the predicted service URL** (via `service_url_env_var_name = "APP_URL"`)
  and used to build absolute links and the editor collaboration WebSocket endpoint.
- **First-run setup is via the UI.** Docmost has no default credentials — the first
  visitor creates the initial workspace and administrator account.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Docmost service

Docmost runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Docmost stores all application data (spaces, pages, comments, users, permissions) in a
managed Cloud SQL for PostgreSQL 15 instance. On Cloud Run the running service connects
to the Cloud SQL **private IP over TCP with SSL** (the `postgres.js` driver cannot use
the Auth Proxy socket path); the `db-init` job connects through the mounted socket. On
first deploy that Job creates the application database and user; Docmost then applies
its own schema migrations automatically on boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs).
See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

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
  # Confirm the assembled REDIS_URL is present in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Cloud Storage & NFS file storage

Docmost writes uploaded attachments to its `local` storage driver at
`/app/data/storage`, which is backed by the **NFS** volume so files persist and are
shared across instances. A dedicated **Cloud Storage** data bucket is also provisioned
automatically (available if you switch Docmost to an object-storage driver).

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for NFS, GCS Fuse, and CMEK options.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`APP_SECRET` (used to sign and encrypt sessions and sensitive data). The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docmost"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows the public access needed to share wiki pages and reach the collaboration
endpoint. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud
Armor can be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Docmost Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy socket and
  idempotently creates the application database and user and grants privileges. The
  job is safe to re-run.
- **Migrations run automatically on start.** Docmost runs its own schema migrations on
  every boot via its default `pnpm start` command, so upgrading the application version
  applies schema changes with no separate migration step.
- **`APP_SECRET` is immutable after first boot.** It is generated once and written to
  Secret Manager. Rotating it invalidates all existing sessions and makes data
  encrypted under the old value unrecoverable — only rotate in a planned maintenance
  window.
- **`APP_URL` must match the real service URL.** It is injected as the predicted
  `run.app` URL and used for absolute links and the collaboration WebSocket. If you put
  Docmost behind a custom domain, set `APP_URL` (via `environment_variables`) to that
  external URL. Inspect the running revision:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Health path.** Startup and liveness probes target `/api/health` — Docmost's public
  200 endpoint. Allow ~2 minutes on first boot (60-second initial delay plus the retry
  window) while migrations run.
- **First-run account creation.** Docmost ships with no default credentials. Browse to
  the service URL and complete the setup form to create the first workspace and admin
  user. Do this promptly after deploy so no one else can claim the workspace.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Docmost are listed; every other input is inherited from
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
| `application_name` | `docmost` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Docmost` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Docmost image tag (mapped to the `DOCMOST_VERSION` build ARG); pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance (1 vCPU). |
| `memory_limit` | `1Gi` | Memory per instance. |
| `cpu_always_allocated` | `false` | Request-based billing; CPU billed only while serving. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to keep the collaboration endpoint warm. |
| `max_instance_count` | `1` | Increase only with Redis enabled (it is, by default). |
| `container_port` | `3000` | Docmost listens on port 3000. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Mounts the Cloud SQL Auth Proxy socket (used by `db-init`). |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows public access to shared pages and the collaboration endpoint. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Docmost. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core values (`NODE_ENV`, `STORAGE_DRIVER`, `APP_URL`) are set automatically — do not set `APP_SECRET`, `DATABASE_URL`, or `REDIS_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `service_url_env_var_name` | `APP_URL` | Injects the predicted service URL as `APP_URL`. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the GCS buckets defined in `storage_buckets`. |
| `enable_nfs` | `true` | NFS is **on** by default — backs the `/app/data/storage` attachment path. |
| `nfs_mount_path` | `/app/data/storage` | Mount path matching Docmost's local storage driver. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Docmost requires PostgreSQL 15. |
| `db_name` | `docmost` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `docmost` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 60s delay | Startup probe. Allow ~2 minutes on first boot. |
| `liveness_probe` | HTTP `/api/health` 60s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Cloud Monitoring uptime check; disabled by default (when the endpoint is public). |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required** — Docmost uses Redis for real-time editing and queues. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all sessions and makes data encrypted under the old value unrecoverable. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Docmost requires PostgreSQL 15; any other engine breaks startup. |
| `enable_redis` | `true` | Critical | Docmost's real-time editor and job queues need Redis; disabling it prevents the app from working correctly. |
| `enable_nfs` | `true` | High | With NFS off, uploaded attachments land on ephemeral disk and are lost on restart / not shared across instances. |
| `APP_URL` | Actual service / custom-domain URL | High | A wrong URL breaks absolute links and the collaboration WebSocket endpoint. |
| `max_instance_count` | Increase only with Redis | High | Multiple instances without shared Redis coordination degrade collaborative editing. |
| `ingress_settings` | `all` | High | `internal` blocks external sharing and the public collaboration endpoint. |
| `enable_iap` | only for private wikis | Medium | IAP blocks all unauthenticated access, including anonymous page views if you use them. |
| `memory_limit` | `1Gi`+ | Medium | Very small limits risk OOM under concurrent editing/upload load. |
| `min_instance_count` | `1` for latency-sensitive use | Medium | Scale-to-zero (`0`) adds a cold-start delay on the first request after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Docmost-specific application configuration shared
with the GKE variant is described in **[Docmost_Common](Docmost_Common.md)**.
