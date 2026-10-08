---
title: "Crawl4AI on Google Cloud Run"
description: "Configuration reference for deploying Crawl4AI on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Crawl4AI on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Crawl4AI_CloudRun.png" alt="Crawl4AI on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Crawl4AI is an open-source LLM-friendly web crawler and scraper. This module
deploys Crawl4AI on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Crawl4AI uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Crawl4AI costs on RAD, and how that compares

**Crawl4AI on RAD's Cloud Run module costs about US$22.33 a month in a Google Cloud project you own, plus a one-time 40-credit module fee (US$4).** Crawl4AI is an open-source, LLM-friendly web crawler and scraper for RAG ingestion pipelines. GKE Autopilot suits Crawl4AI that must stay up, scale across pods, or run beside other Kubernetes workloads; for the lowest cost, this Cloud Run module is usually the right pick — see the [GKE guide](Crawl4AI_GKE.md) if you need the other.

If Crawl4AI is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$22.33 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$22.33 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **3 credits a day**, about 90 a month (about US$9 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 4 GiB (scaleToZero) | US$16.33 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$22.33** |

### How it compares

- Run it yourself and a VPS running Crawl4AI's own container costs less in cash: sized to roughly 1 vCPU/4 GiB, a comparable VPS (Hetzner or DigitalOcean) runs about $24–48 a month, or a GCP `e2-standard-2`-class VM about $49 — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause Crawl4AI for free rather than paying for idle capacity (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Crawl4AI runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits Crawl4AI that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud Run resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical Crawl4AI chain, against the 45 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$22.33.** Deploy Crawl4AI, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised Crawl4AI and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 45 credits (US$4.50) in your own project. Deleting saves money only once Crawl4AI would otherwise sit unused for about 7 days or more in your own project (US$0.74 a day), or about 14 days or more in a RAD-managed one (3 credits a day).
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.

## 1. Overview

Crawl4AI runs as a Python/ASGI container on Cloud Run v2 Gen2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 (Gen2) | Python service, 1 vCPU / 4 GiB by default, request-based autoscaling |
| Task queue | Embedded Redis (in-container) | Supervisord starts Redis inside the container; ephemeral per instance |
| ASGI server | Embedded Gunicorn (in-container) | Port 11235, managed by supervisord alongside Redis |
| Object storage | Cloud Storage | Optional buckets for crawl result caching (none by default) |
| Secrets | Secret Manager | API keys and JWT secret injected at runtime |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No external database.** `database_type` is fixed to `NONE` — Cloud SQL is
  not provisioned. All task state lives in the in-container Redis instance and
  is lost when the container restarts.
- **Gen2 is required.** Supervisord needs a full Linux process tree, and
  Chromium uses `/tmp` for shared memory via `--disable-dev-shm-usage`. Gen1
  cannot support this.
- **`ALL_TRAFFIC` egress is required.** The crawler must reach arbitrary public
  URLs on the internet; `PRIVATE_RANGES_ONLY` blocks all external crawl targets.
- **Redis runs inside the container.** Do not set `REDIS_HOST` or `REDIS_PORT`
  as environment variables — they must stay at `localhost:6379` to reach the
  bundled instance.
- **Security is off by default.** JWT authentication requires providing a
  `SECRET_KEY` via `secret_environment_variables` and a custom `config.yml`
  with `security.jwt_enabled=true`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Crawl4AI service

Crawl4AI runs as a Cloud Run v2 Gen2 service that autoscales by request load
between the minimum and maximum instance counts. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.
Each instance runs its own supervisord tree: Redis (priority 10) starts first,
then Gunicorn (priority 20).

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency,
execution environment, and traffic splitting.

### B. Embedded Redis and task queue

Redis runs inside each container instance as a supervisord-managed process on
`localhost:6379`. It stores task results with a configurable TTL
(`redis_task_ttl_seconds`, default 3600 s). Task results are lost when the
container restarts — this is expected for an ephemeral crawl API. There is no
Memorystore instance; the embedded Redis does not appear in the Console.

There is no direct shell access on Cloud Run, but you can observe Redis
behaviour from logs:

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
  --filter="supervisord" --limit 50
```

### C. Cloud Storage (optional)

Crawl4AI has no default GCS bucket — it is stateless. Optional buckets can be
provisioned via `storage_buckets` to store crawl results or custom
`config.yml` files.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<results-bucket>/
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mounts and CMEK.

### D. Secret Manager

LLM API keys and the JWT signing secret are stored as Secret Manager secrets
and injected into the service at runtime; plaintext never appears in
configuration. Crawl4AI has no auto-generated secrets — all secrets must be
provided via `secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Recognised secret names (pass the Secret Manager secret name, not the value):
`SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`,
`GROQ_API_KEY`, `GEMINI_API_KEY`, `LLM_API_KEY`.

See [App_CloudRun](App_CloudRun.md) for injection and rotation
details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default with
`ingress_settings = "all"`. An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be layered on. VPC egress is set to
`ALL_TRAFFIC` so the crawler can reach arbitrary public URLs.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs (Python output streamed via `PYTHONUNBUFFERED=1`) flow to Cloud
Logging. Cloud Run metrics flow to Cloud Monitoring, with optional uptime
checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Crawl4AI Application Behaviour

- **Supervisord startup sequence.** On every container start, supervisord
  (PID 1) starts Redis first (priority 10), then Gunicorn (priority 20). The
  `/health` endpoint only responds after both processes are ready — allow at
  least 40 seconds of initial delay before health checks start.
- **REST API endpoints.** Crawl4AI exposes:

  | Endpoint | Method | Purpose |
  |---|---|---|
  | `/crawl` | POST | Submit an asynchronous crawl job; returns a `task_id` |
  | `/task/{id}` | GET | Poll status and retrieve results for a task |
  | `/crawl/sync` | POST | Synchronous crawl (blocks until complete) |
  | `/health` | GET | Health check — returns `{"status":"ok"}` when ready |
  | `/playground` | GET | Interactive browser-based crawl UI |

- **Task result lifecycle.** Async crawl results are stored in the embedded
  Redis with a TTL of `redis_task_ttl_seconds` (default 1 hour). After the
  TTL expires the result is gone. There is no durable result store.
- **No database migrations or initialization jobs.** Crawl4AI is fully
  stateless — `Crawl4AI_Common` supplies no initialization job. No database
  setup is required.
- **LLM-based extraction.** Provide LLM API keys via `secret_environment_variables`
  and set `LLM_PROVIDER` (or provider-specific keys such as `OPENAI_API_KEY`)
  via `environment_variables` to enable AI-driven content extraction.
- **JWT authentication (optional).** Security is disabled by default.
  To enable, supply `SECRET_KEY` via `secret_environment_variables` and provide
  a custom `config.yml` with `security.jwt_enabled=true`. The `/token` endpoint
  issues short-lived JWTs when authentication is enabled.
- **`CRAWL4AI_HOOKS_ENABLED` warning.** Setting this variable to `"true"`
  enables arbitrary Python code execution via webhook hooks. Only enable in
  a fully trusted environment.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Crawl4AI are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `crawl4ai` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Crawl4AI Web Crawler` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `0.7.8` | Crawl4AI image version tag; pin to a specific tag for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only without deploying the container. |
| `cpu_limit` | `1000m` | CPU per instance; ~0.5–1 vCPU per active browser context. |
| `memory_limit` | `4Gi` | Memory per instance. Minimum 4 GiB for stable Chromium operation; 8 GiB recommended for concurrent crawls. |
| `min_instance_count` | `0` | Minimum instances. Set to 1 for a warm Chromium pool; default `0` causes 30–60 s cold starts. |
| `max_instance_count` | `3` | Maximum instances (cost ceiling). |
| `cpu_always_allocated` | `false` | Request-based billing — a crawl runs synchronously within its HTTP request with no post-response background work, so CPU throttling between requests is safe. |
| `execution_environment` | `gen2` | **Required** — Gen2 for supervisord's process tree and Chromium's `/tmp` shared memory. |
| `timeout_seconds` | `3600` | Maximum request duration; set to the Cloud Run maximum to allow long batch crawl jobs. |
| `container_protocol` | `http1` | HTTP protocol version. |
| `enable_image_mirroring` | `true` | Mirror the Crawl4AI image to Artifact Registry to avoid Docker Hub rate limits. |
| `traffic_split` | `[]` | Percentage-based canary/blue-green traffic allocation across revisions. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Traffic sources permitted to reach the service. Use `"internal-and-cloud-load-balancing"` when fronted by Cloud Armor. |
| `vpc_egress_setting` | `ALL_TRAFFIC` | **Required** — routes all outbound traffic through the VPC so the crawler can reach arbitrary public URLs. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `enable_cloud_armor` | `false` | Provision a Global HTTPS Load Balancer with Cloud Armor WAF. |
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `PYTHONUNBUFFERED` and `REDIS_TASK_TTL` are set automatically. **Do not set `REDIS_HOST` or `REDIS_PORT`**. Recognised overrides: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_TEMPERATURE`, `CRAWL4AI_HOOKS_ENABLED`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

Not applicable for Crawl4AI — the service is stateless and carries no database.
`backup_schedule`, `backup_retention_days`, and `enable_backup_import` are
present for interface compatibility but have no effect.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Jobs & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Crawl4AI_Common supplies no default init job — leave empty unless a custom setup step is needed. |
| `cron_jobs` | `[]` | Optional recurring Cloud Run Jobs triggered by Cloud Scheduler. |
| `enable_custom_sql_scripts` | `false` | Not applicable for Crawl4AI (no database). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision any buckets listed in `storage_buckets`. |
| `storage_buckets` | `[]` | No buckets by default — Crawl4AI is stateless. Add entries to provision crawl-result buckets. |
| `enable_nfs` | `false` | Provision a Filestore NFS volume. Not required for standard Crawl4AI deployments. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — no Cloud SQL instance is provisioned for Crawl4AI. |

All other database variables (`enable_cloudsql_volume`, `database_password_length`,
etc.) are present for interface compatibility and have no effect.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, 40 s delay | Allow supervisord time to start Redis then Gunicorn before the first probe fires. |
| `health_check_config` / `liveness_probe` | HTTP `/health`, 60 s delay | Liveness probe after startup. |
| `uptime_check_config` | disabled by default, path `/health` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 19 — Crawl4AI Application Settings

| Variable | Default | Description |
|---|---|---|
| `redis_task_ttl_seconds` | `3600` | TTL in seconds for task results in embedded Redis. Valid range: 300–86400. Too short causes results to expire before clients poll; too long causes unbounded memory growth. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs. |
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
| `vpc_egress_setting` | `ALL_TRAFFIC` | Critical | Using `PRIVATE_RANGES_ONLY` blocks all external crawl targets; every crawl to a public URL fails with a connection error. |
| `memory_limit` | `8Gi` | Critical | Below 4 GiB, Chromium processes are OOM-killed mid-crawl returning partial results; below 2 GiB the container fails to start. |
| `REDIS_HOST` / `REDIS_PORT` (env vars) | do not set | Critical | Overriding these breaks the embedded Redis connection; all async crawl jobs fail immediately. |
| `database_type` | `NONE` | Critical | Crawl4AI has no database; changing this causes unnecessary Cloud SQL provisioning and a startup failure. |
| `execution_environment` | `gen2` | High | Gen1 cannot run supervisord's process tree; the service fails to deploy with VPC network configuration. |
| `min_instance_count` | `1` | High | Scale-to-zero (`0`) causes 30–60 s cold starts (supervisord must boot Redis then Gunicorn); the first request typically times out. |
| `cpu_limit` | `4000m` | High | Below 2000m, Chromium rendering triggers internal timeouts on complex pages; crawl throughput drops significantly. |
| `enable_iap` / `enable_cloud_armor` | enable for production | High | With `ingress_settings = "all"`, the API is publicly accessible and anyone can submit crawl jobs consuming cloud resources. |
| `LLM_API_KEY` / provider API keys | via `secret_environment_variables` | High | Missing or expired keys cause LLM-based extraction to fail silently (empty `extracted_content`). Inject as secrets, not plain-text env vars. |
| `redis_task_ttl_seconds` | `3600` | Medium | Too short (< 300 s) causes results to expire before async clients poll; too long causes unbounded memory growth. Valid range: 300–86400. |
| `timeout_seconds` | `3600` | Medium | Deep crawls or LLM extraction of large pages can take several minutes; reduce only for short-lived APIs where zombie requests should be terminated faster. |
| `application_version` | pinned tag | Medium | Using `"latest"` is non-reproducible; a rebuild may pull a breaking Crawl4AI API change. |
| `enable_image_mirroring` | `true` | Low | Crawl4AI images are large; without mirroring, every deployment pulls from Docker Hub and risks rate-limit failures and slow cold starts. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Crawl4AI-specific shared application
configuration is described in **[Crawl4AI_Common](Crawl4AI_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Crawl4AI on Cloud Run](../labs/Crawl4AI_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Crawl4AI on GKE Autopilot](Crawl4AI_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Crawl4AI Common — Shared Application Configuration](Crawl4AI_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Elasticsearch on GKE Autopilot](Elasticsearch_GKE.md), [RAGFlow on GKE Autopilot](RAGFlow_GKE.md), [Qdrant on Google Cloud Run](Qdrant_CloudRun.md), [Paperless-ngx on Google Cloud Run](Paperless_CloudRun.md) in the **Enterprise RAG & Document Intelligence** solution.
