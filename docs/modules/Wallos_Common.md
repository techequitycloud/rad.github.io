---
title: "Wallos Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Wallos module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Wallos Common — Shared Application Configuration

`Wallos_Common` is the **shared application layer** for Wallos. It is
not deployed on its own; instead it supplies the Wallos-specific configuration
that both [Wallos_GKE](Wallos_GKE.md) and [Wallos_CloudRun](Wallos_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Wallos, see the
platform guides ([Wallos_GKE](Wallos_GKE.md), [Wallos_CloudRun](Wallos_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Wallos_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | **None.** Wallos stores its users inside its own embedded SQLite database; no Secret Manager env vars are generated | `secret_ids` / `secret_values` outputs are intentionally empty |
| Container image | Pulls `bellamy/wallos` **directly** — a genuine prebuilt third-party image, no Dockerfile or Cloud Build step | `container_image` output of the platform deployment |
| Database engine | Fixes `database_type = "NONE"` — Wallos uses an **embedded SQLite** file; confirmed no MySQL/Postgres support exists anywhere in the app | §Persistence in the platform guides |
| Database bootstrap | **None.** No `db-init` job is injected; `initialization_jobs` is empty unless the operator supplies custom jobs | `initialization_jobs` output |
| Object storage | Declares **two** Cloud Storage buckets: `db` (the SQLite file) and `uploads` (user-uploaded provider logos) | `storage_buckets` output |
| Core settings | Pins the container to port 80; no relocatable-path env vars exist for either persistent directory | Application behaviour in the platform guides |
| Background work | A **real, always-running cron daemon** inside the container (8 baked-in scheduled tasks) | §Scaling constraints in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` (no dedicated `/health` endpoint is documented for this image) | §Observability in the platform guides |

---

## 2. Secrets — none

Wallos needs **no secret environment variables**. Unlike database-backed
applications, it keeps its user table, subscriptions, and settings inside its own
embedded SQLite database. The initial credential is the well-known **`admin` /
`admin`** login, which the operator must change through the web UI on first access.

Consequently the Common layer's `secret_ids` and `secret_values` outputs are
intentionally empty maps, and both variants wire them through unchanged
(`module_secret_env_vars = secret_ids`, `module_explicit_secret_values =
secret_values`). There is no encryption key or JWT secret to preserve across
redeploys — the only durable state is the two SQLite/logo directories on their
respective volumes (see §5).

---

## 3. Container image

Wallos is deployed as a genuinely **prebuilt** image — no Dockerfile, no Cloud
Build step:

- **`image_source = "prebuilt"`**, `container_image = "bellamy/wallos"`.
- `bellamy/wallos` is a real, "latest"-tagged, third-party-maintained image — there
  is no official image published by the Wallos project itself.
- **`enable_image_mirroring`** (default `true`) copies the image into Artifact
  Registry to avoid Docker Hub rate limits; this is orthogonal to the
  prebuilt/custom distinction — it re-hosts the same digest, it does not build
  anything.
- **No custom entrypoint.** The upstream image's own startup launches Wallos
  directly; there is no wrapper script to remap variables.

---

## 4. Database initialization — none

Wallos manages its own storage and requires **no database initialization**. No
`db-init` job is injected, and `database_type` is fixed to `NONE`. The
`initialization_jobs` input is honoured only if the operator supplies custom jobs
— otherwise it stays empty.

On first start Wallos creates its SQLite database at
`/var/www/html/db/wallos.db` if the file does not yet exist and seeds the default
`admin`/`admin` user.

---

## 5. Object storage and persistence

**Two** Cloud Storage buckets are declared here and provisioned by the
Foundation, which also grants the workload service account access:

- **`db`** — mounted at `/var/www/html/db`, holding the SQLite database file
  (`wallos.db`).
- **`uploads`** — mounted at `/var/www/html/images/uploads/logos`, holding
  user-uploaded custom provider logos.

These two paths share no common ancestor other than `/var/www/html` itself (the
PHP application root), so they cannot be consolidated into a single mount without
shadowing the app's own code — each gets its own bucket.

- **Cloud Run** always mounts both buckets as **GCS FUSE** volumes
  (`enable_gcs_db_volume = true`, `enable_gcs_uploads_volume = true`). This is
  safe specifically because `max_instance_count = 1` keeps it single-writer.
- **GKE** mounts the `db` bucket as GCS FUSE **unless** a StatefulSet block PVC is
  used at the same path (`stateful_pvc_enabled = true`, the recommended default),
  in which case Common sets `enable_gcs_db_volume = false` to avoid a double-mount
  conflict. The `uploads` bucket **always** uses GCS FUSE on GKE regardless — a
  StatefulSet PVC supports only one `mount_path`, and it is spent on the database
  directory for write-locking correctness.

Both bucket locations are left empty so the Foundation resolves them to the
auto-discovered deployment region (`coalesce(bucket.location, region)`), which
avoids force-replacing the immutable-location buckets on a cross-region re-apply.

List them with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
```

**Verify at first deploy:** if `bellamy/wallos` seeds any default assets inside
`/var/www/html/db` or `/var/www/html/images/uploads/logos`, mounting a fresh empty
bucket over that exact path will hide them on first boot (the general
"volume-shadowing" failure class documented elsewhere in this catalogue). This was
not confirmed either way during research.

---

## 6. Core application settings and scaling constraints

`Wallos_Common` establishes the baseline environment so the application comes up
correctly on first boot — but unlike most modules in this catalogue, several
defaults here are **load-bearing constraints, not just cost tuning**:

- **Container port 80** — Wallos's default HTTP/1.1 listener (matches
  `container_port`).
- **First login** — `admin` / `admin`; change it in the web UI immediately.
- **`min_instance_count = max_instance_count = 1`, always.** Wallos runs a real
  always-on cron daemon (8 baked-in scheduled tasks — exchange-rate refresh,
  renewal notifications, an email-verification poll every 2 minutes, and others)
  that only executes while an instance/pod is actually running (min=1), and its
  SQLite database has no multi-writer support (max=1). Scaling to zero or beyond
  one replica breaks the app silently, with no error.
- **Cloud Run additionally needs `cpu_always_allocated = true`** so the cron
  daemon's in-process background work actually gets CPU cycles between requests —
  under request-based billing it would throttle to near-zero.

Additional non-secret variables supplied via `environment_variables` are merged on
top of these defaults.

---

## 7. Health probe behaviour

The default startup and liveness probes target **`/`** — Wallos's unauthenticated
login page. `bellamy/wallos` documents no dedicated health-check endpoint, so this
is a coarse readiness signal rather than a purpose-built one: the startup probe
uses a 15-second initial delay with a 10-retry window, and the liveness probe uses
a 30-second delay.

---

For the Wallos-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Wallos_GKE](Wallos_GKE.md)** and
**[Wallos_CloudRun](Wallos_CloudRun.md)**.
