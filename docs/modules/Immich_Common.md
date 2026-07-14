---
title: "Immich Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Immich module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Immich Common — Shared Application Configuration

`Immich_Common` is the **shared application layer** for Immich. It is not deployed
on its own; it supplies the Immich-specific configuration that
[Immich_GKE](Immich_GKE.md) builds on. Unlike most application pairs on the
platform, there is deliberately **no Immich CloudRun variant**: Immich's media
library is a local filesystem (it has no S3/GCS storage backend) and photo/video
uploads are routinely multi-GB — neither fits Cloud Run's request model — so the
GKE variant is this layer's only consumer. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Immich, see the platform
guide ([Immich_GKE](Immich_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Immich_Common | Where it surfaces |
|---|---|---|
| Container image | Thin custom build `FROM ghcr.io/immich-app/immich-server` adding a cloud entrypoint; built via Cloud Build | `container_image` output of the platform deployment |
| Version resolution | `application_version = "latest"` resolves to Immich's rolling **`release`** tag; exposed as `resolved_version` so the machine-learning image stays in lock-step | Image tags on both containers |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (Immich requires PostgreSQL >= 14, < 20) and enables the `vector` extension on the instance | §Database in the platform guide |
| Database bootstrap | Defines the first-deploy `db-init` job — database, user, grants, `pgvector` + `earthdistance` extensions | `initialization_jobs` output |
| Vector search | Sets `DB_VECTOR_EXTENSION = "pgvector"` — Immich's documented fallback (Cloud SQL has no VectorChord) | Smart-search behaviour |
| Media library | Sets `IMMICH_MEDIA_LOCATION` (default `/usr/src/app/upload`); the GKE variant mounts the shared NFS volume exactly there | §Storage in the platform guide |
| Core settings | `IMMICH_PORT = 2283`, `IMMICH_ENV = production`, telemetry off | Application behaviour |
| Health checks | Default startup/liveness probes targeting `GET /api/server/ping` (unauthenticated) | §Observability in the platform guide |
| Secrets | **None** (`secret_ids = {}`) — JWT signing keys live in the database; `DB_PASSWORD` is foundation-injected under the exact name Immich reads | No app-level Secret Manager entries |
| Object storage | **None** (`storage_buckets = []`) — the media library is NFS, not GCS | No module-managed buckets |

---

## 2. Container image and version resolution

The custom image is deliberately thin — one layer over the official image:

```dockerfile
ARG IMMICH_VERSION=release
FROM ghcr.io/immich-app/immich-server:${IMMICH_VERSION}
```

plus the cloud entrypoint, chained through `tini` into the upstream
`CMD ["./start.sh"]`. Port 2283 is exposed and the upstream `WORKDIR /usr/src/app`
is kept.

Two version facts are load-bearing:

- **Immich publishes no `latest` tag** — only `release` (rolling stable) and
  pinned `vX.Y.Z` tags. `Immich_Common` resolves `application_version = "latest"`
  to `release` at plan time.
- **The build ARG is app-specific (`IMMICH_VERSION`) on purpose.** The foundation
  injects `APP_VERSION` into every custom build's `build_args` and wins the merge;
  had the Dockerfile used `APP_VERSION`, a `latest` deployment would try to pull
  the non-existent `immich-server:latest`. The resolved tag is also exported as the
  `resolved_version` output, which the GKE variant uses for the prebuilt
  machine-learning image (`ghcr.io/immich-app/immich-machine-learning:<same tag>`)
  so server and ML never drift apart.

---

## 3. The cloud entrypoint — why runtime env mapping

`scripts/entrypoint.sh` runs before Immich starts and maps the foundation-injected
env vars onto the names Immich expects:

| Immich name | Mapped from | Notes |
|---|---|---|
| `DB_HOSTNAME` | `DB_HOST` or `DB_IP` (fallback `127.0.0.1`) | A Cloud SQL Auth Proxy *socket-directory* path is rewritten to `127.0.0.1` — the proxy also listens on TCP localhost |
| `DB_USERNAME` | `DB_USER` | |
| `DB_DATABASE_NAME` | `DB_NAME` | |
| `DB_PORT` | — | Defaults `5432` |
| `REDIS_HOSTNAME` | `REDIS_HOST` (host part) | The platform injects the NFS-server co-hosted Redis IP when `enable_redis = true`; `REDIS_HOST` may arrive as `host` or `host:port`, and the entrypoint strips any port so `REDIS_HOSTNAME` is a bare hostname/IP; **empty → the entrypoint exits 1 with a clear error** (Immich requires Redis) |
| `REDIS_PORT` | `REDIS_HOST` (port part) | Taken from a `host:port` `REDIS_HOST` when present; defaults `6379` otherwise |
| `REDIS_PASSWORD` | `REDIS_AUTH` | Only when set |
| `DB_PASSWORD` | _(no mapping needed)_ | The foundation injects it under the exact name Immich reads |

**Why an entrypoint rather than Kubernetes `$(VAR)` references:** Kubernetes
resolves `$(VAR)` only against env entries defined *earlier* in the
(alphabetically rendered) env list. `DB_DATABASE_NAME` sorts before `DB_NAME`, so
a `DB_DATABASE_NAME = "$(DB_NAME)"` reference would reach Immich as the literal
string `$(DB_NAME)`. Mapping at runtime in the entrypoint sidesteps the ordering
constraint entirely.

The entrypoint echoes the resolved `DB_HOSTNAME`, `DB_DATABASE_NAME`,
`DB_USERNAME`, `REDIS_HOSTNAME:PORT`, and media location before `exec`ing the
upstream start script — the first lines of the pod log show exactly what Immich
connected to. It also **resolves the start script across image layouts**: Immich
v3 moved the app to `/usr/src/app/server` (start script at
`/usr/src/app/server/bin/start.sh`) while older images keep
`/usr/src/app/start.sh` — the entrypoint probes both candidates and adjusts the
working directory before `exec`.

---

## 4. Database engine and bootstrap

Immich requires PostgreSQL; `Immich_Common` pins `database_type = "POSTGRES_15"`.
On the first deployment a one-shot job (`db-init`, image `postgres:15-alpine`,
600-second timeout, `execute_on_apply = true`) runs `scripts/db-init.sh`, which
idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (or falls back to `DB_IP`/`DB_HOST` over TCP),
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application user with the generated password,
4. Creates (or reconfigures) the application database with that user as owner,
5. Grants full privileges on the database and the `public` schema,
6. **Pre-creates the `pgvector` extension** as the superuser so Immich's own
   `CREATE EXTENSION IF NOT EXISTS` is a privilege-free no-op, grants
   `cloudsqlsuperuser` to the app user so upstream migrations can manage
   extensions themselves, and **pre-creates `earthdistance`** (Immich uses it for
   reverse geocoding),
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully.

The job is safe to re-run. Two vector-search facts:

- **Cloud SQL has no VectorChord**, Immich's preferred vector extension. The
  runtime is therefore configured with `DB_VECTOR_EXTENSION = "pgvector"` —
  Immich's officially recognized second-class fallback. Functionally complete;
  index builds and queries are slower than VectorChord on large libraries.
- The `vector` extension is *also* enabled at the instance level via
  `enable_postgres_extensions = true` / `postgres_extensions = ["vector"]`, and
  the `db-init` job pre-creates it in the database defensively.

Immich applies its own schema migrations on every startup — no separate migrate
job exists or is needed.

---

## 5. Media library — NFS, not object storage

Immich has **no S3/GCS storage backend**: `IMMICH_MEDIA_LOCATION` must be a real
filesystem path holding every original, thumbnail, and transcoded video.
`Immich_Common` defaults it to Immich's in-container upload directory
`/usr/src/app/upload` (the `media_location` variable), and the GKE variant mounts
the shared platform NFS volume exactly there (`nfs_mount_path`) so the library
survives pod restarts and rescheduling. This is also why the layer declares no GCS
buckets (`storage_buckets = []`) and why the GKE variant validates
`enable_nfs = true` and `max_instance_count = 1` at plan time.

---

## 6. Core application settings

Defaults injected into `config.environment_variables` (caller-supplied
`environment_variables` merge over them):

| Variable | Value | Notes |
|---|---|---|
| `IMMICH_PORT` | `"2283"` | Matches `container_port = 2283` |
| `IMMICH_MEDIA_LOCATION` | `/usr/src/app/upload` | The NFS-backed media library |
| `DB_VECTOR_EXTENSION` | `"pgvector"` | Cloud SQL fallback (no VectorChord) |
| `IMMICH_ENV` | `"production"` | API + background workers in-process (upstream merged the microservices container in v1.106) |
| `IMMICH_TELEMETRY_INCLUDE` | `""` | Telemetry off by default |

Resource defaults: `cpu_limit = "2000m"`, `memory_limit = "4Gi"`.

The **machine-learning container** (CLIP smart search, face recognition — CPU
inference, no GPU) is intentionally *not* part of this layer's `config`
(`additional_services = []` here): the GKE variant defines it inline so the
service list is known at plan time (a module-output path would be "known after
apply" and break `for_each` planning). The variant consumes `resolved_version` to
tag it, overrides `IMMICH_PORT = "3003"` in its env (the ML image reads the same
variable as the server), and injects its URL into the server as
`IMMICH_MACHINE_LEARNING_URL` — the real Kubernetes Service DNS name
(`http://<service>-ml:3003`), set via `module_env_vars` because the foundation's
`output_env_var_name` mechanism composes an unresolvable bare-name URL (parked in
the unused `IMMICH_ML_URL_FOUNDATION_UNUSED` env var).

---

## 7. Health probe behaviour

Default startup and liveness probes target HTTP `GET /api/server/ping` — Immich's
**unauthenticated** liveness endpoint (returns `{"res":"pong"}`). Probes run
unauthenticated (kubelet), so an auth-gated health page would 401/403 and wedge
the rollout. The startup probe allows 30 failures at a 10-second period after a
30-second initial delay (roughly 5 minutes) — enough for first-boot schema
migrations; the liveness probe checks every 30 seconds with a 3-failure threshold.

---

## 8. Outputs

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full application configuration consumed by the foundation (image + build config, port, database contract, env vars, `db-init` job, probes). |
| `secret_ids` | `map(string)` | `{}` — no app-level secret env vars. |
| `secret_values` | `map(string)` | `{}` (sensitive). |
| `storage_buckets` | `list(object)` | `[]` — the media library is NFS-backed. |
| `resolved_version` | `string` | Image tag actually deployed (`latest` → `release`); keeps the machine-learning container in lock-step with the server. |
| `path` | `string` | Absolute path to the module directory; resolves `scripts_dir`. |
| `resource_prefix` | `string` | Resource naming prefix (forwarded from input). |
| `service_name` | `string` | `<application_name><resource_prefix>`. |

---

For the Immich-specific, user-facing configuration (variables by group, outputs,
service exploration from the Console and CLI, and the risk-rated pitfalls table),
see the platform guide: **[Immich_GKE](Immich_GKE.md)**.
