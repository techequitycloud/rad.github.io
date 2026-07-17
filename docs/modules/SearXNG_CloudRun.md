---
title: "SearXNG on Google Cloud Run"
description: "Configuration reference for deploying SearXNG on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# SearXNG on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SearXNG_CloudRun.png" alt="SearXNG on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SearXNG is a privacy-respecting, self-hosted metasearch engine that aggregates
results from 70+ search services without tracking users or serving ads. This module
deploys SearXNG on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services SearXNG uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

SearXNG runs as a lightweight Python/Flask container on Cloud Run v2. The
deployment wires together a minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python/Flask service, 1 vCPU / 512 MiB by default, request-based autoscaling |
| Cache / rate limiting | Redis | Optional — disabled by default; enables rate limiting and bot detection |
| Secrets | Secret Manager | Auto-generated `SEARXNG_SECRET` (session key) injected at runtime |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** SearXNG is fully stateless — it aggregates
  search results at request time and stores nothing.
- **No NFS or Cloud Storage is provisioned.** SearXNG has no uploads or shared
  files.
- **`min_instance_count` is fixed at 0 (scale-to-zero).** SearXNG cold starts are
  fast (under 5 seconds) because no database connections or migrations are
  performed on startup.
- **Redis is disabled by default.** For public-facing deployments, enable Redis
  to activate rate limiting and bot detection against upstream engine abuse.
- **`SEARXNG_SECRET` is generated automatically** and stored in Secret Manager.
  The same key is shared across all running instances — do not override it with a
  per-instance random value.
- **Health probes target `/healthz`.** SearXNG's built-in health endpoint returns
  200 when the application is ready.
- **`vpc_egress_setting` defaults to `PRIVATE_RANGES_ONLY`.** SearXNG must reach
  external search engines; ensure a Cloud NAT gateway is configured or switch to
  `ALL_TRAFFIC`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the SearXNG service

SearXNG runs as a Cloud Run v2 service that autoscales by request load, scaling
to zero when idle. Each deployment creates an immutable revision; traffic can be
split across revisions for safe rollouts.

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

### B. Redis cache (optional)

When `enable_redis = true`, SearXNG uses Redis for per-IP rate limiting and bot
detection. This is strongly recommended for public-facing deployments to prevent
upstream search engine API quota exhaustion. When `redis_host` is left empty and
Redis is enabled, the module defaults to `127.0.0.1`.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### C. Secret Manager — SEARXNG_SECRET

`SearXNG_Common` auto-generates the `SEARXNG_SECRET` session key and stores it in
Secret Manager. This key signs SearXNG's session cookies and HMAC query
parameters; all instances must share the same value. It is injected into the
service at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity to external search engines.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. SearXNG Application Behaviour

- **Fully stateless.** SearXNG fetches results from external search engines at
  request time and stores nothing locally. No database migrations or
  initialisation jobs run.
- **No first-deploy setup job.** Because there is no database, the deployment
  completes without a db-init step — the service is ready as soon as the container
  starts.
- **`SEARXNG_SECRET` is stable.** The session key is generated once and persists
  in Secret Manager across service revisions. Rotating it invalidates all active
  user sessions; avoid rotation in production unless required for security.
- **`SEARXNG_BIND_ADDRESS` is injected automatically** as `0.0.0.0:8080` so
  SearXNG listens on all interfaces at its native port.
- **`ENABLE_REDIS` and `REDIS_URL` are injected automatically** when
  `enable_redis = true`. The URL is derived from `redis_host` and `redis_port`.
- **Health path.** Both the startup and liveness probes target `/healthz` (HTTP
  GET), which SearXNG answers once the application is fully initialised.
- **Fast cold starts.** SearXNG starts in under 5 seconds — no database
  connections or schema migrations. The startup probe uses a 10-second initial
  delay.
