---
title: "Ghost on Google Cloud Run"
description: "Configuration reference for deploying Ghost on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Ghost on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghost_CloudRun.png" alt="Ghost on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghost is a modern open-source publishing platform powering 2M+ publications with built-in membership, subscriptions, and newsletters. This module deploys Ghost on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Ghost uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Ghost runs as a Node.js container on Cloud Run v2. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 512 MiB by default, request-based billing with scale-to-zero |
| Database | Cloud SQL for MySQL 8.0 | Required — Ghost 6.x does not support PostgreSQL |
| Shared files | Filestore (NFS) | Uploaded content and themes shared across all instances (gen2 required) |
| Object storage | Cloud Storage | A dedicated content bucket (`ghost-content`) provisioned automatically |
| Cache | Redis | Enabled by default; falls back to the NFS host IP when no Redis host is given |
| Secrets | Secret Manager | Database password managed automatically |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** Ghost 6.x requires MySQL; PostgreSQL is not supported and will not start.
- **`database__client = "mysql"` is injected automatically.** Without this Ghost silently falls back to SQLite — the module handles it so you never need to set it manually.
- **Redis is enabled by default.** Ghost uses Redis for page caching to reduce database load and improve response times.
- **Dynamic URL detection.** The custom entrypoint queries the Cloud Run API at startup to discover the service URL and export it as `url` for Ghost. An explicit `url` environment variable takes precedence.
- **A `ghost-content` GCS bucket is provisioned automatically** by `Ghost_Common` and does not need to be added to `storage_buckets`.
- **A `db-init` job runs on every apply** to idempotently create the Ghost MySQL database and user.
- **Health probes target `/`** with a 90-second initial delay to allow Ghost to run database migrations and compile themes on first boot.
- The **database password** is generated automatically and stored in Secret Manager.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Ghost service

Ghost runs as a Cloud Run v2 service that autoscales by request load between the minimum and maximum instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for MySQL 8.0

Ghost stores all application data (posts, members, settings) in a managed Cloud SQL for MySQL 8.0 instance. The service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy a `db-init` Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Filestore (NFS) and Cloud Storage

Uploaded content (images, themes, files) is written to a **Filestore (NFS)** share mounted into the service so all instances share the same files. A dedicated **Cloud Storage** bucket (`ghost-content`) is also provisioned automatically for content. The gen2 execution environment is required for NFS mounts.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<content-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis cache

Redis backs Ghost's page caching. When no external Redis host is configured and NFS is enabled, the NFS host IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The database password is stored in Secret Manager and injected into the service at runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Ghost Application Behaviour

- **First-deploy database setup.** A `db-init` Job connects to Cloud SQL via the Auth Proxy and idempotently creates the Ghost database (with `utf8mb4` charset and `utf8mb4_0900_ai_ci` collation), creates the application user, and grants full privileges. The job runs on every apply and is safe to re-run.
- **Slow first boot.** Ghost runs database migrations and compiles themes on first start. The startup probe allows 90 seconds of initial delay — do not reduce this below 60 seconds or the instance will be killed before Ghost finishes initialising.
- **Dynamic URL detection.** On startup the custom entrypoint queries the Cloud Run metadata API to discover the service URL and sets it as Ghost's `url` and `admin__url`. An explicit `url` environment variable always takes precedence. This ensures Ghost generates correct absolute links in membership emails and admin navigation.
- **Database connection.** The entrypoint maps `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD`, and `DB_PORT` to Ghost's `database__connection__*` settings automatically. When `DB_HOST` starts with `/` it is treated as a Unix socket path (the Cloud SQL Auth Proxy socket).
- **SMTP for email.** Ghost requires SMTP for member sign-ups, password resets, and newsletter delivery. Pre-populated `environment_variables` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`) — configure them before inviting members.
- **Admin login.** Ghost's admin panel is at `<url>/ghost`. On first boot Ghost creates an admin user interactively.
- **Health path.** Startup and liveness probes target `/`, which returns HTTP 200 when Ghost is fully initialised.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Ghost are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `ghost` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Ghost Publishing` | Friendly name shown in the Console. |
| `description` | `Ghost - Professional publishing platform` | Service description. |
| `application_version` | `6.14.0` | Ghost image version tag; increment to trigger a new revision. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; sized for light/typical usage — raise to `2000m` for production with heavy image processing or membership. |
| `memory_limit` | `512Mi` | Memory per instance (Ghost's floor); raise to `1Gi`+ for production with active membership features. |
| `min_instance_count` | `0` | Minimum instances; `0` enables scale-to-zero — set `1` to avoid cold starts with migration delays. |
| `container_port` | `2368` | Ghost's native HTTP port. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build (default); `prebuilt` deploys an existing image. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. Required for Ghost. |
| `execution_environment` | `gen2` | Cloud Run gen2 required for NFS mounts. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `ingress_settings` | `all` | Which networks may reach the service (all / internal / LB-only). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{SMTP_HOST="", SMTP_PORT="587", SMTP_USER="", SMTP_PASSWORD="", SMTP_SSL="false", EMAIL_FROM="ghost@example.com"}` | SMTP settings pre-populated for Ghost email delivery (use port 587 STARTTLS or 465 SSL — Google Cloud blocks outbound port 25). `database__client=mysql` is injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Replication wait after secret creation. |
| `secret_rotation_period` | `2592000s` | Rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see [App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — Custom SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. Ghost must know its public URL — ensure the domain matches. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Ghost content. Requires gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. The `ghost-content` bucket is always provisioned automatically. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Ghost requires MySQL 8.0 — do not change. |
| `db_name` | `ghost` | MySQL database name. Immutable after first deploy. |
| `db_user` | `ghost` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names for connection details. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 90s initial delay, 10 failures | HTTP startup probe against Ghost's root path. Generous delay for first-boot migrations. |
| `liveness_probe` | HTTP `/` 60s initial delay | Liveness probe targeting Ghost's root path. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for Ghost page caching. |
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
| `storage_buckets` | Created Cloud Storage buckets (includes the `ghost-content` bucket). |
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
| `database_type` | `MYSQL_8_0` | Critical | Ghost requires MySQL 8.0; any other engine breaks startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_nfs` | `true` | Critical | Without shared storage, uploaded content is lost between instances/restarts. |
| `container_port` | `2368` | Critical | Ghost's native port; mismatching it causes all health probes to fail. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `startup_probe` initial_delay_seconds | `90` | High | Reducing below 60 causes Cloud Run to kill Ghost before it finishes running migrations. |
| `enable_redis` | `true` | High | Without Redis, Ghost serves all pages without a cache, increasing database load. |
| `redis_host` | `""` (NFS) or explicit | High | No valid endpoint if Redis is on but NFS is off and no host is set. |
| `memory_limit` | `512Mi`+ | High | Too little memory causes Node.js OOM during newsletter sends or theme compilation; raise beyond the `512Mi` default for active membership/newsletter use. |
| `environment_variables` SMTP settings | real SMTP server | High | No email delivery means no member sign-ups, no password resets, no newsletters. |
| `container_image_source` | `custom` | High | The upstream Ghost image lacks the custom entrypoint that maps DB credentials and detects the service URL. |
| `execution_environment` | `gen2` | High | NFS mounts require gen2; gen1 cannot mount Filestore. |
| `min_instance_count` | `0` (default) or `1` | Medium | `0` (the default) causes cold starts during which Ghost runs migrations — set `1` if first-request timeouts matter. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The Ghost admin panel (`/ghost`) is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Ghost-specific application configuration shared with the GKE variant is described in **[Ghost_Common](Ghost_Common.md)**.
