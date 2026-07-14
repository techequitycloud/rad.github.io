---
title: "EvolutionAPI Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the EvolutionAPI module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# EvolutionAPI Common — Shared Application Configuration

`EvolutionAPI_Common` is the **shared application layer** for Evolution API. It is
not deployed on its own; instead it supplies the Evolution-API-specific configuration
that both [EvolutionAPI_GKE](EvolutionAPI_GKE.md) and
[EvolutionAPI_CloudRun](EvolutionAPI_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

Evolution API is a Node.js WhatsApp Business API gateway (built on the Baileys
library) that exposes a REST API and a manager UI for provisioning WhatsApp
instances, sending/receiving messages, and wiring webhooks into other systems.

For the infrastructure that actually provisions and runs Evolution API, see the
platform guides ([EvolutionAPI_GKE](EvolutionAPI_GKE.md),
[EvolutionAPI_CloudRun](EvolutionAPI_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by EvolutionAPI_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates the global `AUTHENTICATION_API_KEY` (32-char) and stores it in **Secret Manager** | Injected automatically as a secret env var; retrieve via Secret Manager (see below) |
| Container image | Wraps `evoapicloud/evolution-api` with a custom cloud entrypoint; builds via Cloud Build and mirrors into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine (Evolution API uses Prisma) | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants; Prisma migrations run on container boot | `initialization_jobs` output |
| Cache | Enables the **Redis** cache backend (`CACHE_REDIS_URI`), assembled by the entrypoint from the injected `REDIS_HOST` | §Redis in the platform guides |
| Object storage | Declares a **Cloud Storage** data bucket | `storage_buckets` output |
| Core settings | Sets the baseline Evolution API environment: server type/port, database save flags, cache prefix, API-key auth mode | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting the root path `/` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text and must never be changed after the first deployment:

- **`AUTHENTICATION_API_KEY`** — a 32-character random string stored as
  `secret-<resource-prefix>-<app>-api-key`. This is Evolution API's **global admin
  API key**. Every admin call and every instance-management call authenticates with
  it. It must be **stable across restarts and identical for every replica and init
  job** — if it is rotated, already-provisioned WhatsApp instances become
  unreachable and any integration still holding the old key starts returning `401`.
  The Common module therefore generates it once and injects it as a secret env var,
  rather than minting it per revision.

Retrieve the key after deployment:

```bash
# List the API-key secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read the current value (this is the key your API clients send as `apikey`):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Evolution API requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. On the first deployment a one-shot job (`db-init`) runs
using `postgres:15-alpine` and idempotently:

1. Resolves the Cloud SQL host — the Auth Proxy Unix-socket directory on Cloud Run,
   or the proxy TCP host on GKE (falling back to the private `DB_IP` if unset),
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role `evolution` with `LOGIN CREATEDB` and
   the generated password,
4. Creates the `evolution` database if it does not already exist,
5. Grants all privileges on the database and the `public` schema to the app user and
   makes it the **owner of the `public` schema** (Postgres 15 requires this so Prisma
   can create/alter objects without `permission denied for schema public`),
6. Signals the Cloud SQL Auth Proxy sidecar to shut down (`/quitquitquit`) so the Job
   pod completes.

The job creates only the database and role — **the schema and tables are created by
Prisma migrations that run on container boot** (`deploy_database.sh` →
`prisma migrate deploy`), not by this job. The job is safe to re-run. Inspect the
database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database (`evolution`), and user (`evolution`) names are in the platform
deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper built `FROM evoapicloud/evolution-api:<version>`.
The upstream `atendai/evolution-api` Docker Hub namespace is now gated (anonymous
pulls return `401`), so the build uses the publicly pullable `evoapicloud` namespace,
which carries the same version tags (`v2.1.1`, `v2.2.3`, `latest`, …). A dedicated
build arg (`EVOLUTIONAPI_VERSION`) pins the base tag — **not** the generic
`APP_VERSION`, which the foundation injects and would otherwise clobber to whatever
`application_version` is set to. When `application_version = "latest"` the build arg
maps to a pinned `v2.1.1`.

A thin shell entrypoint (`cloud-entrypoint.sh`) runs before the Node.js server starts:

- **Assembles `DATABASE_CONNECTION_URI`** (a Prisma/`postgres://` URL) from the
  foundation-injected `DB_*` vars, branching on the resolved host:
  - **Cloud Run** — `DB_HOST` is a Cloud SQL socket *directory*, so the socket is
    passed as the `?host=` query parameter (`sslmode=disable`; the Auth Proxy
    terminates TLS). The socket colons would break the URL authority, so they never
    go in the `host:port` slot.
  - **GKE** — the cloud-sql-proxy sidecar listens on `127.0.0.1`, so plain TCP with
    `sslmode=disable`.
  - **Direct private IP** — `sslmode=require` (Cloud SQL rejects unencrypted
    private-IP TCP). The DB password is URL-encoded before it enters the URL.
- **Assembles `CACHE_REDIS_URI`** from the injected `REDIS_HOST`/`REDIS_PORT`
  (Redis DB index `6`), optionally with `REDIS_AUTH`.
- **Defaults `SERVER_URL`** to the public service URL (`CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL`) — Evolution API embeds this in QR-code and webhook callback URLs.
- **Waits for the Cloud SQL Auth Proxy socket** (up to ~120 s) before handing off,
  because Prisma's migrate-on-boot fails hard if the DB is not yet reachable — which
  would leave port 8080 unbound and wedge the startup probe with no app logs.
- **Execs the image's own start command** — runs the Prisma migrate script as a
  subprocess (so a transient migrate failure cannot kill the parent shell) and then
  `npm run start:prod`.

---

## 5. Core application settings

`EvolutionAPI_Common` establishes the baseline Evolution API environment so the
application comes up correctly on first boot:

- **Server** — `SERVER_TYPE = "http"`, `SERVER_PORT = "8080"`.
- **Database (Prisma)** — `DATABASE_ENABLED = "true"`,
  `DATABASE_PROVIDER = "postgresql"`, `DATABASE_CONNECTION_CLIENT_NAME = "evolution"`,
  and the `DATABASE_SAVE_DATA_*` flags (instances, new messages, message updates,
  contacts, chats) all `"true"` so message history and instance state persist in
  PostgreSQL. The connection URI itself is built by the entrypoint.
- **Cache (Redis)** — `CACHE_REDIS_ENABLED = "true"`,
  `CACHE_REDIS_PREFIX_KEY = "evolution"`, `CACHE_REDIS_SAVE_INSTANCES = "true"`,
  `CACHE_LOCAL_ENABLED = "false"`. The `CACHE_REDIS_URI` is built by the entrypoint.
- **Auth** — `AUTHENTICATION_TYPE = "apikey"`; the key is injected from Secret Manager
  as `AUTHENTICATION_API_KEY`.
- **Logging** — `LOG_LEVEL = "ERROR"`, `LOG_COLOR = "false"`.

No PostgreSQL extensions and no MySQL plugins are required — Evolution API's Prisma
migrations use only the standard `public` schema.

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes target the root path **`/`** —
Evolution API serves an unauthenticated status/welcome response there once the server
is up, so it makes a good unauthenticated liveness signal (the `/manager` UI and all
`/instance/*` endpoints require the API key). A generous startup window accommodates
the Prisma migrations that run on first boot.

- **Startup** — HTTP `/` with a 60-second initial delay and a 30-retry window
  (period 15 s) — sufficient for first-boot Prisma migrations on a fresh Cloud SQL
  instance.
- **Liveness** — HTTP `/` with a 60-second initial delay, 30-second period.
- **Readiness** — HTTP `/` with a 30-second initial delay, 10-second period.

---

## 7. Object storage

A dedicated **Cloud Storage** data bucket (`name_suffix = "storage"`, STANDARD class,
public access prevention enforced) is declared here and provisioned by the foundation,
which also grants the workload service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Evolution-API-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[EvolutionAPI_GKE](EvolutionAPI_GKE.md)** and
**[EvolutionAPI_CloudRun](EvolutionAPI_CloudRun.md)**.
