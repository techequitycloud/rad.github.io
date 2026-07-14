---
title: "Castopod Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Castopod module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Castopod Common — Shared Application Configuration

`Castopod_Common` is the **shared application layer** for Castopod. It is not
deployed on its own; instead it supplies the Castopod-specific configuration that
both [Castopod_GKE](Castopod_GKE.md) and [Castopod_CloudRun](Castopod_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Castopod, see the platform
guides ([Castopod_GKE](Castopod_GKE.md), [Castopod_CloudRun](Castopod_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Castopod_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates `CP_ANALYTICS_SALT` (32-char) and stores it in **Secret Manager** | Injected automatically as a container secret env var; retrieve via Secret Manager (see below) |
| Container image | Thin custom build **FROM `castopod/castopod`** that grafts a platform wrapper entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`database_type = "MYSQL_8_0"`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `media` bucket for podcast media | `storage_buckets` output |
| Core settings | Sets Castopod's baseline environment: cache handler, DB port/prefix, base URL | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe and HTTP `/` liveness probe | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text and **must never be changed after the first deployment**:

- **`CP_ANALYTICS_SALT`** — a 32-character random string used to anonymise Castopod's
  built-in podcast analytics (listener IPs and identifiers are hashed with this salt).
  It must stay constant across restarts and replicas so that the hashed identifiers
  match over time — that is why it is generated once and stored in Secret Manager
  rather than minted at runtime. Rotating it does not corrupt existing rows but breaks
  the continuity of analytics de-duplication for previously recorded listeners.

The secret is named `secret-<resource-prefix>-<application_name>-analytics-salt`.
Retrieve it after deployment:

```bash
# List the analytics-salt secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Castopod requires **MySQL**; the engine is fixed to `MYSQL_8_0` and PostgreSQL or
other engines are not supported. On the first deployment a one-shot job (`db-init`)
runs using `mysql:8.0-debian` and idempotently:

1. Resolves the Cloud SQL connection — it prefers the Cloud SQL Auth Proxy Unix
   socket under `/cloudsql` when mounted, otherwise falls back to a private-IP TCP
   connection (`DB_IP`),
2. Waits for MySQL port 3306 to be reachable (TCP path),
3. Creates (or updates) the application user with the generated password
   (`CREATE USER IF NOT EXISTS … ALTER USER …`),
4. Creates the application database (`CREATE DATABASE IF NOT EXISTS`),
5. Grants all privileges on that database to the application user,
6. Verifies the app user can actually connect — this also warms the
   `caching_sha2_password` server-side auth cache so subsequent PHP connections use
   the fast auth path,
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully (via the
   `quitquitquit` admin endpoint).

The job is marked `execute_on_apply = true` and is safe to re-run. **There is no
separate migration job** — the `castopod/castopod` image runs the CodeIgniter 4
schema migrations automatically on container start, so the schema is created on first
boot once `db-init` has provisioned the database and user.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a **thin build FROM `castopod/castopod:<version>`** (the campaign
default `latest` is pinned to the current stable release, `1.15.5`, for reproducible
builds). The base tag is fed via the app-specific `CASTOPOD_VERSION` build ARG — **not**
the generic `APP_VERSION`, which the foundation would otherwise clobber to `latest` and
win the `build_args` merge. The image grafts a small platform wrapper entrypoint
(`entrypoint.sh`) that runs before delegating to the upstream FrankenPHP/Caddy
entrypoint (which runs migrations and serves HTTP on `:8080`):

- **Materialises the CI4-native database config into Castopod's `.env` file.** Castopod
  is CodeIgniter 4 and reads its default connection from the framework-native,
  **dot-notated** keys `database.default.hostname|database|username|password|port|
  DBDriver|DBPrefix`. Cloud Run/GKE env var names cannot contain dots, so the platform
  cannot inject these as container env vars — the entrypoint therefore writes them into
  `.env` (loaded by CI4 at bootstrap) from the foundation-injected `DB_HOST`/`DB_IP`/
  `DB_NAME`/`DB_USER`/`DB_PASSWORD`. Without this, Castopod connects to `localhost` and
  every DB-backed route (including `/`) 500s.
- **Resolves a TCP database host.** CI4's `mysqli` driver needs a real TCP host, not a
  Cloud SQL socket directory. If `DB_HOST` is a socket path (starts with `/`) the
  entrypoint uses `DB_IP` (private-IP TCP, no SSL required for MySQL); on GKE `DB_HOST`
  is already `127.0.0.1` (the Auth Proxy sidecar) and is used directly.
- **Derives `CP_BASEURL`.** Castopod requires its public base URL. When not explicitly
  set, the entrypoint derives it from the foundation-injected `GKE_SERVICE_URL` or
  `CLOUDRUN_SERVICE_URL` and writes it as `app.baseURL` in `.env`.
- **Discovers and delegates to the upstream entrypoint**, exec'ing the FrankenPHP/Caddy
  server (`frankenphp run --config /etc/frankenphp/Caddyfile`).

The image also pre-creates `/var/www/castopod/public/media` so the media mount target
exists regardless of the base-image layout.

---

## 5. Core application settings

`Castopod_Common` establishes the baseline Castopod environment so the application
comes up correctly on first boot:

- **Cache handler** — `CP_CACHE_HANDLER = "file"` by default (filesystem cache). Redis
  can be enabled via the platform deployment settings, which injects `REDIS_HOST` /
  `REDIS_PORT`.
- **Database wiring** — `CP_DATABASE_PORT = "3306"` and `CP_DATABASE_PREFIX = "cp_"`
  (Castopod table prefix). The `database.default.*` keys are written into `.env` by the
  entrypoint as described above.
- **Base URL** — `CP_BASEURL` is set from the predicted service URL when available and
  corrected at runtime by the entrypoint.

---

## 6. Health probe behaviour

Castopod serves an unauthenticated homepage at `/` that returns HTTP 200 once the app
has booted and connected to MySQL, so the probes target it directly:

- **Startup probe** — **TCP** on the container port with a 30-second initial delay and
  a 20-retry window, giving first-boot CodeIgniter migrations ample time to complete.
- **Liveness probe** — **HTTP `GET /`** with a 300-second initial delay (5 minutes) and
  a 60-second period, matching Castopod's homepage returning 200 after boot.

---

## 7. Object storage and media persistence

A dedicated **Cloud Storage** bucket (suffix `media`) is declared here and provisioned
by the foundation, which also grants the workload service account access. Castopod
stores podcast episode audio, cover art, and other uploads under
`/var/www/castopod/public/media`; both platform variants additionally enable a shared
filesystem (**Cloud Filestore / NFS**, `enable_nfs = true` by default) so those uploads
survive container restarts and are shared across replicas. List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~media"
```

---

For the Castopod-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Castopod_GKE](Castopod_GKE.md)** and **[Castopod_CloudRun](Castopod_CloudRun.md)**.
