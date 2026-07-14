---
title: "Hoppscotch Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Hoppscotch module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Hoppscotch Common — Shared Application Configuration

`Hoppscotch_Common` is the **shared application layer** for Hoppscotch. It is not
deployed on its own; instead it supplies the Hoppscotch-specific configuration that
both [Hoppscotch_GKE](Hoppscotch_GKE.md) and
[Hoppscotch_CloudRun](Hoppscotch_CloudRun.md) build on, so the two platform variants
behave identically where it matters. End users never configure this layer directly —
it has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Hoppscotch, see the platform
guides ([Hoppscotch_GKE](Hoppscotch_GKE.md),
[Hoppscotch_CloudRun](Hoppscotch_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

Hoppscotch is an open-source, Postman-style API development platform. This module
deploys the **self-hosted frontend single-page app only** — a stateless UI served on
port 3000 by Caddy — with **no database, no Redis, no secrets, and no persistent
storage**. That deliberate scoping is the defining characteristic of the layer.

| Area | Provided by Hoppscotch_Common | Where it surfaces |
|---|---|---|
| Container image | A thin **custom build** `FROM hoppscotch/hoppscotch-frontend`, built via Cloud Build | `container_image` output of the platform deployment |
| Image tag pinning | Maps `application_version` to an app-specific `HOPPSCOTCH_VERSION` build ARG (a `"latest"` request resolves to a known-good pinned tag) | `container_build_config.build_args` in the `config` output |
| Database engine | Fixes **`database_type = "NONE"`** — no Cloud SQL instance is provisioned | §Database behaviour in the platform guides |
| Object storage | **None** — `storage_buckets` is empty; the demo is stateless | `storage_buckets` output (empty list) |
| Secrets | **None** — `secret_ids` / `secret_values` are empty maps | Secret Manager (nothing app-specific) |
| Core settings | Port `3000`, no runtime config injection, autoscaling bounds, resource limits | Application behaviour in the platform guides |
| Health checks | Startup / liveness / readiness probes targeting the root path `/` | §Observability in the platform guides |

---

## 2. Container image and build

The `config.container_image` is `hoppscotch/hoppscotch-frontend` and `image_source`
is `"custom"`, so the Foundation builds a thin image through Cloud Build (Kaniko)
rather than running the upstream image directly. The Dockerfile
(`scripts/Dockerfile`) is deliberately minimal:

```dockerfile
ARG HOPPSCOTCH_VERSION=latest
FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}
EXPOSE 3000
```

Two design decisions are baked in here and are worth understanding:

- **The frontend-only image is used on purpose.** The all-in-one
  `hoppscotch/hoppscotch` image bundles the NestJS backend, which hard-requires
  `DATABASE_URL` and calls `exit(1)` when it is missing — killing the whole
  container. Because this deployment is a stateless SPA demo (`database_type =
  "NONE"`), `hoppscotch/hoppscotch-frontend` is the correct base. It serves the
  single-page web app on port 3000 via Caddy using its own inherited
  `ENTRYPOINT`/`CMD`; no runtime configuration injection is needed.
- **`HOPPSCOTCH_VERSION` is an app-specific build ARG, not the generic
  `APP_VERSION`.** The Foundation injects `APP_VERSION = application_version` into
  every build and wins the merge, so it would overwrite a generic ARG with
  `"latest"`. Hoppscotch_Common therefore names its ARG `HOPPSCOTCH_VERSION` and maps
  a `"latest"` `application_version` to a pinned, known-good tag before setting it —
  so the build never references a non-existent tag.

Inspect the built image after deployment:

```bash
# The image URI is reported in the platform deployment output `container_image`.
gcloud artifacts docker images list \
  "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
  --include-tags --filter="package~hoppscotch"

# Review the Cloud Build that produced it:
gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
```

---

## 3. Database engine

There is **no database**. `config.database_type = "NONE"`,
`enable_cloudsql_volume = false`, and `initialization_jobs = []`. No Cloud SQL
instance, Auth Proxy, database user, or bootstrap job is created. The Hoppscotch
frontend keeps all of a user's collections, environments, and history in **browser
local storage**, so there is no server-side state to persist.

Both platform variants additionally enforce this: `Hoppscotch_GKE` carries a
plan-time precondition (`validation.tf`) that fails the plan if `database_type` is set
to anything other than `NONE`, and `Hoppscotch_CloudRun` leaves the Cloud SQL volume
disabled. This prevents an operator from accidentally provisioning — and paying for —
an unused Cloud SQL instance.

---

## 4. Secrets

`secret_ids` and `secret_values` are both **empty maps** — the static frontend demo
requires no cryptographic material, API tokens, or database password. Nothing
app-specific is written to Secret Manager. (The Foundation still manages its own
platform-level secrets independently; see [App_Common](App_Common.md) for the shared
secret and Workload Identity model.)

There is therefore nothing to rotate and no immutable-key hazard for this module.

---

## 5. Object storage

`storage_buckets` is an **empty list** and `gcs_volumes` is empty. The demo is
stateless and provisions no Cloud Storage buckets or GCS Fuse mounts. If you need to
attach a bucket for an out-of-band purpose, declare it through the platform variant's
`storage_buckets` input — the Foundation will create and grant access to it — but the
Hoppscotch application itself neither expects nor uses one.

---

## 6. Core application settings

`Hoppscotch_Common` establishes a minimal baseline so the SPA comes up correctly on
first boot:

- **Port** — `container_port = 3000`; the frontend SPA port baked into the upstream
  image and served by Caddy.
- **No runtime config injection** — `environment_variables` defaults to `{}` and
  `secret_environment_variables` to `{}`. Extra overrides can be supplied through the
  platform variant's `environment_variables` input.
- **Autoscaling bounds** — `min_instance_count` / `max_instance_count` are passed
  through from the variant (Cloud Run scales to zero by default; GKE keeps a floor of
  one replica).
- **Resource limits** — `cpu_limit` / `memory_limit` default to a small footprint
  suitable for a static SPA (`512Mi` recommended; a full 1 vCPU on Cloud Run because
  the always-on billing floor requires an integer CPU when enabled — see the platform
  guide).

---

## 7. Health probe behaviour

All three probes — startup, liveness, and readiness — target the **root path `/`**
over HTTP. A `GET /` against the running container returns the app UI with HTTP 200 as
soon as Caddy binds its port, so the probes pass almost immediately; there are no
first-boot migrations or database connections to wait on.

- **Startup probe** — HTTP `/`, 10s initial delay, 10s period, 6 failures tolerated.
- **Liveness probe** — HTTP `/`, 15s initial delay, 30s period, 3 failures tolerated.
- **Readiness probe** — HTTP `/`, 10s initial delay, 10s period, 3 failures tolerated.

Because the app has no external dependencies, a probe failure almost always points at
the container failing to start (a bad image tag) rather than an unreachable backend.

---

## 8. Outputs

`Hoppscotch_Common` exposes the standard four-output contract consumed by the platform
variants, plus a `path` helper:

| Output | Description |
|---|---|
| `config` | The full application configuration object (image, port, `database_type = "NONE"`, resource limits, probes) merged into the Foundation call. |
| `secret_ids` | Map of env var → Secret Manager secret ID. **Empty** — no secrets. |
| `secret_values` | Map of env var → raw secret value (sensitive). **Empty** — no secrets. |
| `storage_buckets` | GCS buckets to provision. **Empty** — the demo is stateless. |
| `path` | Absolute path to this module directory, used to resolve `scripts_dir` in the platform variants. |

---

For the Hoppscotch-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Hoppscotch_GKE](Hoppscotch_GKE.md)** and
**[Hoppscotch_CloudRun](Hoppscotch_CloudRun.md)**.
