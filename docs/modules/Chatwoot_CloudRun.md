---
title: "Chatwoot on Google Cloud Run"
description: "Configuration reference for deploying Chatwoot on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Chatwoot on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chatwoot_CloudRun.png" alt="Chatwoot on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chatwoot is an open-source, multi-channel helpdesk and customer-engagement
platform (email, live chat, social, and messaging inboxes, SLA tracking, and
reporting) that serves as a GDPR-compliant alternative to Zendesk or Intercom.
This module deploys Chatwoot on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Chatwoot uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Chatwoot costs on RAD, and how that compares

**Chatwoot on RAD's Cloud Run module costs about US$102 a month in your own Google Cloud project, with no extra licence fee** — Chatwoot is open source. In a project RAD manages for you, the same deployment is metered at **32 credits a day** (about 960 a month, about US$96 at the top-up price). Or see the [GKE guide](Chatwoot_GKE.md) for always-on capacity across pods. If you only need Chatwoot occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Chatwoot is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6 credits) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$102 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | US$31.53 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$102** |

Cloud SQL and Cloud Run/GKE pod pricing is the same in africa-south1 (Johannesburg); the small VM costs about 10% more there.

- **Scale-to-zero is the default on Cloud Run.** The figure above assumes modest daily use; set `min_instance_count ≥ 1` to keep it always warm (and avoid cold starts), which raises the Cloud Run line but not the rest of the table.

### How it compares, for a team of ten agents

Chatwoot's own team sells hosted **Chatwoot Cloud** per agent:

| Option | Per month (10 agents) | Notes |
|---|---|---|
| Chatwoot Cloud, Hacker | US$0 | Free tier, limited |
| Chatwoot Cloud, Startups | US$190 (US$19/agent) | Hosted by Chatwoot |
| Chatwoot Cloud, Business | US$390 (US$39/agent) | Hosted by Chatwoot, most popular |
| Chatwoot Cloud, Enterprise | US$990 (US$99/agent) | Hosted by Chatwoot |
| **RAD, Cloud Run, your own project** | **About US$102**, plus US$11 once per deployment | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **About 960 credits (US$96)** | RAD |

