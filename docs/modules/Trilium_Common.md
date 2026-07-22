---
title: "Trilium Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Trilium module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Trilium Common — Shared Application Configuration

`Trilium_Common` is the **shared application layer** for Trilium Notes (the
actively maintained TriliumNext fork of the hierarchical, self-hosted note-taking
app). It is not deployed on its own; instead it supplies the Trilium-specific
configuration that both [Trilium_GKE](Trilium_GKE.md) and
[Trilium_CloudRun](Trilium_CloudRun.md) build on, so the two platform variants
behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own.

For the infrastructure that actually provisions and runs Trilium, see the platform
guides ([Trilium_GKE](Trilium_GKE.md), [Trilium_CloudRun](Trilium_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. What this layer provides

| Area | Provided by Trilium_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps `triliumnext/notes` in a thin Dockerfile (`ARG TRILIUM_VERSION`) so the Foundation can build/mirror it via Cloud Build | `container_image` output |
| Database engine | Fixes `database_type = "NONE"` — embedded SQLite only, no Cloud SQL instance | Application behaviour in the platform guides |
| Persistent storage | Declares the Cloud Storage data bucket, mounted at `/home/node/trilium-data` (GCS FUSE on Cloud Run, or StatefulSet PVC on GKE) | `storage_buckets` output |
| Core settings | Sets `TRILIUM_DATA_DIR` and binds the app to `0.0.0.0:8080` | Application behaviour in the platform guides |
| Health checks | Startup/liveness probe defaults targeting `/api/health-check` | §Observability in the platform guides |
| Credentials | None generated — Trilium's password is set via its own "Set Password" web UI screen | Manual operator step |

---

## 2. Container image and build

```dockerfile
ARG TRILIUM_VERSION=0.95.0
FROM triliumnext/notes:${TRILIUM_VERSION}
```

`TRILIUM_VERSION` is an app-specific build ARG, deliberately distinct from the
generic `APP_VERSION` the Foundation injects (which would otherwise force
`FROM triliumnext/notes:latest` regardless of the requested version).

```bash
gcloud artifacts docker images list <repo-url> --project "$PROJECT" --filter="package~trilium"
```

---

## 3. Database engine

`database_type` is fixed to `NONE`. Trilium's entire document store is a single
embedded SQLite file, `document.db`, created and migrated by the app itself on
first web visit via its own setup wizard.

---

## 4. Persistent storage

A dedicated Cloud Storage data bucket is provisioned and mounted at
`/home/node/trilium-data`:

- **Cloud Run:** GCS FUSE volume with `mount_options = uid=1000,gid=1000,file-mode=0664,dir-mode=0775` — matching the `node` user Trilium's container runs as (confirmed via `docker run ... id node`).
- **GKE:** GCS FUSE by default, or a StatefulSet block PVC (`stateful_pvc_enabled = true`) with `fsGroup = 1000` for larger note collections needing real POSIX file locking.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 5. Core application settings

- **Data directory** — `TRILIUM_DATA_DIR=/home/node/trilium-data`.
- **Port** — `8080` by default.
- **No auth bootstrap.** Confirmed by inspecting every `process.env.TRILIUM_*`
  reference in the built image's bundled `main.cjs` — there is no password/API-key
  env var. The only way to set the initial password is Trilium's own "Set Password"
  screen, presented on first visit.

---

## 6. Health probe behaviour

Default probes target `/api/health-check` — confirmed live (`curl` returns
`200 {"status":"ok"}` with no auth required). The root `/` path redirects (302) to
the setup/login screen and is not used for probing.

---

For the Trilium-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Trilium_GKE](Trilium_GKE.md)** and **[Trilium_CloudRun](Trilium_CloudRun.md)**.
