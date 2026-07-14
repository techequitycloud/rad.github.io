---
title: "Azimutt on Google Cloud Run"
description: "Configuration reference for deploying Azimutt on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Azimutt on Google Cloud Run

Azimutt is an open-source, next-generation database-schema explorer and ERD (entity
relationship diagram) tool for real-world databases, built with Elixir/Phoenix. It
lets teams explore, document, and design large schemas (thousands of tables), search
across columns and relations, and share diagrams. This module deploys Azimutt on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Azimutt uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Azimutt runs as a single Elixir/Phoenix container on Cloud Run v2, listening on port
**4000**. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Phoenix container, 2 vCPU / 4 GiB by default, serverless autoscaling; scale-to-zero enabled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Azimutt does not support MySQL or other engines |
| Object storage | Cloud Storage | A bucket is provisioned; uploads default to local ephemeral disk (`FILE_STORAGE_ADAPTER = local`) |
| Secrets | Secret Manager | Auto-generated Phoenix `SECRET_KEY_BASE`; database password |
| Image build | Cloud Build + Artifact Registry | Thin wrapper FROM `ghcr.io/azimuttapp/azimutt`, mirrored into Artifact Registry |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup. All Azimutt project
  data (schemas, diagrams, layouts, users) lives in Postgres.
- **Azimutt connects to Postgres over private-IP TCP with SSL, not the socket.**
  Ecto/postgrex cannot parse the Cloud SQL Unix-socket DSN, so the cloud entrypoint
  builds `DATABASE_URL` against `DB_IP` and sets `DATABASE_ENABLE_SSL=true`. The
  Cloud SQL socket is still mounted (`enable_cloudsql_volume = true`) purely so the
  `db-init` job can create the role/database without SSL.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager.
  Rotating it after first boot signs out every active session; only rotate in a
  maintenance window.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Azimutt is a request/response app and a cold start
  reconnects to Postgres cleanly. Cold starts add a few seconds of latency after
  idle; set `min_instance_count = 1` to avoid them.
- **Migrations run automatically on every boot.** The container command is
  `/app/bin/migrate && /app/bin/server`, so a version upgrade applies its schema
  changes on start — allow extra time on the first boot.
- **`application_version = "latest"` maps to Azimutt's `main` tag.** Azimutt
  publishes no `:latest` tag; pin to a specific release in production.
