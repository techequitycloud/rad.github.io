---
title: "Grocy Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Grocy module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Grocy Common — Shared Application Configuration

`Grocy_Common` is the **shared application layer** for Grocy. It is not deployed on
its own; instead it supplies the Grocy-specific configuration that
[Grocy_CloudRun](Grocy_CloudRun.md) builds on (and that a future `Grocy_GKE` will
build on once it is deployed and verified), so platform variants behave identically
where it matters. End users never configure this layer directly — it has no
deployment UI inputs of its own — but understanding what it provides explains the
defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Grocy, see the platform
guide ([Grocy_CloudRun](Grocy_CloudRun.md)) and the foundation guides
([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Grocy_Common | Where it surfaces |
|---|---|---|
| Authentication | Ships with the LinuxServer default `admin` / `admin` login (change on first sign-in). No injectable admin credential exists. | Grocy web UI on first access |
| Service secrets | **None.** `secret_ids` and `secret_values` are both intentionally empty maps. | n/a |
| Container image | Thin-wraps the official `lscr.io/linuxserver/grocy` image so the foundation can mirror it into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | **None** — Grocy uses an internal SQLite database under `/config` (`database_type = "NONE"`), confirmed genuinely SQLite-only against upstream source | §3 |
| Database bootstrap | **None** — there is no `db-init` job; Grocy manages its own SQLite schema on first boot | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket | `storage_buckets` output |
| Core settings | Sets `PUID = 1000`, `PGID = 1000`, `TZ = Etc/UTC` and the container port `80` | Application behaviour in the platform guide |
| Health checks | Supplies the default startup/liveness probes targeting `/` (the login page, `200`) | §5 |

---

## 2. Secrets in Secret Manager

Grocy has **no service secret** — the `secret_ids` and `secret_values` outputs are
both intentionally empty maps. Grocy's admin credentials are entirely file-based
(`config.php` on the persistent `/config` volume), and the upstream LinuxServer.io
image ships default `admin` / `admin` credentials that the operator changes via the
web UI (Users → admin → Edit) on first login. There is no environment variable Grocy
reads to set or override that password, so there is nothing to provision or inject
into Secret Manager for it — the same pattern as this catalogue's other
self-managed-auth SQLite apps (Cloudreve, Prowlarr).

See [App_Common](App_Common.md) for the shared secret and Workload Identity model
used by applications that *do* have secrets.

---

## 3. Database engine and bootstrap

Grocy does **not** use an external database. All of its state — the embedded SQLite
database (`grocy.db`), `config.php`, uploaded images/attachments, and backups — lives
under `/config`. Confirmed by reading Grocy's own upstream source
(`services/DatabaseService.php`): it is genuinely SQLite-only with zero
MySQL/Postgres support at all, and it never enables WAL mode — there is no
`journal_mode` PRAGMA anywhere in the codebase (Grocy uses SQLite's default
DELETE/rollback-journal mode). Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created.
- There is **no `db-init` job** — Grocy initialises its own SQLite database on first
  boot; nothing has to be bootstrapped ahead of time.
- No PostgreSQL extensions, no `pgvector`, and no Redis are involved.

Because the database is a file on the persistent `/config` volume, durability is a
function of the storage backend, not a managed database service (see §5).

---

## 4. Container image and entrypoint

Grocy uses a **thin-wrapper Dockerfile** — it does not add a custom entrypoint
script and runs the upstream image's own entrypoint unchanged:

```dockerfile
ARG GROCY_VERSION=v4.6.0-ls333
FROM lscr.io/linuxserver/grocy:${GROCY_VERSION}
```

- **`image_source = "custom"`** — set purely so the foundation builds/mirrors the
  image into Artifact Registry; there is no application code layered on top.
- **App-specific build ARG** — the Dockerfile reads `GROCY_VERSION`, **not** the
  generic `APP_VERSION` that the foundation injects (and would force to `latest`).
  When `application_version = "latest"` the Common layer pins the build to
  `v4.6.0-ls333`; otherwise it passes the requested version straight through.
- **No entrypoint translation** — Grocy needs no database wiring or URL rewriting at
  boot, so the upstream image's default startup is used as-is.

---

## 5. Core application settings and storage wiring

`Grocy_Common` establishes the minimal environment Grocy needs to come up on first
boot and write its state to the persistent volume:

- **`PUID = "1000"` / `PGID = "1000"`** — the user/group the LinuxServer image drops
  to; owns the `/config` mount so Grocy can read and write its SQLite database.
- **`TZ = "Etc/UTC"`** — container timezone; override via `environment_variables`.
- **Container port `80`** — Grocy serves HTTP on port 80 by default.
- **`enable_gcs_storage_volume`** — a variable on this Common module (default `true`
  here), controlling whether `Grocy_Common` itself injects the `storage` GCS bucket
  as a GCS FUSE volume at `/config`. Every platform variant that wraps this module
  sets it to `false` and mounts `/config` through a different mechanism instead (see
  below), because GCS FUSE cannot sustain Grocy's write pattern.

**Why not GCS FUSE at `/config`, and what each platform variant does instead:**

Grocy writes to `data/grocy.db-journal` every 1–2 seconds. GCS FUSE's
object-storage translation layer cannot sustain that write frequency — confirmed
live on `Grocy_CloudRun` over 12 full boot cycles across 20+ minutes: repeated
`BufferedWriteHandler.OutOfOrderError`, HTTP `429` rate-limiting from GCS, and
stale-file-handle errors, producing a permanent crash-restart loop. This is a
**different** root cause than this catalogue's other SQLite-on-shared-storage
incident (UptimeKuma, which hit WAL-mode lock incompatibility on NFS) — Grocy never
uses WAL mode at all, so its problem is write-frequency, not lock semantics. Read
together, the lesson broadens: gcsfuse can break SQLite for more than one reason,
not just WAL locking.

- **`Grocy_CloudRun`** mounts `/config` over the Foundation's native **NFS** volume
  support instead (`enable_nfs = true`, `nfs_mount_path = "/config"`). NFS's real
  POSIX file semantics (rename/fsync/advisory locks) sustain Grocy's write pattern
  where GCS FUSE cannot. **Verified live:**
  `https://grocycr31ffe08b-kj6qcu2rxa-uc.a.run.app` — 16 curl samples over ~5
  minutes against one stable revision, consistently serving
  `<title>Login | Grocy</title>`, with zero corruption-signature log entries after
  the fix.
- **`Grocy_GKE`** (scaffolded, **not yet deployed or verified**) is planned to mount
  `/config` on a StatefulSet **block PVC** — real block storage, no network
  filesystem at all — following this catalogue's general pattern for GKE variants of
  SQLite-heavy apps (e.g. CalibreWeb_GKE).

---

## 6. Health probe behaviour

Both the startup and liveness probes issue an **HTTP GET `/`**, which returns
Grocy's login page (`200`) and requires **no authentication** — so the probes pass
as soon as the server is serving, independent of any admin login.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the
foundation, which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, with
  `public_access_prevention = "enforced"`.
- On `Grocy_CloudRun` this bucket is provisioned but **not used** to back `/config`
  by default — that mount goes through NFS instead (see §5). It remains available
  for any custom `gcs_volumes` an operator adds.

List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Grocy-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guide:
**[Grocy_CloudRun](Grocy_CloudRun.md)**.
