---
title: "Ghostfolio on Google Cloud Run"
description: "Configuration reference for deploying Ghostfolio on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Ghostfolio on Google Cloud Run

Ghostfolio is an open-source, AGPL-licensed wealth management application for
tracking net worth, investment portfolios, and asset allocation across multiple
brokerage accounts and platforms — a privacy-first alternative to commercial
portfolio trackers. This module deploys Ghostfolio on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Ghostfolio uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Ghostfolio runs as a NestJS (Prisma ORM) container on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | NestJS API + Angular frontend served from one container, 1 vCPU / 1 GiB by default, request-based billing, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Required — Ghostfolio's Prisma ORM does not support MySQL |
| Cache & queue | Redis (**required**, not optional) | Market-data caching, sessions, and Bull queue/job management |
| Secrets | Secret Manager | Auto-generated `ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Ghostfolio's Prisma ORM does not support other engines.
- **Redis is mandatory, not optional.** Unlike many apps in this catalogue where
  Redis is an opt-in performance feature, Ghostfolio's health endpoint itself
  checks Redis connectivity and the app will not serve real traffic without it.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are generated automatically** and
  stored in Secret Manager. Both are boot-blocking — Ghostfolio has no sane default
  for either. Rotating `ACCESS_TOKEN_SALT` after first boot invalidates every
  previously issued Security Token (see §3).
- **No seeded admin account.** Ghostfolio has no email/password login form and no
  first-run setup wizard to fill in — the first visitor to the deployed URL clicks
  "Get Started" and the app mints a random anonymous Security Token as the account
  owner.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Ghostfolio's API is pure request/response with
  no in-process background scheduler of its own, so request-based billing applies
  cleanly.
- **No bulk file/media storage is provisioned.** Ghostfolio has no equivalent of
  user-uploaded attachments; `storage_buckets` is always empty.
- **`DATABASE_URL` is composed at runtime, never via a Unix socket.** Ghostfolio's
  Prisma connection string is a URL-authority DSN
  (`postgresql://user:pass@host:port/db`), and a Cloud SQL socket path's colons
  break that format — the container's cloud entrypoint always connects over TCP
  using the Cloud SQL private IP, with `sslmode=require`.
- **`application_version = "latest"` is genuinely valid.** Unlike several other
  prebuilt-image modules in this catalogue, Docker Hub's `ghostfolio/ghostfolio`
  publishes a real `latest` tag, so no version-pinning workaround is required
  (pinning is still recommended for reproducible builds).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Ghostfolio service

Ghostfolio runs as a Cloud Run v2 service that autoscales by request load between
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

Ghostfolio stores all application data (accounts, holdings, activities, market data
cache, user records) in a managed Cloud SQL for PostgreSQL 15 instance. On first
deploy an initialization Job creates the application database and role; Ghostfolio's
own container entrypoint runs Prisma migrations on every subsequent boot.

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

### C. Redis (required)

Redis backs market-data caching, sessions, and Bull queue/job management —
Ghostfolio will not start correctly without a reachable Redis instance. When
`redis_host` is left empty, the platform NFS VM's IP is used as the Redis
endpoint (requires `enable_nfs = true` or a discovered `Services_GCP` NFS server).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the running revision's Redis env vars:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`ACCESS_TOKEN_SALT` (hashes the anonymous Security Token login credential) and
`JWT_SECRET_KEY` (signs auth JWTs). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

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

## 3. Ghostfolio Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects to Cloud SQL and idempotently creates the
  application role, database, and grants. The job is safe to re-run.
- **Migrations and seeding run on EVERY container boot**, inside the same process
  as the server — not as a separate init job. The upstream `docker/entrypoint.sh`
  runs `prisma migrate deploy`, then `prisma db seed`, then starts the NestJS
  server. A failed migration crashes the container loudly (the upstream script uses
  `set -ex`) rather than shipping a healthy service against an empty database.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are immutable after first boot.**
  These are generated once and written to Secret Manager. `ACCESS_TOKEN_SALT`
  hashes the anonymous Security Token — rotating it invalidates every previously
  issued token (users must re-register). `JWT_SECRET_KEY` signs session JWTs —
  rotating it logs everyone out.
- **No first-run form to fill in.** The first visitor to the deployed URL sees a
  "Get Started" button; clicking it mints a random Security Token that becomes the
  account owner's login credential. There is no email/password to set or admin
  account to bootstrap.
- **Health path.** Startup and liveness probes target `GET /api/v1/health`, which
  checks BOTH the database AND Redis connections and returns `503` until both are
  healthy — this doubles as a genuine readiness gate, not just a liveness ping.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Ghostfolio are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Ghostfolio` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Deployment-tracking tag. Docker Hub's `ghostfolio/ghostfolio` publishes a real `latest` tag, so this is directly usable — pin to a specific release (e.g. `2.153.0`) for reproducible builds. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU is sufficient for typical usage. |
| `memory_limit` | `1Gi` | 1 GiB is sufficient for typical usage. |
| `min_instance_count` | `0` | Scale-to-zero — Ghostfolio's API is pure request/response. |
| `container_port` | `3333` | Ghostfolio's `DEFAULT_PORT` (`libs/common/src/lib/config.ts`). |
| `cpu_always_allocated` | `false` | Request-based billing — no in-process background scheduler to throttle. |
| `enable_cloudsql_volume` | `true` | Mounts a Cloud SQL Auth Proxy sidecar, but Ghostfolio's cloud entrypoint never connects through the socket path directly — see §1. |
| `container_image_source` | `custom` | Cloud Build wraps the prebuilt `ghostfolio/ghostfolio` image with a thin cloud entrypoint. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `DATABASE_URL`, `PORT`, and `REDIS_PASSWORD` (aliased from `REDIS_AUTH`) are composed by the cloud entrypoint — do not set them here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. a custom market-data provider API key). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `ghostfolio` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `ghostfolio` | Application database user. Password auto-generated in Secret Manager. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. No separate migrate job exists — migrations run inside the app container on every boot. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/health`, 30s delay, 12-failure threshold | Checks BOTH database AND Redis connectivity. |
| `liveness_probe` | HTTP `/api/v1/health`, 30s delay, 3-failure threshold | Same endpoint as the startup probe. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | REQUIRED — always forward unconditionally, never gate on `redis_host != ""`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `"6379"` | Redis port. |
| `redis_auth` | `""` | Redis auth password (sensitive). Aliased at runtime onto Ghostfolio's own `REDIS_PASSWORD` env var. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Always empty — Ghostfolio needs no bulk file/media storage. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through
> the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values
> *and combinations* at plan time. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every previously issued Security Token — every user must re-register. |
| `JWT_SECRET_KEY` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions, forcing immediate re-login. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_redis` | `true`, always forwarded unconditionally | Critical | Ghostfolio's health endpoint checks Redis directly — without it the app never reports healthy, regardless of `redis_host`. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but no host resolves (NFS off, no explicit host), `REDIS_HOST` is empty and the app fails its own health check. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `application_version` | Pin for production | Medium | `latest` is genuinely valid here (unlike most modules), but still floats to whatever Docker Hub currently tags as latest — pin for reproducible deploys. |
| `min_instance_count` | `0` is fine for most deployments | Low | Scale-to-zero adds a brief cold-start delay on the first request after idle; set `1` only if that latency matters. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Ghostfolio-specific application configuration
shared with the GKE variant is described in
**[Ghostfolio_Common](Ghostfolio_Common.md)**.
