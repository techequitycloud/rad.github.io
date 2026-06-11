---
title: "Superset Common \u2014 Shared Application Configuration"
---

# Superset Common — Shared Application Configuration

`Superset_Common` is the **shared application layer** for Apache Superset. It is not
deployed on its own; instead it supplies the Superset-specific configuration that both
[Superset_GKE](Superset_GKE.md) and [Superset_CloudRun](Superset_CloudRun.md) build
on, so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Superset, see the platform
guides ([Superset_GKE](Superset_GKE.md), [Superset_CloudRun](Superset_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Superset_Common | Where it surfaces |
|---|---|---|
| Flask secret key | Generates `SUPERSET_SECRET_KEY` (50-char random) and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Pins `apache/superset:latest` and the Cloud Build configuration that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job (database + user creation) and the `app-init` job (schema migration + admin creation) | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** data bucket | `storage_buckets` output |
| Core settings | Sets the baseline Superset container port (8088), resource defaults, and health probe configuration | Application behaviour in the platform guides |
| Health probes | HTTP GET `/health`, startup 60 s delay / 12 failures, liveness 30 s delay / 3 failures | §Observability in the platform guides |

---

## 2. Flask secret key in Secret Manager

The `SUPERSET_SECRET_KEY` is generated automatically and stored as a Secret Manager
secret — it is never set in plain text. Retrieve it after deployment:

```bash
# The secret name includes the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<prefix>-<appname>-key --project "$PROJECT"
```

**Rotation warning.** Changing `SUPERSET_SECRET_KEY` after the first deploy
immediately invalidates all active user sessions and makes every database connection
credential stored in Superset's metadata permanently unreadable. Treat the secret as
immutable after first deploy, or coordinate rotation with a planned maintenance window
and manually re-enter all data source passwords in the Superset UI afterwards.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Superset requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported.
On the first deployment a two-phase initialisation pipeline runs automatically.

**Phase 1 — `db-init`** (uses `postgres:15-alpine`):
- Waits for the Cloud SQL instance to be ready.
- Creates the Superset application user and database idempotently.
- Grants all privileges on the database to the application user.
- Signals the Cloud SQL Auth Proxy sidecar to shut down so the job pod can complete.

**Phase 2 — `app-init`** (uses the Superset application image):
- Depends on `db-init` completing successfully.
- Runs `superset db upgrade` to apply all Flask-AppBuilder and Superset schema
  migrations.
- Runs `superset fab create-admin` to create or update the admin user.
- Runs `superset init` to load default roles and permissions.
- Has a 30-minute timeout to accommodate first-run migrations on complex schemas.

Both jobs are idempotent and safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and Cloud Build configuration

The lean `apache/superset:latest` image does not include PostgreSQL drivers.
`Superset_Common` provides a `Dockerfile` (in `scripts/`) that extends the official
image by installing `psycopg2-binary`, which requires native compilation and must be
baked in at build time. Cloud Build runs this build automatically when
`container_image_source = "custom"` (the default).

The custom image is pushed to Artifact Registry and tagged with the deployment's
`application_version`. Explore it with:

```bash
gcloud artifacts repositories list --project "$PROJECT"
gcloud artifacts docker images list <registry-path> --project "$PROJECT"
```

---

## 5. Core application settings

`Superset_Common` establishes the baseline Superset environment:

- **Container port** — Superset/Gunicorn listens on port **8088**.
- **Resource defaults** — 2 vCPU and 2 GiB memory per container instance. Under 1 GiB,
  Gunicorn workers are OOM-killed during query execution.
- **Database connection** — the application uses the Cloud SQL Auth Proxy Unix socket
  path for all PostgreSQL connections. The socket path is injected via `DB_HOST` at
  runtime.
- **Health probes** — both startup and liveness probes target Superset's `/health`
  endpoint (HTTP GET). The startup probe uses a 60-second initial delay and 12 failure
  thresholds (allowing up to 180 seconds) to accommodate Gunicorn worker pool
  initialisation and first-boot database migrations.

---

## 6. Health probe behaviour

| Probe | Type | Path | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|---|
| Startup | HTTP GET | `/health` | 60 s | 10 s | 12 |
| Liveness | HTTP GET | `/health` | 30 s | 30 s | 3 |

The `/health` endpoint returns HTTP 200 when Superset's Gunicorn worker pool is fully
initialised and connected to PostgreSQL. Both GKE and Cloud Run use HTTP probes —
unlike some PHP applications, Superset does not issue HTTP→HTTPS redirects that would
break HTTP probes.

---

## 7. Object storage

A dedicated **Cloud Storage** data bucket is declared here and provisioned by the
foundation. The workload service account is granted access automatically. This bucket
is used for chart data exports, scheduled report outputs, and any file-based
integrations. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Superset-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Superset_GKE](Superset_GKE.md)** and **[Superset_CloudRun](Superset_CloudRun.md)**.
