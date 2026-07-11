---
title: "Flowise Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Flowise module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Flowise Common — Shared Application Configuration

`Flowise_Common` is the **shared application layer** for Flowise. It is not deployed on
its own; instead it supplies the Flowise-specific configuration that both
[Flowise_GKE](Flowise_GKE.md) and [Flowise_CloudRun](Flowise_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Flowise, see the platform
guides ([Flowise_GKE](Flowise_GKE.md), [Flowise_CloudRun](Flowise_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Flowise_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the Flowise admin password and stores it in **Secret Manager** as `FLOWISE_PASSWORD` | Retrieve via Secret Manager (see below) |
| Container image | Pins the `flowiseai/flowise` base image and the custom Dockerfile that extends it with `flowise-entrypoint.sh` | `container_image` output of the platform deployment |
| Database engine | Defaults to **Cloud SQL for PostgreSQL 15**; sets `DATABASE_TYPE=postgres` and `DATABASE_PORT=5432` | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, and grants privileges using `postgres:15-alpine` | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** uploads bucket (name suffix `-uploads`) | `storage_buckets` output |
| Core settings | Sets the baseline Flowise environment: `FLOWISE_USERNAME`, `APIKEY_STORAGE_TYPE=db`, `STORAGE_TYPE=gcs`, `GCLOUD_PROJECT` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup and liveness probe behaviour targeting `/api/v1/ping` | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

The Flowise administrator password is generated automatically as a 32-character
random string and stored as a Secret Manager secret — it is never set in plain text.
Retrieve it after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~password"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

The secret ID is formatted as `<resource_prefix>-flowise-password`. The database
password is generated and managed separately by the foundation; its secret name is
reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Flowise requires **PostgreSQL**; the default engine is PostgreSQL 15. MySQL is not
supported. On the first deployment a one-shot job connects to Cloud SQL through the
Auth Proxy and idempotently:

1. creates the Flowise database (if absent),
2. creates the application user with the generated password,
3. grants the user full privileges on that database.

The job runs `create-db-and-user.sh` from the module's `scripts/` directory using
the `postgres:15-alpine` image. It is safe to re-run. Inspect the database directly
with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Flowise_Common` establishes the baseline Flowise environment so the application
comes up correctly on first boot:

- **Admin identity** — the initial admin username (configurable as `flowise_username`
  in the platform module, Group 3). The password is auto-generated.
- **Database wiring** — `DATABASE_TYPE=postgres` and `DATABASE_PORT=5432` are
  always injected. The `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME`, and
  `DATABASE_PASSWORD` values are **not** set as static environment variables;
  instead they are mapped at container startup by `flowise-entrypoint.sh` from
  the platform-injected `DB_*` variables. This is required to handle GKE's
  alphabetical env-var ordering, where Kubernetes would not resolve `$(DB_HOST)`
  inside `DATABASE_HOST` if `DATABASE_*` was declared before `DB_*`.
- **GCS file storage** — `STORAGE_TYPE=gcs`, `APIKEY_STORAGE_TYPE=db`, and
  `GCLOUD_PROJECT` are always injected. Flowise writes all user-uploaded files
  to the auto-provisioned GCS bucket whose name is passed in as
  `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Do not override `STORAGE_TYPE` — doing so
  falls back to ephemeral local disk and all uploads are lost on every restart or
  new revision.

---

## 5. Health probe behaviour

The default probes target Flowise's dedicated health endpoint `/api/v1/ping`, which
returns HTTP 200 when the application is ready and connected to the database. A
generous startup budget accommodates first-boot database initialisation:

- **Startup probe** — HTTP GET `/api/v1/ping`, 30-second initial delay, 10-second
  period, 30 failure threshold (= 5-minute total budget).
- **Liveness probe** — HTTP GET `/api/v1/ping`, 15-second initial delay, 30-second
  period, 3 failure threshold.

Both the GKE and Cloud Run variants use HTTP probes for these endpoints. Unlike
some PHP/Apache applications that issue redirects to health-check traffic, Flowise
responds directly on `/api/v1/ping` without redirects, so HTTP probes work on both
platforms.

---

## 6. Object storage

A dedicated **Cloud Storage** uploads bucket (name suffix `-uploads`) is declared
here and provisioned by the foundation, which also grants the workload service
account access. Flowise uses this bucket as its file-storage backend for documents,
images, and other user uploads. The bucket name is automatically injected as
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

The bucket uses `STORAGE_CLASS=STANDARD` in the deployment region, with public
access prevention enforced. Additional buckets can be added through the `storage_buckets`
variable in the platform module.

---

For the Flowise-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Flowise_GKE](Flowise_GKE.md)** and **[Flowise_CloudRun](Flowise_CloudRun.md)**.
