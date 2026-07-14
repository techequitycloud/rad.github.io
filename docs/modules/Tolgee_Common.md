---
title: "Tolgee Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Tolgee module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Tolgee Common — Shared Application Configuration

`Tolgee_Common` is the **shared application layer** for Tolgee. It is not deployed on
its own; instead it supplies the Tolgee-specific configuration that both
[Tolgee_GKE](Tolgee_GKE.md) and [Tolgee_CloudRun](Tolgee_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Tolgee, see the platform
guides ([Tolgee_GKE](Tolgee_GKE.md), [Tolgee_CloudRun](Tolgee_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Tolgee_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates the initial admin password (24-char) and the JWT signing secret (64-char) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Builds a thin custom wrapper `FROM tolgee/tolgee:<version>` with a cloud entrypoint; built via Cloud Build and mirrored into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Relies on the foundation's `create-db-and-user.sh` (no separate init job); Tolgee auto-migrates its schema with Liquibase on first boot | §Database in the platform guides |
| Object storage | Declares a **Cloud Storage** bucket for optional file storage (screenshots/imports) | `storage_buckets` output |
| Core settings | Sets `SERVER_PORT`, the initial admin username, native auth, and disables Tolgee's embedded PostgreSQL | Application behaviour in the platform guides |
| Health checks | Supplies the default readiness/startup/liveness probes targeting `/actuator/health` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text:

- **`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`** — a 24-character random password for the
  instance owner (`admin` account) that Tolgee creates on first boot from
  `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` / `_PASSWORD`. Retrieve it to log in for the
  first time. The secret ID is
  `secret-<resource-prefix>-<application_name>-admin-password`.
- **`TOLGEE_AUTHENTICATION_JWT_SECRET`** — a 64-character random string used to sign all
  user session tokens (Tolgee requires at least 32 characters). It is kept **stable**
  across restarts and instances so issued tokens remain valid. Rotating it after first
  boot immediately invalidates every active session, forcing all users to log in again.
  The secret ID is `secret-<resource-prefix>-<application_name>-jwt-secret`.

Both secrets are surfaced via the `secret_ids` output that each platform variant wires
into the container as `module_secret_env_vars`. Retrieve them after deployment:

```bash
# List Tolgee secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"

# Read the initial admin password:
gcloud secrets versions access latest \
  --secret="secret-<resource-prefix>-<app>-admin-password" --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its secret
name is reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Tolgee requires **PostgreSQL 15**; the engine is fixed (`database_type = "POSTGRES_15"`)
and MySQL or other engines are not supported. Unlike most application modules, Tolgee
does **not** ship a default `db-init` job. The App_CloudRun / App_GKE foundation's own
`create-db-and-user.sh` step already:

1. Creates the PostgreSQL role and database under the tenant-scoped `DB_USER` / `DB_NAME`,
2. Sets the database owner to the app role (making it a member of `pg_database_owner`,
   which owns the `public` schema on Postgres 15+),
3. Runs `GRANT ALL ON SCHEMA public TO <app_user>`.

That fully prepares the database, so Tolgee's own **Liquibase** migrations create and
evolve the entire schema automatically on first boot — there is no separate migration
job to run. (A standalone `scripts/db-init.sh` is present for reference/manual use but
is not wired into `initialization_jobs` by default.)

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

Tolgee is a **Spring Boot (Java)** application. The module builds a **thin custom
wrapper** `FROM tolgee/tolgee:<version>` (via Cloud Build; `enable_image_mirroring = true`
mirrors the base into Artifact Registry). The wrapper drops in a POSIX-`sh` cloud
entrypoint (`entrypoint.sh`) that runs before Tolgee's own `/app/cmd.sh` launcher:

- **Assembles `SPRING_DATASOURCE_URL` over TCP.** Tolgee's bundled PostgreSQL JDBC driver
  **cannot** connect over a Cloud SQL Unix socket (the same constraint as Keycloak), so
  the entrypoint always builds a JDBC TCP URL from the Foundation-injected `DB_*` vars:
  - `DB_HOST` is a `/…` socket directory → falls back to `DB_IP` (the Cloud SQL private
    IP) with `sslmode=require`.
  - `DB_HOST` is `127.0.0.1` / `localhost` (GKE Auth Proxy loopback) → plain TCP, no SSL
    (the proxy terminates TLS).
  - otherwise (a private IP) → TCP with `sslmode=require` (Cloud SQL rejects unencrypted
    private-IP TCP).
- **Sets credentials discretely** — `SPRING_DATASOURCE_USERNAME` / `_PASSWORD` from
  `DB_USER` / `DB_PASSWORD`, so no URL-encoding is needed.
- **Exports `SERVER_PORT`** — Tolgee reads `SERVER_PORT` (Cloud Run reserves `PORT` and
  rejects a user-supplied value), so the entrypoint sets `SERVER_PORT=8080`.
- **Disables embedded PostgreSQL** — `TOLGEE_POSTGRES_AUTOSTART_ENABLED=false` forces
  Tolgee to use the external Cloud SQL instance rather than its bundled database.
- **Hands off with `exec`** — after preparing the environment it `exec`s the image's own
  `/app/cmd.sh` launcher verbatim as PID 1.

Because the entrypoint and Dockerfile are baked into the custom image, changing them
requires an image rebuild + redeploy.

---

## 5. Core application settings

`Tolgee_Common` establishes the baseline Tolgee environment so the application comes up
correctly on first boot:

- **Port** — `SERVER_PORT = "8080"` (Tolgee's Spring Boot HTTP listener).
- **Embedded DB** — `TOLGEE_POSTGRES_AUTOSTART_ENABLED = "false"` (use external Cloud SQL).
- **Initial owner** — `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (default
  `admin@techequity.cloud`); the matching password is injected from Secret Manager.
- **Auth** — `TOLGEE_AUTHENTICATION_ENABLED = "true"` enables native email/password auth;
  operators can enable additional providers (Google/OAuth2/SSO) post-deploy.

No Redis is configured — Tolgee stores all translation state in PostgreSQL.

---

## 6. Health probe behaviour

The default probes target **`/actuator/health`** — Tolgee's Spring Boot Actuator endpoint,
which returns an unauthenticated `200` only once Liquibase migrations complete and the
app is fully initialised. A generous startup window (60-second initial delay, up to 30
failures at a 15-second period) accommodates first-boot schema migrations on a fresh
Cloud SQL instance.

---

## 7. Object storage

A single **Cloud Storage** bucket (`name_suffix = "storage"`) is declared here and
provisioned by the foundation, with the workload service account granted access. Tolgee
keeps translations and metadata in PostgreSQL; this bucket is for **optional** file
storage (uploaded screenshots, import artifacts) — mount it via `gcs_volumes` or point
Tolgee's S3-compatible file storage at it. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Tolgee-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guides:
**[Tolgee_GKE](Tolgee_GKE.md)** and **[Tolgee_CloudRun](Tolgee_CloudRun.md)**.
