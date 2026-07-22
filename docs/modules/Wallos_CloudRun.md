---
title: "Wallos on Google Cloud Run"
description: "Configuration reference for deploying Wallos on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Wallos on Google Cloud Run

Wallos is an open-source, self-hosted subscription and recurring-expense tracker
built on plain PHP 8.3 + php-fpm (no MVC framework). It tracks recurring
subscriptions, converts prices across currencies, sends renewal notifications, and
supports a household multi-user mode. This module deploys Wallos on **Cloud Run
v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Wallos uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Wallos runs as a single PHP container on Cloud Run v2. It is deliberately
minimal — no SQL database, no cache, no queue — but it DOES run a real, always-on
cron daemon, which drives several of the defaults below:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single PHP/php-fpm service, 1 vCPU / 1 GiB by default; `min = max = 1`, `cpu_always_allocated = true` |
| Persistent state | Cloud Storage (GCS FUSE) | **Two** buckets: `db` mounted at `/var/www/html/db` (SQLite file), `uploads` mounted at `/var/www/html/images/uploads/logos` (custom provider logos) |
| Database | None (embedded SQLite) | `database_type = NONE`; no Cloud SQL is provisioned; confirmed no MySQL/Postgres support exists anywhere in the app |
| Cache & queue | None | Wallos uses no Redis |
| Secrets | Secret Manager | No app secrets generated; users live in the SQLite DB |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default ingress is **`all`** — the service is publicly reachable out of the box |
| Background jobs | In-container cron daemon | 8 baked-in scheduled tasks (exchange-rate refresh, renewal notifications, an email-verification poll every 2 minutes, etc.) — not modeled as a Cloud Run Job; it runs continuously inside the main container |

**Sensible defaults worth knowing up front:**

- **State lives in two SQLite/logo files on GCS, each in its own bucket.**
  Wallos has no Cloud SQL database. Its subscriptions, categories, settings, and
  users are stored in `/var/www/html/db/wallos.db` (bucket `db`); user-uploaded
  custom provider logos live in `/var/www/html/images/uploads/logos` (bucket
  `uploads`). Both paths are fixed — no environment variable relocates either one.
  Losing or wiping either bucket loses that state.
- **CRITICAL — single always-on instance, not just cold-start tuning.**
  `min_instance_count = max_instance_count = 1` **and** `cpu_always_allocated =
  true`. This is a harder constraint than the usual "avoid cold starts" pattern:
  Wallos's SQLite database has no multi-writer support (so `max = 1` is required),
  and its baked-in cron daemon only fires scheduled tasks while an instance is
  actually running with allocated CPU (so `min = 1` and `cpu_always_allocated =
  true` are both required). Scaling to zero silently stops every scheduled task
  with no error — renewal notifications simply stop arriving.
- **Default login is `admin` / `admin`.** Wallos seeds this credential on first
  boot. Change it in the web UI immediately after deploy.
- **Ingress defaults to `all` (public).** The service is reachable from the public
  internet out of the box. To restrict it, set `ingress_settings = "internal"`
  (VPC-only) or `internal-and-cloud-load-balancing`, or front it with the HTTPS load
  balancer (`enable_cloud_armor = true` + `application_domains`).
- **No Redis, no init job.** `enable_redis = false` and no `db-init` job runs; the
  app is ready as soon as the container starts.
- **Container port 80.** Wallos serves plain HTTP/1.1 on port 80
  (`container_protocol = http1`).
- **Prebuilt image.** `bellamy/wallos` is a genuine, third-party-maintained
  "latest"-tagged image (there is no official Wallos-project image); no Dockerfile
  or Cloud Build step is used.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Wallos service

Wallos runs as a Cloud Run v2 service pinned to a single, always-allocated
instance. Each deployment creates an immutable revision; traffic can be split
across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~wallos"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — persistent state (GCS FUSE)

