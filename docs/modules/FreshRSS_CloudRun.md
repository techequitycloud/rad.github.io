---
title: "FreshRSS on Google Cloud Run"
description: "Configuration reference for deploying FreshRSS on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# FreshRSS on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreshRSS_CloudRun.png" alt="FreshRSS on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreshRSS is a free, self-hosted, GPL-3.0-licensed RSS and Atom feed aggregator — a
lightweight, multi-user "news reader" written in PHP that runs behind Apache and
exposes the Google Reader and Fever APIs for mobile clients. This module deploys
FreshRSS on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services FreshRSS uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

FreshRSS runs as a PHP/Apache container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service on port 80, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero enabled |
| Database | Cloud SQL for PostgreSQL 15 | Required — the entrypoint installs with `--db-type pgsql` |
| Persistent storage | NFS (Filestore / self-managed) | Mounted at `/var/www/FreshRSS/data`; holds config, per-user state, feed cache. No GCS bucket |
| Cache | Redis (optional) | Off by default; FreshRSS does not require it |
| Secrets | Secret Manager | Auto-generated `FRESHRSS_ADMIN_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the supported engine.** The container entrypoint hardcodes
  `--db-type pgsql` and the `db-init` job is Postgres-only; the schema is created by
  FreshRSS's own installer on first boot.
- **NFS is enabled by default** (`enable_nfs = true`) and mounted at
  `/var/www/FreshRSS/data`. FreshRSS writes its generated config
  (`data/config.php`), per-user state, cached articles, and favicons there —
  without a persistent volume this state is lost on every cold start or redeploy.
- **`FRESHRSS_ADMIN_PASSWORD` is generated automatically** and stored in Secret
  Manager. It seeds the default `admin` account (and its API password for mobile
  clients) on first install.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `max_instance_count = 1`). Cold starts add a few seconds of latency to the first
  request after idle.
- **Feed refresh runs as an in-container cron** (`CRON_MIN = */15`). While the
  service is scaled to zero, that cron does not fire — see the pitfalls table.
- **`max_instance_count = 1`.** A single instance owns the in-container refresh
  cron and the file-based session/cache state; running more than one without care
  duplicates feed refreshes.
- **The container listens on port 80** (Apache), not 8080.
- **`BASE_URL` is set from the predicted service URL at plan time and corrected at
  runtime** from `CLOUDRUN_SERVICE_URL`, so FreshRSS's self-referencing links and
  the `/` → setup redirect resolve on the real Cloud Run host.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the FreshRSS service

FreshRSS runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~freshrss"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

FreshRSS stores all application data (feeds, subscriptions, articles, categories,
users) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is
exposed. On first deploy the `db-init` Job creates the application database and
user, and FreshRSS's own installer creates the schema.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Persistent storage (NFS)

FreshRSS's data directory (`/var/www/FreshRSS/data`) is backed by an **NFS volume**
(`enable_nfs = true`), which holds the generated config, per-user state, cached
articles, and favicons. This module declares **no GCS bucket** — feed content is
kept in PostgreSQL and the NFS data dir.

- **Console:** Filestore → Instances (managed NFS), or Compute Engine → VM
  instances (self-managed NFS server).
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount inside the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS server model and GCS Fuse options.

### D. Redis (optional cache)

Redis is **disabled by default** (`enable_redis = false`) and FreshRSS does not
require it. It is exposed as a forwarded option for parity with sibling PHP modules;
leave it off unless you have a specific reason to enable it.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager

One application secret is generated automatically: `FRESHRSS_ADMIN_PASSWORD`, which
seeds the default `admin` account and its API password on first install. The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freshrss"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (public ingress). An
external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be
layered on; ingress settings and VPC egress control connectivity.

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

## 3. FreshRSS Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs using `postgres:15-alpine`.
  It connects through the Cloud SQL Auth Proxy and idempotently creates the
  application database and user and grants privileges. The job is safe to re-run.
- **First-boot install.** The container's `platform-entrypoint.sh` resolves the DB
  host, then drives FreshRSS's own `cli/do-install.php` (creates `data/config.php`
  and the schema) and `cli/create-user.php` (creates the `admin` account from
  `FRESHRSS_ADMIN_PASSWORD`), then chains the upstream entrypoint. The install is
  idempotent — it is skipped once `data/config.php` exists on the NFS volume.
- **Feed refresh cron.** The upstream image starts an in-container cron
  (`CRON_MIN = */15`) that actualizes subscribed feeds every 15 minutes. This runs
  only while an instance is alive — under scale-to-zero (`min_instance_count = 0`)
  refreshes pause until the next request wakes the service.
- **Admin credential.** The default login is `admin` with the generated
  `FRESHRSS_ADMIN_PASSWORD`; the same value is set as the API password used by
  Google Reader / Fever API mobile clients. Change it in the FreshRSS UI after first
  login — rotating the Secret Manager value alone will not re-set an
  already-installed account.
- **Health path.** The startup probe is a TCP check on port 80; the liveness probe
  is an HTTP GET on `/` (200). FreshRSS also serves an unauthenticated `/status`
  JSON endpoint suitable for uptime checks. Allow a generous first-boot window while
  the installer creates the schema.
- **Base URL.** `BASE_URL` is set to the predicted Cloud Run URL at plan time and
  corrected at runtime from `CLOUDRUN_SERVICE_URL`. Verify the running revision:
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for FreshRSS are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `freshrss` | Base name for resources. Do not change after first deploy. |
| `display_name` | `FreshRSS` | Human-readable name shown in the Console. |
| `application_version` | `latest` | FreshRSS image tag; `latest` is pinned to a known-good tag (`1.26.3`) at build time. Pin explicitly in production. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | FreshRSS ships a thin custom build; use `prebuilt` only with an external `container_image`. |
| `cpu_limit` | `1000m` | CPU per instance (1 vCPU). |
| `memory_limit` | `2Gi` | Memory per instance; keep ≥ 512Mi. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to keep the feed-refresh cron running. |
| `max_instance_count` | `1` | Keep at 1 — a single instance owns the refresh cron and file-based state. |
| `container_port` | `80` | FreshRSS/Apache listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy socket for Postgres connections. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows public access. |
| `enable_iap` | `false` | Require Google sign-in in front of FreshRSS. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Mounts a persistent NFS volume for the FreshRSS data directory. **Keep enabled** — required to persist config and per-user state. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Where the NFS volume is mounted inside the container. |
| `create_cloud_storage` / `storage_buckets` | `true` / `[]` | FreshRSS declares no bucket of its own; add here if needed. |
| `gcs_volumes` | `[]` | Optional GCS Fuse volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL engine version. FreshRSS installs with `--db-type pgsql`. |
| `db_name` | `freshrss` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `freshrss` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s delay, threshold 20 | Startup probe; the high threshold allows first-boot install time. |
| `liveness_probe` | HTTP `/` 300s delay | Liveness probe; `/status` is an alternative unauthenticated JSON endpoint. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default; FreshRSS does not require Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Redis endpoint if enabled. |

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
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (FreshRSS declares none). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS mounts, IAP with no authorized identities, an out-of-range `redis_port`/`backup_retention_days`, a `database_type` that does not match an enabled extension. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Disabling it puts the FreshRSS data dir on ephemeral disk — `config.php`, per-user state, and cache are wiped on every cold start/redeploy, forcing a re-install. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Critical | Mounting elsewhere leaves the data dir ephemeral (same effect as no NFS). |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all feed data. |
| `database_type` | `POSTGRES_15` | Critical | FreshRSS installs with `--db-type pgsql`; a non-Postgres engine breaks the installer and `db-init`. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `container_port` | `80` | High | FreshRSS/Apache listens on 80; a wrong port fails the startup probe and the service never becomes ready. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy socket avoids the SSL requirement of direct private-IP TCP to Cloud SQL Postgres; disabling it can break connectivity. |
| `min_instance_count` | `1` for reliable refresh | High | With `0` (scale-to-zero) the in-container feed-refresh cron pauses while idle; feeds only update when a request wakes the service. |
| `max_instance_count` | `1` | High | Running more than one instance duplicates the in-container refresh cron and splits file-based session/cache state. |
| `enable_iap` | only for private deploys | High | IAP blocks all unauthenticated requests, including mobile clients using the Google Reader / Fever API. |
| `FRESHRSS_ADMIN_PASSWORD` (auto-generated) | Change in the UI after first login | Medium | Rotating the secret alone does not re-set an already-installed account; the first password remains valid until changed in-app. |
| `memory_limit` | `2Gi` | Medium | Values below 512Mi risk OOM under heavy feed refresh. |
| `application_version` | Pin in production | Medium | `latest` resolves to a pinned tag at build time, but explicit pinning makes upgrades deliberate. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. FreshRSS-specific application configuration
shared with the GKE variant is described in **[FreshRSS_Common](FreshRSS_Common.md)**.
