---
title: "Flarum Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Flarum module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Flarum Common — Shared Application Configuration

`Flarum_Common` is the **shared application layer** for Flarum. It is not deployed on
its own; instead it supplies the Flarum-specific configuration that both
[Flarum_GKE](Flarum_GKE.md) and [Flarum_CloudRun](Flarum_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Flarum, see the platform
guides ([Flarum_GKE](Flarum_GKE.md), [Flarum_CloudRun](Flarum_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Flarum_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the `FLARUM_ADMIN_PASS` first-run administrator password (24-char) and stores it in **Secret Manager** | Injected automatically as the `FLARUM_ADMIN_PASS` secret env; retrieve via Secret Manager (see below) |
| Container image | Thin wrapper over the official `mondedie/flarum` image (nginx + php-fpm), pinned through the app-specific `FLARUM_VERSION` build ARG and built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `flarum-assets` bucket | `storage_buckets` output |
| Core settings | Sets the baseline Flarum environment consumed by the mondedie installer: DB connection, table prefix, admin identity, forum URL | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe and HTTP liveness probe targeting `/` | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

One secret is generated automatically and stored in Secret Manager:

- **`FLARUM_ADMIN_PASS`** — a 24-character random password (no special characters, so it
  satisfies the installer's ≥8-character rule without escaping issues). The
  `mondedie/flarum` installer seeds the initial administrator account from
  `FLARUM_ADMIN_USER` / `FLARUM_ADMIN_PASS` / `FLARUM_ADMIN_MAIL` **on first boot only**.
  The secret is named `secret-<resource_prefix>-flarum-admin-pass` and exposed through
  `secret_ids` so the foundation injects it as the `FLARUM_ADMIN_PASS` secret env on the
  service container.

The password is generated once and never rotated by the module — the installer runs a
single time, so changing this secret after the forum is installed does **not** change the
admin login (change it from the Flarum admin UI instead).

Retrieve the admin password after deployment:

```bash
# List the admin-password secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~flarum AND name~admin-pass"

# Read the current value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password and the Cloud SQL root password are generated and managed
separately by the foundation; the DB password's secret name is reported in the platform
deployment outputs (`database_password_secret`). See [App_Common](App_Common.md) for the
shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Flarum requires **MySQL**; `Flarum_Common` fixes the engine at **Cloud SQL for MySQL 8.0**
(`MYSQL_8_0`). On the first deployment a one-shot job (`db-init`) runs using
`mysql:8.0-debian` and idempotently:

1. Locates the Cloud SQL Auth Proxy Unix socket under `/cloudsql` (waiting up to 30 s),
   or falls back to the instance private IP over TCP (`DB_IP`) when no socket appears,
2. Waits for MySQL port `3306` to be reachable when connecting over TCP,
3. Creates (or updates) the application user with the generated password
   (`CREATE USER IF NOT EXISTS … ; ALTER USER …`),
4. Creates the application database (`CREATE DATABASE IF NOT EXISTS`),
5. Grants all privileges on the database to the application user,
6. Verifies the app user can connect — this also warms the MySQL 8
   `caching_sha2_password` server-side auth cache so later PHP/PDO connections take the
   fast path (Cloud SQL MySQL 8 requires `--get-server-public-key` for RSA key exchange
   on plain TCP, which the script detects at runtime),
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully (POST
   `quitquitquit`, then SIGKILL) so the Job exits cleanly under `restartPolicy: OnFailure`.

There is **no separate migration job** — the `mondedie/flarum` image runs the Flarum
installer automatically on first container start, creating the schema (with the `flarum_`
table prefix) once `db-init` has provisioned the database and user. The job is safe to
re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image

The custom image is a **thin wrapper** built `FROM mondedie/flarum:${FLARUM_VERSION}`:

- **No entrypoint override.** The mondedie image's own s6-overlay entrypoint runs the
  Flarum first-boot installer, reading `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASS`, `DB_PREF`, `FORUM_URL` and the `FLARUM_ADMIN_*` variables. The Dockerfile
  only re-tags through a controlled build ARG and `EXPOSE 8888` — the installer is left
  intact.
- **App-specific version ARG.** `mondedie/flarum` publishes a moving `latest`/`stable`
  tag plus a few old version tags. Because the foundation injects
  `APP_VERSION = application_version` and *wins* the `build_args` merge, the base tag is
  pinned instead through the app-specific `FLARUM_VERSION` ARG (which the foundation does
  **not** inject). `application_version = "latest"` maps to the image's
  production-recommended `stable` tag; any other value is used verbatim.
- **Built via Cloud Build, base mirrored into Artifact Registry.** `image_source = "custom"`
  and `enable_image_mirroring = true`, so the Docker Hub base is mirrored into Artifact
  Registry for Cloud Build to pull.

Flarum serves **nginx + php-fpm on port 8888** (`container_port = 8888`).

---

## 5. Core application settings

`Flarum_Common` establishes the baseline environment the mondedie installer consumes so
the forum comes up correctly on first boot:

- **Database connection** — `DB_PORT = "3306"`, `DB_PREF = "flarum_"` (the Flarum table
  prefix). To hand the image the tenant-scoped credentials verbatim, the Application
  Modules set `db_user_env_var_name = "DB_USER"`, `db_password_env_var_name = "DB_PASS"`
  and `db_name_env_var_name = "DB_NAME"` in `main.tf`, so the foundation populates exactly
  the env names the image reads. `DB_HOST` is injected by the foundation — the Cloud SQL
  private IP on Cloud Run, or `127.0.0.1` for the GKE Auth Proxy sidecar.
- **Admin identity** — `FLARUM_ADMIN_USER` (default `admin`), `FLARUM_ADMIN_MAIL`
  (default `admin@techequity.cloud`), and `FLARUM_ADMIN_PASS` (from Secret Manager).
- **Forum URL** — `FORUM_URL` is set to the public service URL. On Cloud Run the variant
  passes the deterministic predicted `run.app` URL; on GKE it is left unset at plan time
  and must be set to the external LoadBalancer/custom-domain URL after the IP is known.
- **Debug** — `DEBUG = "false"`.
- **Redis (optional)** — off by default. When enabled, `REDIS_HOST`/`REDIS_PORT` are
  injected (the NFS server VM IP is used when `redis_host` is empty and NFS is enabled).

---

## 6. Health probe behaviour

Flarum serves its public forum home page at `/` (HTTP 200) once installed — an
unauthenticated endpoint suitable for probes.

- **Startup probe** — **TCP** on the container port with a 30-second initial delay and a
  20-failure × 15-second window (~5 minutes), so a woken/first-boot instance passes as
  soon as nginx binds its port, independent of the installer finishing.
- **Liveness probe** — **HTTP** `GET /` with a 300-second initial delay (generous, to
  cover the first-boot install) and a 60-second period.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (`flarum-assets`) is declared here and provisioned by
the foundation, which also grants the workload service account access. Note that Flarum's
avatars, uploads, and assets directory is served from **NFS** (mounted at
`/flarum/app/public/assets` on both platforms — see the platform guides), so the bucket is
available for backups/exports rather than the live assets mount. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Flarum-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guides:
**[Flarum_GKE](Flarum_GKE.md)** and **[Flarum_CloudRun](Flarum_CloudRun.md)**.
