---
title: "Windmill on Google Cloud Run"
description: "Configuration reference for deploying Windmill on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Windmill on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Windmill_CloudRun.png" alt="Windmill on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Windmill is an open-source developer platform for building internal tools, scripts, flows, and automations. This module deploys Windmill on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Windmill uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Windmill runs as a combined server+worker container on Cloud Run v2. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Combined server+worker service, 2 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 16 | Required — Windmill requires PostgreSQL 16 or later |
| Object storage | Cloud Storage | A `windmill-data` bucket for workflow outputs and artefacts |
| Secrets | Secret Manager | Auto-generated database password and SMTP placeholder secret |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 16 is required.** Windmill uses PostgreSQL-specific features; the database engine is fixed. Using an older version or `NONE` will cause the init job to fail.
- **Combined server+worker mode.** `MODE=server,worker` and `NUM_WORKERS=3` run the API server and script execution workers in the same container instance. For independent worker scaling at high throughput, use `Windmill_GKE`.
- **`DISABLE_NSJAIL=true` is injected automatically.** Cloud Run does not grant `CAP_SYS_ADMIN`; Windmill's Linux namespace isolation is disabled accordingly.
- **Health probes use HTTP `GET /api/version`.** This lightweight endpoint returns the Windmill version string when the service is ready. Cloud Run does not issue HTTP→HTTPS redirects on this path, so an HTTP probe works correctly.
- **`BASE_URL` and `BASE_INTERNAL_URL` are constructed at startup** from platform-injected variables so OAuth callbacks and webhook URLs resolve correctly.
- **Redis is disabled by default.** Windmill operates without Redis for single-instance deployments. Enable Redis for distributed queue behaviour with multiple instances.
- **An SMTP placeholder secret is provisioned automatically.** Replace the `{prefix}-smtp-password` value in Secret Manager before enabling email notifications.
- **`min_instance_count` defaults to `0`** (scale-to-zero). Set it to `1` to keep an instance warm so webhook triggers and scheduled flows do not require a cold start.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Windmill service

Windmill runs as a Cloud Run v2 service that autoscales by request load between the minimum and maximum instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 16

Windmill stores all application data — scripts, flows, variables, resources, schedules, and job history — in a managed Cloud SQL for PostgreSQL 16 instance. The service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy an initialization Job idempotently creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`windmill-data`) is provisioned for workflow outputs, artefacts, and script dependencies. The workload service account is granted access automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for additional bucket options, GCS Fuse mounts, and CMEK.

### D. Secret Manager