- **Chatwoot Cloud's price grows with every agent seat; RAD's cost is the infrastructure.** At ten agents, RAD's own-project running cost already undercuts even the cheapest paid Chatwoot Cloud tier.
- **A cheap server is cheap until something breaks.** On RAD the database is Cloud SQL with automated backups, and secrets live in Secret Manager. On your own server, each of those is a job someone has to do.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Chatwoot runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
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
  own platform average). Deleting saves money only once Chatwoot would otherwise sit unused for about
  **3 days or more** — in your own project that is about US$3.40 a day, and
  in a RAD-managed one it is 32 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Chatwoot while another application shares the project saves only Chatwoot's own compute part.
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

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and backup-bucket caveat;
[Chatwoot Cloud pricing](https://www.chatwoot.com/pricing); prices change, check each source before relying on a figure.

## 1. Overview

Chatwoot runs as a single Ruby on Rails container that combines the web
server and a background Sidekiq worker in one process tree. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Rails + co-located Sidekiq worker on port 3000, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — `database_type` is fixed to `POSTGRES_15`; the `vector` (pgvector) extension is enabled for Chatwoot's AI/search features |
| Cache & queue | Redis (NFS-hosted or external) | Backs Sidekiq's job queue and ActionCable pub/sub; enabled by default |
| File persistence | Cloud Filestore (NFS) | Attachments persist under `/opt/chatwoot/storage`, shared across revisions |
| Object storage | Cloud Storage | A `storage`-suffixed bucket provisioned automatically by the Common module, plus a default `data` bucket declared in `storage_buckets` |
| Secrets | Secret Manager | Auto-generated Rails `SECRET_KEY_BASE`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` is hardcoded to `POSTGRES_15`
  by the Common module's `config` output; Chatwoot's schema and pgvector-backed
  search features require it.
- **Custom-built image.** `container_image_source = "custom"` — the Common
  module builds `FROM chatwoot/chatwoot:${APP_VERSION}` and layers in a
  `cloud-entrypoint.sh` that maps the Foundation's `DB_*`/`REDIS_*` env vars
  onto Chatwoot's `POSTGRES_*`/`REDIS_URL` convention and launches Sidekiq in
  the background before exec'ing the Rails server. The image runs **as root**
  — matching the upstream image, whose `/app`/`/app/tmp` are root-owned and not
  group-writable, so Rails' `create_tmp_directories` step needs root to
  succeed.
- **Cloud SQL is reached via a Unix socket, not a TCP loopback.** With
  `enable_cloudsql_volume = true`, Cloud Run mounts the Cloud SQL Auth Proxy
  socket at `/cloudsql/<instance>`; the entrypoint passes the injected
  `DB_HOST` straight through as `POSTGRES_HOST` (the Ruby `pg` driver accepts a
  directory path as a Unix-socket host). This differs from the GKE variant,
  where a sidecar proxy listens on `127.0.0.1:5432`.
- **Two initialization Jobs run in sequence.** `db-init` (creates the
  database, role, and grants — including a `cloudsqlsuperuser` grant so
  Chatwoot can create Postgres extensions itself) runs first, then
  `chatwoot-prepare` (`bundle exec rails db:chatwoot_prepare`) creates/upgrades
  the schema and seeds defaults, using the **built Chatwoot app image**. There
  is no in-container migration step; schema setup happens entirely in these
  two Jobs before the app container needs to serve traffic.
- **Redis defaults on** (`enable_redis = true`). Leave `redis_host` blank to
  use the shared NFS-server-hosted Redis IP that the Foundation injects
  automatically.
- **`SECRET_KEY_BASE` is generated once and shared** between the Rails web
  process and the Sidekiq worker (co-located in the same container) — it must
  stay stable across restarts/redeploys, since Rails uses it to sign sessions
  and encrypt ActiveRecord-encrypted columns.
- **NFS is on by default** (`enable_nfs = true`) so uploaded attachments
  persist and are shared across revisions at `/opt/chatwoot/storage`.
- **`cpu_always_allocated` defaults to `false`** (request-based billing,
  cold-start). Sidekiq (notifications, webhooks, auto-assignment) and
  ActionCable's real-time UI updates only run while a request is being served
  or during the post-request keep-warm window; set `cpu_always_allocated =
  true` with `min_instance_count >= 1` to keep background delivery
  continuous.
- **`ENABLE_ACCOUNT_SIGNUP` defaults to `"false"`** — open self-service
  admin/agent signup is disabled on a freshly deployed helpdesk; flip it via
  `environment_variables` if you want public signup.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Chatwoot service

Chatwoot runs as a Cloud Run v2 service that autoscales by request load
between the minimum and maximum instance counts. Each pod-equivalent revision
runs both the Rails web server and a background Sidekiq worker process in the
same container, so the service should not spend long periods at zero
instances if timely message/notification delivery matters.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Chatwoot stores all application data (conversations, contacts, inboxes,
agents, reports) in a managed Cloud SQL for PostgreSQL 15 instance, including
the `vector` extension used by its AI/search features. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket at
`/cloudsql/<instance>`; no public IP is exposed. On first deploy the
`db-init` Job creates the application database, role, and grants (including a
`cloudsqlsuperuser` grant so Chatwoot's own extension-creation calls succeed),
then the `chatwoot-prepare` Job runs `rails db:chatwoot_prepare` to build the
schema.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
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

A dedicated `storage`-suffixed **Cloud Storage** bucket is provisioned
automatically by the Common module, alongside the default `data` bucket
declared in `storage_buckets`. Additional buckets can be declared the same
way.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud storage ls gs://<bucket-name>/
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (queue, cache, and pub/sub)

Sidekiq (Chatwoot's background job queue) and ActionCable (real-time UI
updates) both require Redis. `enable_redis = true` by default; when
`redis_host` is left blank, the Foundation injects the shared
NFS-server-hosted Redis IP, and the container entrypoint builds `REDIS_URL`
from `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` at startup — this is
self-healing regardless of whether `redis_host` was set explicitly or left
blank.

> **Sidekiq needs Redis 6.2 or newer, and the NFS-hosted Redis is 6.0.** The shared Redis on the
> NFS VM runs 6.0.16, and Sidekiq 7 refuses to start against it. The web UI still serves (the
> entrypoint backgrounds Sidekiq), so the deployment looks healthy while no background job runs.
> Point `redis_host` at a Redis 6.2+ instance — for example Memorystore, via `create_redis = true`
> in Services_GCP, which provisions Redis 7.2.

- **Console:** Memorystore → Redis (if using a dedicated instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

One Chatwoot-specific secret is generated automatically and stored in Secret
Manager: `SECRET_KEY_BASE` (Rails' session-signing / ActiveRecord-encryption
key, shared identically between the web and Sidekiq processes, and also
injected into the `chatwoot-prepare` init Job). The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`), which allows external channel integrations (webhooks, live-chat
widget embeds) to reach it. An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container stdout/stderr (both the Rails and Sidekiq processes, since they
share a container) flows to Cloud Logging; Cloud Run and Cloud SQL metrics
flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Chatwoot Application Behaviour

