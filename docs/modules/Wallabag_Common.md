---
title: "Wallabag Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Wallabag module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Wallabag Common — Shared Application Configuration

`Wallabag_Common` is the **shared application layer** for Wallabag. It is not
deployed on its own; instead it supplies the Wallabag-specific configuration that
both [Wallabag_GKE](Wallabag_GKE.md) and [Wallabag_CloudRun](Wallabag_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of
its own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Wallabag, see the
platform guides ([Wallabag_GKE](Wallabag_GKE.md), [Wallabag_CloudRun](Wallabag_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Wallabag_Common | Where it surfaces |
|---|---|---|
| App secret | Generates a Symfony `APP_SECRET` (32-char random string) and stores it in **Secret Manager**, overriding Wallabag's publicly-known baked-in default | Injected as a container secret env var; retrieve via Secret Manager (see below) |
| Container image | Thin custom build of the official `wallabag/wallabag` (nginx + php-fpm, s6-overlay) image with a wrapper entrypoint; built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines a two-job chain: `db-init` (creates the database, user, and grants) → `wallabag-install` (runs Wallabag's own installer) | `initialization_jobs` output |
| Core settings | Sets the baseline Wallabag environment: DB driver/charset/table prefix, self-registration disabled | Application behaviour in the platform guides |
| Health checks | Declares `startup_probe`/`liveness_probe` variables — the calling variant's own defaults win in practice (see §6) | §Observability in the platform guides |

---

## 2. The Symfony app secret in Secret Manager

Exactly one secret is generated automatically and stored in Secret Manager — it
is never set in plain text:

- **`APP_SECRET`** — a 32-character random string (no special characters), stored
  as `secret-<prefix>-<app>-app-secret`. Wallabag's shipped `parameters.yml`
  bakes in a **publicly-known** default Symfony secret
  (`ovmpmAWXRCabNlMgzlzFXDYmCFfzGv`) used for CSRF tokens and other
  security-sensitive signing — this module generates a real one and overrides
  it.

The secret is materialised in Secret Manager under the simple key `APP_SECRET`
(not the real target name `SYMFONY__ENV__SECRET`) because GKE's SecretSync CRD
rejects `targetKey` values containing consecutive `_` separators. The wrapper
entrypoint aliases `APP_SECRET` onto `SYMFONY__ENV__SECRET` at container start.
The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`).

Retrieve the secret after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
gcloud secrets versions access latest --secret=<app-secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity
model.

---

## 3. Database engine and bootstrap

Wallabag runs on **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`); the engine is fixed
by this layer. Two initialization jobs run in sequence:

1. **`db-init`** (`mysql:8.0-debian`, `execute_on_apply = true`, `max_retries = 3`,
   `timeout_seconds = 600`) — locates the Cloud SQL connection (a Unix socket
   under `/cloudsql` when the Auth Proxy volume/sidecar is mounted, otherwise TCP
   via the instance private IP), waits for MySQL to be reachable, creates/aligns
   the application user and database, grants privileges, verifies the
   application user can connect (also warming the `caching_sha2_password`
   server-side cache), then signals the Cloud SQL Auth Proxy sidecar to shut
   down gracefully.
2. **`wallabag-install`** (`depends_on_jobs = ["db-init"]`, `max_retries = 3`,
   `timeout_seconds = 900`) — reuses the same custom app image (`image = null`),
   so the wrapper entrypoint still sets `SYMFONY__ENV__DATABASE_*` and
   `SYMFONY__ENV__SECRET`, with its command overridden via `args = ["bin/console",
   "wallabag:install", "--env=prod", "-n"]`. This single command creates the
   MySQL schema **and** performs Wallabag's first-run setup (including the
   default administrator account) — there is no separate migration job, unlike
   some other apps in this catalogue where schema install and app-level setup
   are two distinct steps.

Both jobs are safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin build: `FROM wallabag/wallabag:<WALLABAG_VERSION>`
(the official nginx + php-fpm image, running under s6-overlay, `WORKDIR
/var/www/wallabag`) plus a wrapper entrypoint that runs before the base image's
own entrypoint.

`scripts/Dockerfile`:

```dockerfile
ARG WALLABAG_VERSION=2.6.14
FROM wallabag/wallabag:${WALLABAG_VERSION}

COPY entrypoint.sh /entrypoint-wrapper.sh
RUN mv /entrypoint.sh /original-entrypoint.sh \
    && mv /entrypoint-wrapper.sh /entrypoint.sh \
    && chmod +x /entrypoint.sh /original-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
CMD ["wallabag"]
```

`scripts/entrypoint.sh` runs first on every container start:

- **Maps `DB_*` to `SYMFONY__ENV__DATABASE_*`** — the platform injects the
  standard, tenant-scoped `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`; Wallabag reads discrete `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/
  `_NAME`/`_USER`/`_PASSWORD` variables instead. The script exports the aliases
  directly — this mapping is hardcoded in the entrypoint, not driven by the
  Application Modules' `db_*_env_var_name` inputs, which are unused for
  Wallabag (they all default to `""`).
- **Explicitly sets `SYMFONY__ENV__DATABASE_DRIVER=pdo_mysql`.** See §5 below —
  this is the fix for a real, previously-encountered silent-failure bug.
- **Aliases `APP_SECRET` onto `SYMFONY__ENV__SECRET`.**
- **Hands off to the base image unmodified** — `exec /original-entrypoint.sh
  "$@"` preserves the base image's own `wallabag` (start server) vs.
  CLI-passthrough vs. import/migrate command dispatch logic untouched.

The base tag is controlled by an **app-specific** build ARG `WALLABAG_VERSION`
(not the generic `APP_VERSION` the Foundation injects into `build_args` and
would otherwise clobber to `"latest"`); `application_version = "latest"` maps to
a known-good pinned tag (`2.6.14`) at build time. Both platform variants forward
`container_image_source = "custom"` so the Cloud Build step actually runs (a
`"prebuilt"` override would skip the wrapper entrypoint and both the DB and
secret aliasing entirely).

---

## 5. The `SYMFONY__ENV__DATABASE_DRIVER` fix (why it matters)

Wallabag's shipped `parameters.yml` defaults `database_driver` to `pdo_sqlite`.
Setting only `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` —
with no explicit `SYMFONY__ENV__DATABASE_DRIVER` — still leaves Symfony's
parameter resolution falling back to the baked-in SQLite default. This was
confirmed via local Docker testing before ever deploying to the cloud: the
container logged `"Configuring the SQLite database..."` and installed against a
throwaway SQLite file inside the container, silently ignoring the
correctly-configured MySQL connection entirely.

This is a genuinely dangerous class of bug because it does **not** error — the
install "succeeds," the app appears to work end-to-end, but all data lives in a
container-local file that is wiped on every restart or redeploy, and Cloud SQL
is never touched at all. `scripts/entrypoint.sh` fixes it with one explicit line:

```sh
export SYMFONY__ENV__DATABASE_DRIVER="pdo_mysql"
```

alongside the other `SYMFONY__ENV__DATABASE_*` exports, before delegating to the
base image's entrypoint. **If this module is ever cloned as a template for
another Symfony-based application, verify the DB driver env var is set
explicitly** — a missing driver var can silently fall back to a bundled SQLite
default with no error at all, and the failure is invisible from the outside
(health checks pass, the UI works) — only the container's boot logs or the
database's own audit log reveal it.

---

## 6. Core application settings

`Wallabag_Common` establishes the baseline environment so the application
installs and comes up correctly on first boot:

- **`SYMFONY__ENV__DATABASE_CHARSET = "utf8mb4"`**, **`SYMFONY__ENV__DATABASE_TABLE_PREFIX
  = "wallabag_"`** — static MySQL config values.
- **`SYMFONY__ENV__FOSUSER_REGISTRATION = "false"`**, **`SYMFONY__ENV__FOSUSER_CONFIRMATION
  = "false"`** — self-service account registration is disabled; the
  bootstrapped administrator account (created by `wallabag-install`) is the
  only account until an operator explicitly enables sign-up or creates more
  accounts.
- **`SYMFONY__ENV__DOMAIN_NAME`** — set from the predicted/actual service URL
  when provided by the calling variant, used to build absolute links.

Container defaults set here: `container_port = 80`, `database_type =
MYSQL_8_0`, `cloudsql_volume_mount_path = /cloudsql`, plus the resource limits
and instance counts forwarded from the variant.

---

## 7. Health probe behaviour

This layer declares `startup_probe`/`liveness_probe` *variables* (each
defaulting internally to HTTP `/api/info`, an unauthenticated Wallabag API
endpoint), but both `Wallabag_CloudRun` and `Wallabag_GKE` always pass their own
`startup_probe`/`liveness_probe` values into this module's call — so the value
that actually takes effect on both platforms is the **variant's** default, not
this layer's internal one:

- **Startup probe** — **TCP** on the container port (80), so it only needs
  nginx to bind, independent of the installer's progress.
- **Liveness probe** — **HTTP `GET /`**. Wallabag redirects an unauthenticated
  request to `/login` (HTTP 302), which both Cloud Run's and Kubernetes' probe
  semantics treat as a passing response (any 2xx–3xx).

---

## 8. Object storage

This layer does **not** declare its own storage bucket (`storage_buckets` output
is `[]`) and does not populate `gcs_volumes` by default. Wallabag keeps all of
its content — saved articles, tags, users, annotations — in MySQL; it has no
filesystem-backed data directory that needs persistence. The generic `data` GCS
bucket seen in the platform guides comes from the Application Module's own
Foundation-level `storage_buckets` default, not from this layer, and is not
mounted into the container unless `gcs_volumes` is populated explicitly.

---

For the Wallabag-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Wallabag_GKE](Wallabag_GKE.md)** and
**[Wallabag_CloudRun](Wallabag_CloudRun.md)**.
