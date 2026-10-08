---
title: "Vaultwarden on Google Cloud Run"
description: "Configuration reference for deploying Vaultwarden on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Vaultwarden on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vaultwarden_CloudRun.png" alt="Vaultwarden on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vaultwarden is a lightweight, self-hosted Bitwarden-compatible password manager written
in Rust. This module deploys Vaultwarden on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Vaultwarden uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Vaultwarden costs on RAD, and how that compares

**Running Vaultwarden on Cloud Run in your own Google Cloud project costs about US$80.31/month in Google Cloud charges**, on top of a one-off 75-credit RAD module fee (US$7.50) charged once at deploy time. Vaultwarden is a lightweight, Rust-based Bitwarden-compatible password-manager server, so every official Bitwarden client app works against it unmodified. In a RAD-managed project the module fee drops to 67.5 credits (10% lower) — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below — or see the [GKE guide](Vaultwarden_GKE.md) if you'd rather run it on Kubernetes.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 75 credits | 67.5 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | US$80.31/month, billed by Google at list price | ~36 credits/day (about 1080/month, US$108 at the top-up price), metered at list price plus RAD's margin |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project**

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 0.5 GiB (warm) | US$9.86 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$80.31** |


### How it compares

- **Bitwarden**'s own hosted service, which Vaultwarden is built to be compatible with, charges per user: Teams is $4/user/month and Enterprise $6/user/month (both billed annually, business plans), with a personal Premium plan at $1.65/month — verified on Bitwarden's pricing page, 8 October 2026. A 10-person team on Bitwarden Teams is $40/month forever, growing with headcount; RAD's own-project running cost is a flat ~US$80/month regardless of how many people have vaults, and the data never leaves your own project.
- A self-managed VPS comparison, sized to Vaultwarden's lightweight 1 vCPU / 0.5 GiB default: a Hetzner CPX11 or DigitalOcean 1 vCPU/2GB Droplet runs about $6-12/month — cheaper in cash terms, plus your own time for Postgres backups and patching, which matters more here than on most apps because this is a password vault.
- Vaultwarden's own running cost crosses Bitwarden Teams' per-seat price at around 20 users; below that, Bitwarden's own hosting is the cheaper option in cash terms, and RAD's case is full control of the data rather than price.

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
customised Vaultwarden and want to keep that work, copy a backup out (to Google Drive, or a bucket
outside the project) before deleting. For a default install with nothing irreplaceable in it,
this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once 30 days have passed on a RAD-managed one, there is no free pause —
deleting removes the resources for good, and bringing Vaultwarden back means redeploying from
scratch. That costs about 78-81 credits in your own project, or about
70.5-73.5 credits in a RAD-managed one.

Deleting only saves money once Vaultwarden would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — about 3 days or more in your own project
(about US$2.68 a day), or about 2 days or more in a RAD-managed one
(36 credits a day).

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

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Google's project delete/restore documentation](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore claims; [Bitwarden pricing](https://bitwarden.com/pricing/).

## 1. Overview

Vaultwarden runs as a compiled Rust binary on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Rust binary service, 1 vCPU / 512 Mi by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 (default) or MySQL 8.0 | Configurable engine; the init job adjusts automatically |
| Object storage | Cloud Storage | A dedicated `vaultwarden-attachments` bucket |
| Secrets | Secret Manager | Database password; Vaultwarden manages its own admin token internally |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Registrations are closed by default.** `signups_allowed = false` prevents
  anonymous account creation. Enable only during initial admin setup, then disable.
- **No admin token is auto-generated.** The `/admin` panel is disabled unless you
  provide `ADMIN_TOKEN` in `environment_variables`. This is the secure default.
- **`domain` must be set for WebAuthn and TOTP.** Without the full public URL, 2FA
  QR codes link to `localhost` and organisation invitation emails contain broken links.
- **Health probes target `/alive`**, Vaultwarden's dedicated lightweight health
  endpoint. Vaultwarden starts in seconds; the startup probe uses a 30 s initial delay.
- **`cpu_limit` must be at least `1000m`.** Cloud Run gen2 with always-allocated CPU
  (required for a `min_instance_count ≥ 1` password manager) requires at least 1 vCPU.
- **`execution_environment = "gen2"` is the default** and should not be changed; it is
  required for Unix socket connections to the Cloud SQL Auth Proxy.
- **`min_instance_count = 1` keeps the vault warm.** Scale-to-zero makes a password
  manager unavailable for several seconds; Bitwarden clients show connection errors.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Vaultwarden service

