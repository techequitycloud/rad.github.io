---
title: "Cal.diy on Google Cloud Run"
description: "Configuration reference for deploying Cal.diy on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Cal.diy on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalDiy_CloudRun.png" alt="Cal.diy on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.diy is the MIT-licensed, self-hostable fork of Cal.com — the open-source scheduling
platform used by millions worldwide to eliminate back-and-forth meeting coordination.
This module deploys Cal.diy on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Cal.diy uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Cal.diy costs on RAD, and how that compares

**Cal.diy on RAD's Cloud Run module costs about US$85 a month in your own Google Cloud project, with no extra licence fee** — Cal.diy is open source. In a project RAD manages for you, the same deployment is metered at **26 credits a day** (about 780 a month, about US$78 at the top-up price). Or see the [GKE guide](CalDiy_GKE.md) for always-on capacity across pods. If you only need Cal.diy occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Cal.diy is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6 credits) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$85 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **26 credits a day**, about 780 a month (about US$78 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (scaleToZero) | US$28.37 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$85** |

These prices are the same in africa-south1 (Johannesburg).

- **Scale-to-zero is the default on Cloud Run.** The figure above assumes modest daily use; set `min_instance_count ≥ 1` to keep it always warm (and avoid cold starts), which raises the Cloud Run line but not the rest of the table.

### How it compares, for a team self-hosting without per-seat licensing

