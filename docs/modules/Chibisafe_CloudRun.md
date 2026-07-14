---
title: "Chibisafe on Google Cloud Run"
description: "Configuration reference for deploying Chibisafe on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Chibisafe on Google Cloud Run

Chibisafe is a self-hosted file and image uploader with a modern dashboard,
drag-and-drop uploads, albums, and a public API. This module deploys the
**chibisafe-server backend only** (port 8000) on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure. Chibisafe's upstream project also ships a
separate SvelteKit front-end and a Caddy reverse proxy; those are not deployed
by this module.

This guide focuses on the cloud services Chibisafe uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Chibisafe runs as a single, custom-built Node.js container on Cloud Run v2
with no external database. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | chibisafe-server, custom-built image, port 8000; 1 vCPU / 1 GiB by default; `min=max=1` (single instance) |
| Database | None | Chibisafe keeps its SQLite database, uploads, and logs on the mounted volume — no Cloud SQL instance is created |
| Persistent storage | Cloud Storage (GCS Fuse) | A `storage` bucket is always provisioned and mounted at `/data` via GCS Fuse (requires `gen2`); **not** a durable block device |
| Secrets | Secret Manager | Optional `ADMIN_PASSWORD` (gated by `enable_api_key`, off by default) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, public by default (`ingress_settings = "all"`) |

**Sensible defaults worth knowing up front:**

- **SQLite is the only "database."** `database_type` is fixed to `NONE` by
  `Chibisafe_Common`; the many `database_*`/`db_*`/`sql_instance_*` variables
  mirrored in `variables.tf` exist purely for Foundation-convention parity and
  have no effect.
- **Persistence is GCS Fuse, not a block device — and the module says so.**
  Cloud Run has no PVC/block-storage option, so the single `storage` bucket is
  mounted at `/data` via GCS Fuse. This module's own `module_description`
  explicitly warns: *"Consider Chibisafe_GKE with a block PVC for durable
  SQLite storage in production."* GCS Fuse's POSIX file-locking semantics are
  weaker than a real filesystem, which is a real risk for a single-writer
  SQLite app under sustained write load.
- **Single instance, single writer.** `min_instance_count = max_instance_count
  = 1` by default — do not scale beyond 1 without redesigning storage.
- **Custom-build image with an app-specific version pin.** The Dockerfile
  wraps `chibisafe/chibisafe-server` and reads its own `CHIBISAFE_VERSION`
  build arg (not the generic `APP_VERSION` the Foundation injects);
  `application_version = "latest"` is pinned to `v6.5.5` at build time.
- **No Redis, ever.** The module mirrors an `enable_redis` variable (default
  `true`) for Foundation-convention parity, but `main.tf` always forwards
  `enable_redis = false` to App_CloudRun regardless of its value — Chibisafe
  has no Redis dependency.
- **`enable_cloudsql_volume` is inert.** Its declared default is already
  `false`, and `main.tf` additionally hardcodes `enable_cloudsql_volume = false`
  in the call to App_CloudRun — the variable's value is ignored either way.
- **Public ingress by default.** `ingress_settings = "all"` — Chibisafe is a
  public file-upload/hosting UI browsed directly. (This module was previously
  swept up in a fleet-wide bug where copy-pasted "database workload"
  boilerplate defaulted `ingress_settings` to `"internal"`; the current source
  confirms the default here is correctly `"all"`.)
- **No mandatory secrets.** `enable_api_key = false` by default — Chibisafe
  creates and manages its own admin account through its first-run setup wizard
  and Dashboard UI. Flip `enable_api_key` to `true` only to pre-seed a random
  `ADMIN_PASSWORD` from Secret Manager instead of the well-known upstream
  default.
- **Health path is `/api/health`, not `/`.** This module's own `startup_probe`
  / `liveness_probe` variables override `Chibisafe_Common`'s generic `/`
  default with an explicit comment: the chibisafe-server backend serves all
  routes under `/api` and has **no root route** (`GET /` 404s). The separate
  `startup_probe_config` / `health_check_config` variables (which still default
  to path `/`) are effectively inert for this module — see §6.
