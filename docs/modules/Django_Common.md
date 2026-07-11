---
title: "Django Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Django module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Django Common — Shared Application Configuration

`Django_Common` is the **shared application layer** for Django. It is not deployed on
its own; instead it supplies the Django-specific configuration that both
[Django_GKE](Django_GKE.md) and [Django_CloudRun](Django_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Django, see the platform
guides ([Django_GKE](Django_GKE.md), [Django_CloudRun](Django_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. What this layer provides

| Area | Provided by Django_Common | Where it surfaces |
|---|---|---|
| Django `SECRET_KEY` | Generates a 50-character random key and stores it in **Secret Manager** | Injected as `SECRET_KEY` at runtime; retrieve via Secret Manager (see below) |
| Container image | Pins the Django/Gunicorn image and Cloud Build source, UID 2000 | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job that creates the database, user, and installs extensions | `initialization_jobs` output |
| Schema migrations | Defines the `db-migrate` job that runs `manage.py migrate` + `collectstatic` | Runs automatically on every deploy |
| PostgreSQL extensions | Auto-installs `pg_trgm`, `unaccent`, `hstore`, `citext` | No user action required |
| Object storage | Declares the **Cloud Storage** media bucket | `storage_buckets` output |
| Core settings | Sets container port (8080), image source (`custom`), extension flag, Gunicorn server | Application behaviour in the platform guides |
| Health probes | Supplies the default startup/liveness probe configuration targeting `/healthz` | §Observability in the platform guides |

---

## 2. Django `SECRET_KEY` in Secret Manager

The Django `SECRET_KEY` is generated automatically and stored as a Secret Manager
secret — it is never set in plain text. Retrieve it after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~key"
gcloud secrets versions access latest --secret=<resource-prefix>-django-key --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).

---

## 3. Database engine and bootstrap

Django requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported
through this module. On the first deployment two jobs run in sequence:

1. **`db-init`** (image: `postgres:15-alpine`) — connects to Cloud SQL through the
   Auth Proxy and idempotently creates the application database and user, grants
   privileges, and installs the four required PostgreSQL extensions:

   | Extension | Purpose |
   |---|---|
   | `pg_trgm` | Trigram similarity for full-text search |
   | `unaccent` | Accent-insensitive text search |
   | `hstore` | Key-value store column type |
   | `citext` | Case-insensitive text column type |

2. **`db-migrate`** (application image) — runs `manage.py migrate` to apply all
   pending migrations and `manage.py collectstatic --noinput --clear` to collect
   static files to the configured location.

Both jobs run with `execute_on_apply = true` so they fire automatically on each
deployment. They are idempotent and safe to re-run. Inspect or re-trigger the
database with:

```bash
# Cloud Run:
gcloud run jobs list --region "$REGION" --project "$PROJECT"
gcloud run jobs execute db-init-<resource-prefix> --region "$REGION" --project "$PROJECT"
# GKE:
kubectl get jobs -n "$NAMESPACE"
kubectl describe job db-init -n "$NAMESPACE"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Django_Common` establishes the baseline Django environment so the application comes
up correctly on first boot:

- **Container port 8080.** Gunicorn binds to port 8080. The foundation configures the
  Cloud Run service or Kubernetes Service to target this port.
- **Custom image via Cloud Build.** `container_image_source = "custom"` instructs the
  foundation to trigger a Cloud Build from the `Django_Common/scripts/` Dockerfile,
  which produces a Gunicorn-based Django image tagged with `application_version`.
- **PostgreSQL extensions flag.** `enable_postgres_extensions = true` is set
  internally so the foundation provisions the extensions IAM grants. The four
  extensions are installed by `db-init.sh`; you do not need to set this flag
  manually.
- **Superuser creation.** `entrypoint.sh` checks for `DJANGO_SUPERUSER_USERNAME`,
  `DJANGO_SUPERUSER_EMAIL`, and `DJANGO_SUPERUSER_PASSWORD` on startup and calls
  `manage.py createsuperuser --noinput` if all three are present. Use
  `secret_environment_variables` in the platform module to supply the password from
  Secret Manager.
- **GCS media volume.** The `db-migrate` job mounts the `django-media` GCS bucket
  (provisioned by `Django_Common`) as a GCS Fuse volume at the same path used by the
  application, so `collectstatic` writes directly to Cloud Storage.

Platform-specific adjustments handled here:

- **GKE** additionally sets `session_affinity = "ClientIP"` so that a given user's
  requests are routed to the same pod when in-process session storage is used.
- **Cloud Run** requires `execution_environment = "gen2"` for NFS mounts; this is
  applied automatically when `enable_nfs = true`.

---

## 5. Health probe behaviour

The default probes target `/healthz` on port 8080, which returns HTTP 200 once the
application is ready, with a startup delay sufficient to allow first-boot migrations.

- **GKE** uses HTTP probes for both startup (90s initial delay) and liveness (60s
  initial delay) — in-cluster probe traffic reaches the container directly without
  routing through a load balancer.
- **Cloud Run** also uses HTTP probes for both startup (60s initial delay) and
  liveness (30s initial delay). Unlike Mautic/Apache, Django's Gunicorn server does
  not redirect HTTP to HTTPS, so plain HTTP probes work without a TCP workaround.
  Ensure `SECURE_SSL_REDIRECT = False` in `settings.py` (or exempt `/healthz`) so the
  probe path is never redirected.

If your first-deploy migrations are large and the 60-second (Cloud Run) or 90-second
(GKE) initial delay is insufficient, override `startup_probe` with a larger
`initial_delay_seconds` in the platform module variables.

---

## 6. Object storage

A dedicated **Cloud Storage** media bucket (`name_suffix = "media"`) is declared here
and provisioned by the foundation, which also grants the workload service account
access. Combined with the shared Filestore (NFS) volume (when `enable_nfs = true`),
this gives Django durable, consistent media storage across all instances. The bucket
is provisioned in the deployment region. List and inspect it with:

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<resource-prefix>-media/
```

---

For the Django-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Django_GKE](Django_GKE.md)** and **[Django_CloudRun](Django_CloudRun.md)**.
