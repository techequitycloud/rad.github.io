---
title: "GoToSocial on Google Cloud Run"
description: "Configuration reference for deploying GoToSocial on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# GoToSocial on Google Cloud Run

GoToSocial is a lightweight, self-hosted ActivityPub/Fediverse server — a
small alternative to Mastodon, written as a single static Go binary. This
module deploys GoToSocial on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services GoToSocial uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

GoToSocial runs as a single Go binary container on Cloud Run v2, deployed
directly from the official `docker.io/superseriousbusiness/gotosocial` image
— no custom build. The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go binary on port 8080, 2 vCPU / 4 GiB by default; serverless autoscaling; **`max_instance_count` hard-fixed at 1** |
| Database | Cloud SQL for PostgreSQL 15 | Required — fixed at `POSTGRES_15`; MySQL not supported. Database created with mandatory `LC_COLLATE='C' LC_CTYPE='C'` collation |
| Object storage | Cloud Storage | A `storage` bucket + dedicated HMAC service account, consumed unconditionally via GoToSocial's native S3-compatible client — no GCS FUSE mount |
| Secrets | Secret Manager | Auto-generated `SUPERUSER_PASSWORD`, S3 HMAC access/secret key pair; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain via Cloud Armor |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 with `C` collation is mandatory.** `database_type =
  "POSTGRES_15"` is the default, and `GoToSocial_CloudRun`'s `validation.tf`
  rejects any non-Postgres `database_type` at plan time. The `db-init` job
  additionally creates the database with `LC_COLLATE='C' LC_CTYPE='C'` —
  GoToSocial refuses to start against any other collation.
- **Prebuilt image, not custom.** `container_image_source = "prebuilt"`
  deploys `docker.io/superseriousbusiness/gotosocial` directly. GoToSocial's
  own upstream repo has moved to Codeberg, but the container registry it
  publishes to is still Docker Hub. No entrypoint wrapper is needed —
  configuration is entirely through discrete `GTS_*` env vars the binary
  reads natively.
- **No migrate job.** GoToSocial creates and upgrades its own schema
  automatically on every start; `db-init` only prepares the C-collation
  database and role.
- **`max_instance_count` is hard-fixed at 1.** GoToSocial's in-process cache
  has no cross-instance synchronization; upstream does not support multiple
  instances against the same database/storage. `min_instance_count = 0`
  (scale-to-zero) is safe — the single-instance constraint is about
  concurrency, not warmth across restarts.
- **Cloud SQL is reached over encrypted TCP to the private IP, not a Unix
  socket.** `App_CloudRun`'s `db_host_env_var_name` mechanism always aliases
  the raw Cloud SQL private IP (not the socket path `DB_HOST` otherwise
  resolves to on Cloud Run), so `GTS_DB_TLS_MODE` is overridden to `"enable"`
  (encrypt without verifying) rather than the GKE-correct `"disable"` — see
  §3 and the Pitfalls table.
- **No GCS FUSE mount.** Media/avatar/attachment storage uses GoToSocial's
  native S3-compatible client pointed at GCS's S3-interop XML endpoint via a
  dedicated HMAC service account — not a filesystem mount.
- **Health probes are TCP, not HTTP.** GoToSocial's `/readyz`/`/livez`
  endpoints reject any request lacking a `User-Agent` header with an
  anti-scraper `418` response — neither Cloud Run's HTTP prober nor a bare
  `curl` sends one. The liveness probe is disabled entirely on Cloud Run
  (its API rejects a TCP-socket liveness probe outright); the startup probe
  alone gates traffic.
- **No admin account exists until you manually trigger `admin-create`.**
  GoToSocial has no web sign-up flow for the first account. See §3 and the
  Pitfalls table.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource
names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the GoToSocial service

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

### B. Cloud SQL for PostgreSQL 15

GoToSocial stores all application data (accounts, statuses, follows, media
metadata) in a managed Cloud SQL for PostgreSQL 15 instance, created with the
mandatory `C` collation by the `db-init` job. The service connects over
encrypted TCP to the instance's private IP (see §3 for why, unlike most
Cloud Run apps in this catalogue, this is *not* a Unix socket connection).

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~gotosocial"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage — media, avatars, attachments

