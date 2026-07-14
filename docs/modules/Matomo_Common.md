---
title: "Matomo Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Matomo module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Matomo Common — Shared Application Configuration

`Matomo_Common` is the **shared application layer** for Matomo. It is not deployed on its own; instead it supplies the Matomo-specific configuration that both [Matomo_GKE](Matomo_GKE.md) and [Matomo_CloudRun](Matomo_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Matomo, see the platform guides ([Matomo_GKE](Matomo_GKE.md), [Matomo_CloudRun](Matomo_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Matomo_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the **official prebuilt** `matomo` image (`image_source = "prebuilt"`, tag from `application_version`, default `5-apache`) — no custom Dockerfile build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job (`mysql:8.0-debian`) that creates the database and user and verifies connectivity | `initialization_jobs` output |
| Core environment | Sets `MATOMO_DATABASE_ADAPTER = "mysql"` and `MATOMO_DATABASE_TABLES_PREFIX = "matomo_"` | Env vars of the running container |
| Object storage | Declares the **Cloud Storage** `matomo-data` bucket | `storage_buckets` output |
| Secrets | None — `secret_ids` / `secret_values` are intentionally empty; the DB password is Foundation-managed | Secret Manager (Foundation) |
| Health checks | Forwards the variant's startup/liveness probe configuration (Cloud Run defaults: TCP startup with a 20-failure threshold; HTTP `/` liveness with a 300 s initial delay) | §Observability in the platform guides |

---

## 2. Container image — prebuilt, no custom entrypoint

Unlike custom-build applications, `Matomo_Common` deploys the **official `matomo:<version>` Docker Hub image unchanged** (`container_build_config.enabled = false`). There is no Cloud Build step and no custom entrypoint; the Foundation mirrors the image into Artifact Registry before deployment to avoid Docker Hub rate limits.

The official image's own entrypoint handles first-boot setup: it copies the Matomo application from `/usr/src/matomo` into the persistent volume mounted at `/var/www/html` when that volume is empty. Everything Matomo writes afterwards — `config.ini.php`, installed plugins, generated assets — lives on that volume.

The PHP tuning inputs (`php_memory_limit`, `upload_max_filesize`, `post_max_size`) are declared as Docker **build args** and therefore only take effect when a deployment switches to `container_image_source = "custom"`; with the default prebuilt image they are inert.

```bash
# Confirm the deployed image
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
```

---

## 3. Database configuration and environment variables

Matomo reads `MATOMO_DATABASE_*` env vars (via its EnvironmentVariables plugin) to pre-fill the web installer's database screen, so a fresh deployment connects without manual configuration:

| Env var | Source |
|---|---|
| `MATOMO_DATABASE_HOST` | Foundation-injected — the Cloud SQL **private IP** for a TCP connection on Cloud Run (`enable_cloudsql_volume = false`); the proxy loopback on GKE |
| `MATOMO_DATABASE_USERNAME` / `MATOMO_DATABASE_DBNAME` | Foundation-injected deployment-scoped user and database names |
| `MATOMO_DATABASE_PASSWORD` | Foundation-injected Secret Manager reference (`app_secrets`) |
| `MATOMO_DATABASE_ADAPTER` | `mysql` — set here |
| `MATOMO_DATABASE_TABLES_PREFIX` | `matomo_` — set here |

The host/user/name/password mapping is wired in the Application module's `main.tf` via the Foundation's `db_*_env_var_name` mechanism — `Matomo_Common` deliberately does not hard-code them, avoiding a prefix mismatch with the deployment-scoped names.

```bash
# Inspect the injected database env vars on the deployed revision
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format="json(spec.template.spec.containers[0].env)" | grep -i MATOMO_DATABASE
```

---

## 4. Database bootstrap — the `db-init` job

When the calling variant passes no `initialization_jobs`, `Matomo_Common` supplies a default `db-init` job (image `mysql:8.0-debian`, `execute_on_apply = true`, 3 retries) running `scripts/db-init.sh`, which idempotently:

1. Connects as the MySQL root user — preferring the Cloud SQL Auth Proxy **Unix socket** when one is mounted (waiting up to 30 s for it to appear), otherwise falling back to **TCP over the private IP** (`DB_IP`), adding `--get-server-public-key` for MySQL 8's `caching_sha2_password` RSA key exchange on plain TCP.
2. Creates the application user (`CREATE USER IF NOT EXISTS` + `ALTER USER` to converge the password).
3. Creates the database (`CREATE DATABASE IF NOT EXISTS`) and grants the user all privileges on it.
4. **Verifies the app user can connect** — failing the job loudly on a credential/grant problem, and warming the server-side `caching_sha2_password` auth cache so Matomo's PHP client uses the fast auth path.
5. Shuts the Cloud SQL Proxy sidecar down gracefully (`POST /quitquitquit`, SIGKILL fallback) so the job exits cleanly on GKE.

The job creates only the **empty** database — Matomo's web installer performs the schema creation and superuser setup on first browse.

```bash
gcloud run jobs executions list --project "$PROJECT" --region "$REGION" \
  --filter="metadata.name~matomo"
```

---

## 5. Secrets — intentionally none

Matomo requires no application-specific secrets (no auth keys or salts like WordPress). The only secret it consumes — the database password — is generated and managed by the Foundation's `app_secrets` module and injected as `MATOMO_DATABASE_PASSWORD`. `Matomo_Common`'s `secret_ids` and `secret_values` outputs are therefore empty maps, kept only for parity with the Foundation wiring contract.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~matomo"
```

---

## 6. Object storage

A dedicated **Cloud Storage** `matomo-data` bucket (region-located, force-destroy) is declared here and provisioned by the foundation, which also grants the workload service account access. Combined with the Filestore (NFS) volume that persists `/var/www/html`, this gives Matomo durable storage for exports and auxiliary data.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~matomo-data"
```

---

For the Matomo-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides:
**[Matomo_GKE](Matomo_GKE.md)** and **[Matomo_CloudRun](Matomo_CloudRun.md)**.
