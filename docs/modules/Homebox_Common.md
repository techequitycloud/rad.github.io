---
title: "Homebox Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Homebox module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Homebox Common — Shared Application Configuration

`Homebox_Common` is the **shared application layer** for Homebox. It is not
deployed on its own; instead it supplies the Homebox-specific configuration
that both [Homebox_GKE](Homebox_GKE.md) and [Homebox_CloudRun](Homebox_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI inputs
of its own — but understanding what it provides explains the defaults you see
in the platform docs.

For the infrastructure that actually provisions and runs Homebox, see the
platform guides ([Homebox_GKE](Homebox_GKE.md), [Homebox_CloudRun](Homebox_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Homebox_Common | Where it surfaces |
|---|---|---|
| Container image | References the official `ghcr.io/sysadminsmedia/homebox` image directly — no custom build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15**; sets `HBOX_DATABASE_DRIVER=postgres` explicitly | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares a `data` GCS bucket (item photos/attachments) — not auto-mounted | `storage_buckets` output |
| Health checks | Supplies the default startup/liveness probe targeting `/api/v1/status` | §Observability in the platform guides |
| Secrets | Generates `HBOX_AUTH_API_KEY_PEPPER`, a real secret Homebox uses to pepper API-key hashing | `secret_ids` output |

---

## 2. No default admin credential — open self-registration

`Homebox_Common` generates **no admin-credential secret**. Unlike some apps
in this catalogue that hardcode a well-known credential, Homebox uses open
self-registration: **the first person to submit the "Register" form on a
fresh instance becomes the initial admin user.** There is nothing for this
module to generate or inject to seed an account.

This is a meaningful, positive contrast — there is no default-credential
security risk on a fresh Homebox deployment. The practical risk instead is
timing: on a publicly reachable instance, whoever registers *first* becomes
the admin. Operators should **complete registration immediately after first
deploy**, then set `HBOX_OPTIONS_ALLOW_REGISTRATION=false` (via the
Application Module's `environment_variables`) to close public signups. See
the platform guides' *Configuration Pitfalls* section for this called out as
a risk item.

The database password and the `HBOX_AUTH_API_KEY_PEPPER` secret are
generated and managed by this module and the foundation respectively — see
[App_Common](App_Common.md) for the shared secret and Workload Identity
model used elsewhere in the catalogue.

---

## 3. Database engine and bootstrap

Homebox requires **PostgreSQL**; the engine is fixed and
`HBOX_DATABASE_DRIVER=postgres` is set explicitly (Homebox defaults to
embedded SQLite otherwise, whose default DSN forces `journal_mode=WAL` —
unsafe over NFS/gcsfuse, the same risk class as Karakeep/UptimeKuma in this
catalogue). On first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and maps it for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with the generated password,
4. Creates (or reconfigures) the application database with that role as owner,
5. Grants full privileges on the database,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

Homebox's Ent ORM then applies its own internal migrations automatically on
every startup — no separate migration job runs at the platform layer.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Discrete Postgres env vars, not a DSN

Homebox reads **discrete** environment variables rather than a combined
connection URL:

| Homebox env var | Aliased from (platform standard) |
|---|---|
| `HBOX_DATABASE_HOST` | `DB_HOST` |
| `HBOX_DATABASE_USERNAME` | `DB_USER` |
| `HBOX_DATABASE_PASSWORD` | `DB_PASSWORD` |
| `HBOX_DATABASE_DATABASE` | `DB_NAME` |
| `HBOX_DATABASE_PORT` | `DB_PORT` |

This aliasing is configured via the Foundation's `db_host_env_var_name` /
`db_user_env_var_name` / `db_password_env_var_name` / `db_name_env_var_name` /
`db_port_env_var_name` variables, set at the **Application Module** level
(`Homebox_CloudRun`/`Homebox_GKE`), not by this Common layer. Because these
are plain key=value fields (not a URL), **no URL-encoding is needed** for
special characters in the password, and **no custom entrypoint script** is
required — a meaningful simplification compared to apps that construct a DSN
string.

---

## 5. Container image

`Homebox_Common` sets `container_image = "ghcr.io/sysadminsmedia/homebox"` and
`image_source = "prebuilt"` directly — no Dockerfile, no Cloud Build step.
Homebox publishes a genuine `latest` tag (unlike several apps in this catalogue
that require remapping `"latest"` to a pinned fallback), so `application_version`
passes straight through as the image tag.

---

## 6. Health probe behaviour

The default probes target `/api/v1/status` — Homebox's real, unauthenticated
status endpoint, confirmed from the official Dockerfile's own `HEALTHCHECK`
instruction (`wget ... http://localhost:7745/api/v1/status`).

- **Cloud Run and GKE** both use an HTTP probe targeting `/api/v1/status` with
  a 30-second initial delay and a generous failure threshold (30 for startup).

---

## 7. Object storage

A `data` GCS bucket is declared here and provisioned by the foundation, for
item photo and attachment storage — but it is **not** automatically mounted
into the container. Operators who need uploaded item photos and attachments
to persist across revisions/restarts must add a `gcs_volumes` entry (at the
Application Module level) mounted at Homebox's `/data` path. Because photo
attachments are core to a home-inventory app's value — more so than in
catalogue apps where images are an optional extra — plan to wire this before
onboarding real inventory. Item *metadata* (names, locations, quantities) is
unaffected either way — it's stored in PostgreSQL.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
```

---

## 8. Secrets

`Homebox_Common` generates one real, always-on secret:

| Secret | Purpose |
|---|---|
| `HBOX_AUTH_API_KEY_PEPPER` | A 32-character random value that peppers Homebox's API-key hashing. Genuinely read by the app at runtime. |

Unlike some Common modules in this catalogue that generate a secret an
upstream app later ignores, this one is real and load-bearing — it is
injected as a secret environment variable and consumed directly by Homebox.

---

For the Homebox-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Homebox_GKE](Homebox_GKE.md)** and
**[Homebox_CloudRun](Homebox_CloudRun.md)**.