Vaultwarden runs as a Cloud Run v2 service that autoscales by request load between the
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

### B. Cloud SQL — PostgreSQL 15 or MySQL 8.0

Vaultwarden stores all vault data in a managed Cloud SQL instance. The default engine
is **PostgreSQL 15**; set `database_type = "MYSQL_8_0"` to use MySQL instead. The
service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket
(no public IP). On first deploy an initialization Job creates the application
database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`vaultwarden-attachments`) is provisioned for
attachment files. The workload service account is granted access automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mounts and CMEK options.

### D. Secret Manager

The database password is stored in Secret Manager and injected into the service at
runtime. Vaultwarden manages its own internal admin token and RSA signing keys within
the `/data` directory — those are not stored in Secret Manager.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN (with caution — do not cache authenticated
API responses), and Cloud Armor can be layered on. Cloud Armor is strongly recommended
to protect the Vaultwarden login endpoint from brute-force attacks.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks (targeting `/alive`) and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Vaultwarden Application Behaviour

- **First-deploy database setup.** An initialization Job creates the Vaultwarden
  database and user before the service starts. It is idempotent. The correct job image
  is selected automatically: `postgres:15-alpine` for PostgreSQL, `mysql:8.0-debian`
  for MySQL.
- **No schema migrations on start.** Vaultwarden manages its own internal schema
  evolution automatically; no migration command is needed.
- **No scheduled tasks required.** Unlike many web applications, Vaultwarden has no
  mandatory cron jobs. All vault operations are request-driven.
- **Health path.** Both the startup and liveness probes target `/alive`, which returns
  `OK` when the server is ready. The initial delay is 30 s, matching Vaultwarden's
  fast Rust startup.
- **Admin panel.** The `/admin` panel is disabled unless `ADMIN_TOKEN` is provided via
  `environment_variables`. Generate a secure random token (e.g. with
  `openssl rand -base64 48`) and inject it at runtime.
- **SMTP for notifications.** Vaultwarden uses SMTP for account verification, 2FA
  recovery codes, and emergency-access emails. Configure `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_FROM`, `SMTP_USERNAME`, and `SMTP_PASSWORD` (via `secret_environment_variables`)
  as a complete set — partial SMTP configuration causes silent delivery failures.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Vaultwarden are listed; every other input is
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

### Group 3 — Application Identity & Vaultwarden Settings

