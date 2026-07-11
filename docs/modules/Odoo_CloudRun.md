---
title: "Odoo on Cloud Run"
description: "Configuration reference for deploying Odoo on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Odoo on Cloud Run

Odoo is a comprehensive open-source ERP suite with 12M+ users and modules spanning CRM,
accounting, inventory, manufacturing, HR, and eCommerce. This module deploys Odoo Community
Edition on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Odoo uses and how to explore and operate them from
the Google Cloud Console and the command line. For mechanics shared by every Cloud Run
application — Workload Identity, traffic management, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Odoo runs as a Python/PostgreSQL ERP workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python/Odoo service; gen2 execution environment required for NFS mounts; scales to zero by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — Odoo does not support MySQL or SQL Server |
| Shared files | Filestore (NFS) | Filestore, sessions, and extra-addons directories shared across all instances |
| Object storage | Cloud Storage | A dedicated addons bucket (`odoo-addons`) for custom and community addons |
| Cache & sessions | Redis (optional) | Disabled by default; required when `max_instance_count > 1` to share session state |
| Secrets | Secret Manager | Auto-generated master password (`ODOO_MASTER_PASS`) and database password |
| Ingress | Cloud Load Balancing | External IP with optional custom domain and managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is mandatory.** The database engine is fixed; selecting MySQL or `NONE` breaks
  startup.
- **NFS is required.** Without a shared Filestore volume, Odoo's filestore (attachments,
  binary fields, compiled assets) is isolated to each instance and lost on restart.
- **Scale-to-zero is the default.** `min_instance_count = 0`. Cold starts on the Odoo service
  add 30–60 seconds plus schema migration time. Set `min_instance_count = 1` for production or
  any interactive workload.
- **Two init jobs run on every deploy.** `nfs-init` sets up NFS directory ownership and
  `db-init` creates the PostgreSQL database and user — both are idempotent.
- **The Odoo master password** is generated automatically and stored in Secret Manager; you
  never set it in plain text.
- **First boot is slow.** Odoo installs the base module and runs schema migrations on first
  start; the startup probe allows up to 9 minutes (180s initial delay then additional retries).
- **`execution_environment = "gen2"` is required.** NFS volume mounts are only supported by
  the second-generation Cloud Run execution environment.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT`, `REGION`, and `SERVICE` are set to the values reported in the
[Outputs](#5-outputs).

### A. Cloud Run v2 — the Odoo service

The Odoo service runs as a Cloud Run v2 service in the `gen2` execution environment. Requests
to the service are routed through a Cloud Load Balancer.

- **Console:** Cloud Run → select the Odoo service to see revisions, traffic splits, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION"
  gcloud run services logs read "$SERVICE" --project "$PROJECT" --region "$REGION" --limit 100
  # Tail logs live:
  gcloud run services logs tail "$SERVICE" --project "$PROJECT" --region "$REGION"
  # Check Odoo health endpoint:
  curl -s -o /dev/null -w "%{http_code}" "https://<service-url>/web/health"
  # Expect: 200
  ```

See [App_CloudRun](App_CloudRun.md) for revision management, traffic splitting,
min/max instances, and concurrency settings.

### B. Cloud SQL for PostgreSQL 15

Odoo stores all ERP data (contacts, invoices, inventory, orders) in a managed Cloud SQL for
PostgreSQL 15 instance. Service instances connect privately through the **Cloud SQL Auth
Proxy** sidecar over a Unix socket, so no public IP is exposed. On first deploy the `db-init`
job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm database and user were created:
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  gcloud sql users list --instance=<instance-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups,
and password rotation, see [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) and Cloud Storage

Odoo's filestore (binary attachments, images, compiled assets), session data, and extra-addons
directories are written to a **Filestore (NFS)** share mounted into every service instance so
all revisions see the same files. A dedicated **Cloud Storage** bucket (`odoo-addons`) is
also provisioned for custom and community addons.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for the
  addons bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<addons-bucket>/        # bucket name is in the Outputs
  # Confirm NFS subdirectories via a Cloud Run Jobs execution:
  gcloud run jobs execute nfs-init --project "$PROJECT" --region "$REGION" --wait
  ```

See [App_CloudRun](App_CloudRun.md) for NFS provisioning, GCS Fuse, and CMEK
options.

### D. Redis cache (optional)

Redis backs Odoo's session store when multiple instances are running. Without Redis,
scale-to-zero and multiple instances both cause frequent session loss. Redis is disabled by
default; set `enable_redis = true` and `redis_host` to enable it.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis environment variables injected into the running service:
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -i redis
  ```

