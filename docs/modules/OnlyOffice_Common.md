---
title: "OnlyOffice Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the OnlyOffice module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# OnlyOffice Common — Shared Application Configuration

`OnlyOffice_Common` is the **shared application layer** for the ONLYOFFICE Document
Server. It is not deployed on its own; instead it supplies the ONLYOFFICE-specific
configuration that both [OnlyOffice_GKE](OnlyOffice_GKE.md) and
[OnlyOffice_CloudRun](OnlyOffice_CloudRun.md) build on, so the two platform variants
behave identically where it matters. End users never configure this layer directly —
it has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs the Document Server, see the
platform guides ([OnlyOffice_GKE](OnlyOffice_GKE.md),
[OnlyOffice_CloudRun](OnlyOffice_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by OnlyOffice_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates a 48-character `JWT_SECRET` and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Builds a thin wrapper **FROM `onlyoffice/documentserver`** with a cloud entrypoint; the upstream image is mirrored into Artifact Registry, then rebuilt via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the supported engine (Document Server supports PostgreSQL 12+; MySQL is not supported) | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Cache | Requires an **external Redis** (`REDIS_SERVER_HOST`) for shared editing/session state; the bundled RabbitMQ stays internal on localhost | §Redis in the platform guides |
| Object storage | Declares one **Cloud Storage** bucket (`storage` suffix) | `storage_buckets` output |
| Core settings | Sets the baseline Document Server environment: JWT signing, database type, WOPI disabled | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probe targeting `/healthcheck` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text and must never be changed after the first deployment:

- **`JWT_SECRET`** — a 48-character random string (no special characters). ONLYOFFICE
  Document Server signs every internal API request between its own components with
  this secret (`JWT_ENABLED = "true"`), and any host application that embeds the
  editor (Nextcloud, ownCloud, Confluence, SharePoint, a custom integration) must be
  configured with the **same** secret. Generating it once and pinning it in Secret
  Manager keeps it stable across restarts, redeploys, and every running instance
  (mirrors the Chatwoot `SECRET_KEY_BASE` pattern). Rotating it after integrations are
  configured breaks the trust between the Document Server and every host application
  until they are all updated with the new value.

The secret is named `secret-<resource-prefix>-onlyoffice-jwt-secret`. Retrieve it
after deployment:

```bash
# List the JWT secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"

# Read the secret value (needed to configure the host application that embeds the editor):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

The Document Server requires **PostgreSQL** (12 or newer); the module fixes
`database_type = POSTGRES_15`. MySQL and other engines are not supported and are
rejected by a plan-time validation guard. On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Resolves the Cloud SQL host — the Auth Proxy Unix-socket directory (Cloud Run) or
   the proxy sidecar on `127.0.0.1` (GKE), falling back to the instance private IP,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with `LOGIN CREATEDB` and the generated
   password,
4. Creates the application database (owned by `postgres`, since Cloud SQL's superuser
   cannot `SET ROLE` to application roles),
5. Grants full privileges on the database and the `public` schema to the app user,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully so the Job pod completes.

The job **only provisions the role, database, and grants** — the Document Server
installs its own schema (all tables) on first boot, so no migration step is run here.
The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

`onlyoffice/documentserver` is a heavy, "batteries-included" Ubuntu image that bundles
PostgreSQL, Redis, RabbitMQ (AMQP), and nginx under `supervisord`. This module builds
a thin wrapper on top of it and points the Document Server at **external** PostgreSQL
and Redis, leaving only RabbitMQ internal on localhost:

- **Base image** — `FROM onlyoffice/documentserver:<pinned>`. Because the Foundation
  injects `APP_VERSION` into the build args and wins the merge, the Dockerfile derives
  its base tag from an app-specific `ONLYOFFICE_VERSION` build arg instead — an
  `application_version` of `latest` is pinned to `8.3.3` at build time so the base tag
  always resolves.
- **Mirrored + rebuilt** — the upstream Docker Hub image is mirrored into Artifact
  Registry (`enable_image_mirroring = true`) and then rebuilt via Cloud Build as the
  wrapper (`image_source = "custom"`).
- **`cloud-entrypoint.sh`** runs before the upstream launcher and maps the
  Foundation-injected variables onto Document Server's own convention:
  - `DB_PWD` is set from `DB_PASSWORD`, and `DB_TYPE` is forced to `postgres`
    (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` already match by name); `DB_HOST` accepts
    the Cloud SQL socket directory directly, or falls back to `DB_IP`.
  - `REDIS_SERVER_HOST` / `REDIS_SERVER_PORT` (and `REDIS_SERVER_PASS`) are set from the
    injected `REDIS_HOST` / `REDIS_PORT` / `REDIS_AUTH`.
  - It then `exec`s the upstream launcher `/app/ds/run-document-server.sh`, which
    installs the schema on first boot and starts nginx / docservice / converter under
    `supervisord`.

The image is Ubuntu-based and ships `bash`, so a `#!/bin/bash` entrypoint execs
cleanly (no busybox graft is needed).

---

## 5. Core application settings

`OnlyOffice_Common` establishes the baseline Document Server environment so the
application comes up correctly on first boot:

- **Database type** — `DB_TYPE = "postgres"`.
- **JWT signing** — `JWT_ENABLED = "true"`, `JWT_HEADER = "Authorization"`,
  `JWT_IN_BODY = "true"`; the secret itself (`JWT_SECRET`) is injected from Secret
  Manager. This signs all internal API calls and is the same token the host
  application must present.
- **WOPI** — `WOPI_ENABLED = "false"` (the WOPI protocol is off on a bare deploy;
  enable it via `environment_variables` only when integrating with a WOPI host such as
  SharePoint).
- **Port** — the container listens on **port 80** (nginx inside the image).

Operators can layer additional settings through the platform `environment_variables`
input; they are merged on top of these defaults.

---

## 6. Health probe behaviour

The default probes target **`/healthcheck`** — the Document Server endpoint that
returns `true` only once nginx and the document services are up and the database is
reachable. Because the image is heavy (bundled Postgres/Redis/RabbitMQ/nginx under
`supervisord`) and slow to become ready, the startup budget is deliberately generous:

- **Startup probe** — HTTP `/healthcheck`, 90-second initial delay, 15-second period,
  40 failures allowed (≈10 minutes of first-boot headroom for schema installation).
- **Liveness probe** — HTTP `/healthcheck`, 120-second initial delay, 30-second period.
- **Readiness probe** — HTTP `/healthcheck`, 30-second initial delay, 10-second period.

Pointing a probe at any path that is not publicly reachable would keep the
revision/pod from ever becoming Ready even after the app booted — `/healthcheck` is
served unauthenticated and is the correct target.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (declared with the `storage` name suffix) is
declared here and provisioned by the foundation, which also grants the workload
service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

On GKE the Document Server's own data directory is additionally backed by a block PVC
and a shared NFS mount — see [OnlyOffice_GKE](OnlyOffice_GKE.md) for the persistence
model.

---

For the ONLYOFFICE-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[OnlyOffice_GKE](OnlyOffice_GKE.md)** and
**[OnlyOffice_CloudRun](OnlyOffice_CloudRun.md)**.
