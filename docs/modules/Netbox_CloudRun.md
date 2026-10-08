---
title: "NetBox on Google Cloud Run"
description: "Configuration reference for deploying NetBox on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# NetBox on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netbox_CloudRun.png" alt="NetBox on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

NetBox is the industry-standard open-source "source of truth" for network
engineering teams — IP address management (IPAM), device and rack inventory,
cabling, and network topology, all modeled as structured data behind a full
REST/GraphQL API. This module deploys NetBox on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages
the shared Google Cloud infrastructure.

This guide focuses on the cloud services NetBox uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Netbox costs on RAD, and how that compares

**Netbox on RAD's Cloud Run module costs about US$99 a month, with the module fee charged once in RAD credits.** Need Netbox to stay up continuously, scale across pods, or run beside other Kubernetes workloads — or see the [GKE guide](Netbox_GKE.md) for that option. If you only need it occasionally — a demo, a seasonal project, something you're evaluating — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

RAD deploys **Netbox**, which is open source, so there is no licence fee per user. You pay for
three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$99 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price, US$77 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second set of them.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (scaleToZero) | US$28.37 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$99** |

### How it compares

- **No turnkey managed SaaS was verified for Netbox itself**, so the honest comparison is a self-managed server: a Hetzner CPX22 (2 vCPU/4 GB) costs about $24/month, a DigitalOcean 2 vCPU/4 GB Droplet about $24/month, and a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) about $49/month.
- No managed SaaS offering for this exact open-source project could be verified with a current, published price, so no figure is given here. For infrastructure documentation and IPAM, the realistic choice for most teams is self-hosting (NetBox is already free and open source) versus paying an engineer's time to keep that self-hosted copy patched and backed up, which is the gap RAD's managed Cloud SQL and automation close.
- **The VPS price is not the whole cost.** On a bare VPS you are also the one patching the OS, rotating backups and keeping the database (if any) healthy. RAD's managed Cloud SQL, Secret Manager and monitoring cover that for you, which is the real argument for RAD over a cheaper box — not the sticker price.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Netbox runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits Netbox you only need occasionally — a demo, an evaluation, a seasonal
project — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to
  delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down the database, the VM or the compute resource
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can restore
  it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to
  run **Update** on each deployment to confirm everything came back. Because nothing was
  individually destroyed, that Update finds the same resources already there — it is a check, not a
  rebuild, and an Update never charges the module fee again. That costs roughly a handful of credits (under US$1) in
  total for a typical 2-3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$99.** Deploy Netbox, use
  it for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and whatever
  time Netbox was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing
  for), and you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still clear
  the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most
  services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups don't survive.** Backups are written to a bucket inside the
  project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely
  gone as soon as you delete the project — even though the project itself is recoverable for 30
  days. If you've customised Netbox and want to keep that work, copy a backup out (to Google Drive,
  or a bucket outside the project) before you delete. For a default installation with nothing
  irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the 30-day
window has passed, the way to stop paying is to delete the deployment and deploy it again when you
need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 115
  credits (US$11.50) in your own project, or 104
  credits in a RAD-managed one. Deleting saves money once Netbox would otherwise sit unused for
  about 3 days or more in your own project (about US$3.29 a
  day), or about 3 days or more in a RAD-managed one (32 credits a
  day).
- **Most of the running cost is usually the database and any shared file/cache VM.** They stop only
  when nothing else in the project uses them, so deleting Netbox while something else shares the
  project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are deleted
  with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Netbox in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Netbox for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing
  pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands
  the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
  card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; RAD fees and the daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

