---
title: "Ghostfolio Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Ghostfolio module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Ghostfolio Common — Shared Application Configuration

`Ghostfolio_Common` is the **shared application layer** for Ghostfolio. It is not
deployed on its own; instead it supplies the Ghostfolio-specific configuration that
both [Ghostfolio_GKE](Ghostfolio_GKE.md) and [Ghostfolio_CloudRun](Ghostfolio_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Ghostfolio, see the
platform guides ([Ghostfolio_GKE](Ghostfolio_GKE.md),
[Ghostfolio_CloudRun](Ghostfolio_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Ghostfolio_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` (both 32-char random strings) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `ghostfolio/ghostfolio` Docker Hub image with a custom cloud entrypoint (mirrors the `Langfuse_Common` technique); builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (Prisma ORM) as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, role, and grants — NO separate migrate job, since Ghostfolio's own container runs Prisma migrations on every boot | `initialization_jobs` output |
| Object storage | None — Ghostfolio needs no bulk file/media storage | `storage_buckets` output (always `[]`) |
| Core settings | Sets `NODE_ENV=production` and the container port (3333) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/v1/health` (checks DB + Redis) | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are
never set in plain text and both are boot-blocking (Ghostfolio has no sane default
for either):

- **`ACCESS_TOKEN_SALT`** — a 32-character random string. Used to hash the
  anonymous "Security Token" credential that Ghostfolio mints for the account
  owner on first "Get Started" (there is no seeded admin account or email/password
  form). Rotating it after first boot invalidates every previously issued Security
  Token — affected users can no longer authenticate with their existing token.
- **`JWT_SECRET_KEY`** — a 32-character random string. Used to sign all auth JWTs
  issued after Security-Token login. Rotating it immediately invalidates all
  active sessions, forcing every user to log back in.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~access-token-salt OR name~jwt-secret-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Ghostfolio requires **PostgreSQL 15** (Prisma ORM); the engine is fixed and MySQL
or other engines are not supported. On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Waits for PostgreSQL to be reachable,
2. Creates (or updates) the application role with the generated password,
3. Creates the application database if it does not already exist,
4. Grants full privileges on the database and public schema,
5. Signals the Cloud SQL Auth Proxy to shut down gracefully (GKE).

**Unlike several other Common modules, there is no separate migrate job.**
Ghostfolio's own upstream container entrypoint (`docker/entrypoint.sh`) runs
`prisma migrate deploy`, then `prisma db seed`, then starts the server — all on
every container boot, in the same process as the application. A failed migration
crashes the container loudly (the upstream script uses `set -ex`) instead of
shipping a healthy service against an empty database, which is why no additional
guard/verify job is needed here (contrast with Twenty's `twenty-verify` pattern).

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Container image and entrypoint

The custom image is a **thin wrapper** `FROM ghostfolio/ghostfolio:<version>` — the
same technique `Langfuse_Common` uses for other prebuilt-image applications.
`cloud-entrypoint.sh` runs before Ghostfolio's own startup sequence:

- **Composes `DATABASE_URL`** from the Foundation-injected `DB_*` vars. Ghostfolio's
  DSN is a URL-authority connection string
  (`postgresql://user:pass@host:port/db?...`), so the entrypoint NEVER uses the
  Cloud SQL Unix-socket path (its colons would break URL-authority parsing — the
  same trap documented for Vikunja/Logto). It always connects over TCP using
  `DB_IP`, branching only on whether the resolved host is loopback:
  - **Cloud Run**: `DB_IP` is always the real Cloud SQL private IP →
    `sslmode=require`.
  - **GKE**: `DB_IP` resolves to `127.0.0.1` when the cloud-sql-proxy sidecar is
    active → `sslmode=disable`.
- **Aliases `REDIS_AUTH` onto `REDIS_PASSWORD`** — the Foundation always injects the
  Redis password secret under the hardcoded name `REDIS_AUTH` (not configurable in
  `App_CloudRun`/`App_GKE`), but Ghostfolio's own Redis client reads
  `REDIS_PASSWORD` (`apps/api/src/helper/redis.helper.ts`). `REDIS_HOST` and
  `REDIS_PORT` need no aliasing.
- **Delegates to the base image's own CMD** (`/ghostfolio/entrypoint.sh`) via
  `exec "$@"` — this runs Prisma migrate + seed + server start, matching the
  un-wrapped image's exact behaviour. The Dockerfile explicitly redeclares this
  `CMD` — a bare custom `ENTRYPOINT` with no matching `CMD` would otherwise silently
  discard it.

---

## 5. Core application settings

`Ghostfolio_Common` establishes the baseline Ghostfolio environment:

- **`NODE_ENV = "production"`**.
- **`container_port = 3333`** — Ghostfolio's `DEFAULT_PORT`
  (`libs/common/src/lib/config.ts`); the app binds `0.0.0.0` (`DEFAULT_HOST`) by
  default, so no host override is needed.
- **Redis is required, not optional** — `enable_redis` must be forwarded
  unconditionally from the Application modules; gating it on `redis_host != ""`
  would suppress the platform's NFS-IP Redis fallback injection and leave
  `REDIS_HOST` unset.
- **No `STORAGE_TYPE`/GCS wiring** — Ghostfolio needs no bulk file/media storage.

---

## 6. Health probe behaviour

The default probes target `GET /api/v1/health` — Ghostfolio's own health
controller (`apps/api/src/app/health/health.controller.ts`) checks BOTH the
database AND Redis connections and returns `503` until both are healthy, so it
doubles as a genuine readiness gate rather than a simple liveness ping.

- **Startup probe**: HTTP, 30s initial delay, 10s period, 12-failure threshold
  (~2 minutes total).
- **Liveness probe**: HTTP, 30s initial delay, 30s period, 3-failure threshold.

---

## 7. Object storage

None. Ghostfolio needs no bulk file/media storage — `storage_buckets` is always
`[]`.

```bash
gcloud storage buckets list --project "$PROJECT"   # will not show a Ghostfolio-specific bucket
```

---

For the Ghostfolio-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Ghostfolio_GKE](Ghostfolio_GKE.md)** and
**[Ghostfolio_CloudRun](Ghostfolio_CloudRun.md)**.
