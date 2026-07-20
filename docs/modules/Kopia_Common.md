---
title: "Kopia Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Kopia module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Kopia Common — Shared Application Configuration

`Kopia_Common` is the **shared application layer** for Kopia. It is not deployed on
its own; instead it supplies the Kopia-specific configuration that
[Kopia_GKE](Kopia_GKE.md) builds on. End users never configure this layer directly —
it has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform docs.

**GKE-only.** Kopia's client-server backup protocol is exclusively **gRPC** —
confirmed against source (`repo/open.go`, which always calls
`openGRPCAPIRepository()`, no REST fallback) — and gRPC only ever gets real HTTP/2
when Kopia's own server negotiates it via **TLS+ALPN**. Kopia's plain `--insecure`
mode is a bare `net/http` `Server.Serve()` with no h2c wrapping (confirmed against
`cli/command_server_start.go`), so it can only ever speak HTTP/1.1 without TLS.
Cloud Run's GFE always terminates public HTTPS at its own edge and can never pass a
container-terminated TLS stream through to the container — so Kopia's own TLS, the
only way it ever gets real HTTP/2, is structurally unreachable there. A
`Kopia_CloudRun` variant was built, deployed, and live-tested: the REST control API
worked fine over plain HTTP/1.1, but every actual snapshot session failed with a
gRPC protocol error regardless of `container_protocol = h2c`. It was removed —
architecturally unfixable at the module layer, the same class of platform gap as
RocketChat's and LobeChat's removed Cloud Run variants (see CLAUDE.md's "Common +
GKE only" section). GKE's plain L4 `LoadBalancer` Service passes raw TCP straight
through with no HTTP-terminating edge of its own, so Kopia's self-signed TLS reaches
the client directly and gRPC works end-to-end — verified live with a real
`kopia snapshot create` / `kopia snapshot list` round-trip.

For the infrastructure that actually provisions and runs Kopia, see the
[Kopia_GKE](Kopia_GKE.md) platform guide and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Kopia_Common | Where it surfaces |
|---|---|---|
| Container image | Thin wrapper `FROM kopia/kopia:${KOPIA_VERSION}` (Docker Hub) plus a custom cloud entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Datastore | Fixes `database_type = "NONE"` — no Cloud SQL. Kopia's repository lives natively in the Cloud Storage bucket, not a filesystem mount | §Storage in the platform guide |
| Two independent secrets | Generates `ADMIN_PASSWORD` (server login) and `REPO_PASSWORD` (repository content-encryption key) in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| TLS | Kopia's self-signed certificate is generated once and persisted at `/var/lib/kopia/tls/` across restarts | §TLS in the platform guide |
| Object storage | Declares the **Cloud Storage** `storage` bucket, used for both the native repository AND the persisted TLS certificate | `storage_buckets` output |
| Core settings | Fixes `container_port = 51515`, single-server scaling (`max_instance_count = 1`), scale-to-zero (`min_instance_count = 0`) | Application behaviour in the platform guide |
| Health checks | Supplies TCP-only startup/liveness probes against port `51515` (Kopia has no unauthenticated HTTP endpoint) | §Observability in the platform guide |

---

## 2. Two independent secrets in Secret Manager

Kopia ships with **no built-in credentials of any kind**. Two secrets are generated
automatically and stored in Secret Manager, with very different rotation
characteristics:

| Secret | Env var | Content | Rotation |
|---|---|---|---|
| `secret-<prefix>-admin-password` | `ADMIN_PASSWORD` | 24-character random password. The server operator's HTTP Basic Auth login — gates the Web UI **and** the separate control API (`KOPIA_SERVER_PASSWORD` / `KOPIA_SERVER_CONTROL_PASSWORD`) | Safe to rotate at any time |
| `secret-<prefix>-repo-password` | `REPO_PASSWORD` | 32-character random password. The repository's own content-encryption password (`KOPIA_PASSWORD`) — derives the key that decrypts **every snapshot ever written** | **Set once, at first deploy. Never rotate independently of the actual repository content — there is no supported re-encrypt path, and doing so permanently orphans every existing snapshot.** |

Retrieve either secret after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~repo-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

`enable_auto_password_rotation` only ever targets a Foundation-managed Cloud SQL
user password (gated on `database_type != "NONE"`, and Kopia fixes
`database_type = "NONE"`), so it structurally cannot touch `REPO_PASSWORD` — but
manual/out-of-band rotation is still possible and must be avoided.

**`ADMIN_PASSWORD` alone does not authorize a client snapshot session** — see §4
below for the third, non-obvious mechanism a real `kopia` CLI client actually
authenticates through.

---

## 3. Container image and entrypoint

The custom image wraps `kopia/kopia:<version>` (the official Docker Hub image) with
a thin shell entrypoint (`entrypoint.sh`):

- **App-specific version ARG.** The Dockerfile reads `KOPIA_VERSION` — *not* the
  generic `APP_VERSION` the foundation injects (which would force the tag to
  `latest`, not a real Docker Hub tag). `application_version = "latest"` resolves to
  the pinned `KOPIA_VERSION=0.23.1`.
- **Runs as root**, matching the upstream image (`FROM ubuntu:jammy`, no dedicated
  non-root user).
- **`KOPIA_CHECK_FOR_UPDATES=false`** avoids an unnecessary startup network call —
  the image itself is what's being version-pinned.
- **Connects to (or creates) the GCS-backed repository** on every boot:
  ```bash
  kopia repository connect gcs --bucket="$KOPIA_GCS_BUCKET" --prefix="repository/"
  # falls back to:
  kopia repository create gcs --bucket="$KOPIA_GCS_BUCKET" --prefix="repository/"
  ```
- **Provisions the repository-stored server user + ACLs** — see §4.
- **Generates (once) or reuses the self-signed TLS certificate** — see §5.
- **Launches `kopia server start`** as the final `exec`.

---

## 4. The third mechanism — a repository-stored user + ACLs

`KOPIA_SERVER_USERNAME`/`KOPIA_SERVER_PASSWORD` (from `ADMIN_PASSWORD`) only gate
the server's HTTP Basic Auth layer — the Web UI and the separate control API. They
do **not** by themselves authorize a remote `kopia` CLI client's actual gRPC
snapshot push/pull session (confirmed live: connecting with those exact credentials
under an arbitrary client identity still returns `PermissionDenied: access
denied`). A real client session additionally needs:

1. **A repository-stored user account** — `kopia server users add/set <user>@<host>`,
   checked against the connecting identity.
2. **An ACL granting that user access** — `kopia server acl enable` installs
   Kopia's own default policy: any authenticated `user@host` gets full read/write on
   its own hostname's snapshots.

The entrypoint runs both commands against the repository directly (not the HTTP
API) and **before** `kopia server start`, so the server picks up current state on
its own initial load — no caching delay. Both commands error on a second run
(idempotency isn't built into the CLI), so an add-or-set / enable-or-skip fallback
makes this self-healing on every boot:

```
SERVER_USER="${ADMIN_USERNAME}@kopia"
kopia server users add "${SERVER_USER}" --user-password="${REPO_PASSWORD}"   # or `set` if it already exists
kopia server acl enable                                                       # or skip if already enabled
```

**CRITICAL AND COUNTERINTUITIVE — confirmed against source**
(`cli/command_repository_connect_server.go` + `internal/server/grpc_session.go`):
`kopia repository connect server` has **no separate server-user-password flag**.
Its one password input (`-p` / `KOPIA_PASSWORD`) is sent as-is as the gRPC session
credential, checked by `authenticateGRPCSession()` against the repository-stored
user's password. That's why the repository user above is provisioned with
`REPO_PASSWORD`, **not** `ADMIN_PASSWORD` — a real client authenticates with
`--password=$REPO_PASSWORD` (which it needs anyway, to decrypt content) and that
same value doubles as its session credential:

```bash
kopia repository connect server \
  --url=https://<external-ip>:<service-port> \
  --server-cert-fingerprint=<sha256-fingerprint> \
  --password=<REPO_PASSWORD> \
  --override-username=admin --override-hostname=kopia
```

`--password=<ADMIN_PASSWORD>` here looks plausible — it *is* the credential the
operator "logs in" with conceptually — but fails every session with
`PermissionDenied: access denied`, confirmed live.

---

## 5. TLS — generated once, reused forever

GKE's plain L4 `LoadBalancer` Service passes raw TCP straight through with no
HTTP-terminating edge of its own (unlike Cloud Run's GFE), so Kopia must terminate
TLS itself — which is also the only way it ever gets real HTTP/2 for its gRPC
session (see the intro above). The entrypoint generates a self-signed certificate
**once**, on first boot, and persists it at `/var/lib/kopia/tls/{cert,key}.pem` (a
GCS FUSE-mounted path — see §6):

- **First boot:** no persisted cert files exist → `kopia server start
  --tls-generate-cert --tls-cert-file=... --tls-key-file=...`. The SHA256
  fingerprint every remote client must pin
  (`kopia repository connect server --server-cert-fingerprint=...`) prints **once**,
  to stderr, at the exact moment of generation.
- **Every subsequent boot:** the persisted cert files are found → `kopia server
  start --tls-cert-file=... --tls-key-file=...` with **no** `--tls-generate-cert` —
  Kopia itself refuses to regenerate against an existing cert file (confirmed
  against `cli/command_server_tls.go`'s `maybeGenerateTLS()`), and regenerating on
  every restart would force every remote client to re-approve a new fingerprint.

Retrieve or recompute the fingerprint at any time (GKE gives real shell access,
unlike Cloud Run):

```bash
# From the pod's first-boot logs:
kubectl logs <pod> -c kopia | grep -A2 -i fingerprint

# Recompute directly, any time:
kubectl exec <pod> -c kopia -- openssl x509 -in /var/lib/kopia/tls/cert.pem -noout -fingerprint -sha256
```

---

## 6. Object storage — one bucket, two independent roles

A single `storage` GCS bucket is declared here and provisioned by the foundation,
serving **two completely separate, non-colliding roles simultaneously**:

| Role | Access path | Object prefix | Purpose |
|---|---|---|---|
| Repository data | Kopia's own native GCS API client (ADC-authenticated), **not** a filesystem mount | `repository/` | Every encrypted, deduplicated snapshot block Kopia has ever written |
| TLS certificate persistence | GCS FUSE mount at `/var/lib/kopia` | `tls/` | The self-signed `cert.pem`/`key.pem` pair, persisted across pod restarts |

The two roles never interfere: the repository is accessed exclusively through
Kopia's own GCS SDK client at the `repository/` prefix, while the small,
low-traffic FUSE mount only ever touches the `tls/` prefix. List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls -r gs://<storage-bucket>/repository/ | head    # native repository data
gcloud storage ls gs://<storage-bucket>/tls/                     # persisted TLS cert
```

`enable_gcs_storage_volume` (default `true`) controls the FUSE mount and is set to
`false` automatically by `Kopia_GKE` when `stateful_pvc_enabled = true`, to avoid a
double-mount at the same path — though a PVC is **not recommended** for this module
(see the [Kopia_GKE guide](Kopia_GKE.md)).

---

## 7. Single-server, scale-to-zero-safe

`max_instance_count` should stay at **1** — Kopia's own repository maintenance
(GC/compaction) assumes a single server owns the repository at a time; concurrent
servers would race each other's maintenance runs. `min_instance_count` defaults to
**0** (scale-to-zero) — Kopia's repository lives natively in Cloud Storage, not on
an instance-local volume, so a cold start just reconnects (and, on first-ever boot
only, regenerates the TLS certificate).

---

## 8. Health probe behaviour

The default probes are **TCP**, not HTTP, against port `51515`:

- **Startup probe** — TCP, 15-second initial delay, 10-second period, 10-retry
  window.
- **Liveness probe** — TCP, 30-second initial delay, 30-second period, 3-retry
  window.

Every Kopia server API endpoint requires authentication — confirmed against source,
there is no unauthenticated health/ping route — so an HTTP-path probe always 401s
and the pod would never become Ready even though the server booted fine. A TCP
probe against the listening port is genuinely accurate: by the time
`kopia server start` binds the port, the repository connect-or-create step has
already succeeded.

---

For the Kopia-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guide:
**[Kopia_GKE](Kopia_GKE.md)**. There is no `Kopia_CloudRun` — see the note at the
top of this guide for why Cloud Run cannot back Kopia's gRPC snapshot protocol.
