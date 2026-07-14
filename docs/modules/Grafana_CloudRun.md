---
title: "Grafana on Google Cloud Run"
description: "Configuration reference for deploying Grafana on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Grafana on Google Cloud Run

Grafana is the world's leading open-source observability and analytics platform,
used by 10M+ users at organisations including NASA, CERN, and Goldman Sachs. It
provides unified dashboards, alerting, and visualisation for metrics, logs, and
traces from over 100 data sources. This module deploys Grafana on **Cloud Run v2**
on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Grafana uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Grafana runs as a Go container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 1 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Grafana requires a relational DB; SQLite is unsafe for multi-instance deployments |
| Object storage | Cloud Storage | A `grafana-data` bucket provisioned automatically |
| Optional shared storage | Filestore (NFS) | Disabled by default; enable to share dashboards or plugins across instances |
| Optional cache | Redis | Disabled by default; can be enabled for session storage |
| Secrets | Secret Manager | Database password managed by the foundation; admin credentials injected via env var |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** Grafana persists dashboards, users, alerts, and
  plugin state in a relational database. SQLite uses file locking that breaks under
  concurrent multi-instance writes; the module forces PostgreSQL.
- **`GF_DATABASE_TYPE=postgres` is injected automatically.** Without it Grafana
  falls back to SQLite even when all other `GF_DATABASE_*` variables are present.
- **No database init job is needed.** Grafana auto-migrates its schema on first
  startup when it connects to the provisioned PostgreSQL instance.
- **The admin password is NOT auto-generated.** Grafana ships with `admin`/`admin`
  defaults. You must inject a strong password via `secret_environment_variables`
  before the first deploy.
- **NFS is disabled by default** (`enable_nfs = false`). Enable it only when
  multiple instances need to share plugins or custom dashboard templates on a shared
  filesystem; requires `execution_environment = "gen2"`.
- **Redis is disabled by default** (`enable_redis = false`). Not required for core
  Grafana function.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Grafana service

Grafana runs as a Cloud Run v2 service that autoscales by request load between the
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

Grafana stores all application data (dashboards, users, organisations, alert rules,
plugin state) in a managed Cloud SQL for PostgreSQL 15 instance. The service
connects privately through the **Cloud SQL Auth Proxy** over a Unix socket. Grafana
auto-migrates its schema on startup — no separate init job is required.

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

A dedicated `grafana-data` **Cloud Storage** bucket is provisioned automatically by
Grafana_Common. Additional GCS buckets can be declared via `storage_buckets`, and
GCS Fuse volumes can be mounted into the service via `gcs_volumes` (requires Gen2
execution environment).

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<grafana-data-bucket>/    # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, CMEK, and lifecycle
policies.

### D. Filestore (NFS) — optional

When `enable_nfs = true`, a **Filestore** NFS share is provisioned and mounted into
the service. This is useful when multiple instances need to share Grafana plugins or
custom dashboard templates. NFS is disabled by default because Grafana's persistent
state lives in PostgreSQL. Requires Gen2 execution environment.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

### E. Secret Manager

The database password is stored in Secret Manager and injected into the service at
runtime. Grafana's admin password is not auto-generated — inject it via
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Create the admin password secret:
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.
`ingress_settings` and `vpc_egress_setting` control which traffic sources reach the
service and how outbound traffic is routed.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring. Grafana exposes `/api/health` as its health endpoint, targeted by both
startup and liveness probes, and by an optional uptime check.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Grafana Application Behaviour

- **Schema migration on startup.** Grafana connects to PostgreSQL and applies any
  pending schema migrations on first boot. No separate Cloud Run Job is required.
  The startup probe allows ~150 seconds total tolerance (`initial_delay_seconds=30`,
  `failure_threshold=12`, `period_seconds=10`).
- **Admin credential.** Grafana ships with default `admin`/`admin` credentials. You
  must inject a strong password before the first deploy:
  ```bash
  gcloud secrets create grafana-admin-password \
    --replication-policy="automatic" --project "$PROJECT"
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  # Then set: secret_environment_variables = { GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }
  ```
- **`GF_DATABASE_TYPE` is injected automatically.** The module forces
  `GF_DATABASE_TYPE=postgres` into the environment. Do not override this in
  `environment_variables`.
- **Health endpoint.** Both startup and liveness probes target `/api/health`, which
  returns HTTP 200 when Grafana and its database connection are healthy. An uptime
  check against this path is enabled by default.
