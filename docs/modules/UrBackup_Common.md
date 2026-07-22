---
title: "UrBackup Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the UrBackup module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# UrBackup Common — Shared Application Configuration

`UrBackup_Common` is the **shared application layer** for UrBackup. It is not
deployed on its own; instead it supplies the UrBackup-specific configuration that
[UrBackup_GKE](UrBackup_GKE.md) builds on. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

**GKE-only.** UrBackup's client protocol needs three raw TCP ports (`55413`
FastCGI backend, `55414` direct web UI, `55415` internet-mode client transfer)
plus UDP LAN-discovery broadcast (`35622`-`35623`) simultaneously reachable.
Cloud Run's ingress (the GFE) is single-port HTTP(S)-only and cannot expose raw
multi-port TCP or any UDP at all. Real backup clients run on users' own PCs
outside this GCP project and dial in directly on these ports — even a
"management UI only" Cloud Run variant would offer little value, since the
actual backup data-transfer protocol could never reach it. This is the same
architectural class of gap as this catalogue's other **Common + GKE only**
modules (Kopia, RocketChat, Immich, Temporal, Prowlarr, VictoriaMetrics,
Plausible, LobeChat, Supabase, Woodpecker), but a harder one: it isn't one
blocked verb or handshake (like Kopia's TLS+ALPN requirement or GoToSocial's
WebDAV `MKCOL` rejection) — it's an entire class of port (multi-port TCP and
UDP) that Cloud Run's ingress model cannot express under any configuration.

For the infrastructure that actually provisions and runs UrBackup, see the
[UrBackup_GKE](UrBackup_GKE.md) platform guide and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

> **Not deployed to a live GKE cluster.** This module was statically validated
> (`tofu validate`) and its custom container image was built and run locally
> with Docker (an explicit bind mount at `/var/urbackup`, simulating a
> Kubernetes volumeMount) — confirmed the server genuinely boots and serves a
> real, working web UI. It was not, however, deployed to a live GKE cluster
> during development. Behavioural claims below are sourced from the upstream
> project's official documentation and source
> (`github.com/uroni/urbackup-server-docker`) plus this local verification.

---

## 1. What this layer provides

| Area | Provided by UrBackup_Common | Where it surfaces |
|---|---|---|
| Container image | Thin wrapper `FROM uroni/urbackup-server:${URBACKUP_VERSION}` (Docker Hub) plus a symlink-redirecting entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Datastore | Fixes `database_type = "NONE"` — no Cloud SQL. UrBackup bootstraps its own embedded SQLite database on first boot | §Application behaviour in the platform guide |
| Secrets | **None.** UrBackup creates its admin account through its own first-run web UI setup wizard | n/a — `secret_ids`/`secret_values` outputs are empty maps |
| Persistent storage | Declares an OPTIONAL escape-hatch `storage` GCS bucket (unmounted by default) — NOT where UrBackup's actual data lives, see §3 | `storage_buckets` output |
| Core settings | Fixes `container_port = 55414`, single-server scaling (`max_instance_count = 1`), NOT-scale-to-zero (`min_instance_count = 1`) | Application behaviour in the platform guide |
| Health checks | Supplies TCP-only startup/liveness probes against port `55414` | §Observability in the platform guide |

---

## 2. No secrets — first-run web UI setup

Unlike most Common modules in this catalogue that generate at least one
Secret-Manager-backed credential, `UrBackup_Common` creates **none**. The base
image has no documented env var for pre-seeding an admin account — the first
browser visit to the web UI (port `55414`) presents UrBackup's own setup
wizard to create the admin account interactively.

`secret_ids` and `secret_values` are still exported as empty-map outputs
(rather than omitted entirely), matching the established zero-secret pattern
already used elsewhere in this catalogue (Beszel, Audiobookshelf, Element,
CloudBeaver) — this keeps the `UrBackup_GKE` variant's forwarding wiring
(`module_secret_env_vars = module.urbackup_app.secret_ids`) uniform with every
other Common module, without special-casing the zero-secret case.

---

## 3. Container image and entrypoint — a build-time patch, not a wrapper script

The custom image wraps `uroni/urbackup-server:<version>` (the official Docker
Hub image, published from `github.com/uroni/urbackup-server-docker`) with a
one-line `sed` patch to the base image's OWN entrypoint — no separate wrapper
script:

```dockerfile
ARG URBACKUP_VERSION=2.5.x
FROM uroni/urbackup-server:${URBACKUP_VERSION}

RUN sed -i \
      -e 's#echo "/backups" > /var/urbackup/backupfolder#mkdir -p /var/urbackup/backups \&\& echo "/var/urbackup/backups" > /var/urbackup/backupfolder#' \
      /usr/bin/entrypoint.sh \
    && grep -q '/var/urbackup/backups' /usr/bin/entrypoint.sh

ENTRYPOINT ["/usr/bin/entrypoint.sh"]
CMD ["run"]
```

- **App-specific version ARG.** The Dockerfile reads `URBACKUP_VERSION` — *not*
  the generic `APP_VERSION` the foundation injects. `application_version =
  "latest"` resolves to the pinned `URBACKUP_VERSION=2.5.x`.