A dedicated **Cloud Storage** bucket (suffix `storage`) and a service account
holding an **HMAC key** are provisioned automatically, granting the storage
SA `roles/storage.objectAdmin` on the bucket. Unlike opt-in S3 storage seen
elsewhere in this catalogue, GoToSocial writes to this bucket unconditionally
from first boot — `GTS_STORAGE_BACKEND=s3` is not optional.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud storage ls gs://<storage-bucket>/
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse (not used here) and CMEK
options.

### D. Secret Manager

GoToSocial's main container reads `SUPERUSER_PASSWORD` (only via the
`admin-create` job, not the running server), `GTS_STORAGE_S3_ACCESS_KEY`, and
`GTS_STORAGE_S3_SECRET_KEY` as secret-backed environment variables. The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details, and
[GoToSocial_Common](GoToSocial_Common.md) §2 for why these secrets flow
through `secret_ids`/`module_secret_env_vars`, not the per-app config
object's (dead) `secret_environment_variables` field.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings
= "all"`, required for public ActivityPub federation). An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. GoToSocial Application Behaviour

- **First-deploy database setup.** The `db-init` job runs
  `scripts/db-init.sh` using `postgres:15-alpine`. It waits for Cloud SQL to
  accept connections, then idempotently creates the application role and the
  database with `LC_COLLATE='C' LC_CTYPE='C'` (GoToSocial refuses to start
  otherwise), grants privileges, and completes. Safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **No separate migrate job.** GoToSocial migrates its own schema
  automatically on every server start.
- **The admin account requires a manual trigger — this is the #1
  operator-facing gotcha of this module.** GoToSocial has no web-based
  sign-up flow and no REST endpoint for the very first account — it is
  CLI-only (`gotosocial admin account create` / `admin account promote`).
  Confirmed live: the CLI panics with `NewSignup: instance application not
  yet created, run the server at least once before creating users` unless the
  main server process has already booted successfully once. Cloud Run's
  initialization jobs always run *before* the service's first revision
  exists at all, so `admin-create` is created with `execute_on_apply = false`
  by design — it cannot succeed during the initial `apply`. Once the service
  is confirmed healthy (see Task 2 in the lab), trigger it manually:
  ```bash
  gcloud run jobs execute <service-name>-admin-create --region "$REGION" --project "$PROJECT" --wait
  ```
  Retrieve the generated password:
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~superuser-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
- **`GTS_DB_TLS_MODE` is `"enable"` on Cloud Run, not `"disable"` or
  `"require"` — a real Foundation-level asymmetry.** `App_CloudRun`'s
  `db_host_env_var_name` implementation always aliases the raw Cloud SQL
  **private IP** (`local.db_internal_ip`), not the Unix socket path `DB_HOST`
  otherwise resolves to on Cloud Run — despite the variable's name/description
  implying "host". (`App_GKE`'s equivalent is smarter: it prefers the
  cloud-sql-proxy sidecar's `127.0.0.1` loopback, so GKE correctly keeps
  `"disable"`.) A raw private-IP TCP connection to Cloud SQL requires
  encryption, so plain `"disable"` fails ("no encryption"). `"require"` is
  *not* the fix either — confirmed live it demands full certificate
  verification (GoToSocial's own docs: `"require"` = "a valid certificate
  must be presented"), which fails against Cloud SQL's cert ("x509: cannot
  validate certificate ... doesn't contain any IP SANs"). `"enable"` is
  correct — GoToSocial's docs confirm it means "TLS will be tried, but the
  database certificate won't be checked" (the classic libpq
  `sslmode=require`-not-`verify-full` semantics). `gotosocial.tf` sets this
  override via `module_env_vars`.
- **Health path — TCP only, and why `curl` needs a `User-Agent`.** GoToSocial
  serves real, unauthenticated `/readyz` (DB `SELECT`, 500 on failure) and
  `/livez` (cheap 200) endpoints, but both reject any request without a
  `User-Agent` header with a `418 I'm a teapot` response — confirmed live:
  `{"error": "I'm a teapot: no user-agent sent with request"}`. Neither Cloud
  Run's HTTP prober nor a bare `curl` sends one, so **every** manual
  verification command against this app needs an explicit `-A`/`--user-agent`
  flag:
  ```bash
  curl -A "gotosocial-check/1.0" -s "$SERVICE_URL/readyz"
  ```
  The startup probe is TCP against port 8080; the liveness probe is disabled
  entirely (Cloud Run's API rejects a TCP-socket liveness probe outright).
- **Storage IAM propagation.** GoToSocial panics on boot if it cannot reach
  its S3 storage backend. The storage SA's `roles/storage.objectAdmin` grant
  is wired against the Foundation's own `storage_buckets` output (not a
  whole-module `depends_on`, which would deadlock) — but a fresh first
  deploy can still see the very first container boot race the IAM grant's
  ~1–2 minute propagation delay. This is an expected, occasional one-time
  retry, not a bug.
