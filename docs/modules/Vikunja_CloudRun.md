---
title: "Vikunja on Google Cloud Run"
description: "Configuration reference for deploying Vikunja on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Vikunja on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vikunja_CloudRun.png" alt="Vikunja on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vikunja is an open-source, self-hosted to-do and project management application —
lists, kanban boards, gantt charts, calendars, reminders, and team sharing via a
REST API and web UI. This module deploys Vikunja on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Vikunja uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Vikunja costs on RAD, and how that compares

**Running Vikunja on Cloud Run in your own Google Cloud project costs about US$115.17/month in Google Cloud charges**, on top of a one-off 75-credit RAD module fee (US$7.50) charged once at deploy time. Vikunja is a self-hosted to-do and project-management app, and it runs `alwaysOn` by default so lists, kanban boards and reminders stay responsive without a cold start — which is most of this running cost. In a RAD-managed project the module fee drops to 67.5 credits (10% lower) — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below — or see the [GKE guide](Vikunja_GKE.md) for a lower-cost alternative.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 75 credits | 67.5 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | US$115.17/month, billed by Google at list price | ~54 credits/day (about 1620/month, US$162 at the top-up price), metered at list price plus RAD's margin |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project**

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 0.5 GiB (alwaysOn) | US$44.72 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$115.17** |


### How it compares

- Vikunja's own hosted cloud charges per user: Personal is €4/month (single user), Family is €10/month for up to 5 users, and Organization is €5/month per user for teams — verified on Vikunja's pricing page, 8 October 2026. A 5-person team on the Family plan is €10/month (about $11), well below RAD's own-project running cost here; Vikunja Cloud's own hosting is genuinely cheap because it's a shared multi-tenant service, where RAD gives you a dedicated, isolated project.
- A self-managed VPS comparison, sized to Vikunja's 1 vCPU / 0.5 GiB default: a Hetzner CPX11 or DigitalOcean 1 vCPU/2GB Droplet runs about $6-12/month — cheaper in cash terms, plus your own time for Postgres backups and patching, which RAD's managed Cloud SQL and Secret Manager cover for you.
- For a single user or small household, Vikunja's own cloud plans are the cheapest option in cash terms; RAD's case here is a dedicated project you fully control, not the lowest sticker price.

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
customised Vikunja and want to keep that work, copy a backup out (to Google Drive, or a bucket
outside the project) before deleting. For a default install with nothing irreplaceable in it,
this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once 30 days have passed on a RAD-managed one, there is no free pause —
deleting removes the resources for good, and bringing Vikunja back means redeploying from
scratch. That costs about 78-81 credits in your own project, or about
70.5-73.5 credits in a RAD-managed one.

Deleting only saves money once Vikunja would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — about 2 days or more in your own project
(about US$3.84 a day), or about 1 days or more in a RAD-managed one
(54 credits a day).

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

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Google's project delete/restore documentation](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore claims; [Vikunja pricing](https://vikunja.io/pricing/).

## 1. Overview

Vikunja runs as a single Go container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 1 vCPU / 512 MiB by default, single instance |
| Database | Cloud SQL for PostgreSQL 15 | Required — Vikunja does not support MySQL in this module |
| Container build | Cloud Build + Artifact Registry | Wraps the `scratch` upstream image with a grafted busybox |
| Secrets | Secret Manager | Auto-generated `VIKUNJA_SERVICE_JWTSECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **The app connects over the Cloud SQL private IP, not the socket.** Vikunja builds
  a `postgres://` URL internally, and the Auth Proxy socket path's colons break URL
  parsing. The entrypoint connects over the private IP with `sslmode=require`.
- **The image is `scratch`-based and gets a busybox graft.** The upstream
  `vikunja/vikunja` image has no shell, so the custom build copies in a static
  busybox to run the entrypoint. `container_image_source` defaults to `"custom"`.
- **`VIKUNJA_SERVICE_JWTSECRET` is generated automatically** and stored in Secret
  Manager. Rotating it after first boot invalidates all active user sessions.
- **`cpu_always_allocated = true` by default.** Vikunja runs an in-process
  reminder/cron scheduler that must run without an inbound request, so CPU is not
  throttled between requests. This keeps a single instance warm.
- **Single instance by default** (`min_instance_count = 1`, `max_instance_count = 1`).
  Vikunja has no built-in coordination for multiple concurrent instances.
- **Public ingress by default.** `ingress_settings = "all"` so the UI and API are
  reachable. Enable IAP to require Google sign-in.
- **NFS is enabled by default, and must stay on.** Tasks, projects and users live
  in PostgreSQL; task attachments are files, and the wrapper points Vikunja at the
  NFS mount (`VIKUNJA_FILES_BASEPATH` = `nfs_mount_path`, `/data`) so they survive
  restarts.
- **`VIKUNJA_SERVICE_PUBLICURL` is set at runtime** from the actual
  `CLOUDRUN_SERVICE_URL`, so links and the frontend always use the real service URL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Vikunja service

Vikunja runs as a Cloud Run v2 service. Each deployment creates an immutable
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

Vikunja stores all application data (tasks, projects, boards, users, teams) in a
managed Cloud SQL for PostgreSQL 15 instance. The `db-init` Job connects through the
**Cloud SQL Auth Proxy** over a Unix socket; the running application connects over
the Cloud SQL **private IP** with `sslmode=require` (its URL builder cannot use the
socket path). No public IP is exposed.

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

### C. Cloud Build & Artifact Registry

