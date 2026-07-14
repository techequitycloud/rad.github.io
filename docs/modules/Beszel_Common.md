---
title: "Beszel Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Beszel module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Beszel Common — Shared Application Configuration

`Beszel_Common` is the **shared application layer** for Beszel. It is not deployed
on its own; instead it supplies the Beszel-specific configuration that both
[Beszel_GKE](Beszel_GKE.md) and [Beszel_CloudRun](Beszel_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Beszel, see the platform
guides ([Beszel_GKE](Beszel_GKE.md), [Beszel_CloudRun](Beszel_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Beszel is a lightweight, open-source server-monitoring hub (built on PocketBase —
Go plus an embedded SQLite database). Its hub serves a web UI and REST API on a
single port; agents installed on monitored machines report CPU, memory, disk,
network, and Docker container stats back to it, and it stores historical data and
raises configurable alerts.

---

## 1. What this layer provides

| Area | Provided by Beszel_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | **None injected.** Beszel has no application secret env vars; `secret_ids` and `secret_values` outputs resolve to empty maps. The first administrator account is created through the web UI on first run. | n/a |
| Container image | Wraps the official `henrygd/beszel` hub image with a thin `Dockerfile` (`FROM henrygd/beszel:${BESZEL_VERSION}`); built via Cloud Build (Kaniko) and mirrored into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | **None** (`database_type = "NONE"`). Beszel embeds its own PocketBase/SQLite database under `/beszel_data`; no Cloud SQL instance is provisioned | §Application behaviour in the platform guides |
| Database bootstrap | **No init job.** Beszel creates and migrates its own SQLite schema on first boot | `initialization_jobs` output (empty) |
| Object storage | Declares one **Cloud Storage** data bucket (suffix `storage`), FUSE-mounted at `/beszel_data` on Cloud Run for persistence | `storage_buckets` output |
| Persistence model | Cloud Run: GCS FUSE bucket at `/beszel_data`; GKE: block PVC (StatefulSet) at `/beszel_data` | §Persistence in the platform guides |
| Core settings | Fixes `container_port = 8090` and a single-instance profile (`min = max = 1`) — one SQLite writer, no scale-out | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/health` (200, unauthenticated) | §Observability in the platform guides |

---

## 2. Secrets — none required

Beszel needs **no injected secret environment variable** for normal operation. The
`Beszel_Common` `secret_ids` and `secret_values` outputs deliberately return empty
maps; they exist only so the Cloud Run and GKE variants can forward them to the
foundation as `module_secret_env_vars` / `explicit_secret_values` for compatibility.

The initial administrator account is created **interactively through the web UI**
the first time you open the hub (PocketBase's first-run superuser flow) — there is
no auto-generated admin password stored in Secret Manager.

Because there are no app-level secrets, a secret listing for this deployment shows
only whatever the foundation itself creates (there is no database password secret,
since Beszel has no Cloud SQL database):

```bash
gcloud secrets list --project "$PROJECT" --filter="name~beszel"
```

See [App_Common](App_Common.md) for the shared Workload Identity model.

---

## 3. Container image and build

The custom image is a thin wrapper over the upstream hub image:

```dockerfile
ARG BESZEL_VERSION=0.9.1
FROM henrygd/beszel:${BESZEL_VERSION}
```

- **App-specific version ARG.** The Dockerfile reads `BESZEL_VERSION`, **not** the
  generic `APP_VERSION` the foundation injects (which it forces to `latest`). When
  `application_version = "latest"`, `Beszel_Common` pins `BESZEL_VERSION = "0.9.1"`
  (the Dockerfile's own sane default) so the base image tag always resolves to a
  real published release; any explicit version is passed straight through.
- **Built, not just referenced.** `image_source = "custom"` with
  `container_build_config.enabled = true`: the foundation runs a Cloud Build
  (Kaniko) that builds the wrapper and pushes it into Artifact Registry, then the
  workload runs from the mirrored image.

Inspect the deployed image and registry:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/$PROJECT/<repo>/beszel --project "$PROJECT"
```

The Artifact Registry repository name is reported in the platform deployment
outputs (`container_registry` / `artifact_registry_repository`).

---

## 4. Database — embedded, no bootstrap

Beszel does **not** use Cloud SQL. `database_type = "NONE"`, `enable_cloudsql_volume
= false`, and no database name/user are set. Beszel embeds a PocketBase-managed
SQLite database (plus its uploaded/backup files) under `/beszel_data` — the image's
default `DATA_DIR`.

Consequently `Beszel_Common` defines **no initialization job**: Beszel creates and
migrates its own schema automatically on first boot, and does so again on every
version upgrade. Custom jobs can still be supplied through `initialization_jobs`
for one-off data-loading or migration tasks, but none is required.

---

## 5. Persistence — `/beszel_data`

All Beszel state (the SQLite database, uploaded config, and historical metrics)
lives under `/beszel_data`. `Beszel_Common` declares a single Cloud Storage data
bucket (suffix `storage`, location left empty so the foundation resolves it to the
deployment region) and, on Cloud Run, mounts it as a **GCS FUSE** volume at
`/beszel_data` (`enable_gcs_storage_volume = true`).

On GKE the app is instead backed by a **block PVC** at the same path. When a
StatefulSet PVC is mounted at `/beszel_data` (`Beszel_GKE` with
`stateful_pvc_enabled = true`, the GKE default), the module sets
`enable_gcs_storage_volume = false` to avoid a double-mount conflict at that path.

Because a single SQLite database file is the source of truth, Beszel is a
**single-writer** application — `min_instance_count = max_instance_count = 1` by
default; do not scale it out.

List the data bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~beszel"
```

---

## 6. Health probe behaviour

The default startup and liveness probes target **`GET /api/health`** — Beszel's
public, unauthenticated health endpoint, which returns `200` once the hub is ready.

- **Startup probe:** HTTP `/api/health`, 15-second initial delay, 10-second period,
  10 retries — a generous window for the first-boot schema creation.
- **Liveness probe:** HTTP `/api/health`, 30-second initial delay, 30-second period,
  3 retries.

Both variants can override these paths in their own `variables.tf`, but the
`/api/health` default is the correct unauthenticated liveness endpoint for the
hub (the UI and `/api/*` data routes require the admin session).

---

For the Beszel-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Beszel_GKE](Beszel_GKE.md)** and **[Beszel_CloudRun](Beszel_CloudRun.md)**.
