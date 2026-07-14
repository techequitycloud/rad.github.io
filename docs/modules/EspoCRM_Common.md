---
title: "EspoCRM Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the EspoCRM module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# EspoCRM Common — Shared Application Configuration

`EspoCRM_Common` is the **shared application layer** for EspoCRM. It is not deployed
on its own; instead it supplies the EspoCRM-specific configuration that both
[EspoCRM_GKE](EspoCRM_GKE.md) and [EspoCRM_CloudRun](EspoCRM_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs EspoCRM, see the platform
guides ([EspoCRM_GKE](EspoCRM_GKE.md), [EspoCRM_CloudRun](EspoCRM_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by EspoCRM_Common | Where it surfaces |
|---|---|---|
| First-run admin secret | Generates a 24-character `ESPOCRM_ADMIN_PASSWORD` and stores it in **Secret Manager** | Injected automatically as a secret env var; retrieve via Secret Manager (see below) |
| Container image | Thin custom build **FROM `espocrm/espocrm`** (Apache) wrapped with `cloud-entrypoint.sh`; built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`database_type = "MYSQL_8_0"`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** data bucket (`espocrm-data`) | `storage_buckets` output |
| Core settings | Sets EspoCRM's baseline environment: DB platform, admin username, site URL, port `80`, optional Redis object cache | Application behaviour in the platform guides |
| Health checks | Supplies the default startup (TCP `/`) and liveness (HTTP `/`) probes | §Observability in the platform guides |

---

## 2. The admin-password secret in Secret Manager

One secret is generated automatically and stored in Secret Manager:

- **`ESPOCRM_ADMIN_PASSWORD`** — a 24-character random password (`special = false` so
  it is safe for shell and CLI interpolation inside the entrypoint). The upstream
  `docker-entrypoint.sh` reads it on the **first install** to set the password for the
  `admin` user (`ESPOCRM_ADMIN_USERNAME`, default `admin`). It is generated once and
  written to Secret Manager so it is stable across container restarts and never appears
  as plaintext in Terraform state. The secret is named
  `secret-<resource_prefix>-espocrm-admin-password`.

Retrieve the admin login after deployment:

```bash
# Locate the secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"

# Read the admin password (username defaults to "admin"):
gcloud secrets versions access latest \
  --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
```

The **database password** is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

EspoCRM requires **MySQL**; the engine is fixed to `MYSQL_8_0` and PostgreSQL or other
engines are not supported. On the first deployment a one-shot job (`db-init`) runs using
`mysql:8.0-debian` and idempotently:

1. Resolves the Cloud SQL connection — it prefers the Auth Proxy Unix socket under
   `/cloudsql` when present, otherwise falls back to a private-IP TCP host (`DB_IP`),
2. Waits for MySQL port `3306` to be reachable,
3. Creates (or updates) the tenant-scoped application user with the generated password
   (`CREATE USER IF NOT EXISTS … / ALTER USER …`),
4. Creates the application database (`CREATE DATABASE IF NOT EXISTS`),
5. Grants all privileges on that database to the application user,
6. Verifies the app user can connect (which also warms the MySQL 8 `caching_sha2_password`
   server-side auth cache so subsequent PHP connections use the fast path),
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully (POST
   `/quitquitquit`).

The job runs on apply (`execute_on_apply = true`), has `max_retries = 3`, and is safe to
re-run. **There is no separate migrate job** — the upstream EspoCRM `docker-entrypoint.sh`
runs the install/migrate action automatically on container start, so the schema is
created on first boot once `db-init` has provisioned the database and user. Inspect the
database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

EspoCRM is deployed as a **thin custom build FROM `espocrm/espocrm`** (the official
Apache-variant image). The Dockerfile stays `root` (the upstream image chowns
`data`/`custom` to `www-data` on start) and layers in `cloud-entrypoint.sh`, then chains
to the upstream `docker-entrypoint.sh apache2-foreground`.

- **App-specific version arg.** The base tag is derived from an app-specific
  `ESPOCRM_VERSION` build arg — **not** the generic `APP_VERSION` the foundation injects
  and wins on the merge. `EspoCRM_Common` maps `application_version = "latest"` to a
  pinned, known-good apache tag (`10.0.2`) so a build never breaks on a moving or absent
  tag.
- **Maps `DB_*` → `ESPOCRM_DATABASE_*`.** The foundation injects the tenant-scoped
  `DB_HOST`, `DB_IP`, `DB_NAME`, `DB_USER`, `DB_PORT` (and `DB_PASSWORD` as a secret).
  `cloud-entrypoint.sh` exports EspoCRM's native `ESPOCRM_DATABASE_HOST/PORT/NAME/USER/PASSWORD`
  and `ESPOCRM_DATABASE_PLATFORM = "Mysql"`. Because EspoCRM's MySQL PDO connection needs
  a real TCP host, when `DB_HOST` is a socket-directory path (starts with `/`) the
  entrypoint falls back to the private IP (`DB_IP`) for a TCP connection — Cloud SQL MySQL
  does not force SSL on private-IP TCP, so no extra TLS wiring is required.
- **Resolves `ESPOCRM_SITE_URL`.** EspoCRM builds absolute links and its own installer
  checks from `siteUrl`, so it must be the reachable service host, not `localhost`. The
  entrypoint prefers an explicit value, then the foundation's predicted URLs
  (`APP_URL` → `CLOUDRUN_SERVICE_URL` → `GKE_SERVICE_URL`).
- **Hands off to the upstream entrypoint.** After exporting the `ESPOCRM_*` vars it
  `exec "$@"`, letting `docker-entrypoint.sh` auto-install or migrate the app.

---

## 5. Core application settings

`EspoCRM_Common` establishes the baseline EspoCRM environment so the application comes up
correctly on first boot:

- **Database platform** — `ESPOCRM_DATABASE_PLATFORM = "Mysql"`.
- **Admin bootstrap** — `ESPOCRM_ADMIN_USERNAME` (default `admin`) plus the injected
  `ESPOCRM_ADMIN_PASSWORD` secret; the upstream installer creates the `admin` user with
  this password on first install.
- **Site URL** — `ESPOCRM_SITE_URL` is set from the predicted service URL when known,
  otherwise resolved in the entrypoint.
- **Port** — the container listens on `80` (Apache); `container_port = 80`.
- **Object cache (Redis)** — off by default. When `enable_redis = true`, `REDIS_HOST`
  and `REDIS_PORT` are injected (using the NFS server IP for `REDIS_HOST` when no explicit
  host is given), enabling EspoCRM's object cache backend.
- **PHP tuning** — `php_memory_limit` (`512M`), `upload_max_filesize` (`64M`), and
  `post_max_size` (`64M`) are exposed for sites with heavy plugins or large media.

---

## 6. Health probe behaviour

EspoCRM serves its **login page at the unauthenticated root path** (`GET /` → `200`), so
the probes target `/`:

- **Startup probe** — `TCP` on port `80` by default (`initial_delay_seconds = 30`,
  `period_seconds = 15`, `failure_threshold = 20`), giving the container ample time to
  finish the first-boot install/migrate before it is considered failed.
- **Liveness probe** — `HTTP GET /` with a generous 300-second initial delay and a
  60-second period, matching EspoCRM's slow first-boot schema creation.

---

## 7. Object storage

A dedicated **Cloud Storage** data bucket (`espocrm-data`, `force_destroy = true`) is
declared here and provisioned by the foundation, which also grants the workload service
account access. On GKE the platform additionally mounts a shared **NFS** volume at
`/var/lib/espocrm` for EspoCRM's uploaded attachments and runtime data. List the bucket
with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the EspoCRM-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guides:
**[EspoCRM_GKE](EspoCRM_GKE.md)** and **[EspoCRM_CloudRun](EspoCRM_CloudRun.md)**.
