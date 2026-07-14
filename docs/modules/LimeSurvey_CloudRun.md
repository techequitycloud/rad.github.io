---
title: "LimeSurvey on Google Cloud Run"
description: "Configuration reference for deploying LimeSurvey on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# LimeSurvey on Google Cloud Run

LimeSurvey is a free, open-source (GPL) online survey and questionnaire platform
written in PHP, supporting unlimited surveys, conditional branching, quotas, and
multi-language questionnaires with exportable results. This module deploys LimeSurvey
on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services LimeSurvey uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

LimeSurvey runs as a PHP/Apache container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service on port 8080, 1 vCPU / 2 GiB by default; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed and InnoDB is forced |
| File persistence | Cloud Filestore (NFS) | Persists `/var/www/html/upload` across restarts; enabled by default |
| Object storage | Cloud Storage | A dedicated `limesurvey-uploads` bucket provisioned automatically |
| Cache (optional) | Redis | Optional object cache; disabled by default |
| Secrets | Secret Manager | Auto-generated `ADMIN_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory and InnoDB is forced.** The engine is fixed by the shared
  application layer (`database_type = MYSQL_8_0`). InnoDB is forced because Cloud SQL
  disables MyISAM — the image's MyISAM default would otherwise fail table creation on
  first boot.
- **The schema is created on first container start**, not by a migration job. The
  `db-init` job only provisions an empty database + user; the upstream LimeSurvey
  console installer then builds the schema when the app boots. Allow generous startup
  time on the first deploy.
- **`ADMIN_PASSWORD` is generated automatically** and stored in Secret Manager. The
  container refuses to start without it. The first super-admin is seeded as `admin` /
  `admin@techequity.cloud`.
- **Cloud SQL is reached over TCP by default** (`enable_cloudsql_volume = false`) —
  LimeSurvey dials the Cloud SQL private IP over private networking; MySQL over
  private-IP TCP needs no SSL.
- **NFS is enabled by default** (`enable_nfs = true`) so uploaded assets survive
  container restarts. Requires the gen2 execution environment (the default).
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`) with
  `max_instance_count = 1`. Cold starts add latency after idle; set
  `min_instance_count = 1` to keep the service always warm.
- **`PUBLIC_URL` is set from the service URL** at plan time and corrected at runtime
  by the container entrypoint, so survey links and assets resolve on the real host.
- **Public ingress is the default** (`ingress_settings = "all"`) so respondents can
  reach public surveys. Enabling IAP will block anonymous respondents.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the LimeSurvey service

LimeSurvey runs as a Cloud Run v2 service that autoscales by request load between the
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

### B. Cloud SQL for MySQL 8.0

LimeSurvey stores all application data (surveys, questions, responses, users, global
settings) in a managed Cloud SQL for MySQL 8.0 instance. By default the service
connects over **private-IP TCP** (`enable_cloudsql_volume = false`); no public IP is
exposed. On first deploy the `db-init` Job creates the application database and user;
the schema is then built by LimeSurvey's own installer on container start.

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

### C. Cloud Filestore (NFS)

Enabled by default, a Cloud Filestore (NFS) instance is mounted into the service so
LimeSurvey's upload directory (`/var/www/html/upload` — asset images, signatures,
barcodes, uploaded response files) persists across container restarts and revisions.
NFS mounts require the gen2 execution environment.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the shared-NFS discovery model.

### D. Cloud Storage

A dedicated **Cloud Storage** bucket (`limesurvey-uploads`) is provisioned
automatically. Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/       # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### E. Redis (optional object cache)

Redis is **disabled by default** (`enable_redis = false`). It is an optional object
cache and is not required for LimeSurvey to run. When `redis_host` is left empty and
`enable_nfs` is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Inspect env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager

The LimeSurvey super-administrator password (`ADMIN_PASSWORD`) is generated
automatically and stored in Secret Manager, then injected as a secret env. The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### G. Networking & ingress

The service is reachable at its `run.app` URL by default, allowing the public access
needed for anonymous survey respondents. An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress
control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. LimeSurvey Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects over the Cloud SQL socket (if mounted) or the
  private-IP TCP fallback and idempotently creates the application database and user,
  grants privileges, and verifies the app user can connect. The job is safe to re-run.
- **Schema created on container start.** There is no separate migration job. Once
  `db-init` has provisioned an empty database, the upstream `martialblog/limesurvey`
  entrypoint runs LimeSurvey's console installer / `updatedb` on boot to build (or
  upgrade) the schema. If the container reports healthy but every page 500s with
  "table settings_global not found", the installer silently failed — almost always a
  storage-engine problem (see InnoDB note below) or a DB the installer could not
  reach.
