---
title: "Docmost on Google Cloud Run"
description: "Configuration reference for deploying Docmost on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Docmost on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docmost_CloudRun.png" alt="Docmost on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Docmost is an open-source, real-time collaborative wiki and documentation platform
(a Confluence/Notion alternative) built on NestJS. This module deploys Docmost on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Docmost uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Docmost costs on RAD, and how that compares

**Docmost on RAD's Cloud Run module costs about US$82.03 a month with no per-seat licence.** This compares against at least US$60 a month for Docmost's own hosted Business plan (US$6 a seat, 10-seat minimum). A self-managed server is cheaper in cash, but then you run the database, backups, security patches and upgrades yourself. GKE Autopilot suits Docmost that must stay up continuously or scale across pods; for the lowest cost, this Cloud Run module already gives you the cheaper option — see the [GKE guide](Docmost_GKE.md) if you need the other one. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$82.03 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$82.03 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | US$11.58 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$82.03** |

### How it compares

| Option | Per month | Who runs it |
|---|---|---|
| Docmost, Business plan (10 seats) | US$60 a month (annual), 10-seat minimum | Docmost |
| **RAD, Cloud Run, your own project** | **About US$82.03** | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **About US$96** | RAD |

- Docmost's Business plan adds SSO and advanced permissions that the open-source **Community** edition — what RAD deploys — does not include; compare against Business only if you actually need those. Docmost's free Community tier is the self-hosted software RAD automates for you.
- Licence cost on Docmost's own plan grows with every seat added past ten; RAD's cost is the infrastructure, which does not move when you add another editor.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Docmost runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits Docmost you only need occasionally — studying, a demo, a seasonal
business — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down Cloud SQL, the NFS VM or Cloud Run one by one — the whole project,
  and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner
  can restore it. RAD asks Google to undelete the project and reattaches its billing account,
  then asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. That costs **a
  handful of credits (under US$1)** in total for a typical Docmost-sized deployment chain, against
  the 104 credits (US$10.35) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$82.03.** Deploy Docmost, use it
  for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and
  whatever hours Docmost was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages
  billing for), and you restore it yourself within the 30 days — after that, Google deletes it
  for good. Restoring is admitted like creating a new project: your purchased credit balance
  must still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside
  the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is
  very likely gone as soon as you delete the project — even though the project itself is
  recoverable for 30 days. If you have customised the data and want to keep it, copy a backup
  out (to Google Drive, or a bucket outside the project) before you delete, the same as the
  redeploy workflow below. For a default installation with nothing irreplaceable in it, this
  does not matter.


### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or
once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy
it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 114 credits
  (US$11.45), and about an hour, because RAD recreates the project and shared services before Docmost. Deleting saves money once Docmost would otherwise sit unused
  for about **4 days or more** in your own project (about US$2.73 a day), or about
  **3 days or more** in a RAD-managed one (32 credits a day).
- **Delete everything Docmost uses.** Most of the running cost is the database and the NFS/cache VM. They stop only when nothing else in the project uses them, so deleting it while something else shares the project saves only Docmost's own compute part.
- **Keep your data first.** The nightly database backups are written to a bucket inside the deployment, and that bucket is deleted with it. Before deleting, copy the latest backup to Google Drive, or to a bucket you keep.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the
  settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Docmost in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Docmost for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API;
RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing);
[Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
for the pause/restore mechanics and window. [Docmost pricing](https://docmost.com/pricing) for the Business plan figures;


## 1. Overview

Docmost runs as a Node.js (NestJS) container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | NestJS service on port 3000, 1 vCPU / 1 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Docmost does not support MySQL or other engines |
| Cache & collaboration | Redis | **Required** for real-time editing and background queues; enabled by default |
| File storage | Filestore / NFS | Attachments written to the NFS-backed volume at `/app/data/storage` |
| Object storage | Cloud Storage | A data bucket provisioned automatically (unused by the default `local` driver) |
| Secrets | Secret Manager | Auto-generated `APP_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Redis is required and on by default.** Docmost uses Redis for real-time
  collaborative editing and background job queues. `enable_redis = true` is the
  default; leaving `redis_host` empty co-locates Redis on the NFS server VM.
- **NFS is enabled by default** (`enable_nfs = true`, `nfs_mount_path = /app/data/storage`).
  Docmost's `local` storage driver writes uploaded attachments there so they survive
  restarts and are shared across instances.
- **`APP_SECRET` is generated automatically** and stored in Secret Manager. It signs
  and encrypts sessions and sensitive data and must never be rotated after first boot
  without a maintenance window — rotating it logs everyone out and makes data
  encrypted under the old value unrecoverable.
- **The database is reached over the private IP, not the socket.** Docmost's
  `postgres.js` driver cannot use the Cloud SQL Unix socket path (its colons break URL
  parsing), so the entrypoint connects to the Cloud SQL **private IP over TCP with
  `sslmode=require`**. `enable_cloudsql_volume = true` still mounts the socket for the
  `db-init` job.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max_instance_count = 1`).
  Cold starts add a few seconds of latency after idle; set `min_instance_count = 1` to
  keep the collaboration endpoint warm.
- **`APP_URL` is injected as the predicted service URL** (via `service_url_env_var_name = "APP_URL"`)
  and used to build absolute links and the editor collaboration WebSocket endpoint.
- **First-run setup is via the UI.** Docmost has no default credentials — the first
  visitor creates the initial workspace and administrator account.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Docmost service

Docmost runs as a Cloud Run v2 service that autoscales by request load between the
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

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Docmost stores all application data (spaces, pages, comments, users, permissions) in a
managed Cloud SQL for PostgreSQL 15 instance. On Cloud Run the running service connects
to the Cloud SQL **private IP over TCP with SSL** (the `postgres.js` driver cannot use
the Auth Proxy socket path); the `db-init` job connects through the mounted socket. On
first deploy that Job creates the application database and user; Docmost then applies
its own schema migrations automatically on boot.

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

### C. Redis (real-time collaboration & queues)

Redis is **enabled by default** and is required for Docmost's real-time collaborative
editor and background job processing. When `redis_host` is left empty and `enable_nfs`
is true, the NFS server VM's IP is used as the Redis endpoint; set `redis_host`
(and optionally `redis_auth`) to point at a managed/external Redis instead.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the assembled REDIS_URL is present in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Cloud Storage & NFS file storage

Docmost writes uploaded attachments to its `local` storage driver at
`/app/data/storage`, which is backed by the **NFS** volume so files persist and are
shared across instances. A dedicated **Cloud Storage** data bucket is also provisioned
automatically (available if you switch Docmost to an object-storage driver).

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for NFS, GCS Fuse, and CMEK options.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`APP_SECRET` (used to sign and encrypt sessions and sensitive data). The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docmost"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows the public access needed to share wiki pages and reach the collaboration
endpoint. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud
Armor can be layered on; ingress settings and VPC egress control connectivity.

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

## 3. Docmost Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy socket and
  idempotently creates the application database and user and grants privileges. The
  job is safe to re-run.
- **Migrations run automatically on start.** Docmost runs its own schema migrations on
  every boot via its default `pnpm start` command, so upgrading the application version
  applies schema changes with no separate migration step.
- **`APP_SECRET` is immutable after first boot.** It is generated once and written to
  Secret Manager. Rotating it invalidates all existing sessions and makes data
  encrypted under the old value unrecoverable — only rotate in a planned maintenance
  window.
- **`APP_URL` must match the real service URL.** It is injected as the predicted
  `run.app` URL and used for absolute links and the collaboration WebSocket. If you put
  Docmost behind a custom domain, set `APP_URL` (via `environment_variables`) to that
  external URL. Inspect the running revision:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Health path.** Startup and liveness probes target `/api/health` — Docmost's public
  200 endpoint. Allow ~2 minutes on first boot (60-second initial delay plus the retry
  window) while migrations run.
- **First-run account creation.** Docmost ships with no default credentials. Browse to
  the service URL and complete the setup form to create the first workspace and admin
  user. Do this promptly after deploy so no one else can claim the workspace.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Docmost are listed; every other input is inherited from
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
| `application_name` | `docmost` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Docmost` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Docmost image tag (mapped to the `DOCMOST_VERSION` build ARG); pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance (1 vCPU). |
| `memory_limit` | `1Gi` | Memory per instance. |
| `cpu_always_allocated` | `false` | Request-based billing; CPU billed only while serving. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to keep the collaboration endpoint warm. |
| `max_instance_count` | `1` | Increase only with Redis enabled (it is, by default). |
| `container_port` | `3000` | Docmost listens on port 3000. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Mounts the Cloud SQL Auth Proxy socket (used by `db-init`). |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` allows public access to shared pages and the collaboration endpoint. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Docmost. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core values (`NODE_ENV`, `STORAGE_DRIVER`, `APP_URL`) are set automatically — do not set `APP_SECRET`, `DATABASE_URL`, or `REDIS_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `service_url_env_var_name` | `APP_URL` | Injects the predicted service URL as `APP_URL`. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the GCS buckets defined in `storage_buckets`. |
| `enable_nfs` | `true` | NFS is **on** by default — backs the `/app/data/storage` attachment path. |
| `nfs_mount_path` | `/app/data/storage` | Mount path matching Docmost's local storage driver. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Docmost requires PostgreSQL 15. |
| `db_name` | `docmost` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `docmost` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 60s delay | Startup probe. Allow ~2 minutes on first boot. |
| `liveness_probe` | HTTP `/api/health` 60s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Cloud Monitoring uptime check; disabled by default (when the endpoint is public). |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required** — Docmost uses Redis for real-time editing and queues. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

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
| `APP_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all sessions and makes data encrypted under the old value unrecoverable. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Docmost requires PostgreSQL 15; any other engine breaks startup. |
| `enable_redis` | `true` | Critical | Docmost's real-time editor and job queues need Redis; disabling it prevents the app from working correctly. |
| `enable_nfs` | `true` | High | With NFS off, uploaded attachments land on ephemeral disk and are lost on restart / not shared across instances. |
| `APP_URL` | Actual service / custom-domain URL | High | A wrong URL breaks absolute links and the collaboration WebSocket endpoint. |
| `max_instance_count` | Increase only with Redis | High | Multiple instances without shared Redis coordination degrade collaborative editing. |
| `ingress_settings` | `all` | High | `internal` blocks external sharing and the public collaboration endpoint. |
| `enable_iap` | only for private wikis | Medium | IAP blocks all unauthenticated access, including anonymous page views if you use them. |
| `memory_limit` | `1Gi`+ | Medium | Very small limits risk OOM under concurrent editing/upload load. |
| `min_instance_count` | `1` for latency-sensitive use | Medium | Scale-to-zero (`0`) adds a cold-start delay on the first request after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Docmost-specific application configuration shared
with the GKE variant is described in **[Docmost_Common](Docmost_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Docmost on Cloud Run](../labs/Docmost_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Docmost on GKE Autopilot](Docmost_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Docmost Common — Shared Application Configuration](Docmost_Common.md) — the configuration shared by both deployment targets.
