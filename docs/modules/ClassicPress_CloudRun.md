---
title: "ClassicPress on Google Cloud Run"
description: "Configuration reference for deploying ClassicPress on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# ClassicPress on Google Cloud Run

ClassicPress is a free, open-source, business-focused CMS — a lightweight fork of
WordPress 4.9.x that preserves the classic (pre-Gutenberg) editing experience, with
plugins, themes, a media library, and a REST API. This module deploys ClassicPress on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services ClassicPress uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

ClassicPress runs as a single PHP/Apache container built from a thin custom image
`FROM classicpress/classicpress`. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service on port 80, 1 vCPU / 2 GiB by default; scale-to-zero (`min_instance_count = 0`) is the default |
| Database | Cloud SQL for MySQL 8.0 | Fixed — `ClassicPress_Common` hardcodes `database_type = "MYSQL_8_0"` |
| File persistence | Cloud Filestore (NFS), optional | Mounted at `/var/lib/classicpress` by default (`enable_nfs = true`) — see the note in [Section 3](#3-classicpress-application-behaviour) on what this path actually covers |
| Object storage | Cloud Storage | Both a `data` bucket (from the variant's own `storage_buckets` default) and a `classicpress-uploads` bucket (from `ClassicPress_Common`) are provisioned automatically; neither is mounted into the container by default |
| Secrets | Secret Manager | Auto-generated `CLASSICPRESS_SALT_SEED` (derives the 8 WordPress-style auth keys/salts); database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory and hardcoded.** `ClassicPress_Common`'s `config` sets
  `database_type = "MYSQL_8_0"` directly; the variant's own `database_type` variable
  is largely decorative — overriding it breaks the MySQL-specific `db-init` job and
  entrypoint. Leave it at the default.
- **Custom build, not prebuilt.** `container_image_source` defaults to `"custom"` —
  Cloud Build produces a thin image `FROM classicpress/classicpress` that grafts an
  entrypoint shim aliasing the Foundation's injected `DB_*` vars onto ClassicPress's
  `CLASSICPRESS_DB_*` and deriving stable auth salts. The stock upstream image is
  never deployed directly.
- **Cloud SQL is reached over private-IP TCP by default**, not a Unix socket.
  `enable_cloudsql_volume` defaults to `false` (the variant explicitly forces this
  value into the app config, overriding whatever `ClassicPress_Common` might
  otherwise set); the entrypoint builds `CLASSICPRESS_DB_HOST` from `DB_IP:DB_PORT`.
  MySQL on the Cloud SQL private range needs no SSL. Set `enable_cloudsql_volume =
  true` to use the Auth Proxy socket instead.
- **The ClassicPress install itself lives on the container's own ephemeral
  filesystem.** Cloud Run has no per-instance persistent block volume equivalent to
  GKE's StatefulSet PVC. The upstream entrypoint writes `wp-config.php` and copies
  the whole application (including `wp-content/uploads` and any plugins installed
  through wp-admin) into `/var/www/html` on first boot of *each* container instance.
  With the default `min_instance_count = 0`, every cold start after idle spins up a
  fresh instance with an empty `/var/www/html` — uploaded media and admin-installed
  plugins/themes from a previous instance do **not** carry over, even though the
  Cloud SQL database (pages, posts, settings, and the media *records*) is durable.
  See the pitfalls table for mitigations.
- **NFS is enabled by default but mounted at a path the app never uses.**
  `enable_nfs = true` provisions Filestore and mounts it at `/var/lib/classicpress`,
  but neither the Dockerfile nor the entrypoint reference that path — it does not
  cover the actual `/var/www/html` install directory.
- **`CLASSICPRESS_SALT_SEED` is generated automatically** and stored in Secret
  Manager; the entrypoint derives all 8 WordPress-style `AUTH_KEY`/`SALT` values from
  it deterministically, so cookies and sessions survive restarts and agree across
  every cold-started instance without persisting `wp-config.php` state.
- **No auto-install — first login is manual.** `ClassicPress_Common` generates no
  admin-password secret and sets no auto-install flag. ClassicPress creates its
  schema and admin account through its own first-run web installer once `db-init`
  has provisioned the empty database.
- **Two GCS buckets are created but unused by default.** The variant's own
  `storage_buckets` default (`data`) and `ClassicPress_Common`'s preset
  (`classicpress-uploads`) both get created (different name suffixes, so they don't
  collide) — neither is wired in as a `gcs_volumes` mount unless you add one.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the ClassicPress service

ClassicPress runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

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

### B. Cloud SQL for MySQL 8.0

ClassicPress stores all application data (posts, pages, users, options, plugin/theme
settings) in a managed Cloud SQL for MySQL 8.0 instance. By default the service
connects over **private-IP TCP** (`enable_cloudsql_volume = false`); Cloud SQL MySQL
accepts unencrypted TCP on the private range, so no SSL configuration is needed. On
first deploy, an initialization Job (`db-init`) creates the application database and
user and verifies the app user can connect.

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

### C. Cloud Storage

Two Cloud Storage buckets are provisioned by default: a `data` bucket (declared by
this variant's own `storage_buckets` default) and a `classicpress-uploads` bucket
(declared by `ClassicPress_Common`). Neither is mounted into the container as a
`gcs_volumes` entry out of the box — add one explicitly (e.g. mounted at
`/var/www/html/wp-content/uploads`) if you want media uploads to survive across
Cloud Run cold starts.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/        # bucket names are in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Cloud Filestore (NFS)

`enable_nfs = true` is the default, mounting a shared Filestore instance at
`/var/lib/classicpress`. As noted above, this path is not currently referenced by
the Dockerfile or entrypoint shim, so it provides spare shared storage rather than
covering any confirmed data path. `enable_nfs = true` is also what makes
`redis_host = ""` fall back to the NFS server's co-hosted Redis IP (see Group 21).

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for NFS discovery and mount mechanics.

### E. Secret Manager

One ClassicPress-specific secret is generated automatically and stored in Secret
Manager: `CLASSICPRESS_SALT_SEED`, a 64-character random seed from which the
entrypoint derives all 8 WordPress-style `AUTH_KEY`/`SECURE_AUTH_KEY`/
`LOGGED_IN_KEY`/`NONCE_KEY` and their matching `SALT` values (SHA-256 of the seed
plus a fixed per-key suffix). The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~classicpress"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`). An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud
Armor can be layered on; ingress settings and VPC egress control connectivity.

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

## 3. ClassicPress Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`, `mysql:8.0-debian`)
  waits for connectivity (Unix socket if `enable_cloudsql_volume = true`, otherwise
  TCP via `DB_IP`), idempotently creates the application database and user with
  `CREATE USER IF NOT EXISTS` / `GRANT ALL PRIVILEGES`, verifies the app user can
  connect, and gracefully shuts down the Cloud SQL Auth Proxy sidecar if one was
  started. The job is safe to re-run (`execute_on_apply = true`, `max_retries = 3`).
- **No separate migration job — manual first-run install.** There is no
  auto-install flag for ClassicPress. Once `db-init` has provisioned the empty
  database, ClassicPress creates its own schema and admin account through the
  first-run web installer (`/wp-admin/install.php` in the upstream image). Visit the
  service URL after first deploy and complete the installer to set the admin
  username, password, and email — there is no generated admin-password secret.
- **DB env-var aliasing over TCP.** The Foundation injects `DB_IP` (the Cloud SQL
  private IP on Cloud Run), `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`; ClassicPress reads `CLASSICPRESS_DB_*`. The grafted
  `entrypoint.sh` builds `CLASSICPRESS_DB_HOST` as `<DB_IP>:<DB_PORT>` (or the
  `localhost:<socket>` form if a Cloud SQL socket directory is found under
  `enable_cloudsql_volume = true`) and aliases the rest, before handing off to the
  upstream `docker-entrypoint.sh`.
- **Auth keys/salts are derived, not stored individually.** `CLASSICPRESS_SALT_SEED`
  is the only generated secret; the entrypoint computes all 8
  `CLASSICPRESS_AUTH_KEY` / `..._SALT` values as `sha256(seed-<key-name>)`, so every
  restart and every cold-started instance agrees on the same values without
  persisting `wp-config.php` state — sessions and login cookies remain valid across
  instance churn even though the filesystem does not.
- **The install itself lives on the container's ephemeral filesystem, not on
  persistent storage.** The upstream `docker-entrypoint.sh` writes `wp-config.php`
  and copies the ClassicPress application into `/var/www/html` on first boot of each
  container instance. On Cloud Run this directory is *not* backed by NFS, GCS Fuse,
  or a block volume by default, so uploaded media (`wp-content/uploads`) and any
  plugins/themes installed via wp-admin are lost whenever the instance recycles
  (redeploy, scale-to-zero-and-back, instance replacement). The Cloud SQL database
  (posts, pages, settings, and media metadata rows) is unaffected.
- **NFS mount path is not referenced by the image or entrypoint.**
  `enable_nfs = true` mounts Filestore at `/var/lib/classicpress` by default, but
  neither `ClassicPress_Common`'s Dockerfile nor its `entrypoint.sh` read or write
  that path — it does not currently provide the persistence that would fix the
  point above. Treat it as spare shared storage, not a confirmed data path.
- **`php_memory_limit`, `upload_max_filesize`, and `post_max_size` are accepted but
  not currently wired into a PHP setting.** These variables are forwarded through to
  `ClassicPress_Common`, but its `config.environment_variables` does not set any
  corresponding `PHP_*`/`UPLOAD_MAX_FILESIZE`/`POST_MAX_SIZE` env var for the
  upstream image to read — changing them has no observed effect on the deployed
  container today.
- **Redis is optional and off by default.** When `enable_redis = true`, leaving
  `redis_host` empty lets the Foundation fall back to the co-hosted NFS-server Redis
  IP (requires `enable_nfs = true`); setting `redis_host` explicitly points
  ClassicPress at an external Redis/Memorystore instance instead.
- **Health paths.** The startup probe is **TCP** on port 80 (generous
  `failure_threshold = 20`, allowing time for the upstream image's own entrypoint to
  populate the empty `/var/www/html` on first boot of a fresh instance). The
  liveness probe is **HTTP** `GET /` with a 300-second initial delay — a 200
  (installed site) or a 302 redirect to the installer (fresh install) both count as
  healthy.
- **Inspect job execution and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform (by their
`{{UIMeta group=N}}` tag, not by the `.tf` file's section comments, which are
occasionally out of sync with the tags). Only settings specific to or notable for
ClassicPress are listed; every other input is inherited from
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
| `application_name` | `classicpress` | Base name for resources. Do not change after first deploy. |
| `display_name` | `ClassicPress` | Human-readable name shown in the Console. |
| `description` | `ClassicPress wiki on Cloud Run` | Service description. |
| `application_version` | `latest` | Maps to the `classicpress/classicpress` image tag via the app-specific `CLASSICPRESS_VERSION` build arg (`latest` resolves to `php8.3-apache`; the generic `APP_VERSION` build arg the Foundation injects would otherwise silently overwrite a same-named arg). |
| `php_memory_limit` | `512M` | Accepted but not currently wired into any PHP setting — see Section 3. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Same caveat as above; validated at plan time (`upload_max_filesize ≤ post_max_size`) but not otherwise applied. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the thin `FROM classicpress/classicpress` image with the grafted entrypoint shim — required, the stock image cannot alias `DB_*` on its own. |
| `cpu_limit` | `1000m` | CPU per instance; ClassicPress with MySQL needs at least 1 vCPU. |
| `memory_limit` | `2Gi` | Memory per instance; minimum ~512Mi for PHP/Apache. |
| `min_instance_count` | `0` | `0` enables scale-to-zero — but see the ephemeral-filesystem caveat in Section 3 before relying on it in production. |
| `max_instance_count` | `1` | Keep at `1` — the container filesystem is per-instance and not shared. |
| `container_port` | `80` | ClassicPress runs on Apache, port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Default is private-IP TCP; set `true` for the Cloud SQL Auth Proxy Unix socket instead. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress for the CMS front end and admin UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in for the whole service (including the public site). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, merged with `ClassicPress_Common`'s defaults (`DB_PORT`, `CLASSICPRESS_TABLE_PREFIX=cp_`, `CLASSICPRESS_DB_CHARSET=utf8mb4`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `CLASSICPRESS_SALT_SEED` is injected automatically and does not need to be set here. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore a MySQL dump from GCS or Google Drive on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. |

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy for the built image. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS bucket beyond `ClassicPress_Common`'s own `classicpress-uploads` bucket (both are created; neither is mounted by default). |
| `enable_nfs` | `true` | On by default, mounted at `/var/lib/classicpress` — not currently used by the entrypoint (see Section 3). |
| `nfs_mount_path` | `/var/lib/classicpress` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2); add an entry mounted at `/var/www/html/wp-content/uploads` for real media persistence. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Hardcoded by `ClassicPress_Common`; changing the variable does not change the deployed database engine. |
| `db_name` | `classicpress` | MySQL database name. Immutable after first deploy. |
| `db_user` | `classicpress` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Declared for convention mirroring only — `main.tf` hardcodes empty aliases for this variant, so setting these has no effect; ClassicPress's own entrypoint handles the `CLASSICPRESS_DB_*` aliasing. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job from `ClassicPress_Common`. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP port 80, `failure_threshold = 20` | Generous threshold for first-boot population of `/var/www/html`. |
| `liveness_probe` | HTTP `/`, 300s initial delay | A 200 or a 302-to-installer both count as healthy. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enables ClassicPress's WordPress-style object cache backend. |
| `redis_host` | `""` | Leave empty to fall back to the Foundation's own `REDIS_HOST` injection (the NFS-VM Redis IP when `enable_nfs = true`); set explicitly for an external Redis/Memorystore instance. |
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
| `storage_buckets` | Created Cloud Storage buckets (`data` and `classicpress-uploads`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created. ClassicPress also runs its own precondition (`validations.tf`) for `upload_max_filesize ≤ post_max_size`.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Media/plugin persistence at `/var/www/html` | Add a `gcs_volumes` mount (e.g. at `wp-content/uploads`) or keep `min_instance_count ≥ 1` | Critical | With the default `min_instance_count = 0` and no volume covering `/var/www/html`, every cold-started instance starts from an empty filesystem — uploaded media and wp-admin-installed plugins/themes from earlier instances are gone, even though the database is intact. |
| `CLASSICPRESS_SALT_SEED` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all signed cookies and logged-in sessions across every instance. |
| `database_type` | Leave at default (`MYSQL_8_0`) | Critical | `ClassicPress_Common`'s `db-init` job and entrypoint are MySQL-specific; the value is hardcoded regardless of the variable, but relying on the variable to select an engine is a dead end. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `max_instance_count` | `1` | High | The container filesystem is per-instance; scaling beyond 1 gives every replica a separate, diverging copy of the site rather than a shared one. |
| First-run admin setup | Complete `/wp-admin/install.php` promptly after deploy | High | Until the installer runs, the site has no schema and no admin account — there is no generated admin-password secret to recover with. |
| `enable_nfs` | `true` (but currently unused by the app) | Medium | Provisions and pays for a Filestore instance that the current entrypoint/Dockerfile never mount data onto — see Section 3. Disabling it does not remove any confirmed persistence, but confirm against a live deployment before relying on this. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | Any value | Low | Currently not wired into a PHP setting — do not assume changing them affects upload limits or PHP memory in the deployed container. |
| `memory_limit` | `2Gi` | Medium | Below ~512Mi the PHP/Apache container risks OOM under load or with heavier plugins. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency and compounds the filesystem-persistence issue above. |
| `enable_cloud_armor` | enable for production | Medium | The admin UI and public site are reachable without WAF protection by default. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. ClassicPress-specific application configuration
shared with the GKE variant lives in the `ClassicPress_Common` module (no standalone
`ClassicPress_Common.md` guide exists yet in this docs set); see also
[ClassicPress_GKE](ClassicPress_GKE.md) for how the same application behaves on a
StatefulSet with a per-pod block PVC.
