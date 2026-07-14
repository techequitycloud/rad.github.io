---
title: "Dolibarr Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Dolibarr module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Dolibarr Common — Shared Application Configuration

`Dolibarr_Common` is the **shared application layer** for Dolibarr. It is not
deployed on its own; instead it supplies the Dolibarr-specific configuration that
both [Dolibarr_GKE](Dolibarr_GKE.md) and [Dolibarr_CloudRun](Dolibarr_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Dolibarr, see the platform
guides ([Dolibarr_GKE](Dolibarr_GKE.md), [Dolibarr_CloudRun](Dolibarr_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Dolibarr_Common | Where it surfaces |
|---|---|---|
| Admin credentials | Generates the first-run admin password (`DOLI_ADMIN_PASSWORD`, 24 chars) and a per-instance salt (`DOLI_INSTANCE_UNIQUE_ID`, 16-byte hex) and stores both in **Secret Manager** | Injected as SERVICE-container secret env vars; retrieve via Secret Manager (see below) |
| Container image | Thin custom build of the official `dolibarr/dolibarr` (php:apache) image with a wrapper entrypoint; built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** documents bucket (`dolibarr-documents`) | `storage_buckets` output |
| Core settings | Sets the baseline Dolibarr environment: DB driver, auto-install, production mode, admin login, root URL | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe and HTTP liveness probe targeting `/` (the login page) | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are
never set in plain text:

- **`DOLI_ADMIN_PASSWORD`** — a 24-character password (specials disabled so it is
  copy/paste-safe for the operator login), stored as
  `secret-<prefix>-<app>-admin-password`. It is the password for the first-run
  administrator account whose username is `DOLI_ADMIN_LOGIN` (default `admin`).
  The Dolibarr installer consumes it on first boot when it creates the super-admin
  account; changing it in Secret Manager after the account exists does **not**
  retroactively change the account password (that must be done inside Dolibarr).
- **`DOLI_INSTANCE_UNIQUE_ID`** — a 16-byte hex string stored as
  `secret-<prefix>-<app>-instance-id`, used as a per-instance security salt (for
  example, for cron URLs and token signing). Keep it stable across the life of the
  deployment.

Both are injected directly as SERVICE-container secret environment variables of the
exact names above (via the module's `secret_ids` output); Dolibarr's `docker-run.sh`
reads them as-is. The database password is generated and managed separately by the
foundation; its secret name is reported in the platform deployment outputs
(`database_password_secret`).

Retrieve the secrets after deployment:

```bash
# List Dolibarr secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~instance-id"

# Read the generated admin password (use with the DOLI_ADMIN_LOGIN username):
gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Dolibarr runs on **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`); the engine is fixed by
this layer. On the first deployment a one-shot job (`db-init`) runs using
`mysql:8.0-debian` and idempotently:

1. Locates the Cloud SQL connection — a Unix socket under `/cloudsql` when the Auth
   Proxy volume/sidecar is mounted, otherwise TCP via the instance private IP
   (`DB_IP`),
2. Waits for MySQL to be reachable on port 3306,
3. Creates (or re-aligns) the application user with the generated password
   (`CREATE USER IF NOT EXISTS … ; ALTER USER …`),
4. Creates the application database (`CREATE DATABASE IF NOT EXISTS`),
5. Grants all privileges on that database to the application user,
6. Verifies the application user can connect (also warming the
   `caching_sha2_password` server-side cache), then signals the Cloud SQL Auth Proxy
   sidecar to shut down gracefully.

The job is safe to re-run (`execute_on_apply = true`, `max_retries = 3`). There is
**no separate migration job**: because `DOLI_INSTALL_AUTO = 1`, the Dolibarr image
runs its own installer on first container start, creating the schema inside the
(empty) database that `db-init` provisioned. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin build: `FROM dolibarr/dolibarr:<DOLIBARR_VERSION>` (the
official PHP/Apache image) plus a wrapper entrypoint
(`dolibarr-entrypoint.sh`) that runs before the base image's `docker-run.sh`.

- **Maps `DB_*` to `DOLI_DB_*`** — the platform injects the standard, tenant-scoped
  `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; Dolibarr instead reads
  `DOLI_DB_HOST`, `DOLI_DB_HOST_PORT`, `DOLI_DB_NAME`, `DOLI_DB_USER`,
  `DOLI_DB_PASSWORD`. The entrypoint aliases the injected values onto the
  `DOLI_DB_*` names at runtime.
- **Prefers the injected `DB_*` values over the image's bake-time defaults.** The
  official image bakes `DOLI_DB_HOST=mysql` / `DOLI_DB_NAME=dolidb`, so those are
  already non-empty at runtime. The entrypoint uses `${DB_HOST:-${DOLI_DB_HOST}}`
  precedence so the platform's real Cloud SQL host wins — otherwise Dolibarr would
  wait forever for a host named `mysql` and the startup probe would never pass.
- **Hands off to the base image** — `exec docker-run.sh "$@"` runs the Dolibarr
  auto-install/upgrade (`DOLI_INSTALL_AUTO = 1`) and then starts Apache
  (`apache2-foreground`) on port 80.

The base tag is controlled by an **app-specific** build ARG `DOLIBARR_VERSION` (not
the generic `APP_VERSION` the Foundation injects and would otherwise clobber);
`application_version = "latest"` is mapped to a known-good pinned tag (`23.0.3`) at
build time.

---

## 5. Core application settings

`Dolibarr_Common` establishes the baseline environment so the application installs
and comes up correctly on first boot:

- **`DOLI_DB_TYPE = "mysqli"`** — the MySQL driver Dolibarr uses.
- **`DOLI_INSTALL_AUTO = "1"`** — run the installer automatically on first start,
  creating the schema in the `db-init`-provisioned database.
- **`DOLI_INIT_DEMO = "0"`** — do not load demo data.
- **`DOLI_PROD = "1"`** — production mode (verbose errors off).
- **`DOLI_ADMIN_LOGIN`** — first-run super-admin username (default `admin`); the
  matching password is the generated `DOLI_ADMIN_PASSWORD` secret.
- **`DOLI_URL_ROOT`** — the public service URL, used to build absolute links and the
  login redirect. On Cloud Run the variant passes the predicted `run.app` URL; on
  GKE it is left unset until the external LoadBalancer address is known (set it via
  `environment_variables` afterwards).

Container defaults set here: `container_port = 80`, `database_type = MYSQL_8_0`,
`cloudsql_volume_mount_path = /cloudsql`, plus the resource limits and instance
counts forwarded from the variant.

---

## 6. Health probe behaviour

Dolibarr serves its login page at `/` (HTTP 200, no authentication) — there is no
dedicated `/health` endpoint, so `/` doubles as the health path.

- **Startup probe** — **TCP** on the container port (80) with a 30-second initial
  delay and a 20-retry window, so the probe only needs the Apache listener to bind,
  independent of the first-boot installer's progress.
- **Liveness probe** — **HTTP** `GET /` with a 300-second initial delay, restarting
  the container only if the login page stops responding. The generous initial delay
  accommodates the auto-install on first boot.

---

## 7. Object storage and file persistence

- A dedicated **Cloud Storage** bucket is declared here with the name suffix
  `dolibarr-documents` and provisioned by the foundation, which also grants the
  workload service account access.
- Dolibarr's uploaded documents, generated PDFs, and runtime data live under
  `/var/lib/dolibarr`; the platform variants back that path with **NFS (Cloud
  Filestore)** so the data survives container restarts and is shared across
  instances.

List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
```

---

For the Dolibarr-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Dolibarr_GKE](Dolibarr_GKE.md)** and **[Dolibarr_CloudRun](Dolibarr_CloudRun.md)**.
