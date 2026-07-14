---
title: "Chibisafe Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Chibisafe module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Chibisafe Common — Shared Application Configuration

`Chibisafe_Common` is the **shared application layer** for Chibisafe. It is not
deployed on its own; instead it supplies the Chibisafe-specific configuration
that both [Chibisafe_GKE](Chibisafe_GKE.md) and
[Chibisafe_CloudRun](Chibisafe_CloudRun.md) build on, so the two platform
variants behave identically where it matters — same custom-built image, same
entrypoint, same fixed "no database" model, same auto-provisioned storage
bucket. End users never configure this layer directly — it has no deployment
UI inputs of its own — but understanding what it provides explains the
defaults and quirks you see in the platform docs.

For the infrastructure that actually provisions and runs Chibisafe, see the
platform guides ([Chibisafe_GKE](Chibisafe_GKE.md),
[Chibisafe_CloudRun](Chibisafe_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Chibisafe_Common | Where it surfaces |
|---|---|---|
| Cryptographic / credential secrets | Optionally generates a 24-character random `ADMIN_PASSWORD` in **Secret Manager**, gated by `enable_api_key` (default `false`) | Injected automatically when enabled; retrieve via Secret Manager (see below) |
| Container image | Wraps the prebuilt `chibisafe/chibisafe-server` image with a custom relocation entrypoint; builds via Cloud Build using an app-specific `CHIBISAFE_VERSION` build arg | `container_image` output of the platform deployment |
| Database engine | Fixes `database_type = "NONE"` — Chibisafe has **no Cloud SQL dependency**; state lives entirely in SQLite on the mounted volume | §Database in the platform guides (all `database_*`/`db_*` variables are inert) |
| Database bootstrap | None — no `db-init` job is injected; `initialization_jobs` is accepted only for custom, user-supplied jobs | `initialization_jobs` output (empty unless user-supplied) |
| Object storage | Declares the always-present `storage` Cloud Storage bucket that backs the single `/data` mount | `storage_buckets` output |
| Core settings | Sets the baseline Chibisafe environment: `NODE_ENV=production`, `HOST=0.0.0.0`; deliberately withholds `PORT` | Application behaviour in the platform guides |
| Health checks | Declares Common-level default startup/liveness probes (`path = "/"`) — both platform variants override this with their own `startup_probe`/`liveness_probe` variables, so Common's own default is never actually deployed as-is | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Chibisafe generates **no secrets by default**. Unlike apps that need an
encryption key or JWT signing secret, Chibisafe's own backend manages its
session and credential handling internally; `Chibisafe_Common` only offers one
**optional** generated value:

- **`ADMIN_PASSWORD`** (secret name suffix `api-key`) — a 24-character random
  alphanumeric string (`random_password.api_key`, `special = false`), created
  only when `enable_api_key = true` (default `false`). It is injected as the
  `ADMIN_PASSWORD` environment variable, which the chibisafe-server backend
  reads to seed its **first-run** administrator account instead of the
  well-known upstream default. Because it is only consumed the first time the
  backend initialises its admin user, rotating it **after** the first boot has
  no effect on the already-created account — treat it as a bootstrap
  credential, not a live, rotatable password. This is a plain random password,
  not a cryptographic key; there is nothing here whose rotation would corrupt
  stored data (contrast with apps that hold an app-level encryption key).
- The module also runs `cleanup_orphaned_secrets` against the same secret ID
  before creating it, and gates the secret's own outputs behind a 30-second
  `time_sleep` so dependent resources (the platform's secret env var
  injection) don't race secret propagation.

Retrieve the secret after deployment (only present if `enable_api_key = true`):

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~chibisafe AND name~api-key"

# Read the current value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Chibisafe has no database, so there is no separately managed database password
to cross-reference here (contrast with apps documented under
[App_Common](App_Common.md) that rely on the foundation's shared database
secret model).

---

## 3. Database engine and bootstrap

Chibisafe requires **no external database**. `Chibisafe_Common` hardcodes
`database_type = "NONE"` (along with `db_name = ""`, `db_user = ""`, and
`enable_cloudsql_volume = false`) directly in its `config` output — these are
not passed through from any variable, so nothing an operator sets can turn a
Cloud SQL instance on for this app. No `db-init` job is ever injected;
`initialization_jobs` simply forwards whatever custom jobs a caller supplies
(useful only for bespoke data-loading, never for schema setup).

All of Chibisafe's state — the SQLite database file(s), uploaded files, and
logs — lives on a single persistent mount at `/data` (a GCS Fuse volume on
Cloud Run, a block PersistentVolumeClaim on GKE). There is no `psql`/`mysql`
client to connect with; inspect the data directly instead:

```bash
# Cloud Run (GCS Fuse-backed bucket):
gcloud storage ls gs://<data-bucket>/database gs://<data-bucket>/uploads gs://<data-bucket>/logs

# GKE (block PVC):
kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /data/database /data/uploads /data/logs
```

The bucket/PVC name is in the platform deployment outputs (`storage_buckets`
on Cloud Run, the PVC listed under `kubectl get pvc` on GKE).

---

## 4. Container image and entrypoint

The custom image (`modules/Chibisafe_Common/scripts/Dockerfile`) wraps the
prebuilt `chibisafe/chibisafe-server:<CHIBISAFE_VERSION>` image — the
**backend only** (binds `:8000`, owns the SQLite database and uploads).
Chibisafe's separate SvelteKit front-end and Caddy reverse proxy are not part
of this image. The build reads its own `CHIBISAFE_VERSION` ARG rather than the
generic `APP_VERSION` the Foundation injects (which would otherwise force
`application_version = "latest"` onto an image tag that doesn't exist);
`Chibisafe_Common`'s `main.tf` maps `application_version == "latest"` to the
pinned default `v6.5.5` at build time.

The entrypoint (`entrypoint.sh`) runs before the upstream `CMD` (`yarn
workspace @chibisafe/backend start`) and has exactly one responsibility —
**relocating the backend's mutable state onto the platform's single
persistent mount**:

- The upstream image keeps three sibling directories under its WORKDIR
  (`/app`): `/app/database` (SQLite), `/app/uploads` (files/thumbnails), and
  `/app/logs`. The platform hands the container one persistent volume mounted
  at `/data` (`CHIBISAFE_DATA_ROOT`, default `/data`).
- For each of the three directories, the entrypoint creates the matching
  subdirectory under `/data`, migrates any image-seeded contents into it on
  first boot (only if the destination is empty and the source has content),
  deletes the original in-image directory, and replaces it with a symlink
  into `/data`. Already-symlinked directories are left untouched, making this
  idempotent across restarts.
- There is **no `DB_*` env var translation** and **no URL correction** in
  this entrypoint (unlike apps with a Cloud SQL backend or a predicted
  service URL to fix up) — `database_type = "NONE"` means there is nothing to
  alias, and Chibisafe has no outbound webhook/OAuth URL that needs
  correcting at runtime.
- It finishes by logging the relocation and `exec`-ing the original command
  (`"$@"`) as PID 1.

---

## 5. Core application settings

`Chibisafe_Common` establishes a minimal baseline so the backend listens
correctly on both platforms:

- **`NODE_ENV = "production"`** and **`HOST = "0.0.0.0"`** are always set
  (merged with, and overridable by, `var.environment_variables`).
- **`PORT` is deliberately never injected.** Cloud Run reserves the `PORT` env
  var name and auto-sets it from `container_port`; explicitly setting it here
  would 400 the Cloud Run service-create call. GKE doesn't reserve `PORT`, but
  the backend defaults to `:8000` regardless, matching `container_port = 8000`
  on both platforms — leaving it unset keeps one source of truth.
- **`enable_postgres_extensions = false`**, **`postgres_extensions = []`**,
  **`additional_services = []`** — all hardcoded; there is no secondary
  service or database extension to configure.

Platform-specific adjustments are made by the *variant* modules, not by
`Chibisafe_Common` itself, but they matter for understanding the shared
config:

- **Cloud Run** merges its own `var.container_port` into
  `Chibisafe_Common`'s output config (`chibisafe.tf`), so changing that
  variable actually changes the routed port. GKE's equivalent variable is
  **not** forwarded — the container port there is fixed at Common's `8000`.
- **The `/data` mount source differs.** Both variants pass their own
  `gcs_volumes` straight through, but `enable_gcs_storage_volume` (which
  controls whether the always-created `storage` bucket is actually mounted at
  `/data` via GCS Fuse) is computed differently: Cloud Run leaves Common's
  default (`true` — GCS Fuse is Cloud Run's only storage option), while GKE
  sets it to `!stateful_pvc_enabled` (default `false`, since
  `stateful_pvc_enabled = true` by default on GKE) so the StatefulSet's block
  PVC — not the GCS bucket — occupies `/data`, avoiding a double-mount.
- **`enable_redis` and `enable_cloudsql_volume` are decided above this
  layer.** `Chibisafe_Common` doesn't declare an `enable_redis` variable at
  all; each variant's own `main.tf` hardcodes `enable_redis = false` in its
  call to the Foundation module regardless of any mirrored variable's value.
  `enable_cloudsql_volume = false` **is** set inside `Chibisafe_Common`
  itself (hardcoded in the `config` output, §3) — every variant inherits that
  unconditionally.

---

## 6. Health probe behaviour

`Chibisafe_Common` declares its own `startup_probe`/`liveness_probe`
variables with a default `path = "/"` and a description claiming the backend
"answers GET / with 200 once ready (it has no dedicated /health endpoint)."
**This default is never actually deployed as-is** — both platform variants
declare their own `startup_probe`/`liveness_probe` (or, on GKE, additionally
`health_check_config`/`startup_probe_config`) variables and forward their own
values straight into this module's inputs, so whichever value the variant
chooses is what reaches the container.

The two variants currently disagree, and the disagreement is real — not just
a documentation gap:

- **Chibisafe_CloudRun** overrides the default with **`path = "/api/health"`**,
  and its variable description is specific and technical: "the chibisafe-server
  backend serves its routes under the `/api` prefix and has NO root route
  (`GET /` 404s — the uploader UI is a separate frontend container)," with the
  health endpoint returning `200 {"status":"yes"}`.
- **Chibisafe_GKE** still defaults its own `startup_probe`/`liveness_probe`
  (and `health_check_config`/`startup_probe_config`) to **`path = "/"`**, with
  a generic description ("Chibisafe exposes /") — one of these GKE
  descriptions even carries a leftover copy-paste fragment ("Chibisafe marks
  itself not-ready while loading large collections") that has nothing to do
  with a file uploader, confirming it as inherited template boilerplate never
  adapted for Chibisafe.

**Verified truth:** the CloudRun override is the accurate one. The
chibisafe-server backend has no root route; `GET /api/health` is the correct,
unauthenticated 200 endpoint, and `Chibisafe_Common`'s own `/` default (which
the GKE variant still inherits unchanged) describes behaviour the backend
does not actually have. This means **Chibisafe_GKE currently ships with an
unverified default health-probe path** that, per the CloudRun module's own
diagnosis, would 404 against the real backend — a fix analogous to the
CloudRun override (`path = "/api/health"`) has not yet been propagated to the
GKE variant's `startup_probe`/`liveness_probe`/`health_check_config`/
`startup_probe_config` defaults.

---

## 7. Object storage

A single, always-present **Cloud Storage** bucket (`name_suffix = "storage"`)
is declared here and provisioned by the foundation:

- `storage_class = "STANDARD"`, `force_destroy = true`, `versioning_enabled =
  false`, `public_access_prevention = "enforced"`.
- `location` is left empty so the foundation resolves it via
  `coalesce(bucket.location, local.region)` — pinning it here could
  force-replace the (immutable-location) bucket on a later re-apply in a
  different region.
- This bucket is the backing store for the whole `/data` mount described in
  §3/§4/§5. Whether it is actually *mounted* (vs. merely provisioned) depends
  on the platform: always mounted on Cloud Run, only mounted on GKE when the
  StatefulSet block PVC is disabled.
- Additional volumes can be layered on via `var.gcs_volumes`, concatenated
  with the always-present `/data` volume in `main.tf`.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
```

---

For the Chibisafe-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Chibisafe_GKE](Chibisafe_GKE.md)** and
**[Chibisafe_CloudRun](Chibisafe_CloudRun.md)**.
