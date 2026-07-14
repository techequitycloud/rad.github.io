---
title: "OpenProject on Google Cloud Run"
description: "Configuration reference for deploying OpenProject on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# OpenProject on Google Cloud Run

OpenProject is an open-source, GPLv3-licensed project-management and team-collaboration
suite — work packages, Gantt timelines, agile boards, wikis, time tracking, and
budgets. This module deploys OpenProject on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services OpenProject uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

OpenProject runs as a Ruby on Rails (Puma) container on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Rails/Puma service, 2 vCPU / 4 GiB by default, always-allocated CPU |
| Database | Cloud SQL for PostgreSQL 15 | Required — OpenProject does not support MySQL or other engines |
| Attachment storage | Cloud Filestore (NFS) | Durable work-package attachment storage, mounted at `/opt/openproject/storage` |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |
| Background jobs | good_job (in-process, on PostgreSQL) | No Redis — the job queue lives in PostgreSQL |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Private-IP TCP database connection.** `enable_cloudsql_volume = false` on Cloud
  Run. OpenProject (Rails) reads a single URL-form `DATABASE_URL`, and Ruby's `URI`
  parser cannot hold the Cloud SQL Unix-socket directory (its colons break URL
  parsing), so the entrypoint connects over the instance private IP with
  `sslmode=require`.
- **No Redis.** Background jobs run through `good_job` with the queue in PostgreSQL
  (`GOOD_JOB_EXECUTION_MODE = async`); `enable_redis` is forwarded as `false`.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager. It
  must never be rotated after first boot — rotating it makes every existing session
  and all encrypted database columns unreadable.
- **CPU is always allocated** (`cpu_always_allocated = true`, `min_instance_count = 1`)
  because the in-process `good_job` worker and cron scheduler must keep running
  without an inbound request. This defeats scale-to-zero by design; see the pitfalls
  table for the cost-first flip-back.
- **Migrations run in a `db-migrate` job, not on boot.** The service runs web-only
  (`./docker/prod/web`); a dedicated apply-time job runs `rake db:migrate db:seed`
  first, so the web container boots fast against a migrated schema.
- **Health probes are TCP / disabled.** Rails 8 Host Authorization `400`s any HTTP
  probe whose `Host` header is the pod IP, so the startup probe is TCP and the
  liveness probe is disabled.
- **The first login is `admin` / `admin`.** OpenProject forces a password change on
  the first sign-in — do it immediately.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the OpenProject service

OpenProject runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

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