- **Inspect the init jobs and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform
(matching each variable's `{{UIMeta group=N}}` tag in `variables.tf`). Only
settings specific to or notable for GoToSocial are listed; every other input
is inherited from [App_CloudRun](App_CloudRun.md) with its standard
behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. Use a distinct value (e.g. `cr`) from any co-deployed GKE variant (e.g. `gke`) — same-tenant CR+GKE collide on service name, secrets, and buckets. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `gotosocial` | Base name for resources. Do not change after first deploy. |
| `display_name` | `GoToSocial` | Human-readable name shown in the Console. |
| `description` | `GoToSocial — a lightweight, self-hosted ActivityPub/Fediverse server` | Service description. |
| `application_version` | `latest` | Docker Hub image tag. |
| `host` | `gotosocial.local` | `GTS_HOST` — the public domain. Baked into every ActivityPub URI at creation time, **immutable after first boot**. Set your real domain before production. |
| `account_domain` | `""` | `GTS_ACCOUNT_DOMAIN` — optional vanity handle domain, separate from `host`. Defaults to `host` when empty. Same immutability risk. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official Docker Hub image directly. `custom` is supported but unnecessary — GoToSocial needs no wrapper. |
| `container_image` | `""` | Override image URI; leave blank to use the default GoToSocial image. |
| `cpu_limit` | `2000m` | 2 vCPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero — safe for GoToSocial (concurrency constraint, not warmth). |
| `max_instance_count` | `1` | **Hard architectural ceiling** — GoToSocial's in-process cache has no cross-instance synchronization. Do not raise. |
| `container_port` | `8080` | GoToSocial's native `GTS_PORT` default. |
| `cpu_always_allocated` | `false` | Request-based billing — GoToSocial's request/response core has no separate background worker process needing CPU between requests. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse/NFS mounts (unused by GoToSocial's default config, but consistent with the catalogue). |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Injects the Cloud SQL Auth Proxy socket mount, though GoToSocial connects over TCP to the private IP regardless (see §3) — the mount is unused by this app's DB path but harmless to leave on. |
| `enable_image_mirroring` | `true` | Mirror the Docker Hub image into Artifact Registry (avoids Docker Hub pull-rate limits). |

### Group 5 — Access, Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Required — federation and client access both need public reachability. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks federation** — only appropriate for a fully private instance. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text env vars merged into `GoToSocial_Common`'s defaults. |
| `secret_environment_variables` | `{}` | Operator-facing secret refs — separate from, and not to be confused with, the `secret_ids` mechanism `GoToSocial_Common` itself uses (see [GoToSocial_Common](GoToSocial_Common.md) §2). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md).

### Group 9 — Custom SQL Scripts