**An earlier version of this Dockerfile tried a different approach** — a
separate wrapper entrypoint that symlinked the base image's two expected data
paths (`/var/urbackup`, `/backups`) onto a single mounted volume at container
startup. **Confirmed broken** via a local `docker build` + `docker run` test:
`ln -sfn` cannot replace an existing directory with a symlink — it silently
places the new symlink *inside* the directory instead. The base image
declares both paths as Docker `VOLUME`s, so a plain `docker run` (no explicit
`-v`) recreates them as directories before the entrypoint ever runs, and the
symlink step failed exactly this way.

The fix instead patches a mechanism the container already relies on: the base
entrypoint (confirmed by reading it directly) writes the backup-data
destination into `/var/urbackup/backupfolder` on **every boot**,
unconditionally:

```sh
echo "/backups" > /var/urbackup/backupfolder
```

Patching that one line to write `/var/urbackup/backups` instead of `/backups`
means client backup data lands under the SAME mounted path as the database,
using a configuration mechanism the image already supports.

**Verified locally, not just in theory:** building this image and running it
with an explicit bind mount at `/var/urbackup` (`docker run -v
/tmp/data:/var/urbackup ...` — simulating a Kubernetes volumeMount) produced a
real, working UrBackup server: `backupfolder` correctly read
`/var/urbackup/backups`, the SQLite database initialized (visible in the boot
log as a sequence of "Upgrading database to version N" lines), and the web UI
served a genuine `HTTP 200` response titled *"UrBackup - Keeps your data
safe"* on port `55414`.

---

## 4. Persistent storage — one PVC at `/var/urbackup`, not GCS

The upstream image expects **two separate volumes**:

| Path | Contents |
|---|---|
| `/var/urbackup` | The server's own SQLite database and configuration (location fixed by the `urbackup` system user's `$HOME`, set in the `.deb` package's `postinst` script) |
| `/backups` (redirected to `/var/urbackup/backups` by this module — see §3) | Every registered client's backup data (files + optional disk images), deduplicated across incremental backups of the same tree via **hardlinks** |

Neither belongs on a GCS FUSE mount: gcsfuse does not support the hardlinks
UrBackup's deduplication depends on within the backup-data tree, and its
file-locking semantics are unsafe for a live SQLite database — the same class
of gcsfuse-vs-SQLite corruption risk already documented in this catalogue's
CLAUDE.md for other apps. Note that the hardlinks only need to work *within*
the backup-data tree itself (between different incremental backups) — they do
**not** require the database directory and backup directory to share a
filesystem; mounting both under `/var/urbackup` is a consequence of the
Foundation's one-PVC-per-StatefulSet constraint, not a hardlink requirement.

`UrBackup_GKE` therefore defaults to a GKE block Persistent Volume Claim
(`stateful_pvc_enabled = true`) mounted directly at `/var/urbackup`.

The `storage` GCS bucket this module DOES declare
(`enable_gcs_storage_volume`, default `false`) is a **completely separate,
optional escape hatch** — e.g. for exported reports — not where UrBackup's
actual data lives:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

## 5. Environment variables — PUID/PGID/TZ

The base image's own documented env vars are exposed as Common variables:

| Common variable | Container env var | Default | Purpose |
|---|---|---|---|
| `puid` | `PUID` | `1000` | UID the base entrypoint chowns `/var/urbackup` (the mounted PVC) to |
| `pgid` | `PGID` | `1000` | GID for the same chown |
| `timezone` | `TZ` | `Etc/UTC` | Affects backup scheduling/timestamps |

These are merged with any operator-supplied `environment_variables`.

---

## 6. Single-server, not scale-to-zero-safe

`max_instance_count` should stay at **1** — the embedded SQLite database and
hardlink-based deduplication have no multi-instance coordination; concurrent
servers would corrupt or race each other's state. `min_instance_count`
defaults to **1** (deliberately NOT scale-to-zero, unlike most of this
catalogue's request/response apps) — UrBackup's real clients are remote PCs
that dial in on their own unattended backup schedule at arbitrary times, so a
scaled-to-zero server would silently miss check-ins rather than serving a
slow cold-start page.

---

## 7. Health probe behaviour

The default probes are **TCP**, not HTTP, against port `55414`:

- **Startup probe** — TCP, 15-second initial delay, 10-second period, 10-retry
  window.
- **Liveness probe** — TCP, 30-second initial delay, 30-second period, 3-retry
  window.

Local testing confirmed the web UI's `/` path DOES return a genuine,
unauthenticated `HTTP 200` — but since that confirmation came from a local
Docker test rather than a live GKE deployment, TCP remains the choice here:
as soon as the port accepts a connection, `urbackupsrv` has finished its own
startup sequence, independent of platform-specific HTTP routing behavior that
was not verified end-to-end on GKE.

---

For the UrBackup-specific, user-facing configuration (variables by group,
outputs, the dedicated multi-port client-access Service, and how to explore
each resource from the Console and CLI), see the platform guide:
**[UrBackup_GKE](UrBackup_GKE.md)**. There is no `UrBackup_CloudRun` — see the
note at the top of this guide for why Cloud Run cannot back UrBackup's
multi-port client protocol.
