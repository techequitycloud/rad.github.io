---
title: "Planka on Google Cloud Run"
description: "Configuration reference for deploying Planka on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Planka on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Planka_CloudRun.png" alt="Planka on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Planka is an open-source, self-hosted, Trello-like kanban board application
with a Node.js (Sails.js) backend and a React frontend, used for team and
personal project management — boards, lists, cards, due dates, labels, and
file attachments. This module deploys Planka on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages
the shared Google Cloud infrastructure.

This guide focuses on the cloud services Planka uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Planka runs as a single Node.js container on Cloud Run v2, serving both its
API and its React frontend from one port. The deployment wires together a
small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default, scale-to-zero |
| Database | Cloud SQL for PostgreSQL 15 | Planka's Knex query builder supports no other engine |
| Object storage | Cloud Storage | A `storage` bucket is created for attachments, but not auto-mounted |
| Cache & queue | none | Planka has no Redis or queue dependency — real-time updates ride Socket.io in-process |
| Secrets | Secret Manager | `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` — both real, functional secrets — plus the database password |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only supported engine.** `Planka_Common` fixes
  `database_type = "POSTGRES_15"` — Knex has no other backend for Planka.
- **A thin custom build, not the prebuilt image.** Planka needs a cloud
  entrypoint to compose `DATABASE_URL` from the Foundation-injected `DB_*`
  values at runtime (the password is a Secret Manager value, unavailable at
  plan time) and to derive `BASE_URL` from the service URL, so
  `container_image_source = "custom"` builds `FROM
  ghcr.io/plankanban/planka:<version>` via Cloud Build.
- **`DATABASE_URL` is a URL-authority connection string, but SSL is set via
  separate env vars — not a `?sslmode=` query parameter.** Unlike some
  Node/Postgres apps in this catalogue (e.g. Logto), Planka's own
  `.env.sample` states Knex does not parse query parameters from the
  connection string at all. TLS mode is controlled instead by the plain
  `PGSSLMODE` and `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` environment
  variables, which node-postgres reads natively — see the
  [Common guide](Planka_Common.md) for the full socket/loopback/private-IP
  branching logic.
- **Two real, functional application secrets.** `SECRET_KEY` (session/token
  signing, required at boot) and `DEFAULT_ADMIN_PASSWORD` (seeds the initial
  admin account on first, empty-database boot) are both genuinely consumed by
  Planka — confirmed against its own source (`server/.env.sample`,
  `server/db/seeds/default.js`). Planka has **no forced password-reset
  prompt**, so change the seeded password immediately after first deploy.
- **Attachments are not persisted by default.** A GCS bucket is created but
  not auto-mounted at Planka's `/app/data` path — add a `gcs_volumes` entry if
  uploaded attachments/avatars/backgrounds need to survive a revision
  restart. Board/card/list *data* is unaffected — it's stored in PostgreSQL.
- **Request-based billing by default.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — Planka's real-time updates ride Socket.io
  in-process on the request-serving process, so it needs no background CPU.
- **No Redis.** Planka has no cache or queue dependency;
  `enable_redis` defaults to `false`.
- **No NFS.** `enable_nfs` defaults to `false` — Planka needs no POSIX
  filesystem sharing; the optional GCS bucket via `gcs_volumes` covers file
  storage.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Planka service

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected DB_HOST / DB_IP / BASE_URL on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, and traffic
splitting.

### B. Cloud SQL for PostgreSQL 15

Planka stores all boards, lists, cards, and user data in a managed Cloud SQL
for PostgreSQL 15 instance. On first deploy, an initialization Job creates the
application database and role; Planka then runs its own Knex migrations and
seed on every boot via the official image's `start.sh`.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

A `storage` bucket is provisioned automatically for item attachments, avatars,
and backgrounds, but is **not** mounted into the container by default — see
the Pitfalls table.

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
  ```

### D. Secret Manager

Two application secrets — `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` — plus the
database password are stored here.

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~planka"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

Planka builds all absolute URLs (attachment links, email notifications, and
the optional OIDC redirect URI if SSO is configured) from `BASE_URL`, which the
cloud entrypoint derives from the service URL.

- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Planka Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`
  using `postgres:15-alpine`, idempotently creating the application role and
  database (no `CREATEROLE`/`CREATEDB` needed — Planka's own roles are
  app-level RBAC rows, not Postgres roles).
- **Schema migrations and seed on every boot.** The official image's own
  `start.sh` runs `node db/init.js` (migrations + seed) before starting the
  server — idempotent, so no separate migration job runs at the platform
  layer.
