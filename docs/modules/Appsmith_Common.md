---
title: "Appsmith Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Appsmith module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Appsmith Common — Shared Application Configuration

`Appsmith_Common` is the **shared application layer** for Appsmith. It is not
deployed on its own; instead it supplies the Appsmith-specific configuration
that [Appsmith_GKE](Appsmith_GKE.md) builds on. End users never configure
this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform
guide. Appsmith ships **GKE-only** in this repository: Appsmith CE is a
stateful all-in-one container (embedded MongoDB + Redis) that needs a
persistent volume and a single, stable writer, which does not fit Cloud
Run's stateless, scale-to-zero model — there is no `Appsmith_CloudRun`
module to cross-reference.

For the infrastructure that actually provisions and runs Appsmith, see the
platform guide ([Appsmith_GKE](Appsmith_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Appsmith_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `APPSMITH_ENCRYPTION_PASSWORD` (32-char), `APPSMITH_ENCRYPTION_SALT` (32-char), and `APPSMITH_SUPERVISOR_PASSWORD` (24-char) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Points at the official `appsmith/appsmith-ce` Docker Hub "fat" image (`image_source = "prebuilt"`); no Dockerfile or Cloud Build step | `container_image` output of the platform deployment |
| Database engine | Fixes **`database_type = "NONE"`** — Appsmith CE runs its own embedded MongoDB internally; no Cloud SQL instance is provisioned or wired | §Database in the platform guide |
| Database bootstrap | None — no `db-init` job is injected; the fat image self-initialises its embedded MongoDB and Redis on first boot | `initialization_jobs` output (empty unless the caller supplies jobs) |
| Object storage | Declares **no** Cloud Storage bucket — `storage_buckets` always returns `[]` | `storage_buckets` output |
| Persistent state | Sets `enable_nfs`, `nfs_mount_path = "/appsmith-stacks"` for Cloud Run-style NFS; GKE instead prefers a StatefulSet PVC at the same path (see `Appsmith_GKE`) | Application behaviour in the platform guide |
| Core settings | Sets the baseline Appsmith environment: telemetry disabled, no external Mongo/Redis URL overrides | Application behaviour in the platform guide |
| Health checks | Supplies the default startup/liveness probe targeting `/api/v1/health` on port 80 | §Observability in the platform guide |

---

## 2. Cryptographic secrets in Secret Manager

Three secrets are generated automatically and stored in Secret Manager — they
are never set in plain text and must never be changed after the first
deployment:

- **`APPSMITH_ENCRYPTION_PASSWORD`** — a 32-character random alphanumeric
  string (`random_password`, `special = false`). Used together with the salt
  below to secure the AES-256 encryption of datasource credentials and Git
  SSH keys at rest. Rotating it independently of a full data reset makes
  previously-encrypted data permanently unreadable.
- **`APPSMITH_ENCRYPTION_SALT`** — a 32-character random alphanumeric string.
  Paired with `APPSMITH_ENCRYPTION_PASSWORD` for the same at-rest encryption;
  the same rotation caveat applies.
- **`APPSMITH_SUPERVISOR_PASSWORD`** — a 24-character random alphanumeric
  string. Gates the container's internal `/supervisor` process-control
  panel.

A `time_sleep` resource waits 30 seconds after the secret versions are
created before the service or pods are allowed to read them, giving Secret
Manager replication time to complete.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~appsmith"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

There is no separate database password secret — Appsmith CE has no external
database (see below). See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

---

## 3. Database engine and bootstrap

**None (`database_type = "NONE"`).** Appsmith CE's official "fat" image
bundles its own embedded MongoDB and Redis inside the container; there is no
Cloud SQL instance, no `enable_cloudsql_volume` (fixed `false` in this
module), and no `db-init`/migration job. `db_name` and `db_user` variables
exist only for wrapper compatibility with the rest of the module system and
are not used by Appsmith. `initialization_jobs` defaults to `[]` in
`Appsmith_Common` — only jobs explicitly supplied by the calling Application
Module are honoured, and the module's own local computation does not inject
one.

All application state — the embedded Mongo data files, Redis dump, uploaded
assets, plugin data, and Git-connected application config — lives instead
under `/appsmith-stacks`, backed by persistent storage rather than a managed
database (Filestore NFS on Cloud Run-style wiring; a StatefulSet PVC on GKE —
see [Appsmith_GKE](Appsmith_GKE.md)).

---

## 4. Container image and entrypoint

`Appsmith_Common` sets:

```hcl
container_image = "appsmith/appsmith-ce"
image_source     = "prebuilt"
```

The official Community Edition "fat" image is deployed directly from Docker
Hub — there is no Dockerfile, no `container_build_config` (explicitly
disabled: `enabled = false`), and no custom entrypoint script shipped by this
module (the module's `scripts/` directory is empty). The image bundles an
embedded MongoDB, Redis, the Java backend, and the React client behind an
internal nginx reverse proxy, all served on **port 80**
(`container_port = 80`). `enable_image_mirroring` (default `true`, forwarded
from the caller) copies the image into Artifact Registry so the deployment
pulls from Google's network instead of Docker Hub directly, avoiding rate
limits.

Because the entrypoint is entirely upstream (unmodified from the Docker Hub
image), there is no `DB_*`-to-native-env translation step of the kind other
Common modules provide — Appsmith never receives external database
connection details in the first place.

---

## 5. Core application settings

`Appsmith_Common` establishes the baseline Appsmith environment so the
application comes up correctly on first boot:

- **Telemetry** — `APPSMITH_DISABLE_TELEMETRY = "true"` by default (disabled;
  no anonymous usage data sent to Appsmith's cloud).
- **No external datastore overrides** — the module deliberately does **not**
  set `APPSMITH_DB_URL` or `APPSMITH_REDIS_URL`. The fat image's internal
  Mongo/Redis clients default to `localhost`; setting either would point
  Appsmith at a non-existent external datastore and prevent boot.
- **Postgres extensions** — `enable_postgres_extensions = false`,
  `postgres_extensions = []` (fixed; not applicable, no Postgres backend).
- Caller-supplied `environment_variables` are merged in last and take
  precedence over the `APPSMITH_DISABLE_TELEMETRY` default.

Platform-specific persistence adjustments handled here:

- **Cloud Run-style wiring** exposes `enable_nfs` (forwarded from the
  caller) and `nfs_mount_path = "/appsmith-stacks"` for a Filestore-backed
  volume.
- **GKE** ([Appsmith_GKE](Appsmith_GKE.md)) instead prefers a StatefulSet
  PersistentVolumeClaim mounted at the same path, since a single embedded
  MongoDB does its own file locking and is better served by a per-pod block
  volume than shared NFS.

Because a single embedded MongoDB instance owns the data directory, the
calling Application Module must keep the workload to a single writer
(`min_instance_count = max_instance_count = 1`) to avoid concurrent-writer
corruption.

---

## 6. Health probe behaviour

The default probes target `GET /api/v1/health` on port 80 — the endpoint the
fat image's nginx/backend returns HTTP 200 for once the embedded MongoDB,
Redis, and Java backend have all finished initialising.

- **Startup probe** — HTTP `/api/v1/health`, `initial_delay_seconds = 120`,
  `period_seconds = 15`, `failure_threshold = 40` (a window of roughly ten
  minutes), accommodating the slow first boot of the bundled
  Mongo+Redis+Java stack.
- **Liveness probe** — the same path with tighter steady-state thresholds:
  `initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`.

---

## 7. Object storage

None. The `storage_buckets` output is hard-coded to an empty list — Appsmith
CE persists all state (embedded Mongo, Redis, uploads, Git-connected app
data) on the `/appsmith-stacks` NFS/PVC volume rather than in Cloud Storage,
so no GCS bucket is declared by this layer.

---

For the Appsmith-specific, user-facing configuration (variables by group,
outputs, and how to explore the service from the Console and CLI), see the
platform guide: **[Appsmith_GKE](Appsmith_GKE.md)**.
