---
title: "Directus Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Directus module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Directus Common — Shared Application Configuration

`Directus_Common` is the **shared application layer** for Directus. It is not deployed on
its own; instead it supplies the Directus-specific configuration that both
[Directus_GKE](Directus_GKE.md) and [Directus_CloudRun](Directus_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Directus, see the platform
guides ([Directus_GKE](Directus_GKE.md), [Directus_CloudRun](Directus_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. What this layer provides

| Area | Provided by Directus_Common | Where it surfaces |
|---|---|---|
| Encryption secrets | Auto-generates and stores `KEY` (data encryption) and `SECRET` (JWT signing) in **Secret Manager** | Injected as `KEY` and `SECRET` env vars into the workload |
| Admin credential | Generates the Directus admin password and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Redis secret | Builds the Redis connection URL and stores it in **Secret Manager** (when Redis is enabled) | Injected as `REDIS` env var |
| Container image | Pins the official Directus image version and the Cloud Build that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine and sets `DB_CLIENT = "pg"` | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, extensions, and grants | `initialization_jobs` output |
| Object storage | Sets `STORAGE_LOCATIONS = "gcs"` and `STORAGE_GCS_DRIVER = "gcs"` so all uploads go to the GCS bucket | Bucket name in `storage_buckets` output |
| Runtime flags | Injects `BOOTSTRAP = "true"` and `AUTO_MIGRATE = "true"` so migrations and first-boot seeding run automatically | Application behaviour in the platform guides |
| Health checks | Supplies the default startup and liveness probe configuration targeting `/server/health` | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Four secrets are generated automatically and stored in Secret Manager — none are ever written in plain text:

| Secret (ID suffix) | Content | Injected as |
|---|---|---|
| `<prefix>-key` | 32-character random hex string | `KEY` — used for Directus data encryption |
| `<prefix>-secret` | 32-character random string | `SECRET` — used for JWT signing |
| `<prefix>-admin-password` | Random 24-character password | `ADMIN_PASSWORD` — initial admin account |
| `<prefix>-redis` | Full Redis connection URL | `REDIS` — cache and rate-limit backend (when Redis is enabled) |

Retrieve any of these after deployment:

```bash
# List all secrets for the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"

# Retrieve the admin password:
gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"

# Retrieve the DB password (separate foundation-managed secret — name is in the Outputs):
gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
```

**KEY and SECRET rotation warning.** Rotating `KEY` immediately invalidates all encrypted data stored with the old key. Rotating `SECRET` invalidates all issued JWTs and active sessions. Only rotate either during a planned maintenance window.

---

## 3. Database engine and bootstrap

Directus requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported. `DB_CLIENT = "pg"` is injected automatically — do not set it via `environment_variables`.

On the first deployment a one-shot `db-init` job runs against Cloud SQL via the Auth Proxy and idempotently:

1. creates the `directus` database user with the generated password,
2. creates the `directus` database,
3. installs the `uuid-ossp` extension (required for Directus internal IDs),
4. attempts to install the `postgis` extension for geospatial support (non-fatal if unavailable),
5. grants full privileges to the application user.

The job runs on every apply (`execute_on_apply = true`) and is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=directus --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Directus_Common` establishes the baseline Directus environment so the application comes up correctly on first boot:

- **Bootstrap on first start** — `BOOTSTRAP = "true"` seeds the initial admin user and Directus system collections. The admin email defaults to `admin@example.com`. **Override this via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` before the first deploy.**
- **Migrations on every start** — `AUTO_MIGRATE = "true"` causes Directus to run `database migrate:latest` on each container start, so upgrading `application_version` applies schema changes automatically.
- **GCS file storage** — `STORAGE_LOCATIONS = "gcs"` and `STORAGE_GCS_DRIVER = "gcs"` are injected automatically. The GCS bucket name is derived from the deployment's resource prefix and set in `STORAGE_GCS_BUCKET`. All asset uploads go to this bucket.
- **Redis connection** — when Redis is enabled, the Redis URL is built from `redis_host`, `redis_port`, and `redis_auth` and stored as the `REDIS` secret. When no explicit host is configured and NFS is enabled, the NFS host IP (resolved at runtime from the `NFS_SERVER_IP` environment variable) is substituted as the Redis host. This means Redis is co-located on the same node as the NFS mount by default.
- **Database client** — `DB_CLIENT = "pg"` is injected; `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, and `DB_PASSWORD` are all provided by the foundation layer. The `docker-entrypoint.sh` maps the foundation's `DB_NAME` to `DB_DATABASE` so Directus receives the correct variable name.

---

## 5. Health probe behaviour

The default probes target Directus's `/server/health` endpoint, which returns HTTP 200 only when Directus has completed database migrations and is accepting API requests:

| Probe | Type | Path | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/server/health` | 30 s (CR) / 10 s × 10 (GKE) | 30 s | 10 |
| Liveness | HTTP | `/server/health` | 15 s | 30 s | 3 |

The startup probe allows up to 300–330 seconds to accommodate first-boot database setup and extension installation, which can be slow on a fresh Cloud SQL instance.

Unlike Mautic, Directus responds with HTTP 200 directly — no redirect — so the same HTTP probe works on both Cloud Run and GKE without modification.

---

## 6. Object storage

A dedicated **Cloud Storage** uploads bucket is declared here and provisioned by the foundation, which also grants the workload service account storage access. Combined with the shared Filestore (NFS) volume, this gives Directus durable, multi-replica file storage. Directus is configured to use GCS as its primary storage driver, so uploaded media is written to the bucket rather than the container filesystem.

List and inspect the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<uploads-bucket>/
```

The bucket name is in the `storage_buckets` output of the platform deployment.

---

For the Directus-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Directus_GKE](Directus_GKE.md)** and **[Directus_CloudRun](Directus_CloudRun.md)**.
