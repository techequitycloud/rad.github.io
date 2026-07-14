---
title: "Zammad on Google Cloud Run"
description: "Configuration reference for deploying Zammad on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Zammad on Google Cloud Run

Zammad is an open-source helpdesk and customer support platform — a GDPR-compliant
alternative to Zendesk and Freshdesk. This module deploys Zammad on **Cloud Run v2**
on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Zammad uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Zammad runs as a Ruby on Rails (railsserver) container on Cloud Run v2. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Rails service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Zammad does not support MySQL |
| Attachment storage | Filestore (NFS) | Ticket attachments at `/opt/zammad/storage`, shared across all instances |
| Object storage | Cloud Storage | A dedicated `zammad-attachments` bucket, always provisioned |
| Cache & job queue | Redis | Enabled by default; required for ActionCable WebSocket pub/sub and Sidekiq |
| Secrets | Secret Manager | Database password managed automatically |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** MySQL is not supported and is rejected at plan time.
- **Redis is required.** Zammad uses Redis for real-time ticket updates (ActionCable)
  and background job processing (Sidekiq). Without it, Zammad fails to start.
- **A custom image is built via Cloud Build.** `container_image_source = "custom"` is
  the default — Cloud Build wraps the official `zammad/zammad` Docker Hub image with
  a GCP-specific `entrypoint.sh` that maps Foundation `DB_*` variables to Zammad's
  `POSTGRESQL_*` convention.
- **The startup probe targets `/`.** Zammad returns HTTP 200 there only once fully
  initialised. The probe is deliberately lenient (30 failure threshold) to
  accommodate first-boot schema migration.
- **Database migrations run on every instance start** (idempotent via `zammad-init`),
  so version upgrades apply schema changes automatically.
- `min_instance_count = 0` is the default (scale-to-zero); override to `1` to
  eliminate 60–90-second cold starts on a production helpdesk.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Zammad service

Zammad runs as a Cloud Run v2 service that autoscales by request load between the
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

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Zammad stores all helpdesk data (tickets, users, channels, SLA records) in a managed
Cloud SQL for PostgreSQL 15 instance. The service connects privately through the
**Cloud SQL Auth Proxy** over a Unix socket — no public IP is exposed. On the first
deploy an initialization Job creates the application database and user. On every
subsequent instance start, `zammad-init` applies any pending schema migrations.

**Cloud Run TCP workaround:** Zammad's `docker-entrypoint.sh` checks PostgreSQL
readiness using a TCP bash socket. Because Cloud Run's `DB_HOST` is a Unix socket
path (not TCP-addressable), the custom `entrypoint.sh` uses the Cloud SQL private IP
(`DB_IP`) instead for this check.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Filestore (NFS) and Cloud Storage

Ticket attachments and uploaded files are written to a **Filestore (NFS)** share
mounted at `/opt/zammad/storage` inside the service so all instances share the same
files. A dedicated **Cloud Storage** (`zammad-attachments`) bucket is also
provisioned automatically. Gen2 execution environment is required for NFS mounts.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis cache and job queue

Redis is mandatory for Zammad and serves two critical roles:

1. **ActionCable pub/sub** — delivers real-time ticket updates to agents across
   multiple Cloud Run instances.
2. **Sidekiq** — processes background jobs (email dispatch, SLA notifications,
   LDAP sync, scheduler tasks).

When no external `redis_host` is configured and NFS is enabled, the NFS host IP is
used as the Redis endpoint. For production, use a dedicated Google Cloud Memorystore
for Redis instance and set `vpc_egress_setting = "ALL_TRAFFIC"` so Cloud Run can
reach its private IP.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The database password is stored in Secret Manager and injected into the service at
runtime. Zammad manages its own internal signing keys — no application-level secret
is auto-generated by this module.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on. When
using Memorystore for Redis, `vpc_egress_setting` must be `"ALL_TRAFFIC"` so Redis
connections are routed through the VPC.

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

## 3. Zammad Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs before the
  service starts. It connects to Cloud SQL via the Auth Proxy and idempotently creates
  the Zammad database, user, and grants privileges. It is safe to re-run.
- **Migrations on every start.** The custom `entrypoint.sh` calls `zammad-init`
  (Rails DB migration + seed) before starting the railsserver on every instance start.
  Pending migrations are applied; already-run ones are skipped.
- **Variable bridging.** The Foundation module injects database credentials as
  `DB_HOST`, `DB_USER`, `DB_PASSWORD`, etc. The custom `entrypoint.sh` maps these
  to Zammad's `POSTGRESQL_*` convention, and uses `DB_IP` (Cloud SQL private IP) for
  the TCP readiness check because Cloud Run's `DB_HOST` is a Unix socket path.
- **WebSocket connectivity.** Zammad agents receive live ticket updates via
  ActionCable WebSockets. With multiple instances, Redis pub/sub coordinates events
  across them — this is why `enable_redis = true` is mandatory.
