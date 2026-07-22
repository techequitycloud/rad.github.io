---
title: "Jellystat Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Jellystat module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Jellystat Common — Shared Application Configuration

`Jellystat_Common` is the **shared application layer** for Jellystat. It is
not deployed on its own; instead it supplies the Jellystat-specific
configuration that both [Jellystat_GKE](Jellystat_GKE.md) and
[Jellystat_CloudRun](Jellystat_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform
docs.

For the infrastructure that actually provisions and runs Jellystat, see the
platform guides ([Jellystat_GKE](Jellystat_GKE.md),
[Jellystat_CloudRun](Jellystat_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Jellystat_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates `JWT_SECRET` (50-char alphanumeric) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | References the official prebuilt `cyfershepard/jellystat` image — no custom build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares a small **Cloud Storage** `backups` bucket | `storage_buckets` output |
| Core settings | Fixes `container_port = 3000` (Jellystat's hardcoded listening port) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/auth/isConfigured` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager:

- **`JWT_SECRET`** — a 50-character random alphanumeric string. Used by
  Jellystat to sign its own session/auth tokens (mirrors the pattern used for
  Django's `SECRET_KEY`). Rotating it invalidates all active user sessions
  (users must log back in) but causes no data loss.

Retrieve the secret after deployment:

```bash
# List secrets for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine, non-standard env vars, and bootstrap

Jellystat requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. Jellystat also reads **non-standard** environment
variable names for its database connection — this is the most important fact
about this module's wiring:

| Standard name (always injected) | Jellystat-specific alias (also injected) |
|---|---|
| `DB_HOST` | `POSTGRES_IP` |
| `DB_PORT` | `POSTGRES_PORT` |
| `DB_USER` | `POSTGRES_USER` |
| `DB_NAME` | `POSTGRES_DATABASE` |
| `DB_PASSWORD` | `POSTGRES_PASSWORD` |

Community-confirmed: `POSTGRES_DB` does **not** work for Jellystat — it must
be `POSTGRES_DATABASE`. The alias mapping is hardcoded directly in each
Application module's `main.tf` (`db_host_env_var_name = "POSTGRES_IP"`, etc.)
rather than exposed as an operator-facing variable, since it is a fixed
characteristic of the application, not something an operator should need to
change.

On the first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (Cloud Run) or the sidecar's
   loopback (GKE) and maps it for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with the generated password,
4. Creates (or reconfigures) the application database with that role as
   owner,
5. Grants full privileges on the database and public schema,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

Unlike the Django clone-source pattern this module was scaffolded from,
**no separate migrate job is defined** — Jellystat applies its own schema
migrations automatically on startup, so a `db-migrate` step would be
redundant.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment
outputs.

---

## 4. Container image

`Jellystat_Common` references the official Docker Hub image directly
(`container_image = "cyfershepard/jellystat"`, `image_source = "prebuilt"`,
`container_build_config.enabled = false`) — no Dockerfile, no custom build,
no entrypoint wrapper. `container_port = 3000` matches Jellystat's own
hardcoded listening port (not configurable via environment variable, per
upstream issue #314).

---

## 5. Core application settings

`Jellystat_Common` establishes the baseline so the application comes up
correctly on first boot:

- **Database type** — `database_type = "POSTGRES_15"` (fixed).
- **Port** — `container_port = 3000` (fixed, matches the app's own hardcoded
  value).
- **No Redis integration.** Jellystat has no native Redis support; the
  `enable_redis`/`redis_host`/`redis_port` variables exist only as inert
  Foundation mirrors on the Application modules.
- **No Jellyfin pairing variable.** There is no environment variable, secret,
  or config field anywhere in this layer for the companion Jellyfin server's
  URL or API key — this pairing is performed entirely through Jellystat's own
  web UI after first boot (see the platform guides' Application Behaviour
  section).

---

## 6. Health probe behaviour

The default probes target `/auth/isConfigured` — a public, unauthenticated
endpoint that returns 200 as soon as the Jellystat server is up, without
requiring a login.

- **Cloud Run** uses HTTP probes targeting `/auth/isConfigured`.
- **GKE** uses HTTP probes targeting `/auth/isConfigured` for both the
  startup and liveness checks.

---

## 7. Object storage

A small, optional **Cloud Storage** `backups` bucket is declared here and
provisioned by the foundation, for Jellystat's own database export/backup
archive feature. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Jellystat-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Jellystat_GKE](Jellystat_GKE.md)** and
**[Jellystat_CloudRun](Jellystat_CloudRun.md)**.
