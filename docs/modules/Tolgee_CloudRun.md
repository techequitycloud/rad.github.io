---
title: "Tolgee on Google Cloud Run"
description: "Configuration reference for deploying Tolgee on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Tolgee on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tolgee_CloudRun.png" alt="Tolgee on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tolgee is an open-source, developer-friendly **localization (i18n) and translation
management** platform built on Spring Boot. This module deploys Tolgee on **Cloud Run
v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Tolgee uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every
Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Tolgee runs as a Java / Spring Boot container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Spring Boot service, 2 vCPU / 4 GiB by default, serverless autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Tolgee does not support MySQL or other engines |
| Object storage | Cloud Storage | A bucket for optional file storage (screenshots/imports) |
| Secrets | Secret Manager | Auto-generated initial admin password and JWT signing secret; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared application
  layer; selecting any other engine breaks startup.
- **Tolgee connects to Cloud SQL over TCP, not a Unix socket.** Its bundled PostgreSQL
  JDBC driver cannot use a socket, so on Cloud Run the entrypoint connects over the Cloud
  SQL **private IP** with `sslmode=require`. That is why `enable_cloudsql_volume` defaults
  to **`false`** here (no Auth Proxy socket sidecar).
- **The JWT secret is generated automatically** and stored in Secret Manager. It must
  never be rotated after first boot without a maintenance window — rotating it
  immediately invalidates all active user sessions.
- **`SERVER_PORT`, not `PORT`.** Tolgee reads `SERVER_PORT = 8080`; Cloud Run reserves
  `PORT`, so the module sets `SERVER_PORT` explicitly.
- **`min_instance_count` defaults to `1` and `cpu_always_allocated` to `true`.** Tolgee
  runs asynchronous batch operations (bulk machine-translation, imports, deletions) in
  in-process background threads after the triggering request returns; request-based
  billing would throttle them to ~0 CPU. Flip both (`false` + `min = 0`) only for a
  purely interactive, cost-first deployment that runs no large batch jobs.
- **No Redis.** Tolgee stores all translation state in PostgreSQL; `enable_redis`
  defaults to `false`.
- **Schema is created by Liquibase on first boot.** There is no separate migration job —
  the foundation creates the role/database and Tolgee auto-migrates on start.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Tolgee service

Tolgee runs as a Cloud Run v2 service that autoscales by request load between the minimum
and maximum instance counts. Each deployment creates an immutable revision; traffic can
be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Tolgee stores all application data (projects, languages, keys, translations, users) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects over the Cloud SQL
**private IP** (TCP, `sslmode=require`) rather than a Unix socket, because Tolgee's JDBC
driver cannot use a socket. On first deploy the foundation's `create-db-and-user.sh`
step creates the database and role; Tolgee then runs its own Liquibase migrations on boot.

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

### C. Cloud Storage

A **Cloud Storage** bucket (`name_suffix = "storage"`) is provisioned for optional file
storage — Tolgee keeps translations in PostgreSQL, so this bucket holds only uploaded
screenshots or import artifacts if you mount it via `gcs_volumes` or configure Tolgee's
S3-compatible file storage.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/            # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager: the **initial admin
password** (`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`) used to log in for the first time,
and the **JWT signing secret** (`TOLGEE_AUTHENTICATION_JWT_SECRET`) used to sign all user
session tokens. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`). An
external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be
layered on; ingress settings and VPC egress control connectivity. Because Tolgee connects
to Cloud SQL over the private IP, the service requires VPC egress (provided by the
foundation).

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The `/actuator/health`
endpoint is used for the provisioned uptime check when the service is publicly reachable.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Tolgee Application Behaviour

- **First-deploy database setup.** No dedicated init job runs — the App_CloudRun
  foundation's `create-db-and-user.sh` step creates the PostgreSQL role and database and
  grants schema ownership. Tolgee then creates and migrates its entire schema with
  **Liquibase** automatically on first boot.
- **Migrations on start.** Tolgee applies its Liquibase changesets on every startup, so
  upgrading the `application_version` applies schema changes without a separate step.
- **The JWT secret is immutable after first boot.** It is generated once and written to
  Secret Manager and kept stable across restarts and instances. Rotating
  `TOLGEE_AUTHENTICATION_JWT_SECRET` immediately invalidates all active user sessions —
  only rotate during a planned maintenance window.
- **First-run login.** After deploy, sign in as the initial owner:
  `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (default `admin@techequity.cloud`) with the
  generated password from Secret Manager. Change the password and configure additional
  auth providers (Google/OAuth2/SSO) from the Tolgee UI before going live.
