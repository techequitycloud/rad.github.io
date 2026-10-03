---
title: "Roundcube on Google Cloud Run"
description: "Configuration reference for deploying Roundcube on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Roundcube on Google Cloud Run

Roundcube is a free, open-source, browser-based IMAP webmail client. It gives
users a desktop-like mail experience — folders, address book, search and message
composition — against an IMAP and SMTP mail server that already exists. Roundcube
is a mail **client**: this module deploys no mail server. It deploys Roundcube on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Roundcube uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Roundcube runs as a PHP container (the official `roundcube/roundcubemail`
`-apache` image, wrapped by a thin custom entrypoint) on Cloud Run v2. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero by default |
| Database | Cloud SQL for MySQL 8.0 | Roundcube's own data — preferences, contacts, session data. Mail itself stays on the IMAP server |
| Object storage | Cloud Storage | A generic `data` bucket is provisioned, but Roundcube does not read or write it |
| Secrets | Secret Manager | Auto-generated `des_key` (`ROUNDCUBEMAIL_DES_KEY`); database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |
| Mail | _(none — external)_ | You supply the IMAP and SMTP servers |

**Sensible defaults worth knowing up front:**

- **No IMAP or SMTP server is configured.** The module sets
  `ROUNDCUBEMAIL_DEFAULT_HOST` and `ROUNDCUBEMAIL_SMTP_SERVER` to empty values,
  and this wrapper exposes no input for them. Set them in
  `environment_variables` (Group 6) before anyone can sign in — see
  [§3](#3-roundcube-application-behaviour).
- **No local accounts.** Users sign in with their IMAP username and password.
  There is no administrator account and no admin-password secret.
- **MySQL 8.0 only.** The wrapper entrypoint always composes a `mysql://` DSN.
- **`enable_cloudsql_volume = false`.** The DSN uses `DB_IP`, the Cloud SQL
  private IP, so Cloud Run connects over **private-IP TCP**, not the Auth Proxy
  Unix socket.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `max_instance_count = 1`). Cold starts add latency to the first request after
  idle; set `min_instance_count = 1` to avoid this.
- **No separate schema job.** The image runs `bin/installto.sh -y` on every
  start, which creates and upgrades the schema idempotently. Only `db-init`
  runs as a Cloud Run job.
- **Pinned image tag.** `application_version = "1.6.19-apache"`. Keep it an
  exact tag — a rolling tag rebuilds without producing a new revision.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Roundcube service

Roundcube runs as a Cloud Run v2 service that autoscales by request load between
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

### B. Cloud SQL for MySQL 8.0

Roundcube stores its own data — user preferences, address-book contacts and
session data — in a managed Cloud SQL for MySQL 8.0 instance. Mail is never
stored here; it stays on the IMAP server. The service connects over the
instance's **private IP via TCP**. On first deploy, the `db-init` job creates the
application database and user; the schema is then created by Roundcube itself
(`bin/installto.sh -y`) when the container starts.

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

A generic `data` bucket is provisioned by default (via the Foundation's
`storage_buckets` input), but Roundcube never reads or writes it: `gcs_volumes`
is empty, so no bucket is mounted into the container. Attachments in flight are
written to container-local scratch (`ROUNDCUBEMAIL_TEMP_DIR = /tmp/roundcube-temp`),
which is safe to lose on a cold start.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager

One application secret is generated automatically: the 24-character `des_key`,
stored as `secret-<prefix>-roundcube-des-key` and injected as
`ROUNDCUBEMAIL_DES_KEY`. Roundcube uses it to encrypt session data and the IMAP
password it holds on each signed-in user's behalf. The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~des-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.
Roundcube also makes **outbound** connections to your IMAP and SMTP servers; with
the default `vpc_egress_setting = PRIVATE_RANGES_ONLY`, traffic to a public mail
server leaves directly rather than through the VPC.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring. The uptime check is **off** by default
(`uptime_check_config.enabled = false`); alert policies are optional.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Roundcube Application Behaviour

