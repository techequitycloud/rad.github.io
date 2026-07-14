---
title: "Budibase Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Budibase module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Budibase Common — Shared Application Configuration

`Budibase_Common` is the **shared application layer** for Budibase. It is not
deployed on its own; instead it supplies the Budibase-specific configuration that
both [Budibase_GKE](Budibase_GKE.md) and [Budibase_CloudRun](Budibase_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Budibase, see the platform
guides ([Budibase_GKE](Budibase_GKE.md), [Budibase_CloudRun](Budibase_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Budibase_Common | Where it surfaces |
|---|---|---|
| Internal credentials | Generates seven stable secrets — `INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, and the CouchDB admin password — and stores them in **Secret Manager** | Injected automatically as service secret env vars; retrieve via Secret Manager (see below) |
| Container image | Builds a **thin pass-through wrapper** `FROM budibase/budibase` (the official all-in-one image) via Cloud Build, pinning the base tag through an app-specific `BUDIBASE_VERSION` build ARG | `container_image` output of the platform deployment |
| Database engine | **`database_type = "NONE"`** — Budibase bundles its own **CouchDB** (plus MinIO and Redis) inside the single container; there is no external managed database | §Application behaviour in the platform guides |
| State model | All state lives on the container data directory `/data` (CouchDB documents + MinIO object store), keyed with the generated secrets | §Persistence in the platform guides |
| Object storage | Declares one **Cloud Storage** bucket (suffix `storage`) provisioned by the foundation | `storage_buckets` output |
| Core settings | Sets the baseline Budibase environment: self-hosted production mode, CouchDB admin user, log level, port `80` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting the unauthenticated root path `/` | §Observability in the platform guides |

---

## 2. Internal credentials in Secret Manager

Budibase's all-in-one image runs CouchDB, MinIO, Redis, and the app/worker/proxy
processes together, and it keys the data on `/data` with a set of internal
credentials. `Budibase_Common` generates each one **once**, stores it in Secret
Manager, and injects it into the running container as a **service** secret env var.
These values **must stay constant across restarts** — if any of them changes after
first boot, the data already written to `/data` (encrypted/keyed with the old value)
becomes unreadable.

| Secret env var | Purpose |
|---|---|
| `INTERNAL_API_KEY` | Shared key for internal service-to-service calls between the bundled apps/worker |
| `JWT_SECRET` | Signs user session tokens; rotating it logs everyone out |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Credentials for the bundled MinIO object store that holds app assets and attachments |
| `API_ENCRYPTION_KEY` | Encrypts stored secrets/connection credentials; **rotating it corrupts all encrypted data** |
| `REDIS_PASSWORD` | Password for the bundled in-container Redis |
| `COUCH_DB_PASSWORD` | Admin password for the bundled CouchDB (paired with `COUCH_DB_USER`, default `admin`) |

The Secret Manager secret IDs follow the pattern
`secret-<resource-prefix>-<app>-<name>` (for example
`secret-<prefix>-budibase-api-encryption-key`). Retrieve them after deployment:

```bash
# List the Budibase internal-credential secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~budibase"

# Read a specific secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Container image and build

Budibase ships as a prebuilt **all-in-one** image on Docker Hub
(`budibase/budibase`) that bundles CouchDB + MinIO + Redis + the Budibase
apps/worker/proxy and serves HTTP on **port 80**. `Budibase_Common` does **not**
modify the runtime — it builds a **thin pass-through wrapper** so the base image tag
is pinned deterministically:

- `image_source = "custom"` with a one-line `Dockerfile` (`FROM budibase/budibase:${BUDIBASE_VERSION}`),
  built via Cloud Build (Kaniko) and mirrored into Artifact Registry
  (`enable_image_mirroring = true`).
- The base tag is pinned through the app-specific **`BUDIBASE_VERSION`** build ARG,
  **not** the generic `APP_VERSION`. The foundation injects `APP_VERSION = application_version`
  (`"latest"` by default) into `build_args` and wins the merge, so a Dockerfile keyed
  on `APP_VERSION` would always resolve to `:latest`. `BUDIBASE_VERSION` is set by
  `Budibase_Common`'s `build_args` and is never overwritten.
- No `ENTRYPOINT`/`CMD` override — the upstream all-in-one launcher is inherited
  verbatim.

The deployed image and Artifact Registry repo are reported in the platform outputs
(`container_image`, `container_registry`).

---

## 4. Database and first-boot bootstrap

There is **no external managed database** and **no `db-init` job** to run. With
`database_type = "NONE"`, Budibase self-provisions its bundled CouchDB and MinIO on
first boot inside the container. `Budibase_Common` only honours **user-supplied**
`initialization_jobs`; by default the list is empty.

Baseline environment set by this layer:

- `BUDIBASE_ENVIRONMENT = "PRODUCTION"` and `SELF_HOSTED = "1"` — self-hosted
  production mode with all services co-located.
- `COUCH_DB_USER = "admin"` (the paired password is injected as the
  `COUCH_DB_PASSWORD` secret).
- `LOG_LEVEL = "info"`.

Because state lives on `/data`, that directory must be backed by **persistent
storage** or every restart wipes the instance — the GKE variant mounts a block PVC
at `/data`, while Cloud Run has no durable local disk (see the platform guides).

---

## 5. Health probe behaviour

Budibase's bundled nginx proxy serves an unauthenticated `200` at the root path `/`
once the bundled services are up. All three probes target `/`:

- **Startup probe** — HTTP `/`, 60-second initial delay, 15-second period, 40-retry
  window (a generous window because the container must start CouchDB, MinIO, Redis,
  and the app tier before it serves).
- **Liveness probe** — HTTP `/`, 60-second initial delay, 30-second period.
- **Readiness probe** — HTTP `/`, 30-second initial delay, 10-second period.

---

## 6. Object storage

A single **Cloud Storage** bucket (name suffix `storage`, `STANDARD` class,
`public_access_prevention = enforced`) is declared here and provisioned by the
foundation, which also grants the workload service account access. Budibase's own
asset/attachment store is the bundled **MinIO** on `/data`; the GCS bucket is
available for foundation-level storage integration. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Budibase-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Budibase_GKE](Budibase_GKE.md)** and **[Budibase_CloudRun](Budibase_CloudRun.md)**.
