---
title: "Mealie Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Mealie module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Mealie Common — Shared Application Configuration

`Mealie_Common` is the **shared application layer** for Mealie. It is not
deployed on its own; instead it supplies the Mealie-specific configuration
that both [Mealie_GKE](Mealie_GKE.md) and [Mealie_CloudRun](Mealie_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI inputs
of its own — but understanding what it provides explains the defaults you see
in the platform docs.

For the infrastructure that actually provisions and runs Mealie, see the
platform guides ([Mealie_GKE](Mealie_GKE.md), [Mealie_CloudRun](Mealie_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Mealie_Common | Where it surfaces |
|---|---|---|
| Container image | References the official `ghcr.io/mealie-recipes/mealie` image directly — no custom build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15**; sets `DB_ENGINE=postgres` explicitly | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares a `data` GCS bucket (recipe images) — not auto-mounted | `storage_buckets` output |
| Health checks | Supplies the default startup/liveness probe targeting `/api/app/about` | §Observability in the platform guides |

---

## 2. No app-specific secrets — and the fixed initial admin credential

`Mealie_Common` generates no Secret Manager secrets of its own. Mealie has
**no environment-configurable initial admin credential**: as of Mealie v3.x,
the settings that used to be overridable (`DEFAULT_EMAIL`/`DEFAULT_PASSWORD`)
are now underscore-prefixed, private pydantic-settings fields
(`_DEFAULT_EMAIL`/`_DEFAULT_PASSWORD`) with no environment binding at all —
upstream's own source docstring states "it should no longer be set by end
users." An earlier revision of this module generated and injected a
`DEFAULT_PASSWORD` secret expecting it to seed the admin account; verified
live that Mealie silently ignores it, so that mechanism was removed.

**Every fresh Mealie deployment always bootstraps the same well-known
initial account: `changeme@example.com` / `MyPassword`.** Mealie forces a
password reset on first login, which is the actual security boundary —
operators **must log in immediately after first deploy and change both the
password and (recommended) the admin email**, since the initial credential
is publicly documented upstream, not a generated secret. See the platform
guides' *Configuration Pitfalls* section for this called out as a Critical
risk item.

The database password is generated and managed separately by the foundation.
See [App_Common](App_Common.md) for the shared secret and Workload Identity
model used elsewhere in the catalogue.

---

## 3. Database engine and bootstrap

Mealie requires **PostgreSQL**; the engine is fixed and `DB_ENGINE=postgres` is
set explicitly (Mealie defaults to embedded SQLite otherwise). On first
deployment a one-shot job (`db-init`) runs using `postgres:15-alpine` and
idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and maps it for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with the generated password,
4. Creates (or reconfigures) the application database with that role as owner,
5. Grants full privileges on the database,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

Mealie then applies its own internal migrations automatically on every
startup — no separate migration job runs at the platform layer.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Discrete Postgres env vars, not a DSN

Unlike many Go/GORM apps in this catalogue, Mealie reads **discrete**
environment variables rather than a combined connection URL or a
key=value GORM string:

| Mealie env var | Aliased from (platform standard) |
|---|---|
| `POSTGRES_SERVER` | `DB_HOST` |
| `POSTGRES_USER` | `DB_USER` |
| `POSTGRES_PASSWORD` | `DB_PASSWORD` |
| `POSTGRES_DB` | `DB_NAME` |
| `POSTGRES_PORT` | `DB_PORT` |

This aliasing is configured via the Foundation's `db_host_env_var_name` /
`db_user_env_var_name` / `db_password_env_var_name` / `db_name_env_var_name` /
`db_port_env_var_name` variables, set at the **Application Module** level
(`Mealie_CloudRun`/`Mealie_GKE`), not by this Common layer. Because these are
plain key=value fields (not a URL), **no URL-encoding is needed** for special
characters in the password, and **no custom entrypoint script** is required —
a meaningful simplification compared to apps that construct a DSN string.

---

## 5. Container image

`Mealie_Common` sets `container_image = "ghcr.io/mealie-recipes/mealie"` and
`image_source = "prebuilt"` directly — no Dockerfile, no Cloud Build step.
Mealie publishes a genuine `latest` tag (unlike several apps in this catalogue
that require remapping `"latest"` to a pinned fallback), so `application_version`
passes straight through as the image tag.

---

## 6. Health probe behaviour

The default probes target `/api/app/about` — Mealie's real, unauthenticated
info endpoint, which responds only once the server is fully initialised.

- **Cloud Run and GKE** both use an HTTP probe targeting `/api/app/about` with
  a 30-second initial delay and a generous failure threshold (30 for startup).

---

## 7. Object storage

A `data` GCS bucket is declared here and provisioned by the foundation, for
recipe image storage — but it is **not** automatically mounted into the
container. Operators who need uploaded recipe images to persist across
revisions/restarts must add a `gcs_volumes` entry (at the Application Module
level) mounted at Mealie's `/app/data` path. Recipe *text* data is unaffected
either way — it's stored in PostgreSQL.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
```

---

For the Mealie-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Mealie_GKE](Mealie_GKE.md)** and
**[Mealie_CloudRun](Mealie_CloudRun.md)**.