- **Pointing Roundcube at a mail server.** `Roundcube_Common` sets these
  environment variables, and `environment_variables` (Group 6) is merged over
  them, so that is where you configure the mail server:

  | Variable | Default | Meaning |
  |---|---|---|
  | `ROUNDCUBEMAIL_DEFAULT_HOST` | `""` | IMAP server users sign in against. `ssl://host` for implicit TLS, `tls://host` for STARTTLS; a bare host name is cleartext. |
  | `ROUNDCUBEMAIL_DEFAULT_PORT` | `993` | IMAP port — 993 for implicit TLS, 143 for STARTTLS. |
  | `ROUNDCUBEMAIL_SMTP_SERVER` | `""` | SMTP server used for sending. |
  | `ROUNDCUBEMAIL_SMTP_PORT` | `587` | Submission port — 587 or 465. **Never 25**: Google Cloud blocks outbound port 25. |
  | `ROUNDCUBEMAIL_SKIN` | `elastic` | Roundcube skin. |

  `Roundcube_Common` has `imap_host`/`imap_port`/`smtp_host`/`smtp_port`/`skin`
  inputs that feed these values, but `Roundcube_CloudRun` does not declare or
  forward them, so on this wrapper `environment_variables` is the only way in.
- **Sign-in.** Open the service URL and sign in with an account on the IMAP
  server. Roundcube has no local or administrator accounts.
- **Database DSN.** The wrapper entrypoint composes
  `ROUNDCUBEMAIL_DSNW=mysql://DB_USER:<password>@DB_IP:DB_PORT/DB_NAME` with the
  password URL-encoded by PHP's `rawurlencode`, sets `ROUNDCUBEMAIL_DSNR` to the
  same value, and hands off to the image's own `/docker-entrypoint.sh`. The
  vendor entrypoint would otherwise interpolate the password raw, which fails on
  the `@ : / ? # % & +` characters Cloud SQL passwords contain.
- **Schema.** There is no schema job: the image runs `bin/installto.sh -y` on
  every start, creating the schema on first boot and upgrading it after a
  version change.
- **PHP memory limit.** `php_memory_limit` reaches the container as
  `PHP_MEMORY_LIMIT`; the entrypoint writes it into
  `/usr/local/etc/php/conf.d/zz-rad-overrides.ini`, overriding the image's own
  `memory_limit=64M`. The container log confirms it at start:
  `[startup] PHP memory_limit set to 512M via ...`.
