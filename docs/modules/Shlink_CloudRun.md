---
title: "Shlink on Google Cloud Run"
description: "Configuration reference for deploying Shlink on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Shlink on Google Cloud Run

Shlink is a self-hosted, open-source URL shortener with detailed visit analytics, QR code generation, and a full REST API. This module deploys Shlink on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Shlink uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Shlink runs as a PHP (RoadRunner) container on Cloud Run v2. The deployment wires together a deliberately small set of Google Cloud services — Shlink keeps **all** of its state in PostgreSQL, so there is no NFS share or object-storage bucket to manage:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | 1 vCPU / 512 MiB by default, scale-to-zero (`min_instance_count = 0`) |
| Database | Cloud SQL for PostgreSQL 15 | Required — holds short URLs, visits, tags, and API keys |
| DB connectivity | Cloud SQL Auth Proxy (Unix socket) | `enable_cloudsql_volume = true`; libpq-friendly socket, no public IP |
| Secrets | Secret Manager | Database password + auto-generated `INITIAL_API_KEY` |
| Cache / locks | Redis (optional) | Disabled by default; only useful for multi-instance caching/locking |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the supported engine** (`database_type = "POSTGRES_15"`, `DB_DRIVER = "postgres"`). Shlink connects through the Cloud SQL Auth Proxy Unix socket — libpq accepts the socket directory as its host, so no TCP/SSL configuration is needed.
- **`DB_USER` / `DB_NAME` are injected by the foundation** with tenant-scoped names and deliberately *not* set by the module — the `db-init` job creates that same user and database, so everything lines up automatically.
- **`INITIAL_API_KEY` is auto-generated** (32 characters), stored in Secret Manager, and injected as a secret env var. Shlink reads it on first start to bootstrap its first REST API key — you never create a key by hand.
- **Migrations run automatically on container start.** The official image handles schema install and upgrades; no separate migrate step exists.
- **Scale-to-zero by default.** Shlink is a stateless request/response app (redirects + REST API); it costs nothing when idle. The trade-off is a ~5–15 s cold start on the first request after idling.
- **Health probes target `/rest/health`** — a public, unauthenticated endpoint that returns HTTP 200 with `{"status":"pass"}`. Shlink has **no web homepage**; `/` returns 404 by design.
- **`DEFAULT_DOMAIN` is left empty** because the `run.app` URL is not known until after deploy — set it post-deploy so generated short URLs use the right host. `IS_HTTPS_ENABLED=true` is pre-set.
- The **database password** is generated automatically and stored in Secret Manager, injected as `DB_PASSWORD`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Shlink service

Shlink runs as a Cloud Run v2 service that autoscales by request load between the minimum (0) and maximum (3) instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Shlink stores everything — short URLs, visit records, tags, domains, and API keys — in a managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy a `db-init` Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Secret Manager

Two secrets are managed automatically: the **database password** (created by the foundation, injected as `DB_PASSWORD`) and the **initial API key** (created by `Shlink_Common`, injected as `INITIAL_API_KEY`). Plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~shlink"
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~shlink AND name~initial-api-key' --format='value(name)' --limit=1)" \
    --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Redis (optional)

Shlink can use Redis for caching and distributed locks — worthwhile only when running several instances concurrently. It is **disabled by default** (`enable_redis = false`); a single-digit `max_instance_count` deployment works fine without it.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain (the natural fit for a branded short domain such as `s.example.com`), Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring. An uptime check against `/rest/health` is provisioned by default, with a check-failure alert wired to `support_users`.

- **Console:** Logging → Logs Explorer; Monitoring → Uptime checks / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Shlink Application Behaviour

