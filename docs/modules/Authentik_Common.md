---
title: "Authentik Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Authentik module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Authentik Common — Shared Application Configuration

`Authentik_Common` is the **shared application layer** for [authentik](https://goauthentik.io/) —
the open-source identity provider (SSO via OIDC/SAML, LDAP, SCIM, MFA, and proxy
authentication; a self-hosted alternative to Okta, Auth0, and Keycloak). It is not
deployed on its own; instead it supplies the authentik-specific configuration that
both [Authentik_GKE](Authentik_GKE.md) and [Authentik_CloudRun](Authentik_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End users
never configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs authentik, see the platform
guides ([Authentik_GKE](Authentik_GKE.md), [Authentik_CloudRun](Authentik_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Authentik_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates a stable `AUTHENTIK_SECRET_KEY` (64 chars) and the `akadmin` bootstrap password (24 chars) and stores both in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Thin custom build `FROM ghcr.io/goauthentik/server` with a cloud entrypoint; built via Cloud Build. `application_version = "latest"` is pinned to a known-good release (authentik publishes no `latest` tag) | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine (authentik requires PostgreSQL ≥ 14) | §Database in the platform guides |
| Database bootstrap | Defines the single first-deploy job (`db-init`) that creates the role and database and grants `cloudsqlsuperuser` defensively | `initialization_jobs` output |
| No Redis | authentik ≥ 2025.10 keeps cache, sessions, task queue, and the WebSocket channel layer in **PostgreSQL** — no cache service is provisioned | §Overview in the platform guides |
| Media storage | Declares a **GCS bucket** mounted at `/media` via GCS Fuse for uploaded icons and flow backgrounds | `storage_buckets` output |
| Worker co-location | The entrypoint launches `ak worker` in the background alongside the server in the same container, on dedicated loopback listen ports so the server owns `:9000` | Application behaviour in the platform guides |
| Health checks | Default startup probe `GET /-/health/ready/` (generous first-boot threshold) and liveness probe `GET /-/health/live/` — both unauthenticated | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager under
`secret-<tenant-prefix>-<application-name>-*`:

- **`AUTHENTIK_SECRET_KEY`** (`...-secret-key`) — the Django `SECRET_KEY` equivalent.
  authentik uses it to sign sessions and cookies and derives internal encryption from
  it. It is generated once (64 random characters) and must remain **stable for the
  deployment's life** — rotating it invalidates every active session and makes
  encrypted fields (stored credentials, tokens) unreadable.
- **`AUTHENTIK_BOOTSTRAP_PASSWORD`** (`...-bootstrap-password`) — the initial password
  for the built-in `akadmin` admin user. authentik applies it on the **first start
  only** (together with `AUTHENTIK_BOOTSTRAP_EMAIL`, default `admin@techequity.cloud`);
  later password changes happen in the application. Supplying an explicit
  `bootstrap_password` input overrides the auto-generated value.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the tenant prefix):
gcloud secrets list --project "$PROJECT" --filter="name~authentik"

# Read the bootstrap password (first login as akadmin):
gcloud secrets versions access latest \
  --secret=<secret-...-bootstrap-password> --project "$PROJECT"

# Read the secret key (do NOT rotate it):
gcloud secrets versions access latest \
  --secret=<secret-...-secret-key> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

---

## 3. Thin custom image and entrypoint mapping

The image is a minimal wrapper over the official authentik server image — no
application code is modified:

- **App-specific `AUTHENTIK_VERSION` build ARG.** The foundation injects `APP_VERSION`
  into `build_args` and wins the merge, so the Dockerfile derives its `FROM` tag from
  the app-specific `AUTHENTIK_VERSION` ARG instead. authentik publishes only version
  tags on GHCR (no `latest`), so `application_version = "latest"` is pinned to a
  known-good release (`2026.5.4`) at build time.
- **`cloud-entrypoint.sh` maps `DB_*` → `AUTHENTIK_POSTGRESQL__*` at runtime.** The
  platform injects standard `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
  variables; the entrypoint aliases them onto authentik's
  `AUTHENTIK_POSTGRESQL__HOST/PORT/NAME/USER/PASSWORD` convention. This happens in the
  entrypoint (not declaratively) for two platform reasons: Cloud Run does not
  interpolate `$(VAR)` env references, and a synced-secret key named
  `AUTHENTIK_POSTGRESQL__PASSWORD` would be rejected by the GKE SecretSync CRD (`__`
  violates its `targetKey` regex). Values already set explicitly are never overridden.
- **SSL mode by connection type.** When the DB host is a Unix-socket directory (the
  Cloud SQL Auth Proxy on Cloud Run) **or loopback** (`127.0.0.1` / `localhost` — the
  Auth Proxy sidecar on GKE), `AUTHENTIK_POSTGRESQL__SSLMODE` defaults to `disable`:
  the proxy serves both forms, is TLS-terminated, and does not speak SSL itself —
  requiring SSL on `127.0.0.1` fails with "server does not support SSL, but SSL was
  required". Only direct TCP to any other host defaults to `require` (direct
  private-IP connections to Cloud SQL reject unencrypted traffic).
- **Co-located worker.** In docker-compose authentik runs `ak worker` as a second
  container. On Cloud Run / single-pod GKE the entrypoint starts it in the background
  before `exec`-ing the server (the same pattern as Chatwoot's co-located Sidekiq
  worker). Both processes share `AUTHENTIK_SECRET_KEY` and the Postgres-backed task
  queue. The worker is started with **dedicated loopback listen ports**
  (`AUTHENTIK_LISTEN__HTTP=127.0.0.1:9001`, `AUTHENTIK_LISTEN__HTTPS=127.0.0.1:9444`,
  `AUTHENTIK_LISTEN__METRICS=127.0.0.1:9301`): the worker binary also starts an HTTP
  listener and inherits the server's default `0.0.0.0:9000`, so co-located in one
  container it can win the bind race and answer every route — the health endpoints
  included — with empty 200s (a blank UI with phantom-healthy probes). Pinning the
  worker to loopback ports guarantees the server owns `:9000`. This is why the Cloud
  Run variant defaults to `cpu_always_allocated = true` and `min_instance_count = 1`
  — the worker must keep running between requests.
- **No migration step in the entrypoint** — authentik's server runs its own
  advisory-lock-guarded migrations on every startup (see below).

Baseline environment set by this layer (overridable via `environment_variables`):
`AUTHENTIK_BOOTSTRAP_EMAIL` (default `admin@techequity.cloud`),
`AUTHENTIK_ERROR_REPORTING__ENABLED = "false"`,
`AUTHENTIK_DISABLE_UPDATE_CHECK = "true"`, and `AUTHENTIK_LOG_LEVEL = "info"`.
The container listens on **port 9000**.

Note that entrypoint and Dockerfile edits are baked into the custom image and require
a rebuild; the `db-init` script is mounted at apply time and changes take effect on
the next apply without a rebuild.

---

## 4. Database engine and bootstrap

authentik requires **PostgreSQL 15** (≥ 14); the engine is fixed and MySQL is not
supported. On the first deployment a single one-shot job (`db-init`) runs using
`postgres:15-alpine` and idempotently:

1. Waits for PostgreSQL to be reachable (Auth Proxy socket directory on Cloud Run,
   proxy TCP on GKE),
2. Creates (or updates) the tenant-scoped application role with the generated
   password,
3. Creates the application database if missing — owned by `postgres`, because Cloud
   SQL's `postgres` login cannot `SET ROLE` to application roles — and grants full
   privileges on the database and the `public` schema,
4. Grants `cloudsqlsuperuser` to the application role defensively, so any future
   `CREATE EXTENSION IF NOT EXISTS` in upstream migrations is a no-op instead of a
   "must be superuser" failure,
5. Signals the Cloud SQL Auth Proxy sidecar to shut down so the job completes.

There is **no separate schema or migrate job**: authentik's server applies its own
Django migrations on every startup, guarded by a PostgreSQL advisory lock so
concurrent instances don't collide. Version upgrades therefore need no extra
migration step — the first instance of the new revision migrates the schema while
the startup probe's generous threshold keeps the rollout waiting.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs
(note the database and user names are tenant-prefixed).

---

## 5. GCS media volume

authentik stores uploaded media — application icons and flow backgrounds — under
`/media`. This layer declares a dedicated **Cloud Storage** bucket
(`name_suffix = "storage"`) and mounts it at `/media` via GCS Fuse with
`uid=1000,gid=1000` (matching the upstream `authentik` runtime user). Media is plain
files with no locking requirements, so GCSFuse is safe, and uploads survive instance
replacement and scaling events on both platforms.

The bucket name follows the foundation formula
`gcs-<application_name><tenant-prefix>-storage` (app-scoped). List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://gcs-<service-name>-storage/
```

---

## 6. Health probe behaviour

Both authentik health endpoints are **unauthenticated**, which is a hard requirement
for platform probes (Cloud Run's front end and the GKE kubelet probe without
credentials):

- **Startup:** `GET /-/health/ready/` returns 200 once migrations have completed and
  the database is reachable. The first boot runs authentik's full migration suite, so
  the default threshold is generous — 60 s initial delay plus 40 × 15 s retries
  (roughly 11 minutes) before the rollout is failed.
- **Liveness:** `GET /-/health/live/` is a lightweight process-alive check (60 s
  delay, 3 × 30 s).

Do not repoint the probes at authenticated pages — an endpoint that returns 401/403
to the unauthenticated prober keeps the revision/pod permanently unready even though
the application booted fine.

---

For the authentik-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Authentik_GKE](Authentik_GKE.md)** and
**[Authentik_CloudRun](Authentik_CloudRun.md)**.
