---
title: "Ntfy Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Ntfy module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Ntfy Common — Shared Application Configuration

`Ntfy_Common` is the **shared application layer** for ntfy. It is not deployed on
its own; instead it supplies the ntfy-specific configuration that both
[Ntfy_GKE](Ntfy_GKE.md) and [Ntfy_CloudRun](Ntfy_CloudRun.md) build on, so the two
platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs ntfy, see the platform
guides ([Ntfy_GKE](Ntfy_GKE.md), [Ntfy_CloudRun](Ntfy_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Ntfy_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `binwiederhier/ntfy` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | **None** — `database_type = "NONE"`. ntfy has no external database; its message cache is a local SQLite file | §Database in the platform guides |
| Database bootstrap | **None** — no `db-init` job is injected. `initialization_jobs` is passed through unchanged (empty by default) | `initialization_jobs` output |
| Cryptographic secrets | **None** — `secret_ids` is empty. ntfy needs no deploy-time credentials; access control is configured post-deploy in ntfy's own user/token store | — |
| Object storage | **None** — `storage_buckets` is empty | `storage_buckets` output |
| Core settings | Sets the baseline ntfy environment: listen address (`:80`) and SQLite cache path (`NTFY_CACHE_FILE`) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/v1/health` | §Observability in the platform guides |

The shape of the `config` output (the object both variants consume) is fixed here:
`container_port = 80`, `database_type = "NONE"`, `image_source = "custom"`,
`enable_image_mirroring = true`, and an empty `initialization_jobs` /
`secret_ids` / `storage_buckets` set.

---

## 2. No secrets, no database, no buckets

Unlike most application modules, `Ntfy_Common` generates **nothing** in Secret
Manager and provisions **no** Cloud SQL instance or GCS bucket:

- `secret_ids = {}` and `secret_values = {}` — there are no auto-generated
  credentials to inject. ntfy is a stateless pub/sub relay; it does not connect to
  an external database and needs no bootstrap password or encryption key.
- `storage_buckets = []` — ntfy keeps everything it needs (its message cache and,
  if enabled, its auth database) in a local SQLite file, not object storage.
- `database_type = "NONE"` — no Cloud SQL for PostgreSQL/MySQL is created. The
  database-related variables that appear in the platform guides (`db_name`,
  `db_user`, `enable_cloudsql_volume`, `database_password_length`, …) are inert
  unless you explicitly opt in to an external database, which ntfy does not require.

**Access control is a post-deploy step.** If you want to require authentication for
publishing/subscribing to topics, configure ntfy's own users and access-control
tokens after deployment using its CLI (`ntfy user add`, `ntfy access …`) or the
`NTFY_AUTH_*` environment variables. Those live in ntfy's SQLite auth file, not in
Secret Manager.

---

## 3. Container image and entrypoint

The custom image is a thin wrapper over the official ntfy server image:

```dockerfile
ARG NTFY_VERSION=v2.11.0
FROM binwiederhier/ntfy:${NTFY_VERSION}
USER root
COPY ntfy-entrypoint.sh /usr/local/bin/ntfy-entrypoint.sh
RUN chmod +x /usr/local/bin/ntfy-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/ntfy-entrypoint.sh"]
```

- **App-specific build ARG.** The base tag is driven by `NTFY_VERSION`, **not** the
  generic `APP_VERSION` that the foundation injects. ntfy publishes `v`-prefixed
  tags (e.g. `v2.11.0`) and has no `latest-<x>` variant, so `application_version =
  "latest"` maps to a pinned recent release (`v2.11.0`) — a fresh build never
  resolves a non-existent tag. This is set in `Ntfy_Common` via
  `ntfy_image_version = var.application_version == "latest" ? "v2.11.0" : var.application_version`.
- **Built via Cloud Build and mirrored.** `image_source = "custom"` with
  `enable_image_mirroring = true`, so the built image lands in the project's
  Artifact Registry rather than being pulled from Docker Hub at runtime.
- **The entrypoint runs `ntfy serve`** as PID 1 after preparing the cache directory
  (see below).

---

## 4. Core application settings and the SQLite cache

`Ntfy_Common` establishes the baseline ntfy environment so the server comes up
correctly on first boot:

- **`NTFY_LISTEN_HTTP = ":80"`** — the bind address, matching `container_port = 80`.
- **`NTFY_CACHE_FILE = "/var/cache/ntfy/cache.db"`** — the SQLite message cache. Its
  directory must be writable before ntfy opens the database.

The entrypoint (`ntfy-entrypoint.sh`) handles the one platform quirk that would
otherwise silently break a baseline deploy:

> Cloud Run runs the container with a **read-only root filesystem**, so
> `mkdir -p /var/cache/ntfy` fails with "Read-only file system" and, under `set -e`,
> would exit the container before ntfy ever starts (appearing as a startup-probe
> timeout). The entrypoint tries to create and write the configured cache dir; if it
> is not writable it **falls back to `/tmp/ntfy`** (the only writable path on a
> read-only rootfs). This keeps an NFS-less deploy healthy while still honouring a
> writable NFS or block-PVC mount when one is provided.

**Persistence model.** With the default ephemeral cache, message history is lost on
every container restart/redeploy — which is fine for a pure real-time relay. For
**durable message history**, back `NTFY_CACHE_FILE` with persistent storage:

- **Cloud Run / GKE:** enable NFS (`enable_nfs = true`) and point the cache dir at
  the mount.
- **GKE only:** use a StatefulSet block PVC (`stateful_pvc_enabled = true` with
  `stateful_pvc_mount_path = "/var/cache/ntfy"`).

---

## 5. Health probe behaviour

The default startup and liveness probes target **`/v1/health`** — ntfy's built-in
health endpoint, which returns HTTP 200 with `{"healthy":true}` once the server is
listening. Because ntfy has no database migrations or heavy initialisation, it
becomes healthy within seconds of boot; the generous default startup window
(30-second initial delay, 30 retries) is conservative headroom rather than a
requirement.

---

For the ntfy-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Ntfy_GKE](Ntfy_GKE.md)** and **[Ntfy_CloudRun](Ntfy_CloudRun.md)**.
