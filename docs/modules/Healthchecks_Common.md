---
title: "Healthchecks Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Healthchecks module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Healthchecks Common — Shared Application Configuration

`Healthchecks_Common` is the **shared application layer** for Healthchecks. It is
not deployed on its own; instead it supplies the Healthchecks-specific
configuration that both [Healthchecks_GKE](Healthchecks_GKE.md) and
[Healthchecks_CloudRun](Healthchecks_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Healthchecks, see the
platform guides ([Healthchecks_GKE](Healthchecks_GKE.md),
[Healthchecks_CloudRun](Healthchecks_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Healthchecks_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates Django `SECRET_KEY` (50-char random string) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Initial admin password | Generates a 24-character random password, seeded once by the `admin-bootstrap` job | Injected automatically; retrieve via Secret Manager |
| Container image | Official prebuilt `healthchecks/healthchecks` image — no custom build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15**, and sets `DB = "postgres"` explicitly | §Database in the platform guides |
| Database bootstrap | Defines `db-init` (create database + role) and `admin-bootstrap` (migrate + seed superuser) | `initialization_jobs` output |
| Object storage | None — Healthchecks stores all state in PostgreSQL | `storage_buckets` output (`[]`) |
| Core settings | Sets the baseline Healthchecks environment: `DB`, `DEBUG=False`, `SITE_ROOT`, `SITE_NAME`, `ALLOWED_HOSTS="*"`, `DEFAULT_FROM_EMAIL` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager:

- **`SECRET_KEY`** — a 50-character random string. Used by Django to sign
  sessions and CSRF tokens. Rotating it after first boot invalidates all active
  sessions.
- **`ADMIN_PASSWORD`** — a 24-character random password for the initial
  superuser, seeded **once** by the `admin-bootstrap` init job via Django's
  stock `createsuperuser --noinput`. There is no self-healing reseed on every
  boot (unlike Listmonk/Miniflux) — a password change after first boot must go
  through the Healthchecks UI or `manage.py changepassword`.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Healthchecks requires **PostgreSQL 15**; the engine is fixed and the `DB` env
var is explicitly set to `"postgres"`. The upstream image otherwise silently
falls back to a throwaway, container-local SQLite database with no error — the
same class of silent-wrong-engine trap already documented in this catalog for
Wallabag.

On the first deployment, two initialization jobs run:

1. **`db-init`** (`postgres:15-alpine`) — idempotently creates the application
   role and database. Unlike some apps, the Foundation's own automatic database
   provisioning does not cover this for Healthchecks, so every Postgres app in
   this catalog runs its own proven `db-init.sh`.
2. **`admin-bootstrap`** (the Healthchecks image itself, `depends_on_jobs =
   ["db-init"]`) — runs `manage.py migrate --noinput`, then `manage.py
   createsuperuser --noinput --username admin --email <admin_email>` with the
   password sourced from the `ADMIN_PASSWORD` secret, guarded with `|| true` so
   a re-run (which fails because the user already exists) does not fail the
   job. It replicates the migration step itself because Cloud Run/GKE init jobs
   invoke the container's command/args directly, bypassing the vendor image's
   own `uwsgi.ini` boot chain (where `hook-pre-app = exec:./manage.py migrate`
   normally runs automatically) — and on Cloud Run, init jobs complete strictly
   before the main Service is even created, so the schema would not exist yet
   otherwise.

Both jobs are safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image

The official prebuilt `healthchecks/healthchecks:<version>` image is used
directly (`image_source = "prebuilt"`) — no custom Dockerfile or Cloud Build
step, confirmed against the upstream `docker/Dockerfile` and `docker/uwsgi.ini`
(github.com/healthchecks/healthchecks):

- Listens on **0.0.0.0:8000** (`uwsgi.ini`: `http-socket = :8000`).
- `hook-pre-app = exec:./manage.py migrate` runs schema migrations
  automatically on every normal container start of the main service.
- `attach-daemon = ./manage.py sendalerts --skip-checks` and `sendreports
  --loop --skip-checks` start the background alert loop in the SAME container
  automatically — the loop that actually notices missed check-ins and fires
  alerts. It runs continuously, independent of inbound HTTP requests (the same
  shape as n8n/Kestra) — see the CloudRun variant's `cpu_always_allocated`/
  `min_instance_count` defaults.
- DB engine/host/credentials are discrete env vars (`DB`, `DB_HOST`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD`) that already match this repo's
  Foundation-injected names verbatim — no DSN composition or renaming needed,
  unlike most other prebuilt-image Common modules in this catalog.
- The base image is a plain `python:slim` (Debian) image — a real shell is
  present (unlike several distroless prebuilt images in this catalog), which
  is why the `admin-bootstrap` job can invoke `/bin/sh -c` directly with no
  busybox graft needed.

---

## 5. Core application settings

`Healthchecks_Common` establishes the baseline environment so the application
comes up correctly and safely on first boot:

- **`DB = "postgres"`** — selects the Postgres engine explicitly.
- **`DEBUG = "False"`** — the upstream image defaults to `DEBUG=True`, which its
  own docs warn against running in production.
- **`SITE_ROOT`** — set from the predicted/actual service URL; used to build
  absolute links in alert emails.
- **`ALLOWED_HOSTS = "*"`** — set explicitly because SITE_ROOT-derived host
  validation would otherwise reject the platform's own internal health-probe
  Host header (probes hit the container via an internal IP/hostname, not the
  public URL) — the same class of failure already documented in this catalog
  for Nextcloud/OpenProject trusted-hosts. Healthchecks has no other
  Host-based security model, so this is an acceptable default.
- **`DEFAULT_FROM_EMAIL`** — a placeholder (`healthchecks@example.org`) until
  the operator configures real outbound SMTP (`EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` via `environment_variables`/`secret_environment_variables`).

---

## 6. Health probe behaviour

The default probes target `/` — Healthchecks has no dedicated health endpoint;
the root login page is always public, unauthenticated, and a reliable
readiness signal (a broken DB connection would 500 instead of rendering it).

- **Cloud Run** uses HTTP probes targeting `/` with a 60-second startup delay
  and a 30-second liveness delay.
- **GKE** uses HTTP probes targeting `/` with a 90-second startup delay and a
  60-second liveness delay.

---

## 7. Object storage

None. Healthchecks stores all state (checks, pings, users, alert
configuration) in PostgreSQL — there is no media/uploads directory, so
`storage_buckets` returns an empty list and no GCS bucket is provisioned for
the application itself (a generic Foundation `data` bucket may still exist per
the standard `storage_buckets` variable, unrelated to Healthchecks' own needs).

---

For the Healthchecks-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Healthchecks_GKE](Healthchecks_GKE.md)** and
**[Healthchecks_CloudRun](Healthchecks_CloudRun.md)**.