- **First-deploy database setup.** A `db-init` Job (image `postgres:15-alpine`) connects to Cloud SQL via the Auth Proxy socket and idempotently creates the application user and database, grants privileges (including `GRANT <user> TO postgres` so ownership can be set), and signals the proxy sidecar to shut down so the Job completes. The job runs on every apply and is safe to re-run.
- **Migrations on start.** Shlink's official image runs its database migrations automatically on every container start — first boot installs the schema, upgrades apply schema changes with no manual step. The startup probe allows up to ~300 s (`failure_threshold = 30` × 10 s) for first-boot migrations.
- **API-first — no homepage.** Shlink is a headless server: `/` returns **404 by design**. Everything is driven through the REST API (`/rest/v3/...`) using the `X-Api-Key` header, or through a separately hosted [shlink-web-client](https://app.shlink.io/) UI pointed at this server.
- **First-run access.** Retrieve the bootstrap API key from Secret Manager (see §2C) and use it immediately:
  ```bash
  API_KEY=$(gcloud secrets versions access latest --secret=<initial-api-key-secret> --project "$PROJECT")
  curl -s -X POST "<service-url>/rest/v3/short-urls" \
    -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
    -d '{"longUrl": "https://cloud.google.com/run"}'
  ```
- **`DEFAULT_DOMAIN` after deploy.** Shlink embeds its public host into every generated short URL. The service URL is unknown at plan time, so `DEFAULT_DOMAIN` ships empty — set it (via the `environment_variables` input on an Update) to the `run.app` hostname or your custom short domain once known.
- **Geolocation is opt-in.** Visit geolocation needs a MaxMind GeoLite2 license: set `GEOLITE_LICENSE_KEY` in `environment_variables`. Without it, visits are still recorded — just not geolocated.
- **Scaling constraints.** Instances are stateless (all state in PostgreSQL), so scale-out is safe. If you raise `max_instance_count` well beyond the default 3 and rely on Shlink's cached counters/locks, enable Redis (`enable_redis = true`).
- **Health verification:**
  ```bash
  curl -s "<service-url>/rest/health"
  # {"status":"pass","version":"...","links":{...}}
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Shlink are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `shlink` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Shlink` | Friendly name shown in the Console. |
| `application_version` | `stable` | Shlink image version tag (e.g. `4.4.0`); increment to trigger a new build. |
| `admin_username` | `shlink` | **Not used by Shlink** (it authenticates with API keys, not admin accounts). Retained for interface parity. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance — 1 vCPU comfortably serves redirects and API calls. |
| `memory_limit` | `512Mi` | Memory per instance (gen2 minimum). |
| `min_instance_count` | `0` | **Scale-to-zero.** Costs nothing idle; first request after idle takes a ~5–15 s cold start. Set `1` for latency-sensitive links. |
| `max_instance_count` | `3` | Maximum instances. Enable Redis before raising this significantly. |
| `container_port` | `8080` | Shlink's native HTTP port. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix socket — the libpq-friendly connection Shlink expects. |
| `enable_image_mirroring` | `true` | Mirrors the image into Artifact Registry to avoid Docker Hub rate limits. |
| `execution_environment` | `gen2` | Cloud Run gen2 (recommended). |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text env vars. Notable Shlink options: `DEFAULT_DOMAIN` (public short-URL host — set post-deploy), `GEOLITE_LICENSE_KEY` (MaxMind key for visit geolocation). `DB_DRIVER=postgres`, `DB_PORT=5432`, `IS_HTTPS_ENABLED=true` are injected automatically. |
| `secret_environment_variables` | `{}` | Extra Secret Manager references. `DB_PASSWORD` and `INITIAL_API_KEY` are wired automatically. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Access & Ingress Control

Standard IAP / ingress / VPC egress inputs (`enable_iap`, `ingress_settings`, `vpc_egress_setting`). Note that a shortener's redirect endpoints must stay publicly reachable — IAP in front of Shlink also gates every short link. All other inputs follow standard App_CloudRun behaviour.

### Groups 7–10 — Backup, CI/CD, Custom SQL, Domain & CDN

Standard App_CloudRun behaviour (`backup_schedule`, `enable_cicd_trigger`, `enable_binary_authorization`, `enable_custom_sql_scripts`, `application_domains`, `enable_cdn`, `enable_cloud_armor`, image-retention inputs). `application_domains` is where a branded short domain is attached. All inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Shlink stores all data in PostgreSQL — no shared filesystem is needed. |
| `create_cloud_storage` / `gcs_volumes` | off / `[]` | No buckets are provisioned; Shlink needs none. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Shlink's supported Cloud SQL engine here — do not change. |
| `db_name` | `shlink` | Base database name (tenant-prefixed by the foundation). Immutable after first deploy. |
| `db_user` | `shlink` | Base application user (tenant-prefixed). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_password_env_var_name` | `DB_PASSWORD` | Pre-set — Shlink reads `DB_PASSWORD` directly. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/rest/health`, 30 s initial delay, `failure_threshold = 30` | Allows up to ~300 s for first-boot migrations. |
| `liveness_probe` | HTTP `/rest/health`, 30 s delay, period 30 s | `/rest/health` is unauthenticated, so liveness stays enabled. |
| `uptime_check_config` | disabled, path `/rest/health` | Cloud Monitoring uptime check + failure alert. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional caching/locking for multi-instance setups; unnecessary at the default scale. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis endpoint details when enabled. |

### Group 22 — VPC Service Controls & Audit Logging

Standard App_CloudRun behaviour (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging`).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `health_check_url` | `<service_url>/rest/health` — curl it to confirm the deployment is live (Shlink has no homepage; `/` 404s). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user (tenant-scoped). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty — Shlink needs none). |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Shlink is wired for PostgreSQL here (`DB_DRIVER=postgres`); another engine breaks startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all short URLs and visit data. |
| `environment_variables` `DB_USER` / `DB_NAME` | never set manually | Critical | Overrides the foundation's tenant-scoped names → `password authentication failed for user "shlink"`. Leave them unset. |
| `container_port` | `8080` | Critical | Shlink's native port; mismatching it fails all health probes. |
| `enable_cloudsql_volume` | `true` | Critical | Shlink expects the Auth Proxy Unix socket; disabling it breaks the DB connection path. |
| probe / uptime `path` | `/rest/health` | High | `/` returns **404 by design** — probing it kills healthy revisions. |
| `startup_probe` failure_threshold | `30` | High | Reducing it can kill the container before first-boot migrations complete. |
| `DEFAULT_DOMAIN` | set post-deploy | High | Left empty, generated short URLs may carry the wrong host; set it to the `run.app` or custom domain. |
| `enable_iap` | `false` for public links | High | IAP in front of Shlink gates every short-link redirect behind Google sign-in. |
| `max_instance_count` w/o Redis | `3` | Medium | Many instances without Redis lose shared caching/locking; enable `enable_redis` before scaling wide. |
| `min_instance_count` | `0` (default) or `1` | Medium | `0` is near-free but adds a ~5–15 s cold start to the first redirect after idle. |
| `GEOLITE_LICENSE_KEY` | set if analytics matter | Low | Without it visits are recorded but not geolocated. |
| `enable_nfs` / `create_cloud_storage` | `false` / off | Low | Wasted cost — Shlink keeps all state in PostgreSQL. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Shlink-specific application configuration shared with the GKE variant is described in **[Shlink_Common](Shlink_Common.md)**.