### E. Secret Manager

The Odoo master password (`ODOO_MASTER_PASS`) and the database password are stored as
Secret Manager secrets and injected into service instances at runtime; plaintext never
appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  # Retrieve the database password:
  gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_CloudRun](App_CloudRun.md) for the CSI integration and rotation.

### F. Networking, ingress & load balancing

By default the Cloud Run service is fronted by a Cloud Load Balancer. A custom domain with a
Google-managed certificate and a static external IP can be enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  gcloud compute forwarding-rules list --project "$PROJECT"
  gcloud compute addresses list --project "$PROJECT"
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md) for custom domains, CDN, and static
IP details.

### G. Cloud Logging & Monitoring

Service stdout/stderr flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting / Uptime checks.
- **CLI:**
  ```bash
  gcloud run services logs read "$SERVICE" --project "$PROJECT" --region "$REGION" --limit 50
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\"" \
    --project "$PROJECT" --limit 50
  # Watch for Odoo startup progress:
  gcloud run services logs tail "$SERVICE" --project "$PROJECT" --region "$REGION" \
    | grep -E "odoo.modules|http.server"
  ```

---

## 3. Odoo Application Behaviour

- **Two init jobs on every deploy.**
  - `nfs-init` — mounts the NFS share and creates `/mnt/filestore`, `/mnt/sessions`, and
    `/mnt/extra-addons` with ownership `101:101` (the Odoo process user). Must succeed
    before Odoo starts.
  - `db-init` — runs after `nfs-init` and idempotently creates the PostgreSQL database and
    application user. Both jobs are safe to re-run.
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```
- **Schema migration on start.** The container starts Odoo with `-i base`, which applies any
  pending schema migrations automatically. Version upgrades are applied on next deployment.
- **Odoo master password.** An auto-generated 16-character alphanumeric password is stored in
  Secret Manager and injected as `ODOO_MASTER_PASS`. It protects the database management
  interface at `/web/database/manager`. Override it using `explicit_secret_values`:
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **Scale-to-zero and cold starts.** The default `min_instance_count = 0` means the service
  scales down to zero when idle. Cold starts add 30–60 seconds for Python/Odoo initialisation
  on top of NFS mount time. Set `min_instance_count = 1` for any interactive-use deployment.
- **Multi-instance and session state.** Without Redis, multiple concurrent instances cannot
  share Odoo session state. Do not raise `max_instance_count` above `1` without enabling Redis
  and providing a `redis_host` value. Without Redis, session loss is frequent in multi-instance
  deployments.
- **SMTP for outbound email.** Odoo uses environment variables for its outbound mail transport.
  Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL`, and `EMAIL_FROM` in
  `environment_variables` before going live; move `SMTP_PASSWORD` to
  `secret_environment_variables`.
