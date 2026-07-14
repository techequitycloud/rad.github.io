---
title: "Gitea Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Gitea module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Gitea Common — Shared Application Configuration

`Gitea_Common` is the **shared application layer** for Gitea. It is not deployed on its own; instead it supplies the Gitea-specific configuration that both the GKE and [Gitea_CloudRun](Gitea_CloudRun.md) variants build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Gitea, see the platform guide ([Gitea_CloudRun](Gitea_CloudRun.md)) and the foundation guides ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Gitea_Common | Where it surfaces |
|---|---|---|
| Container image | Thin custom build over the official `gitea/gitea:<version>` image (Cloud Build) with a platform entrypoint | `container_image` output of the platform deployment |
| Platform entrypoint | Composes `GITEA__database__{HOST,NAME,USER,SSL_MODE}` from the foundation-injected `DB_*` env vars at container start, then execs Gitea's stock entrypoint | Application behaviour in the platform guide |
| Database engine | Fixes **PostgreSQL** (`GITEA__database__DB_TYPE = "postgres"`) | §Database in the platform guide |
| Database bootstrap | Defines the `db-init` job (`postgres:15-alpine`) that idempotently creates the tenant-prefixed role and database | `initialization_jobs` output |
| Application secrets | Generates `SECRET_KEY` and `INTERNAL_TOKEN` in Secret Manager; reuses the foundation DB password as `GITEA__database__PASSWD` | `secret_ids` output |
| Core env defaults | `INSTALL_LOCK=true`, `DISABLE_REGISTRATION=false`, server domain/root-URL/port, `APP_DATA_PATH` on NFS | Runtime env of the service |
| Health checks | Default startup (`/api/healthz`, 30 s delay) and liveness (`/api/healthz`, 15 s delay) probes | §Observability in the platform guide |

---

## 2. Secrets in Secret Manager

Two Gitea-specific secrets are generated once (64-character random values) and stored in Secret Manager, because both must remain stable across restarts:

- `secret-<prefix>-gitea-secret-key` — Gitea's `SECRET_KEY`, used to encrypt sensitive stored data (2FA secrets, OAuth2 tokens). Rotating it invalidates that encrypted data.
- `secret-<prefix>-gitea-internal-token` — Gitea's `INTERNAL_TOKEN`, authenticating Gitea's own internal API calls.

The database password is **not** created here — it is the foundation-managed `DB_PASSWORD` secret, aliased to the env var `GITEA__database__PASSWD` by the platform variant. A 30-second propagation wait runs after secret creation before dependent resources read them.

On Cloud Run the secrets are injected directly under their `GITEA__security__*` env names. On GKE, the SecretSync CRD forbids consecutive underscores in synced-secret keys, so they are materialised under simple keys (`SECRET_KEY`, `INTERNAL_TOKEN`) and read from CSI-mounted files via Gitea's native `GITEA__section__KEY__FILE` convention.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~gitea"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 3. Container image and platform entrypoint

The image is a **near-stock build**: `FROM gitea/gitea:<application_version>` plus one copied script (`/platform-entrypoint.sh`), built by Cloud Build and pushed to Artifact Registry. The foundation injects `APP_VERSION` as the build arg that selects the upstream tag.

The entrypoint exists because Cloud Run does **not** interpolate `$(VAR)` env references the way Kubernetes does. On every container start it:

1. Resolves the database host from `DB_HOST` (falling back to `DB_IP`, then loopback).
2. Selects the Postgres SSL mode per connection hop — Cloud SQL Auth Proxy Unix socket or proxy loopback → `disable`; direct private-IP TCP → `require` (Cloud SQL rejects unencrypted TCP).
3. Exports `GITEA__database__HOST`, `GITEA__database__NAME`, `GITEA__database__USER`, and `GITEA__database__SSL_MODE` from the injected (tenant-prefixed) `DB_*` values, logging a `Gitea DB wired: …` line.
4. Execs Gitea's stock `/usr/bin/entrypoint`, which writes all `GITEA__*` env vars into `app.ini` and launches the server under s6.

```bash
# Confirm the DB wiring the entrypoint chose
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep "Gitea DB wired"
```

---

## 4. Database initialization

The default `db-init` job (image `postgres:15-alpine`, `execute_on_apply = true`, up to 3 retries) runs on every apply and is idempotent:

1. Waits for the Cloud SQL instance to accept connections.
2. Creates the tenant-prefixed application role if absent (or resets its password), grants it `CREATEDB`, and grants it to `postgres`.
3. Creates the Gitea database owned by that role if absent (or fixes ownership), then grants all privileges.

Gitea itself runs its schema migrations automatically on startup, so version upgrades need no manual migration step.

```bash
gcloud run jobs executions list --job=<service-name>-db-init --project "$PROJECT" --region "$REGION"
```

---

## 5. Core environment defaults

- `GITEA__database__DB_TYPE = "postgres"` — the only engine this layer supports.
- `GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL` — from `public_domain` / `public_url` (drive clone URLs; set to the real host in production).
- `GITEA__server__HTTP_PORT = 3000`, `GITEA__server__PROTOCOL = "http"` — TLS terminates at the platform edge.
- `GITEA__security__INSTALL_LOCK = "true"` — the first-run web installer is skipped; configuration is fully env-driven. The first registered user becomes admin.
- `GITEA__service__DISABLE_REGISTRATION = "false"` — self-service sign-up on by default; flip to `true` after creating the admin account on private forges.
- `GITEA__server__APP_DATA_PATH = <nfs_mount_path>` — repositories, LFS objects, and attachments persist on the shared NFS volume.

User-supplied `environment_variables` merge over these defaults, so any `GITEA__<section>__<KEY>` can be overridden per deployment.

---

## 6. Object storage

`Gitea_Common` declares no buckets of its own (`storage_buckets` output is empty) — durable forge data lives on the NFS volume via `APP_DATA_PATH`. The platform variant's foundation still provisions a general-purpose `data` GCS bucket and the automated-backup bucket:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~gitea"
```

---

## 7. Health probe behaviour

Both probes target Gitea's unauthenticated health endpoint `/api/healthz`, which returns HTTP 200 once the server is up:

- **Startup probe** — HTTP `/api/healthz`, initial delay 30 s (the platform variant applies period 20 s, failure threshold 10).
- **Liveness probe** — HTTP `/api/healthz`, initial delay 15 s, period 30 s, failure threshold 3.

Gitea starts quickly (single Go binary), but first boot also runs schema migrations against a freshly created database — the 30-second initial delay accommodates that.

---

For the Gitea-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guide:
**[Gitea_CloudRun](Gitea_CloudRun.md)**.