- **All state lives under one mount.** The entrypoint symlinks the image's
  `/app/database`, `/app/uploads`, and `/app/logs` directories into
  subdirectories of the single GCS Fuse volume (`/data`), migrating any
  image-seeded contents on first boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Chibisafe service

Chibisafe runs as a single Cloud Run v2 service. Each deployment creates an
immutable revision; with `min=max=1` there is normally exactly one active
container instance.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — the persistent state volume

Chibisafe has no database service to inspect — its entire state (SQLite
database, uploaded files, and logs) lives on the single Cloud Storage bucket
mounted via GCS Fuse at `/data` (requires `execution_environment = "gen2"`).
Chibisafe_Common always provisions this `storage` bucket; additional buckets
can be declared via `storage_buckets`, and additional GCS Fuse mounts via
`gcs_volumes`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud storage ls gs://<data-bucket>/database gs://<data-bucket>/uploads gs://<data-bucket>/logs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount mechanics and CMEK
options.

### C. Secret Manager

Chibisafe generates **no secrets by default**. The only optional secret is a
random admin password, gated by `enable_api_key` (default `false`): when
enabled, a 24-character random value is stored in Secret Manager (name suffix
`api-key`) and injected as the `ADMIN_PASSWORD` environment variable through
the standard Cloud Run Secret Manager reference path — Chibisafe's backend
seeds its first-run admin account from this value instead of the well-known
upstream default.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details. Note
that (unlike the GKE variant) this module's `outputs.tf` does **not** surface
the generated secret's name as an output — locate it with the `gcloud secrets
list` filter above.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default
(`ingress_settings = "all"`), appropriate for a public file-upload/hosting UI.
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud
Armor can be layered on via `enable_cloud_armor`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are disabled by default
(`uptime_check_config.enabled = false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Chibisafe Application Behaviour

- **No init or migration job.** Chibisafe manages its own SQLite storage;
  `Chibisafe_Common` injects no `db-init`/migration job (`database_type =
  NONE`). The `initialization_jobs` variable is forwarded to the foundation
  but only useful for custom data-loading tasks.
- **First-boot state relocation.** The image keeps mutable state under three
  sibling directories in its WORKDIR — `/app/database` (SQLite), `/app/uploads`
  (files/thumbnails), and `/app/logs`. The entrypoint (`entrypoint.sh`)
  symlinks each of these into a subdirectory of the single GCS Fuse mount
  (`/data`), migrating any image-seeded contents into the empty volume on
  first boot. This is idempotent across restarts — already-symlinked
  directories are left alone. The same entrypoint script is shared with the
  GKE variant, which mounts a block PVC at the same path instead.
- **Admin account.** Chibisafe creates its administrator account through its
  own first-run setup wizard in the web UI (no generated username/password is
  baked in by default). If `enable_api_key = true`, a random value is
  generated and injected as `ADMIN_PASSWORD`, which the backend uses to seed
  the first-run admin credential instead of the well-known upstream default.
- **No DB env-var aliasing.** `database_type = NONE` — there is no
  `DB_HOST`/`DB_USER` injection or aliasing to worry about; SQLite lives
  entirely on the `/data` GCS Fuse volume.
- **Container environment.** The backend listens on `0.0.0.0:8000`
  (`HOST=0.0.0.0`, `NODE_ENV=production`). `PORT` is deliberately **not**
  injected by `Chibisafe_Common` because Cloud Run reserves that env var name
  and auto-sets it from `container_port` — injecting it explicitly would 400
  the service create call.
- **`container_port` is live here (unlike the GKE variant).** `chibisafe.tf`
  merges `container_port = var.container_port` into the module config that
  the Foundation reads, so changing this variable actually changes the port
  Cloud Run routes to and the `PORT` value it injects. The chibisafe-server
  binary itself defaults to `:8000`; only change this together with a matching
  Dockerfile/entrypoint change.
