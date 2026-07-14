---
title: "AFFiNE Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the AFFiNE module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# AFFiNE Common — Shared Application Configuration

`Affine_Common` is the **shared application layer** for AFFiNE. It is not deployed on its own; instead it supplies the AFFiNE-specific configuration that both [Affine_GKE](Affine_GKE.md) and [Affine_CloudRun](Affine_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs AFFiNE, see the platform guides ([Affine_GKE](Affine_GKE.md), [Affine_CloudRun](Affine_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Affine_Common | Where it surfaces |
|---|---|---|
| Container image | Thin custom build `FROM ghcr.io/toeverything/affine:<tag>` adding a cloud entrypoint | `container_image` output of the platform deployment |
| Cloud entrypoint | Assembles `DATABASE_URL` / `REDIS_SERVER_*` from the Foundation-injected `DB_*` / `REDIS_*` vars and defaults `AFFINE_SERVER_EXTERNAL_URL` | Application behaviour in the platform guides |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | `db-init` (role + database + grants) followed by `affine-migrate` (schema + signing-key generation) | `initialization_jobs` output |
| Secrets | **None by design** — the signing key is persisted in PostgreSQL; `secret_ids` is empty | Only the Foundation DB-password secret exists |
| Object storage | Declares one **Cloud Storage** bucket (suffix `storage`) | `storage_buckets` output |
| Core environment | `NODE_ENV=production`, `AFFINE_SERVER_HOST/PORT`, `AFFINE_CONFIG_PATH`, `AFFINE_INDEXER_ENABLED=false` | Container env of the running service |
| Health checks | Startup (`/`, 60 s delay, 30 failures), liveness (`/`, 60 s delay), readiness (`/`, 30 s delay) | §Observability in the platform guides |

---

## 2. Container image and cloud entrypoint

`Affine_Common` builds a thin wrapper over the upstream `ghcr.io/toeverything/affine` self-host image via Cloud Build. The tag is selected by the app-specific `AFFINE_VERSION` build ARG — not the generic `APP_VERSION`, which the Foundation injects and would override — and `application_version = "latest"` is mapped to `stable` (AFFiNE publishes no `latest` tag). The Dockerfile installs `/usr/local/bin/cloud-entrypoint.sh` and pre-creates `/root/.affine/storage` and `/root/.affine/config`; `CMD` stays the upstream `node ./dist/main.js`.

The entrypoint performs these actions on every container start:

1. **`DATABASE_URL` assembly.** Builds `postgresql://user:pass@host:port/db?sslmode=…` from the Foundation-injected `DB_*` vars, URL-encoding credentials. On Cloud Run, `DB_HOST` is a Cloud SQL socket directory whose colons break URL parsing, so it connects to `DB_IP` (the instance private IP) with `sslmode=require`; on GKE, the proxy loopback `127.0.0.1` gets `sslmode=disable`. A preset `DATABASE_URL` takes precedence.
2. **Redis mapping.** Maps `REDIS_HOST` / `REDIS_PORT` / `REDIS_AUTH` onto AFFiNE's `REDIS_SERVER_HOST` / `REDIS_SERVER_PORT` / `REDIS_SERVER_PASSWORD`.
3. **External URL.** Defaults `AFFINE_SERVER_EXTERNAL_URL` to the platform-injected service URL (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) so invites and share links resolve.
4. **Server launch.** `exec`s the AFFiNE server.

To inspect what the entrypoint resolved:

```bash
# Cloud Run
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep "cloud-entrypoint"

# GKE
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep "cloud-entrypoint"
```

---

## 3. Database engine and bootstrap

AFFiNE requires **PostgreSQL**; the engine is fixed at `POSTGRES_15` inside `Affine_Common` and the platform variants reject MySQL at plan time. Two initialization jobs run on every apply (both idempotent):

1. **`db-init`** (`postgres:15-alpine`, timeout 600 s) — creates the AFFiNE role and database if absent, grants privileges on the database and `public` schema, and best-effort grants `cloudsqlsuperuser` so migrations can `CREATE EXTENSION`.
2. **`affine-migrate`** (the built AFFiNE app image, 2Gi, timeout 1200 s, `max_retries = 3`) — runs AFFiNE's `node ./scripts/self-host-predeploy`: idempotent schema migration **plus signing-key generation**. Runs after `db-init` and before the server starts, so the runtime container never migrates inline.

Both scripts signal the Cloud SQL Auth Proxy sidecar (`POST /quitquitquit`) so GKE Job pods exit cleanly. Inspect the jobs and the database:

```bash
gcloud run jobs executions list --job="<service>-affine-migrate" --project "$PROJECT" --region "$REGION"
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 4. Secrets — intentionally none

`Affine_Common`'s `secret_ids` output is **empty by design**. AFFiNE generates its signing/private key during `self-host-predeploy` and persists it in PostgreSQL, so there is no operator-supplied application secret to create, inject, or rotate. The only secret in a deployment is the **database password**, generated and managed by the Foundation:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~affine"
```

---

## 5. Core application settings

- **Listen address** — `AFFINE_SERVER_HOST = "0.0.0.0"` and `AFFINE_SERVER_PORT = "3010"`. The Cloud Run reserved `PORT` env var is never set explicitly (doing so makes every Cloud Run Job creation fail with HTTP 400).
- **Config path** — `AFFINE_CONFIG_PATH = /root/.affine/config`, the image default, so AFFiNE's built-in config loaders resolve.
- **Indexer disabled** — `AFFINE_INDEXER_ENABLED = "false"`: the full-text indexer requires a pgvector-backed search backend that is not provisioned; the server boots on plain PostgreSQL + Redis. Operators can enable it after wiring a vector DB.
- **Redis is structural** — Yjs document-sync pub/sub and the background job queue run through Redis; the platform variants enforce it at plan time.

---

## 6. Health probe behaviour

The default probes target AFFiNE's root path (`/`), which returns HTTP 200 once the server is ready and requires no authentication.

- **Startup probe** — HTTP `/`, initial delay 60 s, period 15 s, failure threshold 30 (up to 60 + 30 × 15 = 510 s from container start).
- **Liveness probe** — HTTP `/`, initial delay 60 s, period 30 s, failure threshold 3.
- **Readiness probe** — HTTP `/`, initial delay 30 s, period 10 s, failure threshold 3.

Schema migration happens in the `affine-migrate` job rather than inline at boot, so the startup window mostly covers Node.js bundle load and Redis/PostgreSQL connection setup.

---

## 7. Object storage

One **Cloud Storage** bucket (name suffix `storage`, STANDARD class, public access prevention enforced) is declared here and provisioned by the foundation as `gcs-<service-name>-storage`, with workload service-account access granted automatically. Uploaded blobs themselves live on the NFS mount at `/root/.affine/storage`; the bucket serves backups and auxiliary storage.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~affine"
```

---

For the AFFiNE-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides:
**[Affine_GKE](Affine_GKE.md)** and **[Affine_CloudRun](Affine_CloudRun.md)**.
