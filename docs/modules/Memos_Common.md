---
title: "Memos Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Memos module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Memos Common — Shared Application Configuration

`Memos_Common` is the **shared application layer** for Memos. It is not deployed
on its own; instead it supplies the Memos-specific configuration that both
[Memos_GKE](Memos_GKE.md) and [Memos_CloudRun](Memos_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Memos, see the platform
guides ([Memos_GKE](Memos_GKE.md), [Memos_CloudRun](Memos_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Memos_Common | Where it surfaces |
|---|---|---|
| Application secrets | **None.** Memos has no admin-bootstrap env var, no encryption key, no JWT secret — the first web-UI account becomes host/admin | n/a |
| Container image | Wraps the official `ghcr.io/usememos/memos` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | None — no GCS bucket is declared for attachments | `storage_buckets` output (empty) |
| Core settings | Computes `MEMOS_DSN`/`MEMOS_DRIVER` at container start from platform `DB_*` vars; sets port 5230, prod mode | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` | §Observability in the platform guides |

---

## 2. No application secrets

Unlike most modules in this catalogue, `Memos_Common` generates **zero**
Secret-Manager-backed application secrets. There is no equivalent to an
encryption key, a JWT signing secret, or an admin-bootstrap password:

- **No admin-bootstrap credential.** Memos has no `DEFAULTUSER`-style env var. The
  **first account created through the web UI's sign-up form automatically becomes
  the host/admin** — there is nothing to fetch from Secret Manager before first
  login.
- **Session signing is self-managed.** Memos generates its own internal
  session-signing material and persists it in its own PostgreSQL database on first
  boot, not in Secret Manager.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Memos requires **PostgreSQL** in this module's wiring; the engine is fixed. On the
first deployment a one-shot job (`db-init`) runs using `postgres:15-alpine` and
idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and maps it for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with the generated password,
4. Creates (or reconfigures) the application database with that role as owner,
5. Grants full privileges on the database,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

Memos then applies its **own internal schema** via GORM auto-migrate on every
application startup — no separate migration job runs at the platform layer.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `ghcr.io/usememos/memos:<version>` (Alpine-based, with a
real shell) with a thin `python3` package and a shell entrypoint
(`memos-entrypoint.sh`) that runs before the compiled binary starts:

- **Computes `MEMOS_DSN`.** Memos reads a single combined connection URL — unlike
  many Go/GORM apps in this catalogue that accept discrete `host=`/`user=`/`pass=`
  fields, Memos has no such split. The entrypoint builds the DSN from the
  platform's `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD`, branching by
  the shape of `DB_HOST`:
  - **Cloud Run** (`DB_HOST` is a `/cloudsql/...` socket directory): the libpq
    socket query-param form `postgres://user:pass@/db?host=<dir>&sslmode=disable`
    — a URL authority cannot contain the socket path's colons.
  - **GKE** (`DB_HOST` is `127.0.0.1`, the cloud-sql-proxy sidecar): plain
    loopback TCP, `sslmode=disable` (the proxy already terminates TLS).
  - **Direct private-IP TCP** (any other host): real TCP with `sslmode=require`
    — Cloud SQL rejects unencrypted private-IP connections.
- **URL-encodes the password.** Because the DSN is a URL, the password is passed
  through `python3 -c "import urllib.parse,os; print(urllib.parse.quote(...))"`
  before being embedded — a raw password containing `@`, `:`, `/`, or `%` would
  otherwise break URL parsing.
- **Sets `MEMOS_DRIVER=postgres`, `MEMOS_MODE=prod`, `MEMOS_PORT=5230`.**
- **Chains into the upstream image's own entrypoint** (`/usr/local/memos/entrypoint.sh`),
  which drops privileges to the `nonroot` user (uid 10001) before exec'ing the
  compiled `memos` binary — preserving the base image's security posture rather
  than replacing it outright.

---

## 5. Core application settings

`Memos_Common` establishes the baseline Memos environment so the application comes
up correctly on first boot:

- **Port** — `MEMOS_PORT = "5230"`, Memos's native default; no remapping.
- **Mode** — `MEMOS_MODE = "prod"`.
- **Driver** — `MEMOS_DRIVER = "postgres"`, fixed.

Unlike apps with a frontend URL or webhook callback concept, Memos needs no
platform-specific URL correction at runtime — it has no OAuth redirect or webhook
ingest path baked into this module's default configuration.

---

## 6. Health probe behaviour

The default probes target `/` — Memos's public login/landing page, reachable
without authentication. Memos does not document a dedicated `/health` or
`/healthz` endpoint, so probing the root avoids the auth-gated-endpoint pitfall
documented for other apps in this catalogue (an authenticated health path returns
403 to an unauthenticated probe, and the revision/pod never becomes Ready even
though the app booted fine).

- **Cloud Run** uses an HTTP probe targeting `/` with a 30-second initial delay
  and a generous failure threshold (30) to tolerate first-boot schema setup.
- **GKE** uses the same HTTP probe target and timing.

---

## 7. Object storage

No GCS bucket is declared by this layer. Memos's text notes persist fully in
PostgreSQL; the module does not wire attachment storage to Cloud Storage. See the
pitfalls table in the platform guides for the consequence of uploading binary
attachments without adding a `gcs_volumes` entry.

---

For the Memos-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform
guides: **[Memos_GKE](Memos_GKE.md)** and **[Memos_CloudRun](Memos_CloudRun.md)**.
