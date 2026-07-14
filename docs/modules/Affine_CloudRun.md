---
title: "AFFiNE on Google Cloud Run"
description: "Configuration reference for deploying AFFiNE on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# AFFiNE on Google Cloud Run

AFFiNE is an open-source, privacy-first knowledge base that unifies docs, whiteboards, and databases in one workspace — a self-hostable alternative to Notion and Miro. This module deploys AFFiNE on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services AFFiNE uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

AFFiNE's self-host server runs as a single Node.js container on Cloud Run v2. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default, single always-on instance |
| Database | Cloud SQL for PostgreSQL 15 | Required — AFFiNE does not support MySQL (enforced at plan time) |
| Real-time collaboration | Redis | **Mandatory** — Yjs document-sync pub/sub and the job queue; the NFS host co-hosts the default Redis |
| Blob storage | Filestore / NFS | Uploaded attachments persisted at `/root/.affine/storage` (gen2 required) |
| Object storage | Cloud Storage | A dedicated `storage` bucket provisioned automatically |
| Secrets | Secret Manager | Database password managed automatically; AFFiNE needs no app secret |
| Container image | Cloud Build + Artifact Registry | Thin custom build over `ghcr.io/toeverything/affine` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** A plan-time validation restricts `database_type` to PostgreSQL versions; MySQL is rejected.
- **Redis is mandatory.** A plan-time validation fails the deploy if `enable_redis = false`. With no explicit `redis_host`, the NFS server IP is used as the Redis endpoint.
- **Single instance by design.** `min_instance_count = 1`, `max_instance_count = 1`, `cpu_always_allocated = true` — real-time collaboration WebSockets must stay reachable and CPU-fed, and per-process collab state plus filesystem blobs make horizontal scaling unsafe.
- **No Cloud SQL socket.** `enable_cloudsql_volume = false`: AFFiNE consumes a URL-authority `DATABASE_URL` that cannot carry the socket path's colons, so the entrypoint connects over the instance private IP with `sslmode=require`.
- **Two init jobs on apply.** `db-init` idempotently creates the database and user; `affine-migrate` runs AFFiNE's `self-host-predeploy` (schema migration + signing-key generation) before the server starts.
- **No application secret.** AFFiNE persists its own signing key in PostgreSQL during migration; only the auto-generated **database password** lives in Secret Manager.
- **Health probes target `/`** — AFFiNE returns HTTP 200 on its root path once ready.
- **`application_version = "latest"` maps to `stable`** — AFFiNE publishes no `latest` image tag.
- **Full-text/vector search is disabled** (`AFFINE_INDEXER_ENABLED = "false"`) — the indexer needs a vector backend not provisioned here.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the AFFiNE service

AFFiNE runs as a Cloud Run v2 service pinned to a single always-on instance. Each deployment creates an immutable revision; traffic moves to the newest healthy one.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

AFFiNE stores workspaces, documents, users, and its own signing key in a managed Cloud SQL for PostgreSQL 15 instance. Because AFFiNE's `DATABASE_URL` is a URL-authority DSN, the service connects over the **private IP with TLS** (`sslmode=require`) rather than the Auth Proxy socket. On first deploy the `db-init` job creates the application database and user, then `affine-migrate` creates the schema.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Redis — real-time collaboration

Redis carries AFFiNE's Yjs document-sync pub/sub and its background job queue — the deployment refuses to plan without it. When no external `redis_host` is configured, the shared NFS server's co-hosted Redis is used automatically.

