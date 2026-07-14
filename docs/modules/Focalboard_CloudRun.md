---
title: "Focalboard on Google Cloud Run"
description: "Configuration reference for deploying Focalboard on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Focalboard on Google Cloud Run

Focalboard is a self-hosted, open-source Kanban and project-board server from the
Mattermost project — a Go backend serving a built React frontend for managing tasks,
boards, and workflows. This module deploys Focalboard on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Focalboard uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Focalboard runs as a single Go container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service on port 8000, 2 vCPU / 4 GiB by default; serverless autoscaling with scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Required — the engine is fixed (`database_type = POSTGRES_15`) |
| Attachment storage | Cloud Storage (GCS FUSE) | A dedicated bucket mounted at `/data` via gcsfuse so uploaded attachments survive restarts |
| Secrets | Secret Manager | Auto-generated `FOCALBOARD_ADMIN_PASSWORD`; database password managed by the foundation |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Focalboard has no MySQL or SQLite path in this module.
- **Focalboard reads `config.json`, not env vars, for the DB connection.** A custom
  entrypoint regenerates `/opt/focalboard/config.json` from the Foundation-injected
  `DB_*` values on every start, so no DSN is baked into the image.
- **Attachments live on a gcsfuse-mounted GCS bucket at `/data`.** Cloud Run has no
  block-PVC option, so `enable_gcs_storage_volume = true` mounts the storage bucket at
  the Focalboard `filespath`. Board *data* (cards, boards, users) lives in PostgreSQL;
  only uploaded files land on the bucket.
- **No Redis is used.** `enable_redis = false` — Focalboard keeps all board state in
  PostgreSQL and needs no external cache or queue.
- **Scale-to-zero is enabled** (`min_instance_count = 0`, `max_instance_count = 5`).
  Cold starts add a few seconds of latency to the first request after idle; set
  `min_instance_count = 1` to keep an instance warm.
- **The image is a mirrored custom build.** The official `mattermost/focalboard` image
  is thin-wrapped and mirrored into Artifact Registry; `application_version` defaults to
  `7.11.4`, and `latest` maps to that pinned tag at build time (`latest` is not a
  published Focalboard tag).
- **Native auth, first-user-is-owner.** `authMode = native` and public shared boards are
  enabled; the first account registered via the UI becomes the workspace owner. There is
  no pre-seeded admin.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Focalboard service

Focalboard runs as a Cloud Run v2 service listening on port **8000**, autoscaling by
request load between the minimum and maximum instance counts. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~focalboard"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Focalboard stores all board data (boards, cards, blocks, users, sessions) in a managed
Cloud SQL for PostgreSQL 15 instance. The service connects privately — on Cloud Run over
the VPC private IP with `sslmode=require`, or via the **Cloud SQL Auth Proxy** Unix
socket when `enable_cloudsql_volume = true`; no public IP is exposed. On first deploy an
initialization Job creates the application database and role.

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

### C. Cloud Storage — attachment bucket

A dedicated **Cloud Storage** bucket (the `storage` suffix) is provisioned automatically
and mounted at `/data` via gcsfuse so uploaded board attachments persist across instance
restarts and scale-to-zero. Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachment-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

One application secret is generated automatically and stored in Secret Manager:
`FOCALBOARD_ADMIN_PASSWORD` (a 24-char random string, injected as a SERVICE secret env).
The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~focalboard"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The entrypoint prints the
resolved DB host, name, user, and `sslmode` at startup — useful for confirming the
connection wiring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Focalboard Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role (`LOGIN CREATEDB`)
  and database, grants privileges, and reassigns the `public` schema owner to the app
  role so Focalboard can run its migrations. No Postgres extensions are installed. The
  job is safe to re-run.
- **Migrations run on start.** Focalboard applies its own schema migrations on every
  boot as the application user, so upgrading `application_version` applies schema changes
  without a separate migration step.