- **VPC egress for external engines.** SearXNG fetches results from upstream
  search services over the internet. Ensure the VPC connector's egress is not
  restricted to private ranges only, or configure Cloud NAT for internet access.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for SearXNG are listed; every other input is
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
| `application_name` | `searxng` | Base name for resources. Do not change after first deploy. |
| `display_name` | `SearXNG Search` | Friendly name shown in the Console. |
| `description` | `SearXNG — privacy-respecting metasearch engine on Cloud Run` | Service description. |
| `application_version` | `latest` | SearXNG image tag; pin to a specific version for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. 1 vCPU handles moderate SearXNG traffic. |
| `memory_limit` | `512Mi` | Memory per instance. Scale to `1Gi` for high-traffic public instances. |
| `max_instance_count` | `3` | Maximum instances (cost ceiling). |
| `container_port` | `8080` | SearXNG's native HTTP port. |
| `execution_environment` | `gen2` | Gen2 recommended for faster startup and improved networking. |
| `timeout_seconds` | `60` | Max request duration. Slow upstream engines may require raising to 120–300. |
| `container_image_source` | `prebuilt` | Use the official SearXNG image (`prebuilt`) or build from source (`custom`). |
| `cpu_always_allocated` | `false` | Request-based billing — SearXNG is a stateless search proxy with no in-process background work, so CPU is only needed while serving a request. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry before deployment. |
| `enable_cloudsql_volume` | `false` | **Leave false** — SearXNG does not use a database. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. Use `internal` for private deployments. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. Set `ALL_TRAFFIC` if Cloud NAT is not configured. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy (internal deployments). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="", SEARXNG_BIND_ADDRESS="0.0.0.0:8080" }` | Extra settings. `ENABLE_REDIS` and `REDIS_URL` are also injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name for additional secrets (e.g., upstream engine API keys). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

SearXNG is stateless — there is no application data to back up. The backup
variables are inherited from the foundation interface but have no practical use.
See [App_CloudRun](App_CloudRun.md).

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL

Not applicable to SearXNG (no database). See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. Recommended for public deployments. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB (Google-managed SSL). |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | SearXNG is stateless — no GCS bucket is required. Leave false. |
| `enable_nfs` | `false` | SearXNG is stateless — NFS is not required. Leave false. |
| `gcs_volumes` | `[]` | GCS Fuse mounts (not used by SearXNG). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — SearXNG does not use a database. Do not change. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | SearXNG requires no initialisation jobs — leave empty. |
| `cron_jobs` | `[]` | Optional scheduled tasks (e.g., cache warming). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | SearXNG's built-in health endpoint; startup allows 10s initial delay. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for rate limiting and bot detection. Recommended for public-facing deployments. |
| `redis_host` | `""` | Redis endpoint. Leave empty to default to `127.0.0.1` when Redis is enabled; set to the Memorystore IP for a managed instance. |
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
| `storage_buckets` | Created Cloud Storage buckets (empty for SearXNG). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub connection details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SEARXNG_SECRET` (auto-generated) | auto-generated | Critical | If overridden with a per-instance random value, each cold start produces a different key, invalidating all existing session cookies. Always use the auto-generated Secret Manager value. |
| `database_type` | `NONE` | Critical | Changing to a real DB type provisions an unused Cloud SQL instance and breaks startup. |
| `vpc_egress_setting` | `ALL_TRAFFIC` or Cloud NAT configured | High | `PRIVATE_RANGES_ONLY` blocks SearXNG's outbound requests to external search engines (Google, Bing, DuckDuckGo, etc.), returning empty results. |
| `enable_redis` | `true` for public deployments | High | Without Redis, SearXNG has no rate limiting; public instances are vulnerable to scraping that exhausts upstream engine quotas. |
| `redis_host` | Memorystore IP or explicit value | High | When `enable_redis = true` and `redis_host = ""`, the module defaults to `127.0.0.1` — there is no sidecar Redis in Cloud Run, so rate limiting is silently disabled. |
| `timeout_seconds` | `60`–`300` | Medium | SearXNG waits for all enabled search engines; slow upstream engines may need up to 30 seconds per request. Too low causes 504 errors before results are aggregated. |
| `application_version` | pinned (not `latest`) | Medium | Using `latest` makes deployments non-reproducible; a new SearXNG release may change config schema. |
| `enable_cloud_armor` | `true` for public deployments | Medium | Without Cloud Armor, there is no WAF/DDoS protection on the public endpoint. |
| `enable_iap` | `true` for internal-only | Medium | For internal search deployments, IAP restricts access to authenticated Google accounts. |
| `ingress_settings` | `all` for public; `internal` for private | Medium | `all` is intentional for a public meta-search engine; combine with Redis rate limiting and Cloud Armor for production. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. SearXNG-specific application configuration
shared with the GKE variant is described in
**[SearXNG_Common](SearXNG_Common.md)**.