- **Health path.** Startup and liveness probes target `/`, which returns
  HTTP 200 only when Zammad is fully initialised. The startup probe allows up to
  510 seconds total (60-second initial delay, 30 retries at 15-second intervals) to
  accommodate first-boot schema migration.
- **Email integration.** Configure SMTP after first login at **Admin → Channels →
  Email**. SMTP credentials can be injected via `secret_environment_variables`.
- **Inspect scheduled jobs:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Zammad are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `elasticsearch_url` | `""` | Elasticsearch HTTP endpoint for full-text search. Leave empty to disable. |
| `elasticsearch_username` | `""` | Elasticsearch username. Leave empty when security is disabled. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `zammad` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Zammad Helpdesk` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `6.4.1` | Zammad image version tag; increment to trigger a new build. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build (required for the GCP entrypoint); `prebuilt` skips the build. |
| `container_image` | `""` | Override container image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | `2000m` | CPU per instance. 2 vCPU minimum for Zammad. |
| `memory_limit` | `4Gi` | Memory per instance. Minimum 2 GiB; 4 GiB recommended. |
| `container_port` | `3000` | Zammad railsserver port. Must match `ZAMMAD_RAILSSERVER_PORT`. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts and GCS Fuse. |
| `min_instance_count` | `0` | Minimum instances (scale-to-zero). Set ≥ 1 to avoid cold starts on a production helpdesk. |
| `max_instance_count` | `5` | Maximum instances (cost ceiling). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. Do not disable. |
| `enable_image_mirroring` | `true` | Mirrors the Zammad Docker Hub image into Artifact Registry before deploy. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Use `ALL_TRAFFIC` when Redis is hosted on Memorystore (private IP). |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `POSTGRESQL_*` and `RAILS_*` values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. for SMTP passwords). |
| `explicit_secret_values` | `{}` | Sensitive values to store and inject as secrets. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend (suitable only for static assets). |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Zammad attachment storage. Requires Gen2. |
| `nfs_mount_path` | `/opt/zammad/storage` | Mount path inside the container. Must match Zammad's storage configuration. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. The `zammad-attachments` bucket is always created. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Zammad requires PostgreSQL. |
| `db_name` | `zammad` | Database name. Immutable after first deploy. |
| `db_user` | `zammad` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Non-empty list replaces it entirely. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. Zammad handles its own internal scheduling; add custom maintenance jobs here. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/`, 60s delay, 30 retries | Generous tolerance for first-boot schema migration. |
| `liveness_probe` / `health_check_config` | `/`, 60s delay | Restarts the container after 3 consecutive failures. |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check targeting `/`; set `enabled = true` to provision it. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Job Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required.** Use Redis for ActionCable and Sidekiq. |
| `redis_host` | `""` | Leave empty to use the NFS host IP; set explicitly for Memorystore. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

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
| `storage_buckets` | Created Cloud Storage buckets (including `zammad-attachments`). |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Zammad requires PostgreSQL; MySQL is rejected at plan time. |
| `container_image_source` | `custom` (default) | Critical | Using `prebuilt` without the custom entrypoint means `DB_*` → `POSTGRESQL_*` mapping does not happen and all database connections fail on startup. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling removes the Auth Proxy socket; all database connections fail. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all helpdesk data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup fails the import job; enabling on every apply overwrites live data. |
| `enable_redis` | `true` | Critical | Without Redis, ActionCable and Sidekiq fail to initialise; Zammad will not start. |
| `redis_host` | explicit or NFS IP | Critical | Empty with NFS disabled means no valid Redis endpoint — Zammad fails to start. |
| `memory_limit` | `4Gi` | High | Zammad OOMs during schema migration or under load below 2 GiB. |
| `nfs_mount_path` | `/opt/zammad/storage` | High | Changing this causes attachments to be written to ephemeral instance storage; existing NFS attachments become inaccessible. |
| `enable_nfs` | `true` | High | Without NFS, all uploaded attachments are lost on instance restart. |
| `min_instance_count` | `1` | High | `0` causes 60–90-second cold starts for the first agent to open a ticket. |
| `vpc_egress_setting` | `ALL_TRAFFIC` when using Memorystore | High | Memorystore Redis private IP may not be reachable with `PRIVATE_RANGES_ONLY`; Redis connections are refused. |
| `startup_probe.initial_delay_seconds` | `60` (or higher) | High | Too short causes restart loops while schema migration is running on first boot. |
| `max_instance_count` > 1 without Redis | configure Redis first | Medium | Multiple instances without Redis cause race conditions on ticket assignment and real-time state divergence. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The Zammad admin UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cdn` | off (default) | Medium | Zammad's API responses are dynamic; CDN caching breaks ticket lists and real-time views unless `Cache-Control: no-cache` headers are set. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Zammad-specific application configuration shared
with the GKE variant is described in **[Zammad_Common](Zammad_Common.md)**.
