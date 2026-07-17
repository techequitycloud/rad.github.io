---
title: "Flowise on Google Cloud Run"
description: "Configuration reference for deploying Flowise on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Flowise on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flowise_CloudRun.png" alt="Flowise on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flowise is an open-source visual AI workflow builder that lets non-developers assemble
LangChain and LlamaIndex AI pipelines through a drag-and-drop interface. This module
deploys Flowise on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Flowise uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Flowise runs as a Node.js container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Flowise does not support MySQL in this deployment |
| Object storage | Cloud Storage | A dedicated uploads bucket always provisioned; stores Flowise file uploads |
| Secrets | Secret Manager | Auto-generated Flowise admin password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Selecting MySQL or `NONE` breaks startup.
- **GCS-backed file storage is always enabled.** `STORAGE_TYPE=gcs` and
  `APIKEY_STORAGE_TYPE=db` are injected automatically; API keys are stored in the
  database, not in files.
- **`DATABASE_*` variables are mapped by the entrypoint script** (`flowise-entrypoint.sh`)
  from platform-standard `DB_*` variables at container startup — do not set them
  directly as environment variables.
- **`min_instance_count = 0` by default.** Cold starts of 10–20s can exceed downstream
  LLM client timeouts on incoming requests — set `1` for latency-sensitive production use.
- **The admin password is generated automatically** and stored in Secret Manager;
  you never set it in plain text.
- **Redis is disabled by default.** It is not required for Flowise core functionality,
  but multi-instance deployments that share flow-execution state do benefit from it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Flowise service

Flowise runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Flowise stores all application data (flow definitions, credentials, executions) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through
the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy an
initialization Job creates the application database and user.

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

### C. Cloud Storage

A dedicated **Cloud Storage** uploads bucket is always provisioned by Flowise_Common.
Its name is injected into the service automatically as
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Flowise writes all user-uploaded files (documents,
images) to this bucket. Additional buckets can be configured via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

The Flowise admin password is stored in Secret Manager and injected into the service
at runtime; plaintext never appears in configuration. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

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

## 3. Flowise Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) using the
  `postgres:15-alpine` image creates the Flowise database and user and grants
  privileges before the service starts. It is idempotent and safe to re-run.
- **Health probe.** Both startup and liveness probes target Flowise's dedicated
  health endpoint `/api/v1/ping`, which returns HTTP 200 when the application is
  ready. The startup probe allows up to 5 minutes of startup budget (30 failures
  × 10-second interval) to accommodate first-boot database initialisation.
- **Admin login.** The initial admin username is configurable via `flowise_username`
  (default `admin`). The admin password is auto-generated and stored in Secret
  Manager; retrieve it with:
  ```bash
  gcloud secrets versions access latest \
    --secret=<resource_prefix>-flowise-password --project "$PROJECT"
  ```
- **DB variable remapping.** `flowise-entrypoint.sh` unconditionally maps
  `DB_HOST`, `DB_USER`, `DB_NAME`, and `DB_PASSWORD` (injected by the platform)
  to `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME`, and `DATABASE_PASSWORD`
  at container startup. Do not set `DATABASE_*` variables directly.
- **GCS file storage.** `STORAGE_TYPE=gcs` and `GCLOUD_PROJECT` are always injected.
  Flowise writes uploaded files to the auto-provisioned GCS bucket. Overriding
  `STORAGE_TYPE` causes uploads to be written to ephemeral Cloud Run storage and
  lost on every new revision.