- **First-deploy database setup runs as two chained Jobs.** `db-init` (image
  `postgres:15-alpine`) connects over the Cloud SQL socket, idempotently
  creates the database role and database, grants privileges, grants
  `cloudsqlsuperuser` to the app role (needed because Cloud SQL's app user is
  not a real Postgres superuser and `db:chatwoot_prepare`'s `schema.rb` calls
  `enable_extension` for several extensions), and pre-creates `vector`,
  `pg_stat_statements`, `pg_trgm`, and `pgcrypto` defensively. `chatwoot-prepare`
  depends on `db-init` (`depends_on_jobs = ["db-init"]`) and runs `bundle exec
  rails db:chatwoot_prepare` using the built Chatwoot app image, not a generic
  client image. Both Jobs have `execute_on_apply = true`.
- **No in-container migrations.** Schema creation/upgrade is entirely handled
  by the `chatwoot-prepare` initialization Job before the app container is
  expected to serve traffic — the runtime entrypoint does not run `rails
  db:migrate`.
- **`chatwoot-prepare` prefers TCP over the socket when both are available.**
  Its script explicitly checks whether `DB_HOST` is a socket path (leading
  `/`); if so **and** `DB_IP` (the instance private IP) is also present, it
  connects over `DB_IP` with `PGSSLMODE=require` instead, because the Cloud
  SQL Unix socket does not always materialise inside a Cloud Run Job in time.
  It only falls back to the literal socket path when `DB_IP` is unset. The
  long-running app container's own entrypoint has no such fallback — it
  passes `DB_HOST` straight through as `POSTGRES_HOST`, relying on the socket
  being present for the service itself.
- **DB env-var aliasing.** The platform injects `DB_HOST` (the Cloud SQL
  socket directory on Cloud Run), `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`; `cloud-entrypoint.sh` (baked into the image) maps these onto
  Chatwoot's `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_DATABASE`/
  `POSTGRES_USERNAME`/`POSTGRES_PASSWORD` convention.
- **Redis URL is self-healing.** If `REDIS_URL` is not already set, the
  entrypoint builds it from the injected `REDIS_HOST`/`REDIS_PORT`/
  `REDIS_AUTH` — covering both the explicit `redis_host` case and the default
  NFS-fallback case.
- **Sidekiq runs co-located, in the background.** `cloud-entrypoint.sh`
  starts `bundle exec sidekiq -C config/sidekiq.yml &` before exec'ing the
  Rails server; a `trap` on `TERM`/`INT` stops Sidekiq alongside the
  container. Because Sidekiq processes background jobs (channel delivery,
  notifications, reports) only while the container is running, keep
  `min_instance_count >= 1` (and consider `cpu_always_allocated = true`) if
  timely delivery matters more than idle cost.
