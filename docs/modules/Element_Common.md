---
title: "Element Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Element module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Element Common — Shared Application Configuration

`Element_Common` is the **shared application layer** for Element, the Matrix web
client. It is not deployed on its own; instead it supplies the Element-specific
configuration that both [Element_GKE](Element_GKE.md) and
[Element_CloudRun](Element_CloudRun.md) build on, so the two platform variants behave
identically where it matters. End users never configure this layer directly — it has
no deployment UI inputs of its own — but understanding what it provides explains the
defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Element, see the platform
guides ([Element_GKE](Element_GKE.md), [Element_CloudRun](Element_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Element_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `vectorim/element-web` image with a custom entrypoint that generates `config.json`; builds via Cloud Build | `container_image` output of the platform deployment |
| Version pinning | Maps `application_version = "latest"` to a pinned known-good tag (`v1.11.86`) via an app-specific `ELEMENT_VERSION` build ARG | `container_build_config.build_args` |
| Runtime homeserver config | Writes `/app/config.json` at container start from `HOMESERVER_URL` / `HOMESERVER_NAME` | Application behaviour in the platform guides |
| Database engine | Sets `database_type = "NONE"` — Element is a static client with no server-side storage | §Database in the platform guides |
| Secrets | **None** — `secret_ids` and `secret_values` are empty maps | — |
| Object storage | **None** — `storage_buckets` is an empty list | `storage_buckets` output |
| Core settings | Container port `80`, resource limits, scaling bounds, telemetry-free defaults | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting `/` | §Observability in the platform guides |

---

## 2. No secrets, no database, no storage

Unlike stateful applications, Element is a **static single-page application** served
by nginx. The browser communicates directly with a Matrix homeserver over HTTPS, so
the container holds nothing that must be persisted or protected:

- **No Secret Manager secrets.** `Element_Common` generates none. Both `secret_ids`
  (env-var → secret-ID map) and `secret_values` (raw values for the GKE Secret Store
  CSI driver) are empty maps. There is no encryption key, JWT secret, or database
  password to manage or rotate.
- **No database.** `database_type = "NONE"` and `enable_cloudsql_volume = false`. No
  Cloud SQL instance, no `db-init` job, and no schema migrations — `initialization_jobs`
  is empty.
- **No persistent storage.** `storage_buckets = []` and `gcs_volumes = []`. Nothing
  Element serves needs a GCS bucket, an NFS mount, or a PVC.

This is why the Database, Redis, Backup, and (on GKE) StatefulSet/NFS variables in the
platform guides are documented as **inherited-but-inert** — they exist only to satisfy
Foundation-variable mirroring and have no effect for Element.

---

## 3. Container image and entrypoint

The custom image wraps `vectorim/element-web:<version>` with a thin POSIX-shell
entrypoint (`element-entrypoint.sh`) that runs before nginx starts:

- **Generates `/app/config.json`** — Element reads its runtime configuration from
  this file. Because Cloud Run and GKE cannot mount a host file, the entrypoint writes
  it at container start from the `HOMESERVER_URL` and `HOMESERVER_NAME` environment
  variables, so a single image can point at any Matrix homeserver without a rebuild.
- **Applies safe defaults** — when the env vars are unset it falls back to the public
  `https://matrix-client.matrix.org` / `matrix.org`, plus `brand: "Element"`,
  `disable_guests: false`, and `default_theme: "light"`.
- **Hands off to nginx** — execs the stock `element-web` nginx entrypoint if present,
  otherwise `nginx -g 'daemon off;'`. Either way nginx listens on port 80, matching
  `container_port`.

The build is defined by `scripts/Dockerfile` and pushed by `scripts/cloudbuild.yaml`
(a Kaniko build). The version tag is set through an **app-specific `ELEMENT_VERSION`
build ARG** rather than the generic `APP_VERSION` — the Foundation injects
`APP_VERSION` and would otherwise overwrite the tag with `latest`, which is not a
valid `element-web` tag. `Element_Common` resolves `application_version = "latest"` to
the pinned `v1.11.86` before setting the ARG.

---

## 4. Core application settings

`Element_Common` establishes the baseline Element runtime so the client comes up
correctly on first boot:

- **Container image** — `vectorim/element-web`, `image_source = "custom"` (routes
  through Cloud Build / Artifact Registry).
- **Port** — `container_port = 80` (nginx).
- **Database** — `database_type = "NONE"`; `enable_cloudsql_volume = false`.
- **Resources** — `cpu_limit` / `memory_limit` forwarded from the calling module
  (`1000m` / `512Mi` on Cloud Run; `500m` / `512Mi` on GKE).
- **Scaling** — `min_instance_count` / `max_instance_count` forwarded from the calling
  module. Cloud Run merges `min = 0` (scale-to-zero); GKE merges `min = 1`.
- **Homeserver** — the Application module forwards `HOMESERVER_URL` /
  `HOMESERVER_NAME` as `module_env_vars`, which the entrypoint writes into
  `config.json` at runtime.

Platform-specific adjustments handled by the calling module:

- **Cloud Run** merges `min_instance_count = 0` and pairs it with request-based
  billing (`cpu_always_allocated = false`) — a static server is free at idle.
- **GKE** merges `min_instance_count = 1` (GKE does not scale to zero) and runs as a
  stateless `Deployment` (`session_affinity = None`).

---

## 5. Health probe behaviour

The default probes target the root path `/` — nginx answers it immediately with the
static SPA shell and no authentication, so it is a valid, cheap liveness signal on
either platform. Element starts in under 5 seconds (no database migrations or
connection pools), so the initial delays are intentionally short.

- **Cloud Run** uses HTTP probes targeting `/` — startup with a 10-second initial
  delay and 6-failure window, liveness with a 15-second delay.
- **GKE** uses the same HTTP `/` probes; the pod becomes Ready as soon as nginx binds
  port 80. The `/` path is public and unauthenticated, so both HTTP and TCP probe
  types are viable.

| Probe | Type | Path | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/` | 10 s | 10 s | 6 |
| Liveness | HTTP | `/` | 15 s | 30 s | 3 |
| Readiness | HTTP | `/` | 10 s | 10 s | 3 |

---

## 6. Outputs

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full application configuration object (image, port, env vars, probes, resource limits, scaling). |
| `secret_ids` | `map(string)` | Always empty — Element requires no secrets. |
| `secret_values` | `map(string)` | Always empty (sensitive) — Element requires no secrets. |
| `storage_buckets` | `list` | Always empty — Element is stateless. |
| `path` | `string` | Absolute filesystem path to the `Element_Common` module directory. Used to resolve `scripts_dir`. |

---

## 7. Scripts

| File | Purpose |
|---|---|
| `scripts/Dockerfile` | Thin custom build `FROM vectorim/element-web:${ELEMENT_VERSION}` that copies in the entrypoint and exposes port 80. |
| `scripts/element-entrypoint.sh` | Generates `/app/config.json` from `HOMESERVER_URL` / `HOMESERVER_NAME`, then hands off to nginx. |
| `scripts/cloudbuild.yaml` | Kaniko-based Cloud Build pipeline that builds and pushes the custom image to Artifact Registry. |

---

For the Element-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Element_GKE](Element_GKE.md)** and **[Element_CloudRun](Element_CloudRun.md)**.