OpenProject stores all application data (projects, work packages, wikis, users,
attachments metadata) in a managed Cloud SQL for PostgreSQL 15 instance. On Cloud
Run the service connects over the instance **private IP with `sslmode=require`** (not
the Auth Proxy socket — Ruby's URL DSN parser cannot hold the socket directory). On
first deploy the `db-init` job creates the database and user, and the `db-migrate`
job runs `rake db:migrate db:seed` to build the schema and seed the admin account.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Filestore (NFS attachment storage)

Work-package attachments are stored on a **Cloud Filestore** NFS share mounted at
`/opt/openproject/storage` (`enable_nfs = true` by default). Without it, attachments
land on the container's ephemeral disk and are lost on every revision/redeploy.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

To use GCS-compatible object storage instead, set `OPENPROJECT_FOG_*` environment
variables. See [App_CloudRun](App_CloudRun.md) for the NFS server model.

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`SECRET_KEY_BASE` (Rails session/cookie signing and encrypted-column key derivation).
The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. OpenProject builds absolute URLs from
`OPENPROJECT_HOST__NAME` (set by the entrypoint) and `OPENPROJECT_HTTPS = true`.

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

## 3. OpenProject Application Behaviour

- **Two-phase first-deploy database setup.** The `db-init` job (`postgres:15-alpine`)
  creates the role and database; the `db-migrate` job then runs the app image with
  `rake db:migrate db:seed`. The migrate job drops any partial tables from an
  interrupted prior attempt (`DROP OWNED BY CURRENT_USER CASCADE`) before migrating,
  and creates the `pg_trgm` extension needed by OpenProject's trigram indexes. Both
  jobs run at apply time.
- **Migrations do not run on boot.** The service runs web-only (`./docker/prod/web`),
  which skips the all-in-one seeder. Rails (production) refuses to boot Puma while
  migrations are pending, so if `db-migrate` fails the service creation fails loudly —
  there is no silent empty-DB ship.
- **`SECRET_KEY_BASE` is immutable after first boot.** It is generated once and stored
  in Secret Manager. Changing it makes existing sessions and all encrypted columns
  unreadable. Only rotate during a planned maintenance window with a full data
  re-encryption plan.
- **Background jobs run in-process.** `good_job` runs its worker and cron inside the
  web container (`GOOD_JOB_EXECUTION_MODE = async`) with the queue on PostgreSQL — no
  Redis. This is why CPU is always allocated by default.
- **Host Authorization gates health probes.** Rails 8 returns `400 Invalid host_name`
  to any request whose `Host` header is not `OPENPROJECT_HOST__NAME`, including HTTP
  health probes (which use the pod IP). The startup probe is therefore TCP and the
  liveness probe is disabled; the readiness probe hits `/health_checks/default` where
  the platform sets the `Host` correctly.
- **First login is `admin` / `admin`.** Seeded by `rake db:seed`. OpenProject forces a
  password change on first sign-in.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for OpenProject are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `openproject` | Base name for resources. Do not change after first deploy. |
| `display_name` | `OpenProject` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | OpenProject image tag (`OPENPROJECT_VERSION`). `latest` is pinned to the stable major `16`; OpenProject publishes only numeric major tags. |
| `db_name` | `openproject` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `openproject` | Application database user. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance; Rails needs headroom for migrations and workers. |
| `cpu_always_allocated` | `true` | Keeps CPU allocated so the in-process `good_job` worker + cron run without inbound requests. |
| `min_instance_count` | `1` | Keeps one instance warm for background jobs. |
| `max_instance_count` | `5` | Autoscaling upper bound. |
| `container_port` | `80` | The all-in-one image serves on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | **Off on Cloud Run** — OpenProject connects over private-IP TCP. |
| `enable_image_mirroring` | `true` | Mirror the OpenProject image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress for browser and API access. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `OPENPROJECT_*` overrides). Do not set `SECRET_KEY_BASE` or `DATABASE_URL` here — they are managed automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | GCS buckets provisioned by default; add more for custom needs. |
| `enable_nfs` | `true` | Cloud Filestore for durable attachment storage. |
| `nfs_mount_path` | `/opt/openproject/storage` | OpenProject attachment path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `openproject` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `openproject` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `db-migrate` jobs. |
| `cron_jobs` | `[]` | Optional Cloud Scheduler + Cloud Run Jobs (e.g. an external cron endpoint if you flip to cold-start). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | **TCP**, 30s delay, 30 × 15s window | TCP because Rails Host Authorization `400`s HTTP probes; checks Puma is listening. |
| `liveness_probe` | **disabled** | Cloud Run has no TCP liveness; an HTTP one would restart-loop a healthy container. |
| `startup_probe_config` | HTTP `/`, enabled, 60s delay, failure_threshold 30 | App_CloudRun-level structured probe (parallel to `startup_probe`, which is what actually gates the container). |
| `health_check_config` | HTTP `/`, enabled, 60s delay, failure_threshold 3 | App_CloudRun-level structured liveness probe (parallel to `liveness_probe`, which is disabled on the container). |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check; enable for production monitoring. |
| `alert_policies` | `[]` | Metric alert policies. |

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
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `db-migrate`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes every existing session and all encrypted database columns unreadable. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_nfs` | `true` | Critical | Disabling it puts attachments on ephemeral disk — they are lost on every revision/redeploy. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_cloudsql_volume` | `false` on Cloud Run | High | Enabling the socket makes the Rails URL DSN unparseable (socket colons break the URL); the app fails to connect. |
| `startup_probe.type` | `TCP` | High | An HTTP startup probe hits Rails Host Authorization (`400 Invalid host_name`) and never passes — the revision never becomes Ready even though Puma is healthy. |
| `liveness_probe.enabled` | `false` | High | An HTTP liveness probe `400`s on Host Authorization and restart-loops a healthy container. |
| `memory_limit` | `4Gi` | High | Migrations and in-process workers OOM below ~2 GiB. |
| `cpu_always_allocated` | `true` | Medium | Setting `false` throttles the `good_job` worker/cron to ~0 between requests — background emails/notifications stall. Flip-back only with an external Cloud Scheduler cron endpoint. |
| `application_version` | Pin a major (`16`) | Medium | `latest` has no image tag on Docker Hub; the module pins it to `16`. Pin explicitly to control upgrades. |
| `min_instance_count` | `1` | Medium | Set `0` only alongside `cpu_always_allocated = false` and an external cron — otherwise background jobs stop between requests. |
| `enable_iap` | as needed | Medium | IAP blocks all unauthenticated access, including the API; enable only when that is intended. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. OpenProject-specific application configuration
shared with the GKE variant is described in
**[OpenProject_Common](OpenProject_Common.md)**.