- **Sign-up is open by default.** Azimutt lets anyone with the URL create an account.
  Restrict access after creating your first account (custom domain + IAP, or Azimutt's
  own auth settings via `environment_variables`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Azimutt service

Azimutt runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the composed DB wiring the entrypoint logged at boot:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
    --limit 50 | grep cloud-entrypoint
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Azimutt stores all application data (schemas, diagrams, layouts, users, sources) in a
managed Cloud SQL for PostgreSQL 15 instance. On Cloud Run the service connects over
the instance **private IP** with SSL (`DATABASE_ENABLE_SSL=true`) — Ecto cannot parse
the socket DSN. On first deploy an initialization Job creates the application database
and role; Azimutt then runs its own Ecto migrations on boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage

A **Cloud Storage** bucket is provisioned for Azimutt. With the default
`FILE_STORAGE_ADAPTER = "local"`, Azimutt writes file uploads to the container's local
ephemeral disk rather than to this bucket; the bucket exists for operators who switch
Azimutt to an S3-compatible file adapter. Project data itself lives in Postgres.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

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

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Cloud Build & Artifact Registry

Azimutt's image is a thin wrapper built FROM `ghcr.io/azimuttapp/azimutt`; Cloud Build
produces the wrapped image and it is mirrored into Artifact Registry
(`enable_image_mirroring = true`). The base tag comes from the `AZIMUTT_VERSION` build
arg (with `latest` mapped to `main`).

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. VPC egress is required so Azimutt can
reach the Cloud SQL private IP.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The `cloud-entrypoint`
lines show the resolved `DATABASE_URL` path, `PHX_HOST`, and `PORT`.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Azimutt Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role
  (`LOGIN CREATEDB`) and database, grants `ALL` on the database and the `public`
  schema, and `ALTER`s the schema owner — Azimutt needs full DDL rights because it
  runs its own migrations. The job is safe to re-run.
- **Migrations run on start.** The container command is
  `/app/bin/migrate && /app/bin/server`, so Ecto applies pending migrations on every
  boot before the Phoenix endpoint binds. Upgrading `application_version` applies
  schema changes automatically — no separate migration step.
- **Runtime DB wiring is composed by the entrypoint.** `DATABASE_URL` is built from
  the injected `DB_*` vars, the password is URL-encoded, and on Cloud Run the
  connection uses the private IP (`DB_IP`) with `DATABASE_ENABLE_SSL=true`. `PHX_HOST`
  is derived from the injected service URL (scheme stripped).
- **`SECRET_KEY_BASE` is stable and effectively immutable.** It is generated once and
  written to Secret Manager. Rotating it invalidates every active session cookie —
  all users are signed out. Only rotate in a maintenance window.
- **Health path.** The startup and readiness probes target the Phoenix root `/` — the
  first endpoint that returns 200 once the server has booted and connected to
  Postgres. Allow ~1–2 minutes on first boot for migrations (the startup probe
  provides a 60-second initial delay plus a retry window).
- **First-run setup.** Open the service URL and create the first Azimutt account
  through the sign-up page. Sign-up is open by default — restrict access afterwards.
- **Inspect the init job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Azimutt are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `azimutt` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Azimutt` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Azimutt image tag; `latest` maps to the `main` tag. Pin to a release in production. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` for background Oban jobs or to avoid cold starts. |
| `max_instance_count` | `5` | Maximum instances. |
| `container_port` | `4000` | Phoenix listens on 4000; probes must match. |
| `cpu_always_allocated` | `false` | Request-based billing (CPU billed only while serving). Set `true` (with `min ≥ 1`) only for background Oban jobs. |
| `enable_cloudsql_volume` | `true` | Mounts the Cloud SQL socket for the `db-init` job; the app still connects over TCP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress; set `internal` to restrict to VPC/LB. |
| `enable_iap` | `false` | Require Google sign-in in front of Azimutt. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `PHX_SERVER`, `FILE_STORAGE_ADAPTER`, `PORT`, `PHX_HOST`, and `DATABASE_URL` are set automatically — do not override them. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `SECRET_KEY_BASE` is injected automatically. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions and mounts a Filestore NFS share at `nfs_mount_path` (`/opt/azimutt/storage`). With the default `FILE_STORAGE_ADAPTER = local`, Azimutt still writes uploads to its own ephemeral working directory rather than this mount. |
| `gcs_volumes` | `[]` | Optional GCS Fuse volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `azimutt` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `azimutt` | Application database user. Password auto-generated in Secret Manager. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay | Startup probe; allow time for first-boot migrations. |
| `liveness_probe` | HTTP `/` | Liveness probe. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default — Azimutt uses PostgreSQL (Oban) for background jobs, not Redis. |
| `redis_host` | `""` | Redis endpoint (only if a downstream feature requires it). |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls & Audit Logging

Standard App_CloudRun behaviour — `enable_vpc_sc`, `vpc_sc_dry_run`,
`enable_audit_logging`. See [App_CloudRun](App_CloudRun.md).

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
| `SECRET_KEY_BASE` (auto-generated) | Never rotate outside a maintenance window | Critical | Rotating it invalidates every active session cookie — all users are signed out. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and orphans all Azimutt data. |
| `container_port` | `4000` | Critical | Phoenix binds 4000; a mismatched port makes every probe hit a dead port and the revision never becomes Ready. |
| `enable_cloudsql_volume` | `true` | High | The socket mount is what lets `db-init` create the role/database without SSL; disabling it breaks first-deploy bootstrap. |
| `application_version` | Pin a release | High | `latest` maps to the rolling `main` tag; an unexpected upstream change can break a redeploy. |
| `memory_limit` | `4Gi` | High | Undersizing the Elixir BEAM VM risks OOM kills while rendering large schemas. |
| `ingress_settings` / `enable_iap` | Restrict after first account | High | Sign-up is open by default; leaving the service publicly reachable lets anyone create an account. |
| `FILE_STORAGE_ADAPTER` (auto `local`) | Leave `local` unless using S3 | Medium | `local` writes uploads to ephemeral disk — they are lost on redeploy/scale-to-zero. Project data in Postgres is safe. |
| `min_instance_count` | `0` (or `1` for background jobs) | Medium | Scale-to-zero adds cold-start latency; background Oban jobs need `min ≥ 1` + `cpu_always_allocated = true`. |
| `enable_redis` | `false` | Low | Azimutt uses Postgres/Oban, not Redis — enabling it has no effect on Azimutt itself. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Azimutt-specific application configuration shared
with the GKE variant is described in **[Azimutt_Common](Azimutt_Common.md)**.
