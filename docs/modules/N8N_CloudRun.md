---
title: "n8n on Google Cloud Run"
---

# n8n on Google Cloud Run

n8n is a fair-code workflow automation platform that connects APIs, databases, and
services with a visual node editor. This module deploys n8n on **Cloud Run v2**
on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services n8n uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

n8n runs as a Node.js container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — n8n uses PostgreSQL for all workflow and credential data |
| Shared files | Filestore (NFS) | Binary file data shared across all instances; also serves as the default Redis endpoint |
| Object storage | Cloud Storage | A dedicated data bucket |
| Queue & coordination | Redis | Enabled by default; enables n8n queue mode for horizontal scaling |
| Secrets | Secret Manager | Auto-generated encryption key and SMTP password placeholder |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed; selecting any other
  engine or `NONE` breaks startup.
- **Redis is enabled by default.** Queue mode allows multiple n8n instances to
  distribute workflow execution. Without Redis, only one instance can run reliably.
- **The encryption key is irreplaceable.** `N8N_ENCRYPTION_KEY` is generated once
  and stored in Secret Manager. All workflow credentials are encrypted with it. If
  the key is rotated or deleted, every saved credential becomes permanently
  unreadable.
- **`min_instance_count` defaults to `0` (scale-to-zero).** This means no instance
  is running when idle. Webhooks registered in n8n require a running instance to
  receive calls — set `min_instance_count = 1` for any deployment that must receive
  webhooks without warm-up delay.
- **`WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are pre-set** to the predicted Cloud
  Run service URL so webhooks resolve correctly from first start. If a custom domain
  is added later, redeploy to update these values.
- **Gen2 execution environment is required** for NFS mounts. `execution_environment`
  defaults to `"gen2"`.
- The **SMTP password** secret is seeded with a dummy value; update it in Secret
  Manager before configuring email sending.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the n8n service

n8n runs as a Cloud Run v2 service that autoscales by request load between the
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

n8n stores all workflow definitions, execution history, and encrypted credentials
in a managed Cloud SQL for PostgreSQL 15 instance. The service connects privately
through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). The
`entrypoint.sh` script translates the platform-injected `DB_*` variables to
n8n-native `DB_POSTGRESDB_*` variables at runtime. On first deploy an
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

### C. Filestore (NFS) and Cloud Storage

Binary files uploaded to or produced by workflows are written to a **Filestore
(NFS)** share mounted into the service so all instances share the same data
(`N8N_DEFAULT_BINARY_DATA_MODE=filesystem`). The NFS host IP also serves as the
default Redis endpoint when no explicit `redis_host` is configured. A dedicated
**Cloud Storage** bucket is provisioned for broader data persistence.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis queue

Redis enables n8n's queue mode, distributing workflow executions across multiple
instances using Bull. In queue mode one or more "worker" instances pick up
executions from the queue while the main instance handles the editor and webhook
registration. When no external Redis host is configured and NFS is enabled, the NFS
host IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The n8n encryption key and the SMTP password placeholder are stored in Secret
Manager and injected into the service at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Update the SMTP password with the real credential:
  echo -n "my-real-smtp-password" | \
    gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

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

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. n8n Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) uses
  `postgres:15-alpine` to create the n8n database and user before the service
  starts. It is idempotent.
- **Environment variable translation.** `entrypoint.sh` maps `DB_HOST`, `DB_NAME`,
  `DB_USER`, and `DB_PASSWORD` (injected by the platform) to the n8n-native
  `DB_POSTGRESDB_*` equivalents at container startup.
- **Queue mode operation.** With `enable_redis = true` (the default), n8n starts
  in queue mode. The main instance handles webhook registration, the editor UI, and
  execution coordination; additional instances act as workers.
- **Webhook URL stability.** `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to the
  predicted Cloud Run service URL before deployment. Adding a custom domain later
  requires a redeploy to update these values.
- **Scale-to-zero and webhooks.** With `min_instance_count = 0`, no instance is
  running when idle. External services calling webhooks will experience cold-start
  latency and timeouts if the calling service has a short timeout. Set
  `min_instance_count = 1` to keep an instance warm for webhook workloads.
- **Binary data storage.** `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` directs n8n
  to write binary files to the NFS-mounted filesystem rather than the database,
  which is required for multi-instance deployments.
- **Health path.** Startup and liveness probes target the n8n root (`/`), which
  returns HTTP 200 only once the application is fully initialised. The startup probe
  uses a 120-second initial delay for first-boot setup.
- **Encryption key criticality.** `N8N_ENCRYPTION_KEY` encrypts all workflow
  credentials. If it changes, all saved credentials become permanently unreadable.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for n8n are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `n8n` | Base name for resources. Do not change after first deploy. |
| `display_name` | `N8N Workflow Automation` | Friendly name shown in the Console. |
| `description` | _(set)_ | Cloud Run service description. |
| `application_version` | `2.4.7` | n8n image version tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only without deploying the container. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `0` | Minimum instances. Set `1` to keep an instance warm for webhook workloads. |
| `max_instance_count` | `1` | Maximum instances (cost ceiling). |
| `container_port` | `5678` | n8n listens on port 5678. |
| `execution_environment` | `gen2` | Cloud Run execution generation. Gen2 required for NFS mounts. |
| `timeout_seconds` | `300` | Max request duration in seconds. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the n8n image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Number of old Cloud Run revisions to keep. |

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
| `environment_variables` | SMTP placeholder defaults | Extra non-secret settings. Core `N8N_*` and `DB_TYPE` values are set automatically. The default map includes `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, and `EMAIL_FROM` ready to override. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `explicit_secret_values` | `{}` | Sensitive values to store and inject as secrets. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

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

### Group 9 — Custom SQL

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for binary file data. Requires `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Data bucket / additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. |
| `db_name` | `n8n_db` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `n8n_user` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(set)_ | Names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` database setup job. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. n8n's built-in scheduler handles workflow triggers; use these for external operations. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `GET /`, 120s initial delay | Startup probe targets the n8n root. |
| `liveness_probe` / `health_check_config` | HTTP `GET /`, 30s initial delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for queue-mode workflow execution. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS host IP. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` | _(auto-generated, never rotate)_ | Critical | Rotating or deleting this key destroys all saved workflow credentials permanently. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all workflow data. |
| `enable_nfs` | `true` | Critical | Without shared storage, binary files are not shared across instances and `filesystem` binary mode fails. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` | `true` | High | Without Redis queue mode, running more than one instance causes workflow execution conflicts. |
| `redis_host` | `""` (NFS) or explicit | High | No valid endpoint if Redis is on but NFS is off and no host is set. |
| `min_instance_count` | `1` for webhook workloads | High | `0` (default) causes cold-start timeouts on webhook calls from services with short timeouts. |
| `execution_environment` | `gen2` (default) | High | NFS mounts require Gen2; Gen1 instances cannot mount NFS volumes. |
| `memory_limit` | `4Gi` | High | Too little memory causes OOM during large workflow execution batches. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | The n8n editor is otherwise publicly reachable and exposes all saved credentials. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. n8n-specific application configuration shared
with the GKE variant is described in **[N8N_Common](N8N_Common.md)**.