- **Multi-instance considerations.** Flowise stores in-memory flow-execution state.
  Running more than one instance without Redis causes flow executions to fail when
  requests are load-balanced to a different instance. Keep `max_instance_count = 1`
  unless Redis is configured.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Flowise are listed; every other input is
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
| `application_name` | `flowise` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Flowise` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Service description. |
| `application_version` | `latest` | Flowise image version tag. |
| `flowise_username` | `admin` | Flowise admin username injected as `FLOWISE_USERNAME`. Change before exposing publicly. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build; `prebuilt` deploys an existing image URI. |
| `container_image` | `""` | Override image URI (only used when `container_image_source = "prebuilt"`). |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; raise toward 2 GiB for large flow graphs. |
| `min_instance_count` | `0` | Minimum instances. Set ≥ 1 to avoid cold-start latency for AI workloads. |
| `max_instance_count` | `1` | Maximum instances. Increase only with Redis enabled. |
| `container_port` | `3000` | Flowise listens on port 3000. |
| `execution_environment` | `gen2` | Gen2 is required for NFS volume mounts. |
| `timeout_seconds` | `300` | Max request duration. Increase for long-running AI workflow executions (max 3600). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. Use `internal` or `internal-and-cloud-load-balancing` to restrict. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Recommended for production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not override platform-managed vars (`DATABASE_*`, `FLOWISE_*`, `STORAGE_TYPE`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. `{ OPENAI_API_KEY = "flowise-openai-key" }`). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Rotation notification cadence. |

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

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `application_domains` | `[]` | Custom hostnames with Google-managed SSL. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. Requires `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision buckets in `storage_buckets`. The Flowise uploads bucket is always created by Flowise_Common. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | `false` | Provision Filestore NFS volume. Requires `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Cloud SQL engine. Flowise requires PostgreSQL. |
| `application_database_name` | `flowisedb` | Database name. Immutable after first deploy. |
| `application_database_user` | `flowiseuser` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names for connection details alongside the standard `DB_*` vars. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[{ name="db-init", … }]` | Leave at default to use the built-in PostgreSQL setup job. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs triggered by Cloud Scheduler. |
| `additional_services` | `[]` | Additional Cloud Run services deployed alongside Flowise. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/v1/ping`, 30–60s delay | Startup probe; allows 5-minute budget for DB init. |
| `liveness_probe` / `health_check_config` | HTTP `/api/v1/ping` | Liveness probe. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis (optional)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis. Not required for core functionality; needed for multi-instance deployments. |
| `redis_host` | `null` | Redis endpoint. Required when `enable_redis = true`. |
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
| `database_host` / `database_port` | DB endpoint / port (sensitive). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Flowise requires PostgreSQL; MySQL/`NONE` breaks startup. |
| `enable_cloudsql_volume` | `true` | Critical | Without the Auth Proxy sidecar, the database connection is refused. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `flowise_username` | change from `admin` | High | The default username is publicly known; combined with a guessed password it grants full access to all AI flows. |
| `FLOWISE_SECRETKEY_OVERWRITE` | leave unset after first deploy | High | Changing or removing this after the first deploy permanently scrambles all stored LLM API keys and vector-store credentials. |
| `memory_limit` | `1Gi` | High | Below 512Mi the Node.js process is OOM-killed on startup. Production with large flow graphs needs 2Gi. |
| `max_instance_count` | `1` (without Redis) | High | Multiple instances without a shared Redis store cause flow executions to fail when requests are routed to a different instance. |
| `STORAGE_TYPE` | `gcs` (default) | High | Overriding to anything else writes uploads to ephemeral storage, lost on every new revision. |
| `ingress_settings` | restrict for admin-facing | High | Default `all` allows traffic from any source; set to `internal-and-cloud-load-balancing` to restrict. |
| `enable_iap` | enable for admin-facing | High | The Flowise UI is otherwise publicly reachable without authentication. |
| `min_instance_count` | `1` | Medium | `0` causes cold starts of 10–20 s that frequently exceed downstream LLM client timeouts. |
| `enable_redis` | enable with >1 instance | Medium | Required for shared session/queue state across multiple instances. |
| `startup_probe.failure_threshold` | `30` (default) | Medium | Reducing below 10 causes Cloud Run to restart the container before Flowise has finished its DB init on first boot. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Flowise-specific application configuration shared
with the GKE variant is described in **[Flowise_Common](Flowise_Common.md)**.
