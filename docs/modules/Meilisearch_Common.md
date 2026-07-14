---
title: "Meilisearch Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Meilisearch module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Meilisearch Common — Shared Application Configuration

`Meilisearch_Common` is the **shared application layer** for Meilisearch. It is
not deployed on its own; instead it supplies the Meilisearch-specific configuration
that both [Meilisearch_GKE](Meilisearch_GKE.md) and
[Meilisearch_CloudRun](Meilisearch_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Meilisearch, see the
platform guides ([Meilisearch_GKE](Meilisearch_GKE.md),
[Meilisearch_CloudRun](Meilisearch_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Meilisearch_Common | Where it surfaces |
|---|---|---|
| Master key | Generates a 32-character `MEILI_MASTER_KEY` and stores it in **Secret Manager** (`enable_api_key = true`) | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `getmeili/meilisearch` image (pinned to `v1.11`) so the foundation can mirror it into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **`database_type = "NONE"`** — Meilisearch has no external database | §Database in the platform guides |
| Object storage | Declares the **Cloud Storage** `storage` bucket, mounted at `/meili_data` | `storage_buckets` output |
| Core settings | Sets the baseline Meilisearch environment: data path, listen address, production mode, telemetry | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. The master key in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text and must be rotated only alongside every client that uses it:

- **`MEILI_MASTER_KEY`** — a 32-character random alphanumeric string, stored as
  `secret-<wrapper_prefix>-<application_name>-api-key`. Meilisearch runs in
  **production mode** (`MEILI_ENV = production`), which **requires** a master key of
  at least 16 bytes; the server refuses to start without one. The master key is a
  root credential — it can create and delete indexes, change settings, and mint
  scoped, tenant-limited API keys via `POST /keys`. Applications should be given
  scoped keys, never the master key.

The secret is exposed to the foundation in two ways so each platform variant can
inject it natively:

- **Cloud Run** consumes `secret_ids` (`{ MEILI_MASTER_KEY = <secret-id> }`) through
  the foundation's `module_secret_env_vars` mechanism.
- **GKE** consumes `secret_values` (the raw value) and materialises a **native
  Kubernetes Secret** via `explicit_secret_values`.

Retrieve the master key after deployment:

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read the master key:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

There is no separate database password — Meilisearch has no database. See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and storage

Meilisearch requires **no database**; the engine is fixed to `database_type = "NONE"`
and MySQL, PostgreSQL, and other engines are not applicable. Meilisearch is a
self-contained Rust binary that persists its indexes, documents, settings, and task
queue to a single on-disk directory. No Cloud SQL instance, application user, or
`db-init` job is created.

Durability comes entirely from the mounted storage volume at `/meili_data`
(`MEILI_DB_PATH = /meili_data`):

1. **Cloud Run** and **GKE without a PVC** mount the `storage` Cloud Storage bucket
   at `/meili_data` via **GCS FUSE** (`enable_gcs_storage_volume = true`).
2. **GKE with `stateful_pvc_enabled = true`** mounts a Persistent Disk PVC at
   `/meili_data` instead; the Common layer sets `enable_gcs_storage_volume = false`
   so the two do not double-mount the same path.

The bucket is declared here (suffix `storage`, `STANDARD` class,
`public_access_prevention = enforced`, `force_destroy = true`) and provisioned by the
foundation, which also grants the workload service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 4. Container image

The custom image wraps the official upstream image so the foundation can mirror it
into Artifact Registry:

```dockerfile
ARG MEILI_VERSION=v1.11
FROM getmeili/meilisearch:${MEILI_VERSION}
```

- **`MEILI_VERSION` is an app-specific build arg** — deliberately *not* the generic
  `APP_VERSION` that `App_CloudRun`/`App_GKE` inject. The foundation forces
  `APP_VERSION` to the campaign default `"latest"` and wins that merge, but
  `getmeili/meilisearch:latest` is not a good production pin, so `Meilisearch_Common`
  maps `application_version == "latest"` to the known-good `v1.11` tag and passes it
  as `MEILI_VERSION`. Pin `application_version` to a specific release for production.
- **No custom entrypoint.** The upstream `meilisearch` binary starts directly and
  reads all configuration from the injected environment variables — there is nothing
  to bake in beyond the base image, so image changes are rare.

---

## 5. Core application settings

`Meilisearch_Common` establishes the baseline Meilisearch environment so the
application comes up correctly on first boot:

- **Data path** — `MEILI_DB_PATH = "/meili_data"`, aligned with the GCS FUSE / PVC
  mount point so indexes persist across restarts and redeploys.
- **Listen address** — `MEILI_HTTP_ADDR = "0.0.0.0:7700"`, so Cloud Run and the GKE
  Service can reach the engine on port 7700.
- **Environment** — `MEILI_ENV = "production"`. This makes `MEILI_MASTER_KEY`
  mandatory (see §2) and disables the built-in web mini-dashboard.
- **Telemetry** — `MEILI_NO_ANALYTICS = "true"` (disabled by default; no data sent to
  Meilisearch).

Any additional `environment_variables` supplied by the platform user are merged on
top of these defaults, so operators can set further `MEILI_*` options (log level,
snapshot/dump directories, max task-queue size, and so on) without editing the module.

---

## 6. Health probe behaviour

The default probes target **`/health`** — Meilisearch's public, unauthenticated
liveness endpoint, which returns `{"status":"available"}` (HTTP 200) once the server
has finished loading and is ready to serve. Both platform variants use the same
endpoint for startup and liveness:

- **Cloud Run and GKE** use HTTP probes targeting `/health` — the startup probe
  allows a generous window (15-second initial delay, 10-second period, 10 retries)
  to accommodate index loading on a cold start, and the liveness probe re-checks it
  (30-second initial delay, 30-second period, 3-retry threshold).

Because `/health` needs no authentication, the Cloud Run front-end and the GKE
kubelet can probe it directly even when the master key is set on the API.

---

## 7. Initialization jobs and object storage

Meilisearch manages its own storage and requires **no database initialization**, so
`Meilisearch_Common` injects no default `db-init` job. The `initialization_jobs`
input is passed through unchanged for operators who want to run custom one-shot tasks
— for example, seeding an index from a source system or restoring a dump before the
service starts.

The dedicated **Cloud Storage** bucket declared here (§3) is where all persistent
state lives; there is no separate file-storage bucket for Meilisearch. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Meilisearch-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Meilisearch_GKE](Meilisearch_GKE.md)** and
**[Meilisearch_CloudRun](Meilisearch_CloudRun.md)**.
