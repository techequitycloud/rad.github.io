---
title: "Budibase on Google Cloud Run"
description: "Configuration reference for deploying Budibase on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Budibase on Google Cloud Run

Budibase is an open-source low-code platform for building internal tools, business
apps, and workflows on top of your data. This module deploys Budibase on **Cloud
Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions
and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Budibase uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Budibase runs as a single **all-in-one** container on Cloud Run v2. The official
`budibase/budibase` image bundles **CouchDB + MinIO + Redis** and the Budibase
apps/worker/proxy together and serves HTTP on **port 80** — there is no external
managed database. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single all-in-one container, 4 vCPU / 8 GiB by default; runs as **one** instance (min = max = 1) |
| Database | None (bundled CouchDB) | `database_type = "NONE"` — CouchDB, MinIO, and Redis all run inside the container |
| Object storage | Cloud Storage | One data bucket provisioned automatically; Budibase's own asset store is the bundled MinIO |
| Cache & queue | Bundled Redis | Runs inside the container on loopback; `enable_redis` is off by default |
| Secrets | Secret Manager | Seven auto-generated internal credentials injected as service secret env vars |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Cloud Run is ephemeral / demo-only for Budibase.** All state (CouchDB documents
  + MinIO objects) lives on the container path `/data`, and **Cloud Run has no
  durable local disk** — a restart or new revision loses the data store. For a
  persistent deployment use the [GKE variant](Budibase_GKE.md), which mounts a block
  PVC at `/data`.
- **Runs as a single instance.** `min_instance_count = 1` and `max_instance_count = 1`.
  The all-in-one container holds all state locally, so multiple replicas would not
  share data (split-brain). Scale-to-zero would drop the running data store, so
  min is 1.
- **`cpu_always_allocated = true`.** CPU is allocated at all times so the bundled
  CouchDB/MinIO/Redis background processes keep running between requests; keep it
  `true` with `min_instance_count >= 1`.
