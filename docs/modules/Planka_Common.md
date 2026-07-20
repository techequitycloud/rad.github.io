---
title: "Planka Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Planka module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Planka Common — Shared Application Configuration

`Planka_Common` is the **shared application layer** for Planka. It is not
deployed on its own; instead it supplies the Planka-specific configuration
that both [Planka_GKE](Planka_GKE.md) and [Planka_CloudRun](Planka_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI inputs
of its own — but understanding what it provides explains the defaults you see
in the platform docs.

For the infrastructure that actually provisions and runs Planka, see the
platform guides ([Planka_GKE](Planka_GKE.md), [Planka_CloudRun](Planka_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Planka is an open-source, self-hosted **kanban board application** —
Trello-like boards, lists, cards, due dates, labels, and attachments for team
and personal project management. It is not an identity provider or
authentication product.

---

## 1. What this layer provides

| Area | Provided by Planka_Common | Where it surfaces |
|---|---|---|
| Container image | Thin wrapper built `FROM ghcr.io/plankanban/planka:<version>` (official image) via Cloud Build; mirrored into Artifact Registry | `container_image` output of the platform deployment |
| Cloud entrypoint | `entrypoint.sh` composes `DATABASE_URL` from the injected `DB_*` vars and derives `BASE_URL` from the service URL before handing off to the image's own `start.sh` | Runtime behaviour on both platforms |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database and role | `initialization_jobs` output |
| Application secrets | **Two real secrets** — `SECRET_KEY` (session/token signing) and `DEFAULT_ADMIN_PASSWORD` (seeds the initial admin account) | `secret_ids` output |
| Object storage | Declares one **Cloud Storage** bucket (`storage`) for attachments/avatars/backgrounds | `storage_buckets` output |
| Health checks | Supplies the default startup/liveness probes targeting `/` — Planka's real, unauthenticated healthcheck target | §Observability in the platform guides |

---

## 2. Application secrets — real and functional

Unlike the mechanism found in some apps in this catalogue that turns out to be
a dead no-op (see `Mealie_Common`'s `DEFAULT_PASSWORD` history), both of
Planka's secrets are confirmed live against Planka's actual source:

- **`SECRET_KEY`** — a 64-character random value. Required at boot for
  session/token signing (`server/.env.sample`). Without it, Planka does not
  start.
- **`DEFAULT_ADMIN_PASSWORD`** — a 24-character random value. Genuinely seeds
  the initial admin account on first (empty-database) boot
  (`server/db/seeds/default.js`), paired with the plain-text
  `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_NAME` / `DEFAULT_ADMIN_USERNAME`
  environment variables (defaults: `admin@example.com` / `Admin` / `admin`).

`Planka_Common` creates both `google_secret_manager_secret` resources itself
(along with `random_password` generators, a `time_sleep` propagation delay,
and orphaned-secret cleanup) — unlike most Common modules in this catalogue,
which only assemble a `config` object and let the Foundation create secrets.

**Planka has no forced password-reset prompt on first login.** Operators must
log in and change the seeded admin password promptly via Planka's own UI —
treat the credential as sensitive from the moment the database initializes.
Retrieve it with:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~planka"
gcloud secrets versions access latest --secret=<default_admin_password_secret> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation.
See [App_Common](App_Common.md) for the shared secret and Workload Identity
model used elsewhere in the catalogue.

---

## 3. Database engine and bootstrap

Planka requires **PostgreSQL**; the engine is fixed to `POSTGRES_15` — Knex
(Planka's query builder) has no other supported backend. On first deployment
a one-shot job (`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Resolves the target host from `DB_HOST` (falling back to `DB_IP`, then
   `127.0.0.1`) and waits for PostgreSQL to accept connections,
2. Creates (or updates the password of) the application role — **no
   `CREATEROLE`/`CREATEDB` privilege is needed**: Planka's own "roles" (admin,
   member, project member, etc.) are app-level RBAC rows in its own tables,
   not Postgres roles,
3. Creates the application database if it does not exist,
4. Grants full privileges on the database and transfers `public` schema
   ownership to the application role (Postgres 15 no longer grants `CREATE`
   on `public` by default),
5. Signals the Cloud SQL Auth Proxy sidecar to shut down (`/quitquitquit`) so
   the GKE Job pod can complete.

Planka then applies its own Knex migrations and seed **on every boot** via the
official image's own `start.sh` → `node db/init.js` — idempotent, so the
platform runs no separate migration job. The `db-init` job is safe to re-run.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. `DATABASE_URL` — two independent connection paths, each needing SSL configured differently

Planka reads one environment variable, `DATABASE_URL` — a URL-authority DSN
(`postgresql://user:pass@host:port/db`). But Planka opens that connection
from **two independent code paths**, each handling SSL a different way.
Tracing this dependency chain in Planka's actual source — not just its
`.env.sample` — was what it took to get the connection working, after two
earlier live deploy attempts failed:

1. **The migration CLI** (`server/db/knexfile.js`, invoked via
   `node db/init.js` on every boot) explicitly builds `ssl: buildSSLConfig()`,
   which returns `{ rejectUnauthorized: false }` only when the env var
   `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` is the exact string `"false"`.
2. **The running server's Sails ORM** (`server/config/datastores.js`, via
   `sails-postgresql` → `machinepack-postgresql`'s `createManager()`) passes
   `url: DATABASE_URL` with no other config. `machinepack-postgresql` parses
   that URL using Node's **legacy** `url.parse()`, which extracts only
   host/port/user/password/database and **silently drops every query
   parameter**, including any `?sslmode=...`. So a URL-embedded sslmode does
   nothing for this path — it's discarded before `pg.Pool` is ever
   constructed. With no explicit `ssl` key reaching `pg.Pool`, raw
   `node-postgres` falls back to reading the **`PGSSLMODE` environment
   variable** itself (`readSSLConfigFromEnvironment` in `pg`'s
   `connection-parameters.js`): `disable` → no SSL; `prefer`/`require`/
   `verify-ca`/`verify-full` → `ssl: true` (encrypt **with** default Node TLS
   certificate verification — not "encrypt only", unlike classic libpq
   semantics); only `no-verify` → `{ rejectUnauthorized: false }`.

Cloud SQL presents a per-instance self-signed certificate that isn't in
Node's default CA bundle, so anything other than `PGSSLMODE=no-verify` fails
at boot with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, and Sails' `orm` hook never
loads (`Failed to lift app: getConnection failed`) — the container never
becomes healthy and the startup probe times out.

**The fix**, implemented in `entrypoint.sh`: for the encrypted-connection
cases (Cloud Run's Cloud SQL socket path falling back to private-IP TCP, and
any other direct private-IP TCP connection), set **both**
`PGSSLMODE=no-verify` (fixes the Sails runtime — the path that actually
matters for the live app) **and**
`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` (fixes the separate
migration CLI path). For the GKE loopback case (`DB_HOST=127.0.0.1`, the
cloud-sql-proxy sidecar terminating TLS itself), **neither** var is set — the
proxy already serves plaintext locally, so no SSL config is needed at all.

Because the database password is only available as a runtime Secret Manager
value (not something that can be interpolated into a URL at plan time), the
cloud entrypoint (`entrypoint.sh`) composes `DATABASE_URL` at container
startup, branching on the resolved `DB_HOST`:

| `DB_HOST` form | Platform | Connection used | SSL env vars set |
|---|---|---|---|
| `/…` (Unix socket directory) | Cloud Run, `enable_cloudsql_volume=true` | The socket path is unusable by either connection path's URL parsing; falls back to the injected private IP (`DB_IP`) over TCP | `PGSSLMODE=no-verify`, `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` |
| `127.0.0.1` / `localhost` | GKE (Cloud SQL Auth Proxy sidecar loopback) | Plain TCP | Neither var set — the proxy already terminates TLS to Cloud SQL |
| a private IP | Either | Direct TCP | Same as the socket case: `PGSSLMODE=no-verify`, `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` |

**Do not append `?sslmode=...` (or any query parameter) to `DATABASE_URL`
directly.** It is ignored for two different reasons depending on which code
path handles the connection, so this is not one uniform "query params are
ignored" behaviour: the **Sails runtime** ignores it because
`machinepack-postgresql`'s legacy `url.parse()` drops all query parameters
before `pg.Pool` is constructed; the **migration CLI** ignores it because
Knex itself does not parse query parameters from its connection string at
all (a separate, unrelated, Knex-documented behaviour). Two different
libraries, two different reasons — same practical outcome: only the
`PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` env vars actually
control TLS behaviour. The entrypoint prints a `[cloud-entrypoint]` line
reporting which branch it took — useful when diagnosing connection issues.

No URL-encoding concerns are unique to Planka beyond the standard rule for any
URL-authority DSN: the entrypoint URL-encodes the database user and password
in pure POSIX shell (the official image is Node/Alpine with `/bin/sh` but no
`python3`).

---

## 5. Container image and entrypoint

The custom image is a **thin wrapper built `FROM
ghcr.io/plankanban/planka:<version>`** (the official maintainer image — not
the community `linuxserver/planka` image) with a cloud entrypoint
(`entrypoint.sh`) layered on top. The base-image tag is driven by an
app-specific `PLANKA_VERSION` build ARG — **not** the generic `APP_VERSION`,
which the foundation injects into `build_args` and would otherwise clobber the
`FROM` tag. The image is built via Cloud Build and mirrored into Artifact
Registry (`enable_image_mirroring = true`).

The entrypoint runs before Planka starts and:

- **Composes `DATABASE_URL`** as described in §4.
- **Derives `BASE_URL`** from the injected `CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL`. Planka builds all absolute URLs — attachment links, email
  notifications, and the OIDC redirect URI if optional SSO is configured —
  from `BASE_URL`, so it must match the browser-facing host. Operators can
  override `BASE_URL` for a custom domain.
- **Sets `TRUST_PROXY = "true"`** (Planka's real env var name — not
  `TRUST_PROXY_HEADER`, which is a different app's convention) so Planka
  honours the `X-Forwarded-*` headers behind the Cloud Run / GKE HTTPS front
  end.
- **Does not set `PORT`.** Cloud Run reserves the `PORT` env var (it
  auto-injects `PORT=1337`) and rejects any user-provided value; Planka
  defaults to 1337, matching `container_port` on both platforms.
- **Hands off** to the image's own boot command (`./start.sh`, which runs
  `node db/init.js` for migrations/seed, then starts the server).

The wrapper is a POSIX-`sh` script (the official image is Node/Alpine with no
`python3`), so URL-encoding of the DB credentials is done in pure shell.

---

## 6. Health probe behaviour

`Planka_Common`'s own internal default for `startup_probe`/`liveness_probe`
targets the **root path `/`**, matching Planka's real, unauthenticated
healthcheck target — the official image ships `server/healthcheck.js`, which
performs a plain HTTP GET to `localhost:1337` with **no path** and checks for
HTTP 200:

- **Startup probe** — HTTP `GET /`, 60-second initial delay, 15-second
  period, 30-failure threshold (a wide first-boot window).
- **Liveness probe** — HTTP `GET /`, 60-second initial delay, 30-second
  period, 3-failure threshold.

**Note.** The Application Modules (`Planka_CloudRun`/`Planka_GKE`) declare
their *own* `startup_probe`/`liveness_probe` variables and forward them into
this module's identically-named inputs — which override the default above.
Those Application Module variables now correctly default to `path = "/"` as
well (this mismatch, inherited from the Logto clone source this module set
was scaffolded from, has been fixed), so both layers agree on Planka's real,
unauthenticated health target.

---

## 7. Object storage

A single **Cloud Storage** bucket (suffix `storage`, `STANDARD` class, public
access prevention `enforced`, no object versioning) is declared here and
provisioned by the foundation, for item attachments, avatars, and card
background images — but it is **not** automatically mounted into the
container. Operators who need uploaded attachments to persist across
revisions/restarts must add a `gcs_volumes` entry (at the Application Module
level) mounted at Planka's `/app/data` path. Board/card/list *data* is
unaffected either way — it's stored in PostgreSQL. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
```

---

For the Planka-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Planka_GKE](Planka_GKE.md)** and
**[Planka_CloudRun](Planka_CloudRun.md)**.