- **InnoDB is forced.** `DB_MYSQL_ENGINE = InnoDB` and `DBENGINE = InnoDB` are set
  because Cloud SQL disables MyISAM. Do not override these back to MyISAM — table
  creation will fail.
- **`ADMIN_PASSWORD` is required.** The container exits 1 without it. It is
  auto-generated and stored in Secret Manager, and seeds the initial super-admin
  (`admin` / `admin@techequity.cloud`) on first boot. Retrieve it before first login:
  ```bash
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~admin-password' --format='value(name)' | head -1)" \
    --project "$PROJECT"
  ```
- **Public URL.** `PUBLIC_URL` is set from the predicted service URL at plan time and
  corrected at runtime from `CLOUDRUN_SERVICE_URL`, so survey links and static assets
  resolve on the real Cloud Run host. Confirm the deployed URL:
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --project "$PROJECT" --format='value(status.url)'
  ```
- **Health path.** The startup probe is TCP against the container port; the liveness
  probe is `GET /` (LimeSurvey serves an unauthenticated 200 at the root landing
  page). Allow generous first-boot time for the console installer.
- **Uploaded files.** Persist under `/var/www/html/upload` via the NFS mount. Without
  NFS, uploaded assets are lost when the instance is recycled.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for LimeSurvey are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `limesurvey` | Base name for the service, registry repo, and secrets. Do not change after first deploy. |
| `display_name` | `LimeSurvey` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Maps to the `martialblog/limesurvey` base tag; `latest` resolves to the pinned `6-apache`. Pin (e.g. `6-apache`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU minimum for LimeSurvey + MySQL. |
| `memory_limit` | `2Gi` | Memory per instance; 512Mi minimum, 2Gi recommended. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Keep at 1 unless shared NFS + session handling for multi-instance is confirmed. |
| `container_port` | `8080` | LimeSurvey (Apache) listens on 8080. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Max request duration; raise for large CSV imports. |
| `enable_cloudsql_volume` | `false` | `false` uses private-IP TCP to MySQL; set `true` for the Auth Proxy socket. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows anonymous survey respondents. `internal` blocks the public. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks anonymous respondents.** |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Filestore and mounts it to persist `/var/www/html/upload`. Requires gen2. |
| `nfs_mount_path` | `/var/www/html/upload` | Container mount path for the NFS volume. |
| `create_cloud_storage` | `true` | Create the declared GCS buckets. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed to MySQL 8.0. Other engines are unsupported. |
| `db_name` | `limesurvey` | Database name (injected as `DB_NAME`). Immutable after first deploy. |
| `db_user` | `limesurvey` | Application DB user (injected as `DB_USERNAME`). Password auto-generated in Secret Manager. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional object cache; not required. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

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
| `stage_services` | Stage-specific service details (Cloud Deploy). |
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
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, IAP with no authorized identities, an out-of-range `redis_port`/`backup_retention_days`, a `database_type` that does not match an enabled extension. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `DB_MYSQL_ENGINE` / `DBENGINE` (auto `InnoDB`) | Never set to MyISAM | Critical | Cloud SQL disables MyISAM; the installer's `CREATE TABLE … ENGINE=MyISAM` fails and every page 500s ("table settings_global not found"). |
| `database_type` | `MYSQL_8_0` | Critical | LimeSurvey requires MySQL; changing to Postgres/None breaks startup. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all survey data. |
| `ADMIN_PASSWORD` (auto-generated) | Retrieve from Secret Manager | Critical | The container exits 1 without it; changing it re-seeds the super-admin on next boot. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup URI fails the import job. |
| `enable_nfs` | `true` | High | Without NFS, uploaded assets under `/var/www/html/upload` are lost when the instance recycles. |
| `max_instance_count` | `1` | High | Multiple instances without confirmed shared NFS + session handling cause inconsistent upload state. |
| `execution_environment` | `gen2` | High | NFS/GCS mounts require gen2; `gen1` fails the plan-time validation. |
| `ingress_settings` | `all` | High | `internal` blocks anonymous survey respondents from reaching public surveys. |
| `enable_iap` | only for internal-only surveys | High | IAP requires Google sign-in for every request, blocking anonymous respondents. |
| `memory_limit` | `2Gi` | High | Below 512Mi risks OOM during large survey rendering or CSV import. |
| `enable_cloudsql_volume` | `false` (TCP) | Medium | LimeSurvey/MySQL uses private-IP TCP; forcing the socket without a mounted volume can stall the DB connection. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency on the first request after idle. |
| `application_version` | pin (e.g. `6-apache`) | Medium | `latest` resolves to the pinned `6-apache`; an unpinned major bump can require a schema upgrade. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. LimeSurvey-specific application configuration
shared with the GKE variant is described in
**[LimeSurvey_Common](LimeSurvey_Common.md)**.