The database password and the SMTP placeholder password are stored in Secret Manager and injected into the service at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging in structured JSON format (`JSON_FMT=true`). Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert policies. A Prometheus metrics endpoint is exposed at `:9001` for scraping within the VPC.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Windmill Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs on first deploy using `postgres:16-alpine`. It idempotently creates the `windmill_admin` and `windmill_user` roles, the application user, and the application database, then grants full privileges. The job is safe to re-run.
- **Automatic schema migrations.** Windmill runs its own database migrations on startup, so upgrading the `application_version` applies schema changes automatically.
- **Combined server+worker mode.** Each instance runs both the Windmill API/scheduler and `NUM_WORKERS=3` script execution workers. Workers execute Python, TypeScript, Bash, Go, and SQL scripts in isolated subprocesses. The `WORKER_GROUP=default` assignment means all flows and scripts route to these instances by default.
- **`BASE_URL` and `DATABASE_URL` construction.** The `entrypoint.sh` shim constructs `DATABASE_URL` from platform-injected `DB_*` variables at start time, handling both Unix socket (Auth Proxy) and TCP connections. `BASE_URL` and `BASE_INTERNAL_URL` are set from the predicted service URL so OAuth callbacks and webhooks resolve correctly.
- **Prometheus metrics.** `METRICS_ADDR=:9001` exposes Windmill metrics at `http://<instance-ip>:9001/metrics` for scraping from within the VPC.
- **Health path.** Both startup and liveness probes use `GET /api/version`. This endpoint returns HTTP 200 with the version string when Windmill is ready to serve traffic.
- **SMTP email notifications.** The `WINDMILL_SMTP_PASS` secret is initialised with a 16-character placeholder. Replace it and supply `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT`, and `WINDMILL_SMTP_FROM` via `environment_variables` to enable email notifications from flows and scripts.
- **Inspect jobs and their executions:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Windmill are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `windmill` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Windmill` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Windmill image version tag; set to a specific release (e.g. `1.400.0`) for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds with the bundled Dockerfile; `prebuilt` deploys an existing image URI. |
| `container_image` | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | `2000m` | CPU per instance. 2 vCPU is the recommended minimum for combined server+worker mode. |
| `memory_limit` | `2Gi` | Memory per instance. 4 GiB recommended for production Python/TypeScript workloads. |
| `min_instance_count` | `0` | Minimum instances. Set ≥ 1 so webhooks and scheduled flows are always available without a cold start. |
| `max_instance_count` | `3` | Maximum instances. Use Redis when scaling beyond 1 to coordinate job queues. |
| `container_port` | `8000` | Windmill listens on port 8000. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts and full Linux compatibility. |
| `timeout_seconds` | `300` | Max request duration. Increase (up to 3600) for long-running scripts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — required for the Unix socket connection. |
| `enable_image_mirroring` | `true` | Mirror the Windmill image into Artifact Registry to avoid ghcr.io rate limits. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged with Windmill defaults. Use to set `WINDMILL_SMTP_HOST`, `NUM_WORKERS` overrides, etc. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `WINDMILL_SMTP_PASS` is injected automatically. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see [App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Group 9 — Custom SQL & NFS

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend (only static assets benefit). |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `windmill-data` bucket and any additional buckets. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `enable_nfs` | `false` | NFS is disabled by default — Windmill does not require shared file storage. |
| `gcs_volumes` | `[]` | GCS Fuse mounts via the Cloud Run storage volume feature. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixed — Windmill requires PostgreSQL 16. Do not change. |
| `db_name` | `windmill` | Database name. Immutable after first deploy. |
| `db_user` | `windmill` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` PostgreSQL job. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/version`, 60s initial delay, 10 failures | Startup probe. |
| `liveness_probe` | HTTP `/api/version`, 60s initial delay, 3 failures | Liveness probe. |
| `uptime_check_config` | disabled, `/api/version` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for distributed queue behaviour (optional). |
| `redis_host` | `""` | Redis endpoint. |
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

Returned on a successful deployment — the quickest way to locate and explore the running resources.

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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critical | Windmill requires PostgreSQL 16; using an older version causes the init job to fail and the database to remain uninitialised. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all scripts, flows, and job history. |
| `enable_cloudsql_volume` | `true` | Critical | Windmill connects via the Auth Proxy Unix socket; disabling this causes immediate database failure and container crashes on startup. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `cpu_limit` | `2000m` | High | Combined mode runs 3 workers in-process; insufficient CPU throttles all script execution. Each worker needs ~500m. |
| `memory_limit` | `2Gi` | High | Windmill workers execute arbitrary user scripts; OOM kills mid-execution produce silent failures in the UI. |
| `min_instance_count` | `1` | High | `0` enables scale-to-zero; scheduled flows will be missed and webhooks return 503 until an instance is ready. |
| `service_url` / `BASE_URL` | Cloud Run URL or custom domain | High | Empty or incorrect value breaks OAuth callbacks, webhook endpoints, and Windmill UI deep-links. |
| `execution_environment` | `gen2` | High | Gen1 does not support GCS Fuse mounts; required when `gcs_volumes` is used. |
| `enable_vpc_sc` | `false` unless needed | High | Requires explicit `organization_id`; without it VPC-SC is silently skipped, giving a false sense of perimeter security. |
| `enable_redis` | `false` for single instance, `true` for multi | Medium | Without Redis, multiple instances each process only their own queue, which can cause job duplication or starvation. |
| `max_instance_count` | `3` | Medium | Beyond 1 instance without Redis coordination, the same job can be picked up by multiple workers simultaneously. |
| `timeout_seconds` | `300` (raise for long jobs) | Medium | Windmill jobs that exceed the Cloud Run request timeout are killed mid-execution without a graceful error. |
| `backup_schedule` | `0 2 * * *` | Medium | Empty string disables backups; Windmill stores all automation definitions in PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | Without these, the Windmill UI and API are publicly reachable. |
| `WINDMILL_SMTP_*` (via env vars) | all fields set together | Medium | Partial SMTP configuration causes silent email delivery failures with no runtime error. |
| `enable_auto_password_rotation` | `false` | Medium | When enabled, the Cloud Run revision must be redeployed after rotation; otherwise it uses an expired password until connections fail. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Windmill-specific application configuration shared with the GKE variant is described in **[Windmill_Common](Windmill_Common.md)**.