Wallos has no Cloud SQL database. Its embedded SQLite database
(`/var/www/html/db/wallos.db`) and its user-uploaded provider logos
(`/var/www/html/images/uploads/logos`) live in **two separate** Cloud Storage
buckets, each mounted into the container via GCS FUSE (requires the `gen2`
execution environment).

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
  gcloud storage ls gs://<db-bucket>/               # bucket name is in the Outputs
  gcloud storage ls gs://<db-bucket>/wallos.db      # the SQLite DB object
  gcloud storage ls gs://<uploads-bucket>/          # user-uploaded logo files
  ```

See [App_CloudRun](App_CloudRun.md) for GCS FUSE and CMEK options.

### C. Secret Manager

Wallos generates **no application secrets** — there is no encryption key or JWT
secret to manage, because all identity state lives in the SQLite database. Secret
Manager is still used by the foundation for platform-managed secrets (e.g. CI/CD
tokens if configured).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~wallos"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service's ingress defaults to **`all`** — reachable from the public internet out
of the box. To restrict it, set `ingress_settings = "internal"` (VPC-only), or layer
an external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies. Since Wallos's cron daemon runs
in-process, its scheduled-task activity (or failures) is visible only in the
container logs — there is no separate Cloud Run Job to inspect.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Wallos Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no Cloud SQL
  instance. On first start Wallos creates its SQLite database at
  `/var/www/html/db/wallos.db` (on the GCS FUSE mount) if it does not already exist
  and seeds the default `admin`/`admin` user.
- **State persistence.** Subscriptions, categories, settings, and users live
  entirely in `/var/www/html/db/wallos.db`. Because that file is on the persistent
  `db` GCS bucket, it survives restarts and redeploys. Custom provider logos
  persist separately on the `uploads` bucket.
- **Default credentials must be changed.** The seeded `admin`/`admin` login is
  well-known. Log in and change the password (and ideally the username) in the web
  UI immediately after the first deploy.
- **Single-writer constraint.** The embedded SQLite database does not support
  concurrent writers across instances on a GCS FUSE mount. Keep
  `max_instance_count = 1`; scaling out risks corrupting the database.
- **Always-on cron daemon — not request-triggered.** Wallos's 8 baked-in scheduled
  tasks (exchange-rate refresh, renewal notifications, an email-verification poll
  every 2 minutes, etc.) run inside the same container continuously. This is why
  `min_instance_count = 1` and `cpu_always_allocated = true` are both required —
  under request-based (throttled) billing or scale-to-zero, these tasks would
  either stall or never run.
- **Health path.** Startup and liveness probes target **`/`** — Wallos's
  unauthenticated login page. `bellamy/wallos` documents no dedicated `/health`
  endpoint, so this is a coarse readiness signal (verify at first deploy):
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"    # 200 once the server is up
  ```
- **No Redis.** `enable_redis = false`; Wallos is a self-contained app with no
  queue or cache beyond its own cron daemon.
- **Inspect the running revision's env and mounts:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Wallos are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `wallos` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Wallos` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Wallos image tag — `bellamy/wallos:latest` is a genuine "latest" release, not a pinned build artifact. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision supporting infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; covers php-fpm workers plus the always-running cron daemon. |
| `min_instance_count` | `1` | **CRITICAL — must stay `1`.** The cron daemon only fires while an instance is running. |
| `max_instance_count` | `1` | **CRITICAL — must stay `1`.** SQLite on GCS FUSE cannot take concurrent writers. |
| `container_port` | `80` | Wallos's HTTP/1.1 listener. |
| `container_protocol` | `http1` | Wallos serves plain HTTP/1.1. |
| `execution_environment` | `gen2` | Required for the GCS FUSE mounts. |
| `enable_cloudsql_volume` | `false` | Wallos has no Cloud SQL; leave `false`. |
| `enable_image_mirroring` | `true` | Mirror the Wallos image into Artifact Registry (avoids Docker Hub rate limits). |
| `container_image_source` | `prebuilt` | **Must stay forwarded to the foundation** — `bellamy/wallos` needs no build step; App_CloudRun's own default (`custom`) would otherwise silently win. |
| `cpu_always_allocated` | `true` | **CRITICAL — must stay `true`.** The cron daemon needs CPU between requests to actually execute its scheduled tasks. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | **Default is public.** Set `internal` to restrict to VPC-only access, or `internal-and-cloud-load-balancing` behind a Load Balancer. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Wallos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Wallos uses none by default. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **not applicable** to Wallos (no SQL database).
Leave at defaults.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the Wallos `db` and `uploads` buckets (and any extra `storage_buckets`). |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `db`/`uploads` buckets. |
| `enable_nfs` | `false` | NFS is off by default; not needed for Wallos. |
| `gcs_volumes` | `[]` | Extra GCS FUSE mounts. The `db` and `uploads` buckets are added automatically. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

