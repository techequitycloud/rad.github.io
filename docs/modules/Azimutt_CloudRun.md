---
title: "Azimutt on Google Cloud Run"
description: "Configuration reference for deploying Azimutt on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Azimutt on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_CloudRun.png" alt="Azimutt on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt is an open-source, next-generation database-schema explorer and ERD (entity
relationship diagram) tool for real-world databases, built with Elixir/Phoenix. It
lets teams explore, document, and design large schemas (thousands of tables), search
across columns and relations, and share diagrams. This module deploys Azimutt on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Azimutt uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Azimutt costs on RAD, and how that compares

**Azimutt on RAD's Cloud Run module costs about US$89 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 110 credits (US$11 at the top-up price) in a project you own, and 99 credits (10% lower) in a project RAD manages. If Azimutt needs to run continuously across pods or beside other Kubernetes workloads, see the [GKE guide](Azimutt_GKE.md) instead. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$89 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$89 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **26 credits a day**, about 780 a month (about US$78 at the top-up price, US$62 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database is shared by every application in the project, so a second application does not add a second one.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | US$31.53 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$89** |

### How it compares

- **No name-brand SaaS competitor is a clean match for Azimutt, so the honest comparison is a plain self-managed server.** Running the same open-source software yourself, a Hetzner CPX22 (2 vCPU/4 GB, about $24/month) or a DigitalOcean 2 vCPU/4 GB Droplet (also $24/month) is roughly the same shape; a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) runs about $49/month.
- **RAD is not cheaper than a bare VPS in cash terms, and does not try to be.** What RAD adds for a similar price is a managed database, Secret Manager for credentials, and monitoring that would otherwise be your own job to set up, patch and keep backed up.
- **The admin's own time is the real cost a VPS does not show.** Security patches, backups and version upgrades on a bare server are work someone has to keep doing; RAD's managed services absorb that.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Azimutt runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running Azimutt continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project outright. Google does not remove it immediately: it keeps the project,
  recoverable, for 30 days, and because billing is already unlinked nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project simply stops, and nothing is billed in the
  meantime.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, only the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its billing
  account, then asks you to run **Update** on each deployment to confirm everything came back.
  Because nothing was individually destroyed, that Update finds the same resources already
  there — it is a check, not a rebuild, and an Update never charges the module fee again. This
  costs only a handful of credits in total (under US$1), against paying the module fee and a
  full build again.
- **What this needs.** You must own the project (not one RAD only manages billing for), you
  must restore it yourself within the 30 days — after that Google deletes it for good — and
  restoring is admitted like creating a new project, so your purchased credit balance must
  still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: backups do not survive.** Anything Azimutt writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  115 credits (about US$11.50) in your own project, or
  104 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once Azimutt would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 4 days or more in your own project (US$2.95/day) or 4 days or more in a RAD-managed one (26 credits/day).
- **Most of the running cost is usually shared infrastructure.** The database stops only when nothing else in the project uses them, so deleting Azimutt while another application shares the project saves only Azimutt's own compute part.
- **Keep your data first.** Anything Azimutt writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Azimutt in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Azimutt for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics. Prices change; check each source before relying on a figure.

## 1. Overview

Azimutt runs as a single Elixir/Phoenix container on Cloud Run v2, listening on port
**4000**. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Phoenix container, 2 vCPU / 4 GiB by default, serverless autoscaling; scale-to-zero enabled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Azimutt does not support MySQL or other engines |
| Object storage | Cloud Storage | A bucket is provisioned; uploads default to local ephemeral disk (`FILE_STORAGE_ADAPTER = local`) |
| Secrets | Secret Manager | Auto-generated Phoenix `SECRET_KEY_BASE`; database password |
| Image build | Cloud Build + Artifact Registry | Thin wrapper FROM `ghcr.io/azimuttapp/azimutt`, mirrored into Artifact Registry |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup. All Azimutt project
  data (schemas, diagrams, layouts, users) lives in Postgres.
