---
title: "Plausible Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Plausible module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Plausible Common — Shared Application Configuration

`Plausible_Common` is the **shared application layer** for Plausible Analytics
Community Edition — the leading open-source, AGPL-3.0-licensed, privacy-first,
cookie-free web analytics platform and the most widely self-hosted alternative to
Google Analytics. It is not deployed on its own; it supplies the Plausible-specific
configuration that [Plausible_GKE](Plausible_GKE.md) builds on. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

There is deliberately **no Plausible_CloudRun variant**: Plausible's mandatory event
store is ClickHouse (provided by [ClickHouse_GKE](ClickHouse_GKE.md)), and ClickHouse
cannot run on Cloud Run — so Plausible follows the "Common + GKE only" pattern (like
Supabase and Temporal).

For the infrastructure that actually provisions and runs Plausible, see the platform
guide ([Plausible_GKE](Plausible_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Plausible_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_KEY_BASE` (64 chars) and `TOTP_VAULT_KEY` (exactly 32 bytes, base64) and stores them in **Secret Manager** under service-scoped names | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Thin custom build `FROM ghcr.io/plausible/community-edition` with a cloud entrypoint; built via Cloud Build. `"latest"` pins to release `v3.2.1` via the app-specific `PLAUSIBLE_VERSION` build ARG | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** — accounts/sites configuration ONLY; all analytics events live in ClickHouse | Database section of the platform guide |
| Database bootstrap | Defines the first-deploy `db-init` job (`postgres:15-alpine` + `create-db-and-user.sh`) creating the Postgres role and database | `initialization_jobs` output |
| ClickHouse wiring | Exposes `clickhouse_url`/`clickhouse_db`/`clickhouse_user` as `PLATFORM_CLICKHOUSE_*` env vars for the entrypoint to compose `CLICKHOUSE_DATABASE_URL` | Application behaviour in the platform guide |
| Core settings | `HTTP_PORT = 8000`, 1 vCPU / 1Gi memory (BEAM + Oban floor), min 1 / max 10 replicas, Cloud SQL Auth Proxy sidecar on | Defaults in the platform guide |
| Health checks | Default startup/liveness probes targeting HTTP `GET /api/health` (unauthenticated) | Observability section of the platform guide |
| Object storage | None — `storage_buckets` is empty; no NFS needed | `storage_buckets` output |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager under
service-scoped names (`secret-<prefix>-<app>-secret-key-base`,
`secret-<prefix>-<app>-totp-vault-key`). They are never set in plain text and
**must never be changed after the first deployment**:

- **`SECRET_KEY_BASE`** — a 64-character random string used by Phoenix (Plausible's
  web framework) to sign and encrypt sessions and cookies. Rotating it invalidates
  every active session, **logging every user out at once**.
- **`TOTP_VAULT_KEY`** — exactly 32 random bytes, base64-encoded. Encrypts users'
  2FA TOTP secrets at rest. Rotating it **breaks all enrolled 2FA devices** —
  affected users can no longer complete two-factor login.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~plausible"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). The **ClickHouse password** secret is owned by
[ClickHouse_GKE](ClickHouse_GKE.md): `Plausible_GKE` passes its secret ID
(`clickhouse_password_secret`), the foundation grants Plausible's workload service
account `secretAccessor` on it, and it is injected as `CLICKHOUSE_PASSWORD`. See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Plausible requires **PostgreSQL 15** for its configuration store (accounts, sites,
goals, settings). MySQL and other engines are not supported. Analytics events never
touch PostgreSQL — every pageview and custom event is written to **ClickHouse**,
which is mandatory and deployed separately.

On the first deployment a one-shot job (`db-init`) runs `create-db-and-user.sh`
using `postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and maps it for `psql` access,
2. Waits (up to 60 retries) for PostgreSQL to be reachable,
3. Creates the application role with the generated password, or updates the
   password if the role exists,
4. Creates the application database with that role as owner (skips if present),
5. Grants full privileges on the database,
6. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully.

The job is safe to re-run. Plausible's own schema migrations — for **both**
PostgreSQL and ClickHouse — run at container startup (see below), not in this job.
Inspect the config database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Container image and entrypoint

The custom image is a thin wrapper over `ghcr.io/plausible/community-edition:<tag>`:

- **Version pinning.** CE publishes **no `latest` tag** — only version tags like
  `v3.2.1`. The Dockerfile therefore takes an app-specific `PLAUSIBLE_VERSION` build
  ARG, deliberately **not** the generic `APP_VERSION`: the foundation injects
  `APP_VERSION = application_version` into `build_args` and wins that merge, which
  would resolve to the non-existent `latest` tag. When `application_version = "latest"`
  (the platform default), `Plausible_Common` pins `PLAUSIBLE_VERSION = v3.2.1`.

- **`plausible-entrypoint.sh`** runs before the Elixir server starts. It is **pure
  POSIX `sh`** — the CE image ships no bash, node, or python — so credential
  URL-encoding uses a pure-shell percent-encoder (RFC 3986 unreserved characters
  pass through). Its responsibilities:

  1. **Composes `DATABASE_URL`** from the platform-injected `DB_*` vars as
     `postgresql://<user>:<encoded-pass>@127.0.0.1:5432/<db>`. It always connects
     over **TCP through the Cloud SQL Auth Proxy sidecar** — socket-path hosts
     (`/cloudsql/...`) are coerced to `127.0.0.1` because `postgresql://` URLs
     cannot carry socket paths.
  2. **Composes `CLICKHOUSE_DATABASE_URL`** from `PLATFORM_CLICKHOUSE_URL`,
     `PLATFORM_CLICKHOUSE_DB`, `PLATFORM_CLICKHOUSE_USER`, and the injected
     `CLICKHOUSE_PASSWORD` secret (URL-encoded). If `PLATFORM_CLICKHOUSE_URL` is
     empty it **exits 1** with a clear error: deploy ClickHouse_GKE first and set
     `clickhouse_url`.
  3. **Defaults `BASE_URL`** to the platform-predicted service URL
     (`GKE_SERVICE_URL`, falling back to `CLOUDRUN_SERVICE_URL`) when unset —
     `BASE_URL` drives the tracking-script snippet and links in emails.
  4. **Bootstraps then runs** via CE's own entrypoint: `/entrypoint.sh db createdb`
     (creates the ClickHouse events database if missing), `/entrypoint.sh db migrate`
     (PostgreSQL + ClickHouse migrations, advisory-locked so concurrent replicas
     don't race), then `exec /entrypoint.sh run`.

Because the entrypoint is baked into the custom image, editing it requires a
rebuild + redeploy; the `db-init` job script is mounted at apply time and needs no
rebuild.

---

## 5. Core application settings

`Plausible_Common` establishes the baseline environment so the application comes up
correctly on first boot:

- **Port** — `HTTP_PORT = "8000"`; the container port is 8000.
- **Resources** — `cpu_limit = "1000m"`, `memory_limit = "1Gi"`. 1Gi is a reliable
  floor: the Elixir/BEAM runtime plus Plausible's in-process Oban job queue need the
  headroom.
- **Scaling** — `min_instance_count = 1`, `max_instance_count = 10`. Plausible is
  stateless at the pod level (all state in Cloud SQL + ClickHouse), so it scales
  horizontally.
- **Cloud SQL** — `enable_cloudsql_volume = true`; the entrypoint uses the Auth
  Proxy's TCP listener rather than the Unix socket.
- **Registration** — open by default. Create the first account at
  `<service URL>/register`, then set `DISABLE_REGISTRATION = "true"` (or
  `"invite_only"`) via `environment_variables` to stop further sign-ups.

---

## 6. Health probe behaviour

The default probes target `GET /api/health` — Plausible's public health endpoint,
which responds **without authentication**, so probes never see a 401/403 (the
classic authenticated-health-page trap):

- **Startup probe** — 30s initial delay, 10s period, `failure_threshold = 30`
  (up to ~5 minutes of headroom for first-boot PostgreSQL + ClickHouse migrations).
- **Liveness probe** — 30s period, `failure_threshold = 3`.

---

## 7. Outputs

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full application configuration (image, build config, env vars, DB settings, probes, `db-init` job) consumed by the Foundation Module. |
| `secret_ids` | `map(string)` | `{ SECRET_KEY_BASE = <secret_id>, TOTP_VAULT_KEY = <secret_id> }`. |
| `secret_values` | `object` | Sensitive plaintext values for direct Kubernetes Secret injection. |
| `storage_buckets` | `list` | Empty — Plausible needs no file storage. |
| `path` | `string` | Module directory path, used to resolve `scripts_dir`. |

---

For the Plausible-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guide:
**[Plausible_GKE](Plausible_GKE.md)**. The mandatory event store is documented in
**[ClickHouse_GKE](ClickHouse_GKE.md)**.
