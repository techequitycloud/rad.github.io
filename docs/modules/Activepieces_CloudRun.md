---
title: "Activepieces on Google Cloud Run"
description: "Configuration reference for deploying Activepieces on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Activepieces on Google Cloud Run

Activepieces is an open-source, Apache 2.0-licensed no-code workflow automation
platform for connecting apps, APIs, and data sources. This module deploys
Activepieces on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Activepieces uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Activepieces runs as a Node.js container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Activepieces does not support MySQL or other engines |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Cache & queue | Redis (optional) | Required for horizontal scaling; memory queue mode is the default |
| Secrets | Secret Manager | Auto-generated `AP_ENCRYPTION_KEY` and `AP_JWT_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Memory queue mode is the default.** `AP_QUEUE_MODE = MEMORY` means all workflow
  jobs run in-process in a single instance. Scaling beyond one instance requires
  Redis (`enable_redis = true`).
- **`AP_ENCRYPTION_KEY` and `AP_JWT_SECRET` are generated automatically** and stored
  in Secret Manager. These keys must never be rotated after first boot without a
  maintenance window — rotating `AP_ENCRYPTION_KEY` corrupts all stored connection
  credentials, and rotating `AP_JWT_SECRET` invalidates all active user sessions.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Cold starts
  add 5–15 seconds of latency to the first request after idle. Set
  `min_instance_count = 1` to avoid cold starts on time-sensitive webhook flows.
- **Public ingress is required for webhooks.** `ingress_settings = "all"` is the
  default so external services can POST to Activepieces webhook endpoints. Enabling
  IAP will block these external calls.
- **NFS is disabled by default.** Activepieces stores all workflow state in
  PostgreSQL. Enable NFS only if co-locating Redis on the NFS server VM.
- **The `pgvector` extension is installed automatically** during the first-deploy
  database setup job, enabling AI-powered workflow pieces.
- **`AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` are set from the predicted service
  URL at plan time and corrected at runtime** by the container entrypoint, ensuring
  webhook and OAuth redirect URLs always reflect the actual Cloud Run service URL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Activepieces service

Activepieces runs as a Cloud Run v2 service that autoscales by request load between
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

Activepieces stores all application data (flows, connections, execution history,
users) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is
exposed. On first deploy an initialization Job creates the application database and
user and installs the `pgvector` extension.

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

### C. Cloud Storage

A dedicated **Cloud Storage** data bucket is provisioned automatically for
Activepieces file storage. Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (queue mode)

Redis is **disabled by default** (`AP_QUEUE_MODE = MEMORY`). When `enable_redis = true`
is set, the queue backend switches to `AP_QUEUE_MODE = REDIS`, which is required
before scaling beyond one instance. When `redis_host` is left empty and `enable_nfs`
is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm queue mode in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`AP_ENCRYPTION_KEY` (used to encrypt all stored connection credentials) and
`AP_JWT_SECRET` (used to sign user session tokens). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows public
access required for webhook endpoints. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity.

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

## 3. Activepieces Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user, grants privileges, and
  installs the `pgvector` extension for AI-powered flow pieces. The job is safe to
  re-run.
- **Database migrations on start.** Activepieces applies its own schema migrations
  automatically on every startup, so upgrading the application version applies schema
  changes without a separate migration step.
- **`AP_ENCRYPTION_KEY` and `AP_JWT_SECRET` are immutable after first boot.** These
  keys are generated once and written to Secret Manager. Changing `AP_ENCRYPTION_KEY`
  permanently corrupts all stored connection credentials. Changing `AP_JWT_SECRET`
  invalidates all active user sessions. Only rotate during a planned maintenance
  window.
- **Webhook endpoints.** The default `ingress_settings = "all"` allows external
  systems to POST to Activepieces webhook URLs. Enabling IAP will block these calls.
  After deployment, verify `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` match the
  actual service URL. Inspect the running revision:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Sign-up is open by default.** `AP_SIGN_UP_ENABLED = "true"` is injected
  automatically. After creating the initial administrator account, disable sign-up
  by adding `AP_SIGN_UP_ENABLED = "false"` to `environment_variables`.
- **Health path.** Startup and liveness probes target `/api/v1/flags` — the
  Activepieces flags API endpoint that responds only when the server is fully
  initialised and connected to PostgreSQL. Allow at least 7 minutes on first boot
  (the default startup probe provides a 120-second initial delay plus a 300-second
  retry window).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Activepieces are listed; every other input is
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
| `application_name` | `activepieces` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Activepieces Workflow Automation` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Activepieces image version tag; pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `2Gi` | Memory per instance; minimum 1 GiB. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts on webhooks. |
| `max_instance_count` | `1` | **Only increase when `enable_redis = true`.** |
| `container_port` | `8080` | Activepieces listens on port 8080. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Activepieces image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for public webhook endpoints. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks public webhook endpoints.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `AP_*` values are set automatically — do not set `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, or `AP_POSTGRES_*` here. |
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

### Group 9 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 10 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `enable_nfs` | `false` | NFS is off by default; enable only if co-locating Redis on the NFS server. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 11 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `activepieces_db` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `ap_user` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not forwarded — Activepieces has no platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/flags` 120s delay | Startup probe. Allow 7+ minutes on first boot. |
| `liveness_probe` | HTTP `/api/v1/flags` 30s delay | Liveness probe. |
| `startup_probe_config` | disabled | Alternative structured probe (disabled by default; `startup_probe` takes effect). |
| `health_check_config` | HTTP `/` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Switch `AP_QUEUE_MODE` from `MEMORY` to `REDIS`. Required when `max_instance_count > 1`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
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
| `AP_ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently corrupts all stored connection credentials — they cannot be decrypted. |
| `AP_JWT_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login for everyone. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX` | Actual service URL | Critical | Incorrect URL breaks all webhook integrations and OAuth callbacks. |
| `max_instance_count` | `1` unless Redis enabled | High | Scaling beyond 1 in memory queue mode splits the job queue across instances, causing duplicate executions and lost runs. |
| `enable_redis` | `true` before scaling | High | Without Redis, each instance maintains its own in-memory queue — inconsistent execution with more than 1 instance. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but NFS is off and no host is set, the Redis connection string is blank and the app fails to start. |
| `memory_limit` | `2Gi` | High | Values below 1 GiB cause OOM kills during concurrent flow executions. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks all external webhook callbacks. |
| `enable_iap` | only when webhooks not needed | High | IAP blocks all unauthenticated requests, including external webhook callbacks. |
| `AP_SIGN_UP_ENABLED` (auto-injected `"true"`) | Disable after first admin | High | Leaving sign-up open allows anyone with the URL to create an account. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds 5–15 second cold-start delays on incoming webhooks after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | Webhook endpoints and the admin UI are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Activepieces-specific application configuration
shared with the GKE variant is described in
**[Activepieces_Common](Activepieces_Common.md)**.