- **Console:** Memorystore → Redis (if using a managed instance); Compute Engine → VM instances (the NFS/Redis host).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info clients
  ```

### D. Filestore (NFS) and Cloud Storage

Uploaded blobs (images, attachments, file embeds) are written to an **NFS** share mounted at `/root/.affine/storage`, so they survive revisions and restarts. A dedicated **Cloud Storage** bucket (suffix `storage`) is also provisioned automatically. The gen2 execution environment is required for NFS mounts.

- **Console:** Filestore → Instances (or Compute Engine → VM instances for the self-managed NFS VM); Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### E. Secret Manager

The auto-generated database password is the only secret — AFFiNE generates and stores its signing key inside PostgreSQL during the `affine-migrate` job, so no application secret exists to manage or rotate.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity. The cloud entrypoint defaults `AFFINE_SERVER_EXTERNAL_URL` to the injected service URL so invites and share links resolve correctly.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. AFFiNE Application Behaviour

- **Two-stage database setup.** On apply, `db-init` (image `postgres:15-alpine`) idempotently creates the AFFiNE role and database, grants privileges, and best-effort grants `cloudsqlsuperuser` so migrations can `CREATE EXTENSION`. Then `affine-migrate` runs AFFiNE's `node ./scripts/self-host-predeploy` using the built app image — idempotent schema migration **plus signing-key generation**. Both are safe to re-run; `affine-migrate` retries up to 3 times.
- **Signing key lives in the database.** Unlike most apps there is no `APP_SECRET`-style env var: the key generated by `self-host-predeploy` is persisted in PostgreSQL, so the deployment carries no application secret to desync or rotate.
- **DSN assembly at startup.** The cloud entrypoint builds `DATABASE_URL` from the Foundation-injected `DB_*` vars (URL-encoding the credentials) and maps `REDIS_HOST/PORT/AUTH` to AFFiNE's `REDIS_SERVER_*`. On Cloud Run it connects to the Cloud SQL private IP with `sslmode=require`; a preset `DATABASE_URL` env var takes precedence.
- **External URL.** `AFFINE_SERVER_EXTERNAL_URL` defaults to the Cloud Run service URL. Set it explicitly (via `environment_variables`) once a custom domain is live so share links and invite emails use the right host.
- **First-run setup.** Open the service URL and create the first account — on a fresh AFFiNE self-host instance the first registered user becomes the server administrator, and the admin panel is at `<url>/admin`.
- **Health path.** Startup, liveness, and readiness probes target `/`, which returns HTTP 200 once the server is ready (startup window: 60 s initial delay + up to 30 × 15 s).
- **Scaling constraint.** The service is pinned to exactly one always-on instance. Blobs on the NFS filesystem and per-process Yjs state make multiple instances unsafe; scale vertically (`cpu_limit` / `memory_limit`) instead.
- **Verification:**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~affine" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" \
    --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"    # expect 200
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for AFFiNE are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted IAM access and monitoring alerts. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `affine` | Base name for resources. Do not change after first deploy. |
| `application_version` | `stable` | Image tag for `ghcr.io/toeverything/affine`; `latest` maps to `stable`. Increment to trigger a rebuild and new revision. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | AFFiNE needs at least 2Gi for reliable operation. |
| `container_port` | `3010` | AFFiNE's native self-host server port. |
| `min_instance_count` | `1` | Keeps the collaboration WebSocket server always reachable — scale-to-zero drops live editing sessions. |
| `max_instance_count` | `1` | **Pinned.** Blobs on the filesystem + per-process collab state make horizontal scaling unsafe. |
| `cpu_always_allocated` | `true` | WebSocket Yjs sync is starved under request-based CPU throttling — keep true for a live collaborative editor. |
| `enable_cloudsql_volume` | `false` | AFFiNE's URL-authority `DATABASE_URL` cannot carry the Cloud SQL socket path; the entrypoint uses the private IP with `sslmode=require`. |
| `container_image_source` | `custom` | The thin-wrapper build supplies the cloud entrypoint — required. |
| `execution_environment` | `gen2` | Required for the NFS mount. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Merged over the `Affine_Common` defaults (`NODE_ENV`, `AFFINE_SERVER_HOST/PORT`, `AFFINE_CONFIG_PATH`, `AFFINE_INDEXER_ENABLED=false`). Never set `PORT` — it is a Cloud Run reserved name and breaks Job creation. |
| `secret_environment_variables` | `{}` | AFFiNE needs no application secret by default. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Blob storage **and** the default Redis host. Keep true unless an external `redis_host` is supplied. |
| `nfs_mount_path` | `/root/.affine/storage` | Where AFFiNE persists uploaded blobs. |

All other inputs follow standard App_CloudRun behaviour. The `storage` GCS bucket is always provisioned by `Affine_Common`.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | AFFiNE requires PostgreSQL — MySQL is rejected at plan time. |
| `db_name` / `db_user` | `affine` / `affine` | Immutable after first deploy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty for the built-in `db-init` (`postgres:15-alpine`) + `affine-migrate` (built app image) jobs. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60 s delay, 30 failures | Generous first-boot window. |
| `liveness_probe` | HTTP `/`, 60 s delay | Root path returns 200 once ready. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Mandatory** — plan-time validation rejects `false`. Yjs pub/sub + job queue. |
| `redis_host` | `""` | Leave empty to use the NFS host IP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls

All inputs follow standard App_CloudRun behaviour (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging`).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

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
| `database_host` / `database_port` | DB endpoint / port (host is sensitive). |
| `storage_buckets` | Created Cloud Storage buckets (includes the AFFiNE `storage` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `affine-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

Cross-variable validation runs at plan time (`validation.tf`): it enforces PostgreSQL, mandatory Redis with a resolvable host, `min ≤ max` instance counts, and rejects a Cloud SQL volume with `database_type = "NONE"` — misconfigurations fail fast instead of producing a broken deployment.

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | AFFiNE requires PostgreSQL; MySQL is rejected at plan time. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all workspaces. |
| `enable_redis` | `true` | Critical | Mandatory — real-time collaboration and the job queue need Redis; `false` fails the plan. |
| `redis_host` | `""` (NFS) or explicit | Critical | Redis on with NFS off and no host set fails validation; a wrong host breaks doc sync at runtime. |
| `enable_nfs` | `true` | Critical | Without NFS, uploaded blobs land on ephemeral disk and vanish on every revision/restart — and the default Redis host disappears. |
| `container_port` | `3010` | Critical | AFFiNE's native port; a mismatch fails every health probe. |
| `max_instance_count` | `1` | Critical | More than one instance splits per-process collab state and filesystem blobs — silent data divergence. |
| `container_image_source` | `custom` | High | The upstream image lacks the entrypoint that assembles `DATABASE_URL` / `REDIS_SERVER_*` — the server cannot reach its database. |
| `enable_cloudsql_volume` | `false` | High | The socket path's colons break AFFiNE's URL parser (`invalid port`); keep private-IP + `sslmode=require`. |
| `cpu_always_allocated` | `true` | High | Request-based throttling starves the Yjs WebSocket sync between requests — live editing stalls. |
| `min_instance_count` | `1` | High | Scale-to-zero drops active collaboration sessions and adds cold-start delays. |
| `memory_limit` | `4Gi` (≥ `2Gi`) | High | Node.js OOM during document sync or migration below 2Gi. |
| `environment_variables` `PORT` | never set | High | `PORT` is Cloud Run-reserved; setting it makes every Job creation fail with HTTP 400. |
| `application_version` | `stable` (pinned tag) | Medium | Nonexistent tags (e.g. literal `latest`) fail the image build; the module maps `latest` → `stable`. |
| `execution_environment` | `gen2` | High | NFS mounts require gen2. |
| `AFFINE_SERVER_EXTERNAL_URL` | service URL / custom domain | Medium | Wrong host breaks invite links and share URLs. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. AFFiNE-specific application configuration shared with the GKE variant is described in **[Affine_Common](Affine_Common.md)**.
