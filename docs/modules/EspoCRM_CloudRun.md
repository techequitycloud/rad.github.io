---
title: "EspoCRM on Google Cloud Run"
description: "Configuration reference for deploying EspoCRM on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# EspoCRM on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EspoCRM_CloudRun.png" alt="EspoCRM on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

EspoCRM is an open-source, GPLv3-licensed Customer Relationship Management (CRM)
platform built on PHP and Apache. This module deploys EspoCRM on **Cloud Run v2** on top
of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services EspoCRM uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every
Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What EspoCRM costs on RAD, and how that compares

**In a Google Cloud project you own, EspoCRM on RAD's Cloud Run module costs about US$84 a month, plus US$7.50 once per deployment and no per-user licence.** GKE Autopilot is the alternative for workloads that must stay up continuously or run beside other Kubernetes apps; see the [GKE guide](EspoCRM_GKE.md), about US$110 a month. EspoCRM is a free, open-source CRM that manages accounts, contacts, leads, opportunities and cases. Figures are as at 8 October 2026; sources are listed at the end of this section.

If this runs in a project RAD manages for you, it can be deleted and restored within 30 days for a few credits instead of sitting there running — so an occasional-use deployment costs a few dollars a month, not US$84. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$84 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1 vCPU / 2 GiB, scaling to zero | US$13 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| NFS/cache file server: a small VM | US$13 |
| Cloud NAT gateway and IP address | US$5 |
| Cloud Storage for add-ons and backups | US$1 |
| **Total** | **about US$84** |


### How it compares

EspoCRM has its own official hosted plan, **EspoCRM Cloud**: EspoCRM's own official hosted plans are £11/user/month (Basic, minimum 3 users), £19/user/month (Enterprise, minimum 5 users) and £49/user/month (Ultimate, minimum 10 users) — read 8 October 2026.

| Option | Per month | Who runs it |
|---|---|---|
| EspoCRM Cloud, Basic (3 users min.) | £33/mo (3 × £11) | EspoCRM |
| EspoCRM Cloud, Enterprise (5 users min.) | £95/mo (5 × £19) | EspoCRM |
| **RAD, Cloud Run, your own project** | **US$84**, plus US$7.50 once | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **about 960 credits (US$96)** | RAD |
| RAD, GKE Autopilot | about US$110; see the [GKE Autopilot guide](EspoCRM_GKE.md) | RAD |

EspoCRM Cloud's price was read from its own pricing page on 8 October 2026 and may have changed since — check the source before relying on the figure.

- **EspoCRM Cloud is the fixed comparison; a self-managed server is the flexible one.** On your own Hetzner or DigitalOcean box (2 vCPU/4GB, about US$24/month) or a GCP Compute Engine e2-standard-2 (2 vCPU/8GB, about US$49/month) you would pay less in cash than either option, but you run the operating system, the database, backups, security patches and upgrades yourself — exactly what RAD's managed Cloud SQL, Secret Manager and monitoring do for you.
- **A cheap server is cheap until something breaks.** On RAD, backups, point-in-time recovery, password rotation through Secret Manager, and logging and monitoring come from Google Cloud by default. On your own server, or on a fixed-price hosted plan with no infrastructure control, each of those is a job someone still has to do or a limit you cannot change.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If EspoCRM runs in **a project RAD manages for you**, you have an option beyond scaling down: **delete the whole project, and restore it within 30 days for close to nothing.** This suits a deployment you only need occasionally — studying for a certification, a demo, a seasonal need — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove it immediately: it keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud SQL, the VM or Cloud Run one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That costs a handful of build-time credits in total (under US$1) for a typical 2–3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$84.** Deploy EspoCRM, use it for a session, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside the project, and that bucket has Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you've customised this deployment and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests, so most of its own compute cost stops on its own when nobody is using it. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 80 credits (US$8). Deleting saves money if EspoCRM would otherwise sit unused for about 3 days or more in your own project (about US$2.79 a day), or about 3 days or more in a RAD-managed one (32 credits a day).
- **Delete everything EspoCRM uses.** Most of the running cost is usually the database and any shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
- **Keep data first.** Nightly backups go to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets EspoCRM in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanism; [EspoCRM Cloud pricing](https://www.espocrm.com/pricing/). Prices change; check each source before relying on a figure.

## 1. Overview

EspoCRM runs as a PHP/Apache container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Apache/PHP service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — EspoCRM does not support PostgreSQL; connected over private-IP TCP |
| Object storage | Cloud Storage + Filestore (NFS) | A dedicated `gcs-espocrm<tenant-prefix>-espocrm-data` GCS bucket is provisioned but **not mounted** by default; a shared NFS volume is mounted at `/var/www/html/data` for uploads (`enable_nfs = true` by default) |
| Cache | Redis (optional) | Optional object cache; disabled by default |
| Secrets | Secret Manager | Auto-generated `ESPOCRM_ADMIN_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`database_type = "MYSQL_8_0"`); EspoCRM does not support PostgreSQL.
- **The database is reached over private-IP TCP, not a socket.** `enable_cloudsql_volume`
  defaults to `false` on Cloud Run. EspoCRM's MySQL PDO connection needs a real TCP host,
  so `cloud-entrypoint.sh` dials the Cloud SQL private IP (`DB_IP`). Cloud SQL MySQL does
  not force SSL on private-IP TCP, so no extra TLS wiring is required.
- **The admin account is bootstrapped automatically.** The upstream installer creates the
  `admin` user with the auto-generated `ESPOCRM_ADMIN_PASSWORD` on first boot — retrieve
  it from Secret Manager to log in.
- **Schema is created on first boot, not by a migrate job.** `db-init` creates the
  database and user; the upstream `docker-entrypoint.sh` then runs the install/migrate
  action automatically when the container starts.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max_instance_count = 1`).
  Cold starts add several seconds of latency to the first request after idle. Set
  `min_instance_count = 1` to avoid cold starts.
