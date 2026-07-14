---
title: "EvolutionAPI on Google Cloud Run"
description: "Configuration reference for deploying EvolutionAPI on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# EvolutionAPI on Google Cloud Run

Evolution API is an open-source Node.js WhatsApp Business API gateway (built on the
Baileys library) that provisions WhatsApp instances, sends and receives messages, and
exposes a REST API plus a manager UI for wiring WhatsApp into other systems. This
module deploys Evolution API on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Evolution API uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Evolution API runs as a Node.js container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default; **pinned to a single always-warm instance** |
| Database | Cloud SQL for PostgreSQL 15 | Required — Evolution API uses Prisma against PostgreSQL only |
| Cache | Redis | **Enabled by default** (`CACHE_REDIS_URI`); caches instance/message state |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated `AUTHENTICATION_API_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (public); optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Evolution API uses Prisma and does not support other engines.
- **The service is pinned to a single instance** (`min_instance_count = 1`,
  `max_instance_count = 1`). Evolution API holds live WhatsApp (Baileys) socket
  sessions in memory, per-instance; those sessions are **not** shared across
  replicas, so scaling out fragments live connections and one instance must stay
  warm. Do not raise `max_instance_count`.
- **`AUTHENTICATION_API_KEY` is generated automatically** and stored in Secret
  Manager. It is Evolution API's global admin key and must **never be rotated after
  first boot** — rotating it makes already-provisioned WhatsApp instances unreachable
  and returns `401` to every client still holding the old key.
- **Redis is enabled by default** (`enable_redis = true`). Leave `redis_host` empty to
  use the NFS server VM's IP as the Redis endpoint (requires `enable_nfs = true`), or
  point it at an explicit managed instance.
- **Public ingress is the default** (`ingress_settings = "all"`) so external systems
  can reach webhook endpoints and the manager UI. Enabling IAP blocks those external
  calls.
- **Memory defaults to 4 GiB** — Evolution API needs at least 2 GiB for reliable
  operation.
- **`SERVER_URL` is defaulted to the actual service URL** at runtime by the container
  entrypoint, so QR-code and webhook callback URLs reflect the real Cloud Run address.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Evolution API service

Evolution API runs as a Cloud Run v2 service pinned to a single instance. Each
deployment creates an immutable revision; traffic can be split across revisions for
safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~evolutionapi"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Evolution API stores all application data (WhatsApp instances, contacts, chats,
message history) in a managed Cloud SQL for PostgreSQL 15 instance. The service
connects privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public
IP is exposed. On first deploy an initialization Job creates the application database
and user; Prisma migrations then create the schema on container boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=evolution --database=evolution --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** data bucket is provisioned automatically for Evolution
API file storage. Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (cache)

Redis is **enabled by default** (`enable_redis = true`). Evolution API uses it for
instance/message caching (`CACHE_REDIS_URI`, Redis DB index `6`). When `redis_host` is
left empty and `enable_nfs = true`, the NFS server VM's IP is used as the Redis
endpoint; the container entrypoint assembles the URI at runtime.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the cache URI is set in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`AUTHENTICATION_API_KEY` — Evolution API's global admin API key, injected as a secret
env var. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public
access required for WhatsApp webhook callbacks and the manager UI. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The entrypoint emits
`[cloud-entrypoint]` markers that confirm the resolved DB/Redis/URL config on boot.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. EvolutionAPI Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `evolution` database and role, grants privileges, and makes the app user
  the owner of the `public` schema. The job is safe to re-run.
- **Prisma migrations on start.** Evolution API runs `prisma migrate deploy` on every
  container boot (via the wrapped `deploy_database.sh`), so upgrading the application
  version applies schema changes without a separate migration step. The entrypoint
  waits for the Cloud SQL socket before this runs and executes the migrate script as a
  subprocess so a transient failure cannot prevent the server from starting.
- **`AUTHENTICATION_API_KEY` is immutable after first boot.** The global admin key is
  generated once and written to Secret Manager. Rotating it makes all
  already-provisioned WhatsApp instances unreachable and returns `401` to every client
  still holding the old key. Only rotate during a planned migration.
- **Single-instance by design.** WhatsApp (Baileys) socket sessions live in the
  instance's memory and are not shared across replicas. `min_instance_count = 1` keeps
  one warm; `max_instance_count = 1` prevents fragmenting live connections. Do not
  scale out.
- **Webhook / QR callback URL.** The entrypoint defaults `SERVER_URL` to the injected
  `CLOUDRUN_SERVICE_URL`, so QR-code and webhook callback URLs use the real service
  address. Verify the running service URL:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **First-run setup.** After deploy, retrieve `AUTHENTICATION_API_KEY` from Secret
  Manager and use it (as the `apikey` header) to reach the manager UI at `/manager`,
  create a WhatsApp instance (`POST /instance/create`), then scan the returned QR code
  from WhatsApp on your phone to connect the number.
- **Health path.** Startup and liveness probes target the root `/` — an unauthenticated
  status endpoint that responds once the server is up. Allow ~7 minutes on first boot
  (the startup probe gives a 60-second initial delay plus a 30-retry window while
  Prisma migrates).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Evolution API are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `evolutionapi` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Evolution API` | Human-readable name shown in the Console. |