- **No scheduled jobs required.** Grafana has no mandatory CronJobs. Optional
  Cloud Scheduler-triggered jobs (e.g. snapshot export, cleanup) can be added via
  `cron_jobs`.
- **GCS Fuse data access.** The `grafana-data` bucket is provisioned automatically;
  it can be mounted as a GCS Fuse volume for direct filesystem access via
  `gcs_volumes`. Inspect scheduled jobs:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Grafana are listed; every other input is
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
| `application_name` | `grafana` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Grafana Dashboards` | Friendly name shown in the Console. |
| `description` | `Grafana - Open-source observability and analytics platform` | Service description. |
| `application_version` | `11.4.0` | Grafana image version tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; Grafana loads dashboards into memory. |
| `min_instance_count` | `0` | Minimum instances. Scale-to-zero by default — Grafana's core is request/response, so it costs nothing when idle at the price of a cold start. Set to `1` (with `cpu_always_allocated = true`) if you enable in-process unified alerting, which must evaluate rules without an inbound request. |
| `max_instance_count` | `5` | Maximum instances. |
| `container_port` | `3000` | Grafana listens on port 3000. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts and GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Grafana image into Artifact Registry before deploy. |
| `cpu_always_allocated` | `false` | Request-based billing by default. Set `true` only if in-process alert-rule evaluation is enabled, so it can run on schedule without an inbound request. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Strongly recommended for internal deployments. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret `GF_*` settings. `GF_DATABASE_TYPE=postgres` is injected automatically — do not override. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use to inject `GF_SECURITY_ADMIN_PASSWORD`. |
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

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

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
| `create_cloud_storage` | `true` | Provision the GCS buckets declared in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional buckets (the `grafana-data` bucket is always created). |
| `enable_nfs` | `false` | Shared Filestore volume — enable when instances need to share plugins or templates. Requires Gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires Gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change; PostgreSQL is required. |
| `db_name` | `grafana` | Database name. Immutable after first deploy. |
| `db_user` | `grafana` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names under which connection details are exposed. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty — Grafana auto-migrates its schema on startup. |
| `cron_jobs` | `[]` | Optional recurring Cloud Run Jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/api/health`, HTTP, 30s delay, 12 failures | HTTP startup probe against Grafana's health endpoint. |
| `liveness_probe` | `/api/health`, HTTP, 60s delay, 3 failures | Liveness probe. |
| `uptime_check_config` | disabled, `/api/health` | Cloud Monitoring uptime check. Enable for production monitoring. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session storage. Disabled by default — not required for core function. |
| `redis_host` | `""` | Redis endpoint. Leave blank to use the NFS server IP when NFS is enabled. |
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
| `storage_buckets` | Created Cloud Storage buckets (includes the `grafana-data` bucket). |
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
| `GF_SECURITY_ADMIN_PASSWORD` (via `secret_environment_variables`) | strong secret | Critical | Grafana ships with `admin`/`admin` defaults. Deploying without setting a strong password exposes the admin interface. |
| `GF_AUTH_ANONYMOUS_ENABLED` (via `environment_variables`) | `false` (default) | Critical | Setting to `"true"` exposes all dashboards to unauthenticated users. |
| `database_type` | `POSTGRES_15` | Critical | PostgreSQL is required; overriding to SQLite causes data loss on every new revision — the SQLite file lives on ephemeral disk. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `GF_SERVER_ROOT_URL` (via `environment_variables`) | public URL | High | Without it OAuth redirects, email notification links, and iframes point to the wrong origin and break. |
| `enable_iap` | `true` for internal | High | Without IAP the Grafana login page is publicly reachable on the internet. |
| `memory_limit` | `2Gi` | High | Below 512Mi Grafana OOMs on startup with large dashboard sets. |
| `min_instance_count` | `1` | High | Scale-to-zero adds cold-start latency and risks missed alert evaluations during the startup window. |
| `max_instance_count` | `1`–`3` | Medium | Multiple instances share PostgreSQL but not in-memory alert state — alerts can fire duplicates. |
| `enable_redis` | `false` (default) | Low | Enabling without a valid `redis_host` raises a validation error at plan time. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `ingress_settings` | `internal-and-cloud-load-balancing` for private | High | The default `all` allows traffic from any source; restrict for internal-only deployments. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Grafana-specific application configuration shared
with the GKE variant is described in **[Grafana_Common](Grafana_Common.md)**.
