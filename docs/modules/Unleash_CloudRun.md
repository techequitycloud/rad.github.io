---
title: "Unleash on Google Cloud Run"
description: "Configuration reference for deploying Unleash on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Unleash on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Unleash_CloudRun.png" alt="Unleash on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Unleash is an open-source, Apache-2.0-licensed feature-flag and toggle-management
platform for progressive delivery, A/B testing, and gradual rollouts. This module
deploys Unleash on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Unleash uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Unleash costs on RAD, and how that compares

**Running Unleash on Cloud Run in your own Google Cloud project costs about US$67.80/month in Google Cloud charges**, on top of a one-off 75-credit RAD module fee (US$7.50) charged once at deploy time. Unleash is an open-source feature-flag and progressive-delivery platform, and its Postgres database is most of this running cost. In a RAD-managed project the module fee drops to 67.5 credits (10% lower) — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below — or see the [GKE guide](Unleash_GKE.md) if you'd rather run it on Kubernetes.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 75 credits | 67.5 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | US$67.80/month, billed by Google at list price | ~26 credits/day (about 780/month, US$78 at the top-up price), metered at list price plus RAD's margin |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project**

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 0.5 GiB (scaleToZero) | US$10.78 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$67.80** |


### How it compares

- Unleash's own hosted cloud is priced per **seat**: Pay-As-You-Go is $75/seat/month with a 5-seat minimum, so a small team is billed from $375/month, and Enterprise is by quote — verified on Unleash's pricing page, 8 October 2026. RAD's own-project cost (~US$68/month, flat, no seat minimum) is a fraction of even the smallest Unleash Cloud commitment.
- A self-managed VPS comparison, sized to Unleash's lightweight 1 vCPU / 0.5 GiB default: a Hetzner CPX11 or DigitalOcean 1 vCPU/2GB Droplet runs about $6-12/month — cheaper in cash terms, plus your own time for Postgres backups and patching, which RAD's managed Cloud SQL and Secret Manager cover for you.
- Feature-flag platforms are usually adopted by an engineering team of more than five, which is exactly where Unleash Cloud's per-seat pricing bites hardest and a flat self-hosted running cost stops scaling with headcount.

### Pause it for free: delete a RAD-managed project, restore it when you need it

This is the headline advantage of a RAD-managed project, and it costs nothing while paused.
Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the
project outright — Google's own 30-day recoverable soft delete. Unlike deleting one module,
this does **not** tear down Cloud SQL, any VM, or the compute resource one by one: the whole
project simply stops, and nothing is charged while it waits, because billing is already
unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment to
confirm everything came back. Because nothing was individually destroyed, that Update finds
the same resources already there — it is a check, not a rebuild, and an Update never charges
the module fee again. This costs only a handful of credits (under US$1) in total for a typical
2-3-deployment chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days — after that Google deletes it for good — and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you
delete the project — even though the project itself is recoverable for 30 days. If you've
customised Unleash and want to keep that work, copy a backup out (to Google Drive, or a bucket
outside the project) before deleting. For a default install with nothing irreplaceable in it,
this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once 30 days have passed on a RAD-managed one, there is no free pause —
deleting removes the resources for good, and bringing Unleash back means redeploying from
scratch. That costs about 78-81 credits in your own project, or about
70.5-73.5 credits in a RAD-managed one.

Deleting only saves money once Unleash would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — about 4 days or more in your own project
(about US$2.26 a day), or about 3 days or more in a RAD-managed one
(26 credits a day).

Keep data first: nightly backups go to a bucket inside the deployment and are deleted with it,
so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

Lab sessions, for training: a trainer runs a session for a class. Each participant gets the
app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
trainer sets. Either the trainer funds every place, or each participant pays for their own.
Everything is deleted when the session ends and unused credits go back to the trainer.

Managed Environments, for consultancies: a partner runs the app for a client from a
ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Google's project delete/restore documentation](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore claims; [Unleash pricing](https://www.getunleash.io/pricing).

## 1. Overview

Unleash runs as a Node.js container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 512 MiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Unleash does not support MySQL or other engines |
| Secrets | Secret Manager | Auto-generated bootstrap admin API token (`INIT_ADMIN_API_TOKENS`); database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Unleash is stateless.** All flag, toggle, strategy, segment, and audit data lives
  in PostgreSQL — no object storage, NFS, or persistent volume is provisioned, and any
  instance can serve any request.
- **No Redis or queue backend.** Unleash needs no cache or queue; it scales
  horizontally by pointing more instances at the same database.
- **`INIT_ADMIN_API_TOKENS` is generated automatically** and stored in Secret Manager.
  Unleash seeds this all-access (`*:*`) admin API token into its database at first boot
  so automation can call the Admin API immediately.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Cold starts add a few seconds to the first request
  after idle. Set `min_instance_count = 1` if SDK clients poll on a tight interval and
  cold-start latency is unacceptable.
- **`DATABASE_URL` is assembled at container start** from the platform-injected `DB_*`
  variables by the custom image entrypoint, which branches on the connection type
  (socket, loopback proxy, or private IP) and keeps TLS certificate verification on for
  direct private-IP connections (secure by default).
- **The health endpoint is `/health`** — a public, unauthenticated 200 endpoint. The
  Admin API under `/api/admin/*` requires a token.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Unleash service

Unleash runs as a Cloud Run v2 service that autoscales by request load between the
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

Unleash stores all application data (projects, feature flags, strategies, segments,
API tokens, users, and the change/audit log) in a managed Cloud SQL for PostgreSQL 15
instance. The service connects privately through the **Cloud SQL Auth Proxy**; no
public IP is exposed. On first deploy an initialization Job creates the application
database and user, and Unleash applies its own schema migrations on startup.

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

