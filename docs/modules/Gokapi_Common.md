---
title: "Gokapi Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Gokapi module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Gokapi Common — Shared Application Configuration

`Gokapi_Common` is the **shared application layer** for Gokapi. It is not
deployed on its own; instead it supplies the Gokapi-specific configuration that
both [Gokapi_GKE](Gokapi_GKE.md) and [Gokapi_CloudRun](Gokapi_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI inputs
of its own — but understanding what it provides explains the defaults you see
in the platform docs.

For the infrastructure that actually provisions and runs Gokapi, see the
platform guides ([Gokapi_GKE](Gokapi_GKE.md), [Gokapi_CloudRun](Gokapi_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Gokapi_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates **no secret by default**. Only when `enable_api_key = true` does it mint a 32-character random API token and store it in **Secret Manager** | Injected as `GOKAPI_API_KEY`, retrievable via Secret Manager (see below) |
| Container image | Wraps the official `f0rc3/gokapi` image with a one-line custom-build Dockerfile (no custom entrypoint script); builds via Cloud Build/Kaniko | `container_image` output of the platform deployment |
| Database engine | Fixes `database_type = "NONE"` — Gokapi has no external database at all | §Database in the platform guides |
| Database bootstrap | None. No `db-init` job is injected; only user-supplied `initialization_jobs` are accepted | `initialization_jobs` output (empty unless user-supplied) |
| Object storage | Declares the **Cloud Storage** `storage`-suffixed data bucket, and optionally mounts it as a GCS Fuse volume at `/data` | `storage_buckets` output |
| Core settings | Sets the baseline Gokapi environment: config/data directory paths and the fixed listen port | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Gokapi has **no mandatory generated secret**. There is no encryption key, JWT
secret, or admin password created by this module — Gokapi's administrator
account is instead claimed interactively through its own first-run setup
wizard the first time anyone opens the service.

The only secret this layer can create is optional:

- **`GOKAPI_API_KEY`** (only when `var.enable_api_key = true`, default
  `false`) — a 32-character random alphanumeric token (`random_password`,
  `special = false`), stored in Secret Manager as
  `secret-<wrapper_prefix>-gokapi-api-key` and injected as the environment
  variable `GOKAPI_API_KEY`. This is an **operator convenience token only** —
  Gokapi's own real upload/download API keys are normally minted from the
  admin UI after the first-run setup wizard completes. There is no rotation
  risk in the usual sense (nothing depends on it cryptographically), but
  rotating it changes the value any external caller may have been given as
  `GOKAPI_API_KEY`.

Retrieve it after deployment (only present when `enable_api_key = true`):

```bash
# List the secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read the secret version:
gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
```

Note this secret's ID is **not** exposed through this module's `secret_ids`
output map key name in a generic way — it is surfaced as the `GOKAPI_API_KEY`
entry of `secret_ids` (Cloud Run) or as the `gokapi_api_key_secret_id` output
(GKE, injected as a native Kubernetes Secret rather than through SecretSync).
See [App_Common](App_Common.md) for the shared secret and Workload Identity
model that both platform variants build on.

---

## 3. Database engine and bootstrap

**None (SQLite on mounted storage).** `Gokapi_Common` hardcodes
`database_type = "NONE"` in the `config` output it returns to the foundation.
There is no Cloud SQL instance, no `db-init` job, and no database
user/password of any kind. Gokapi manages its own state entirely by itself:
it writes an internal SQLite database under `GOKAPI_CONFIG_DIR` and stores
uploaded files under `GOKAPI_DATA_DIR`, both of which this module points at
subdirectories of a single mounted volume (see [Section 7](#7-object-storage)).

The `initialization_jobs` output is empty by default —
`Gokapi_Common`'s `main.tf` only forwards jobs when the caller explicitly
supplies `var.initialization_jobs`; no default database-bootstrap job is
injected because there is no database to bootstrap. The `db_name` and
`db_user` fields in the module's `config` output are hardcoded to empty
strings, and `enable_cloudsql_volume = false` / `enable_postgres_extensions =
false` are likewise fixed — all present purely so the generic Foundation
schema is satisfied, not because Gokapi uses them.

---

## 4. Container image and entrypoint

The image is a **thin one-line wrapper**, not a custom-entrypoint build:

```dockerfile
ARG GOKAPI_VERSION=v1.9.6
FROM f0rc3/gokapi:${GOKAPI_VERSION}
```

There is no `entrypoint.sh` in this module — `scripts/` contains only the
`Dockerfile` and a `cloudbuild.yaml` (plus a `.gitkeep`). The sole purpose of
the wrapper is to let the Foundation build and mirror the upstream
`f0rc3/gokapi` image into Artifact Registry under `container_build_config`
(`dockerfile_path = "Dockerfile"`, `context_path = "."`), rather than pulling
directly from Docker Hub at deploy time.

The build uses an **app-specific build argument**, `GOKAPI_VERSION`, instead
of the generic `APP_VERSION` the Foundation injects into every custom build
(which would otherwise force the image tag to `"latest"` — a tag `f0rc3/gokapi`
does not reliably publish in a stable form). `Gokapi_Common` resolves it as:

```hcl
GOKAPI_VERSION = var.application_version == "latest" ? "v1.9.6" : var.application_version
```

So the platform's campaign-wide `application_version = "latest"` default
still pins to a known-good, tested tag (`v1.9.6`) rather than breaking the
build. The `cloudbuild.yaml` in `scripts/` mirrors this exact Dockerfile
content inline as a Kaniko build step, self-healing against an empty/missing
file before building.

Because there is no entrypoint script, Gokapi's own container `ENTRYPOINT`
(as baked into `f0rc3/gokapi`) runs unmodified — all runtime configuration is
done purely through environment variables (see below) and the mounted volume.

---

## 5. Core application settings

`Gokapi_Common` establishes the baseline Gokapi environment so the
application comes up correctly on first boot. Unlike most application Common
modules, there is very little to set because Gokapi is a small, self-contained
Go binary:

- **Config and data directories** — `GOKAPI_CONFIG_DIR = "/data/config"` (app
  config plus the SQLite metadata database) and `GOKAPI_DATA_DIR =
  "/data/data"` (uploaded files). Both are subdirectories of the single
  persistent mount at `/data`, keeping the app binary at `/app` untouched by
  the mount.
- **Listen port** — `GOKAPI_PORT = "53842"` is **hardcoded** in this module's
  `environment_variables`, matching the module's fixed `container_port =
  53842`. This value is set regardless of platform and is not derived from any
  variable.
- **No other baseline settings.** There is no queue mode, no telemetry flag,
  no execution-mode setting, and no sign-up toggle — Gokapi completes the rest
  of its configuration through its own first-run setup wizard served at `/`,
  not through environment variables.

Platform-specific adjustments are minimal and live almost entirely outside
this Common layer:

- **Cloud Run** forwards `container_port = var.container_port` through
  `gokapi.tf`'s merge into the per-app config that reaches the foundation, so
  the value is technically live — but changing it away from `53842` would
  route traffic to a port the container (fixed at `GOKAPI_PORT = "53842"`
  here) is not actually listening on. Leave it at the default.
- **GKE** declares the equivalent `container_port` variable but never
  forwards it to the foundation — it is inert there. GKE's persistence
  decision (block PVC vs. GCS Fuse) is also driven from the GKE variant, not
  from this Common layer directly, though the mechanism (`enable_gcs_storage_volume`)
  is implemented here — see [Section 7](#7-object-storage).

---

## 6. Health probe behaviour

The default probes both target `/` — Gokapi's public login/first-run setup
page — which is unauthenticated and returns 200 once the binary is listening,
with no dependency on any external database (there being none):

- **Startup probe** — HTTP GET `/`, `initial_delay_seconds = 15`,
  `timeout_seconds = 5`, `period_seconds = 10`, `failure_threshold = 10`
  (roughly 100 seconds of retry budget after the initial delay).
- **Liveness probe** — HTTP GET `/`, `initial_delay_seconds = 30`,
  `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

Both defaults are defined once in this module's `variables.tf`
(`startup_probe` / `liveness_probe`) and are identical across Cloud Run and
GKE — neither platform variant overrides them. Because Gokapi has no database
to wait on, the startup window is comparatively short next to database-backed
application modules.

---

## 7. Object storage

This is the layer where Gokapi's persistence story is actually decided, and
it differs meaningfully between the two platform variants even though the
underlying declaration is the same.

`Gokapi_Common` always declares one Cloud Storage bucket via its
`storage_buckets` output (`name_suffix = "storage"`, `STANDARD` class,
`force_destroy = true`, no versioning, `public_access_prevention =
"enforced"`, and an empty `location` so the foundation resolves it to the
auto-discovered deployment region). This bucket is provisioned whenever
`create_cloud_storage = true` (the platform default) regardless of how it
ends up being used.

Whether that bucket is actually **mounted** is controlled by
`var.enable_gcs_storage_volume` (default `true` in this module):

```hcl
_gokapi_extra_storage_volumes = var.enable_gcs_storage_volume ? [
  { name = "storage", mount_path = "/data", read_only = false }
] : []
```

- **On Cloud Run**, there is no PVC/block-storage concept at all, so
  `Gokapi_CloudRun` leaves `enable_gcs_storage_volume` at its default `true`
  and exposes no variable to turn it off — the GCS Fuse mount at `/data` is
  the **only** persistence path Gokapi has on that platform. Both the SQLite
  database (`GOKAPI_CONFIG_DIR`) and every uploaded file (`GOKAPI_DATA_DIR`)
  live on this mount. GCS Fuse does not provide true POSIX file locking, which
  is a real risk for a SQLite-backed application — see the pitfalls sections
  of [Gokapi_CloudRun](Gokapi_CloudRun.md#6-configuration-pitfalls--sensible-defaults).
- **On GKE**, `Gokapi_GKE` defaults to a real block PVC instead
  (`stateful_pvc_enabled = true`, which also auto-resolves `workload_type` to
  `StatefulSet`), mounted at the same `/data` path. To avoid a double-mount
  conflict at that path, the GKE wrapper sets
  `enable_gcs_storage_volume = false` whenever the StatefulSet PVC is active —
  so the `storage` bucket is still created (assuming `create_cloud_storage =
  true`) but sits **unused** unless an operator explicitly disables
  `stateful_pvc_enabled`, at which point this module's GCS Fuse volume
  re-activates at the same mount path.

Additional caller-supplied volumes (`var.gcs_volumes`) are concatenated ahead
of this module's own `storage` mount in the `gcs_volumes` list forwarded to
the foundation, so a custom mount never displaces the `storage` bucket's
mount.

List the bucket (present on both platforms, mounted only per the logic
above):

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

For the Gokapi-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Gokapi_GKE](Gokapi_GKE.md)** and
**[Gokapi_CloudRun](Gokapi_CloudRun.md)**.
