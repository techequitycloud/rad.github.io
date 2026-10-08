---
title: "Monica on Google Cloud Run"
description: "Configuration reference for deploying Monica on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Monica on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Monica_CloudRun.png" alt="Monica on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Monica is an open-source personal relationship management (PRM) application — a
"personal CRM" for organising how you stay in touch with friends, family, and
contacts. This module deploys Monica on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Monica uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Monica costs on RAD, and how that compares

**Running Monica in your own GCP project costs about $83.61/month in Google Cloud charges; RAD's module fee is a one-time 75 credits (or 67.5 credits in a RAD-managed project), covering setup and support -- not the ongoing cloud bill, which Google bills you directly in your own project or RAD meters hourly in credits in a RAD-managed one.**
Or see the GKE guide for the alternative deployment target; either way, if you deploy into a RAD-managed project you can pause the whole thing for free when you are not using it -- see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Your own project | RAD-managed project |
|---|---|---|
| Module fee | 75 credits, once | 67.5 credits, once (10% lower) |
| Build time | metered in credits as the build runs (a few credits, typically) | same |
| Google Cloud running cost | ~$83.61/month, billed to your own billing account at Google's list price | ~32 credits/day, metered hourly by RAD at list price plus margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | $13.16 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| NFS/cache file server (small VM) | $13.43 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| **Total** | **$83.61** |

### How it compares

- Monica's own official hosted version costs **$9/month** ($90/year billed annually) (source: https://www.monicahq.com/en/pricing), run by the project itself with no infrastructure to operate -- the comparison that matters here is less the sticker price and more whether you want the vendor's own cloud or your own GCP project with RAD managing it.
- Running it yourself on a bare VPS is still the cheapest cash option -- Hetzner CPX22 (2 vCPU/4GB) runs about **$24/month**, a DigitalOcean 2 vCPU/4GB Droplet is also **$24/month**, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about **$49/month** -- plus the admin's own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you -- but RAD's price is never meant to beat a VPS, only to replace the admin time a VPS still needs.
- Either way, this is a single-user personal CRM, so the running cost above is what actually drives the bill, not the module fee -- and that running cost is the one you can pause (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

**This is the headline for a RAD-managed project.** Deleting a RAD-managed project first unlinks
its billing, then asks Google to delete the project outright -- Google's own 30-day recoverable
soft delete. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the
compute resource one by one: the whole project simply stops, and nothing is charged while it
waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project
and reattaches its billing account, then asks you to run Update on each deployment to confirm
everything came back. Because nothing was individually destroyed, that Update finds the same
resources already there -- it is a check, not a rebuild, and an Update never charges the module
fee again. This costs only a handful of credits (under US$1) in total for a typical 2-3-deployment
chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days -- after that Google deletes it for good -- and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

**One real gap:** nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete
the project -- even though the project itself is recoverable for 30 days. If you have customised
the app and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the
project) before deleting. For a default install with nothing irreplaceable in it, this does not
matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project (or once you are past the 30-day restore window above), the alternative is
to delete Monica outright and redeploy it later. A redeploy costs the module fee again, plus
the builds -- roughly 75 + 3-6 credits of build time.

Deleting saves money only once Monica would otherwise sit unused long enough to clear that
redeploy cost against its own daily running cost -- against the own-project total above, that
works out to about 3 days or more. Most of the running cost here is usually the database and the shared file/cache VM; they stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.

**Keep data first:** nightly backups go to a bucket inside the deployment and are deleted with
it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the
  app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
  by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; https://cloud.google.com/resource-manager/docs/delete-restore-projects for the pause/restore mechanics; https://www.monicahq.com/en/pricing for the named competitor's price.

## 1. Overview

Monica runs as a PHP/Laravel container (official Apache image) on Cloud Run v2. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Apache/PHP service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — Monica is fixed to MySQL |
| Object storage | Cloud Storage | A dedicated `monica-uploads` bucket for contact photos and documents |
| Persistence | NFS (enabled by default) | Keeps Laravel's `storage/` uploads durable across cold starts and revisions |
| Cache | Redis (optional) | Off by default; used for cache/session when enabled |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is the fixed engine.** `database_type = "MYSQL_8_0"` is set by the
  shared application layer; Monica does not run on PostgreSQL here.
- **The image is the official prebuilt `monica:<version>`.** No Cloud Build step —
  `container_image_source = "prebuilt"` pulls the Apache variant from Docker Hub,
  which serves on **port 80**.
- **`APP_KEY` is generated automatically** and stored in Secret Manager. It is a
  Laravel encryption key and must never be rotated after first boot — rotating it
  permanently corrupts every encrypted database field and invalidates all sessions.
- **Migrations run automatically on start.** The image entrypoint runs
  `php artisan migrate --force` on every container start, so the schema is created
  and upgraded on boot (after the `db-init` job provisions the database and user).
- **Direct private-IP TCP to Cloud SQL by default.** `enable_cloudsql_volume = false`
  on Cloud Run — Monica connects to MySQL over the instance private IP (the
  SnipeIT/Matomo Laravel-on-MySQL pattern), no Auth Proxy socket, no SSL required.
