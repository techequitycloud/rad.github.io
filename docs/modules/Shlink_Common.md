---
title: "Shlink Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Shlink module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Shlink Common — Shared Application Configuration

`Shlink_Common` is the **shared application layer** for Shlink. It is not deployed on its own; instead it supplies the Shlink-specific configuration that both [Shlink_CloudRun](Shlink_CloudRun.md) and the GKE variant build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Shlink, see the platform guide ([Shlink_CloudRun](Shlink_CloudRun.md)) and the foundation guides ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Shlink_Common | Where it surfaces |
|---|---|---|
| Initial API key | Generates a random 32-character API key, stores it in Secret Manager, and injects it as `INITIAL_API_KEY` so Shlink bootstraps its first REST API key on first start | `secret_ids` / `secret_values` outputs; §First-run access in the platform guide |
| Container image | Thin Cloud Build wrapper `FROM shlinkio/shlink:stable` — the official entrypoint is preserved unchanged | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`DB_DRIVER = postgres`, `DB_PORT = 5432`) | §Database in the platform guide |
| Database bootstrap | Defines the `db-init` job (`postgres:15-alpine`) that idempotently creates the user and database over the Auth Proxy socket | `initialization_jobs` output |
| Core environment | `IS_HTTPS_ENABLED=true`; deliberately leaves `DB_USER` / `DB_NAME` unset so the foundation's tenant-scoped values win | Application behaviour in the platform guide |
| Object storage | None — Shlink stores all state in PostgreSQL (`storage_buckets = []`) | `storage_buckets` output (empty) |
| Health checks | Startup and liveness probes against `/rest/health` (unauthenticated HTTP 200) | §Observability in the platform guide |

---

## 2. Initial API key secret

Shlink has no admin user accounts — everything is driven through its REST API with an `X-Api-Key` header. `Shlink_Common` generates a random 32-character key, stores it as `secret-<prefix>-shlink-initial-api-key` in Secret Manager, and injects it into the container as the `INITIAL_API_KEY` secret env var. Shlink reads that variable on first start and registers it as its first API key, so the deployment is usable immediately with no manual key-minting step.

Retrieve it after deploy:

```bash
API_SECRET=$(gcloud secrets list --project "$PROJECT" \
  --filter="name~shlink AND name~initial-api-key" --format="value(name)" --limit=1)
API_KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project "$PROJECT")
```

The key name `INITIAL_API_KEY` is single-underscore separated, so it is also a valid Kubernetes Secret data key for the GKE SecretSync path. The database password secret is managed by the foundation, not this layer, and is injected as `DB_PASSWORD` (which Shlink reads directly — no entrypoint remapping needed).

---

## 3. Container image — no custom entrypoint

Shlink's official image reads all of its configuration (`DB_*`, `DEFAULT_DOMAIN`, `IS_HTTPS_ENABLED`, `INITIAL_API_KEY`, …) directly from environment variables and **runs its database migrations automatically on container start**, so `Shlink_Common` uses the image as-is: the Dockerfile is a thin `FROM shlinkio/shlink:stable` wrapper that exists only so the platform's Cloud Build pipeline has something to build, and the image is mirrored into Artifact Registry to avoid Docker Hub rate limits.

The `stable` tag tracks the latest stable Shlink release; pin a specific version by overriding `application_version` (e.g. `4.4.0`) for reproducible builds.

```bash
# Confirm the deployed image
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
```

---

## 4. Database engine and bootstrap

Shlink runs on **PostgreSQL 15** (`database_type = "POSTGRES_15"`). On every apply a one-shot `db-init` job (image `postgres:15-alpine`) connects to Cloud SQL — mapping the Auth Proxy Unix socket to a standard PostgreSQL socket path when present — and idempotently:

1. Creates the application user (or resets its password if it exists).
2. Grants the user's role to `postgres` so database ownership can be assigned.
3. Creates the application database owned by that user (or fixes ownership).
4. Grants all privileges on the database and the `public` schema.
5. Sends a `POST /quitquitquit` shutdown signal to the Cloud SQL Proxy sidecar so the job exits cleanly.

**Tenant-scoped naming:** the foundation creates the real user/database under tenant-scoped names and injects them as `DB_USER` / `DB_NAME`; because Shlink reads those variables directly, `Shlink_Common` deliberately does **not** set them — pre-setting them to the short `shlink` base names would make the app authenticate as a role that is never created (`password authentication failed for user "shlink"`).

Inspect the database directly:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 5. Core environment defaults

- **`DB_DRIVER = postgres`, `DB_PORT = 5432`** — Shlink's native env-var configuration; the socket/host comes from the foundation-injected `DB_HOST`.
- **`IS_HTTPS_ENABLED = true`** — the platform always fronts the service with HTTPS (`run.app` URL, load balancer, or Ingress), so Shlink generates `https://` short URLs.
- **`DEFAULT_DOMAIN` intentionally unset** — the public service URL is unknown until after deploy; set it post-deploy (or via `environment_variables`) so generated short URLs carry the right host.
- **Migrations on start** — schema install and upgrades happen automatically on each container start; there is no separate migrate job.

---

## 6. Health probe behaviour

Shlink exposes `/rest/health` — a public, unauthenticated endpoint returning HTTP 200 with `application/health+json` `{"status":"pass"}` once the app is up — so plain HTTP probes work on both platforms (unlike apps whose health endpoints require auth and force a disabled liveness probe).

- **Startup probe** — HTTP `/rest/health`, initial delay 30 s, period 10 s, failure threshold 30 (up to ~300 s for first-boot migrations).
- **Liveness probe** — HTTP `/rest/health`, initial delay 30 s, period 30 s, failure threshold 3.

Note that Shlink has **no web homepage** — `/` returns 404 by design — so never point a probe or uptime check at the root path.

---

## 7. Object storage

None. Shlink keeps all state — short URLs, visits, tags, domains, API keys — in PostgreSQL, so `storage_buckets` is empty and no NFS share or GCS bucket is provisioned. Durability comes from Cloud SQL's automated backups.

---

For the Shlink-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guide:
**[Shlink_CloudRun](Shlink_CloudRun.md)**.