- **Azimutt connects to Postgres over private-IP TCP with SSL, not the socket.**
  Ecto/postgrex cannot parse the Cloud SQL Unix-socket DSN, so the cloud entrypoint
  builds `DATABASE_URL` against `DB_IP` and sets `DATABASE_ENABLE_SSL=true`. The
  Cloud SQL socket is still mounted (`enable_cloudsql_volume = true`) purely so the
  `db-init` job can create the role/database without SSL.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager.
  Rotating it after first boot signs out every active session; only rotate in a
  maintenance window.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Azimutt is a request/response app and a cold start
  reconnects to Postgres cleanly. Cold starts add a few seconds of latency after
  idle; set `min_instance_count = 1` to avoid them.
- **Migrations run automatically on every boot.** The container command is
  `/app/bin/migrate && /app/bin/server`, so a version upgrade applies its schema
  changes on start — allow extra time on the first boot.
- **`application_version = "latest"` maps to Azimutt's `main` tag.** Azimutt
  publishes no `:latest` tag; pin to a specific release in production.
- **Sign-up is open by default.** Azimutt lets anyone with the URL create an account.
  Restrict access after creating your first account (custom domain + IAP, or Azimutt's
  own auth settings via `environment_variables`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Azimutt service

Azimutt runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the composed DB wiring the entrypoint logged at boot:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
    --limit 50 | grep cloud-entrypoint
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Azimutt stores all application data (schemas, diagrams, layouts, users, sources) in a
managed Cloud SQL for PostgreSQL 15 instance. On Cloud Run the service connects over
the instance **private IP** with SSL (`DATABASE_ENABLE_SSL=true`) — Ecto cannot parse
the socket DSN. On first deploy an initialization Job creates the application database
and role; Azimutt then runs its own Ecto migrations on boot.

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

A **Cloud Storage** bucket is provisioned for Azimutt. With the default
`FILE_STORAGE_ADAPTER = "local"`, Azimutt writes file uploads to the container's local
ephemeral disk rather than to this bucket; the bucket exists for operators who switch
Azimutt to an S3-compatible file adapter. Project data itself lives in Postgres.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

The Phoenix **`SECRET_KEY_BASE`** is generated automatically and stored in Secret
Manager (used to sign and encrypt session cookies). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Cloud Build & Artifact Registry

Azimutt's image is a thin wrapper built FROM `ghcr.io/azimuttapp/azimutt`; Cloud Build
produces the wrapped image and it is mirrored into Artifact Registry
(`enable_image_mirroring = true`). The base tag comes from the `AZIMUTT_VERSION` build
arg (with `latest` mapped to `main`).

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. VPC egress is required so Azimutt can
reach the Cloud SQL private IP.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The `cloud-entrypoint`
lines show the resolved `DATABASE_URL` path, `PHX_HOST`, and `PORT`.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Azimutt Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role
  (`LOGIN CREATEDB`) and database, grants `ALL` on the database and the `public`
  schema, and `ALTER`s the schema owner — Azimutt needs full DDL rights because it
  runs its own migrations. The job is safe to re-run.
- **Migrations run on start.** The container command is
  `/app/bin/migrate && /app/bin/server`, so Ecto applies pending migrations on every
  boot before the Phoenix endpoint binds. Upgrading `application_version` applies
  schema changes automatically — no separate migration step.
- **Runtime DB wiring is composed by the entrypoint.** `DATABASE_URL` is built from
  the injected `DB_*` vars, the password is URL-encoded, and on Cloud Run the
  connection uses the private IP (`DB_IP`) with `DATABASE_ENABLE_SSL=true`. `PHX_HOST`
  is derived from the injected service URL (scheme stripped).
- **`SECRET_KEY_BASE` is stable and effectively immutable.** It is generated once and
  written to Secret Manager. Rotating it invalidates every active session cookie —
  all users are signed out. Only rotate in a maintenance window.
- **Health path.** The startup and readiness probes target the Phoenix root `/` — the
  first endpoint that returns 200 once the server has booted and connected to
  Postgres. Allow ~1–2 minutes on first boot for migrations (the startup probe
  provides a 60-second initial delay plus a retry window).
- **First-run setup.** Open the service URL and create the first Azimutt account
  through the sign-up page. Sign-up is open by default — restrict access afterwards.
- **Inspect the init job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Azimutt are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `azimutt` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Azimutt` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Azimutt image tag; `latest` maps to the `main` tag. Pin to a release in production. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` for background Oban jobs or to avoid cold starts. |
| `max_instance_count` | `5` | Maximum instances. |
| `container_port` | `4000` | Phoenix listens on 4000; probes must match. |
| `cpu_always_allocated` | `false` | Request-based billing (CPU billed only while serving). Set `true` (with `min ≥ 1`) only for background Oban jobs. |
| `enable_cloudsql_volume` | `true` | Mounts the Cloud SQL socket for the `db-init` job; the app still connects over TCP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress; set `internal` to restrict to VPC/LB. |
| `enable_iap` | `false` | Require Google sign-in in front of Azimutt. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `PHX_SERVER`, `FILE_STORAGE_ADAPTER`, `PORT`, `PHX_HOST`, and `DATABASE_URL` are set automatically — do not override them. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `SECRET_KEY_BASE` is injected automatically. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisions and mounts a Filestore NFS share at `nfs_mount_path` (`/opt/azimutt/storage`). With the default `FILE_STORAGE_ADAPTER = local`, Azimutt still writes uploads to its own ephemeral working directory rather than this mount. |
| `gcs_volumes` | `[]` | Optional GCS Fuse volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `azimutt` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `azimutt` | Application database user. Password auto-generated in Secret Manager. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay | Startup probe; allow time for first-boot migrations. |
| `liveness_probe` | HTTP `/` | Liveness probe. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default — Azimutt uses PostgreSQL (Oban) for background jobs, not Redis. |
| `redis_host` | `""` | Redis endpoint (only if a downstream feature requires it). |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls & Audit Logging

Standard App_CloudRun behaviour — `enable_vpc_sc`, `vpc_sc_dry_run`,
`enable_audit_logging`. See [App_CloudRun](App_CloudRun.md).

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
| `SECRET_KEY_BASE` (auto-generated) | Never rotate outside a maintenance window | Critical | Rotating it invalidates every active session cookie — all users are signed out. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and orphans all Azimutt data. |
| `container_port` | `4000` | Critical | Phoenix binds 4000; a mismatched port makes every probe hit a dead port and the revision never becomes Ready. |
| `enable_cloudsql_volume` | `true` | High | The socket mount is what lets `db-init` create the role/database without SSL; disabling it breaks first-deploy bootstrap. |
| `application_version` | Pin a release | High | `latest` maps to the rolling `main` tag; an unexpected upstream change can break a redeploy. |
| `memory_limit` | `4Gi` | High | Undersizing the Elixir BEAM VM risks OOM kills while rendering large schemas. |
| `ingress_settings` / `enable_iap` | Restrict after first account | High | Sign-up is open by default; leaving the service publicly reachable lets anyone create an account. |
| `FILE_STORAGE_ADAPTER` (auto `local`) | Leave `local` unless using S3 | Medium | `local` writes uploads to ephemeral disk — they are lost on redeploy/scale-to-zero. Project data in Postgres is safe. |
| `min_instance_count` | `0` (or `1` for background jobs) | Medium | Scale-to-zero adds cold-start latency; background Oban jobs need `min ≥ 1` + `cpu_always_allocated = true`. |
| `enable_redis` | `false` | Low | Azimutt uses Postgres/Oban, not Redis — enabling it has no effect on Azimutt itself. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Azimutt-specific application configuration shared
with the GKE variant is described in **[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Azimutt on Cloud Run](../labs/Azimutt_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Azimutt on GKE Autopilot](Azimutt_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Azimutt Common — Shared Application Configuration](Azimutt_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Metabase on Google Cloud Run](Metabase_CloudRun.md), [CloudBeaver on Google Cloud Run](CloudBeaver_CloudRun.md), [NocoDB on Google Cloud Run](NocoDB_CloudRun.md) in the **Self-service BI** solution.
