---
title: "EspoCRM on Google Cloud Run"
description: "Configuration reference for deploying EspoCRM on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# EspoCRM on Google Cloud Run

EspoCRM is an open-source, GPLv3-licensed Customer Relationship Management (CRM)
platform built on PHP and Apache. This module deploys EspoCRM on **Cloud Run v2** on top
of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services EspoCRM uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every
Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

EspoCRM runs as a PHP/Apache container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Apache/PHP service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — EspoCRM does not support PostgreSQL; connected over private-IP TCP |
| Object storage | Cloud Storage + Filestore (NFS) | A dedicated `espocrm-data` GCS bucket is provisioned but **not mounted** by default; a shared NFS volume is mounted at `/var/lib/espocrm` for uploads (`enable_nfs = true` by default) |
| Cache | Redis (optional) | Optional object cache; disabled by default |
| Secrets | Secret Manager | Auto-generated `ESPOCRM_ADMIN_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`database_type = "MYSQL_8_0"`); EspoCRM does not support PostgreSQL.
- **The database is reached over private-IP TCP, not a socket.** `enable_cloudsql_volume`
  defaults to `false` on Cloud Run. EspoCRM's MySQL PDO connection needs a real TCP host,
  so `cloud-entrypoint.sh` dials the Cloud SQL private IP (`DB_IP`). Cloud SQL MySQL does
  not force SSL on private-IP TCP, so no extra TLS wiring is required.
- **The admin account is bootstrapped automatically.** The upstream installer creates the
  `admin` user with the auto-generated `ESPOCRM_ADMIN_PASSWORD` on first boot — retrieve
  it from Secret Manager to log in.
- **Schema is created on first boot, not by a migrate job.** `db-init` creates the
  database and user; the upstream `docker-entrypoint.sh` then runs the install/migrate
  action automatically when the container starts.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max_instance_count = 1`).
  Cold starts add several seconds of latency to the first request after idle. Set
  `min_instance_count = 1` to avoid cold starts.
- **NFS is enabled by default.** `enable_nfs = true` mounts a shared Filestore volume at
  `/var/lib/espocrm`, so EspoCRM's uploaded attachments and runtime data persist across
  container restarts and are shared across instances — unlike a bare Cloud Run
  deployment with only ephemeral disk. The auto-provisioned `espocrm-data` GCS bucket is
  **not** mounted anywhere by default.
- **Single instance by default.** `max_instance_count = 1` — Cloud Run has no built-in
  session affinity, so keep the service single-instance unless you have verified
  EspoCRM's behaviour under concurrent PHP sessions across replicas.
- **`ESPOCRM_SITE_URL` is derived from the predicted service URL** at plan time and
  resolved by the entrypoint, so EspoCRM's absolute links and installer checks use the
  real Cloud Run host rather than `localhost`.
- **Public ingress by default.** `ingress_settings = "all"` so the CRM UI is reachable;
  enabling IAP puts Google sign-in in front of it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the EspoCRM service

EspoCRM runs as a Cloud Run v2 service that autoscales by request load between the minimum
and maximum instance counts. Each deployment creates an immutable revision; traffic can be
split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Cloud SQL for MySQL 8.0

EspoCRM stores all application data (contacts, leads, opportunities, activities, users) in
a managed Cloud SQL for MySQL 8.0 instance. Because `enable_cloudsql_volume` defaults to
`false`, the service connects over the **private IP** (`DB_IP`) via VPC egress on port
`3306`; no public IP is exposed. On first deploy an initialization Job creates the
application database and user.

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

### C. Cloud Storage & NFS

A dedicated **Cloud Storage** bucket (`espocrm-data`) is provisioned automatically, but
it is **not mounted** anywhere by default (`gcs_volumes` defaults to `[]`). The actual
persistent store for EspoCRM's uploaded attachments and runtime data is a shared **NFS
(Filestore)** volume, mounted at `/var/lib/espocrm` because `enable_nfs = true` by
default. Additional GCS buckets can be declared via `storage_buckets`, and mounted via
`gcs_volumes` (requires the gen2 execution environment) if you want to use the bucket.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Redis (object cache)

Redis is **disabled by default**. When `enable_redis = true` is set, `REDIS_HOST` and
`REDIS_PORT` are injected and EspoCRM uses Redis as its object cache backend to reduce
database load. When `redis_host` is left empty and `enable_nfs` is true, the NFS server
VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

The first-run admin password (`ESPOCRM_ADMIN_PASSWORD`) is generated automatically and
stored in Secret Manager, then injected into the service as a secret env var. The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity. EspoCRM connects to Cloud SQL over the VPC, so VPC egress
must reach the private IP.

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

The `cloud-entrypoint.sh` prints the resolved `ESPOCRM_DATABASE_*` and `ESPOCRM_SITE_URL`
values at startup — a quick way to confirm the DB host and site URL the container is using.

---

## 3. EspoCRM Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It resolves the Cloud SQL connection (Auth Proxy socket if present,
  otherwise private-IP TCP), idempotently creates the application database and user, grants
  privileges, and verifies the app user can connect (warming the MySQL 8
  `caching_sha2_password` auth cache). The job runs on apply and is safe to re-run.
