---
title: "LimeSurvey Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the LimeSurvey module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# LimeSurvey Common — Shared Application Configuration

`LimeSurvey_Common` is the **shared application layer** for LimeSurvey. It is not
deployed on its own; instead it supplies the LimeSurvey-specific configuration that
both [LimeSurvey_GKE](LimeSurvey_GKE.md) and
[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md) build on, so the two platform variants
behave identically where it matters. End users never configure this layer directly —
it has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs LimeSurvey, see the platform
guides ([LimeSurvey_GKE](LimeSurvey_GKE.md),
[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by LimeSurvey_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the super-administrator password (20-char) and stores it in **Secret Manager**; injects it as the `ADMIN_PASSWORD` secret env | Retrieve via Secret Manager (see below) |
| Container image | Wraps the upstream `martialblog/limesurvey` (Apache) image with a thin cloud entrypoint; builds via Cloud Build and mirrors the base into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the engine and forces the **InnoDB** storage engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `limesurvey-uploads` bucket | `storage_buckets` output |
| Core settings | Sets the baseline LimeSurvey environment: `DB_TYPE`, `DB_PORT`, storage engine, `URL_FORMAT`, admin identity, `PUBLIC_URL` | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe and HTTP liveness probe targeting the root `/` landing endpoint | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

The upstream `martialblog/limesurvey` entrypoint **requires** `ADMIN_PASSWORD` — it
exits with code 1 if the variable is missing — and seeds the initial super-admin
account with it on first boot. `LimeSurvey_Common` generates a 20-character password
once and stores it in Secret Manager so it is stable across restarts and never lands
in plaintext config:

- **`ADMIN_PASSWORD`** — the super-administrator password for the `admin` account.
  Stored as `secret-<resource_prefix>-<application_name>-admin-password`. It is
  exposed to the running container as the `ADMIN_PASSWORD` secret env via the
  `secret_ids` output. The account identity itself is fixed by static env in this
  layer: `ADMIN_USER = admin`, `ADMIN_NAME = Administrator`,
  `ADMIN_EMAIL = admin@techequity.cloud`.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).

Retrieve the admin password after deployment:

```bash
# Find the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the current value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Once you have logged in and (optionally) created additional accounts, you may rotate
the value in Secret Manager and redeploy — the entrypoint re-applies whatever
`ADMIN_PASSWORD` is present. See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

---

## 3. Database engine and bootstrap

LimeSurvey requires **MySQL 8.0**; the engine is fixed to `MYSQL_8_0` and other
engines are not supported by this module. On the first deployment a one-shot job
(`db-init`) runs using `mysql:8.0-debian` and idempotently:

1. Locates the Cloud SQL connection — the Cloud SQL Auth Proxy Unix socket under
   `/cloudsql` when a socket volume is mounted, otherwise a TCP connection via the
   instance private IP (`DB_IP`),
2. Waits for MySQL port 3306 to be reachable (TCP path),
3. Creates (or updates) the application user with the generated password
   (`CREATE USER IF NOT EXISTS … / ALTER USER …`),
4. Creates the application database (`CREATE DATABASE IF NOT EXISTS`),
5. Grants all privileges on that database to the application user,
6. Verifies the application user can actually connect — failing the job early on a
   password or grant mismatch, and warming the `caching_sha2_password` server-side
   auth cache,
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully (via
   `quitquitquit`) so the job container exits cleanly.

The job is safe to re-run. Note that MySQL 8.0 uses `caching_sha2_password` by
default; over plain TCP the script adds `--get-server-public-key` for RSA key
exchange when the client supports it.

**No separate migration job exists.** The actual LimeSurvey schema (the
`settings_global`, `surveys`, `users`, … tables) is created on container start by the
upstream `martialblog/limesurvey` entrypoint, which runs the LimeSurvey console
installer / `updatedb` once `db-init` has provisioned an empty database and user.

**Why InnoDB is forced.** Cloud SQL MySQL 8.0 disables the MyISAM storage engine
(`disabled_storage_engines=MyISAM`). The `martialblog/limesurvey` entrypoint defaults
its engine to MyISAM and writes it into `config.php`, so the console installer would
try `CREATE TABLE … ENGINE=MyISAM` and Cloud SQL rejects it (`3161 Storage engine
MyISAM is disabled`). This layer therefore sets both `DB_MYSQL_ENGINE = InnoDB` and
`DBENGINE = InnoDB` so table creation succeeds on first boot.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM martialblog/limesurvey:<tag>` (Apache,
running on port 8080 as `www-data` with `WORKDIR /var/www/html`). The base tag is
keyed on an app-specific build arg `LIMESURVEY_VERSION` — **not** the generic
`APP_VERSION`, which the foundation injects into `build_args` and would clobber to
`latest`. `LimeSurvey_Common` maps `application_version == "latest"` onto a known-good
pinned tag (`6-apache`) and passes it as `LIMESURVEY_VERSION`. The image is built via
Cloud Build; `enable_image_mirroring = true` mirrors the public Docker Hub base into
Artifact Registry.

The wrapper drops in a `cloud-entrypoint.sh` that runs before the upstream entrypoint
and keeps its work minimal:

- **Defaults the database backend** — `DB_TYPE = mysql`, `DB_PORT = 3306`.
- **Aliases the tenant-scoped DB names** — defensively maps `DB_USER → DB_USERNAME`
  and `DB_DATABASE → DB_NAME` if a name is missing (the variant `main.tf` already
  renames the foundation-injected values onto `DB_USERNAME` / `DB_NAME` /
  `DB_PASSWORD`).
- **Sets `PUBLIC_URL`** — from the foundation-exported service URL
  (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) when unset, so generated links and
  assets resolve on the real host.
- **Hands off to the upstream `/usr/local/bin/entrypoint.sh`**, which generates
  `application/config/config.php` from the environment, provisions/updates the
  schema, and finally execs `apache2-foreground`.

---

## 5. Core application settings

`LimeSurvey_Common` establishes the baseline LimeSurvey environment so the
application comes up correctly on first boot:

- **Database** — `DB_TYPE = mysql`, `DB_PORT = 3306`, `DB_MYSQL_ENGINE = InnoDB`,
  `DBENGINE = InnoDB`. `DB_HOST`, `DB_USERNAME`, `DB_NAME`, and `DB_PASSWORD` are
  injected by the foundation (renamed onto LimeSurvey's native names via
  `db_*_env_var_name`).
- **URL format** — `URL_FORMAT = path` for clean, path-based survey URLs.
- **Admin identity** — `ADMIN_USER = admin`, `ADMIN_NAME = Administrator`,
  `ADMIN_EMAIL = admin@techequity.cloud`; `ADMIN_PASSWORD` from Secret Manager.
- **Public URL** — `PUBLIC_URL` from the predicted/actual service URL so links and
  assets resolve on the real host.
- **Port** — the container listens on `8080` (Apache).

Platform-specific adjustment handled here:

- **GKE** overrides `DB_HOST = 127.0.0.1` because the Cloud SQL Auth Proxy runs as a
  sidecar bound to loopback. On **Cloud Run** the app dials the Cloud SQL private IP
  over TCP (MySQL over private-IP TCP needs no SSL).

---

## 6. Health probe behaviour

LimeSurvey serves an unauthenticated HTTP 200 at the root (`/`) landing endpoint, so
the probes target `/`:

- **Startup probe** — TCP against the container port, 30-second initial delay, 15-second
  period, 20 failures allowed — a generous window for the first-boot console installer
  that provisions the schema.
- **Liveness probe** — HTTP `GET /`, 300-second initial delay, 60-second period, 3
  failures allowed.

---

## 7. Object storage and file persistence

A dedicated **Cloud Storage** bucket (`limesurvey-uploads`) is declared here and
provisioned by the foundation, which also grants the workload service account access:

```bash
gcloud storage buckets list --project "$PROJECT"
```

Note that persistence of LimeSurvey's runtime upload directory
(`/var/www/html/upload` — uploaded asset images, signatures, barcodes) across
container restarts is provided by the **NFS (Cloud Filestore)** mount, which both
platform variants enable by default (`enable_nfs = true`). The `limesurvey-uploads`
GCS bucket is provisioned for additional object storage but is not FUSE-mounted by
default.

---

For the LimeSurvey-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[LimeSurvey_GKE](LimeSurvey_GKE.md)** and
**[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md)**.
