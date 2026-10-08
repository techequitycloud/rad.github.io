---
title: "Activepieces on Google Cloud Run"
description: "Configuration reference for deploying Activepieces on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Activepieces on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Activepieces_CloudRun.png" alt="Activepieces on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Activepieces is an open-source, Apache 2.0-licensed no-code workflow automation
platform for connecting apps, APIs, and data sources. This module deploys
Activepieces on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Activepieces uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Activepieces costs on RAD, and how that compares

**Activepieces on RAD's Cloud Run module costs about US$83 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 75 credits (US$7.50 at the top-up price) in a project you own, and 67.5 credits (10% lower) in a project RAD manages. If Activepieces needs to run continuously across pods or beside other Kubernetes workloads, see the [GKE guide](Activepieces_GKE.md) instead. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$83 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$83 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **37 credits a day**, about 1,110 a month (about US$111 at the top-up price, US$89 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database is shared by every application in the project, so a second application does not add a second one.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (warm) | US$26.28 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$83** |

### How it compares

- Zapier's own Professional plan starts at **$29.99/month** (monthly billing) for 750 tasks and rises with volume — $58.50/month for 1,500 tasks, $73.50/month for 2,000, up to several thousand dollars a month at high volume; its Team plan (which Activepieces' shared, multi-user workspace is closer to) starts at **$103.50/month** for 2,000 tasks/month.
- **RAD runs the open-source project itself, not a vendor's hosted tenancy.** You get the same software, under your own (or RAD's) infrastructure, instead of a per-seat or per-usage subscription that grows independently of what you actually use.
- **Against a bare self-managed server:** Running the same open-source software yourself, a Hetzner CPX22 (2 vCPU/4 GB, about $24/month) or a DigitalOcean 2 vCPU/4 GB Droplet (also $24/month) is roughly the same shape; a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) runs about $49/month. RAD is not cheaper than that in cash terms — the difference is the managed database, Secret Manager and monitoring that come with the module instead of being your own job.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Activepieces runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running Activepieces continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project outright. Google does not remove it immediately: it keeps the project,
  recoverable, for 30 days, and because billing is already unlinked nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project simply stops, and nothing is billed in the
  meantime.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, only the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its billing
  account, then asks you to run **Update** on each deployment to confirm everything came back.
  Because nothing was individually destroyed, that Update finds the same resources already
  there — it is a check, not a rebuild, and an Update never charges the module fee again. This
  costs only a handful of credits in total (under US$1), against paying the module fee and a
  full build again.
- **What this needs.** You must own the project (not one RAD only manages billing for), you
  must restore it yourself within the 30 days — after that Google deletes it for good — and
  restoring is admitted like creating a new project, so your purchased credit balance must
  still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: backups do not survive.** Anything Activepieces writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  80 credits (about US$8) in your own project, or
  72.5 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once Activepieces would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 3 days or more in your own project (US$2.78/day) or 2 days or more in a RAD-managed one (37 credits/day).