- **Real admin bootstrap credential — no forced reset.** Planka seeds
  `admin@example.com` with the generated `DEFAULT_ADMIN_PASSWORD` on first
  (empty-database) boot. Unlike apps that force a password reset on first
  login, Planka does not — log in and change the password via Planka's own
  UI promptly after deploy.
- **`DATABASE_URL` composed by the cloud entrypoint.** Because the database
  password is only available as a runtime Secret Manager value, the cloud
  entrypoint builds `DATABASE_URL` at container startup rather than at plan
  time, branching on the resolved `DB_HOST` (socket directory → private IP;
  loopback → plain TCP; private IP → encrypted, no cert verification). See
  [Planka_Common](Planka_Common.md) for the full detail.
- **Health path.** Startup and liveness probes are configured via the
  `startup_probe`/`liveness_probe` variables. Planka's own `server/healthcheck.js`
  targets the **root path `/`** with no auth, and this module's
  `startup_probe`/`liveness_probe` variables now correctly default to
  `path = "/"` to match.
- **Inspect job execution:**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Planka are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `planka` | Base name for resources. |
| `application_version` | `latest` | Used as the `PLANKA_VERSION` build ARG for the thin custom image. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Planka needs the cloud-entrypoint wrapper — keep `custom`. |
| `container_port` | `1337` | Planka's native default port — a single port serves the API and frontend. |
| `cpu_always_allocated` | `false` | Request-based billing. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Scale-to-zero default. |
| `memory_limit` | `4Gi` | Planka requires at least 2Gi for reliable operation. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage` bucket | Created but not auto-mounted — add `gcs_volumes` to persist attachments. |
| `gcs_volumes` | `[]` | Add an entry mounted at `/app/data` for persistent attachment storage. |
| `enable_nfs` | `false` | Not needed — Planka has no POSIX filesystem requirement. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Knex supports no other engine. |
| `db_name` / `db_user` | `planka` / `planka` | PostgreSQL database name and application username. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/`, 60s delay | Fixed to Planka's real, unauthenticated health target (per `server/healthcheck.js`), which plainly GETs `/` with no path and checks for HTTP 200. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, 60s delay | Foundation-level defaults; superseded by `startup_probe`/`liveness_probe` above whenever `application_config` supplies one (it always does here) — effectively inert. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Planka has no cache/queue dependency. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` | Cloud Run service name and default `run.app` URL. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `storage` bucket for attachments. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `custom` (default) | High | `"prebuilt"` deploys the official image directly, skipping the cloud entrypoint — Planka boots with no `DATABASE_URL` and cannot reach the database. |
| `DEFAULT_ADMIN_PASSWORD` (generated secret) | Log in and change it immediately after first deploy | **Critical** | Unlike apps with a forced password-reset prompt, Planka does not force a reset — anyone who obtains the seeded password (e.g. via Secret Manager access) can log in as admin indefinitely until it's changed. |
| `DATABASE_URL` / SSL config | Never hand-edit — controlled by the cloud entrypoint via `PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` env vars, NOT a `?sslmode=` query param | **Critical** | Planka has two independent DB connection paths with different SSL mechanisms, confirmed by tracing the actual dependency chain (not just Planka's `.env.sample`): (1) the migration CLI (`server/db/knexfile.js`) reads `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`; (2) the running server's Sails ORM (`sails-postgresql` → `machinepack-postgresql`) parses `DATABASE_URL` with Node's legacy `url.parse()`, which silently **drops every query parameter** including `?sslmode=` — so a URL-embedded sslmode does nothing for the runtime path. With no explicit `ssl` config, raw `pg` falls back to the `PGSSLMODE` *environment variable*, where `require` means "encrypt AND verify" (not "encrypt only" like classic libpq) — only `PGSSLMODE=no-verify` skips certificate verification. Cloud SQL's self-signed cert isn't in Node's CA bundle, so anything but `no-verify` fails at boot with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and the Sails `orm` hook never loads (confirmed live: two earlier attempts using `?sslmode=no-verify` in the URL and `PGSSLMODE=require` both failed this way before the correct `PGSSLMODE=no-verify` env var was identified). |
| `gcs_volumes` for attachments | Add explicitly if needed | Medium | Without it, uploaded attachments/avatars/backgrounds live on Cloud Run's ephemeral filesystem and do not survive a revision restart — board/card/list text data is unaffected. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Planka-specific application configuration
shared with the GKE variant is described in
**[Planka_Common](Planka_Common.md)**.
