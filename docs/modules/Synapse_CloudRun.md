---
title: "Synapse on Google Cloud Run"
description: "Configuration reference for deploying Synapse on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Synapse on Google Cloud Run

Synapse is the reference [Matrix](https://matrix.org/) homeserver — the open-source,
Apache 2.0-licensed Python server for the Matrix protocol, an open standard for
decentralized, federated real-time communication (secure chat and VoIP). This module
deploys Synapse on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure. Users
connect to the homeserver with a Matrix client such as the [Element](https://element.io/)
web app.

This guide focuses on the cloud services Synapse uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Synapse runs as a Python container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python homeserver, 2 vCPU / 4 GiB by default, kept warm (`min_instance_count = 1`) |
| Database | Cloud SQL for PostgreSQL 15 | Required — Synapse does not support MySQL; database **must** use `C` collation |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Persistent files | NFS (Filestore) | Signing key + media repository under the data directory; enabled by default |
| Secrets | Secret Manager | Auto-generated registration shared secret; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory, with `C` collation.** The database engine is fixed by
  the shared application layer, and the first-deploy `db-init` job creates the database
  with `LC_COLLATE='C' LC_CTYPE='C'` — Synapse refuses to start against any other
  collation.
- **Synapse self-manages its schema.** There is no separate migrate job; Synapse creates
  and upgrades its own schema automatically on every start.
- **`homeserver.yaml` and the signing key are generated on first boot.** The cloud
  entrypoint generates the config plus a persistent signing key into the data directory
  and wires the platform PostgreSQL before starting Synapse.
- **The signing key must persist.** Regenerating it breaks federation and invalidates
  all device sessions, so the data directory is backed by persistent NFS storage
  (`enable_nfs = true` by default).
- **`server_name` is fixed at `matrix.local`.** It is the domain baked into every user ID
  (`@user:server_name`) and into federation. `Synapse_CloudRun` does not expose a
  `server_name` input — the value always comes from `Synapse_Common`'s default, so a
  production deployment needing a real domain currently requires overriding the Common
  module directly.
- **Listens on port 8008.** The client + federation HTTP listener is set in the
  generated config; health is served unauthenticated at `/health`.
- **Kept warm, not scaled to zero.** A homeserver maintains federation, background
  retention, and presence between requests, so `min_instance_count = 1` and
  `cpu_always_allocated = true` are the defaults. Scale-to-zero is a poor fit for a
  federating homeserver (a cold instance misses inbound federation traffic).
- **Redis is not used.** Synapse runs a single main process backed entirely by
  PostgreSQL.
- **Admin users are created out-of-band.** Open self-service registration is off by
  default; create users with `register_new_matrix_user` and the registration shared
  secret in Secret Manager.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Synapse service

Synapse runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Synapse stores all homeserver state (accounts, rooms, events, device keys, federation
state) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects privately
through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed. On
first deploy a `db-init` Job creates the application database **with `C` collation** and
the application user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Verify the mandatory collation:
  #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs).
See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

### C. Cloud Storage & the persistent data directory

A dedicated **Cloud Storage** data bucket is provisioned automatically. Synapse's own
runtime state — `homeserver.yaml`, the `conf.d` overrides, the **signing key**, and the
media repository — lives under the data directory (`SYNAPSE_DATA_DIR = /data`), which is
backed by the NFS (Filestore) volume mounted at the configured mount path.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Secret Manager

A **registration shared secret** is generated automatically and stored in Secret
Manager; it backs `register_new_matrix_user` for out-of-band account creation. The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~synapse"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. Matrix client and federation
traffic require public reachability, so `ingress_settings = "all"` is the default. An
external HTTPS load balancer with a custom domain (recommended for production), Cloud CDN
for media, and Cloud Armor can be layered on.

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

## 3. Synapse Application Behaviour

- **First-deploy database setup.** A `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application role and the database **with `C` collation**
  (`LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`), recreating an empty wrong-collation
  database if the foundation created one first. The job is safe to re-run.
- **No migrate job — schema self-managed.** Synapse creates and upgrades its schema on
  every start, so upgrading the application version applies schema changes without a
  separate migration step.
- **Config + signing key generated on first boot.** The cloud entrypoint generates
  `homeserver.yaml` and a persistent signing key into `/data`, writes a `conf.d` snippet
  wiring PostgreSQL and the `0.0.0.0:8008` listener, then execs Synapse. The signing key
  is generated only once — keep `/data` on persistent storage.
- **`server_name` is fixed at `matrix.local`.** `Synapse_CloudRun` does not expose a
  `server_name` input (it always uses the `Synapse_Common` default); changing the
  underlying value after first boot invalidates every user ID, device session, and
  federation relationship.
- **Health path.** The default `startup_probe`/`liveness_probe` target `/` (root).
  Synapse also serves an unauthenticated `/health` endpoint (`OK`) that can be used by
  overriding those probe paths. Confirm the client API is serving with
  `GET /_matrix/client/versions`:
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/_matrix/client/versions"
  ```
- **Create the first admin user** with the Matrix registration tool, using the shared
  secret from Secret Manager:
  ```bash
  register_new_matrix_user -c homeserver.yaml -u admin -a https://<your-domain>
  ```
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Synapse are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `synapse` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Synapse` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Synapse image tag; pin to a specific release (e.g. `v1.119.0`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance; **minimum 2 GiB** for reliable operation. |
| `min_instance_count` | `1` | Keeps the homeserver warm for federation and background tasks. Do **not** set `0` for a federating server. |
| `max_instance_count` | `5` | Autoscaling upper bound. |
| `cpu_always_allocated` | `true` | Always-allocated CPU so background federation/retention keeps running between requests. |
| `container_port` | `8008` | Synapse's client + federation HTTP listener. |
| `execution_environment` | `gen2` | Gen2 required for NFS/GCS mounts. |
| `timeout_seconds` | `300` | Maximum request duration. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `container_image_source` | `custom` | Thin custom build `FROM matrixdotorg/synapse`. |
| `enable_image_mirroring` | `true` | Mirror the Synapse base image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Required for public Matrix client and federation traffic. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks federation and external clients** — use only for admin-only/private homeservers. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `SYNAPSE_*` values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
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

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend (useful for media). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the GCS data bucket. |
| `enable_nfs` | `true` | Persistent NFS for the data directory (signing key + media). |
| `nfs_mount_path` | `/opt/synapse/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `synapse` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `synapse` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (C-collation database + role). |
| `cron_jobs` | `[]` | Scheduled Cloud Scheduler + Cloud Run Jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay | Startup probe. Synapse also serves an unauthenticated `/health` endpoint that can be used by overriding `path`. |
| `liveness_probe` | HTTP `/` | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Synapse uses a PostgreSQL-backed queue/cache — leave `false` unless externalizing. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis endpoint (only when externalizing). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `server_name` (fixed `matrix.local`) | Not exposed as a `Synapse_CloudRun` input | Critical | Real federation and durable user IDs need a custom domain; this module has no `server_name` variable, so production use currently requires overriding `Synapse_Common` directly. Changing the underlying value after first boot invalidates every user ID, device session, and federation relationship. |
| Signing key persistence (`enable_nfs`) | `true` | Critical | If the data directory is not persistent, a restart regenerates the signing key, breaking federation and invalidating all device sessions. |
| Database collation (`db-init`) | `C` (automatic) | Critical | Synapse refuses to start against any non-`C` collation; do not bypass the `db-init` job. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `min_instance_count` | `1` | High | Scale-to-zero leaves a federating homeserver cold — it misses inbound federation traffic and background tasks stall. |
| `cpu_always_allocated` | `true` | High | Request-based billing throttles CPU to ~0 between requests, stalling background retention and federation retries. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | High | Below 2 GiB Synapse OOMs under real room/federation load. |
| `ingress_settings` | `all` | High | `internal` blocks Matrix clients and all federation. |
| `enable_iap` | only for private servers | High | IAP blocks federation and external clients; use only for admin-only deployments. |
| `container_port` | `8008` | High | Synapse listens on 8008; a mismatched port makes the probe hit a dead port and the revision never becomes Ready. |
| Probe path | `/` (default) or `/health` | High | Pointing `startup_probe`/`liveness_probe` at an authenticated Matrix API path returns 401/403 and the revision never becomes Ready. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cdn` | enable for media-heavy servers | Medium | Media downloads are served directly from the instance without CDN offload. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Synapse-specific application configuration shared with the GKE variant is described in
**[Synapse_Common](Synapse_Common.md)**.