- **Health check behaviour.** Both probes are **HTTP `GET /`**, where Roundcube
  serves its login form. The startup probe allows a 30 s delay plus 20 × 15 s
  attempts, because the image runs `installto.sh` and waits for the database
  before Apache starts.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
  ```
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Roundcube are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `tenant_id` | `demo` | Short suffix (1–7 lowercase alphanumeric characters) that makes resource names unique per environment. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `roundcube` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Roundcube` | Human-readable name shown in the Console. |
| `application_version` | `1.6.19-apache` | `roundcube/roundcubemail` tag, passed as the `ROUNDCUBE_VERSION` build ARG. This wrapper's value is the one that wins. Pin an exact `-apache` tag. |
| `php_memory_limit` | `512M` | PHP `memory_limit`, applied through `conf.d/zz-rad-overrides.ini`. |
| `admin_email` | `admin@example.com` | **No effect** — Roundcube creates no accounts. |
| `enable_gcs_storage_volume` | `true` | **No effect** — `Roundcube_Common` declares it but never uses it; nothing is mounted. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the wrapper image via Cloud Build. `"prebuilt"` skips the wrapper entrypoint, so the DSN is no longer URL-encoded and `php_memory_limit` stops working. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Autoscaling upper bound. |
| `container_port` | `80` | Apache listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | `300` | Max request duration. |
| `enable_cloudsql_volume` | `false` | The DSN uses `DB_IP` over TCP; the socket is not used. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress by default. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. Use `ALL_TRAFFIC` only if the IMAP/SMTP servers must be reached through the VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the Roundcube login. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, merged over the module defaults. Set `ROUNDCUBEMAIL_DEFAULT_HOST`, `ROUNDCUBEMAIL_DEFAULT_PORT`, `ROUNDCUBEMAIL_SMTP_SERVER`, `ROUNDCUBEMAIL_SMTP_PORT` and, optionally, `ROUNDCUBEMAIL_SKIN` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `protect_sensitive_environment_variables` | `true` | Credential-named keys typed into `environment_variables` are moved into Secret Manager automatically. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & NFS server

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning.
`nfs_instance_name` / `nfs_instance_base_name` select or name an NFS VM, and only
matter if `enable_nfs` is turned on. See [App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR allowlist for privileged access. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the generic `data` GCS bucket. Not read or written by Roundcube. |
| `enable_nfs` | `false` | Not needed — the image declares no volumes and keeps no state on disk that must survive a restart. |
| `nfs_mount_path` | `/var/lib/roundcube` | Mount path, only used when `enable_nfs = true`. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). Empty — nothing is mounted. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Must stay MySQL — the entrypoint composes a `mysql://` DSN. The picker also offers `POSTGRES` and `NONE`; neither works. |
| `db_name` / `db_user` | `roundcube` | Tenant-prefixed at deploy time. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). Set once — changing it on a running deployment breaks database authentication. |
| `enable_auto_password_rotation` | `false` | Automated database password rotation. |
| `rotation_propagation_delay_sec` | `90` | Wait after rotation before restarting the service. |
| `db_host_env_var_name` | `DB_IP` | Additional name for the DB host IP. The Foundation already injects `DB_IP`, which is what the entrypoint reads, so the default only duplicates it. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Supplying any list replaces it. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, 30s delay, 10s timeout, 15s period, 20 retries | Waits for `installto.sh` and the database before Apache starts. |
| `liveness_probe` | HTTP `GET /`, 60s delay, 10s timeout, 30s period, 3 retries | The login form at the document root. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Cloud Monitoring uptime check — off by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | This module wires no Redis integration into Roundcube. |
| `redis_host` | `""` | Redis endpoint. |
| `redis_port` | `6379` | Redis port. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
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
| `stage_services` | Cloud Deploy stage services (when enabled). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ROUNDCUBEMAIL_DEFAULT_HOST` / `ROUNDCUBEMAIL_SMTP_SERVER` (via `environment_variables`) | Your IMAP and SMTP servers | **High** | Left empty by default. The service is healthy and serves its login form, but no user can sign in or send mail. A green health check is not evidence that mail works. |
| `ROUNDCUBEMAIL_SMTP_PORT` | `587` or `465` | **High** | Google Cloud blocks outbound port 25 for all egress; sending through port 25 never succeeds. |
| `ROUNDCUBEMAIL_DEFAULT_HOST` scheme | `ssl://host` or `tls://host` | **High** | A bare host name connects in cleartext, sending users' IMAP passwords unencrypted. Use a bare host only for a server inside the VPC. |
| `ROUNDCUBEMAIL_DES_KEY` (auto-generated) | Never hand-edit in Secret Manager | High | It encrypts session data and the stored IMAP passwords. Changing it signs every user out; removing it makes the vendor image mint a different key per container, logging users out at random across instances and cold starts with nothing in the logs. |
| `container_image_source` | `custom` | **Critical** | `prebuilt` deploys an image without the wrapper entrypoint — the database password is no longer URL-encoded into the DSN, so the connection fails on the punctuation Cloud SQL passwords contain. |
| `database_type` | `MYSQL_8_0` | **Critical** | The entrypoint always builds a `mysql://` DSN. Any other engine (or `NONE`) leaves Roundcube without a usable database. |
| `application_version` | An exact `-apache` tag | Medium | `latest` or a rolling `1.6.x-apache` tag can change content under the same tag string, which produces no Terraform diff and no new revision — the running container silently keeps the old image. The `-fpm` variants have no web server. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and loses stored preferences and contacts. |
| `database_password_length` | Set once, at first deploy | High | Changing it on a running deployment writes a new password the database does not hold, and every connection fails until the database job is re-run. |
| `php_memory_limit` | `512M` or higher | Medium | The image's own default is 64M; large messages and attachments are where a small PHP heap runs out. |
| `admin_email`, `enable_gcs_storage_volume` | Leave as-is | Low | Neither has any effect on this module, whatever their descriptions say. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start latency, including the `installto.sh` run, to the first request after idle. |
| `enable_cloud_armor` | enable for production | Medium | The login form is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Roundcube-specific application configuration
is described in **[Roundcube_Common](Roundcube_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Roundcube on Cloud Run](../labs/Roundcube_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Roundcube Common — Shared Application Configuration](Roundcube_Common.md) — the application layer this module builds on.