Standard App_CloudRun custom SQL script execution — see
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `application_domains` | `[]` | Custom domain names — should match `host`. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend — useful for media delivery. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets — `gotosocial.tf` supplies the real `storage` bucket via `GoToSocial_Common`'s output, overriding this variable's generic `data` default. |
| `enable_nfs` | `true` | Provisions Filestore. **Not used by GoToSocial** — media storage is via the native S3 client, not a mount. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. Not used by default. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Plan-validated** — `validation.tf` rejects anything but PostgreSQL 13/14/15 or `NONE`. |
| `db_name` | `gotosocial` | The database actually created (with `C` collation) and injected as `GTS_DB_DATABASE`. Immutable after first deploy. |
| `db_user` | `gotosocial` | The role actually created and injected as `GTS_DB_USER`; password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `GTS_DB_ADDRESS` / `GTS_DB_PORT` / `GTS_DB_USER` / `GTS_DB_DATABASE` / `GTS_DB_PASSWORD` | **Set by `main.tf`, not left at their generic-empty variable defaults** — this is the mechanism that lets the GoToSocial binary read its own `GTS_DB_*` names while still getting values from the Foundation's standard `DB_*` generation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `admin-create` pair supplied by `GoToSocial_Common`. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks are defined for GoToSocial. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, `/readyz` (informational path only), `initial_delay_seconds=15`, `failure_threshold=10` | The only probe type that works against GoToSocial's User-Agent-gated health endpoints. |
| `liveness_probe` | `enabled = false` | Disabled — Cloud Run's API rejects TCP liveness probes outright; the startup probe alone gates traffic. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, various | Alternative structured probes; superseded by `startup_probe`/`liveness_probe` above for this module. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default (would also need a `User-Agent`-sending checker to succeed against `/readyz`/`/livez` — a plain `/` check is the safer default here). |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | GoToSocial has no Redis dependency at all — its cache is in-process. Leave `false`. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (the Cloud SQL private IP on Cloud Run) / port. |
| `storage_buckets` | Created Cloud Storage buckets (the `storage` media bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `admin-create`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. `GoToSocial_CloudRun` itself adds `validation.tf` checks for `min_instance_count > max_instance_count`, Redis-enabled-without-a-host, and `database_type` away from PostgreSQL — so unlike some modules in this catalogue, the MySQL mistake **is** caught at plan time here, not just at runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `host` (`GTS_HOST`) | Set your real domain before first deploy | Critical | Baked into every ActivityPub actor/object URI at creation time; changing it after real accounts/posts exist breaks federation for everything created under the old value. |
| `max_instance_count` | `1` (do not raise) | Critical | GoToSocial's in-process cache has no cross-instance synchronization; upstream does not support multiple instances against the same database/storage — raising this produces data/cache inconsistency, not just extra cost. |
| `GTS_DB_TLS_MODE` | `enable` (set automatically by `gotosocial.tf`, do not override to `disable`/`require`) | Critical | `disable` fails outright against Cloud SQL's private-IP TCP path on Cloud Run (no encryption); `require` fails certificate verification against Cloud SQL's cert (no IP SANs) — only `enable` (encrypt-without-verify) works here. |
| `database_type` | `POSTGRES_15` | Critical | Plan-time validated by `GoToSocial_CloudRun`'s own `validation.tf` — MySQL/SQL Server are rejected before apply, unlike some other modules in this catalogue. |
| Storage IAM wiring (`google_storage_bucket_iam_member`) | Leave as shipped (references `module.app_cloudrun.storage_buckets["storage"]`) | Critical | GoToSocial panics on boot without S3 access. A `depends_on = [module.app_cloudrun]` alternative would deadlock the Deployment against its own IAM prerequisite. |
| Health probes (`startup_probe`/`liveness_probe`) | Leave `type = "TCP"` | High | GoToSocial's `/readyz`/`/livez` reject any request without a `User-Agent` header (`418`); switching to `type = "HTTP"` makes the probe fail forever regardless of path, since Cloud Run's prober never sends one. |
| `admin-create` job | Trigger manually post-deploy | High | GoToSocial has no web sign-up flow for the first account, and the job cannot run at apply time on Cloud Run (initialization jobs always precede the first revision) — skipping this step leaves the instance with no usable admin login. |
| Manual `curl`/health checks | Always pass `-A "<agent>"` | Medium | Bare `curl` (and most default HTTP clients/monitors) get `418 I'm a teapot` from GoToSocial's anti-scraper User-Agent gate, even on "unauthenticated" endpoints — easy to misdiagnose as an outage. |
| `enable_redis` | `false` (default) | Low | GoToSocial has no Redis dependency; leaving this `true` has no functional effect but adds unnecessary NFS-dependency configuration. |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | Leave as shipped (`GTS_DB_*` aliases set in `main.tf`) | Critical | These are what let GoToSocial's binary read the Foundation's DB connection info at all — overriding them breaks the DB connection entirely. |
| `enable_iap` | `false` for a public instance | Medium | IAP blocks unauthenticated ActivityPub federation traffic — only appropriate for a fully private/testing instance. |
| Storage IAM propagation on first deploy | Expect a possible one-time retry | Low | A fresh deploy's very first container boot can race the storage SA's IAM grant propagation (~1–2 minutes); the app recovers on the next revision/retry without any config change needed. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. GoToSocial-specific application
configuration shared with the GKE variant (secrets, the `db-init`/
`admin-create` jobs, and the storage service account) is defined in
**[GoToSocial_Common](GoToSocial_Common.md)** (module source:
`modules/GoToSocial_Common`).
