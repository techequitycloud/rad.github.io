---
title: "FreeScout Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the FreeScout module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# FreeScout Common — Shared Application Configuration

`FreeScout_Common` is the **shared application layer** for FreeScout. It is not
deployed on its own; instead it supplies the FreeScout-specific configuration that
both [FreeScout_GKE](FreeScout_GKE.md) and [FreeScout_CloudRun](FreeScout_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

FreeScout is a free, self-hosted **help desk and shared-mailbox** platform built on
Laravel (PHP). It turns one or more shared email inboxes into a collaborative ticket
queue with conversations, notes, tags, saved replies, a customer profile, a REST
API, and a module/plugin system.

For the infrastructure that actually provisions and runs FreeScout, see the platform
guides ([FreeScout_GKE](FreeScout_GKE.md), [FreeScout_CloudRun](FreeScout_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by FreeScout_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates the Laravel `APP_KEY` (`base64:` + 32 random bytes) and stores it in **Secret Manager** | Injected automatically as the `APP_KEY` container env; retrieve via Secret Manager (see below) |
| First-run admin password | Generates a 24-char alphanumeric `ADMIN_PASS` and stores it in **Secret Manager** | Injected as the `ADMIN_PASS` container env; seeds the first admin on first boot |
| Container image | Builds a **thin custom image** `FROM tiredofit/freescout` (base tag `php8.3-1.17.159` when `application_version = latest`) with a cloud entrypoint; built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares a **Cloud Storage** uploads bucket (`freescout-uploads`) | `storage_buckets` output |
| Core settings | Sets the baseline FreeScout environment: MySQL driver, DB port, admin seed identity, `APP_URL`/`SITE_URL`, PHP limits | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe and HTTP `GET /` liveness probe | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text and are named `secret-<resource-prefix>-<app>-app-key` and
`secret-<resource-prefix>-<app>-admin-password`:

- **`APP_KEY`** — the Laravel application key, stored as `base64:` followed by the
  base64 encoding of 32 random bytes (exactly what Laravel's AES-256-CBC cipher
  expects). FreeScout uses it to encrypt session/cookie data and any encrypted
  database columns (for example stored mailbox credentials and OAuth tokens).
  **Rotating it after first boot permanently invalidates all previously encrypted
  data** — treat it as immutable.
- **`ADMIN_PASS`** — a 24-character alphanumeric password, seeded into the first
  administrator account (`ADMIN_EMAIL`) by the container on first boot. Alphanumeric
  by design to avoid shell/URL quoting issues in the container init. After the first
  login you should change it in the FreeScout UI.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~admin-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

FreeScout requires **MySQL**; the engine is fixed to `MYSQL_8_0` and PostgreSQL or
other engines are not supported. On the first deployment a one-shot job (`db-init`)
runs using `mysql:8.0-debian` and idempotently:

1. Prefers the Cloud SQL Auth Proxy Unix socket under `/cloudsql` when mounted, and
   otherwise falls back to a TCP connection using the injected private IP (`DB_IP`),
2. Waits for MySQL on port 3306 to be reachable,
3. Creates (or updates) the application user with the generated password
   (`CREATE USER IF NOT EXISTS` / `ALTER USER`),
4. Creates the application database (`CREATE DATABASE IF NOT EXISTS`),
5. Grants all privileges on that database to the application user,
6. Verifies the application user can actually connect (catching password/grant
   problems early and warming the MySQL 8 `caching_sha2_password` auth cache),
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully (via
   `quitquitquit`) so the Job exits cleanly.

There is **no separate migration job**: the tiredofit FreeScout image runs
`php artisan migrate --force` automatically on container start, so the schema is
created and upgraded on first boot once `db-init` has provisioned the database and
user. The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM tiredofit/freescout:<tag>` (the tiredofit
image bundles nginx + php-fpm and an s6 init that listens on **port 80**). The base
tag is controlled by an app-specific `FREESCOUT_VERSION` build ARG — deliberately
**not** the generic `APP_VERSION`, because the Foundation injects `APP_VERSION` and
would clobber it to `latest`; `FreeScout_Common` maps `application_version = "latest"`
to the known-good pinned tag `php8.3-1.17.159` before passing it as `FREESCOUT_VERSION`.

The wrapper drops in a cloud entrypoint (`entrypoint.sh`) that runs before the
upstream `/init`:

- **Aliases the Foundation's DB env vars onto the tiredofit names.** The Application
  module sets `db_user_env_var_name = DB_USERNAME`, `db_password_env_var_name =
  DB_PASSWORD`, and `db_name_env_var_name = DB_DATABASE` (the Laravel-native names),
  so the Foundation injects `DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE` with the correct
  tenant-scoped values. The entrypoint maps those onto the `DB_USER`/`DB_PASS`/`DB_NAME`
  that the upstream init reads, and sets `DB_HOST`/`DB_PORT`.
- **Resolves a real TCP host on Cloud Run.** If `DB_HOST` arrives as a Cloud SQL
  socket directory (`/cloudsql/<proj:region:inst>`), it falls back to the injected
  private IP `DB_IP`, because FreeScout's PDO MySQL connection needs a TCP host. On
  GKE `DB_HOST` is already `127.0.0.1` (the Auth Proxy sidecar).
- **Sets the public URL.** It exports `APP_URL`/`SITE_URL` from `CLOUDRUN_SERVICE_URL`
  (Cloud Run) or `GKE_SERVICE_URL` (GKE) unless already set, so FreeScout builds
  correct absolute links and the login/dashboard renders on `GET /`.
- **Hands off to the upstream `/init`**, which runs migrations and seeds the admin.

The image is built via Cloud Build on first deploy (and whenever the build
content-hash changes). Edits to `entrypoint.sh` or the `Dockerfile` are baked into
the image and require a rebuild; `db-init.sh` is mounted into the job and takes effect
on the next apply with no rebuild.

---

## 5. Core application settings

`FreeScout_Common` establishes the baseline FreeScout environment so the application
comes up correctly on first boot:

- **Database driver** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"`.
- **First-run admin** — `ADMIN_EMAIL` (default `admin@techequity.cloud`, the RAD
  convention), `ADMIN_FIRST_NAME = "RAD"`, `ADMIN_LAST_NAME = "Admin"`, and the
  `ADMIN_PASS` secret. The upstream init seeds this account on first boot.
- **Public URL** — `APP_URL` / `SITE_URL` are set to the predicted service URL when
  known; the entrypoint corrects them at runtime from the actual service URL.
- **Logging** — `CONTAINER_LOG_LEVEL = "NOTICE"`.
- **PHP limits** — `php_memory_limit` (`512M`), `upload_max_filesize` (`64M`), and
  `post_max_size` (`64M`) tune PHP for attachment uploads.
- **Redis (optional)** — off by default. When enabled, `REDIS_HOST`/`REDIS_PORT` are
  injected (falling back to the NFS server VM IP when `redis_host` is empty).

Platform-specific adjustments handled here:

- **Cloud Run** connects to MySQL over the private IP (TCP); `enable_cloudsql_volume`
  defaults to `false` on the Cloud Run variant.
- **GKE** overrides `DB_HOST = "127.0.0.1"` because the Cloud SQL Auth Proxy runs as a
  sidecar bound to loopback, and keeps `enable_cloudsql_volume = true`.

---

## 6. Health probe behaviour

FreeScout serves its login/dashboard on `GET /` (HTTP 200) once booted; there is **no
dedicated JSON health endpoint**. The default probes reflect this:

- **Startup probe** — TCP on the container port with a 30-second initial delay and a
  generous 20-failure window (period 15 s), accommodating first-boot migrations that
  the upstream init runs before the web server is fully ready.
- **Liveness probe** — HTTP `GET /` with a 300-second initial delay, 60-second timeout,
  and 3-failure threshold, so the container is not restarted while it is still
  migrating on first boot.

---

## 7. Object storage

A dedicated **Cloud Storage** uploads bucket (declared with `name_suffix =
"freescout-uploads"`) is declared here and provisioned by the foundation, which also
grants the workload service account access. Note that FreeScout's primary durable
storage for attachments and runtime files is the **NFS volume** mounted at
`/var/lib/freescout` (enabled by default). List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the FreeScout-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[FreeScout_GKE](FreeScout_GKE.md)** and **[FreeScout_CloudRun](FreeScout_CloudRun.md)**.
