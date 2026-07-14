---
title: "Changedetection Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Changedetection module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Changedetection Common — Shared Application Configuration

`Changedetection_Common` is the **shared application layer** for changedetection.io.
It is not deployed on its own; instead it supplies the changedetection.io-specific
configuration that both [Changedetection_GKE](Changedetection_GKE.md) and
[Changedetection_CloudRun](Changedetection_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs changedetection.io, see the
platform guides ([Changedetection_GKE](Changedetection_GKE.md),
[Changedetection_CloudRun](Changedetection_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Changedetection_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `ghcr.io/dgtlmoon/changedetection.io` image with a thin Dockerfile and builds/mirrors it via Cloud Build (Kaniko) into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **`database_type = "NONE"`** — changedetection.io is self-contained and uses no SQL database | §Database in the platform guides |
| Object storage | Declares one **Cloud Storage** datastore bucket (suffix `storage`) that holds all watch data | `storage_buckets` output |
| Persistent datastore | Sets `DATASTORE_PATH = /datastore` and mounts the datastore at `/datastore` (GCS FUSE on Cloud Run, block PVC on GKE) | §Persistence in the platform guides |
| Core settings | Sets the baseline environment: datastore path, container port, and (on Cloud Run) the `BASE_URL` notification-link host | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes targeting the web UI at `/` (HTTP 200) | §Observability in the platform guides |
| Secrets | **None** — changedetection.io has no env-injected secret; its optional REST API token is generated inside the web UI | `secret_ids` / `secret_values` outputs are intentionally empty |

---

## 2. Container image and build

changedetection.io is a self-hosted **Python/Flask** application that monitors web
pages for changes and sends notifications. The module does not use the upstream image
directly; it ships a thin wrapper `Dockerfile` so the Foundation can build and mirror
a project-local copy into Artifact Registry:

```dockerfile
ARG CHANGEDETECTION_VERSION=0.50.19
FROM ghcr.io/dgtlmoon/changedetection.io:${CHANGEDETECTION_VERSION}
```

- **Build path.** `image_source = "custom"` with `container_build_config.enabled = true`.
  The image is built through Cloud Build using Kaniko and pushed to the deployment's
  Artifact Registry repository.
- **App-specific version ARG.** The Dockerfile reads **`CHANGEDETECTION_VERSION`**,
  not the generic `APP_VERSION` the Foundation injects (which is forced to `latest`).
  When `application_version = "latest"`, the build pins a known-good tag (`0.50.19`);
  otherwise it uses the requested version. This avoids resolving a non-existent
  `:latest`-derived base tag.
- **Mirroring.** `enable_image_mirroring` defaults to `true` to avoid registry rate
  limits and improve pull reliability.

Inspect the deployed image:

```bash
# The image reference is reported by the platform deployment output:
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo-name> --project "$PROJECT"
```

---

## 3. Database — none

changedetection.io stores all of its state on disk, not in a relational database.
`Changedetection_Common` therefore sets **`database_type = "NONE"`**, declares no
`db_name`/`db_user`, and injects **no database initialization job**. There is no
Cloud SQL instance, no `db-init` job, and no schema migration step. The
`initialization_jobs` input is passed through untouched for operators who want to run
custom data-loading tasks, but no default job is added.

Because there is no database, there is also **no Redis** requirement — both platform
wrappers disable Redis explicitly.

---

## 4. Persistent datastore (Cloud Storage bucket / PVC)

All watch configuration, page snapshots, and history live under a single datastore
directory. The module standardises this on **`DATASTORE_PATH = /datastore`** and backs
it with persistent storage:

- **`storage_buckets`** declares one bucket (`name_suffix = "storage"`,
  `STANDARD` class, `force_destroy = true`, versioning off,
  `public_access_prevention = enforced`). The Foundation provisions it as
  `gcs-<service_name>-storage` in the deployment region and grants the workload
  service account access.
- **`enable_gcs_storage_volume`** (default `true`) mounts that bucket as a **GCS FUSE**
  volume at `/datastore`. This is how Cloud Run persists data.
- On **GKE with `stateful_pvc_enabled = true`**, the wrapper sets
  `enable_gcs_storage_volume = false` so the StatefulSet **block PVC** is mounted at
  `/datastore` instead — avoiding a double-mount at the same path. A block PVC is
  strongly preferred for GKE because changedetection.io writes a file-based datastore
  (watch JSON plus history snapshot files) that behaves better on a POSIX block volume
  than on object-storage FUSE.

List the datastore bucket:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls gs://<data-bucket>/          # bucket name is in the platform Outputs
```

---

## 5. Core application settings

`Changedetection_Common` establishes the baseline environment so the application comes
up correctly on first boot:

- **`DATASTORE_PATH = "/datastore"`** — set explicitly so it always matches the mounted
  volume path on both platforms (the image default is also `/datastore`).
- **Container port `5000`** — changedetection.io serves its web UI on port 5000
  (`container_port = 5000`).
- **`BASE_URL`** — the absolute URL used in notification links. On Cloud Run the
  wrapper injects the predicted service URL under this name via
  `service_url_env_var_name = "BASE_URL"`. On GKE it is left to the operator to set
  (the internal cluster URL is not a useful notification link).
- Any additional `environment_variables` supplied by the operator are merged on top
  (e.g. `FETCH_WORKERS`, `PLAYWRIGHT_DRIVER_URL`).

---

## 6. Secrets — none injected

changedetection.io needs **no env-injected secret**. Its optional REST API access
token is generated and managed inside the web UI (**Settings → API**), not through an
environment variable, so no Secret Manager secret is created here. The
`api_key_secret_id`, `secret_ids`, and `secret_values` outputs are retained (as
constant empty values) only so the Cloud Run/GKE wrappers can wire them into
`module_secret_env_vars` / `explicit_secret_values` without special-casing.

The datastore itself is unencrypted at the application layer; protect the web UI by
setting a password in **Settings → General** and fronting the service with IAP or
Cloud Armor where appropriate (see the platform guides).

---

## 7. Health probe behaviour

The default probes target the web UI root `/`, which returns **HTTP 200** once the
Flask server is ready. No authentication is required at the transport level, making
`/` a safe probe target on both platforms:

- **Startup probe** — HTTP `GET /`, 15-second initial delay, 10-second period,
  10-retry failure threshold.
- **Liveness probe** — HTTP `GET /`, 30-second initial delay, 30-second period,
  3-retry failure threshold.

The variant guides can override these paths and timings in their own `variables.tf`.

---

For the changedetection.io-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[Changedetection_GKE](Changedetection_GKE.md)** and
**[Changedetection_CloudRun](Changedetection_CloudRun.md)**.