- **Health path.** The readiness/startup/liveness probes target **`/actuator/health`**,
  which returns an unauthenticated `200` only after Liquibase migrations complete. Allow
  several minutes on first boot (60-second initial delay plus a wide failure window) —
  Spring Boot + first-run migrations start more slowly than a typical Node app.
- **Batch operations run in the background.** Bulk machine-translation, imports, and
  deletions execute asynchronously in in-process threads after the request returns, which
  is why `cpu_always_allocated = true` and `min_instance_count = 1` are the defaults.
- **Inspect the running revision's DB wiring:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Tolgee are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `tolgee` | Base name for the Cloud Run service and secrets. Do not change after first deploy. |
| `application_version` | `latest` | Tolgee image tag used as `FROM tolgee/tolgee:<tag>` for the thin custom wrapper build. Pin to a release (e.g. `v3.130.4`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance. Tolgee requires **at least 2 GiB** for reliable operation. |
| `min_instance_count` | `1` | Keeps async batch operations processing between requests. `0` (scale-to-zero) is safe for purely interactive use. |
| `max_instance_count` | `5` | Cost ceiling. Must be ≥ `min_instance_count`. |
| `cpu_always_allocated` | `true` | Keeps CPU allocated so in-process batch jobs complete. Flip to `false` (+ `min = 0`) for interactive-only, cost-first deployments. |
| `container_port` | `8080` | Tolgee's Spring Boot `SERVER_PORT`. |
| `container_image_source` | `custom` | Builds the thin wrapper via Cloud Build. |
| `enable_cloudsql_volume` | `false` | **Defaulted false** — Tolgee's JDBC driver cannot use a Cloud SQL socket, so it connects over the private IP (TCP, `sslmode=require`). |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Allows public access to the Tolgee UI/API. Restrict or front with IAP for private deployments. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Cloud Filestore NFS for optional Tolgee attachment storage. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts for the optional file-storage bucket. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `tolgee` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `tolgee` | Application database user. Password auto-generated in Secret Manager. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Leave off — Tolgee stores all state in PostgreSQL and does not require Redis. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

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
| `initialization_jobs` | Names of any setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `redis_port`/`backup_retention_days`, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `TOLGEE_AUTHENTICATION_JWT_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login for everyone. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_cloudsql_volume` | `false` | Critical | Tolgee's JDBC driver cannot use a Cloud SQL socket; enabling it points `DB_HOST` at a socket dir and breaks the database connection. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | High | Below ~2 GiB the Spring Boot JVM OOMs during first-boot Liquibase migrations. |
| `application_version` | Pin in production | High | `latest` can pull a new major with incompatible migrations on redeploy. |
| `enable_redis` | `false` | Medium | Redis is unused; enabling it adds cost without benefit. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` | Medium | Flipping to request-based + scale-to-zero throttles async batch jobs (bulk MT/imports) to ~0 CPU and stalls them. |
| `startup_probe` (`/actuator/health`) | Keep the wide first-boot window | Medium | Too tight a window fails the revision while Liquibase migrations are still running on a fresh DB. |
| `ingress_settings` | `all` (or IAP) | Medium | Leaving public without auth exposes the Tolgee UI/API; the initial admin password must be changed immediately. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Tolgee-specific application configuration shared with the GKE variant is described in
**[Tolgee_Common](Tolgee_Common.md)**.
