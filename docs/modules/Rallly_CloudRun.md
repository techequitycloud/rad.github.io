---
title: "Rallly on Google Cloud Run"
description: "Configuration reference for deploying Rallly on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Rallly on Google Cloud Run

Rallly is an open-source, self-hosted meeting-scheduling and group-poll application —
a privacy-friendly alternative to Doodle — built with Next.js and Prisma. This module
deploys Rallly on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Rallly uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Rallly runs as a single Next.js container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Required — Rallly does not support MySQL or other engines |
| Email | SMTP relay (external) | Passwordless email login; provide your own SMTP host/credentials |
| Secrets | Secret Manager | Auto-generated `SECRET_PASSWORD` and `NEXTAUTH_SECRET`; optional `SMTP_PWD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup. All Rallly state
  (polls, votes, comments, users) lives in this database.
- **`SECRET_PASSWORD` and `NEXTAUTH_SECRET` are generated automatically** and stored
  in Secret Manager. These keys must not be rotated after first boot without a
  maintenance window — rotating `SECRET_PASSWORD` invalidates previously encrypted
  data, and rotating `NEXTAUTH_SECRET` invalidates all active sessions and in-flight
  login links.
- **Rallly login is passwordless and email-based.** Users register and sign in by
  receiving a verification link/code, so a working SMTP configuration is effectively
  required before anyone can log in. This variant defaults `smtp_host` to
  `smtp.gmail.com`; you must still supply `smtp_user` / `smtp_password` (or clear
  `smtp_host`) for mail to actually send.
- **The public base URL is set automatically.** `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL`
  default to this service's deterministic Cloud Run URL and are corrected at runtime
  from `CLOUDRUN_SERVICE_URL` by the entrypoint. Set `base_url` to your custom domain
  before going live so invite and login links resolve correctly.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, `max = 1`). Cold
  starts add a few seconds of latency to the first request after idle; set
  `min_instance_count = 1` to keep the service warm.
- **NFS and Redis are disabled.** Rallly stores all state in PostgreSQL and needs no
  shared filesystem or cache; both are off by default (Redis is hard-wired off).
- **Migrations run on start.** The container's own `./docker-start.sh` runs
  `prisma migrate deploy` on every boot, so version upgrades apply schema changes
  without a separate migration step. The `db-init` job only provisions the empty
  database and role.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Rallly service

Rallly runs as a Cloud Run v2 service that autoscales by request load between the
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

Rallly stores all application data (polls, options, participants, votes, comments, and
user accounts) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket
(`enable_cloudsql_volume = true`); no public IP is exposed. On first deploy the
`db-init` Job creates the application database and role; Rallly then applies its own
Prisma schema on start.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database (`rallly`), user (`rallly`), and password secret are in
the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Email (SMTP)

Rallly sends login/verification and invitation emails through an external SMTP relay.
When `smtp_host` is set, the container receives `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_SECURE`, and the `SMTP_PWD` secret. There is no managed Google email service —
supply your own (Gmail SMTP, SendGrid, Mailgun, etc.).

- **CLI (verify the injected settings on the running revision):**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`SECRET_PASSWORD` (Rallly's data-encryption / session secret) and `NEXTAUTH_SECRET`
(signs NextAuth session tokens and email login links). A third, `SMTP_PWD`, is created
only when SMTP is configured. The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~rallly"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. Set `base_url` to the public hostname so
Rallly's invite and login links match the address users actually visit.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Rallly Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application database and role, grants privileges, and then signals the
  proxy to shut down. It is configured with `max_retries = 3` and is safe to re-run.
- **Schema migrations on start.** Rallly's own `./docker-start.sh` runs
  `prisma migrate deploy` on every startup, so the schema is created on the first boot
  after `db-init` and upgrading the application version applies schema changes without
  a separate migration step.
- **`SECRET_PASSWORD` and `NEXTAUTH_SECRET` are immutable after first boot.** They are
  generated once and written to Secret Manager. Changing `SECRET_PASSWORD` invalidates
  previously encrypted data; changing `NEXTAUTH_SECRET` invalidates all active sessions
  and in-flight login links. Only rotate during a planned maintenance window.
- **Passwordless email login.** Rallly authenticates users via emailed verification
  links/codes. Without a working SMTP relay, users cannot receive login emails and
  effectively cannot sign in. Confirm SMTP settings on the running revision after
  deploy.
- **Public base URL.** `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` are set from the
  predicted Cloud Run URL at plan time and corrected at runtime from
  `CLOUDRUN_SERVICE_URL`. If you front the service with a custom domain, set `base_url`
  to it so links resolve to the address users visit:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Health path.** The startup probe is **TCP** (not HTTP), not `/api/status` — Rallly's
  `/api/status` endpoint only returns 2xx once the app reports *full* readiness (DB + Redis
  + deps), so an HTTP probe on that path never passed even though Next.js was already
  listening on :3000; a TCP check succeeds as soon as the port is bound, which is the right
  gate for routing traffic. Default: 30-second initial delay, 20-second period, 10 retries
  (~230 seconds of budget) to cover the first-boot Prisma migration. The liveness probe is
  **disabled by default** for the same reason — Cloud Run liveness can't use a TCP socket,
  and an HTTP check on `/api/status` would restart-loop a healthy-but-not-yet-fully-ready
  container; the TCP startup probe already gates routing.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Rallly are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 2 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `rallly` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Rallly image tag (`lukevella/rallly`); pin to a specific release in production. |

### Group 3 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU is sufficient for typical use. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Rallly is stateless in Postgres and can scale horizontally; raise as needed. |
| `container_port` | `3000` | Rallly listens on port 3000. |
| `cpu_always_allocated` | `false` | Request-based billing. Rallly's response pipeline (notification emails) only runs after a request, so idle CPU is not needed. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix socket for PostgreSQL. |
| `base_url` | `""` | Public URL for `NEXT_PUBLIC_BASE_URL` / NextAuth links. Empty → the deterministic Cloud Run URL. Set to your custom domain before going live. |

### Group 5 — Access, Ingress & Email

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Traffic sources permitted to reach the service. |
| `enable_iap` | `false` | Require Google sign-in in front of Rallly (Cloud Run native IAP). |
| `smtp_host` | `smtp.gmail.com` | SMTP relay hostname. A non-empty value provisions `SMTP_PWD` and injects the `SMTP_*` env vars. Clear it to disable email. |
| `smtp_port` | `587` | SMTP port (587 STARTTLS, 465 SSL). |
| `smtp_user` | `""` | SMTP username — **set this** (with `smtp_password`) or email login will not work. |
| `smtp_password` | `""` (sensitive) | SMTP password. Empty → an auto-generated secret is stored. |
| `smtp_secure_enabled` | `false` | Enable implicit TLS/SSL (true for port 465). |
| `mail_from` | `""` | Sender address for `NOREPLY_EMAIL` / `SUPPORT_EMAIL`. Empty → `noreply@rallly.local`. |

### Group 11 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `rallly` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `rallly` | Application database user. Password auto-generated in Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixed — Rallly requires PostgreSQL 15. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off — Rallly stores all state in PostgreSQL. |
| `gcs_volumes` | `[]` | No GCS Fuse volumes are required. |

### Group 13 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay / 20s period / 10 retries | Deliberately TCP, not HTTP `/api/status` — that endpoint only returns 2xx at full readiness (DB + Redis + deps), which would never let a healthy container start routing. Allow for the first-boot Prisma migration. |
| `liveness_probe` | Disabled (`enabled = false`) | HTTP `/api/status`, 15s delay, but disabled by default — an early HTTP check on that path would restart-loop a healthy container before full readiness; the TCP startup probe already gates routing. |

### Group 20 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Rallly uses no Redis; leave disabled. |

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
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (none by default for Rallly). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, `enable_cloudsql_volume = true` with `database_type = NONE`, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_PASSWORD` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates previously encrypted data and active sessions. |
| `NEXTAUTH_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions and in-flight email login links. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Rallly supports only PostgreSQL 15; any other engine breaks startup. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `smtp_user` / `smtp_password` | Set when `smtp_host` is set | High | With `smtp_host` set (default `smtp.gmail.com`) but empty credentials, login emails never send and users cannot sign in. |
| `base_url` | Your custom domain | High | If left empty behind a custom domain, invite and login links point at the raw `run.app` URL instead of the address users visit. |
| `enable_iap` | Only for internal deployments | High | IAP puts a Google-auth gate in front of Rallly; anonymous poll participants cannot reach it. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy socket is required for PostgreSQL connectivity; a plan-time guard blocks it with `database_type = NONE`. |
| `min_instance_count` | `1` for latency-sensitive use | Medium | Scale-to-zero (`0`) adds a cold-start delay on the first request after idle. |
| `startup_probe` timing | Keep the generous default | Medium | Too tight a window can fail the probe during the first-boot Prisma migration. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Rallly-specific application configuration shared
with the GKE variant is described in **[Rallly_Common](Rallly_Common.md)**.