- **Most of the running cost is usually shared infrastructure.** The database stops only when nothing else in the project uses them, so deleting Activepieces while another application shares the project saves only Activepieces's own compute part.
- **Keep your data first.** Anything Activepieces writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Activepieces in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Activepieces for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [Zapier pricing](https://zapier.com/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

Activepieces runs as a Node.js container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Activepieces does not support MySQL or other engines |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Cache & queue | Redis (optional) | Required for horizontal scaling; memory queue mode is the default |
| Secrets | Secret Manager | Auto-generated `AP_ENCRYPTION_KEY` and `AP_JWT_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Memory queue mode is the default.** `AP_QUEUE_MODE = MEMORY` means all workflow
  jobs run in-process in a single instance. Scaling beyond one instance requires
  Redis (`enable_redis = true`).
- **`AP_ENCRYPTION_KEY` and `AP_JWT_SECRET` are generated automatically** and stored
  in Secret Manager. These keys must never be rotated after first boot without a
  maintenance window — rotating `AP_ENCRYPTION_KEY` corrupts all stored connection
  credentials, and rotating `AP_JWT_SECRET` invalidates all active user sessions.
- **One instance is kept warm by default** (`min_instance_count = 1`), because
  Activepieces' scheduler runs in-process. Setting it to `0` enables scale-to-zero,
  which adds 5–15 seconds of cold-start latency after idle.
- **Public ingress is required for webhooks.** `ingress_settings = "all"` is the
  default so external services can POST to Activepieces webhook endpoints. Enabling
  IAP will block these external calls.
- **NFS is disabled by default.** Activepieces stores all workflow state in
  PostgreSQL. Enable NFS only if co-locating Redis on the NFS server VM.
- **The `pgvector` extension is installed automatically** during the first-deploy
  database setup job, enabling AI-powered workflow pieces.
- **`AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` are set from the predicted service
  URL at plan time and corrected at runtime** by the container entrypoint, ensuring
  webhook and OAuth redirect URLs always reflect the actual Cloud Run service URL.
- **Scheduled/triggered flows need a warm instance — keep `min_instance_count = 1`.**
  Activepieces ships its own scheduler/worker/cron/queue-style trigger components,
  which only run while an instance exists, so on a scaled-to-zero service (`0`)
  scheduled flows silently never fire. The module therefore defaults to
  `min_instance_count = 1`. Note **this module does not expose
  `cpu_always_allocated`** — it is not declared in `variables.tf` or forwarded to
  the foundation. Lower the minimum to `0` only for webhook-only or interactive use.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Activepieces service

Activepieces runs as a Cloud Run v2 service that autoscales by request load between
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

### B. Cloud SQL for PostgreSQL 15

Activepieces stores all application data (flows, connections, execution history,
users) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is
exposed. On first deploy an initialization Job creates the application database and
user and installs the `pgvector` extension.

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

A dedicated **Cloud Storage** data bucket is provisioned automatically for
Activepieces file storage. Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (queue mode)

Redis is **disabled by default** (`AP_QUEUE_MODE = MEMORY`). When `enable_redis = true`
is set, the queue backend switches to `AP_QUEUE_MODE = REDIS`, which is required
before scaling beyond one instance. When `redis_host` is left empty and `enable_nfs`
is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm queue mode in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`AP_ENCRYPTION_KEY` (used to encrypt all stored connection credentials) and
`AP_JWT_SECRET` (used to sign user session tokens). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows public
access required for webhook endpoints. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity.

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

## 3. Activepieces Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user, grants privileges, and
  installs the `pgvector` extension for AI-powered flow pieces. The job is safe to
  re-run.
- **Database migrations on start.** Activepieces applies its own schema migrations
  automatically on every startup, so upgrading the application version applies schema
  changes without a separate migration step.
- **`AP_ENCRYPTION_KEY` and `AP_JWT_SECRET` are immutable after first boot.** These
  keys are generated once and written to Secret Manager. Changing `AP_ENCRYPTION_KEY`
  permanently corrupts all stored connection credentials. Changing `AP_JWT_SECRET`
  invalidates all active user sessions. Only rotate during a planned maintenance
  window.
- **Webhook endpoints.** The default `ingress_settings = "all"` allows external
  systems to POST to Activepieces webhook URLs. Enabling IAP will block these calls.
  After deployment, verify `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` match the
  actual service URL. Inspect the running revision:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Sign-up is open by default.** `AP_SIGN_UP_ENABLED = "true"` is injected
  automatically. After creating the initial administrator account, disable sign-up
  by adding `AP_SIGN_UP_ENABLED = "false"` to `environment_variables`.
- **Health path.** Startup and liveness probes target `/api/v1/flags` — the
  Activepieces flags API endpoint that responds only when the server is fully
  initialised and connected to PostgreSQL. Allow at least 7 minutes on first boot
  (the default startup probe provides a 120-second initial delay plus a 300-second
  retry window).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Activepieces are listed; every other input is
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
| `application_name` | `activepieces` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Activepieces Workflow Automation` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Deployment-tracking tag for the built image. **Does not pin the upstream release**: `Activepieces_Common`'s Dockerfile always builds `FROM activepieces/activepieces:latest` with no version ARG, so changing this value only relabels the pushed Artifact Registry tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `2Gi` | Memory per instance; minimum 1 GiB. |
| `min_instance_count` | `1` | `0` enables scale-to-zero; set `1` to avoid cold starts on webhooks. |
| `max_instance_count` | `1` | **Only increase when `enable_redis = true`.** |
| `container_port` | `8080` | Activepieces listens on port 8080. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Activepieces image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for public webhook endpoints. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks public webhook endpoints.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `AP_*` values are set automatically — do not set `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, or `AP_POSTGRES_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

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

### Group 9 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 10 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `enable_nfs` | `false` | NFS is off by default; enable only if co-locating Redis on the NFS server. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 11 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `activepieces_db` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `ap_user` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not forwarded — Activepieces has no platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/flags` 120s delay | Startup probe. Allow 7+ minutes on first boot. |
| `liveness_probe` | HTTP `/api/v1/flags` 30s delay | Liveness probe. |
| `startup_probe_config` | disabled | Alternative structured probe (disabled by default; `startup_probe` takes effect). |
| `health_check_config` | HTTP `/` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default, enable explicitly to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Switch `AP_QUEUE_MODE` from `MEMORY` to `REDIS`. Required when `max_instance_count > 1`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `AP_ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently corrupts all stored connection credentials — they cannot be decrypted. |
| `AP_JWT_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login for everyone. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX` | Actual service URL | Critical | Incorrect URL breaks all webhook integrations and OAuth callbacks. |
| `max_instance_count` | `1` unless Redis enabled | High | Scaling beyond 1 in memory queue mode splits the job queue across instances, causing duplicate executions and lost runs. |
| `enable_redis` | `true` before scaling | High | Without Redis, each instance maintains its own in-memory queue — inconsistent execution with more than 1 instance. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but NFS is off and no host is set, the Redis connection string is blank and the app fails to start. |
| `memory_limit` | `2Gi` | High | Values below 1 GiB cause OOM kills during concurrent flow executions. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks all external webhook callbacks. |
| `enable_iap` | only when webhooks not needed | High | IAP blocks all unauthenticated requests, including external webhook callbacks. |
| `AP_SIGN_UP_ENABLED` (auto-injected `"true"`) | Disable after first admin | High | Leaving sign-up open allows anyone with the URL to create an account. |
| `min_instance_count` | `1` (the default) | Medium | Scale-to-zero (`0`) adds 5–15 second cold-start delays on incoming webhooks after idle. |
| `min_instance_count` (with Activepieces scheduled/triggered flows enabled) | `1` (no `cpu_always_allocated` override exists) | High | Activepieces' own scheduler/worker/cron components only run while an instance is warm; at `min_instance_count = 0` scheduled flows silently never fire, and this module does not expose `cpu_always_allocated` to force always-on CPU instead. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | Webhook endpoints and the admin UI are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Activepieces-specific application configuration
shared with the GKE variant is described in
**[Activepieces_Common](Activepieces_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Activepieces on Cloud Run](../labs/Activepieces_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Activepieces on GKE Autopilot](Activepieces_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Activepieces Common — Shared Application Configuration](Activepieces_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [n8n on Google Cloud Run](N8N_CloudRun.md), [Node-RED on Google Cloud Run](NodeRED_CloudRun.md), [Ntfy on Google Cloud Run](Ntfy_CloudRun.md), [EvolutionAPI on Google Cloud Run](EvolutionAPI_CloudRun.md) in the **Workflow Automation Hub** solution.
