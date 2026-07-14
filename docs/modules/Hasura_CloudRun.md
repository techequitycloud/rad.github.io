---
title: "Hasura on Google Cloud Run"
description: "Configuration reference for deploying Hasura on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Hasura on Google Cloud Run

Hasura is an open-source, Apache 2.0-licensed engine that gives you an instant,
realtime GraphQL (and REST) API over a PostgreSQL database, with fine-grained
role-based authorization, event triggers, and a built-in admin console. This module
deploys the Hasura GraphQL Engine (`hasura/graphql-engine`) on **Cloud Run v2** on
top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages
the shared Google Cloud infrastructure.

This guide focuses on the cloud services Hasura uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Hasura runs as a single Haskell container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Haskell service, 1 vCPU / 512 MiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Hasura's metadata catalog and default data source both live in Postgres |
| Object storage | None | Hasura is stateless; no bucket is provisioned |
| Secrets | Secret Manager | Auto-generated `HASURA_GRAPHQL_ADMIN_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Hasura keeps its own metadata catalog in Postgres, so no other
  engine is supported.
- **The admin secret gates everything sensitive.** `HASURA_GRAPHQL_ADMIN_SECRET` is
  generated automatically and stored in Secret Manager. It protects the `/console`
  UI and the `/v1/graphql` and `/v1/metadata` APIs. `/healthz` stays public for
  health probes.
- **Two connection URLs are assembled in-container.** The custom image entrypoint
  builds `HASURA_GRAPHQL_DATABASE_URL` (default data source) and
  `HASURA_GRAPHQL_METADATA_DATABASE_URL` (Hasura's metadata store) from the injected
  `DB_*` variables at runtime — Cloud Run does not interpolate `$(VAR)` in env values,
  so this cannot be done at plan time.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Because all state is external in Postgres, a
  cold-started instance serves correctly; cold starts add a few seconds of latency
  to the first request after idle. Set `min_instance_count = 1` for latency-sensitive
  APIs.
- **Public ingress by default.** `ingress_settings = "all"` so clients and the
  console can reach the service. Enabling IAP protects the whole service — including
  the API — behind Google identity.
- **The console ships enabled.** `HASURA_GRAPHQL_ENABLE_CONSOLE = "true"` serves the
  admin console at `/console`. Disable it in production if you manage metadata purely
  via CI (`hasura` CLI / migrations).
- **No storage, no Redis, no NFS.** `storage_buckets = []`, `enable_redis = false`,
  `enable_nfs = false` — everything lives in PostgreSQL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Hasura service

Hasura runs as a Cloud Run v2 service that autoscales by request load between the
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

Hasura stores its metadata catalog (tracked tables, relationships, permissions,
event triggers) **and** your application data in a managed Cloud SQL for PostgreSQL
15 instance. The service connects privately through the **Cloud SQL Auth Proxy** over
a Unix socket; no public IP is exposed. On first deploy an initialization Job creates
the application database and user; Hasura installs its metadata schema on first boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`HASURA_GRAPHQL_ADMIN_SECRET` (grants full access to the GraphQL/metadata APIs and
the console). The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # The admin secret — use it as the x-hasura-admin-secret header:
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

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

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with an optional uptime check (targeting `/healthz`) and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Hasura Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user and grants privileges. The
  job is safe to re-run.
- **Metadata catalog on start.** Hasura installs and migrates its own metadata catalog
  schema in Postgres on startup, so upgrading the image version applies catalog
  changes without a separate migration step. Your tracked-table metadata persists in
  the database across revisions.
- **Two connection URLs, assembled in-container.** The entrypoint builds both
  `HASURA_GRAPHQL_DATABASE_URL` and `HASURA_GRAPHQL_METADATA_DATABASE_URL` from the
  injected `DB_*` variables, URL-encoding the password and branching on `DB_HOST`
  (socket dir → libpq socket form; loopback → plain; private IP → `sslmode=require`).
- **Admin secret is the security boundary.** Send it as the `x-hasura-admin-secret`
  header. Retrieve it:
  ```bash
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  # Then, e.g.:
  curl -s "$SERVICE_URL/v1/graphql" \
    -H "x-hasura-admin-secret: <secret>" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ __schema { queryType { name } } }"}'
  ```
- **Health path.** Startup and liveness probes target `/healthz` — the public,
  unauthenticated endpoint that returns 200 once the engine is up and connected to
  Postgres. Do not repoint probes at `/v1/graphql` or `/console` (both 401 without
  the admin secret).
- **Console access.** Open `$SERVICE_URL/console` in a browser and paste the admin
  secret when prompted to track tables, define permissions, and run GraphQL queries.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Hasura are listed; every other input is inherited
from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `hasura` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Hasura` | Human-readable name shown in the Console. |
| `application_description` | `Hasura GraphQL Engine on Cloud Run` | Service description. |
| `application_version` | `v2.36.0` | Hasura image tag; `latest` is remapped to a pinned v2.x tag at build time. |
| `application_database_name` | `hasura` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `hasura` | Application database user. Password auto-generated in Secret Manager. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds a wrapper image that assembles the DSNs; `prebuilt` requires manual URL config. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU suits most workloads. |
| `memory_limit` | `512Mi` | Memory per instance; raise for high query concurrency. |
| `min_instance_count` | `0` | `0` enables scale-to-zero (safe — all state is in Postgres). |
| `max_instance_count` | `3` | Autoscaling upper bound; Hasura scales horizontally. |
| `container_port` | `8080` | Hasura binds `HASURA_GRAPHQL_SERVER_PORT = 8080`. |
| `cpu_always_allocated` | `false` | Request-based billing — Hasura does no background work between requests. |
| `execution_environment` | `gen2` | Gen2 recommended. |
| `timeout_seconds` | `300` | Maximum request duration (raise for long subscriptions/streaming). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy socket for the Postgres connection. |
| `enable_image_mirroring` | `true` | Mirror the Hasura image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows external clients and the console to reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the whole service (API included). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `HASURA_GRAPHQL_*` settings (e.g. `HASURA_GRAPHQL_DEV_MODE`, `HASURA_GRAPHQL_CORS_DOMAIN`). Do not set the two `*_DATABASE_URL` values or the admin secret here — they are managed automatically. |
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
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Empty — Hasura requires no file storage. |
| `enable_nfs` | `false` | Not required for Hasura. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Hasura requires PostgreSQL. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `enable_postgres_extensions` / `postgres_extensions` | off / `[]` | Optional Postgres extensions. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring Cloud Scheduler + Cloud Run Jobs. |
| `additional_services` | `[]` | Extra Cloud Run services deployed alongside Hasura. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz` | Application-level startup probe. |
| `liveness_probe` | HTTP `/healthz` | Application-level liveness probe. |
| `startup_probe_config` | HTTP `/healthz` | Cloud Run startup probe (foundation-level). |
| `health_check_config` | HTTP `/healthz` | Cloud Run liveness probe (foundation-level). |
| `uptime_check_config` | `{ enabled=false, path="/healthz" }` | Cloud Monitoring uptime check. Disabled by default; enable for production monitoring. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 16 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Hasura does not require Redis. |
| `redis_host` | `""` | Only used when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id` for folder-nested projects). |
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
| `storage_buckets` | Created Cloud Storage buckets (empty for Hasura). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `HASURA_GRAPHQL_ADMIN_SECRET` (auto-generated) | Keep in Secret Manager; rotate deliberately | Critical | It is the only guard on the GraphQL/metadata APIs and console — exposing it grants full read/write to every tracked table. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans the metadata catalog and all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `startup_probe` / `liveness_probe` path | `/healthz` | High | Pointing a probe at `/v1/graphql` or `/console` returns 401 — the revision never becomes Ready even though the engine booted. |
| `HASURA_GRAPHQL_ENABLE_CONSOLE` | `false` in production | High | Leaving the console on in production widens the attack surface; manage metadata via the `hasura` CLI/migrations instead. |
| `ingress_settings` + `enable_iap` | `all`; IAP only if the API can be identity-gated | High | IAP blocks all unauthenticated requests including programmatic API clients that authenticate with the admin/JWT header, not Google identity. |
| `container_image_source` | `custom` | High | `prebuilt` skips the entrypoint that assembles the two `*_DATABASE_URL` values — the engine starts with no database and every request fails. |
| `memory_limit` | `512Mi`+ | Medium | Very large metadata or high query concurrency can OOM below 512 MiB; the gen2 environment floors memory at 512 MiB regardless. |
| `min_instance_count` | `0` (or `1` for latency) | Medium | Scale-to-zero adds a few seconds of cold-start latency to the first request after idle; set `1` for latency-sensitive APIs. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The API and console are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Hasura-specific application configuration shared
with the GKE variant is described in **[Hasura_Common](Hasura_Common.md)**.
