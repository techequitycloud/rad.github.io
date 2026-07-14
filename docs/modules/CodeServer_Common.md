---
title: "CodeServer Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the CodeServer module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# CodeServer Common — Shared Application Configuration

`CodeServer_Common` is the **shared application layer** for code-server. It is not
deployed on its own; instead it supplies the code-server-specific configuration
that both [CodeServer_GKE](CodeServer_GKE.md) and
[CodeServer_CloudRun](CodeServer_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

code-server runs a full VS Code IDE in the browser, backed by a persistent
workspace. It is a single self-contained container: **no database, no Redis, no
message queue** — all state lives in the workspace directory `/home/coder`, which
this layer backs with durable object storage.

For the infrastructure that actually provisions and runs code-server, see the
platform guides ([CodeServer_GKE](CodeServer_GKE.md),
[CodeServer_CloudRun](CodeServer_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by CodeServer_Common | Where it surfaces |
|---|---|---|
| Editor password | Generates a 24-character random password, stores it in **Secret Manager**, and injects it as the `PASSWORD` env var so the code-server login page requires it | Injected automatically when `enable_password = true`; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `codercom/code-server` image with a thin `Dockerfile` and builds/mirrors it into **Artifact Registry** via Cloud Build (Kaniko) | `container_image` output of the platform deployment |
| Database engine | Fixes **`database_type = NONE`** — code-server has no SQL database and no init job | §Application behaviour in the platform guides |
| Persistent workspace | Declares the **Cloud Storage** workspace bucket mounted at `/home/coder` (GCS FUSE on Cloud Run, block PVC on GKE) | `storage_buckets` output |
| Core settings | Sets `BIND_ADDR = 0.0.0.0:8080` so the platform front-end can route to the editor; single-instance scaling defaults | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting the unauthenticated `/healthz` endpoint | §Observability in the platform guides |

---

## 2. Editor password in Secret Manager

When `enable_password = true` (the default), a single secret is generated
automatically and stored in Secret Manager — it is never set in plain text:

- **`PASSWORD`** — a 24-character random alphanumeric string (`special = false`).
  Injected into the container as the `PASSWORD` environment variable, which
  code-server reads to gate its login page. Anyone reaching the editor URL must
  enter this password. The secret is named
  `secret-<wrapper_prefix>-<application_name>-password`.

The password is stable across re-applies (backed by a `random_password` resource in
state), so redeploys do not lock existing users out. Retrieve it after deployment:

```bash
# List the password secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"

# Read the current editor password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The secret ID is also surfaced as the `codeserver_password_secret_id` platform
output (GKE) / `password_secret_id` Common output. Setting `enable_password = false`
skips secret creation entirely and serves the editor **without authentication** —
only appropriate for a private, `internal`-ingress deployment reachable solely from
inside the VPC. See [App_Common](App_Common.md) for the shared secret and Workload
Identity model.

---

## 3. Container image and build

code-server ships as the official `codercom/code-server` image. This layer wraps it
with a minimal `Dockerfile` (a single `FROM codercom/code-server:${CODESERVER_VERSION}`
`ARG` line) so the Foundation can build and mirror it into Artifact Registry via
Cloud Build using Kaniko:

- **`image_source = "custom"`** with `container_build_config.enabled = true`.
- The Dockerfile reads an **app-specific `CODESERVER_VERSION` build arg**, *not* the
  generic `APP_VERSION` the Foundation injects (which it would force to `latest`).
  When `application_version = "latest"`, the build pins `CODESERVER_VERSION = 4.99.1`
  (a known-good release); otherwise it uses the requested version tag.
- `enable_image_mirroring = true` by default mirrors the image into Artifact Registry
  to avoid Docker Hub rate limits.

Inspect the built image reference:

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo>/codeserver --project "$PROJECT"
```

---

## 4. No database, no Redis, no init job

code-server is a self-contained editor. This layer sets **`database_type = NONE`**,
declares **no initialization jobs** (only user-supplied custom jobs are honoured),
and both platform variants **explicitly disable Redis** (`enable_redis = false`)
because the Foundation defaults it to `true`. There is no schema to create, no
migration to run, and no cache to provision — the only stateful resource is the
workspace volume (§5).

---

## 5. Persistent workspace storage

code-server keeps the user's workspace, editor settings, installed extensions, and
its generated config under **`/home/coder`**. That directory is the single source of
persistent state, so this layer declares one **Cloud Storage** bucket (`name_suffix =
"storage"`) that the Foundation provisions and mounts at `/home/coder`:

- **Cloud Run** mounts the bucket as a **GCS FUSE** volume at `/home/coder`
  (`enable_gcs_storage_volume = true`).
- **GKE** uses the same GCS FUSE volume by default, but when
  `stateful_pvc_enabled = true` the GKE wrapper sets `enable_gcs_storage_volume = false`
  and mounts a **StatefulSet block PVC** at `/home/coder` instead — avoiding a
  double-mount conflict. Block PVC gives lower-latency I/O for large workspaces and
  extension installs.

The bucket location is left empty so the Foundation resolves it to the deployment
region (`coalesce(bucket.location, region)`); pinning it would risk a force-replace
of the immutable-location bucket on a cross-region re-apply. List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
```

---

## 6. Health probe behaviour

The default probes target **`/healthz`** — code-server's **unauthenticated** health
endpoint, which returns `200` as soon as the HTTP server is listening. This matters
because code-server's other health path, `/health`, returns `401` when a `PASSWORD`
is set, which would fail an unauthenticated probe and cause spurious restarts.

- **Cloud Run** uses HTTP probes targeting `/healthz` (startup: 15 s initial delay,
  10-retry window; liveness: 30 s delay).
- **GKE** applies the same startup/liveness structure; note the GKE variant's probe
  `default` targets `/health` — override it to `/healthz` if a password is enabled to
  keep probes unauthenticated.

---

For the code-server-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[CodeServer_GKE](CodeServer_GKE.md)** and
**[CodeServer_CloudRun](CodeServer_CloudRun.md)**.
