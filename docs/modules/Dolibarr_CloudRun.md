---
title: "Dolibarr on Google Cloud Run"
description: "Configuration reference for deploying Dolibarr on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Dolibarr on Google Cloud Run

Dolibarr is a free, open-source ERP and CRM suite covering customers and prospects,
quotes, orders, invoices, products and stock, HR, projects, and accounting through a
modular PHP web UI. This module deploys Dolibarr on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Dolibarr uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Dolibarr runs as a single PHP/Apache container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service on port 80, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0` |
| File persistence | Cloud Filestore (NFS) | Uploaded documents/PDFs persist under `/var/lib/dolibarr` across restarts |
| Object storage | Cloud Storage | A `dolibarr-documents` bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated `DOLI_ADMIN_PASSWORD` and `DOLI_INSTANCE_UNIQUE_ID`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`database_type = MYSQL_8_0`); other engines are not supported.
- **Cloud SQL is reached over TCP on the private IP.** On Cloud Run this variant
  defaults `enable_cloudsql_volume = false`, so Dolibarr and the `db-init` job
  connect to the instance's private IP on port 3306 (Cloud SQL MySQL 8 uses
  `caching_sha2_password`, handled by the init job).
- **Single instance by default.** `max_instance_count = 1`. Dolibarr keeps session
  and lock state that is not multi-instance-safe without shared storage and sticky
  routing — do not raise `max_instance_count` above 1 without verifying that first.
- **Scale-to-zero is enabled** (`min_instance_count = 0`). Cold starts add a few
  seconds plus the PHP/Apache boot on the first request after idle; set
  `min_instance_count = 1` for an always-warm service.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at `/var/lib/dolibarr`)
  so uploaded documents and generated PDFs survive container recreation.
- **First-boot auto-install.** `DOLI_INSTALL_AUTO = 1` makes the Dolibarr installer
  create the schema on first start; there is no separate migration job.
- **`DOLI_ADMIN_PASSWORD` and `DOLI_INSTANCE_UNIQUE_ID` are generated automatically**
  and stored in Secret Manager. The admin password is used to create the first-run
  super-admin account (username `DOLI_ADMIN_LOGIN`, default `admin`).
- **`DOLI_URL_ROOT` is set from the predicted service URL** at plan time so absolute
  links and login redirects resolve to the real Cloud Run address.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Dolibarr service

Dolibarr runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dolibarr"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for MySQL 8.0

Dolibarr stores all application data (third parties, invoices, products, users,
accounting) in a managed Cloud SQL for MySQL 8.0 instance. With the Cloud Run
default `enable_cloudsql_volume = false`, the service connects over **TCP to the
instance private IP** on port 3306; no public IP is exposed. On first deploy the
`db-init` job creates the application database, user, and grants; the Dolibarr
installer then creates the schema.

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

### C. Cloud Storage & file persistence

A dedicated **Cloud Storage** bucket (suffix `dolibarr-documents`, injected by the
Common layer) is provisioned automatically, alongside the standard `data`-suffix
bucket from `storage_buckets`. Separately, Dolibarr's document tree lives on **NFS**
at `/var/lib/dolibarr` so uploads and generated PDFs survive container recreation.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Secret Manager

Two Dolibarr secrets are generated automatically and stored in Secret Manager:
`DOLI_ADMIN_PASSWORD` (the first-run super-admin password) and
`DOLI_INSTANCE_UNIQUE_ID` (a per-instance security salt). The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Dolibarr Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects to Cloud SQL (TCP private IP on Cloud Run),
  idempotently creates the application database, user, and grants, verifies the app
  user can connect, then shuts down the Auth Proxy sidecar. The job is safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **First-boot auto-install (no separate migration job).** With
  `DOLI_INSTALL_AUTO = 1`, the Dolibarr image runs its own installer on first
  container start, creating the schema in the empty database. On version upgrades the
  image applies its own upgrade steps at boot.
- **Admin account.** The installer creates a super-admin whose username is
  `DOLI_ADMIN_LOGIN` (default `admin`) and whose password is the generated
  `DOLI_ADMIN_PASSWORD` secret. Retrieve it before first login.
- **DB env-var aliasing.** The platform injects the standard `DB_*` variables;
  Dolibarr reads `DOLI_DB_*`. The wrapper entrypoint aliases them at runtime and
  prefers the injected `DB_*` values over the image's baked `mysql`/`dolidb`
  defaults — otherwise the container waits forever for a non-existent host.
- **Health path.** Startup probe is **TCP** on port 80; liveness probe is **HTTP**
  `GET /` (the login page returns 200 with no auth). Allow several minutes on first
  boot for the installer before the login page is served.
- **`DOLI_INSTANCE_UNIQUE_ID` is a stable salt.** Keep it constant across the life of
  the deployment; it is used for cron URLs and token signing.
- **Inspect the init job and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION" --filter="metadata.name~dolibarr"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Dolibarr are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `dolibarr` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `dolibarr/dolibarr` image tag used as the custom-build base; `latest` is pinned to a known-good tag (`23.0.3`) at build time. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy modules/large document libraries. |
| `upload_max_filesize` / `post_max_size` | `64M` | Max upload / POST size; keep `post_max_size ≥ upload_max_filesize`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Dolibarr ships as a thin custom build; keep `custom`. |
| `cpu_limit` | `1000m` | 1 vCPU minimum for Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512Mi; 2Gi recommended for production. |
| `min_instance_count` | `0` | Scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | **Keep at 1** unless multi-instance sharing is verified. |
| `container_port` | `80` | Dolibarr runs on Apache, port 80. |
| `enable_cloudsql_volume` | `false` | `false` = TCP private-IP connection (Cloud Run default). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so uploaded documents persist. |
| `nfs_mount_path` | `/var/lib/dolibarr` | Where Dolibarr stores documents/PDFs. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional bucket beyond the auto-provisioned `dolibarr-documents` bucket, which the Common layer injects via `module_storage_buckets`. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed engine — Dolibarr requires MySQL. |
| `db_name` | `dolibarr` | Database name. Immutable after first deploy. |
| `db_user` | `dolibarr` | Application database user; password auto-generated in Secret Manager. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP port 80, 30s delay, 20 retries | Only needs the Apache listener to bind. |
| `liveness_probe` | HTTP `/` 300s delay | Login page returns 200 unauthenticated. |
| `uptime_check_config` | disabled (`path = "/"`) | Optional Cloud Monitoring uptime check. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional object cache; disabled by default. |
| `redis_host` / `redis_port` | `""` / `6379` | Redis endpoint when enabled. |

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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an invalid `container_port`, an out-of-range `timeout_seconds`/`backup_retention_days`, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Selecting a non-MySQL engine breaks the installer and every query. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `DOLI_INSTANCE_UNIQUE_ID` (auto-generated) | Never change | Critical | Changing the salt after first boot invalidates signed tokens and cron URLs. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded documents/PDFs ephemeral — lost on every container recreation. |
| `max_instance_count` | `1` | High | Raising it without shared storage + sticky routing risks split sessions, lock contention, and inconsistent document state. |
| `enable_backup_import` | `false` unless restoring | High | Enabling without a valid `backup_uri` fails the import job. |
| `DOLI_URL_ROOT` (auto-set) | Actual service URL | High | A wrong root URL breaks absolute links and the login redirect. |
| `memory_limit` | `2Gi` | High | Below 512Mi the PHP/Apache container OOMs under load; gen2 has a 512Mi floor. |
| `DOLI_ADMIN_PASSWORD` (auto-generated) | Retrieve before first login | Medium | Not knowing it locks you out of the first super-admin account until reset via the DB. |
| `ingress_settings` | `all` | Medium | `internal` blocks public access to the Dolibarr UI. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency on the first request after idle. |
| `enable_cloud_armor` | enable for production | Medium | The UI is publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Dolibarr-specific application configuration
shared with the GKE variant is described in **[Dolibarr_Common](Dolibarr_Common.md)**.