Because the upstream Vikunja image is `scratch`-based, the module builds a wrapper
image via Cloud Build (grafting in a static busybox and the entrypoint) and pushes
it to Artifact Registry.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
  ```

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`VIKUNJA_SERVICE_JWTSECRET` (used to sign user session JWTs). The database password
is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Cloud Storage & file attachments

Vikunja's own default attachment directory (`/app/vikunja/files`) is ephemeral on
Cloud Run, so the module mounts NFS at `nfs_mount_path` (`/data`) and sets
`VIKUNJA_FILES_BASEPATH` to that path; attachments are durable by default. The module
declares no dedicated GCS bucket by default.

- **Console:** Filestore / Compute Engine (NFS VM) when `enable_nfs = true`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for NFS and GCS Fuse options.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity (the app reaches Cloud SQL over
private-range VPC egress).

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

## 3. Vikunja Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and role and grants privileges. The
  job is safe to re-run.
- **Schema migrations on start.** Vikunja applies its own schema migrations
  automatically on the first application startup — the `db-init` job only provisions
  an empty database, so allow extra time on the first revision to become healthy.
- **`VIKUNJA_SERVICE_JWTSECRET` is immutable after first boot.** It is generated once
  and written to Secret Manager. Changing it invalidates all active user sessions.
  Only rotate during a planned maintenance window.
- **First registered account becomes the owner.** Vikunja ships no pre-seeded admin.
  Open `$SERVICE_URL` and register — the first account owns the instance. Then
  disable open registration:
  ```bash
  # add VIKUNJA_SERVICE_ENABLEREGISTRATION="false" to environment_variables and Update
  ```
- **Health path.** Startup and liveness probes target `/health` — a public,
  unauthenticated endpoint that returns 200 once the server binds its port.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Vikunja are listed; every other input is
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
| `application_name` | `vikunja` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Vikunja` | Human-readable name shown in the Console. |
| `application_description` | `Vikunja task manager on Cloud Run` | Service description. |
| `application_version` | `latest` | Vikunja image version tag; `latest` builds a pinned recent release (`2.3.0`). |
| `application_database_name` | `vikunja` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `vikunja` | Application database user. Password auto-generated in Secret Manager. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the busybox-grafted wrapper via Cloud Build; `prebuilt` deploys the official image. |
| `container_image` | `vikunja/vikunja` | Upstream image the custom build wraps. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance; gen2 enforces a 512Mi floor. |
| `container_port` | `3456` | Port Vikunja's Go server listens on. |
| `min_instance_count` | `1` | Kept at 1 so the reminder scheduler stays warm. |
| `max_instance_count` | `1` | Single instance — Vikunja has no multi-instance coordination. |
| `cpu_always_allocated` | `true` | Keeps CPU allocated so the in-process reminder scheduler runs between requests. |
| `execution_environment` | `gen2` | Gen2 required for the 512Mi floor and NFS/GCS mounts. |
| `enable_cloudsql_volume` | `true` | Auth Proxy socket for the `db-init` job; the app itself uses the private IP. |
| `enable_image_mirroring` | `true` | Mirror the wrapper image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress for the UI/API. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC (reaches Cloud SQL private IP). |
| `enable_iap` | `false` | Require Google sign-in in front of Vikunja. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `VIKUNJA_*` settings (e.g. `VIKUNJA_SERVICE_ENABLEREGISTRATION`). Do not set `VIKUNJA_DATABASE_*` or `VIKUNJA_SERVICE_JWTSECRET` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated Cloud SQL backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning.

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
| `storage_buckets` | `[]` | Vikunja declares no bucket by default. |
| `enable_nfs` | `true` | Must stay `true`: attachments are written to the NFS mount (`VIKUNJA_FILES_BASEPATH`). |
| `nfs_mount_path` | `/data` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Password

| Variable | Default | Description |
|---|---|---|
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Optional Cloud Scheduler + Cloud Run Jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 30s delay | Startup probe; wide retry window for first-boot migrations. |
| `liveness_probe` | HTTP `/health` 30s delay | Liveness probe. |
| `uptime_check_config` | disabled, path `/health` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `VIKUNJA_SERVICE_JWTSECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login for everyone. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_nfs` | `true` (default) | High | Without NFS, file attachments live on ephemeral disk and are lost on every revision/restart. |
| `memory_limit` | `512Mi` (gen2 floor) | High | Values below 512Mi are rejected at plan time on gen2. |
| `cpu_always_allocated` | `true` | Medium | Flipping to `false` pauses the in-process reminder scheduler while the instance is idle — reminders won't fire until the next request. |
| `container_image_source` | `custom` | High | `prebuilt` deploys the raw `scratch` image with no shell/entrypoint mapping — the container cannot map `DB_*` and fails to connect. |
| `ingress_settings` | `all` | Medium | `internal` makes the UI/API unreachable from outside the VPC. |
| `enable_iap` | enable for private instances | Medium | Without IAP the UI is public; anyone with the URL can reach the login/registration page. |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` (env var) | `"false"` after first admin | High | Leaving registration open allows anyone with the URL to create an account. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Vikunja-specific application configuration
shared with the GKE variant is described in
**[Vikunja_Common](Vikunja_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Vikunja on Cloud Run](../labs/Vikunja_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Vikunja on GKE Autopilot](Vikunja_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Vikunja Common — Shared Application Configuration](Vikunja_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Nextcloud on Google Cloud Run](Nextcloud_CloudRun.md), [OnlyOffice on Google Cloud Run](OnlyOffice_CloudRun.md), [Mattermost on Google Cloud Run](Mattermost_CloudRun.md), [Homepage on Google Cloud Run](Homepage_CloudRun.md) in the **Team Workspace** solution.