- **NFS is enabled by default.** `enable_nfs = true` mounts a shared Filestore volume at
  `/var/www/html/data`, so EspoCRM's uploaded attachments and runtime data persist across
  container restarts and are shared across instances — unlike a bare Cloud Run
  deployment with only ephemeral disk. The auto-provisioned `gcs-espocrm<tenant-prefix>-espocrm-data` GCS bucket is
  **not** mounted anywhere by default.
- **Single instance by default.** `max_instance_count = 1` — Cloud Run has no built-in
  session affinity, so keep the service single-instance unless you have verified
  EspoCRM's behaviour under concurrent PHP sessions across replicas.
- **`ESPOCRM_SITE_URL` is derived from the predicted service URL** at plan time and
  resolved by the entrypoint, so EspoCRM's absolute links and installer checks use the
  real Cloud Run host rather than `localhost`.
- **Public ingress by default.** `ingress_settings = "all"` so the CRM UI is reachable;
  enabling IAP puts Google sign-in in front of it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the EspoCRM service

EspoCRM runs as a Cloud Run v2 service that autoscales by request load between the minimum
and maximum instance counts. Each deployment creates an immutable revision; traffic can be
split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Cloud SQL for MySQL 8.0

EspoCRM stores all application data (contacts, leads, opportunities, activities, users) in
a managed Cloud SQL for MySQL 8.0 instance. Because `enable_cloudsql_volume` defaults to
`false`, the service connects over the **private IP** (`DB_IP`) via VPC egress on port
`3306`; no public IP is exposed. On first deploy an initialization Job creates the
application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs).
See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

### C. Cloud Storage & NFS

A dedicated **Cloud Storage** bucket (`gcs-espocrm<tenant-prefix>-espocrm-data`) is provisioned automatically, but
it is **not mounted** anywhere by default (`gcs_volumes` defaults to `[]`). The actual
persistent store for EspoCRM's uploaded attachments and runtime data is a shared **NFS
(Filestore)** volume, mounted at `/var/www/html/data` because `enable_nfs = true` by
default. Additional GCS buckets can be declared via `storage_buckets`, and mounted via
`gcs_volumes` (requires the gen2 execution environment) if you want to use the bucket.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Redis (object cache)

Redis is **disabled by default**. When `enable_redis = true` is set, `REDIS_HOST` and
`REDIS_PORT` are injected and EspoCRM uses Redis as its object cache backend to reduce
database load. When `redis_host` is left empty and `enable_nfs` is true, the NFS server
VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

The first-run admin password (`ESPOCRM_ADMIN_PASSWORD`) is generated automatically and
stored in Secret Manager, then injected into the service as a secret env var. The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity. EspoCRM connects to Cloud SQL over the VPC, so VPC egress
must reach the private IP.

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

The `cloud-entrypoint.sh` prints the resolved `ESPOCRM_DATABASE_*` and `ESPOCRM_SITE_URL`
values at startup — a quick way to confirm the DB host and site URL the container is using.

---

## 3. EspoCRM Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It resolves the Cloud SQL connection (Auth Proxy socket if present,
  otherwise private-IP TCP), idempotently creates the application database and user, grants
  privileges, and verifies the app user can connect (warming the MySQL 8
  `caching_sha2_password` auth cache). The job runs on apply and is safe to re-run.
- **Schema created on first boot.** There is no separate migrate job. Once `db-init` has
  provisioned the database, the upstream EspoCRM `docker-entrypoint.sh` runs the
  install/migrate action automatically on container start, creating the schema and the
  `admin` user.