- **Health path.** Both the startup and liveness probes are **HTTP** `GET
  /api/health` (this module's `startup_probe`/`liveness_probe` variables,
  default `initial_delay_seconds = 15` / `30`) — the backend returns 200 once
  serving, with no authentication required. Do not point either probe at `/`;
  the backend has no root route and 404s there, which would restart-loop the
  container. See §6 for why the separate `startup_probe_config` /
  `health_check_config` variables (still defaulting to `/`) don't actually
  matter here.
- **Inspect the running config:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run revisions describe <revision-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.containers[0].env)'
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Chibisafe are listed; every other input is
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
| `application_name` | `chibisafe` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Chibisafe` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | `chibisafe/chibisafe-server` image tag; `latest` is pinned to `v6.5.5` at build time via the app-specific `CHIBISAFE_VERSION` build arg. |
| `enable_api_key` | `false` | Generates a random 24-char value in Secret Manager, injected as `ADMIN_PASSWORD`, seeding the first-run admin credential instead of the upstream default. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | 1 vCPU default. |
| `memory_limit` | `1Gi` | 1 GiB default. Description text mentions "vector indexes"/"collections" — a copy-paste artifact from a vector-DB module; ignore the wording, the default is fine. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Keep at 1 — Chibisafe is a single-writer SQLite app on one GCS Fuse mount. |
| `container_port` | `8000` | Live (see §3) — changes both the Cloud Run route and the injected `PORT` env var. |
| `execution_environment` | `gen2` | Required for the GCS Fuse `/data` mount. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | **Inert** — `main.tf` hardcodes `false` to the Foundation regardless of this variable's value. Chibisafe has no Cloud SQL database. |
| `container_protocol` | `http1` | Description mentions "required for Chibisafe gRPC" — another copy-paste artifact; Chibisafe has no gRPC interface. Leave at `http1`. |
| `service_annotations` / `service_labels` | `{}` | Custom Cloud Run service annotations/labels. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not forwarded by this module's `main.tf`. |
| `container_image_source` / `container_image` / `container_build_config` / `container_resources` | `custom` / `""` / `{enabled=true}` / `{1000m,512Mi}` | Foundation-mirrored, inert placeholders — the actual build (Dockerfile, `CHIBISAFE_VERSION` build arg) comes from `Chibisafe_Common`'s fixed config, not these variables. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default — Chibisafe is a directly browsed file-upload UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `NODE_ENV=production` and `HOST=0.0.0.0` are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Maintenance

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

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` are forwarded to the
Foundation but are a no-op — Chibisafe has no SQL database (`database_type =
NONE`).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage, Filesystem & Redis (inert)

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisions the always-present `storage` bucket. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `enable_nfs` | `false` | NFS is off by default; not used by Chibisafe's storage model. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container (only relevant if `enable_nfs` is set). |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts. The Chibisafe `storage` bucket is auto-added at `/data`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `enable_redis` | `true` (mirrored, **inert**) | Declared only for Foundation-convention parity — `main.tf` always forwards `enable_redis = false` to App_CloudRun regardless of this value. Chibisafe has no Redis dependency. |

### Group 12 — Database Backend (not applicable)

`database_type` is fixed to `NONE` by `Chibisafe_Common`. All other Group-12
variables — `sql_instance_name`, `sql_instance_base_name`,
`database_password_length`, `application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`,
`enable_mysql_plugins`/`mysql_plugins`,
`enable_postgres_extensions`/`postgres_extensions`,
`enable_auto_password_rotation`/`rotation_propagation_delay_sec` — are declared
purely for Foundation-convention mirroring and have no effect on this module.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job is injected; use only for custom data-loading tasks. |
| `cron_jobs` | `[]` | Recurring scheduled Cloud Run jobs; none by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, 15s initial delay | The live, effective startup probe (see §3). |
| `liveness_probe` | HTTP `/api/health`, 30s initial delay | The live, effective liveness probe. |
| `startup_probe_config` | HTTP `/`, enabled | **Inert for this module** — App_CloudRun's foundation always prefers the app-specific `startup_probe` supplied via `application_config` over this standalone variable, so changing it has no effect on the deployed probe. |
| `health_check_config` | HTTP `/`, enabled | Same inertness as `startup_probe_config` — `liveness_probe` (Group 14, above) is what's actually deployed. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `organization_id` | `""` | Override for folder-nested projects. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `chibisafe_url` | Cloud Run service URL for the REST API (port 8000). Its description says "internal VPC URL... only reachable when `ingress_settings` is `internal`" — stale wording, since the default is `all` (public); treat it as simply the service URL. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when `enable_cloud_armor` is enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any custom initialization jobs. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