| `application_version` | `v2.1.1` | Evolution API image tag. `latest` maps to a pinned `v2.1.1` in the build arg. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance; **minimum 2 GiB** for reliable operation. |
| `min_instance_count` | `1` | Keeps one warm instance — WhatsApp sockets are held in memory. |
| `max_instance_count` | `1` | **Pinned to 1.** Do not raise — sessions are not shared across replicas. |
| `container_port` | `8080` | Evolution API listens on port 8080 (`SERVER_PORT`). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the `evoapicloud/evolution-api` image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for public webhook callbacks and the manager UI. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks external WhatsApp webhook callbacks.** |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `SERVER_*`, `DATABASE_*`, `CACHE_REDIS_*`, and `AUTHENTICATION_*` values are set automatically — do not set `AUTHENTICATION_API_KEY` or `DATABASE_CONNECTION_URI` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions a Filestore NFS instance; also co-locates the Redis endpoint on the NFS server VM when `redis_host` is left empty (see Group 21). |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `evolution` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `evolution` | Application database user. Password auto-generated in Secret Manager. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay, 30 retries | Slow first boot (Prisma migrations); allow ~7 minutes. |
| `liveness_probe` | HTTP `/` 60s delay | Liveness probe on the root status endpoint. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enables Evolution API's Redis cache (`CACHE_REDIS_URI`). |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `redis_port`/`backup_retention_days`, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, memory below the gen2 floor. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `AUTHENTICATION_API_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes every already-provisioned WhatsApp instance unreachable and returns `401` to all clients holding the old key. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all message history. |
| `max_instance_count` | `1` | Critical | Scaling out fragments in-memory WhatsApp socket sessions across instances, breaking live connections and duplicating webhook deliveries. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` | `true` | High | Disabling drops Evolution API's instance/message cache; the app is configured to expect it (`CACHE_REDIS_ENABLED = true`). |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but NFS is off and no host is set, the cache URI is blank and caching is silently disabled. |
| `memory_limit` | `4Gi` (min `2Gi`) | High | Below 2 GiB Evolution API is prone to OOM kills under message load. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks all external WhatsApp webhook callbacks. |
| `enable_iap` | only when webhooks not needed | High | IAP blocks all unauthenticated requests, including external webhook callbacks. |
| `min_instance_count` | `1` | Medium | Scale-to-zero drops the warm WhatsApp socket sessions; a cold start must re-establish every connection. |
| `application_version` | Pin (e.g. `v2.1.1`) | Medium | `latest` maps to a pinned tag, but pinning explicitly avoids surprise upgrades that run new Prisma migrations. |
| `startup_probe` timing | Default (60s + 30 retries) | Medium | Too tight a window fails the probe before first-boot Prisma migrations finish. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Evolution-API-specific application configuration
shared with the GKE variant is described in
**[EvolutionAPI_Common](EvolutionAPI_Common.md)**.
