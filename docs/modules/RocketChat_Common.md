---
title: "Rocket.Chat Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Rocket.Chat module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Rocket.Chat Common — Shared Application Configuration

`RocketChat_Common` is the **shared application layer** for Rocket.Chat. It is not
deployed on its own; instead it supplies the Rocket.Chat-specific configuration that
[RocketChat_GKE](RocketChat_GKE.md) builds on. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

**GKE-only.** Rocket.Chat bundles its own MongoDB replica set (`rs0`), which needs a
real block device for WiredTiger — Cloud Run's storage model (gcsfuse-backed volumes
only) cannot back it, and every deploy attempt there fails startup probes on
WiredTiger fallocate errors. `RocketChat_CloudRun` has been removed from the catalog
for this reason; deploy on GKE Autopilot with `stateful_pvc_enabled = true` instead.

For the infrastructure that actually provisions and runs Rocket.Chat, see the
[RocketChat_GKE](RocketChat_GKE.md) platform guide and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by RocketChat_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `rocketchat/rocket.chat` image, bakes in a single-node **MongoDB 6.0 replica set** and a custom entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Datastore | Fixes `database_type = "NONE"` — no Cloud SQL. Rocket.Chat's MongoDB is embedded in the container | §Datastore in the platform guides |
| Persistence | Declares the **Cloud Storage** data bucket and mounts the MongoDB data directory (`/data/db`) onto persistent storage (PVC on GKE, GCS volume on Cloud Run) | `storage_buckets` output |
| Replica set bootstrap | The entrypoint initiates the `rs0` replica set on first boot and waits for it to reach `PRIMARY` before starting Rocket.Chat | Application behaviour in the platform guides |
| Core settings | Sets the baseline Rocket.Chat environment: `MONGO_URL`, `MONGO_OPLOG_URL`, `ROOT_URL`, `PORT`, `MONGO_DBPATH` | Application behaviour in the platform guides |
| Optional API token | Generates a random API key in **Secret Manager** when `enable_api_key = true` (injected under the env var name `QDRANT__SERVICE__API_KEY` — a leftover from the module this was cloned from; Rocket.Chat's own entrypoint does not read it) | `api_key_secret_id` / `secret_ids` outputs |
| Health checks | Supplies the default startup/liveness probe targeting `/api/info` | §Observability in the platform guides |

---

## 2. Why the MongoDB replica set is embedded

Rocket.Chat is a Node.js/Meteor application, and Meteor's real-time reactivity is
driven by **tailing the MongoDB oplog**. A standalone `mongod` has no oplog, so
Rocket.Chat *requires* a MongoDB **replica set** — not just any MongoDB. None of the
managed datastores on this platform (Cloud SQL, Memorystore) provide a MongoDB
replica set, so `RocketChat_Common` bundles a **single-node replica set (`rs0`)
into the container image** and runs it alongside the application:

- MongoDB and Rocket.Chat communicate over **`127.0.0.1`** inside the same
  container/pod, so the replica set can advertise `127.0.0.1:27017` and same-container
  clients follow the advertised host with no cross-Service DNS to resolve.
- The image derives from `rocketchat/rocket.chat`, which is based on **Debian
  bullseye** (glibc 2.31). The Dockerfile therefore installs **MongoDB 6.0 from the
  bullseye APT repository** — the bookworm / MongoDB 7.0 package requires glibc ≥ 2.34
  and will not install on the Rocket.Chat base image.
- The MongoDB data directory `/data/db` (`MONGO_DBPATH`) is mounted onto **persistent
  block storage**. On GKE this is a StatefulSet PVC; on Cloud Run it is a GCS-backed
  volume. **MongoDB's WiredTiger storage engine requires a real block filesystem** —
  see the platform guides for the storage caveat.

The entrypoint (`scripts/entrypoint.sh`) runs on every container start and is
idempotent:

1. Starts `mongod --replSet rs0 --bind_ip 127.0.0.1 --dbpath /data/db` in the
   background,
2. Waits for `mongod` to accept connections,
3. Initiates the replica set (`rs.initiate`) once — skipped if already initiated,
4. Waits until the node reports `isWritablePrimary`,
5. Exports `MONGO_URL=mongodb://127.0.0.1:27017/rocketchat?replicaSet=rs0` and
   `MONGO_OPLOG_URL=mongodb://127.0.0.1:27017/local?replicaSet=rs0`,
6. Sets `ROOT_URL` to the computed service URL and `PORT=3000`,
7. Launches Rocket.Chat with `exec node main.js`.

---

## 3. Container image and entrypoint

The custom image wraps `rocketchat/rocket.chat:<version>` and adds the MongoDB
server, the `mongosh` shell, and the cloud entrypoint. Two build details matter:

- **App-specific version ARG.** The Dockerfile reads a `ROCKETCHAT_VERSION` build
  arg, *not* the generic `APP_VERSION` the foundation injects (which it would force
  to `latest`). When `application_version = "latest"`, `RocketChat_Common` pins the
  build to a known-good release (`6.12.1`); pin `application_version` to a specific
  tag for reproducible deployments.
- **Baked into the image.** The entrypoint, the MongoDB install, and the version pin
  are all baked into the custom image — changing them requires a rebuild (bump
  `application_version`), not just a re-apply.

---

## 4. Core application settings

`RocketChat_Common` establishes the baseline Rocket.Chat environment so the
application comes up correctly on first boot:

- **`MONGO_DBPATH = "/data/db"`** — the MongoDB data directory, mounted on persistent
  storage so chats, users, and settings survive restarts.
- **`MONGO_URL` / `MONGO_OPLOG_URL`** — set by the entrypoint once the embedded
  replica set reaches `PRIMARY`; both point at `127.0.0.1:27017` with `replicaSet=rs0`.
- **`ROOT_URL`** — how the browser reaches Rocket.Chat; defaults to the computed
  Cloud Run / GKE service URL. Operators override it with a custom domain.
- **`PORT = 3000`** — Rocket.Chat listens on port 3000.
- **`OVERWRITE_SETTING_Show_Setup_Wizard = "pending"`** — keeps the first-run setup
  wizard available on a clean headless boot.

No cryptographic application secrets are generated here — unlike database-backed apps,
Rocket.Chat mints its own keys during first-run setup and stores them in its own
MongoDB. The one optional secret is the API token below.

---

## 5. Optional API token in Secret Manager

When `enable_api_key = true`, a random 32-character token is generated and stored in
**Secret Manager** (secret name `secret-<prefix>-<app>-api-key`). It is exposed via
the `api_key_secret_id` and `secret_ids` outputs so it can be injected into the
container or consumed by external integrations. When `enable_api_key = false` (the
default) no secret is created.

**Caveat — vestigial env var name.** The `secret_ids`/`secret_values` outputs key
the token under `QDRANT__SERVICE__API_KEY`, a name inherited from the module this
one was cloned from (Qdrant's REST/gRPC API-key convention), not a real Rocket.Chat
setting. `RocketChat_CloudRun` injects it as that literal env var name via
`module_secret_env_vars`; `RocketChat_GKE` routes the same value through
`explicit_secret_values` instead (a raw `QDRANT__SERVICE__API_KEY` key is not
representable as a GKE SecretSync `targetKey`, which forbids consecutive
underscores). In both cases Rocket.Chat's own entrypoint and application code never
read this variable — Rocket.Chat's REST API authenticates via login-issued
`X-Auth-Token`/`X-User-Id` headers or Personal Access Tokens created in the admin
UI, not a static env var. Treat `enable_api_key` as "mint a token into Secret
Manager for your own external tooling," not as something that changes Rocket.Chat's
own API auth behaviour.

Retrieve it after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~api-key"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 6. Object storage

A dedicated **Cloud Storage** bucket (`storage` suffix) is declared here and
provisioned by the foundation, which also grants the workload service account access.
On Cloud Run it backs the MongoDB data volume; on GKE it is available for backups and
uploaded-file storage alongside the StatefulSet PVC. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 7. Health probe behaviour

The default probes target **`/api/info`** — the Rocket.Chat info endpoint that
returns a JSON payload (version and status) once the server is fully initialised and
connected to its MongoDB replica set. A generous startup window accommodates the
replica-set election and Rocket.Chat's own boot migrations on first start.

- **Startup probe** — HTTP `GET /api/info`, 15-second initial delay, 10-second
  period, 10-retry window.
- **Liveness probe** — HTTP `GET /api/info`, 30-second initial delay, 30-second
  period, 3-retry window.

---

For the Rocket.Chat-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guide:
**[RocketChat_GKE](RocketChat_GKE.md)**. (There is no `RocketChat_CloudRun` — see
the note at the top of this guide for why Cloud Run can't back Rocket.Chat's embedded
MongoDB.)
