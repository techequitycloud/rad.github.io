---
title: "SimpleRisk on Google Cloud Run"
description: "Configuration reference for deploying SimpleRisk on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# SimpleRisk on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SimpleRisk_CloudRun.png" alt="SimpleRisk on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SimpleRisk is a free, open-source governance, risk and compliance (GRC) platform.
Security and compliance teams use it to keep a risk register, score risks, plan
and track mitigations, run management reviews and keep an auditable history for
assessors. This module deploys SimpleRisk on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services SimpleRisk uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

SimpleRisk runs as a PHP application under Apache on Cloud Run v2. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Apache + PHP, 1 vCPU / 2 GiB by default; scale-to-zero by default |
| Database | Cloud SQL for MySQL 8.0 | Required — `SimpleRisk_Common` fixes the engine; holds the risk register, users and sessions |
| Object storage | Cloud Storage (GCS FUSE) | A `storage` bucket mounted at `/var/www/simplerisk/files` for uploaded files; a generic `data` bucket is also created but unused |
| Secrets | Secret Manager | The database password only — SimpleRisk needs no other generated secret |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **The vendor image is not used as shipped.** `simplerisk/simplerisk` is an
  all-in-one appliance that runs its own MySQL server inside the container and
  keeps every piece of state in Docker volumes — ephemeral on Cloud Run, so the
  stock image would come back with an empty risk register after every cold
  start, with no error. `SimpleRisk_Common` builds a wrapper image whose
  entrypoint points SimpleRisk at Cloud SQL instead (see
  [SimpleRisk_Common](SimpleRisk_Common.md)).
- **MySQL 8.0 is mandatory**, reached over the instance's **private IP**
  (`DB_IP`) — `enable_cloudsql_volume = false`, no Auth Proxy socket.