- **Seven internal credentials are generated automatically** and stored in Secret
  Manager (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
  `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). These must never be
  rotated after first boot — the data on `/data` is keyed with them and becomes
  unreadable if they change.
- **Port 80 is fixed.** The all-in-one image's nginx proxy serves the whole app on
  port 80, so `container_port` and the probes are pinned to 80.
- **No external database or `db-init` job.** Budibase self-provisions CouchDB and
  MinIO on first boot; `enable_cloudsql_volume` and `database_type` default to
  off/`NONE`.
- **Public ingress by default.** `ingress_settings = "all"` so the app is reachable
  at its `run.app` URL; enabling IAP puts Google sign-in in front of it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Budibase service

Budibase runs as a Cloud Run v2 service. Because it holds all state locally it runs
as a single instance (min = max = 1); each deployment creates an immutable revision.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Data store (bundled CouchDB + MinIO)

There is **no Cloud SQL instance** — `database_type = "NONE"`. Budibase's CouchDB
document store and MinIO object store both run **inside the container** and persist
to `/data`. On Cloud Run that directory is on the container's ephemeral filesystem,
so it does not survive a restart. Inspect the bundled services through the container
env and logs rather than a managed DB console:

- **CLI:**
  ```bash
  # Confirm database_type=NONE and the bundled-service env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

For a durable data store, use the [GKE variant](Budibase_GKE.md) (block PVC on `/data`).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (name suffix `storage`) is provisioned
automatically. Budibase's own asset/attachment store is the bundled MinIO; this GCS
bucket is available for foundation-level storage integration.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (bundled)

Redis runs **inside the all-in-one container** on loopback and is authenticated with
the auto-generated `REDIS_PASSWORD`. `enable_redis` is **off by default** — do not
enable an external Redis unless you are deliberately externalising the cache.

- **CLI:**
  ```bash
  # Verify the bundled Redis password secret is wired into the revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -i redis
  ```

### E. Secret Manager

Seven internal credentials are generated automatically and stored in Secret Manager,
then injected as service secret env vars: `INTERNAL_API_KEY`, `JWT_SECRET`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, and
`COUCH_DB_PASSWORD`. They must never be rotated after first boot.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~budibase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection details and
[Budibase_Common](Budibase_Common.md) for what each secret protects.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Budibase Application Behaviour

- **No external database bootstrap.** With `database_type = "NONE"` there is no
  `db-init` job. Budibase self-provisions its bundled CouchDB and MinIO on first boot
  inside the container. Only user-supplied `initialization_jobs` are honoured.
- **State lives on `/data` — and Cloud Run does not persist it.** CouchDB documents
  and MinIO objects are written to `/data` on the container's ephemeral filesystem.
  Any restart or new revision starts from an empty store, so treat a Cloud Run
  Budibase deployment as ephemeral/demo-only and use the GKE variant for anything you
  need to keep.
- **Internal credentials are immutable after first boot.** The seven generated
  secrets key the data on `/data`. Changing `API_ENCRYPTION_KEY` corrupts all
  encrypted stored data; changing `JWT_SECRET` invalidates all sessions; changing the
  MinIO or CouchDB credentials breaks access to the object/document stores. Only
  rotate during a planned reset.
- **First-run setup.** Budibase self-hosted ships with **no default admin account**.
  Open the service URL after deploy and create the initial administrator (email +
  password) through the setup screen before use.
- **Health path.** The startup probe is **TCP** on port 80 (not HTTP): nginx binds
  the port within seconds but returns 502 until the bundled CouchDB/MinIO/app
  upstreams finish booting, so an HTTP check on `/` would fail for the whole
  upstream-boot window — TCP passes as soon as nginx binds the port, letting the
  revision go Ready while the upstreams finish in the background (30-second initial
  delay, 40-retry window at a 15-second period, ~10 minutes total). The liveness and
  readiness probes are HTTP on the unauthenticated root `/`; liveness uses a
  240-second initial delay to clear the post-startup window where `/` still 502s.
- **Single-instance only.** Keep `min_instance_count = max_instance_count = 1`; the
  data store is local to the container and cannot be shared across replicas.
- **Verify the running revision:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"   # only user-supplied init jobs
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Budibase are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `budibase` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Budibase` | Human-readable name shown in the Console. |
| `application_version` | `3.39.29` | Budibase image tag; used as `FROM budibase/budibase:<tag>` for the thin wrapper build. Increment to trigger a new build/revision. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_port` | `80` | The all-in-one image's nginx proxy serves the whole app on port 80 — must stay 80. |
| `container_resources` | `4000m` / `8Gi` | CPU and memory per instance; the bundled CouchDB/MinIO/Redis + app tier need generous memory — 4Gi OOM-loops on Cloud Run gen2 (the writable `/data` dir counts against the memory limit), so 8Gi is the reliable minimum. |
| `min_instance_count` | `1` | Keep at 1 — scale-to-zero would drop the local data store. |
| `max_instance_count` | `1` | Keep at 1 — the container holds all state locally; replicas would not share data. |
| `cpu_always_allocated` | `true` | Allocate CPU at all times so bundled background services keep running between requests. |
| `execution_environment` | `gen2` | Gen2 recommended. |
| `enable_cloudsql_volume` | `false` | Budibase uses no external SQL database. |
| `enable_image_mirroring` | `true` | Mirror the Budibase image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Reachable at the `run.app` URL by default. |
| `enable_iap` | `false` | Require Google sign-in in front of Budibase. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged into the container. Core values (`BUDIBASE_ENVIRONMENT`, `SELF_HOSTED`, `COUCH_DB_USER`, `LOG_LEVEL`) are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. The seven internal credentials are injected automatically — do not set them here. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Budibase bundles its own CouchDB; no external managed database is provisioned. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Redis runs inside the container; leave off unless externalising the cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only used if an external Redis is enabled. |

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
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` / `database_name` / `database_user` | Populated only if a managed DB is used; empty for Budibase (`database_type = NONE`). |
| `database_password_secret` / `database_host` / `database_port` | DB secret / endpoint / port (unused for Budibase). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any user-supplied init jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `container_port`, an invalid CPU/memory quantity, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Cloud Run as the platform | GKE for persistence | Critical | Cloud Run has no durable disk — `/data` (all CouchDB + MinIO state) is lost on any restart/revision. Use Budibase_CloudRun only for demo/evaluation. |
| `API_ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it corrupts all encrypted stored data — it cannot be decrypted. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `COUCH_DB_PASSWORD` (auto-generated) | Never rotate after first boot | Critical | Rotating breaks access to the bundled object/document stores keyed on `/data`. |
| `JWT_SECRET` (auto-generated) | Only rotate in a maintenance window | High | Rotating it invalidates all active user sessions, forcing immediate re-login. |
| `max_instance_count` | `1` | Critical | More than one instance splits the local data store — replicas do not share `/data` (split-brain, data loss). |
| `min_instance_count` | `1` | High | Scale-to-zero drops the running in-container data store. |
| `cpu_always_allocated` | `true` | High | Request-based billing throttles the bundled CouchDB/MinIO/Redis background work to ~0 CPU between requests. |
| `container_port` | `80` | High | The nginx proxy serves the app on 80; any other port fails the probes and the service never becomes Ready. |
| `database_type` | `NONE` | High | Selecting an external engine provisions an unused Cloud SQL instance; Budibase never connects to it. |
| `memory_limit` | `8Gi` | High | 4Gi OOM-loops (instance restarts ~every 60s) — the writable `/data` dir (CouchDB/MinIO/Redis state) is in-memory on Cloud Run gen2 and counts against the limit; 8Gi is the reliable minimum. |
| First admin account | Create immediately after deploy | High | Budibase self-hosted ships with no default admin — an unclaimed instance can be claimed by anyone who reaches the URL. |
| `enable_iap` | enable for private deployments | Medium | Without IAP or a WAF the UI is publicly reachable at the `run.app` URL. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Budibase-specific application configuration
shared with the GKE variant is described in **[Budibase_Common](Budibase_Common.md)**.
