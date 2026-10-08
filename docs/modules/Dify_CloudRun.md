---
title: "Dify on Google Cloud Run"
description: "Configuration reference for deploying Dify on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Dify on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dify_CloudRun.png" alt="Dify on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dify is an open-source LLM application development platform for building production-grade AI
applications with a visual workflow builder, RAG pipeline, agent framework, multi-model
management, and built-in observability. This module deploys Dify on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google
Cloud infrastructure.

This guide focuses on the cloud services Dify uses and how to explore and operate them from the
Google Cloud Console and the command line. For the mechanics common to every Cloud Run application
— service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Dify costs on RAD, and how that compares

**Dify on RAD's Cloud Run module costs about US$102 a month in a Google Cloud project you own, plus a one-time 175-credit module fee (US$17.50).** Dify is a visual builder for production LLM applications, with a RAG pipeline, agent framework and built-in observability. GKE Autopilot suits Dify that must stay up, scale across pods, or run beside other Kubernetes workloads; for the lowest cost, this Cloud Run module is usually the right pick — see the [GKE guide](Dify_GKE.md) if you need the other.

If Dify is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$102 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 175 credits (US$17.50 at the top-up price) | 157.5 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$102 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | US$31.53 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$102** |

### How it compares

- The project's own managed offering, **Dify Cloud**, has a free Sandbox plan, then $590 per workspace a year (about $49 a month) on Professional and $1,590 per workspace a year (about $133 a month) on Team.
- Run it yourself and a VPS running Dify's API, worker and web containers plus PostgreSQL yourself costs less in cash: sized to roughly 2 vCPU/4 GiB, a comparable VPS (Hetzner or DigitalOcean) runs about $24–48 a month, or a GCP `e2-standard-2`-class VM about $49 — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause Dify for free rather than paying for idle capacity (see below).
- Most of the running cost above is the managed PostgreSQL database (and, where used, the shared file server) — the part a bare VPS comparison has to run and back up by hand.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Dify runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits Dify that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud SQL, the VM or Cloud Run resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical Dify chain, against the 180 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$102.** Deploy Dify, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised Dify and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 180 credits (US$18) in your own project. Deleting saves money only once Dify would otherwise sit unused for about 6 days or more, whether in your own project or a RAD-managed one.
- **Most of the running cost is usually the database and the shared file or cache server.** They stop only when nothing else in the project uses them, so deleting Dify while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; [Dify Cloud](https://dify.ai/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

Dify runs as a Python/Flask API container (with an embedded Celery worker under supervisord) plus
a separate Next.js web frontend service. The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 (gen2) | API+worker service (2 vCPU / 4 GiB by default) + web frontend service, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — pgvector extension enabled for vector storage |
| Vector store | pgvector (in-database) | Reuses the Cloud SQL instance; no separate vector database needed |
| Shared files | Filestore (NFS) | Provides the default Redis host (NFS server VM co-hosts Redis) |
| Object storage | Cloud Storage | A dedicated `storage` bucket (`gcs-dify<tenant-prefix>-storage`) for uploaded files and assets |
| Cache & task queue | Redis | Required for Celery broker/backend and SSE/WebSocket LLM streaming |
| Secrets | Secret Manager | Auto-generated SECRET_KEY and database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** MySQL and `NONE` are not supported; Dify requires PostgreSQL
  for all metadata, workflow state, and user accounts.
- **pgvector is always enabled.** The `vector` extension is installed on the Cloud SQL instance
  automatically, making the same database instance the vector store — no extra service required.
- **Redis is required.** Celery (workflow execution, document indexing, async LLM calls) and the
  SSE/WebSocket event bus both depend on Redis. Disabling it breaks all background processing.
- **NFS is enabled by default.** The NFS server VM hosts the Redis process when no external Redis
  host is set. Requires gen2 execution environment.
- **A web frontend service is deployed automatically.** A `langgenius/dify-web` Cloud Run service
  is wired to the API service URL — you do not need to configure it separately. Access Dify
  through the `web_url` output.
- **SECRET_KEY is auto-generated** and stored in Secret Manager; it signs Dify sessions and must
  never be changed after first deployment.
- **Database migrations run on every instance start** (via `MIGRATION_ENABLED=true`), so version
  upgrades apply schema changes automatically.
- **gen2 execution environment is required** for NFS mounts and GCS Fuse volumes.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Dify services

Dify runs as two Cloud Run v2 services: the API+worker service (Flask/gunicorn + Celery via
supervisord) and the web frontend (Next.js). Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the API service or the web service for revisions, traffic,
  logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Dify stores all application data (workflows, knowledge bases, user accounts, API keys) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through the
**Cloud SQL Auth Proxy** over a Unix socket — no public IP is exposed. On first deploy an
initialization Job creates the application database and user. The `pgvector` extension is
installed automatically so the same instance serves as the vector store.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See
[App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

### C. Filestore (NFS) and Cloud Storage

A **Filestore (NFS)** share is mounted into the service. The NFS server VM also runs the Redis
process used as the Celery broker when no external Redis host is configured. A dedicated **Cloud
Storage** bucket (`gcs-dify<tenant-prefix>-storage`) is provisioned for uploaded files and assets; Dify's
`google-storage` driver accesses it via the Cloud Run service identity — no service account key
file is needed.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis — Celery and event bus

Redis is required for three functions in Dify:

| Role | Redis DB | Purpose |
|---|---|---|
| Celery broker & backend | db 1 | Queues and tracks all background tasks (LLM inference, document indexing) |
| Event bus | db 0 | SSE/WebSocket streaming for real-time LLM output |
| General cache | db 0 | Application caching |

When no external Redis host is configured, the NFS server VM IP is used as the Redis endpoint.
For production, point `redis_host` at a dedicated Memorystore for Redis instance.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Dify `SECRET_KEY` (used for JWT signing and session encryption) and the database password
are stored in Secret Manager and injected into the service at runtime. The `SECRET_KEY` is
generated once and must not be rotated while the deployment is running.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The API service is reachable at its `run.app` URL by default; open the `web_url` output in a
browser for the Dify console. An external HTTPS load balancer with a custom domain, Cloud CDN,
and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Dify Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) connects to Cloud SQL via
  the Auth Proxy and idempotently creates the Dify database user and database. It runs
  automatically on first deploy and is safe to re-run.
- **Migrations on start.** Each instance runs Dify's Flask-Migrate database migrations on startup
  (`MIGRATION_ENABLED=true`), so upgrading the application version applies schema changes
  automatically. No separate migration job is needed.
- **API + worker in one container.** The custom container wraps `langgenius/dify-api` with
  supervisord. Both the gunicorn API server (port 5001) and the Celery worker run inside the same
  container — they share the CPU and memory allocation. Size accordingly: 2 vCPU and 4 GiB is
  the recommended minimum.
- **Web frontend.** A `langgenius/dify-web` Cloud Run service is deployed automatically and wired
  to the API service's computed (predicted) Cloud Run URL via `CONSOLE_API_URL`/`APP_API_URL`.
  Access Dify through the `web_url` output.
- **LLM provider API keys.** Provider keys (OpenAI, Anthropic, etc.) are configured per-workspace
  via the Dify web console and stored in the application database. Use
  `secret_environment_variables` only for environment-level configuration that cannot be set in
  the UI.
- **CORS.** `WEB_API_CORS_ALLOW_ORIGINS` and `CONSOLE_CORS_ALLOW_ORIGINS` default to `"*"`.
  Restrict to your domain via `environment_variables` in production.
- **Health path.** Startup and liveness probes target `/health` with a 30-second initial delay.
  Both HTTP probes work correctly on Cloud Run because the Dify API serves port 5001 without
  TLS/redirect complications (unlike PHP-based apps). The startup probe allows up to 30 × 10 =
  300 seconds for first-boot setup.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for Dify are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `dify` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Dify - LLM Application Platform` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `0.15.0` | Dify image version tag; applies to both API and web containers. Pin to a specific version in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU minimum — gunicorn and Celery share this allocation. |
| `memory_limit` | `4Gi` | Memory per instance; 4 GiB recommended for LLM workflow caching and document processing. |
| `min_instance_count` | `0` | Minimum instances (scale-to-zero). Set ≥ 1 so the Celery worker maintains its Redis broker connection. |
| `max_instance_count` | `3` | Maximum instances. Acts as a cost ceiling. |
| `cpu_always_allocated` | `false` | Cost-first cold-start default (request-based billing, paired with `min_instance_count=0`): CPU is billed only while serving a request. Trade-off — Celery async pipelines (dataset embedding, scheduled/batch jobs) stop while scaled to zero; interactive chat and apps still work on-request. Set `true` together with `min_instance_count >= 1` to restore continuous operation. |
| `container_port` | `5001` | Dify API server listens on port 5001. |
| `execution_environment` | `gen2` | **Required** — gen2 is needed for NFS mounts and GCS Fuse. |
| `timeout_seconds` | `300` | Max request duration. Increase to `3600` for long-running LLM workflows. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. Required for database connectivity. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. All entries must sum to 100. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` (public), `internal`, or `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Routes only RFC 1918 traffic via the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Use to override `WEB_API_CORS_ALLOW_ORIGINS`, `LOG_LEVEL`, etc. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for LLM provider API keys. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

### Group 7 — Backup & Restore

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

### Group 9 — NFS Instance & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md). |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume; also provides the default Redis host. Requires gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. The `storage` bucket (`gcs-dify<tenant-prefix>-storage`) is always provisioned. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Required — do not change. Dify supports PostgreSQL only. |
| `db_name` | `dify_db` | Database name. **Immutable after first deploy.** |
| `db_user` | `dify_user` | Application user. **Immutable after first deploy.** |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(set)_ | Names under which connection details are injected (optional overrides). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Provide a non-empty list to replace it entirely. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, 30 s delay | Startup probe — container receives no traffic until `/health` returns 200. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Liveness probe. |
| `uptime_check_config` | disabled, path `/health` | Cloud Monitoring uptime check; set `enabled = true` to provision it. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required.** Enables Redis for Celery task queue and SSE/WebSocket streaming. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set for an external Memorystore instance. |
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
| `service_name` | Cloud Run service name (Dify API). |
| `web_url` | URL of the Dify web frontend — open this in a browser to access the Dify console. |
| `api_url` | URL of the Dify API service (consumed by the web UI and external integrations). |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_redis` | `true` (required) | Critical | All Celery tasks (workflow execution, document indexing, async LLM calls) fail silently without Redis. |
| `enable_cloudsql_volume` | `true` (required) | Critical | The Auth Proxy sidecar is the only path to PostgreSQL; disabling it breaks all database connectivity. |
| `SECRET_KEY` (auto-generated) | immutable once set | Critical | All instances must share the same key; rotating it logs out all users and invalidates active sessions. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the database and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `secret_environment_variables` for LLM keys | always use secret refs | Critical | Plain env vars expose API keys in Cloud Run revision metadata visible in the Console. |
| `enable_redis` + `enable_nfs` | both `true` if no external Redis | Critical | Without NFS, there is no Redis host when `redis_host` is empty — Celery fails to start. |
| `redis_host` | correct host | High | Incorrect host produces a malformed Celery broker URL; all async tasks queue indefinitely. |
| `database_type` | `POSTGRES_15` | High | Dify requires PostgreSQL; any other engine fails startup. |
| `memory_limit` | `4Gi` | High | Too little memory causes OOM kills during document ingestion or LLM workflow caching. |
| `min_instance_count` + `cpu_always_allocated` | ship `0` / `false` (cost-first); set `1`+ / `true` for continuous Celery | High | The shipped defaults are a deliberate cost-first choice, not an oversight: scale-to-zero abandons in-flight Celery tasks (dataset embedding, scheduled/batch jobs) while the service is idle. Interactive chat and apps still work on-request. Override both settings together to restore continuous background processing. |
| `timeout_seconds` | `300` (raise for workflows) | High | Multi-step workflows and RAG indexing can exceed 300 s; increase to `3600` for complex deployments. |
| `execution_environment` | `gen2` | High | gen1 does not support NFS mounts or GCS Fuse. |
| `WEB_API_CORS_ALLOW_ORIGINS` | restrict in production | High | Default `"*"` allows cross-origin requests from any domain. |
| `application_version` | pin to a specific version | Medium | Unpinned versions risk unexpected schema migrations that break the application on redeploy. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | The Dify console is publicly reachable without these controls. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency,
ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Dify-specific application
configuration shared with the GKE variant is described in **[Dify_Common](Dify_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Dify on Cloud Run](../labs/Dify_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Dify on GKE Autopilot](Dify_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Dify Common — Shared Application Configuration](Dify_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [LiteLLM on Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant on Google Cloud Run](Qdrant_CloudRun.md), [Crawl4AI on Google Cloud Run](Crawl4AI_CloudRun.md), [Langfuse on Google Cloud Run](Langfuse_CloudRun.md) in the **AI Application Builder** solution.