NetBox runs as a custom-built Python/Django container on Cloud Run v2, wrapping
the official `netboxcommunity/netbox` image with a co-located background
`rqworker --with-scheduler` process. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Custom-built image, 2 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — NetBox does not support MySQL or SQLite in production |
| Object storage | Cloud Storage (GCS Fuse) | A `media` bucket mounted at `/etc/netbox/media`, NetBox's real `MEDIA_ROOT` |
| Cache & queue | Redis (mandatory) | Task queue (`REDIS_DATABASE=0`) and cache (`REDIS_CACHE_DATABASE=1`) on separate logical databases; defaults to the NFS server IP |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and `SUPERUSER_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; NetBox does not support MySQL or SQLite for production use.
- **Redis is mandatory, not optional.** NetBox uses Redis as the broker for its
  RQ (Redis Queue) background task system — webhooks, custom scripts, reports,
  and scheduled/system jobs — and as its cache backend. These are **two
  separate logical Redis databases** (`REDIS_DATABASE=0`, `REDIS_CACHE_DATABASE=1`);
  NetBox's own documentation warns that sharing one database number risks
  losing queued background tasks during a cache flush.
- **A background worker is co-located in the same container.** The image runs
  `manage.py rqworker --with-scheduler` as a backgrounded process alongside the
  Granian web server. Without it, background tasks queue silently and never
  execute — there is no separate error.
- **Media uploads are mounted at NetBox's actual `MEDIA_ROOT`.** `/etc/netbox/media`,
  not the more obvious-looking `/opt/netbox/netbox/media` — confirmed live via
  `manage.py shell`. Getting this path wrong doesn't error; uploads simply
  never persist to GCS (see §4 for the full story).
- **Cost-first cold-start by default** (`cpu_always_allocated = false`,
  `min_instance_count = 0`). **Trade-off:** the RQ worker only runs while a
  request keeps the instance warm — background tasks queue and drain on the
  next request instead of executing immediately. Set `cpu_always_allocated = true`
  and `min_instance_count >= 1` together to restore continuous processing.
- **The container runs as root** (uid 0 / gid 0) — the official
  `netboxcommunity/netbox` image sets no `USER`. This is intentional and
  matches upstream; the GCS Fuse mount is pinned to `uid=0`/`gid=0` accordingly.
- **`SECRET_KEY` and `SUPERUSER_PASSWORD` are generated automatically** and
  stored in Secret Manager. `SECRET_KEY` must be at least 50 characters (NetBox
  enforces this); it is generated at 64.
- **Health checks use `/login/`, not `/api/status/`.** The login page is public
  and unauthenticated; the status API requires auth and would fail every probe.
- **`ALLOWED_HOSTS = "*"` and `CORS_ORIGIN_ALLOW_ALL = "true"` are open by
  default** for a zero-touch first deploy — tighten via `environment_variables`
  before exposing a production instance to the internet.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the NetBox service

NetBox runs as a Cloud Run v2 service that autoscales by request load between
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

NetBox stores all inventory and IPAM data (devices, racks, IP addresses,
prefixes, VLANs, circuits, users) in a managed Cloud SQL for PostgreSQL 15
instance. The service connects privately through the **Cloud SQL Auth Proxy**
over a Unix socket; no public IP is exposed. On first deploy an initialization
Job creates the application database and user.

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

### C. Cloud Storage (GCS Fuse media store)

A dedicated `media` bucket is provisioned automatically and mounted at
`/etc/netbox/media` — NetBox's real `MEDIA_ROOT` — for uploaded device/rack
images and file attachments.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (task queue and cache)

Redis is **required** (`enable_redis = true` by default). When `redis_host` is
left empty and `enable_nfs` is true, the NFS server VM's IP is used as the
Redis endpoint. NetBox splits its usage across two logical databases —
`REDIS_DATABASE=0` for the RQ task queue, `REDIS_CACHE_DATABASE=1` for the
cache.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> -n 0 llen rq:queue:default   # inspect the RQ default queue depth
  # Confirm the resolved Redis host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret
Manager: `SECRET_KEY` (Django cryptographic secret used for sessions, CSRF,
and signed cookies) and `SUPERUSER_PASSWORD` (the initial admin account
password). The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. NetBox Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user and grants
  privileges. The job is safe to re-run.
- **Database migrations on start.** `docker-entrypoint.sh true` runs NetBox's
  own first-boot sequence synchronously on every container start — a
  DB-readiness wait, `migrate --no-input`, stale-contenttype cleanup, session
  cleanup, and a lazy search-index reindex — before the web server and RQ
  worker start. This is idempotent; a no-op when there's nothing new to migrate.
- **Superuser bootstrap is idempotent.** The initial admin account
  (`admin_user`/`admin_email`, password from Secret Manager) is created from
  `SUPERUSER_*` env vars on first boot; creation is skipped — not an error —
  if a user with that name already exists, so it's safe on every restart.
- **Media uploads persist to the real `MEDIA_ROOT`.** NetBox's actual
  `MEDIA_ROOT` is `/etc/netbox/media` (confirmed live via `manage.py shell`),
  which is where the GCS Fuse `media` volume is mounted. An earlier revision of
  this module mounted the more obvious-looking `/opt/netbox/netbox/media`
  instead — a real, non-existent NetBox path — which caused uploads to write
  to the ephemeral container filesystem instead: they were readable back
  immediately (same local filesystem, so the round-trip "worked"), but never
  reached GCS and were lost on every container restart, on **both** Cloud Run
  and GKE identically. This was fixed by correcting the mount path, verified
  live with `gcloud storage ls` showing the uploaded test file with correct
  byte size, content type, and timestamp within 5 seconds of upload. **Lesson:**
  this looked exactly like a Cloud-Run-specific storage limitation until traced
  with real shell access — it was a mundane Terraform mount-path bug affecting
  both platforms identically, not a platform gap.
- **`CSRF_TRUSTED_ORIGINS` reflects the real service URL.** Computed from the
  app-scoped `module.deployment_id.service_name` and the project number — not
  the tenant-only resource prefix, which would build a URL for a service that
  doesn't exist and reject every authenticated POST (including login) with a
  CSRF failure. Verify the deployed value:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **The RQ worker processes background tasks.** Webhooks, custom scripts,
  reports, and scheduled/system jobs are executed by `manage.py rqworker
  --with-scheduler`, co-located in the same container as the web server. Under
  the cost-first cold-start default, this worker only runs while an instance is
  warm; enable `cpu_always_allocated = true` + `min_instance_count >= 1` for
  continuous background processing.
- **Health path.** Startup and liveness probes target `/login/` — NetBox's
  public, unauthenticated login page. `/api/status/` requires authentication
  and would fail every probe.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for NetBox are listed; every other input is
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
| `application_name` | `netbox` | Base name for resources. Do not change after first deploy. |
| `display_name` | `NetBox - Network Documentation & IPAM` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Container image version tag, passed through to the Dockerfile's `APPLICATION_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; shared by the web server and the RQ worker. |
| `memory_limit` | `2Gi` | Memory per instance; minimum 1Gi. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; the RQ worker only runs while an instance is warm. |
| `max_instance_count` | `3` | Upper bound on autoscaling. |
| `cpu_always_allocated` | `false` | `true` + `min_instance_count >= 1` restores continuous background-task processing. |
| `container_port` | `8080` | NetBox's Granian (WSGI) server listens on port 8080. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Cloud Run ingress control. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `SECRET_KEY`, `SUPERUSER_PASSWORD`, or `DB_*` here — they're injected automatically. |
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

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS
bucket after provisioning. See [App_CloudRun](App_CloudRun.md).

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
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned media bucket. |
| `enable_nfs` | `true` | Provisions NFS; used as the Redis host when `redis_host` is blank. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. When empty, `Netbox_Common` auto-mounts `netbox-media` at `/etc/netbox/media` (NetBox's real `MEDIA_ROOT`). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed; NetBox requires PostgreSQL 14+. |
| `db_name` | `netbox` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `netbox` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not forwarded — NetBox has no platform-scheduled recurring tasks; its own scheduled jobs run through the co-located RQ worker instead. |
| `additional_services` | `[]` | Additional Cloud Run services deployed alongside NetBox. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/login/`, 60s delay, 60 failure threshold | NetBox-specific startup probe (takes effect). |
| `liveness_probe` | HTTP `/login/`, 30s failure window | NetBox-specific liveness probe. |
| `startup_probe_config` / `health_check_config` | generic App_CloudRun defaults | Alternative structured probes; superseded by `startup_probe`/`liveness_probe` above. |
| `uptime_check_config` | `{ enabled=true, path="/login/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 15 — NetBox Application Settings

| Variable | Default | Description |
|---|---|---|
| `time_zone` | `UTC` | Timezone for NetBox timestamps and scheduled tasks. |
| `admin_user` | `admin` | Username for the auto-created superuser. Creation is idempotent — skipped if it already exists. |
| `admin_email` | `admin@example.com` | Email for the auto-created superuser. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required.** Backs NetBox's RQ task queue and cache layer. NetBox cannot run without it. |
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
| `service_url` | Public `run.app` URL of the NetBox web UI. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `gcs_volumes` mount path (auto-set to `/etc/netbox/media`) | Never override to a different path unless you've confirmed NetBox's real `MEDIA_ROOT` | Critical | A wrong mount path leaves uploads on the ephemeral container filesystem — they read back fine immediately, but are silently lost on every restart with no error. This exact bug was found and fixed on this module's earlier `/opt/netbox/netbox/media` mount. |
| `SECRET_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions and signed cookies; NetBox also enforces a minimum 50-character length. |
| `SUPERUSER_PASSWORD` (auto-generated) | Rotate via the NetBox UI, not by regenerating the secret | Medium | Regenerating the Secret Manager value does not retroactively change the already-created admin account's password. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` | `true` (mandatory) | Critical | NetBox's background task system (webhooks, reports, scripts, scheduled jobs) and its cache layer do not function without Redis — there is no fallback mode. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but NFS is off and no host is set, the Redis connection is blank and background processing silently never runs. |
| `REDIS_DATABASE` / `REDIS_CACHE_DATABASE` | Keep separate (`0` / `1`) | High | Sharing one logical Redis database risks losing queued background tasks during a cache flush, per NetBox's own documentation. |
| `memory_limit` | `2Gi` | High | Values below 1Gi risk OOM kills, especially with the RQ worker co-located in the same container. |
| `cpu_always_allocated` / `min_instance_count` | `true` + `>=1` if background jobs must run continuously | Medium | At the cost-first default (`false` / `0`), webhooks/reports/scheduled jobs only run while a request keeps the instance warm — they queue instead of executing immediately. |
| `ALLOWED_HOSTS` / `CORS_ORIGIN_ALLOW_ALL` (auto-injected `"*"` / `"true"`) | Tighten for production internet-facing use | Medium | Left open, any hostname/origin is accepted — acceptable for a first deploy, not for a hardened production instance. |
| `CSRF_TRUSTED_ORIGINS` (auto-computed) | Verify it matches the actual service URL after deploy | High | A stale or incorrect value rejects every authenticated POST, including login, with a CSRF failure. |
| `ingress_settings` | `all` for public access | Medium | `internal` blocks browser access to the login/setup flow unless reached via VPN/IAP. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The admin UI is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. NetBox-specific application configuration
shared with the GKE variant is described in
**[Netbox_Common](Netbox_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: NetBox on Cloud Run](../labs/Netbox_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [NetBox on GKE Autopilot](Netbox_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [NetBox Common — Shared Application Configuration](Netbox_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Snipe-IT on Google Cloud Run](SnipeIT_CloudRun.md), [BookStack on Google Cloud Run](BookStack_CloudRun.md), [Homepage on Google Cloud Run](Homepage_CloudRun.md) in the **IT Asset & Infrastructure Records** solution.
