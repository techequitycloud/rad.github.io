---
title: "Vaultwarden Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Vaultwarden module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Vaultwarden Common — Shared Application Configuration

`Vaultwarden_Common` is the **shared application layer** for Vaultwarden. It is not
deployed on its own; instead it supplies the Vaultwarden-specific configuration that
both [Vaultwarden_GKE](Vaultwarden_GKE.md) and
[Vaultwarden_CloudRun](Vaultwarden_CloudRun.md) build on, so the two platform variants
behave identically where it matters. End users never configure this layer directly —
it has no deployment UI inputs of its own — but understanding what it provides explains
the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Vaultwarden, see the platform
guides ([Vaultwarden_GKE](Vaultwarden_GKE.md),
[Vaultwarden_CloudRun](Vaultwarden_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Vaultwarden_Common | Where it surfaces |
|---|---|---|
| Container image | Pins `vaultwarden/server` and the Dockerfile that wraps it; builds a custom image via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Detects whether the selected engine is PostgreSQL or MySQL and selects the correct `db-init` job image accordingly | `initialization_jobs` output |
| Database bootstrap | Defines the first-deploy job that creates the database, user, and grants — idempotent, supports both PostgreSQL 15 and MySQL 8.0 | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `vaultwarden-attachments` bucket | `storage_buckets` output |
| Core settings | Passes container port, resource limits, instance counts, and environment variables through to the foundation | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/alive` | Observability in the platform guides |
| No application secrets | Creates no Secret Manager secrets — Vaultwarden manages its own admin token and RSA keys within the `/data` volume | Noted in the Security section of the platform guides |

---

## 2. Database engine detection and bootstrap

`Vaultwarden_Common` supports **both PostgreSQL 15 (default) and MySQL 8.0**. The
engine is detected from the `database_type` variable passed by the platform module:

| `database_type` | Init job image | DB URL scheme |
|---|---|---|
| `POSTGRES_15` (or any non-MySQL value) | `postgres:15-alpine` | `postgresql://` |
| `MYSQL_8_0` (or any value starting with `MYSQL`) | `mysql:8.0-debian` | `mysql://` |

On the first deployment the `db-init` job runs automatically and idempotently:

1. Creates the Vaultwarden database (if absent).
2. Creates the application user with the generated password.
3. Grants the user full privileges on that database.

The job posts to `localhost:9091/quitquitquit` to shut down the Cloud SQL Auth Proxy
sidecar cleanly after completing. Inspect the database directly with:

```bash
# For PostgreSQL:
gcloud sql connect <instance-name> --user=vaultwarden --project "$PROJECT"

# For MySQL:
gcloud sql connect <instance-name> --user=vaultwarden --database-version=MYSQL \
  --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 3. Container image

`Vaultwarden_Common` builds a custom wrapper image from the `Dockerfile` in its
`scripts/` directory, using `vaultwarden/server:<version>` as the base. The build
runs via Cloud Build and the resulting image is stored in Artifact Registry.

The `application_version` variable (default `1.32.7`) is passed as a Docker build arg
(`APP_VERSION`) so upgrading Vaultwarden is a one-variable change.

Inspect the deployed image:

```bash
gcloud artifacts docker images list <registry-region>-docker.pkg.dev/<project>/<repo> \
  --project "$PROJECT"
```

---

## 4. Core application settings

`Vaultwarden_Common` assembles the container configuration so the application comes
up correctly on first boot. The platform-specific wrapper then merges in a small set
of additional environment variables before passing the full config to the foundation:

| Variable injected by the wrapper | Value | Purpose |
|---|---|---|
| `ROCKET_PORT` | `container_port` (default `80`) | Vaultwarden's Rocket HTTP listen port |
| `SIGNUPS_ALLOWED` | `signups_allowed` (default `false`) | Registration control |
| `WEB_VAULT_ENABLED` | `web_vault_enabled` (default `true`) | Web UI toggle |
| `DATA_FOLDER` | `/data` | Vaultwarden data directory |
| `DOMAIN` | `domain` variable (only if non-empty) | Public URL for WebAuthn, TOTP, and email links |

Default environment variables included in `Vaultwarden_Common`'s pass-through:

| Variable | Default | Purpose |
|---|---|---|
| `LOG_LEVEL` | `warn` | Log verbosity |
| `SHOW_PASSWORD_HINT` | `false` | Disable password hints in production |
| `SMTP_HOST` | `""` | SMTP server (empty = email disabled) |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_FROM` | `vaultwarden@example.com` | Sender address |
| `SMTP_SSL` | `true` | Enable STARTTLS |

**No admin token is auto-generated.** The `/admin` panel at `/admin` is disabled by
default. Provide `ADMIN_TOKEN` via `environment_variables` in the platform module to
enable it. Use a strong random value (e.g. `openssl rand -base64 48`).

---

## 5. Health probe behaviour

Both the startup and liveness probes target `/alive` — Vaultwarden's dedicated
lightweight health endpoint that returns `OK` when the server is running. Vaultwarden
starts in seconds as a compiled Rust binary, so probes use a short 30 s initial delay.

| Probe | Path | Initial delay | Timeout | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | `/alive` | 30 s | 5 s | 10 s | 6 |
| Liveness | `/alive` | 30 s | 5 s | 30 s | 3 |

Both the GKE and Cloud Run variants use HTTP probes for `/alive`. Unlike some PHP or
Java applications, Vaultwarden does not redirect HTTP health traffic, so no TCP probe
workaround is required.

---

## 6. Object storage

A **Cloud Storage** bucket suffixed `vaultwarden-attachments` is declared here and
provisioned by the foundation, which also grants the workload service account access.
This bucket is intended for Vaultwarden attachment files when using GCS-backed
storage. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

No application-level Secret Manager secrets are created here. The database password
is generated and managed by the foundation; its secret name is reported in the
platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

For the Vaultwarden-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Vaultwarden_GKE](Vaultwarden_GKE.md)** and
**[Vaultwarden_CloudRun](Vaultwarden_CloudRun.md)**.
