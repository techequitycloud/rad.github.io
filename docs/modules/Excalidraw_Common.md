---
title: "Excalidraw Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Excalidraw module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Excalidraw Common — Shared Application Configuration

`Excalidraw_Common` is the **shared application layer** for Excalidraw. It is not
deployed on its own; instead it supplies the Excalidraw-specific configuration that
both [Excalidraw_GKE](Excalidraw_GKE.md) and
[Excalidraw_CloudRun](Excalidraw_CloudRun.md) build on, so the two platform variants
behave identically where it matters. End users never configure this layer directly —
it has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform docs.

Excalidraw is an open-source (MIT) virtual whiteboard for sketching hand-drawn-style
diagrams. The self-hosted distribution is a **static single-page application served
by nginx** — there is no backend, no database, no user accounts, and no server-side
persistence. Drawings live in the visitor's own browser (local storage) and are
exported/imported as `.excalidraw` files. This makes the module unusually thin: no
secrets, no Cloud SQL, no object storage, and no cache.

For the infrastructure that actually provisions and runs Excalidraw, see the platform
guides ([Excalidraw_GKE](Excalidraw_GKE.md),
[Excalidraw_CloudRun](Excalidraw_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Excalidraw_Common | Where it surfaces |
|---|---|---|
| Container image | Thin **custom build** `FROM excalidraw/excalidraw:<version>`; the build only mirrors the static SPA into Artifact Registry | `container_image` output of the platform deployment |
| Container port | Fixes **port 80** — the nginx listener inside the image | §Networking in the platform guides |
| Database engine | **None** (`database_type = "NONE"`). Excalidraw has no backend and stores no data server-side | No Cloud SQL instance is created |
| Secrets | **None** — `secret_ids` and `secret_values` are empty maps | Nothing is written to Secret Manager |
| Object storage | **None** — `storage_buckets` and `gcs_volumes` are empty | No GCS bucket is provisioned |
| Cache / queue | **None** — no Redis, no message queue | — |
| Database bootstrap | **None** — there are no initialization jobs (`initialization_jobs = []`) | `initialization_jobs` output is empty |
| Version pinning | Sets an app-specific `EXCALIDRAW_VERSION` build ARG so `application_version = "latest"` resolves to a known-good tag rather than the Foundation-injected `APP_VERSION` | `container_build_config.build_args` |
| Health checks | Supplies default startup / liveness / readiness probes targeting the root path `/` | §Observability in the platform guides |

---

## 2. Container image

The image is a **thin custom build** rather than a straight prebuilt reference. The
`Dockerfile` is two lines of substance:

```dockerfile
ARG EXCALIDRAW_VERSION=latest
FROM excalidraw/excalidraw:${EXCALIDRAW_VERSION}
EXPOSE 80
```

- **Base image:** `excalidraw/excalidraw` — the official static nginx SPA published on
  Docker Hub. There is no application server: nginx serves the compiled frontend
  bundle on port 80.
- **Why a custom build at all:** the build exists to **mirror** the upstream image into
  the project's Artifact Registry (`enable_image_mirroring = true` by default) so the
  deployment does not depend on Docker Hub availability or pull quotas, and so Binary
  Authorization / CMEK policies apply to a project-local image.
- **Version pinning gotcha (why `EXCALIDRAW_VERSION`, not `APP_VERSION`):** the
  Foundation injects `APP_VERSION = application_version` into `build_args` and **wins**
  any merge, so a Common-level `APP_VERSION` would be silently overwritten with
  `latest`. Excalidraw's base tag is therefore derived from an **app-specific**
  `EXCALIDRAW_VERSION` build ARG that the Foundation does not touch. When
  `application_version = "latest"` (the campaign default), the Common layer resolves it
  to a pinned known-good tag so the `FROM` never references a non-existent tag.

Inspect the resolved build args without deploying:

```bash
# From within Excalidraw_CloudRun or Excalidraw_GKE:
tofu console
> module.excalidraw_app.config.container_build_config.build_args
```

---

## 3. Database, secrets, and object storage — intentionally empty

Because the self-hosted Excalidraw frontend is entirely client-side, this layer
declares **none** of the stateful primitives the other application modules use:

- **`database_type = "NONE"`** — no Cloud SQL instance, no `db-init` job, no schema.
- **`secret_ids = {}` / `secret_values = {}`** — nothing is written to Secret Manager.
  There are no encryption keys, JWT secrets, or database passwords to protect, and
  therefore none to rotate.
- **`storage_buckets = []` / `gcs_volumes = []`** — no GCS bucket is provisioned and no
  GCS Fuse volume is mounted.
- **`initialization_jobs = []`** — there is no first-deploy bootstrap step; the service
  is ready as soon as nginx starts.

You can confirm the empty outputs from the platform module:

```bash
tofu console
> module.excalidraw_app.secret_ids       # {}
> module.excalidraw_app.storage_buckets   # []
```

Consequently the CLI commands you would normally use to inspect a database, list
secrets, or browse a bucket for this app will return nothing — that is expected, not a
misconfiguration.

---

## 4. Runtime configuration and vestigial variables

Excalidraw needs **no per-deployment runtime configuration** — the same image serves
correctly anywhere. The Common layer forwards a plain `environment_variables` map
(default empty) for optional overrides, but the static frontend reads none of them at
runtime.

> **Note — vestigial Matrix/Element inputs.** This module was scaffolded from the
> Element template, so the two platform variants still declare `homeserver_url` and
> `homeserver_name` inputs and inject them as `HOMESERVER_URL` / `HOMESERVER_NAME`
> environment variables. The `excalidraw/excalidraw` static SPA **does not read these
> values** — they are inert carry-over and can be left at their defaults. Likewise,
> some variable *descriptions* in the module still reference "the leading Matrix web
> client"; the deployed artefact is the Excalidraw whiteboard image, as the `Dockerfile`
> `FROM` line confirms.

---

## 5. Health probe behaviour

All three probes (startup, liveness, readiness) are HTTP GET on the **root path `/`**,
which nginx serves with a `200` as soon as the container starts. Because there is no
backend to initialise and no migrations to run, the service becomes healthy almost
immediately — the generous startup window in the other application modules is
unnecessary here.

- **Startup probe:** HTTP `/`, 10-second initial delay, 6-retry window.
- **Liveness probe:** HTTP `/`, 15-second initial delay, checked every 30 seconds.
- **Readiness probe:** HTTP `/`, 10-second initial delay, checked every 10 seconds.

The per-variant `Excalidraw_CloudRun` / `Excalidraw_GKE` inputs can override these, but
the root-path default is correct for the static SPA and should rarely be changed.

---

For the Excalidraw-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Excalidraw_GKE](Excalidraw_GKE.md)** and
**[Excalidraw_CloudRun](Excalidraw_CloudRun.md)**.