- **Health probes.** The startup probe uses **TCP** (port 8069) with a 60-second initial delay.
  The liveness probe uses **HTTP** `GET /web/health` (requires HTTP 200). The liveness probe
  begins after 120 seconds. On first boot (schema creation), startup can take 2–10 minutes.
  ```bash
  curl -s -o /dev/null -w "%{http_code}" "https://<service-url>/web/health"
  # Expect: 200
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for Odoo are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `odoo` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Odoo ERP` | Friendly name shown in the Console. |
| `application_description` | `Odoo ERP on Cloud Run` | Service description annotation. |
| `application_version` | `18.0` | Odoo nightly channel to install (`"18.0"`, `"17.0"`, `"16.0"`). Increment to upgrade. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Instance CPU and memory limits. **Raise to ≥ 2 vCPU / 4 GiB for production.** |
| `min_instance_count` | `0` | Minimum instances. Set to `1` to avoid cold starts for active users. |
| `max_instance_count` | `1` | Maximum instances. Do not raise above `1` without enabling Redis. |
| `container_port` | `8069` | Port Odoo listens on. Do not change unless the Odoo server is reconfigured. |
| `execution_environment` | `gen2` | Required for NFS volume mounts. Do not change. |
| `timeout_seconds` | `300` | Request handling timeout (5 minutes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |

### Group 5 — Ingress & VPC

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Traffic allowed to the service. Set to `internal-and-cloud-load-balancing` with Cloud Armor for production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Sends only RFC-1918 traffic over VPC; public traffic exits via NAT. |
| `enable_iap` | `false` | Require Google sign-in in front of Odoo. Recommended for admin-only ERP deployments. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access when IAP is enabled. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text settings. SMTP keys (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL`, `EMAIL_FROM`) are pre-populated; configure them for outbound email. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Sensitive values written to Secret Manager during deploy. Use to set a custom `ODOO_MASTER_PASS`. |

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 90+ for financial/compliance data. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore a PostgreSQL dump on deploy. |

### Group 8 — CI/CD & GitHub Integration

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Cloud Armor, Domains & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the load balancer. Strongly recommended for any internet-facing Odoo deployment. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `application_domains` | `[]` | Custom hostnames for the load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the load balancer backend. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |

### Group 11 — Cloud Storage & NFS

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the addons bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the Odoo-managed `odoo-addons` bucket. |
| `enable_nfs` | `true` | Required — Odoo's filestore, sessions, and addons directories must reside on shared storage. |
| `nfs_mount_path` | `/mnt/nfs` | NFS mount path inside the container as seen by App_CloudRun. |
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change to MySQL or `NONE`. |
| `application_database_name` | `odoo` | Database name. Immutable after first deploy. |
| `application_database_user` | `odoo` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `nfs-init` + `db-init` jobs. |
| `cron_jobs` | `[]` | User-defined scheduled tasks (Cloud Scheduler → Cloud Run Jobs). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ type = "TCP", initial_delay_seconds = 60 }` | TCP probe on port 8069; HTTP not available until after DB init. |
| `liveness_probe` | `{ type = "HTTP", path = "/web/health", initial_delay_seconds = 120 }` | HTTP check after 120 seconds; `/web/health` returns 200 only when Odoo has a live DB connection. |
| `uptime_check_config` | `{ enabled = true }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session storage. Required when `max_instance_count > 1`. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Primary URL for the Odoo service. |
| `service_location` | Cloud Run region. |
| `stage_services` | Map of service URLs for Cloud Deploy stage-specific revisions. |
| `load_balancer_ip` | External IP of the load balancer. |
| `load_balancer_url` | Custom-domain URL when a domain is configured. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` | DB host (127.0.0.1 via the Auth Proxy). **Sensitive.** |
| `database_port` | Database port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, and uptime checks. |
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
| `database_type` | `POSTGRES_15` | Critical | Odoo requires PostgreSQL exclusively; MySQL or `NONE` breaks startup. |
| `enable_nfs` | `true` | Critical | Without NFS, attachments and session data are isolated per instance and lost on restart. |
| `execution_environment` | `gen2` | Critical | NFS volume mounts are unsupported in `gen1`; the service will fail to start. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all ERP data. |
| `memory_limit` | `≥ 4Gi` for production | Critical | Default `1Gi` can trigger Python OOM during module loading or large transaction processing. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | strong, unique | Critical | The database manager at `/web/database/manager` is protected only by this password; a weak value exposes drop-database to anyone who can reach the URL. |
| `max_instance_count` with Redis disabled | `1` | High | Multiple instances without Redis continuously invalidate each other's sessions. |
| `enable_redis` | `true` when `max_instance_count > 1` | High | Without Redis, users are logged out when their request lands on a different instance. |
| `redis_host` | explicit endpoint | High | Required when `enable_redis = true`; empty causes session backend failures at startup. |
| `min_instance_count` | `1` for production | High | Scale-to-zero adds cold-start delays of 30–90 seconds and stops the Odoo background scheduler. |
| `backup_retention_days` | `90` for production | High | Odoo contains financial records; 7 days is insufficient for most compliance requirements. |
| `application_version` | valid LTS (`18.0`, `17.0`) | High | Invalid version tag fails the Cloud Build step during image build. |
| `enable_iap` / `enable_cloud_armor` | enable for production | High | The Odoo database manager and admin portal should not be publicly reachable without authentication. |
| `ingress_settings` | `internal-and-cloud-load-balancing` with Cloud Armor | Medium | `all` exposes the Cloud Run URL directly, bypassing the WAF layer. |
| `timeout_seconds` | `900` for report-heavy deployments | Medium | Long Odoo reports or imports can exceed 5 minutes; the default `300` will return 504 for large report generation. |

---

For the foundation behaviour referenced throughout — IAM, traffic management, scaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Odoo-specific application configuration shared with the
GKE variant is described in **[Odoo_Common](Odoo_Common.md)**.
