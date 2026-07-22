---
title: "NetBox Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the NetBox module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# NetBox Common — Shared Application Configuration

`Netbox_Common` is the **shared application layer** for NetBox. It is not
deployed on its own; instead it supplies the NetBox-specific configuration
that both [Netbox_GKE](Netbox_GKE.md) and [Netbox_CloudRun](Netbox_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI
inputs of its own — but understanding what it provides explains the defaults
you see in the platform docs.

For the infrastructure that actually provisions and runs NetBox, see the
platform guides ([Netbox_GKE](Netbox_GKE.md), [Netbox_CloudRun](Netbox_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Netbox_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_KEY` (64-char Django secret; NetBox requires ≥50) and `SUPERUSER_PASSWORD` (24-char initial admin password) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `netboxcommunity/netbox` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Background worker | Co-locates `manage.py rqworker --with-scheduler` as a backgrounded process alongside the web server in the same container | Application behaviour in the platform guides |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `media` bucket, mounted at NetBox's real `MEDIA_ROOT` | `storage_buckets` output |
| Core settings | Sets the baseline NetBox environment: DB engine passthrough, Redis host resolution, timezone, admin identity, CSRF/CORS | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/login/` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager:

- **`SECRET_KEY`** — a 64-character random string. NetBox (Django) uses it for
  session signing, CSRF protection, and signed cookies, and requires it to be
  at least 50 characters. Rotating it after first boot invalidates all active
  sessions and signed cookies.
- **`SUPERUSER_PASSWORD`** — a 24-character random string used to set the
  password of the auto-created initial admin account
  (`admin_user`/`admin_email`, defaulting to `admin`/`admin@example.com`) on
  first boot. Superuser creation is idempotent — skipped (not an error) if a
  user with that name already exists — so regenerating this secret does not
  retroactively change an already-created account's password; change it via
  the NetBox UI instead.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~-key OR name~admin-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

NetBox requires **PostgreSQL 14 or later** (this module pins **15**); the
engine is fixed and MySQL or SQLite are not supported for production use. On
the first deployment a one-shot job (`db-init`) runs using `postgres:15-alpine`
and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (on Cloud Run) and maps it for
   `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application user with the generated password,
4. Creates (or reconfigures) the application database with that user as owner,
5. Grants full privileges on the database and public schema,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

NetBox's own `configuration.py` reads `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/
`DB_PASSWORD` natively (psycopg2 discrete env vars) — no renaming is needed,
unlike apps that compose a single DSN string. The job is safe to re-run.
Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `netboxcommunity/netbox:<version>` (via
`Netbox_Common/scripts/Dockerfile`, `USER root` — matching the upstream image,
which sets no non-root `USER`) with a thin shell entrypoint
(`entrypoint.sh`) that runs before the application starts:

- **Database SSL mode branching** — `DB_SSLMODE` is set to `disable` for a
  Cloud Run Unix-socket directory (path starting with `/`) or a GKE Cloud SQL
  Auth Proxy loopback (`127.0.0.1`/`localhost`), and `require` for a raw
  private-IP TCP connection.
- **Redis placeholder resolution** — if `REDIS_HOST` still contains an
  unresolved `$(NFS_SERVER_IP)` reference (a Cloud Run declaration-order
  quirk where `$(VAR)` substitutions can pass through literally), the
  entrypoint resolves it directly from the `NFS_SERVER_IP` env var.
- **Redis database pinning** — `REDIS_DATABASE` (task queue, default `0`) and
  `REDIS_CACHE_DATABASE` (cache, default `1`) are always set as separate
  logical databases.
- **NetBox's own first-boot sequence** — `/opt/netbox/docker-entrypoint.sh true`
  runs synchronously: DB-readiness wait, `migrate --no-input`, stale-contenttype
  cleanup, session cleanup, lazy search-index reindex, and superuser bootstrap
  from `SUPERUSER_*` env vars. The trailing `true` makes it run its full setup
  and exit 0 back into this script (the netbox-docker project's own convention
  for running setup once per container role before launching that role's
  actual process), rather than replacing this process.
- **Background RQ worker** — `manage.py rqworker --with-scheduler` starts as a
  backgrounded (`&`) process with a signal trap, then the web server is
  `exec`'d last as PID 1. Co-located here (rather than a separate Cloud Run
  additional service) because both processes must share this custom-built
  image and the platform-injected DB/Redis/secret environment — the same
  pattern used elsewhere in this catalogue for co-located worker processes
  (e.g. Saleor's Celery worker, Woodpecker's agent).

---

## 5. Core application settings

`Netbox_Common` establishes the baseline NetBox environment so the
application comes up correctly on first boot:

- **Redis is mandatory.** `REDIS_HOST` is resolved from `redis_host`, the NFS
  server IP, or the `$(NFS_SERVER_IP)` runtime placeholder, in that order.
  `REDIS_SSL = "false"` by default.
- **`ALLOWED_HOSTS = "*"` and `CORS_ORIGIN_ALLOW_ALL = "true"`** — open by
  default for a zero-touch first deploy; tighten via `environment_variables`
  in the Application Module for a hardened production instance.
- **`CSRF_TRUSTED_ORIGINS`** is set from the caller's `service_url` variable —
  both `Netbox_CloudRun` and `Netbox_GKE` compute this from the actual
  predicted service URL (the app-scoped hash + project number on Cloud Run;
  the internal cluster service URL on GKE), not the tenant-only resource
  prefix, which would build a URL for a non-existent service and reject every
  authenticated POST (including login) with a CSRF failure.
- **`TIME_ZONE`** — set from `time_zone` (default `UTC`).
- **Initial admin account** — `SUPERUSER_NAME`/`SUPERUSER_EMAIL` from
  `admin_user`/`admin_email` (defaults `admin`/`admin@example.com`);
  `SUPERUSER_PASSWORD` is injected as a Secret Manager secret reference.

---

## 6. Health probe behaviour

The default probes target `/login/` — NetBox's public, unauthenticated login
page, which responds only once the server is fully initialised and connected
to PostgreSQL. `/api/status/` is deliberately **not** used, because it
requires authentication and would fail every platform health probe.

- Startup probe: HTTP `/login/`, 60-second initial delay, 60 failure threshold
  (accommodates first-boot migrations).
- Liveness probe: HTTP `/login/`, 60-second initial delay, 3 failure threshold.

---

## 7. Object storage

A dedicated **Cloud Storage** `media` bucket is declared here and mounted via
GCS Fuse at NetBox's real `MEDIA_ROOT`, `/etc/netbox/media` (confirmed live
via `manage.py shell`; **not** the more obvious-looking `/opt/netbox/netbox/media`,
which is not where NetBox writes uploads). This is deliberately the sole
persistent store for device/rack images and file attachments — get the mount
path wrong and uploads write to the ephemeral container filesystem instead:
they read back immediately (same local filesystem), giving no visible error,
but never reach GCS and are lost on every restart.

Mount options: `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`,
`uid=0`, `gid=0`, `file-mode=0664`, `dir-mode=0775`. The `uid=0`/`gid=0` pin
matches NetBox's root-running container (the official image sets no `USER`).
On **Cloud Run**, this is close to a no-op — the platform's own GCS Fuse
integration already applies `uid:1000/gid:1000` by default, and root can
write into any owner's files regardless. On **GKE**, the GCS Fuse CSI driver
has no equivalent default, so this explicit pin is what makes the mount
writable at all.

```bash
gcloud storage buckets list --project "$PROJECT"
```

The bucket name is computed as `gcs-${application_name}${tenant_resource_prefix}-media`,
using the **tenant-only** prefix (matching the `deployment_id` module's own
hash) to line up with what the Foundation actually creates.

---

For the NetBox-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Netbox_GKE](Netbox_GKE.md)** and
**[Netbox_CloudRun](Netbox_CloudRun.md)**.
