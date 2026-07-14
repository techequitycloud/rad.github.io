---
title: "FreshRSS Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the FreshRSS module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# FreshRSS Common — Shared Application Configuration

`FreshRSS_Common` is the **shared application layer** for FreshRSS. It is not
deployed on its own; instead it supplies the FreshRSS-specific configuration that
both [FreshRSS_GKE](FreshRSS_GKE.md) and [FreshRSS_CloudRun](FreshRSS_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs FreshRSS, see the platform
guides ([FreshRSS_GKE](FreshRSS_GKE.md), [FreshRSS_CloudRun](FreshRSS_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by FreshRSS_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates a 24-character `FRESHRSS_ADMIN_PASSWORD` and stores it in **Secret Manager**; injected as a service secret env | Retrieve via Secret Manager (see below) |
| Container image | Thin custom build layered on the official `freshrss/freshrss` image with a `platform-entrypoint.sh` wrapper; built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the supported engine (the entrypoint hardcodes `--db-type pgsql`) | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| First-run install | The entrypoint drives FreshRSS's own `cli/do-install.php` + `cli/create-user.php` on first boot | Application behaviour in the platform guides |
| Persistent storage | Declares **no GCS bucket**; per-user state and config live in the FreshRSS data directory, persisted via NFS (or a block PVC on GKE) | `storage_buckets` output (empty) |
| Core settings | Sets the FreshRSS baseline: admin user, language, timezone, feed-refresh cron cadence, base URL | Application behaviour in the platform guides |
| Health checks | Supplies default startup (TCP) and liveness (HTTP) probes; FreshRSS also serves an unauthenticated `/status` JSON endpoint | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

One secret is generated automatically and stored in Secret Manager:

- **`FRESHRSS_ADMIN_PASSWORD`** — a 24-character random password (no special
  characters). On the first install the entrypoint feeds it to FreshRSS's
  `create-user.php` CLI so the default `admin` account (and the matching API
  password used by mobile clients over the Google Reader / Fever API) is usable
  immediately after deploy. It is delivered to the running container as a **service
  secret env** via the module's `secret_ids` output.

The secret is named `secret-<resource_prefix>-<application_name>-admin-password`
(for example `secret-appfreshrssdemo1a2b3c4d-freshrss-admin-password`). Retrieve it
after deployment:

```bash
# List the FreshRSS admin-password secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the current admin password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The default login user is `admin`. Because the first-install CLI is guarded on the
presence of `data/config.php`, changing this secret **after** the initial install
does not automatically re-set the admin login — rotate the password from inside the
FreshRSS UI (or re-run `create-user.php`) instead.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

---

## 3. Database engine and bootstrap

FreshRSS runs against **PostgreSQL 15**. Although the platform `database_type`
variable nominally offers other options, the FreshRSS entrypoint installs with
`--db-type pgsql` and the bootstrap job is Postgres-only, so PostgreSQL is the
supported engine. On the first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (Cloud Run) and maps it for `psql`
   access, or uses the `127.0.0.1` proxy loopback (GKE) / private-IP TCP,
2. Selects the correct `PGSSLMODE` for the connection hop (`disable` for the
   socket / loopback, `require` for direct private-IP TCP),
3. Waits for PostgreSQL to be reachable (`pg_isready`),
4. Creates (or updates) the application user with the generated password,
5. Creates (or reconfigures) the application database with that user as owner,
6. Grants full privileges on the database and `public` schema,
7. Signals the Cloud SQL Auth Proxy sidecar to shut down (`/quitquitquit`) so the
   Job can complete.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.
There is **no separate migrate job**: the FreshRSS schema is created by the app's
own `cli/do-install.php`, which the entrypoint runs on first boot once `db-init`
has provisioned the database and role.

---

## 4. Container image and entrypoint

The custom image is a thin build `FROM freshrss/freshrss:<version>` (Apache, port
80) with a small `platform-entrypoint.sh` layered on top. The base-image tag is
driven by an **app-specific `FRESHRSS_VERSION` build ARG** (never the generic
`APP_VERSION`, which the foundation injects and would clobber to `latest`); when the
deployment requests `latest`, the module pins a known-good tag (`1.26.3`) for
deterministic rebuilds.

The entrypoint runs before the upstream FreshRSS entrypoint and:

- **Resolves the database host** — prefers the Cloud SQL Unix socket directory when
  the volume is mounted (Cloud Run), falls back to the `127.0.0.1` proxy loopback
  (GKE) or a private-IP TCP host. It never feeds a socket path to a TCP connection.
- **Builds the install/user CLI arguments** — assembles `FRESHRSS_INSTALL`
  (`--db-type pgsql`, host, user, password, base, `--auth-type form`,
  `--api-enabled`, `--language`, `--base-url`) and `FRESHRSS_USER` (admin user +
  password + API password) from the platform-injected `DB_*` variables and the
  `FRESHRSS_ADMIN_PASSWORD` secret. FreshRSS's `do-install.php` does **not** accept
  a `--db-port` flag, so no explicit port is passed.
- **Derives the public base URL** — from `BASE_URL`, falling back to
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`.
- **Chains the upstream FreshRSS entrypoint** — which idempotently runs the install
  (guarded on `data/config.php`), sets up the feed-refresh cron, and execs the
  Apache CMD. A direct-CLI fallback runs the install if the upstream entrypoint is
  absent.

The `Dockerfile` also restores the upstream default CMD verbatim (source Apache
envvars → start `cron` → `exec apache2 -D FOREGROUND`), because setting a custom
ENTRYPOINT resets the inherited CMD.

---

## 5. Core application settings

`FreshRSS_Common` establishes the baseline FreshRSS environment so the application
comes up correctly on first boot:

- **Admin user** — `FRESHRSS_ADMIN_USER = "admin"`.
- **Language** — `FRESHRSS_LANGUAGE = "en"`.
- **Timezone** — `TZ = "UTC"`.
- **Feed-refresh cron** — `CRON_MIN = "*/15"`; the upstream image runs an
  in-container cron that actualizes (refreshes) subscribed feeds every 15 minutes.
- **Base URL** — `BASE_URL` is set to the public service URL (the predicted Cloud
  Run URL or the GKE service URL); the entrypoint prefers the runtime-injected
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` when present.
- **Database wiring** — the foundation injects the standard `DB_USER`,
  `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_IP`, `DB_PORT` variables under their
  **default names** (this module does not rename them); the entrypoint consumes
  them directly.

---

## 6. Health probe behaviour

The startup probe is a **TCP** check on port 80 (the container is ready once Apache
binds its port), and the liveness probe is an **HTTP** check. FreshRSS serves its
unauthenticated index at `/` (HTTP 200) and an unauthenticated JSON health endpoint
at `/status`; the CloudRun/GKE variants target `/` by default, while this shared
layer's own liveness default targets `/status`. A generous startup window (a high
`failure_threshold`) accommodates the first-boot install that creates the schema.

---

## 7. Persistent storage

FreshRSS keeps its generated configuration (`data/config.php`), per-user state,
cached articles, and feed favicons under the data directory
`/var/www/FreshRSS/data`. This layer declares **no GCS bucket** (`storage_buckets`
is empty); instead the platform variants mount an **NFS volume at
`/var/www/FreshRSS/data`** (`enable_nfs = true` by default) so that state survives
container restarts and redeploys. On GKE a block PVC (StatefulSet) is an
alternative persistence mode.

List provisioned storage with:

```bash
gcloud storage buckets list --project "$PROJECT"   # FreshRSS declares none of its own
```

---

For the FreshRSS-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[FreshRSS_GKE](FreshRSS_GKE.md)** and **[FreshRSS_CloudRun](FreshRSS_CloudRun.md)**.