- **There are no default credentials.** On first access SimpleRisk shows a
  *Default Admin Account Creation* form, and whoever submits it becomes the
  administrator. The service is public by default, so create the account as soon
  as the deployment finishes (see [§6](#6-configuration-pitfalls--sensible-defaults)).
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `max_instance_count = 1`). Sessions are stored in the database, so raising
  `max_instance_count` does not log users out when requests land on different
  instances.
- **Pin an exact image tag.** SimpleRisk tags are dated build ids
  (`20260909-001`, the default), not semver.
- **NFS is not used** (`enable_nfs = false`); uploaded files go to the GCS FUSE
  volume.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the SimpleRisk service

SimpleRisk runs as a Cloud Run v2 service that autoscales by request load between
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

All SimpleRisk data — risks, assessments, mitigations, users, and PHP sessions —
lives in a managed Cloud SQL for MySQL 8.0 instance. The service connects to the
instance's **private IP over TCP**. On first deploy two jobs run in order:
`db-init` creates the application database and user, then `schema-load` loads
SimpleRisk's schema (`/simplerisk.sql`, shipped inside the vendor image).

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage

`SimpleRisk_Common` declares a `storage` bucket (public access prevention
enforced) and, with `enable_gcs_storage_volume = true`, mounts it with GCS FUSE at
`/var/www/simplerisk/files`, where SimpleRisk keeps uploaded files. The
Foundation's generic `data` bucket (`storage_buckets`) is also created but
SimpleRisk does not use it. Both are created only when
`create_cloud_storage = true`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket-name>/
  ```

### D. Secret Manager

SimpleRisk itself mints no secrets. The only generated credential is the database
password, which the Foundation creates and injects as `DB_PASSWORD`; its secret
name is the `database_password_secret` output. Data-at-rest encryption (a
SimpleRisk Extra) is deliberately not enabled: it would introduce a key file on
the container filesystem, which is ephemeral on Cloud Run.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~simplerisk"
  ```

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`, `allUsers` invoker). An external HTTPS load balancer with a custom domain,
Cloud CDN, and Cloud Armor can be layered on with `enable_cloud_armor`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring. An uptime check is created only when `uptime_check_config`
is enabled **and** `min_instance_count >= 1` — a scale-to-zero service is not
probed.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. SimpleRisk Application Behaviour

- **What the wrapper entrypoint does on every boot.** It renders
  `/var/www/simplerisk/includes/config.php` from the vendor's
  `config.sample.php`, substituting the Foundation-injected `DB_IP`, `DB_PORT`,
  `DB_NAME`, `DB_USER` and `DB_PASSWORD` with PHP `str_replace` (a generated
  password containing `/`, `&` or `\` would break a `sed` substitution), and sets
  `USE_DATABASE_FOR_SESSIONS` to `true`. It then starts Apache. If `DB_IP`,
  `DB_NAME`, `DB_USER` or `DB_PASSWORD` is missing, the container exits rather than
  starting against nothing.
- **Port 80 serves the application.** The vendor image serves SimpleRisk only on
  443 and turns port 80 into an HTTP-to-HTTPS redirect, which behind Cloud Run's
  TLS termination is an infinite redirect loop. The wrapper rewrites the port-80
  virtual host to serve `/var/www/simplerisk` directly (keeping the vendor's
  security headers, deliberately dropping HSTS) and removes the 443 virtual host.
- **Two-stage init chain.** `db-init` (`mysql:8.0-debian`, up to 3 retries)
  creates the user and database, grants privileges and verifies the app user can
  connect. `schema-load` (app image, depends on `db-init`, up to 2 retries) counts
  the tables in the database and loads `/simplerisk.sql` only if there are none,
  then counts again to confirm the load landed. Both jobs are created with
  `execute_on_apply = true` and are safe to re-run. A fresh load produces about 154 tables.
- **Health check behaviour.** Startup and liveness probes are HTTP `GET /`
  (startup: 30s initial delay, 15s period, 20 failures allowed). Note that the
  page renders before SimpleRisk needs the database, so a passing probe does not
  prove the database connection works — use the first-run form or a login to
  check that.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```
- **First-run administrator.** On first access SimpleRisk renders a *Default Admin
  Account Creation* form; submitting it creates the administrator. Seeing that
  form is also the proof that the app is talking to the (empty-of-users) Cloud
  SQL database.
- **Scheduled tasks.** The wrapper runs Apache only — the vendor's
  supervisord-managed `cron` is not started — so SimpleRisk's scheduled reports
  and notifications do not run inside the container. Use `cron_jobs` if you need
  them; an entry without `image` runs the app image.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for SimpleRisk are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `tenant_id` | `demo` | Short suffix (1–7 lowercase alphanumerics) that makes resource names unique per environment. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. A `module` key is reserved by the foundation and is overwritten. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `simplerisk` | Base name for resources. Do not change after first deploy. |
| `display_name` | `SimpleRisk` | Human-readable name shown in the Console. |
| `description` | `SimpleRisk IT asset management on Cloud Run` | Cloud Run service description; the shipped wording is a leftover and purely cosmetic. |
| `application_version` | `20260909-001` | `simplerisk/simplerisk` tag, passed to the build as `SIMPLERISK_VERSION`. Dated build ids, not semver. |
| `php_memory_limit` | `512M` | Injected as the lowercase `memory_limit` env var. The vendor entrypoint that read it is replaced by the module's own, which does not. |
| `admin_email` | `admin@example.com` | Not used — the administrator is created through SimpleRisk's first-run form. |
| `enable_gcs_storage_volume` | `true` | GCS-FUSE-mount the `storage` bucket at `/var/www/simplerisk/files`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the wrapper image via Cloud Build. `prebuilt` skips the wrapper — the stock image cannot use Cloud SQL. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Autoscaling upper bound. |
| `container_port` | `80` | Apache serves SimpleRisk on port 80. |
| `execution_environment` | `gen2` | Required for the GCS FUSE mount. |
| `timeout_seconds` | `300` | Max request duration (0–3600). |
| `enable_cloudsql_volume` | `false` | Keep `false` — the app connects to `DB_IP` over TCP. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `service_annotations` | `{}` | Custom-namespace keys only; `run.googleapis.com/*` keys are rejected by the Cloud Run v2 API at apply time. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal-and-cloud-load-balancing` closes the public `run.app` URL. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Uppercase values (`ALL_TRAFFIC`), unlike `ingress_settings`. |
| `enable_iap` | `false` | Require Google sign-in; also removes the `allUsers` invoker binding. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Merged over the module defaults (`DB_PORT = "3306"`, `memory_limit`); the Foundation's `DB_*` variables are kept. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `protect_sensitive_environment_variables` | `true` | Moves credential-looking `environment_variables` into Secret Manager. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated database backup cron (UTC), run by Cloud Scheduler. |
| `backup_retention_days` | `7` | Retention, enforced as a lifecycle rule on the backups bucket. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & NFS Instance

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. Do not
use them to alter SimpleRisk's own tables. `nfs_instance_name` and
`nfs_instance_base_name` apply only when `enable_nfs = true`. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges allowed for privileged access. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Apply only to an inline-created Artifact Registry repository — no effect when images go to the `Services_GCP` shared repository. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the `storage` bucket and the generic `data` bucket. |
| `enable_nfs` | `false` | Not needed by SimpleRisk. |
| `nfs_mount_path` | `/var/lib/simplerisk` | Only used when `enable_nfs = true`; SimpleRisk does not write there. |
| `gcs_volumes` | `[]` | Extra GCS FUSE mounts (the `storage` mount is added automatically). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `SimpleRisk_Common`. |
| `db_name` / `db_user` | `simplerisk` | Passed to `SimpleRisk_Common`. Do not change after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). Changing it on a running deployment breaks authentication (see §6). |
| `enable_auto_password_rotation` | `false` | Automated password rotation. |
| `db_host_env_var_name` | `DB_IP` | Keep `DB_IP` — the entrypoint and `schema-load` read it. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `schema-load` chain; a non-empty list replaces both. |
| `cron_jobs` | `[]` | No scheduled tasks by default. An entry without `image` runs the app image. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, 30s delay, 15s period, 20 retries | The vendor image's own health path. |
| `liveness_probe` | HTTP `GET /`, 60s delay, 30s period, 3 retries | Same path. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Created only when enabled and `min_instance_count >= 1`. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | SimpleRisk has no Redis integration. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires an organization). |
| `vpc_sc_dry_run` | `true` | Log violations without blocking. |
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
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `schema-load`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
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
| First-run administrator form | Create the admin account immediately after deploy, or restrict access first | **Critical** | SimpleRisk has no default credentials; whoever submits the *Default Admin Account Creation* form first becomes administrator. With `ingress_settings = "all"` and the `allUsers` invoker binding, that can be anyone who finds the URL. `ingress_settings = "internal-and-cloud-load-balancing"` or `enable_iap = true` closes the public URL. |
| `container_image_source` | `custom` | **Critical** | `prebuilt` deploys an image without the wrapper entrypoint; the stock image ignores Cloud SQL, runs its own MySQL in the container and loses all data on every cold start, silently. |
| `db_name` / `db_user` | Set once | **Critical** | Changing them points SimpleRisk at a new, empty database. |
| `database_password_length` | Leave unchanged after first deploy | **High** | Changing it writes a new password to Secret Manager without updating the Cloud SQL user, so the service and both jobs fail to authenticate. The HTTP probes stay green because `/` renders without the database. Re-run the `db-init` job (it runs `ALTER USER`) to resync. |
| `application_version` | An exact dated tag | **High** | A rebuild under an unchanged tag produces no Terraform diff and no new revision — the running service keeps the old image. |
| `initialization_jobs` | `[]` | **High** | Any non-empty list replaces `db-init` and `schema-load`; the schema is then never loaded into a fresh database. |
| `db_host_env_var_name` | `DB_IP` | **High** | The entrypoint requires `DB_IP`; without it the container exits at start. |
| `enable_backup_import` | `false` unless restoring | **Critical** | Enabling without a valid `backup_uri` fails the import job. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero adds cold-start latency, and no uptime check is created while it is `0`. |
| `enable_cloud_armor` | enable for production | Medium | The service is publicly reachable without WAF protection by default. |
| `service_annotations` | custom-namespace keys only | Low | `run.googleapis.com/*` keys pass the plan and fail at apply ("system annotations are not supported"). |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. The SimpleRisk-specific application layer
is described in **[SimpleRisk_Common](SimpleRisk_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: SimpleRisk on Cloud Run](../labs/SimpleRisk_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [SimpleRisk Common — Shared Application Configuration](SimpleRisk_Common.md) — the application layer this module builds on.