- **NFS is enabled by default** (`enable_nfs = true`) so uploaded files in Laravel's
  `storage/` directory survive cold starts and new revisions.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max = 1`). Cold
  starts add a few seconds of latency plus Apache/migration startup on the first
  request after idle; set `min_instance_count = 1` to keep an instance warm.
- **`APP_URL` is set from the predicted service URL** so Laravel builds correct
  absolute links and the `/` → setup/registration redirect resolves on the right host.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Monica service

Monica runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~monica"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for MySQL 8.0

Monica stores all application data (contacts, activities, reminders, journal entries,
users) in a managed Cloud SQL for MySQL 8.0 instance. On Cloud Run the service
connects over the **instance private IP** by default (`enable_cloudsql_volume = false`);
no public IP is exposed. On first deploy the `db-init` Job creates the application
database and user and grants privileges; the container's entrypoint then runs the
Laravel migrations.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `monica-uploads`) is provisioned
automatically for Monica's uploaded files (contact photos, documents). Additional
buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (optional cache)

Redis is **disabled by default** (`enable_redis = false`). When enabled, the
foundation injects `REDIS_HOST`/`REDIS_PORT`; leaving `redis_host` empty while NFS is
enabled uses the NFS server VM's IP as the Redis endpoint (the NFS VM co-hosts Redis).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected Redis env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
the Laravel **`APP_KEY`** (used for AES-256-CBC encryption of encrypted columns and
for signing sessions/cookies). The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

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

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Monica Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects over the Cloud SQL socket (when mounted) or the
  private IP, and idempotently creates the application database and user, grants
  privileges, and verifies the app user can connect. The job is safe to re-run.
- **Migrations run automatically on start.** The official Monica image's entrypoint
  runs `php artisan migrate --force` on every container start — there is no separate
  migration job. The schema is created on first boot (after `db-init`) and upgraded
  automatically when you bump `application_version`.
- **`APP_KEY` is immutable after first boot.** It is generated once and written to
  Secret Manager. Changing it permanently corrupts all encrypted database fields and
  invalidates every session — only rotate during a planned maintenance window with a
  full data re-encryption plan.
- **First-run setup in the UI.** Monica has **no default credentials**. Open the
  service URL: an unauthenticated visitor is redirected to the registration/setup
  page. The first account you create becomes the administrator. Register with
  `admin@techequity.cloud` for RAD deployments.
- **File uploads need persistence.** Uploaded photos/documents live under Laravel's
  `storage/`. NFS is enabled by default so they survive cold starts and revisions;
  the `monica-uploads` GCS bucket is also provisioned. Disabling NFS risks losing
  uploaded files on the next cold start.
- **Health path.** The startup probe is **TCP** on `/` (passes as soon as Apache
  binds the port) and the liveness probe is **HTTP** `GET /` (Monica's home page
  returns `200`). Allow a generous first-boot window for Apache startup plus the
  initial `php artisan migrate --force`.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Monica are listed; every other input is inherited
from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `monica` | Base name for resources. Do not change after first deploy. |
| `display_name` | _(set)_ | Human-readable name shown in the Console. |
| `application_version` | `latest` | Monica image tag; pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Pulls the official `monica` image directly — do not change to `custom`. |
| `cpu_limit` | `1000m` | CPU per instance (1 vCPU). |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold-start + migration latency. |
| `max_instance_count` | `1` | Single instance is sufficient for a personal CRM. |
| `container_port` | `80` | Monica's Apache image listens on port 80. |
| `enable_cloudsql_volume` | `false` | Cloud Run connects to MySQL over private-IP TCP; the Auth Proxy socket is off. |

### Group 10 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | On by default — persists Laravel `storage/` uploads across cold starts/revisions. |
| `nfs_mount_path` | `/var/www/html/storage` | Mount path inside the container. |
| `create_cloud_storage` | `true` | Provision the `monica-uploads` bucket (plus any in `storage_buckets`). |
| `gcs_volumes` | `[]` | Optional GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed to MySQL 8.0. |
| `db_name` | `monica` | Database base name (tenant-prefixed at deploy). Immutable after first deploy. |
| `db_user` | `monica` | Application database user base name. Password auto-generated in Secret Manager. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s delay, 20 retries | Passes when Apache binds the port; generous window for first-boot migration. |
| `liveness_probe` | HTTP `/` 300s delay | Monica's home page returns `200`. |

### Group 21/22 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable to add cache/session backing; injects `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (private IP) / port. |
| `storage_buckets` | Created Cloud Storage buckets (`monica-uploads`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`, a `database_type` outside the supported set, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently corrupts every encrypted database field and invalidates all sessions. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `MYSQL_8_0` | Critical | Monica is a MySQL app; a non-MySQL engine breaks the driver and migrations. |
| `enable_nfs` | `true` | High | Disabling loses uploaded contact photos/documents on the next cold start or revision. |
| `container_image_source` | `prebuilt` | High | Setting `custom` points the service at an unbuilt Artifact Registry image (`Image not found`). |
| `container_port` | `80` | High | The Apache image listens on 80; a mismatched port fails the startup probe. |
| `APP_URL` (auto-set) | Actual service URL | High | A wrong URL breaks absolute links and the `/` → setup/registration redirect (404 on the bad host). |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Medium | Monica connects over private-IP TCP; forcing the socket is unnecessary and can leave `DB_HOST` as a socket path the client mishandles. |
| `min_instance_count` | `0` (or `1` for warm) | Medium | Scale-to-zero adds cold-start + Apache/migration latency on the first request after idle. |
| `memory_limit` | `2Gi` | Medium | Trimming too far risks PHP OOM during first-boot migrations and heavy pages. |
| `enable_redis` | off unless needed | Low | Optional cache/session backing; when enabled without a host and NFS off, the Redis endpoint is blank. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Monica-specific application configuration shared
with the GKE variant is described in **[Monica_Common](Monica_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Monica on Cloud Run](../labs/Monica_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Monica on GKE Autopilot](Monica_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Monica Common — Shared Application Configuration](Monica_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Radicale on Google Cloud Run](Radicale_CloudRun.md), [Cal.diy on Google Cloud Run](CalDiy_CloudRun.md), [ActualBudget on Google Cloud Run](ActualBudget_CloudRun.md) in the **Personal Organiser** solution.
