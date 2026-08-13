---
title: "Seerr Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Seerr module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Seerr Common — Shared Application Configuration

`Seerr_Common` is the **shared application layer** for Seerr. It is not
deployed on its own; instead it supplies the Seerr-specific configuration
that both [Seerr_GKE](Seerr_GKE.md) and [Seerr_CloudRun](Seerr_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI
inputs of its own — but understanding what it provides explains the defaults
you see in the platform docs.

For the infrastructure that actually provisions and runs Seerr, see the
platform guides ([Seerr_GKE](Seerr_GKE.md), [Seerr_CloudRun](Seerr_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What Seerr is

Seerr is the **February 2026 merger of Jellyseerr and Overseerr** into a
single project — a MIT-licensed, ~11.9k-star (pre-merger figure) request UI
that sits in front of a Jellyfin, Plex, or Emby media server. Users browse
and request titles; an admin approves the request, and Seerr calls Sonarr's
and Radarr's APIs to trigger acquisition. The official image is
`ghcr.io/seerr-team/seerr` — this catalogue correctly uses that path, not the
older, now-superseded `ghcr.io/fallenbagel/jellyseerr`.

## 2. What this layer provides

| Area | Provided by Seerr_Common | Where it surfaces |
|---|---|---|
| Container image | The genuinely prebuilt `ghcr.io/seerr-team/seerr` image — no custom build | `container_image` output of the platform deployment |
| Database engine | PostgreSQL 15, with the `DB_TYPE=postgres` env var set unconditionally | §3 below |
| Authentication | **No credentials seeded at all** — Seerr's first admin comes from its own web setup wizard | `secret_ids` output (empty `{}`) |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/app/config`, with a GKE-specific permission fix | `storage_buckets` output; §5 below |
| Health checks | Supplies the default startup/liveness probes targeting `/api/v1/status` | §6 below |

## 3. The DB_TYPE trap

Seerr's datasource selection logic, confirmed by reading `/app/dist/datasource.js`
inside the actual running image:

```js
exports.isPgsql = process.env.DB_TYPE === 'postgres';
```

If `DB_TYPE` is not set to exactly `postgres`, Seerr silently falls back to
an in-container SQLite database file — no error, no warning, and a
deployment that otherwise looks completely healthy. Every write, including
Seerr's own first-run setup, goes to a file wiped clean on the next restart
or cold start. This is the same class of "deploy looks successful, data
silently goes nowhere durable" bug this catalogue has documented in other
modules (Wallabag's `SYMFONY__ENV__DATABASE_DRIVER`, Nextcloud's and Twenty's
weak "is this installed?" checks).

`Seerr_Common` closes the gap unconditionally:

```hcl
environment_variables = merge(
  { DB_TYPE = "postgres" },
  var.environment_variables
)
```

`DB_TYPE` is listed first in the `merge()` call so a caller's own
`environment_variables` cannot silently drop it unless it explicitly sets
`DB_TYPE` to something else.

Seerr's connection variables otherwise follow the Foundation's standard
naming — `DB_HOST` / `DB_PORT` (default `5432`) / `DB_USER` / `DB_NAME`
(default `seerr`) — **except the password**, which Seerr reads as `DB_PASS`,
not `DB_PASSWORD` (confirmed against the same `datasource.js` source). Both
Application Modules set `db_password_env_var_name = "DB_PASS"` to match.
Migrations run automatically: Seerr's `dist/index.js` calls
`dbConnection.runMigrations()` on every boot, so **no separate `db-init`/
migrate job exists in this module.**

## 4. Two distinct pieces of state

This is the single most important, non-obvious fact about Seerr's storage
model, discovered by direct container inspection rather than from
documentation:

```bash
docker exec <container> ls /app/config
# settings.json  settings.old.json  db/  logs/
```

Even with PostgreSQL fully configured and connected, Seerr still writes its
**own application settings** — connected media servers (Jellyfin/Plex/Emby),
discovery sliders, notification agents — to a plain `settings.json` file
under `CONFIG_DIRECTORY` (default `/app/config`). PostgreSQL holds request
and user data; `settings.json` holds everything else, and this is true
**regardless of the database backend**. A persistent volume at `/app/config`
is required in addition to the Postgres connection, or every app-level
configuration choice is lost on the next cold start even though the request
history in Postgres survives untouched.

`Seerr_Common` mounts a GCS-backed volume at this path whenever
`enable_gcs_storage_volume = true` (the default on both platforms).

## 5. The GKE GCS-FUSE UID/GID bug

Seerr's container runs as `uid=1000/gid=1000` (the `node` user — confirmed
via `docker run ghcr.io/seerr-team/seerr id`), and on first boot attempts
`mkdir '/app/config/logs/'`.

- **On Cloud Run**, the platform's own gcsfuse integration automatically
  applies `uid:1000/gid:1000` to the mounted volume — this works with no
  extra configuration.
- **On GKE**, the **GCS FUSE CSI driver does not default to a writable
  UID.** Without an explicit fix, the mount is root-owned and the non-root
  container crash-loops with `EACCES: permission denied`.

`Seerr_Common` fixes this for both platforms uniformly with explicit
`mount_options` on the storage volume it declares:

```hcl
locals {
  _seerr_extra_storage_volumes = var.enable_gcs_storage_volume ? [
    {
      name       = "storage"
      mount_path = "/app/config"
      read_only  = false
      mount_options = [
        "implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s",
        "uid=1000", "gid=1000", "file-mode=0664", "dir-mode=0775",
      ]
    }
  ] : []
}
```

The `uid`/`gid`/`file-mode`/`dir-mode` options are a harmless no-op on Cloud
Run and load-bearing on GKE. This is a known bug class in this catalogue —
the fleet-wide "GKE gcsfuse UID/GID permission denied" finding was
previously hit and fixed on Paperless, CodeServer, and CloudBeaver's GKE
variants; Seerr is the latest confirmed instance, now fixed at this shared
layer so both Application Modules inherit it identically.

## 6. Health probe defaults

Both the startup and liveness probes target **`GET /api/v1/status`**, which
returns an unauthenticated `200` with JSON (`{"version":...,"commitTag":...}`)
once the app is ready — confirmed via local container testing and a live
deployment on both platforms.

- **Startup probe** — `initial_delay = 20s`, `timeout = 10s`, `period = 15s`,
  `failure_threshold = 20`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

## 7. Prebuilt image — no custom build

Unlike apps in this catalogue that layer a thin custom Dockerfile onto an
upstream image, `Seerr_Common` sets `image_source = "prebuilt"` and
`container_build_config.enabled = false`. The `scripts/` subdirectory is
empty — no Dockerfile, no cloud entrypoint, no build step. The Foundation
deploys `ghcr.io/seerr-team/seerr` directly at the requested
`application_version` tag.

## 8. No credentials seeded — by design

`secret_ids` outputs an **empty map (`{}`)**. Unlike many applications in
this catalogue that generate an admin password in Secret Manager,
`Seerr_Common` seeds none — Seerr's first admin account is created entirely
through the app's own web-based setup wizard on first access, backed by the
already-provisioned PostgreSQL database. The only Secret Manager secret
associated with a Seerr deployment is the Foundation's own generated
database password.

## 9. Single-writer concurrency

`Seerr_Common`'s own `max_instance_count` variable defaults to `1`, because
`settings.json` is a single mutable file rather than a database with
transactional writes — concurrent instances risk a lost-write race on that
file.

**This default is not what actually reaches a deployment**, however: both
`Seerr_CloudRun` and `Seerr_GKE`'s own `max_instance_count` variables default
to `5`, and each variant forwards `var.max_instance_count` into
`Seerr_Common`, overriding its internal default of `1`. Operators who need
the conservative, single-writer-safe behavior should set
`max_instance_count = 1` explicitly at the Application Module level.

---

For the Seerr-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Seerr_GKE](Seerr_GKE.md)** and
**[Seerr_CloudRun](Seerr_CloudRun.md)**.