- **`config.json` is generated at runtime.** Focalboard has no env-var override for the
  DB connection; the entrypoint writes `/opt/focalboard/config.json` from the injected
  `DB_*` vars each start. On Cloud Run it connects over the private IP with
  `sslmode=require` (preferring `DB_IP`, since the Cloud SQL socket does not always
  materialise).
- **Health path.** Startup, liveness, and readiness probes target `/` — the web UI, which
  returns 200 once the server binds its port and completes migrations. Allow up to ~7–8
  minutes on first boot (60-second startup initial delay + a 15s×30 retry window).
- **First-run setup.** Focalboard runs in `authMode = native`; open the service URL and
  register the first account, which becomes the workspace owner. `enablePublicSharedBoards`
  is on, so boards can be shared via public links.
- **Attachments vs. data.** Board content lives in PostgreSQL; only uploaded files are
  written to the gcsfuse-mounted bucket at `/data`. If the bucket mount is missing,
  uploads fail but board editing still works.
- **Inspect the running config and jobs:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Focalboard are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `focalboard` | Base name for resources. Do not change after first deploy. |
| `application_version` | `7.11.4` | Focalboard image tag; `latest` maps to the pinned `7.11.4` at build time. |
| `display_name` | `Focalboard` | Human-readable name shown in the Console. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `5` | Maximum instances. Safe to raise — board state is in PostgreSQL, not per-instance. |
| `container_port` | `8000` | Focalboard listens on port 8000. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy socket; the entrypoint also falls back to private-IP TCP. |
| `enable_image_mirroring` | `true` | Mirror the `mattermost/focalboard` image into Artifact Registry. |
| `cpu_always_allocated` | `false` | Request-based (cold-start) billing. Focalboard has no background workers or WebSocket server, so scale-to-zero is safe. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Focalboard requires PostgreSQL 15. |
| `application_database_name` | `crappdb` | Cloud SQL database name, injected as `DB_NAME`. Immutable after first deploy. |
| `application_database_user` | `crappuser` | Application DB user, injected as `DB_USER`. Password auto-generated in Secret Manager. |
| `enable_auto_password_rotation` | `false` | Optional DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, 10s timeout, 15s period, 30 retries | Startup probe. Allow ~7–8 minutes on first boot for migrations. |
| `liveness_probe` | HTTP `/`, 60s delay, 5s timeout, 30s period, 3 retries | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Focalboard does not require Redis; leave off. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour and defaults.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

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
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (the attachment bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
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
> combinations* at plan time — an IAP configuration with no authorized identities, a
> `gen1` runtime with GCS mounts, a `database_type` that does not match an enabled
> extension, an out-of-range `backup_retention_days`. Invalid configuration fails the
> **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Injected as `DB_NAME`/`DB_USER` and immutable after first deploy; renaming recreates the DB/user and orphans all board data. |
| Attachment bucket / `enable_gcs_storage_volume` | Keep the gcsfuse mount at `/data` | Critical | Without a persistent mount at `filespath`, uploaded attachments are written to ephemeral instance disk and lost on restart / scale-to-zero. |
| `database_type` | `POSTGRES_15` | Critical | Any other engine breaks Focalboard startup — there is no MySQL/SQLite path here. |
| `application_version` | Pin a real tag (`7.11.4`) | High | `mattermost/focalboard:latest` is not a published tag; the build maps `latest` to the pinned `FOCALBOARD_VERSION`, but pinning explicitly avoids surprises. |
| `container_port` | `8000` | High | Focalboard binds 8000; a mismatched port makes the startup probe never pass. |
| `enable_redis` | `false` | Medium | Focalboard needs no Redis; enabling it wires an unused dependency. |
| `min_instance_count` | `1` for latency-sensitive use | Medium | Scale-to-zero (`0`) adds cold-start latency to the first request after idle. |
| `enable_cloudsql_volume` | `true` | Medium | The entrypoint falls back to private-IP TCP with `sslmode=require`, but the Auth Proxy socket is the primary path. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Focalboard-specific application configuration shared with the GKE variant is described in
**[Focalboard_Common](Focalboard_Common.md)**.
