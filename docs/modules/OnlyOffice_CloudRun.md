---
title: "OnlyOffice on Google Cloud Run"
description: "Configuration reference for deploying OnlyOffice on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# OnlyOffice on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OnlyOffice_CloudRun.png" alt="OnlyOffice on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ONLYOFFICE Document Server is an open-source collaborative online office suite for
real-time co-editing of text documents, spreadsheets, presentations, PDFs, and forms —
a self-hosted alternative to Google Docs / Microsoft Office Online. It is not usually
opened directly by end users; instead it is embedded by a host application (Nextcloud,
ownCloud, Seafile, or a custom integration) via its API and a shared JWT secret. This
module deploys ONLYOFFICE Document Server on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services OnlyOffice uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

The `onlyoffice/documentserver` image is "batteries included": it bundles its own
converters, nginx, and RabbitMQ (AMQP) under `supervisord`. This module builds a thin
custom wrapper around it and externalizes PostgreSQL (Cloud SQL) and Redis; the
bundled RabbitMQ stays internal on localhost.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Custom-built container, 2 vCPU / 4 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — a plan-time guard rejects MySQL and every other engine |
| Cache / editing state | External Redis | Mandatory — a plan-time guard rejects `enable_redis = false`; defaults to the co-located NFS-VM Redis when `redis_host` is blank |
| File persistence | Cloud Filestore (NFS) | Enabled by default; shared attachment/document storage across instances, mounted at `/opt/onlyoffice/storage` |
| Object storage | Cloud Storage | Two buckets by default: a `storage` bucket declared by `OnlyOffice_Common`, plus a `data` bucket via `storage_buckets` (both gated by `create_cloud_storage`, which defaults `true` here since Cloud Run has no block-PVC option) |
| Secrets | Secret Manager | Auto-generated 48-character `JWT_SECRET`; database password managed separately |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** A cross-variable plan-time guard in this module's
  `validation.tf` rejects any `database_type` other than `POSTGRES_13`/`14`/`15`/`NONE`
  — MySQL and SQL Server are not supported by Document Server.
- **Redis is mandatory, not optional.** A plan-time precondition fails the deployment
  if `enable_redis = false`. With `redis_host` left blank, `enable_nfs` must stay
  `true` so the co-located NFS-VM IP can serve as the default Redis host.
- **NFS is enabled by default** (`enable_nfs = true`, unlike most other Cloud Run
  modules), because it doubles as shared attachment storage and the default Redis
  endpoint source.
- **`JWT_SECRET` is generated once and must never be rotated** after any host
  application (Nextcloud, ownCloud, a custom integration) has been configured to embed
  the editor — rotating it breaks the trust between Document Server and every
  integration until all of them are updated with the new value.
- **Memory floor is 4Gi, not the platform's usual 512Mi–2Gi.** The bundled
  Postgres-client/Redis-client/RabbitMQ/nginx/converter stack under `supervisord` is
  heavy and needs the headroom.
- **`cpu_always_allocated` defaults to `false` (cost-first, request-based billing).**
  The core editing/conversion work runs in-request, so a cold start is survivable, but
  the bundled document-cache warmth and internal RabbitMQ conversion queue reset on
  every cold start. Set `true` (with `min_instance_count >= 1`) for an always-warm
  editor.
- **The image is custom-built, not prebuilt.** `container_image_source = "custom"`
  wraps the Docker Hub `onlyoffice/documentserver` image with a `cloud-entrypoint.sh`
  that maps the Foundation's `DB_*`/`REDIS_HOST` variables onto Document Server's own
  convention. `application_version = "latest"` is pinned to `8.3.3` at build time via
  an app-specific `ONLYOFFICE_VERSION` build ARG (the Foundation's injected
  `APP_VERSION` is deliberately not used, since it would otherwise win the merge).
- **Health checks target `/healthcheck`, unauthenticated**, with a generous first-boot
  budget (90s initial delay, up to 40 failures) because the bundled stack is slow to
  become ready.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the OnlyOffice service

OnlyOffice Document Server runs as a single Cloud Run v2 service (the custom-built
wrapper image) that autoscales by request load between the minimum and maximum
instance counts. Each deployment creates an immutable revision.

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

OnlyOffice stores document metadata, versions, and application state in a managed
Cloud SQL for PostgreSQL 15 instance. The service connects privately through the
**Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed. On first deploy
the built-in `db-init` job creates the application role, database, and grants — the
Document Server then installs its own schema on first boot.

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

### C. External Redis & Cloud Filestore (NFS)

Redis holds session/editing state that must be shared across every OnlyOffice
instance — the bundled RabbitMQ stays internal, but Redis is externalized and
**mandatory** (a plan-time guard fails the deployment if `enable_redis = false`). With
`redis_host` left blank, the Foundation injects the co-located NFS-VM Redis IP
(`enable_nfs` must stay `true` in that case); set `redis_host` explicitly to point at a
different Redis instance. Cloud Filestore (NFS) is enabled by default and mounted at
`/opt/onlyoffice/storage` for shared attachment/document storage across instances —
unlike the GKE variant there is no block PVC option, since Cloud Run instances are
stateless and ephemeral.