Cal.diy exists specifically as a self-hostable fork, so there is no official hosted Cal.diy plan to compare against (Cal.com's own hosted plans are a different codebase and licence, so they are not quoted here as a stand-in). The honest comparison is a bare server:

- A Hetzner CPX22 or DigitalOcean droplet (2 vCPU/4 GB, about US$24/month) or a GCP e2-standard-2 (2 vCPU/8 GB, about US$49/month) would run Cal.diy and its PostgreSQL database — roughly the same class of machine this module itself uses.
- On a bare VPS you run PostgreSQL, backups, security patches and upgrades yourself. RAD's module gives you managed Cloud SQL, Secret Manager and Cloud Monitoring for the module fee plus the Google Cloud usage above.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Cal.diy runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
just this module — unlinks its billing first, then asks Google to delete the project outright. Google
keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it
waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the compute resource one
by one: the whole project simply stops.

- **Restoring is a check, not a rebuild.** Within 30 days, the project's owner can ask Google to undelete
  the project and reattach its billing account, then run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds the same resources
  already there, and an Update never charges the module fee again. For a typical 2–3-deployment chain
  this costs only a handful of credits in total (roughly 5–10 credits, under US$1).
- **What this needs.** You must own the project (not one RAD only manages billing for), restore it
  yourself within 30 days — after that Google deletes it for good — and clear the tier's admission floor
  again (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside the project,
  and that bucket has Cloud Storage's soft-delete turned off, so it is very likely gone as soon as the
  project is deleted — even though the project itself is recoverable for 30 days. Copy a backup out (to
  Google Drive, or a bucket outside the project) before deleting if there is anything in it worth
  keeping; for a default install with nothing irreplaceable, this does not matter.

Source: [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window above has passed, the way to stop paying is to
delete the deployment and deploy it again when you need it.

- **What a redeploy costs.** The module fee again, plus the builds: about 114 credits
  (about US$11.40) at the top-up price, and roughly 15–20 minutes of build time (RAD's
  own platform average). Deleting saves money only once Cal.diy would otherwise sit unused for about
  **4 days or more** — in your own project that is about US$2.85 a day, and
  in a RAD-managed one it is 26 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Cal.diy while another application shares the project saves only Cal.diy's own compute part.
- **Keep data first.** Nightly backups go to a bucket inside the deployment and are deleted with it, so
  copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in
  their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either
  the trainer funds every place, or each participant pays for their own. Everything is deleted when the
  session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced
  wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the
  data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over
  and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card,
bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and backup-bucket caveat; prices change, check each source before relying on a figure.

## 1. Overview

Cal.diy runs as a Next.js (Node.js) container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js service, 2 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Cal.diy uses Prisma ORM targeting PostgreSQL |
| Object storage | Cloud Storage | A `data` bucket provisioned by default |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Selecting MySQL or `NONE` breaks startup.
- **Scale-to-zero is the default** (`min_instance_count = 0`). Cal.diy's first-boot
  startup takes 4–5 minutes; set `min_instance_count = 1` for production to avoid
  cold-start latency.
- **A custom wrapper image is built by default.** `CalDiy_Common` always sets
  `image_source = "custom"` and provides a Dockerfile. The entrypoint assembles
  `DATABASE_URL` from the `DB_*` environment variables injected by the platform,
  making the connection robust regardless of which image version is deployed.
- **Three initialization jobs run on first deploy:** `db-init` (PostgreSQL setup),
  `db-migrate` (Prisma schema migrations), and `seed-app-store` (seeds the Cal.diy
  app store table). All are idempotent.
- **`NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`** are generated automatically and
  stored in Secret Manager; you never set them in plain text.
- **`NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL`** are auto-computed from the predicted
  Cloud Run service URL. Override via `environment_variables` when using a custom
  domain.
- **`calcom/cal.diy` has no `latest` tag** — always pin `application_version` to a
  versioned release (e.g., `v6.2.0`).
- **Redis is disabled by default.** NextAuth.js sessions are stored in PostgreSQL.
  Enable Redis for high-concurrency multi-instance deployments.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Cal.diy service

Cal.diy runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

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

Cal.diy stores all application data (bookings, users, schedules, integrations) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through
the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy a
sequence of Cloud Run Jobs creates the database and user, runs Prisma schema
migrations, and seeds the app store.

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

A default Cloud Storage bucket (suffix `data`) is provisioned and the service account
is granted access automatically. Cal.diy does not require shared NFS storage by
default — the database stores all booking state.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Secret Manager

`NEXTAUTH_SECRET` (NextAuth.js session signing) and `CALENDSO_ENCRYPTION_KEY` (Cal.diy
data encryption) are generated automatically and stored as Secret Manager secrets.
The database password is also managed here. Secrets are injected into the service at
runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Cal.diy Application Behaviour

- **First-deploy initialization sequence.** Three Cloud Run Jobs execute in order
  before the service serves traffic:

  | Job | Image | Purpose |
  |---|---|---|
  | `db-init` | `postgres:15-alpine` | Creates the PostgreSQL database and user, grants privileges |
  | `db-migrate` | Cal.diy app image | Runs `prisma migrate deploy` to apply the full schema |
  | `seed-app-store` | Cal.diy app image | Seeds the `App` table with available integrations |

  All three are idempotent and safe to re-run. Inspect their executions:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

- **`DATABASE_URL` assembly.** The entrypoint script assembles `DATABASE_URL` and
  `DATABASE_DIRECT_URL` from `DB_*` environment variables at container start, then
  launches the Next.js server. This makes database connectivity independent of which
  image variant is deployed.

- **Startup probe.** Health probes target `/api/auth/session` (HTTP 200 when NextAuth
  is ready). `CalDiy_Common` sets a 6-minute total startup window
  (`initial_delay=180s`, `failure_threshold=18`, `period=10s`) to accommodate
  `replace-placeholder.sh` (~2.5 min), `db-migrate` (~60s), and `seed-app-store`
  (~30s) that run on the first boot inside the container's `start.sh`.

- **Public URL wiring.** `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` are auto-computed
  from the predicted Cloud Run service URL. Override both in `environment_variables`
  when using a custom domain so OAuth callbacks and booking links point to the correct
  host.

- **Email (SMTP).** Cal.diy uses SMTP for booking confirmations, cancellation notices,
  reminders, and password resets. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `EMAIL_FROM` in `environment_variables` and store `SMTP_PASSWORD` as a
  `secret_environment_variables` reference before going live.

- **Reminders need an external cron call.** Bookings work without scheduled jobs, but
  cal.com sends booking and Workflow reminders only when something calls its
  `/api/cron/*` endpoints with the shared `CRON_API_KEY`. With no key those calls are
  rejected (401) and no reminder ever fires, while the app otherwise looks healthy.
  To enable reminders, set `cron_api_key` (stored in Secret Manager) **and** add a
  `cron_jobs` entry that calls the endpoint.

- **Scheduled-flow reliability gap (no `cpu_always_allocated` override).** The
  repository-wide `cpu_always_allocated` audit (CLAUDE.md, 2026-07-10 OPEN CAVEAT)
  lists Cal.diy (alongside Activepieces) as shipping scheduler/worker/cron/queue
  components that default to request-based billing with `min_instance_count = 0`,
  and warns that if a deployment enables Cal.diy's *scheduled* flows, those triggers
  will silently not fire while the service is scaled to zero — the documented fix
  being an override to `cpu_always_allocated = true` + `min_instance_count = 1` (the
  same pattern used for n8n). **`CalDiy_CloudRun` currently has no way to apply that
  fix**: `cpu_always_allocated` is a Foundation (`App_CloudRun`) variable that is not
  declared in `CalDiy_CloudRun/variables.tf` and not forwarded in `main.tf`, so it
  cannot be set through this module's inputs. `min_instance_count = 1` alone (already
  exposed) avoids scale-to-zero, but leaves the request-based CPU-throttling half of
  the problem unaddressed for any scheduled-flow use case.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Cal.diy are listed; every other input is
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
| `application_name` | `caldiy` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Cal.com Scheduling` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `v6.2.0` | Cal.diy image version tag — **no `latest` tag exists**, always pin to a versioned release. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the wrapper image via Cloud Build (required for Cloud Run — assembles `DATABASE_URL`); `prebuilt` deploys the official image directly. |
| `container_image` | `""` | Override container image URI. Leave empty to use default. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; raise to `4Gi` for production multi-user load. |
| `container_port` | `3000` | Cal.diy's native Next.js port. Do not change. |
| `execution_environment` | `gen2` | Gen2 recommended; required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum duration per request. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Cal.diy image into Artifact Registry. |
| `min_instance_count` | `0` | Minimum instances (0 = scale-to-zero). Set to `1` to avoid cold-start latency in production. |
| `max_instance_count` | `5` | Maximum instances. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. All entries must sum to 100. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service: `all`, `internal`, or `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP skeleton | Plain-text settings. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` here. Also set `NEXT_PUBLIC_WEBAPP_URL` once a custom domain is known. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification period. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. Set `false` after a successful import. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB with Cloud Armor WAF. Required for custom domains and DDoS protection. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom hostnames for the external load balancer. When set, also update `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL`. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the default `data` bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets to provision. |
| `enable_nfs` | `false` | NFS is not required for Cal.diy. Enable only if custom shared storage is needed (requires `gen2`). |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Cal.diy requires PostgreSQL. |
| `db_name` | `calcom` | Database name. Immutable after first deploy. |
| `db_user` | `calcom` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Alias env var names alongside the standard `DB_*` variables. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init`, `db-migrate`, and `seed-app-store` jobs. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs triggered by Cloud Scheduler. Needed for reminders: add one that calls `/api/cron/*` with `CRON_API_KEY` (see `cron_api_key`). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/auth/session`, initial_delay=180s, failure_threshold=18 | Generous window for first-boot `start.sh` (URL rewrite + migrations + seed). |
| `liveness_probe` | HTTP `/api/auth/session`, initial_delay=60s | Liveness probe after startup. |
| `uptime_check_config` | disabled, path `/api/auth/session` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Use Redis for session caching. Recommended when `max_instance_count > 1`. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true`. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Cal.diy requires PostgreSQL with Prisma; MySQL or `NONE` breaks schema migrations and startup. |
| `container_port` | `3000` | Critical | Cal.diy's Next.js server listens on 3000; any other value misdirects Cloud Run health checks and traffic routing. |
| `enable_cloudsql_volume` | `true` | Critical | Cal.diy connects via Unix socket; disabling removes the socket and all DB connections fail. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans existing data. |
| `application_version` | pinned release | Critical | `calcom/cal.diy` has no `latest` tag; an invalid version fails the image pull. |
| `NEXT_PUBLIC_WEBAPP_URL` | match public URL | Critical | Cal.diy embeds this in Next.js static chunks via `replace-placeholder.sh`; a mismatch breaks OAuth callbacks and booking links. |
| `NEXTAUTH_URL` | match public URL | Critical | NextAuth validates OAuth redirect URIs against this; a mismatch blocks all logins. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job and may overwrite live data on subsequent applies. |
| `startup_probe.initial_delay_seconds` | `180` (via CalDiy_Common) | High | Cal.diy `start.sh` runs URL rewrite (~2.5 min) + Prisma migrations + seed before serving requests; too short a window causes a restart loop. |
| `startup_probe.failure_threshold` | `18` at `period=10s` | High | Gives ~6 minutes total; reducing below 12 kills the container before initialization completes. |
| `container_image_source` | `custom` | High | Cloud Run requires the wrapper image that assembles `DATABASE_URL`; using `prebuilt` without the wrapper entrypoint leaves `DATABASE_URL` unset and all DB queries fail. |
| `memory_limit` | `2Gi` minimum | High | Cal.diy startup (URL rewrite + migrations) requires ≥ 2 GiB; OOM kills before the app is ready. |
| `enable_redis` | `true` for multi-instance | High | Without Redis, sessions are per-instance; users are logged out when scale-to-zero or instance rotation occurs. |
| `redis_host` | required when `enable_redis=true` | High | Empty `redis_host` with Redis enabled injects a malformed URL; session operations fail at runtime. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero is the default; Cal.diy's 4–5 minute cold start adds unacceptable latency for production scheduling. |
| scheduled/cron-driven flows | not supported without a module change | Medium | Per CLAUDE.md's `cpu_always_allocated` audit (2026-07-10 OPEN CAVEAT), Cal.diy's scheduler/worker/cron/queue components need `cpu_always_allocated = true` to fire reliably while scaled to zero — but this module does not declare or forward that Foundation variable, so it cannot be set today. |
| `SMTP_HOST` / `EMAIL_FROM` | real SMTP config | Medium | Without valid SMTP, booking confirmations, reminders, and password resets are never delivered. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Medium | If using Memorystore Redis, its private IP may not be in default VPC ranges; change to `ALL_TRAFFIC` or ensure correct VPC routing. |
| `organization_id` | set explicitly for VPC-SC | Medium | VPC-SC perimeter is only activated when `organization_id` is set; `enable_vpc_sc = true` alone has no effect. |
| `execution_environment` | `gen2` | Medium | `gen1` does not support NFS mounts; if `enable_nfs = true`, `gen2` is required. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Cal.diy-specific application configuration shared
with the GKE variant is described in **[CalDiy_Common](CalDiy_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: CalDiy on Cloud Run](../labs/CalDiy_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Cal.diy on GKE Autopilot](CalDiy_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [CalDiy_Common — Shared Application Configuration](CalDiy_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Monica on Google Cloud Run](Monica_CloudRun.md), [Radicale on Google Cloud Run](Radicale_CloudRun.md), [ActualBudget on Google Cloud Run](ActualBudget_CloudRun.md) in the **Personal Organiser** solution.