- **Admin login is auto-generated.** The `admin` user's password comes from the
  `ESPOCRM_ADMIN_PASSWORD` secret. Retrieve it before your first login:
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
  ```
  Change it in the EspoCRM UI (Administration → Users) once you are in.
- **Site URL must match the reachable host.** EspoCRM builds absolute links from
  `ESPOCRM_SITE_URL`; the entrypoint sets it from the predicted `run.app` URL (or
  `CLOUDRUN_SERVICE_URL` at runtime). If you front the service with a custom domain, set
  the site URL to that host so links and OAuth redirects are correct.
- **Health path.** Startup uses a TCP probe on port `80`; the liveness probe is
  `HTTP GET /` — EspoCRM serves its login page there unauthenticated (`200`). Allow
  several minutes on first boot for the install/migrate step (the default liveness probe
  has a 300-second initial delay).
- **Uploads persist on NFS.** With `enable_nfs = true` (default), EspoCRM's attachments
  and runtime data live under the shared `/var/www/html/data` Filestore mount, surviving
  container restarts and shared across instances. The `gcs-espocrm<tenant-prefix>-espocrm-data` GCS bucket is
  provisioned but not mounted by default.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for EspoCRM are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `espocrm` | Base name for resources. Do not change after first deploy. |
| `display_name` | `EspoCRM` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Image tag for `espocrm/espocrm`; `latest` is pinned internally to `10.0.2`. Pin to a specific release in production. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy plugins or large media. |
| `upload_max_filesize` | `64M` | Maximum single-file upload size (≤ `post_max_size`). |
| `post_max_size` | `64M` | Maximum POST size; must be ≥ `upload_max_filesize`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; minimum 1 vCPU for EspoCRM + MySQL. |
| `memory_limit` | `2Gi` | Memory per instance; minimum 512Mi (PHP 8.x). |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Keep at `1` unless shared storage + session affinity are confirmed. |
| `container_port` | `80` | Apache listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | EspoCRM connects to MySQL over private-IP TCP, not the socket. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access to the CRM UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route RFC 1918 traffic (incl. Cloud SQL private IP) via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of EspoCRM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the `gcs-espocrm<tenant-prefix>-espocrm-data` bucket. Not mounted anywhere unless you add a matching `gcs_volumes` entry. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket definitions provisioned when `create_cloud_storage` is true. |
| `enable_nfs` | `true` | Mounts a shared Filestore volume for EspoCRM's uploaded attachments and runtime data — persists across restarts by default. |
| `nfs_mount_path` | `/var/www/html/data` | Container mount path for the NFS volume. |
| `gcs_volumes` | `[]` | No GCS Fuse mount by default; the `gcs-espocrm<tenant-prefix>-espocrm-data` bucket stays unmounted unless you add an entry here. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Cloud SQL engine. EspoCRM requires MySQL — do not select PostgreSQL. |
| `db_name` | `espocrm` | MySQL database name. Immutable after first deploy. |
| `db_user` | `espocrm` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated DB password length (valid range 16–64). |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis as EspoCRM's object cache backend. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `redis_port`/`backup_retention_days`, a `gen1` runtime with NFS/GCS mounts, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | EspoCRM only supports MySQL; selecting PostgreSQL breaks startup. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `ESPOCRM_ADMIN_PASSWORD` (auto-generated) | Retrieve from Secret Manager; change in UI | Critical | Only sets the admin password on the **first** install; losing it locks you out until reset via DB. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup URI fails the import job. |
| `enable_nfs` | `true` | High | Disabling it drops EspoCRM's attachment storage to ephemeral container disk — uploads are lost when an instance scales down or is recycled. |
| `max_instance_count` | `1` unless verified safe | Medium | Uploads are NFS-backed by default, but Cloud Run has no built-in session affinity — verify EspoCRM's behaviour under concurrent PHP sessions before scaling beyond 1 instance. |
| `enable_cloudsql_volume` | `false` (private-IP TCP) | High | Forcing the socket without a matching entrypoint path can break the MySQL connection; EspoCRM dials the private IP by design. |
| `ESPOCRM_SITE_URL` (auto-derived) | Actual service / custom-domain URL | High | A wrong site URL breaks absolute links, the installer check, and OAuth redirects. |
| `memory_limit` | `2Gi` | High | Below 512Mi PHP 8.x OOM-kills during install/migrate and under load. |
| `cpu_limit` | `1000m` | Medium | Below 1 vCPU slows first-boot install and heavy plugin processing. |
| `enable_iap` | only when public UI not needed | Medium | IAP requires Google sign-in for every request, including API integrations. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start delay and, without a shared volume, drops local uploads on scale-down. |
| `application_version` | Pin in production | Medium | `latest` maps to a pinned tag internally, but pinning explicitly avoids surprise upgrades on redeploy. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
EspoCRM-specific application configuration shared with the GKE variant is described in
**[EspoCRM_Common](EspoCRM_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: EspoCRM on Cloud Run](../labs/EspoCRM_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [EspoCRM on GKE Autopilot](EspoCRM_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [EspoCRM Common — Shared Application Configuration](EspoCRM_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Cyclos on Google Cloud Run](Cyclos_CloudRun.md), [Listmonk on Google Cloud Run](Listmonk_CloudRun.md), [Metabase on Google Cloud Run](Metabase_CloudRun.md), [Vaultwarden on Google Cloud Run](Vaultwarden_CloudRun.md) in the **Financial Inclusion & Community Banking** solution.
