---
title: "Homepage Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Homepage module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Homepage Common — Shared Application Configuration

`Homepage_Common` is the **shared application layer** for Homepage. It is
not deployed on its own; instead it supplies the Homepage-specific
configuration that [Homepage_CloudRun](Homepage_CloudRun.md) (and, once
deployed, `Homepage_GKE`) build on, so both platform variants behave
identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Homepage, see the
platform guide ([Homepage_CloudRun](Homepage_CloudRun.md)) and the foundation
guides ([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Homepage_Common | Where it surfaces |
|---|---|---|
| Authentication / secrets | **None.** Homepage has no login of its own and needs no generated credentials | n/a — `secret_ids` and `secret_values` are both empty |
| Container image | References the genuinely prebuilt `ghcr.io/gethomepage/homepage` image directly — no Dockerfile, no Cloud Build step | `container_image` output |
| Database engine | **None** — Homepage's entire configuration and state is a set of YAML files on disk (`database_type = "NONE"`) | §Database in the platform guide |
| Database bootstrap | **None** — no `db-init` job; nothing needs to exist before Homepage's first boot | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/app/config` | `storage_buckets` output |
| Core settings | Fixes the container port to `3000`; sets `PUID=1000`/`PGID=1000`; sets `HOMEPAGE_ALLOWED_HOSTS` | Application behaviour in the platform guide |
| Health checks | Supplies default startup/liveness probes targeting `GET /api/healthcheck` — an accurate, non-placeholder default | §Observability in the platform guide |

---

## 2. Secrets

Homepage has **no secrets at all**. Both the `secret_ids` and `secret_values`
outputs of this module are hardcoded to empty maps. There is no database
credential, no encryption key, no admin password, and no API token —
Homepage has no authentication system of its own. If you need to restrict who
can reach the dashboard, that has to happen at the platform level (IAP, a
VPN, or a reverse proxy in front of the Cloud Run service), not inside this
module.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~homepage"
# expect: no results
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity
model used by applications that *do* have secrets.

---

## 3. Database engine and bootstrap

Homepage does not use a database of any kind — external or embedded. All of
its configuration and behaviour comes from a handful of YAML files
(`settings.yaml`, `services.yaml`, `bookmarks.yaml`, `widgets.yaml`,
`docker.yaml`) read live from disk on every request; there is no schema to
migrate and no in-process cache to invalidate.

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is
  created.
- No `db-init` job, and no first-boot bootstrap beyond the upstream image's
  own entrypoint, which self-seeds any *missing* default config file from its
  bundled defaults on every boot — this requires `/app/config` to be
  genuinely writable (see §6).
- No Redis. `Homepage_CloudRun`'s `main.tf` hardcodes `enable_redis = false`,
  overriding `App_CloudRun`'s own default of `true`.

---

## 4. Container image

Unlike most Common modules in this catalogue, `Homepage_Common` references
the upstream image directly rather than building a custom one:

- **`image_source = "prebuilt"`**, `container_build_config.enabled = false`
  — no Dockerfile, no Cloud Build step for the application image.
- **`enable_image_mirroring = true`** by default still copies the pulled
  image into Artifact Registry (avoids GHCR rate limits) — a mirror, not a
  build.
- `ghcr.io/gethomepage/homepage` ships a real, working `latest` tag as well
  as real semver tags, so `application_version` passes straight through with
  no pinning logic required.

---

## 5. Core application settings

`Homepage_Common` establishes the minimal environment Homepage needs on
first boot:

- **`PUID=1000` / `PGID=1000`** — Homepage's image runs as root by default
  but supports LinuxServer-style `PUID`/`PGID` variables to drop privileges;
  the upstream `docker-entrypoint.sh` chowns `/app/config`,
  `/app/config/logs`, and `/app/.next` to match. These values are mirrored in
  the GCS FUSE mount's `mount_options` (see §7).
- **`HOMEPAGE_ALLOWED_HOSTS = "*"`** by default — gates the `Host` header on
  Homepage's `/api/*` widget-data calls only. `"*"` is upstream's own
  documented escape hatch, used here because predicting the exact
  platform-assigned hostname at plan time is unreliable.
- **Nothing else to configure at boot** — no telemetry flag, no queue mode,
  no execution-mode setting, and no admin account to seed.

Platform-specific mounting of `/app/config`:

- **Cloud Run** mounts the `storage` bucket at `/app/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE**, once deployed, will use a StatefulSet PVC at the same path when
  `stateful_pvc_enabled = true`, setting `enable_gcs_storage_volume = false`
  to avoid a double-mount.

---

## 6. Health probe behaviour

`Homepage_Common` declares `startup_probe`/`liveness_probe` variables
targeting **`GET /api/healthcheck`** — this is a genuinely accurate default
(matching the image's own baked-in `HEALTHCHECK` directive), unlike several
other Common modules in this catalogue whose placeholder probe defaults get
overridden downstream. `Homepage_CloudRun` forwards these unchanged:

- **Startup probe** — `initial_delay = 10s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

Confirmed live: `GET /api/healthcheck` returns an unauthenticated `200 "up"`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the
foundation, which also grants the workload service account access:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~homepage"
```

**Note on the mount UID/GID.** `Homepage_Common` requests
`uid=1000,gid=1000` (matching `PUID`/`PGID`) plus `file-mode=0664`/
`dir-mode=0775` in the GCS volume's `mount_options`. On a live Cloud Run
deployment, this is **not** what actually gets mounted — Cloud Run's own
built-in gcsfuse integration silently substitutes its own `uid=2000,gid=2000`
regardless of the configured `mount_options` (confirmed via the GCSFuse "CLI
Flags" log line at deploy time). This had no functional impact in production
— the mount stayed self-consistent and writable — but it means the
configured `mount_options` UID/GID are not literally honored on Cloud Run.
This is specific to Cloud Run's own gcsfuse integration; GKE's separate GCS
FUSE CSI driver has no equivalent override and genuinely requires the
configured UID/GID to match the container's user (see the "GKE gcsfuse
UID/GID permission denied" finding referenced elsewhere in this repository).

---

For the Homepage-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guide: **[Homepage_CloudRun](Homepage_CloudRun.md)**.
