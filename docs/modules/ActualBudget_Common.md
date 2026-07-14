---
title: "ActualBudget Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the ActualBudget module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# ActualBudget Common — Shared Application Configuration

`ActualBudget_Common` is the **shared application layer** for ActualBudget. It is not deployed on its own; instead it supplies the ActualBudget-specific configuration that both [ActualBudget_GKE](ActualBudget_GKE.md) and [ActualBudget_CloudRun](ActualBudget_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs ActualBudget, see the platform guides ([ActualBudget_GKE](ActualBudget_GKE.md), [ActualBudget_CloudRun](ActualBudget_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by ActualBudget_Common | Where it surfaces |
|---|---|---|
| Container image | Thin-wraps the official `actualbudget/actual-server` image so the foundation builds/mirrors it into Artifact Registry | `container_image` output of the platform deployment |
| Version pinning | App-specific `ACTUALBUDGET_VERSION` build ARG; `latest` pins to `25.7.1` | Image tag in Artifact Registry |
| Database engine | **None** — budget data lives in SQLite files under `/data` (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — no `db-init` job; the server initialises its own files on first boot | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/data` on Cloud Run | `storage_buckets` output |
| Core settings | Sets `ACTUAL_PORT = 5006`, `ACTUAL_SERVER_FILES = /data/server-files`, `ACTUAL_USER_FILES = /data/user-files` | Application behaviour in the platform guides |
| Optional API key | When `enable_api_key = true`, generates a 32-char token in **Secret Manager**, injected as `ACTUAL_TOKEN` | `secret_ids` output / Secret Manager |
| Health checks | Supplies the default startup/liveness probe behaviour against the root path | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

ActualBudget has **no mandatory generated secrets**. There is no database password, encryption key, or JWT secret — the **server password** is set interactively on the first-run onboarding screen, and per-budget end-to-end encryption is configured by the user in the client.

The **only optional secret** is an API token, gated behind `enable_api_key` (default `false`):

- When `enable_api_key = true`, a 32-character random value is generated and stored in Secret Manager under `secret-<prefix>-<app>-api-key` (for example `secret-<prefix>-actualbudget-api-key`), and injected into the container as the `ACTUAL_TOKEN` secret environment variable via the foundation's `module_secret_env_vars` mechanism.
- When `enable_api_key = false` (the default), no secret is created and the module's `secret_ids` map is empty.

The option exists for deployments that need a pre-provisioned credential for automation before (or instead of) interactive setup.

Retrieve the secret after deployment (only when `enable_api_key = true`):

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and workload-identity model.

---

## 3. Database engine and bootstrap

ActualBudget does **not** use an external database. Each budget is a **SQLite file**, and the server's own account/metadata state is also file-based — everything lives under `/data`. Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created.
- There is **no `db-init` job** — the server creates its files on first boot; nothing has to be bootstrapped ahead of time.
- No PostgreSQL extensions and no Redis are involved (`enable_redis = false` in the Cloud Run variant).

Because the databases are files on the persistent `/data` volume, durability is a function of the storage backend, not a managed database service (see §6). Custom `initialization_jobs` are accepted for data loading or migration tasks; none is provided by default.

---

## 4. Container image and entrypoint

ActualBudget uses a **thin-wrapper Dockerfile** — it does not add a custom entrypoint script and runs the upstream image's own startup unchanged:

```dockerfile
ARG ACTUALBUDGET_VERSION=25.7.1
FROM actualbudget/actual-server:${ACTUALBUDGET_VERSION}
```

- **`image_source = "custom"`** — set purely so the foundation builds the image into Artifact Registry via Cloud Build; no application code is layered on top.
- **App-specific build ARG** — the Dockerfile reads `ACTUALBUDGET_VERSION`, **not** the generic `APP_VERSION` the foundation injects (and would force to `latest`). When `application_version = "latest"` the build pins to `25.7.1`; otherwise the requested version passes straight through.
- **No entrypoint translation** — ActualBudget needs no database wiring or URL rewriting at boot, so the upstream startup is used as-is.

---

## 5. Core application settings

`ActualBudget_Common` establishes the minimal environment the server needs to come up on first boot and write its state to the persistent volume:

- **`ACTUAL_PORT = "5006"`** — the server's HTTP port, matching the module's `container_port`.
- **`ACTUAL_SERVER_FILES = "/data/server-files"`** — server metadata and the account database.
- **`ACTUAL_USER_FILES = "/data/user-files"`** — the per-budget sync files.
- **No boot-time credentials** — the server password is set through the first-run onboarding screen; nothing further is configured at boot.

Platform-specific mounting of `/data`:

- **Cloud Run** mounts the `storage` Cloud Storage bucket at `/data` via GCS FUSE (`enable_gcs_storage_volume = true`).
- **GKE** with `stateful_pvc_enabled = true` mounts a block PVC at the same path and sets `enable_gcs_storage_volume = false` to avoid a double-mount.

---

## 6. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the foundation, which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, `public_access_prevention = "enforced"`, location resolved to the deployment region.
- On Cloud Run it backs `/data` via GCS FUSE, so it holds the SQLite budget databases, server files, and user files — the only copy of your budget data.

List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
```

**Note on storage type.** SQLite prefers **block storage** with low-latency random I/O. The GCS FUSE mount is fine for single-user / light use on Cloud Run, but SQLite does not tolerate GCS FUSE under heavy concurrent write — for durable production storage prefer the GKE variant's block PVC (`stateful_pvc_enabled = true`).

---

## 7. Health probe behaviour

Both probes issue an **HTTP GET `/`**, which the Node server answers with `200` as soon as it is listening, with **no authentication** — so the probes pass independent of onboarding state.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`, `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`, `failure_threshold = 3`.

---

For the ActualBudget-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides:
**[ActualBudget_GKE](ActualBudget_GKE.md)** and **[ActualBudget_CloudRun](ActualBudget_CloudRun.md)**.