| Variable | Default | Description |
|---|---|---|
| `application_name` | `vaultwarden` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Vaultwarden Password Manager` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `1.32.7` | Vaultwarden image version tag. |
| `domain` | `""` | **Full public URL** (e.g. `https://vault.example.com`). Required for WebAuthn, TOTP QR codes, org invites, and attachment links. |
| `signups_allowed` | `false` | Allow new user self-registration. Enable only during initial setup; disable immediately after creating admin accounts. |
| `web_vault_enabled` | `true` | Serve the Vaultwarden web UI. Disable for API-only access via native clients. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds from the Dockerfile; `prebuilt` uses an existing image URI. |
| `cpu_limit` | `1000m` | CPU per instance. Minimum `1000m` enforced by validation (Cloud Run gen2 requirement). |
| `memory_limit` | `512Mi` | Memory per instance. Vaultwarden is very lightweight at rest. |
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid cold-start vault unavailability. |
| `max_instance_count` | `3` | Maximum instances (cost ceiling). |
| `container_port` | `80` | Vaultwarden's Rocket HTTP port. Must match `ROCKET_PORT`. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. Required. |
| `execution_environment` | `gen2` | Gen2 is required for Unix socket support. Do not change. |
| `cpu_always_allocated` | `false` | Vaultwarden serves on request by default (request-based billing). Flip to `true` only if you enable Vaultwarden's WebSocket push-notification server — throttled CPU between requests otherwise breaks the persistent WS connection clients poll on. |
| `timeout_seconds` | `300` | Maximum request duration in seconds (0–3600). |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep for rollback. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Note: IAP may prevent native Bitwarden clients from connecting. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | _(SMTP/log defaults)_ | Plain-text settings. Core `ROCKET_PORT`, `SIGNUPS_ALLOWED`, `WEB_VAULT_ENABLED`, `DATA_FOLDER`, and optionally `DOMAIN` are injected automatically. Default includes `LOG_LEVEL=warn`, `SHOW_PASSWORD_HINT=false`, and SMTP stub values. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. `{ SMTP_PASSWORD = "vaultwarden-smtp-pass" }`). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification cadence. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `30` | Retention; 30-day default reflects vault recovery importance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | **Recommended for Vaultwarden.** Provisions a Global HTTPS LB + Cloud Armor WAF to protect the login endpoint from brute-force. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `application_domains` | `[]` | Custom hostnames. Also set `domain` to the full `https://` URL. |
| `enable_cdn` | `false` | Cloud CDN. **Do not cache authenticated API responses** — ensure `Cache-Control: no-store` headers are in place. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the attachments bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets. |
| `enable_nfs` | `true` | Optional Filestore NFS volume. Not required for Vaultwarden in Cloud Run (data is in Cloud SQL and GCS). |
| `nfs_mount_path` | `/data` | NFS mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | `POSTGRES_15` (default) or `MYSQL_8_0`. The init job image is selected automatically. |
| `db_name` | `vaultwarden` | Database name. Immutable after first deploy. |
| `db_user` | `vaultwarden` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in database setup job (selects the correct image for PostgreSQL or MySQL automatically). |
| `cron_jobs` | `[]` | Vaultwarden has no required scheduled tasks; add custom Cloud Run Jobs here if needed. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/alive`, 30 s delay, 6 failures | Vaultwarden's dedicated health path; 30 s matches fast Rust startup. |
| `liveness_probe` | HTTP `/alive`, 30 s delay, 3 failures | Liveness probe. |
| `uptime_check_config` | disabled, `/alive` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Vaultwarden does not use Redis natively. Leave disabled unless adding a custom integration. |
| `redis_host` / `redis_port` / `redis_auth` | _(set)_ | Redis endpoint, port, and auth. |

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
| `signups_allowed` | `false` | Critical | Any internet user can self-register on the vault while `true`. Disable immediately after creating admin accounts. |
| `enable_cloudsql_volume` | `true` | Critical | Vaultwarden connects to Cloud SQL via Unix socket; disabling causes all database connections to fail at startup. |
| `db_name` / `db_user` | set once | Critical | Changing after first deploy causes Vaultwarden to connect to an empty database; all credentials appear lost. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `domain` | full `https://` URL | High | Without it, TOTP QR codes link to `localhost`, org invite emails contain broken links, and attachment URLs are invalid. |
| `database_type` | set once | High | Changing after first deploy causes Vaultwarden to see an empty database; all credentials appear lost. |
| `cpu_limit` | `1000m` or more | High | Cloud Run gen2 with always-allocated CPU rejects values below `1000m` at deploy time. |
| `container_port` | `80` | High | Must match `ROCKET_PORT`; a mismatch means Cloud Run health checks fail and all requests time out. |
| `execution_environment` | `gen2` | High | Gen1 does not support the Unix socket path used by the Cloud SQL Auth Proxy, causing database connection failures at startup. |
| `min_instance_count` | `1` | High | Scale-to-zero makes a password manager unavailable for 5–15 s on cold start; Bitwarden clients show connection errors. |
| `cpu_always_allocated` | `false` unless WS push enabled | Medium | Leaving `false` while the WebSocket push-notification server is enabled throttles CPU between requests and breaks the persistent WS connection; flip to `true` in that case. |
| `enable_cloud_armor` | enable for production | Medium | Without Cloud Armor, the Vaultwarden login endpoint is open to brute-force attacks from the internet. |
| `enable_cdn` | `false` or with cache controls | Medium | Caching authenticated API responses leaks vault data across users. |
| `backup_retention_days` | `30` (raise for prod) | Medium | A password manager without adequate retention means credential loss on database failure. |
| `enable_iap` with native clients | use with care | Medium | IAP requires browser-based OAuth; native Bitwarden clients cannot complete the IAP flow. |
| `smtp_*` env vars | configure as a complete set | High | Partial SMTP configuration causes silent email delivery failures — 2FA recovery codes and invitation emails are never sent. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Vaultwarden-specific application configuration
shared with the GKE variant is described in
**[Vaultwarden_Common](Vaultwarden_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Vaultwarden on Cloud Run](../labs/Vaultwarden_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Vaultwarden on GKE Autopilot](Vaultwarden_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Vaultwarden Common — Shared Application Configuration](Vaultwarden_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Synapse on Google Cloud Run](Synapse_CloudRun.md), [Element on Google Cloud Run](Element_CloudRun.md), [Headscale on Google Cloud Run](Headscale_CloudRun.md) in the **Secure Team Communications** solution.
