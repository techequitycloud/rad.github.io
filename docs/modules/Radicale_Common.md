---
title: "Radicale Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Radicale module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Radicale Common — Shared Application Configuration

`Radicale_Common` is the **shared application layer** for Radicale. It is not
deployed on its own; instead it supplies the Radicale-specific configuration
that both [Radicale_GKE](Radicale_GKE.md) and [Radicale_CloudRun](Radicale_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI inputs
of its own — but understanding what it provides explains the defaults you see
in the platform docs.

For the infrastructure that actually provisions and runs Radicale, see the
platform guides ([Radicale_GKE](Radicale_GKE.md), [Radicale_CloudRun](Radicale_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Radicale_Common | Where it surfaces |
|---|---|---|
| Container image | Thin-wraps `ghcr.io/kozea/radicale` with a custom build so the cloud entrypoint can be layered in | `container_image` output of the platform deployment |
| Database engine | **None** — Radicale is a pure filesystem store (`database_type = "NONE"`) | §3 below and the platform guides |
| Authentication | **No built-in default admin account** — generates a real `ADMIN_PASSWORD` secret and hashes it into an htpasswd file on every boot | §2 below |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/var/lib/radicale` | `storage_buckets` output |
| Collection seeding | Defines the default `seed-default-collections` init job that works around Cloud Run's MKCOL restriction | §4 below |
| Health checks | Supplies the default startup/liveness probes targeting `/` | §Observability in the platform guides |

---

## 2. No default admin account — a real generated secret

Radicale is unusual among the applications in this catalogue in that it has
**no upstream default credential to warn about at all**. Its `auth.type`
setting defaults to `denyall` — every request is rejected — until an
htpasswd file is explicitly configured. There is no "admin/admin" or
well-known first-login password baked into the image.

`Radicale_Common` closes this gap itself:

- Generates a real, random 24-character `random_password.admin_password`.
- Stores it in Secret Manager as `secret-<wrapper_prefix>-admin-password`.
- Outputs it as `secret_ids = { ADMIN_PASSWORD = ... }` (forwarded as
  `module_secret_env_vars`) and `secret_values = { ADMIN_PASSWORD = ... }`
  (forwarded as `module_explicit_secret_values` / `explicit_secret_values`
  for the GKE SecretSync path).
- Also injects a plain `ADMIN_USERNAME` environment variable, defaulting to
  `admin`.

The cloud entrypoint (baked into the custom image, see §4 of the platform
guides and `scripts/entrypoint.sh`) hashes `ADMIN_PASSWORD` with **bcrypt**
(Python's `bcrypt` module, already bundled in the official image's venv) into
an htpasswd-format line, and rewrites both the htpasswd file and the Radicale
INI config **on every container boot** — not just on first boot. Radicale has
no user table to check "is this already initialized?" against, so
regenerating every boot is the simplest design that (a) self-heals a
lost/corrupted htpasswd file and (b) picks up a rotated `ADMIN_PASSWORD`
immediately on the next restart, with no separate reconciliation step needed.

```bash
gcloud secrets versions access latest --secret=secret-<wrapper_prefix>-admin-password --project "$PROJECT"
```

---

## 3. Database engine — none

Radicale does **not** use a database of any kind — SQL, NoSQL, or embedded.
Every calendar and address book ("collection") is a plain directory on disk
containing one iCalendar (`.ics`) or vCard (`.vcf`) file per item, plus a
`.Radicale.props` JSON metadata file describing the collection itself. This
is Radicale's documented, stable on-disk format (the `multifilesystem`
storage backend), not a private implementation detail.

The real on-disk path has one easy-to-miss extra segment, confirmed against
`radicale/storage/multifilesystem/base.py`'s `_get_collection_root_folder()`:

```
<filesystem_folder>/collection-root/<username>/<collection-name>/
```

`filesystem_folder` is set to `/var/lib/radicale/collections` by the cloud
entrypoint. Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is
  created for Radicale.
- There is **no `db-init` job** of any kind.
- No PostgreSQL extensions, no MySQL plugins, and no Redis are involved
  (`enable_redis` is forced `false` by both Application Modules).

---

## 4. Container image and the custom build

Unlike apps in this catalogue that deploy an official image directly
(`container_image_source = "prebuilt"`), `Radicale_Common` uses a **custom,
thin-wrapper build**:

```dockerfile
ARG RADICALE_VERSION=3.7.7
FROM ghcr.io/kozea/radicale:${RADICALE_VERSION}

USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER radicale

ENTRYPOINT ["/entrypoint.sh"]
CMD ["--hosts", "0.0.0.0:5232,[::]:5232"]
```

The build exists **solely** to layer in the cloud entrypoint; there is no
other application code changed.

- **App-specific build ARG.** The Dockerfile reads `RADICALE_VERSION`, **not**
  the generic `APP_VERSION` the Foundation injects (which would force the
  resolved tag to `latest`). When `application_version = "latest"`, the
  Common layer pins the build to `RADICALE_VERSION=3.7.7`; otherwise the
  requested version passes straight through.
- **GHCR tags have no `v` prefix.** Radicale's GitHub *Releases* page shows
  tags like `v3.7.7`, but the container image on `ghcr.io/kozea/radicale` is
  published **without** the `v` (`3.7.7`). Building against the `v`-prefixed
  tag fails with `MANIFEST_UNKNOWN` — confirmed during an early build
  attempt for this module.
- **Cloud entrypoint responsibilities.** Radicale has **no native
  environment-variable configuration** — it only reads an INI config file,
  located via the `RADICALE_CONFIG` env var (confirmed in
  `radicale/__main__.py`) or a compiled-in default path. `entrypoint.sh`
  writes that INI file plus the htpasswd file on every boot (see §2), then
  hands off to the image's own CLI entrypoint
  (`/app/bin/python /app/bin/radicale`).

---

## 5. The MKCOL / Cloud Run problem

This is the single most consequential platform-specific behaviour in this
module — the result of three separate live-deployment debugging passes to
isolate root cause at each layer.

**The problem.** Creating a *new* collection (a calendar or address book) via
the standard CalDAV/CardDAV protocol requires the WebDAV `MKCOL` HTTP method.
Confirmed live:

- **On Cloud Run**, Google's frontend (GFE) rejects `MKCOL` at the edge with
  a generic "400 Bad Request" Google error page — the request never reaches
  the Radicale container at all. Every other method tested (GET, PUT,
  PROPFIND) passes through fine; this restriction is specific to MKCOL.
  Cloud Run services also have **no shell/exec access**, so there is no way
  for an operator to manually create a collection after the fact either.
  Without a workaround, a fresh `Radicale_CloudRun` deployment would be
  unable to create *any* calendar — via a standard client (Apple Calendar,
  Thunderbird, DAVx5) or even Radicale's own web UI, which also issues
  MKCOL internally.
- **On GKE**, a plain L4 LoadBalancer Service does **not** have this
  restriction — `MKCOL` works natively (confirmed live: `201 Created`).

**The fix — `seed-default-collections`.** `Radicale_Common` defines a default
initialization job (`execute_on_apply = true`, running
`scripts/seed-default-collections.sh` inside a plain `alpine:3` container)
that creates a "Default Calendar" and "Default Address Book" for the admin
user by writing the directory structure and `.Radicale.props` metadata file
**directly onto the storage volume** — a plain container with direct
filesystem access, no HTTP/GFE layer involved at all. Verified live: after
this job runs, a `PROPFIND` on the admin user's principal correctly lists
both seeded collections with the right CalDAV/CardDAV resourcetypes, and a
real calendar event (`VEVENT`) can be `PUT` and `GET` successfully.

**The GKE + PVC caveat.** The seed job is a shared Cloud-Run/GKE Common-module
job and only mounts the GCS `storage` bucket (`mount_gcs_volumes = ["storage"]`)
— it cannot attach to a StatefulSet's block PVC (a Kubernetes Job can't mount
a `ReadWriteOnce` PVC already held by a running Pod). So on
`Radicale_GKE` with `stateful_pvc_enabled = true` (the recommended production
setting), the seed job's writes land in the otherwise-unused GCS bucket and
the default collections do **not** appear automatically. This is harmless (no
error, no crash) — it just means GKE+PVC operators should create their first
calendar via a real CalDAV client or a direct `curl -X MKCOL` call (confirmed
working) instead of expecting the pre-seeded defaults. On GKE **without** a
PVC (GCS-backed Deployment mode — not the recommended production
configuration), the seed job's writes land in the same bucket the app uses,
so the defaults do appear there too.

If you supply your own `initialization_jobs`, this default is replaced
entirely — you are then responsible for seeding (or not seeding) collections
yourself.

---

## 6. Health probe behaviour

Both the startup and liveness probes issue an **HTTP GET `/`**. Radicale has
no dedicated health endpoint; the root path returns an unauthenticated `302`
redirect to its web UI (`/.web`) — confirmed live — and both Cloud Run and
Kubernetes treat any 2xx–3xx response as a healthy probe result.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage and single-instance operation

A single **Cloud Storage** bucket is declared here and provisioned by the
foundation:

- **`name_suffix = "storage"`**, storage class **STANDARD**, with
  `public_access_prevention = "enforced"`.
- On Cloud Run it always backs `/var/lib/radicale` via GCS FUSE.
- On GKE it backs `/var/lib/radicale` via GCS FUSE **unless**
  `stateful_pvc_enabled = true`, in which case a real block PVC takes over
  the same mount path (`enable_gcs_storage_volume` is automatically set to
  `false` to avoid a double-mount) and the GCS bucket goes unused as a mount
  (though the seed job may still write into it — see §5).

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
```

**Why single-instance matters here.** Radicale's `multifilesystem` storage
backend uses **OS-level file locking**, which GCS FUSE does not reliably
support. `max_instance_count` is pinned to `1` on both platforms specifically
so this never becomes a real concurrency problem — Radicale itself documents
a `multifilesystem_nolock` storage variant as explicitly single-process-only,
confirming this is a genuine upstream constraint, not a cautious platform
default. For a production deployment, prefer `Radicale_GKE` with
`stateful_pvc_enabled = true`, which gives Radicale real POSIX file locking
instead of GCS FUSE's weaker semantics.

---

For the Radicale-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Radicale_GKE](Radicale_GKE.md)** and
**[Radicale_CloudRun](Radicale_CloudRun.md)**.