Not applicable — Wallos has no SQL database. `database_type` is fixed to `NONE`
by `Wallos_Common`, and `database_password_length`, the `db_*_env_var_name`
inputs, and password rotation are forwarded only for foundation compatibility.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job. Provide jobs only for custom data loading/migration. |
| `cron_jobs` | `[]` | Additional Cloud Scheduler + Cloud Run jobs — separate from Wallos's own 8 in-container scheduled tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | Startup probe; no dedicated `/health` endpoint is documented for this image. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe on the unauthenticated login page. |
| `uptime_check_config` | disabled, path `/health` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `wallos_url` | URL of the Wallos web UI (port 80). VPC-internal when `ingress_settings = internal`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (`db` and `uploads`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any init jobs (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with GCS FUSE mounts, `min_instance_count > max_instance_count`, out-of-range timeouts. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `min_instance_count` | `1` | Critical | Scaling to zero silently stops Wallos's cron daemon — renewal notifications and every other scheduled task stop firing, with no error anywhere. |
| `max_instance_count` | `1` | Critical | >1 puts concurrent writers on SQLite over GCS FUSE, corrupting the database. |
| `cpu_always_allocated` | `true` | Critical | `false` throttles CPU to near-zero between requests, starving the cron daemon of the CPU cycles it needs to run scheduled tasks. |
| `db` / `uploads` GCS buckets | Never delete | Critical | The embedded SQLite DB and custom logos live here; deleting either bucket destroys that state permanently. |
| `admin` / `admin` (seeded login) | Change on first login | Critical | Leaving the default credential lets anyone who can reach the service take full control. |
| `ingress_settings` | `all` (or `internal` to restrict) | High | Default `all` exposes the service to the public internet — pair with IAP or Cloud Armor if that's not desired; set `internal` for VPC-only access. |
| `container_port` | `80` | High | Wallos listens on 80; a different port makes the startup probe fail and the revision never becomes Ready. |
| `startup_probe` / `liveness_probe` path | `/` | Medium | No dedicated `/health` endpoint is documented for `bellamy/wallos` — if the app ever gates its root path behind auth, the probe path needs adjusting. |
| `container_image_source` | `prebuilt` (forwarded) | High | If not forwarded, App_CloudRun's own default (`custom`) silently wins and triggers a from-source Kaniko build against an image with no Dockerfile — the deploy fails. |
| `enable_cloudsql_volume` | `false` | Medium | Wallos has no Cloud SQL; enabling adds a useless Auth Proxy sidecar. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount the GCS FUSE volumes, so state is not persisted. |
| `db`/`uploads` volume-shadowing | Verify at first deploy | High | If `bellamy/wallos` seeds any default assets inside `/var/www/html/db` or `/var/www/html/images/uploads/logos`, mounting a fresh empty bucket over that exact path hides them on first boot — this was not confirmed either way during research. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Wallos-specific application configuration
shared with the GKE variant is described in
**[Wallos_Common](Wallos_Common.md)**.