- **`ENABLE_ACCOUNT_SIGNUP` is off by default.** The Common module injects
  `ENABLE_ACCOUNT_SIGNUP = "false"` alongside `RAILS_ENV=production`,
  `RAILS_LOG_TO_STDOUT=true`, and `RAILS_MAX_THREADS=5` (sized above Cloud
  Run's default concurrency to avoid "could not obtain a connection from the
  pool"). Chatwoot's own onboarding UI creates the first admin account
  interactively on first visit — there is no auto-generated admin credential
  secret for this module.
- **Health path.** Startup and liveness probes are **HTTP** `GET /` — the
  login/onboarding page returns 200 with no auth. The default `startup_probe`
  allows an initial 60-second delay plus up to 30 retries at a 15-second
  period (~8 minutes) before failing, to absorb `chatwoot-prepare` running
  ahead of the app container.
- **Cloud SQL proxy shutdown signal.** The init Jobs signal the Cloud SQL
  Auth Proxy sidecar to exit on completion so the Job pod finishes instead of
  hanging on a live sidecar.
- **Inspect job execution and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <chatwoot-prepare-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Chatwoot are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project, Identity & Search Integration

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `elasticsearch_url` | `""` | Optional Elasticsearch endpoint (e.g. from `Elasticsearch_GKE`) for Chatwoot's full-text search. Leave empty to disable. |
| `elasticsearch_username` | `""` | Elasticsearch username; leave empty when `xpack.security.enabled` is false. |
| `elasticsearch_password_secret` | `""` | Secret Manager secret ID holding the Elasticsearch password; when set, injected as `ELASTICSEARCH_PASSWORD` and the workload SA is granted `secretAccessor`. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `chatwoot` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Chatwoot Helpdesk` | Human-readable name shown in the Console. |
| `description` | `Chatwoot - Open-source helpdesk and customer support platform` | Service description. |
| `application_version` | `v4.15.1` | `chatwoot/chatwoot` image tag used as the custom-build base. Increment to trigger a rebuild. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Custom-built from `chatwoot/chatwoot`; do not set to `prebuilt` — it skips the `cloud-entrypoint.sh` wrapper. |
| `cpu_limit` | `2000m` | 2 vCPU — Rails + co-located Sidekiq worker. |
| `memory_limit` | `4Gi` | 4 GiB recommended; both processes share the container. |
| `cpu_always_allocated` | `false` | Cost-first cold-start default; Sidekiq/ActionCable work pauses between requests. Set `true` (with `min_instance_count >= 1`) to restore continuous background delivery. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to keep the Sidekiq worker warm. |
| `max_instance_count` | `5` | Standard horizontal scaling ceiling. |
| `container_port` | `3000` | Chatwoot's Rails server port. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix socket for Postgres connections. |
| `enable_image_mirroring` | `true` | Mirror the Chatwoot image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is the default so external channel integrations and the live-chat widget can reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks public channel webhooks and the live-chat widget.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, e.g. `{ ENABLE_ACCOUNT_SIGNUP = "true" }` to open self-service signup. Core `RAILS_*`/`POSTGRES_*`/`REDIS_*` values are set automatically. |
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

### Group 9 — Custom Initialization & SQL Scripts

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
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the Common module's auto-provisioned `storage`-suffixed bucket. |
| `enable_nfs` | `true` | NFS is on by default so attachments persist and are shared across revisions. |
| `nfs_mount_path` | `/opt/chatwoot/storage` | Where Chatwoot stores uploaded attachments. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Overridden to a fixed value by the Common module's `config` output regardless of what is set here; Chatwoot requires Postgres 15+ with pgvector. |
| `db_name` | `chatwoot` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `chatwoot` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Inert Foundation-mirror declarations (satisfy convention mirroring only) — Chatwoot's `chatwoot.tf` wires `db_name`/`db_user` instead, so these are never forwarded to `main.tf`. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the Common module's built-in `db-init` → `chatwoot-prepare` job chain. |
| `cron_jobs` | `[]` | Not used — Chatwoot has no platform-scheduled recurring tasks; Sidekiq handles its own scheduling in-process. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , 60s initial delay, 15s period, 30 retries | Startup probe; sized to absorb `chatwoot-prepare` completing ahead of the app container. |
| `liveness_probe` | HTTP `/` , 60s initial delay, 30s period, 3 retries | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Alternative structured probes (service-level); `startup_probe`/`liveness_probe` take effect by default. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Required for Sidekiq queueing and ActionCable pub/sub; forwarded to the foundation unconditionally. |
| `redis_host` | `""` | Blank uses the shared NFS-server-hosted Redis IP that the Foundation injects. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs (including the Foundation-mirror-only `application_display_name`,
`application_description`, `container_build_config`, `additional_services`,
`additional_containers`, and networking/SQL-instance overrides) follow
standard [App_CloudRun](App_CloudRun.md) behaviour and are inert unless
explicitly wired — Chatwoot's `chatwoot.tf` does not forward them.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

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
| `database_host` / `database_port` | DB endpoint (Cloud SQL socket directory) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `chatwoot-prepare`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, which
> validates values *and combinations* at plan time — a `gen1` runtime with
> NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`, an
> invalid `database_type`. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created, so most mistakes below
> are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixed by Common) | Critical | Chatwoot's schema and pgvector-backed search require Postgres 15+; any other engine breaks `chatwoot-prepare`. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `SECRET_KEY_BASE` (auto-generated) | Never change | Critical | Rotating it invalidates every signed session/cookie and makes ActiveRecord-encrypted columns permanently unreadable; Sidekiq will also fail to decrypt in-flight jobs. |
| `enable_redis` | `true` (forwarded unconditionally) | Critical | Sidekiq (background jobs, channel delivery) and ActionCable (real-time UI) both require Redis; disabling it silently breaks message delivery even though the web UI loads. |
| `container_image_source` | `custom` | High | Chatwoot is a Docker Hub prebuilt image wrapped in a custom entrypoint (env mapping + Sidekiq launch); switching to `prebuilt` skips that wrapper and the container won't map `DB_*`/`REDIS_*` correctly. |
| `chatwoot-prepare` job order | Runs after `db-init` (`depends_on_jobs = ["db-init"]`) | High | Running schema prep before the database/role/extension grants exist fails the Job (`must be superuser` on `CREATE EXTENSION`, or the DB/role missing entirely). |
| `enable_cloudsql_volume` | `true` | High | The Cloud SQL Auth Proxy Unix socket is required for the long-running app container's DB connectivity on Cloud Run. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded attachments ephemeral — lost on the next revision. |
| `min_instance_count` | `1` for production | High | Below 1, the co-located Sidekiq worker is not running between requests, so background jobs (channel polling, notifications, reports) stall. |
| `cpu_always_allocated` | `true` for production (with `min_instance_count >= 1`) | Medium/High | The `false` cost-first default only allocates CPU while serving a request; Sidekiq and ActionCable work pauses outside that window and the keep-warm tail. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks external channel webhooks and the public live-chat widget. |
| `enable_iap` | only when public channels not needed | High | IAP blocks all unauthenticated requests, including channel webhooks and the live-chat widget. |
| `ENABLE_ACCOUNT_SIGNUP` (default `"false"`) | Leave `false`, enable briefly for first admin if needed | Medium | Leaving public self-service signup enabled on an internet-facing helpdesk lets anyone register an agent/admin account. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of conversation/customer data. |
| `enable_cloud_armor` | enable for production | Medium | The agent console and public channel endpoints are reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Chatwoot-specific application
configuration shared with the GKE variant lives in the `Chatwoot_Common`
module (`modules/Chatwoot_Common`); see
**[Chatwoot_Common](Chatwoot_Common.md)** for secrets, DB bootstrap, the
container image/entrypoint, health probes, and object storage, and
[Chatwoot_GKE](Chatwoot_GKE.md) for the parallel GKE-side wiring notes.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Chatwoot on Cloud Run](../labs/Chatwoot_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Chatwoot on GKE Autopilot](Chatwoot_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Chatwoot Common — Shared Application Configuration](Chatwoot_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Twenty CRM on Google Cloud Run](Twenty_CloudRun.md), [Cal.com on Google Cloud Run](CalCom_CloudRun.md), [Listmonk on Google Cloud Run](Listmonk_CloudRun.md), [Metabase on Google Cloud Run](Metabase_CloudRun.md) in the **CRM & Sales Operations** solution.