- **Schema created on first boot.** There is no separate migrate job. Once `db-init` has
  provisioned the database, the upstream EspoCRM `docker-entrypoint.sh` runs the
  install/migrate action automatically on container start, creating the schema and the
  `admin` user.
- **Admin login is auto-generated.** The `admin` user's password comes from the
  `ESPOCRM_ADMIN_PASSWORD` secret. Retrieve it before your first login:
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
  ```
  Change it in the EspoCRM UI (Administration → Users) once you are in.
- **Site URL must match the reachable host.** EspoCRM builds absolute links from
  `ESPOCRM_SITE_URL`; the entrypoint sets it from the predicted `run.app` URL (or
  `CLOUDRUN_SERVICE_URL` at runtime). If you front the service with a custom domain, set
  the site URL to that host so links and OAuth redirects are correct.
- **Health path.** Startup uses a TCP probe on port `80`; the liveness probe is
  `HTTP GET /` — EspoCRM serves its login page there unauthenticated (`200`). Allow
  several minutes on first boot for the install/migrate step (the default liveness probe
  has a 300-second initial delay).
- **Uploads persist on NFS.** With `enable_nfs = true` (default), EspoCRM's attachments
  and runtime data live under the shared `/var/lib/espocrm` Filestore mount, surviving
  container restarts and shared across instances. The `espocrm-data` GCS bucket is
  provisioned but not mounted by default.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for EspoCRM are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `espocrm` | Base name for resources. Do not change after first deploy. |
| `display_name` | `EspoCRM` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Image tag for `espocrm/espocrm`; `latest` is pinned internally to `10.0.2`. Pin to a specific release in production. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy plugins or large media. |
| `upload_max_filesize` | `64M` | Maximum single-file upload size (≤ `post_max_size`). |
| `post_max_size` | `64M` | Maximum POST size; must be ≥ `upload_max_filesize`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; minimum 1 vCPU for EspoCRM + MySQL. |
| `memory_limit` | `2Gi` | Memory per instance; minimum 512Mi (PHP 8.x). |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Keep at `1` unless shared storage + session affinity are confirmed. |
| `container_port` | `80` | Apache listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | EspoCRM connects to MySQL over private-IP TCP, not the socket. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access to the CRM UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route RFC 1918 traffic (incl. Cloud SQL private IP) via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of EspoCRM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the `espocrm-data` bucket. Not mounted anywhere unless you add a matching `gcs_volumes` entry. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket definitions provisioned when `create_cloud_storage` is true. |
| `enable_nfs` | `true` | Mounts a shared Filestore volume for EspoCRM's uploaded attachments and runtime data — persists across restarts by default. |
| `nfs_mount_path` | `/var/lib/espocrm` | Container mount path for the NFS volume. |
| `gcs_volumes` | `[]` | No GCS Fuse mount by default; the `espocrm-data` bucket stays unmounted unless you add an entry here. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Cloud SQL engine. EspoCRM requires MySQL — do not select PostgreSQL. |
| `db_name` | `espocrm` | MySQL database name. Immutable after first deploy. |
| `db_user` | `espocrm` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated DB password length (valid range 16–64). |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis as EspoCRM's object cache backend. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `redis_port`/`backup_retention_days`, a `gen1` runtime with NFS/GCS mounts, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | EspoCRM only supports MySQL; selecting PostgreSQL breaks startup. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `ESPOCRM_ADMIN_PASSWORD` (auto-generated) | Retrieve from Secret Manager; change in UI | Critical | Only sets the admin password on the **first** install; losing it locks you out until reset via DB. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup URI fails the import job. |
| `enable_nfs` | `true` | High | Disabling it drops EspoCRM's attachment storage to ephemeral container disk — uploads are lost when an instance scales down or is recycled. |
| `max_instance_count` | `1` unless verified safe | Medium | Uploads are NFS-backed by default, but Cloud Run has no built-in session affinity — verify EspoCRM's behaviour under concurrent PHP sessions before scaling beyond 1 instance. |
| `enable_cloudsql_volume` | `false` (private-IP TCP) | High | Forcing the socket without a matching entrypoint path can break the MySQL connection; EspoCRM dials the private IP by design. |
| `ESPOCRM_SITE_URL` (auto-derived) | Actual service / custom-domain URL | High | A wrong site URL breaks absolute links, the installer check, and OAuth redirects. |
| `memory_limit` | `2Gi` | High | Below 512Mi PHP 8.x OOM-kills during install/migrate and under load. |
| `cpu_limit` | `1000m` | Medium | Below 1 vCPU slows first-boot install and heavy plugin processing. |
| `enable_iap` | only when public UI not needed | Medium | IAP requires Google sign-in for every request, including API integrations. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start delay and, without a shared volume, drops local uploads on scale-down. |
| `application_version` | Pin in production | Medium | `latest` maps to a pinned tag internally, but pinning explicitly avoids surprise upgrades on redeploy. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
EspoCRM-specific application configuration shared with the GKE variant is described in
**[EspoCRM_Common](EspoCRM_Common.md)**.
