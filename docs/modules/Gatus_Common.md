---
title: "Gatus Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Gatus module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Gatus Common — Shared Application Configuration

`Gatus_Common` is the **shared application layer** for Gatus. It is not deployed on
its own; instead it supplies the Gatus-specific configuration that both
[Gatus_GKE](Gatus_GKE.md) and [Gatus_CloudRun](Gatus_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Gatus, see the platform
guides ([Gatus_GKE](Gatus_GKE.md), [Gatus_CloudRun](Gatus_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Gatus_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `ghcr.io/twin/gatus` image — a genuinely distroless static binary — with a baked-in `config.yaml` and an empty writable `/data` directory; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | **None** — `database_type = "NONE"`. Gatus has no external database; its optional history store is a local SQLite file | §Database in the platform guides |
| Database bootstrap | **None** — no init job is injected. `initialization_jobs` is passed through unchanged (empty by default) | `initialization_jobs` output |
| Cryptographic secrets | **None** — `secret_ids` is empty. Gatus needs no deploy-time credentials; optional basic-auth/OIDC protection is configured directly in `config.yaml` | — |
| Object storage | **None** — `storage_buckets` is empty | `storage_buckets` output |
| Core settings | Fixes `container_port = 8080`; endpoints/alerting/storage are entirely file-based (`config.yaml`), not env-var driven | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

The shape of the `config` output (the object both variants consume) is fixed here:
`container_port = 8080`, `database_type = "NONE"`, `image_source = "custom"`,
`enable_image_mirroring = true`, and an empty `initialization_jobs` /
`secret_ids` / `storage_buckets` set.

---

## 2. No secrets, no database, no buckets

Unlike most application modules, `Gatus_Common` generates **nothing** in Secret
Manager and provisions **no** Cloud SQL instance or GCS bucket:

- `secret_ids = {}` and `secret_values = {}` — there are no auto-generated
  credentials to inject. Gatus has no built-in user-account system; it does not
  connect to an external database and needs no bootstrap password or encryption key.
- `storage_buckets = []` — Gatus keeps everything it needs (its optional history
  store) in a local SQLite file, not object storage.
- `database_type = "NONE"` — no Cloud SQL for PostgreSQL/MySQL is created. The
  database-related variables that appear in the platform guides (`db_name`,
  `db_user`, `enable_cloudsql_volume`, `database_password_length`, …) are inert
  unless you explicitly opt in to an external database, which Gatus does not
  require.

**Access control is a config-file step, not a post-deploy step.** If you want to
require authentication to view the status page, configure Gatus's `security` block
(basic auth or OIDC) directly in `modules/Gatus_Common/scripts/config.yaml` and
rebuild the image — there is no runtime API or admin UI for this.

---

## 3. Container image — a genuinely distroless base, no entrypoint wrapper

The custom image is a thin wrapper over the official Gatus server image:

```dockerfile
ARG GATUS_VERSION=v5.36.0

FROM alpine:3.20 AS builder
RUN mkdir -p /data

FROM ghcr.io/twin/gatus:${GATUS_VERSION}
COPY config.yaml /config/config.yaml
COPY --from=builder /data /data

EXPOSE 8080
```

- **App-specific build ARG.** The base tag is driven by `GATUS_VERSION`, **not** the
  generic `APP_VERSION` that the foundation injects. Gatus publishes `v`-prefixed
  tags (e.g. `v5.36.0`) and has no `latest-<x>` variant, so `application_version =
  "latest"` maps to a pinned recent release (`v5.36.0`) — a fresh build never
  resolves a non-existent tag. This is set in `Gatus_Common` via
  `gatus_image_version = var.application_version == "latest" ? "v5.36.0" : var.application_version`.
- **Built via Cloud Build and mirrored.** `image_source = "custom"` with
  `enable_image_mirroring = true`, so the built image lands in the project's
  Artifact Registry rather than being pulled from GHCR at runtime.
- **No shell, no entrypoint wrapper — confirmed via `docker export`.** Unlike every
  other custom-build module in this catalogue, `ghcr.io/twin/gatus` is genuinely
  distroless: the final image contains nothing but the `/gatus` static binary,
  `/config/config.yaml`, and standard `passwd`/`group`/`hosts` files — no shell, no
  busybox, no dynamic linker. A `RUN` step against the final stage would fail
  outright, and there is no way (and no need) to graft a shell-based entrypoint.
  The base image's own `EXPOSE 8080` and `ENTRYPOINT ["/gatus"]` are left completely
  untouched; this Dockerfile only adds two `COPY` layers. A tiny Alpine **builder**
  stage exists purely to create an empty `/data` directory that `COPY --from=builder`
  can carry into the distroless final image (there is no shell in the final stage to
  run `mkdir` itself).

---

## 4. Configuration is entirely file-based — `config.yaml`, not environment variables

Unlike almost every other application module in this catalogue, Gatus has **no
per-setting environment variable convention**. Every monitored endpoint, alerting
integration, and storage setting lives in one YAML file —
`modules/Gatus_Common/scripts/config.yaml` — baked into the image at Cloud Build
time:

```yaml
storage:
  type: sqlite
  path: /data/data.db

endpoints:
  - name: example
    url: "https://example.org"
    interval: 5m
    conditions:
      - "[STATUS] == 200"
      - "[RESPONSE_TIME] < 5000"
```

- **No runtime config-reload API and no admin UI for editing checks.** To add,
  remove, or change a monitored endpoint, edit this file and redeploy (which
  rebuilds the custom image via Cloud Build) — there is no way to do this through
  the running application.
- **`environment_variables`** (forwarded from the platform variables) is for Gatus's
  own `${VAR}`-style substitutions referenced *inside* `config.yaml` (e.g. an
  alerting webhook token), not for per-setting overrides the way most other modules
  use it.

---

## 5. The SQLite history store — hardcoded WAL journal mode, a real persistence caveat

Gatus's optional history store (`storage.type: sqlite`) is confirmed (via a live
`sqlite3 PRAGMA journal_mode;` check against a running container) to **hardcode WAL
journal mode** — no `config.yaml` setting or SQLite connection-string parameter
(`?_journal_mode=DELETE`, tested and confirmed ineffective) disables it. SQLite's own
documentation states that WAL is **not supported on network filesystems**.

This has a direct consequence for persistence options:

- **Default: ephemeral.** `/data` is a plain writable directory baked into the image
  with nothing mounted — history resets on every restart/redeploy. This is the
  module default on both platforms, deliberately, rather than risking silent
  corruption.
- **Cloud Run:** the only optional persistence mechanism is NFS (`enable_nfs =
  true`), which carries the WAL-on-network-filesystem risk described above. There is
  no block-PVC option on Cloud Run, so **there is no fully safe way to persist Gatus
  history on Cloud Run**.
- **GKE:** `stateful_pvc_enabled = true` provisions a real block device (not
  gcsfuse) — this is the **one option in this catalogue verified safe** for Gatus's
  WAL-mode SQLite file. Pair it with `stateful_pvc_storage_class = "standard"` (HDD)
  since Gatus's history store needs no SSD IOPS, and HDD avoids the tight regional
  `SSD_TOTAL_GB` quota that the SSD-backed default class draws on.

---

## 6. Health probe behaviour

The default startup and liveness probes target **`/health`** — Gatus's built-in
health endpoint, which returns HTTP 200 as soon as the Fiber HTTP server binds its
port. Because Gatus has no database migrations or heavy initialisation, it becomes
healthy within seconds of boot.

---

For the Gatus-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Gatus_GKE](Gatus_GKE.md)** and **[Gatus_CloudRun](Gatus_CloudRun.md)**.