- **Console:** Compute Engine → VM instances (the NFS/Redis co-located VM);
  Filestore → Instances.
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the resolved Redis/DB env vars in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS-VM discovery model and the
Redis-host-falls-back-to-NFS-IP convention.

### D. Cloud Storage

Two buckets are provisioned by default: a `storage` bucket declared by
`OnlyOffice_Common` (for the app's own storage needs) and a `data` bucket from this
module's own `storage_buckets` default — both gated by `create_cloud_storage`, which
defaults `true` here (unlike the GKE variant, which defaults it `false` because
persistence there lives on a block PVC + NFS instead).

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~onlyoffice"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### E. Secret Manager

One OnlyOffice-specific secret is generated automatically and stored in Secret
Manager: **`JWT_SECRET`** (48 characters, no special characters), which signs every
internal Document Server API request and must be presented by any host application
that embeds the editor. The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. Because Document Server is
typically called by a host application's own backend (not directly by end users), keep
`ingress_settings = "all"` unless every caller is inside the VPC. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

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

## 3. OnlyOffice Application Behaviour

- **First-deploy database setup, no separate migration job.** The built-in `db-init`
  job runs using `postgres:15-alpine`. It resolves the Cloud SQL host (the Auth Proxy
  Unix-socket directory, falling back to the instance private IP), waits for
  PostgreSQL to be reachable, creates/updates the application role with the generated
  password, creates the application database, and grants full privileges — it only
  provisions the role/database/grants. The Document Server installs its own schema on
  first boot, so there is no separate migration step. The job is safe to re-run
  (`execute_on_apply = true`).
- **`JWT_SECRET` is immutable after integrations are wired up.** Generated once (48
  characters) and written to Secret Manager. `JWT_ENABLED = "true"`,
  `JWT_HEADER = "Authorization"`, `JWT_IN_BODY = "true"` are set automatically by
  `OnlyOffice_Common`. Rotating the secret invalidates trust with every host
  application embedding the editor until each is reconfigured with the new value.
- **DB and Redis env-var mapping happens in the baked `cloud-entrypoint.sh`.** It sets
  `DB_TYPE = "postgres"` and `DB_PWD` from the injected `DB_PASSWORD`
  (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` already match Document Server's own names),
  and maps `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` onto
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASS` before `exec`-ing the
  upstream `/app/ds/run-document-server.sh`. Because this logic is baked into the
  custom image, an edit to `cloud-entrypoint.sh` needs a rebuild to take effect.
- **No traditional sign-up flow.** Document Server is not usually opened directly by
  end users — it is embedded via API calls from a host application (Nextcloud,
  ownCloud, a custom integration) using the shared JWT secret. There is no admin
  account to create on first boot; readiness is confirmed via `/healthcheck` and by
  the host application successfully opening a document for co-editing.
- **Health path.** Startup and liveness probes target `/healthcheck` — the Document
  Server endpoint that returns `true` only once nginx and the document services are
  up and the database is reachable, served unauthenticated. Allow several minutes on
  first boot (90-second initial delay, 15-second period, up to 40 failures — roughly
  10 minutes of headroom while the bundled stack comes up and the schema installs).
- **WOPI is off by default.** `WOPI_ENABLED = "false"`; enable it via
  `environment_variables` only when integrating with a WOPI host (e.g. SharePoint).
- **Inspect job execution and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for OnlyOffice are listed; every other input is
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
| `application_name` | `onlyoffice` | Base name for resources. Do not change after first deploy. |
| `display_name` | `ONLYOFFICE Document Server` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Document Server image tag; `latest` is pinned to `8.3.3` at build time via the `ONLYOFFICE_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Always custom — wraps the Docker Hub `onlyoffice/documentserver` image with the cloud entrypoint. |
| `container_image` | `""` | Leave blank to use the built custom image. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance; the bundled stack needs at least 4Gi. |
| `cpu_always_allocated` | `false` | Cost-first, request-based billing. Trade-off: document-cache warmth and the internal RabbitMQ conversion queue reset on cold start. Set `true` (+ `min_instance_count >= 1`) for an always-warm editor. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Pod/instance replica bounds. |
| `container_port` | `80` | Document Server's bundled nginx listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Always true — mirrors the Docker Hub base image into Artifact Registry before the custom build. |
| `container_build_config` | build the wrapper image | Dockerfile/build-arg configuration; `build_args` sets `ONLYOFFICE_VERSION` (see Overview). |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `container_protocol` | `http1` | HTTP protocol version. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Auth Proxy socket directory. |
| `additional_services` / `additional_containers` | `[]` | Not used by this module — inert unless explicitly configured. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Keep `all` unless every caller of the Document Server API is inside the VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks host-application API calls if enabled.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `network_name` | `""` | VPC network to use; auto-discovers a single Services_GCP-managed network. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `DB_TYPE`, `JWT_ENABLED`, `JWT_HEADER`, `JWT_IN_BODY`, `WOPI_ENABLED` are set automatically — do not override `JWT_ENABLED`/`JWT_HEADER`/`JWT_IN_BODY` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `explicit_secret_values` | `{}` | Raw sensitive values written directly to Secret Manager at plan time. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |
| `module_writable_secret_ids` | `{}` | Not used by this module (no post-install hook writes secrets back). |

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
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. Not
used by the default OnlyOffice deployment (schema installation is handled by the
Document Server itself). See [App_CloudRun](App_CloudRun.md).

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
| `create_cloud_storage` | `true` | Gates both the Common-declared `storage` bucket and this module's own `storage_buckets` list. Defaults `true` here (unlike GKE's `false`) since Cloud Run has no block-PVC persistence option. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS bucket(s) beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `true` | Enabled by default — shared attachment storage and the fallback Redis host source. |
| `nfs_mount_path` | `/opt/onlyoffice/storage` | Mount path inside the container. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Existing NFS VM to use, or the base name for an inline one. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Required — a plan-time guard (`validation.tf`) rejects anything but `POSTGRES_13`/`14`/`15`/`NONE`. MySQL is not supported. |
| `db_name` | `onlyoffice` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `onlyoffice` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Foundation-parity mirror only — this module wires the database through `db_name`/`db_user` above, not these; inert unless the module is rewired. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (creates the role/database/grants; the Document Server installs its own schema). |
| `cron_jobs` | `[]` | Not used — OnlyOffice has no platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, 90s delay, 15s period, 40 failures | Generous first-boot budget for the heavy bundled stack. |
| `liveness_probe` | HTTP `/healthcheck`, 120s delay, 30s period, 3 failures | Liveness probe. |
| `startup_probe_config` / `health_check_config` | same path, structured form | Alternative service-level probe definitions; `startup_probe`/`liveness_probe` take effect by default. |
| `uptime_check_config` | `{ enabled=false, path="/healthcheck" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required** — a plan-time guard rejects `false`. |
| `redis_host` | `""` | Leave blank to use the co-located NFS-VM Redis IP (requires `enable_nfs = true`). |
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
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. OnlyOffice additionally layers its own cross-variable guards in `validation.tf`: PostgreSQL-only `database_type`, mandatory `enable_redis`, `redis_host`/`enable_nfs` coupling, `min_instance_count <= max_instance_count`, and `enable_cloudsql_volume` vs `database_type = "NONE"` consistency. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (or 13/14) | Critical | Any other engine is rejected at plan time — MySQL is not supported by Document Server. |
| `enable_redis` | `true` | Critical | A plan-time guard rejects `false` — without shared Redis, session/editing state cannot be coordinated across instances. |
| `redis_host` / `enable_nfs` | Leave `redis_host` blank only with `enable_nfs = true` | Critical | Blank `redis_host` with `enable_nfs = false` fails at plan time — there is no Redis host to resolve. |
| `JWT_SECRET` (auto-generated) | Never change after integrations exist | Critical | Rotating it breaks every host application (Nextcloud/ownCloud/etc.) embedding the editor until all are updated with the new value. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup fails the import job. |
| `memory_limit` | `4Gi` | High | The bundled Postgres-client/Redis-client/RabbitMQ/nginx/converter stack under `supervisord` is heavy; undersizing risks OOM during startup or document conversion. |
| `ingress_settings` | `all` (unless all callers are in-VPC) | High | Document Server's API is normally called by a host application's backend; blocking that traffic breaks every embedded-editor integration. |
| `enable_iap` | only when no external host application calls the API | High | IAP blocks all unauthenticated requests, including the host application's Document Server API calls. |
| `enable_cloudsql_volume` | `true` unless `database_type = "NONE"` | High | A plan-time guard rejects the combination `enable_cloudsql_volume = true` with `database_type = "NONE"` — the Auth Proxy sidecar would have no instance to connect to. |
| `cpu_always_allocated` | `false` (cost-first) or `true` for an always-warm editor | Medium | With `false` + scale-to-zero, the document-cache and internal RabbitMQ conversion queue reset on every cold start, adding latency to the next editing session. |
| `min_instance_count` | `1` to avoid cold starts on active editing sessions | Medium | Scale-to-zero (`0`) adds startup-probe-scale first-request latency after idle, felt by every collaborator opening a document. |
| `create_cloud_storage` / `storage_buckets` | leave defaults unless persistence needs adjusting | Medium | Setting `create_cloud_storage = false` also removes the Common-declared `storage` bucket, since both are gated by the same flag. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The Document Server API is publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. OnlyOffice-specific application configuration
shared with the GKE variant — the JWT secret, database bootstrap, container image
and entrypoint, core application settings, and health probe behaviour — is described
in **[OnlyOffice_Common](OnlyOffice_Common.md)**.
