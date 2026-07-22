---
title: "Tandoor Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Tandoor module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Tandoor Common — Shared Application Configuration

`Tandoor_Common` is the **shared application layer** for Tandoor. It is not
deployed on its own; instead it supplies the Tandoor-specific configuration
that both [Tandoor_GKE](Tandoor_GKE.md) and [Tandoor_CloudRun](Tandoor_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI
inputs of its own — but understanding what it provides explains the defaults
you see in the platform docs.

For the infrastructure that actually provisions and runs Tandoor, see the
platform guides ([Tandoor_GKE](Tandoor_GKE.md), [Tandoor_CloudRun](Tandoor_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Tandoor_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates a Django `SECRET_KEY` (50-char) and the initial superuser password (20-char) and stores both in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Deploys the official `vabene1111/recipes` image directly — no custom build, no entrypoint wrapper | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database, user, and grants | `initialization_jobs` output |
| Superuser bootstrap | Defines the `create-superuser` job (depends on `db-init`) that applies migrations and creates the initial Django superuser account | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `data` bucket (for recipe images) | `storage_buckets` output |
| Core settings | Sets the baseline Tandoor environment: `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, superuser username/email | Application behaviour in the platform guides |
| Health checks | Supplies the default startup (`/accounts/login/`) / liveness (TCP) probe | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager:

- **`SECRET_KEY`** — a 50-character random string. Used by Django to sign
  sessions, CSRF tokens, and password-reset links. Rotating it after first
  boot invalidates all active sessions and any in-flight signed tokens.
  Tandoor has no env-settable default upstream, so this module generates one
  (mirroring `Django_Common`'s own pattern).
- **`DJANGO_SUPERUSER_PASSWORD`** — a 20-character random string. Used only by
  the `create-superuser` init job to bootstrap the initial admin account.
  Unlike Mealie (which ships a fixed, undocumented `changeme@example.com`/
  `MyPassword` with no override mechanism), Tandoor gets a real, unique
  credential every deployment.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~superuser-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Tandoor requires **PostgreSQL 15**; the engine is fixed and no other engine
is supported. Tandoor's own `boot.sh` polls `pg_isready` before proceeding —
no lazy-connect — so the database must be reachable at container start.

Two initialization Jobs run on first deploy, in dependency order:

1. **`db-init`** (`postgres:15-alpine`) idempotently:
   - Detects the Cloud SQL Auth Proxy Unix socket and maps it for `psql`
     access,
   - Waits for PostgreSQL to be reachable,
   - Creates (or updates) the application role with the generated password,
   - Creates (or reconfigures) the application database owned by that role,
   - Grants full privileges,
   - Signals the Cloud SQL Auth Proxy to shut down gracefully.
2. **`create-superuser`** (depends on `db-init`, uses the main Tandoor image)
   idempotently:
   - Re-exports the platform's standard `DB_HOST`/`DB_PORT`/`DB_NAME`/
     `DB_USER`/`DB_PASSWORD` onto the `POSTGRES_*` names Tandoor's Django
     settings actually read (the `db_*_env_var_name` aliasing only applies to
     the main service container, not to init Jobs),
   - Applies Django migrations (`manage.py migrate --noinput`) as a safety
     net — the init job may run before the main container's own first boot,
   - Checks whether the configured superuser username already exists,
   - If not, runs `python manage.py createsuperuser --noinput`, which reads
     `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` /
     `DJANGO_SUPERUSER_PASSWORD` from the environment.

Both jobs are safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment
outputs.

---

## 4. Container image

`Tandoor_Common` deploys `vabene1111/recipes` directly — `image_source =
"prebuilt"`, no Cloud Build step, no entrypoint wrapper. Tandoor is a
genuinely single all-in-one container: nginx runs *inside* it and proxies to
gunicorn over a Unix socket (confirmed via the image's own `boot.sh`), so no
nginx sidecar or `additional_services` entry is needed — simpler than some
multi-process apps in this catalogue. Tandoor publishes a real `latest` tag,
so `application_version` passes straight through as the image tag.

---

## 5. Core application settings

`Tandoor_Common` establishes the baseline Tandoor environment so the
application comes up correctly on first boot:

- **`DB_ENGINE = "django.db.backends.postgresql"`** — selects the real
  Postgres backend.
- **`ALLOWED_HOSTS = "*"`** — required because the Cloud Run/GKE-assigned
  hostname is not known until after deploy; matches the established pattern
  for prebuilt Django-family images in this catalogue (Netbox, Paperless,
  Saleor).
- **`PGSSLMODE`** — set via the `db_ssl_mode` variable: `"require"` on Cloud
  Run (the `db_host_env_var_name` alias resolves to the raw Cloud SQL private
  IP, which rejects unencrypted TCP), `"prefer"` on GKE (the Cloud SQL Auth
  Proxy sidecar loopback is already plaintext).
- **`DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL`** — plain,
  non-sensitive settings consumed by the `create-superuser` job (default
  `admin` / `admin@techequity.cloud`).

---

## 6. Health probe behaviour

The default probes target `/accounts/login/` (startup) and a TCP
port-listening check (liveness):

- **Startup** — HTTP `/accounts/login/`, Django's public unauthenticated
  login view. It only renders 200 once the app has connected to Postgres and
  applied migrations, making it a genuine readiness signal. Tandoor has no
  dedicated health/info endpoint, so this substitutes for one.
- **Liveness** — TCP (port-listening only). A transient DB hiccup should not
  flap an instance that has already passed the startup probe by re-checking
  an authenticated-adjacent page.

---

## 7. Object storage

A dedicated **Cloud Storage** `data` bucket (for recipe images) is declared
here and provisioned by the foundation, which also grants the workload
service account access. It is **not** automatically mounted — add a
`gcs_volumes` entry at `/opt/recipes/mediafiles` (Tandoor's `MEDIA_ROOT`) if
uploaded images need to persist. `STATIC_ROOT` regenerates on every boot and
needs no persistence.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Tandoor-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Tandoor_GKE](Tandoor_GKE.md)** and
**[Tandoor_CloudRun](Tandoor_CloudRun.md)**.
