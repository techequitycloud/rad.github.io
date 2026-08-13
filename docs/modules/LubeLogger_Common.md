---
title: "LubeLogger Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the LubeLogger module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# LubeLogger Common — Shared Application Configuration

`LubeLogger_Common` is the **shared application layer** for LubeLogger. It is
not deployed on its own; instead it supplies the LubeLogger-specific configuration
that both [LubeLogger_GKE](LubeLogger_GKE.md) and
[LubeLogger_CloudRun](LubeLogger_CloudRun.md) build on, so the two platform variants
behave identically where it matters. End users never configure this layer directly —
it has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs LubeLogger, see the
platform guides ([LubeLogger_GKE](LubeLogger_GKE.md),
[LubeLogger_CloudRun](LubeLogger_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by LubeLogger_Common | Where it surfaces |
|---|---|---|
| Authentication | **No generated secrets at all** — the first account is created via self-service registration on `/Login`'s Register form | LubeLogger `/Login` page on first access |
| Container image | Points directly at the official prebuilt `ghcr.io/hargata/lubelogger` image — no custom Dockerfile or Cloud Build step | `container_image` output of the platform deployment |
| Database engine | **None by default** — LubeLogger's default mode uses an internal embedded LiteDB database file under `/App/data` (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — there is no `db-init` job; LubeLogger manages its own storage | n/a |
| Object storage | Declares two Cloud Storage buckets: `storage` (the LiteDB database file plus uploaded photos/receipts/documents) and `dpkeys` (ASP.NET Core Data Protection keys) | `storage_buckets` output |
| Core settings | Sets `EnableAuth = "true"` (secure-by-default) and the container port `8080` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes targeting `/Login` | §Observability in the platform guides |

---

## 2. Secrets

LubeLogger's default (embedded LiteDB) mode has **no generated secrets at all**.
Authentication is configured entirely through **self-service registration**: the
first person to submit the Register form on `/Login` becomes able to use the app.
All auth tokens/sessions are then issued and stored by LubeLogger itself.

`LubeLogger_Common`'s `secret_ids` and `secret_values` outputs are therefore
hardcoded to empty maps — the CloudRun/GKE variants still reference them (to wire
`module_secret_env_vars` / explicit secret values) for a uniform module contract, but
nothing is ever created or injected.

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

LubeLogger's default mode does **not** use an external database. All of its state —
vehicle records, maintenance/fuel logs, user accounts, and settings — lives in a
single **internal LiteDB database file** written under `/App/data`. Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created.
- There is **no `db-init` job** — LubeLogger initialises its own database file on
  first boot.
- No PostgreSQL extensions, no Redis, and no queue/worker are involved.

LubeLogger also supports an optional external **Postgres** backend, configured
entirely through a single key-value DSN environment variable:

```
POSTGRES_CONNECTION = "Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;"
```

`LubeLogger_Common` does **not** wire this by default — no Cloud SQL instance is
provisioned for it. An operator who wants the Postgres backend needs their own
Postgres instance and can set `POSTGRES_CONNECTION` via `secret_environment_variables`
or `environment_variables` on the platform deployment.

Inspect the persisted data directly (block PVC on GKE, or the GCS bucket on Cloud
Run) rather than through a database client, since LiteDB is an embedded file-based
engine with no network protocol.

---

## 4. Container image

LubeLogger uses the **official prebuilt image** with no modification:

```
ghcr.io/hargata/lubelogger:<version>
```

- **`image_source = "prebuilt"`** — no Dockerfile, no custom entrypoint script, and no
  Cloud Build step; the running container is the unmodified upstream image.
- **`enable_image_mirroring = true`** by default copies the image into Artifact
  Registry to avoid GHCR rate limits.
- Confirmed directly against the image (`docker inspect`): `CMD ["./CarCareTracker"]`,
  `WorkingDir /App`, `ExposedPorts 8080/tcp`, no `USER` directive (runs as root).

---

## 5. Core application settings

`LubeLogger_Common` establishes the minimal environment LubeLogger needs to come up
securely on first boot and write its state to the persistent volume:

- **`EnableAuth = "true"`** — overrides LubeLogger's own `appsettings.json` default of
  `EnableAuth=false` (fully open access, no login at all).
- **`/App/data` as the data directory** — confirmed directly against the running
  image: on first boot LubeLogger creates `config/`, `documents/`, `images/`,
  `temp/`, `themes/`, and `translations/` subdirectories under `/App/data`
  automatically.
- **Container port `8080`** — matches the image's own `ASPNETCORE_HTTP_PORTS` default.
- **No telemetry, queue, or execution-mode settings** — the first account is created
  via self-service registration; nothing further is configured at boot.

Platform-specific mounting of `/App/data`:

- **Cloud Run** mounts the `storage` Cloud Storage bucket at `/App/data` via GCS FUSE.
- **GKE** with `stateful_pvc_enabled = true` (the module default) mounts a block PVC
  at `/App/data` and sets `enable_gcs_storage_volume = false` to avoid a double-mount
  at the same path.

A second small bucket (`dpkeys`) is **always** mounted at the fixed path
`/root/.aspnet/DataProtection-Keys`, independent of the `/App/data` mounting mode —
see §7.

---

## 6. Health probe behaviour

Both the startup and liveness probes issue an **HTTP GET `/Login`**, LubeLogger's
public, unauthenticated page — confirmed directly against the running image (`/`
returns `302` when `EnableAuth=true`, since it is `[Authorize]`-gated; `/Login`
returns `200`).

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage

Two dedicated **Cloud Storage** buckets are declared here and provisioned by the
foundation, which also grants the workload service account access:

- **`storage`** — LubeLogger's embedded LiteDB database file plus uploaded
  photos/receipts/documents. On Cloud Run it backs `/App/data` via GCS FUSE; on GKE
  it is superseded by a StatefulSet block PVC at the same path by default.
- **`dpkeys`** — ASP.NET Core Data Protection's cookie/session signing keys, mounted
  at the fixed path `/root/.aspnet/DataProtection-Keys` on **both** platforms,
  always, regardless of how `/App/data` is mounted. This path is not configurable via
  an environment variable in the image.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
```

**Note on storage type.** LubeLogger's LiteDB database ideally wants **block
storage** for reliable file locking. On GKE, the block PVC
(`stateful_pvc_enabled = true`) is the best fit. Cloud Run's GCS FUSE mount works but
has higher latency and is better suited to light use.

---

For the LubeLogger-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[LubeLogger_GKE](LubeLogger_GKE.md)** and
**[LubeLogger_CloudRun](LubeLogger_CloudRun.md)**.