### C. Secret Manager

A bootstrap admin API token is generated automatically and stored in Secret Manager,
injected as `INIT_ADMIN_API_TOKENS`. The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Use the token against the Admin API:
  curl -s -H "Authorization: <token>" "$SERVICE_URL/api/admin/projects"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public
access SDK clients and CI systems need to reach the Unleash API. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Unleash Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user and grants privileges. The
  job is safe to re-run; it does **not** create tables.
- **Schema migrations on start.** Unleash applies its own schema migrations
  automatically on every startup, so upgrading the application version applies schema
  changes without a separate migration step. Allow generous startup headroom on the
  first boot against an empty database.
- **`DATABASE_URL` is composed at runtime.** The custom image entrypoint assembles the
  connection string from the injected `DB_*` variables. Verify the running revision's
  injected variables when debugging a connection issue:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Bootstrap admin API token.** `INIT_ADMIN_API_TOKENS` seeds an all-access (`*:*`)
  admin API token at first boot so CI, the Unleash CLI, and SDK back ends can call the
  Admin API without a UI login. Retrieve it from Secret Manager (§2C).
- **Default UI credentials.** The admin UI ships a well-known first-run account —
  `admin` / `unleash4all`. Change the password immediately after the first login.
- **Health path.** Startup and liveness probes target `/health` — a public,
  unauthenticated endpoint that returns 200 only when the server is initialised and
  connected to PostgreSQL. The Admin API under `/api/admin/*` requires a token, so it
  must never be used as a probe path.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Unleash are listed; every other input is inherited from
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
| `application_name` | `unleash` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Unleash` | Human-readable name shown in the Console. |
| `application_description` | `Unleash Analytics on Cloud Run` | Service description. |
| `application_version` | `5.7.0` | `unleashorg/unleash-server` image tag; `latest` is remapped to a pinned tag at build time. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Cloud Build wraps `unleashorg/unleash-server` with the DATABASE_URL entrypoint. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU is sufficient for most deployments. |
| `memory_limit` | `512Mi` | Memory per instance; raise to `1Gi` for heavy admin/reporting use. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` for tight SDK polling. |
| `max_instance_count` | `3` | Unleash scales horizontally — all state is in PostgreSQL. |
| `cpu_always_allocated` | `false` | Request-based billing; Unleash does no background work needing an always-on CPU. |
| `container_port` | `4242` | Unleash listens on port 4242. |
| `execution_environment` | `gen2` | Gen2 recommended. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` lets SDK clients and CI reach the Unleash API. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks token-authenticated SDK traffic.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `DATABASE_URL` is assembled at runtime — do not set it here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

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
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Empty — Unleash requires no file storage. |
| `enable_nfs` | `false` | NFS is off; Unleash is stateless. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Unleash requires PostgreSQL. |
| `application_database_name` | `unleash` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `unleash` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `enable_postgres_extensions` / `postgres_extensions` | off / `[]` | Optional PostgreSQL extensions. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Cloud Scheduler + Cloud Run Jobs. |
| `additional_services` | `[]` | Sidecar/helper Cloud Run services. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 30s delay, 30 retries | Startup probe. Allow headroom for first-boot migrations. |
| `liveness_probe` | HTTP `/health`, 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/health` | Structured Cloud Run startup probe. |
| `health_check_config` | HTTP `/health` | Structured Cloud Run liveness probe. |
| `uptime_check_config` | disabled, `/health` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 16 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Unleash does not require Redis; leave disabled. |
| `redis_host` | `""` | Only used when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (auto-discovers `organization_id`). |
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
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `storage_buckets` | Created Cloud Storage buckets (empty for Unleash). |
| `container_image` | Deployed image. |
| `cicd_enabled` / `github_repository_url` | CI/CD status and connected repo. |
| `deployment_id` / `project_id` | Naming and project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Any other engine breaks Unleash startup — it only supports PostgreSQL. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all flag data. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` (auto) | Keep `true` on private IP | Critical | Disabling certificate verification on a private-IP TCP connection weakens transport security. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `startup_probe` / `liveness_probe` path | `/health` | High | Pointing a probe at `/api/admin/*` returns 401/403 and the revision never becomes Ready. |
| `enable_iap` | only when no SDK traffic | High | IAP blocks all unauthenticated requests, including token-authenticated SDK/CI calls to the Unleash API. |
| `ingress_settings` | `all` | High | `internal` blocks external SDK clients and CI from reaching the Unleash API. |
| `INIT_ADMIN_API_TOKENS` (auto) | Retrieve from Secret Manager | Medium | The seeded token grants all-access admin API rights — treat it as a secret and rotate if exposed. |
| Default UI login `admin` / `unleash4all` | Change on first login | High | Leaving the default password exposes full admin control of every flag. |
| `min_instance_count` | `0` (default) or `1` | Medium | Scale-to-zero adds a few seconds of cold-start latency to the first request after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Unleash-specific application configuration
shared with the GKE variant is described in
**[Unleash_Common](Unleash_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Unleash on Cloud Run](../labs/Unleash_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Unleash on GKE Autopilot](Unleash_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Unleash Common — Shared Application Configuration](Unleash_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [GlitchTip on Google Cloud Run](GlitchTip_CloudRun.md), [Formbricks on Google Cloud Run](Formbricks_CloudRun.md), [Tolgee on Google Cloud Run](Tolgee_CloudRun.md) in the **Release Management & Quality** solution.