Note the absence of an output for the optional `enable_api_key` secret — unlike
`Chibisafe_GKE` (which exposes `chibisafe_api_key_secret_id`), this module does
not surface the generated secret's name; find it via `gcloud secrets list
--filter="name~chibisafe"`.

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `container_port`/`timeout_seconds`/`backup_retention_days`, a `gen1` runtime combined with `gcs_volumes`, an invalid `traffic_split`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Persistence model | GCS Fuse `/data` (this module's only option) | Critical | SQLite over GCS Fuse's POSIX file-locking semantics is not fully safe under sustained/concurrent writes. The module's own metadata explicitly recommends `Chibisafe_GKE` (block PVC) for durable production storage; use this Cloud Run variant for light/low-traffic uploaders only. |
| `max_instance_count` | `1` | Critical | Chibisafe is a single-writer SQLite app; scaling beyond 1 instance risks concurrent writers corrupting the SQLite DB on the shared GCS Fuse mount. |
| `startup_probe` / `liveness_probe` `path` | `/api/health` | High | The backend has no root route — `GET /` 404s. Overriding either probe to `/` (matching the Common module's own generic default, or the GKE variant's documented default) restart-loops the container. |
| `enable_api_key` | `true` for any deployment outside a trusted network | High | With `ingress_settings = all` (the default) and `enable_api_key = false`, the service is public and relies entirely on completing the first-run setup wizard immediately; leaving it unconfigured longer widens the window for a stranger to claim the admin account. |
| `ingress_settings` | `all` | Medium | Confirm your working copy of this module has not regressed to `internal` — a historical fleet-wide copy-paste bug defaulted several modules' `ingress_settings` to `internal`, which would make this public file uploader completely unreachable despite passing health checks. |
| `startup_probe_config` / `health_check_config` | leave as-is; understand they're inert | Low | App_CloudRun's foundation always prefers the app-specific `startup_probe`/`liveness_probe` supplied via `application_config` over these standalone variables when both are present, so editing these two has no effect on the deployed probe. |
| `enable_cloudsql_volume` | `false` (only value that matters) | Low | `main.tf` hardcodes `false` to the Foundation regardless of what this variable is set to; Chibisafe has no Cloud SQL database. |
| `enable_redis` | any value (inert) | Low | `main.tf` always forwards `enable_redis = false` — changing this variable has no effect; do not rely on it to add Redis connectivity. |
| `memory_limit` / `min_instance_count` / `container_protocol` descriptions | ignore the wording | Low | These variables' description text references "vector indexes," "collections," "index loading," and "gRPC" — leftover copy-paste from a vector-database module template. Chibisafe is a file uploader with none of these; the numeric/string defaults themselves (`1Gi`, `1`, `http1`) are correct and unaffected. |
| `database_type` / `db_*` / `sql_instance_*` variables | `NONE` / inert | Low | Chibisafe has no SQL database; these exist only for Foundation-variable mirroring and are silently ignored. |
| `enable_api_key` secret discoverability | use `gcloud secrets list --filter="name~chibisafe"` | Low | This module's `outputs.tf` does not expose the generated secret's name as an output (unlike `Chibisafe_GKE`'s `chibisafe_api_key_secret_id`). |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Chibisafe-specific application
configuration shared with the GKE variant lives in the `Chibisafe_Common`
module (`modules/Chibisafe_Common/README.md`); the GKE variant itself is
documented in **[Chibisafe_GKE](Chibisafe_GKE.md)**.
