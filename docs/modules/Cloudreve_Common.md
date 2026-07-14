---
title: "Cloudreve Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Cloudreve module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Cloudreve Common — Shared Application Configuration

`Cloudreve_Common` is the **shared application layer** for Cloudreve. It is not
deployed on its own; instead it supplies the Cloudreve-specific configuration
that both [Cloudreve_GKE](Cloudreve_GKE.md) and
[Cloudreve_CloudRun](Cloudreve_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Cloudreve, see the
platform guides ([Cloudreve_GKE](Cloudreve_GKE.md),
[Cloudreve_CloudRun](Cloudreve_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Cloudreve_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | **None generated.** Cloudreve mints its own initial admin password internally on first boot and prints it to container logs | Container logs only — `secret_ids` / `secret_values` outputs are both empty maps |
| Container image | Wraps the official `cloudreve/cloudreve` image in a multi-stage Dockerfile that relocates the `cloudreve` binary out of the mounted data directory; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes `database_type = "NONE"` — Cloudreve uses an embedded SQLite database on its persistent volume, never Cloud SQL | §Database in the platform guides |
| Database bootstrap | None. No default `db-init`/`db-create` job is injected; `initialization_jobs` only runs jobs the operator explicitly supplies | `initialization_jobs` output (empty by default) |
| Object storage | Declares a single `storage` Cloud Storage bucket, conditionally mounted at `/cloudreve` via GCS FUSE | `storage_buckets` output |
| Core settings | Minimal — `environment_variables` is passed straight through with no injected defaults; `container_port` is fixed at `5212`, `database_type`/`db_name`/`db_user`/`enable_cloudsql_volume` are hardcoded off | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes targeting `/` — Cloudreve has no dedicated health endpoint | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

`Cloudreve_Common` creates **no** Secret Manager secrets. Cloudreve v3 has no
injectable admin credential and no server-side API-key environment variable:
it generates its own initial admin account and password internally on first
boot and prints the password to the container's stdout/stderr. There is
nothing for this layer to generate, store, or rotate.

The `secret_ids` and `secret_values` outputs are both **intentionally empty
maps** — kept only so `Cloudreve_CloudRun` and `Cloudreve_GKE` can wire
`module_secret_env_vars` / `explicit_secret_values` uniformly with every other
application module, the same as if a real secret existed.

Because the password is never stored in Secret Manager, there is no
`gcloud secrets` command that retrieves it. Capture it from the logs
immediately after the first deployment, before the log buffer rotates:

```bash
# Cloud Run
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 200 \
  | grep -i "admin\|password"

# GKE
kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
```

Once retrieved, change the password via the Cloudreve web UI — there is no
other recovery path if it is lost.

If the operator supplies `secret_environment_variables` on the platform
deployment (for a use case unrelated to Cloudreve's own credentials), those
are still injected through the standard Secret Manager mechanism managed by
the foundation — see [App_Common](App_Common.md).

---

## 3. Database engine and bootstrap

Cloudreve requires **no external database**. `database_type` is fixed to
`"NONE"` in the module's `config` output (along with `db_name = ""` and
`db_user = ""`), and `enable_cloudsql_volume` is hardcoded to `false` — no
Cloud SQL instance, database, or user is ever provisioned for this
application, regardless of what any `database_*`/`db_*`/`sql_*` variable is
set to on the platform deployment (those variables are forwarded only for
Foundation-interface compatibility and are no-ops here).

Cloudreve instead uses an **embedded SQLite database** (`cloudreve.db`)
alongside a generated `conf.ini` and uploaded files, all stored directly under
its working directory `/cloudreve` on the persistent volume (GCS FUSE on Cloud
Run, a block PVC on GKE). There is therefore no `db-init` job either:

```hcl
# main.tf
initialization_jobs = length(var.initialization_jobs) > 0 ? [ ... ] : []
```

`Cloudreve_Common` never injects a default job here — only operator-supplied
jobs run. On first start, Cloudreve itself creates the SQLite schema on the
mounted volume and seeds the initial admin account (see §2); there is no
separate migration step to run or monitor.

To inspect the SQLite file directly:

```bash
# Cloud Run — no shell access to the running container; use a one-off exec
# via the platform's job mechanism, or GCS FUSE from an authorized workstation.
gcloud storage ls gs://<data-bucket>/

# GKE — exec into the pod directly
kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /cloudreve
kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- sqlite3 /cloudreve/cloudreve.db ".tables"
```

---

## 4. Container image and entrypoint

The custom image wraps `cloudreve/cloudreve:${CLOUDREVE_VERSION}` — pinned via
an **app-specific build ARG** (`CLOUDREVE_VERSION`, not the generic
`APP_VERSION` the Foundation injects and would otherwise force to the
unresolvable tag `latest`). `application_version = "latest"` resolves to the
last verified-compatible v3 release, `3.8.3`, whose data layout matches this
module (embedded SQLite at `/cloudreve/cloudreve.db`, uploads under
`/cloudreve/uploads`, admin password printed to logs on first boot).

Unlike most custom-build application modules, there is **no shell
entrypoint script** and no runtime env-var translation logic. The Dockerfile
(`modules/Cloudreve_Common/scripts/Dockerfile`) exists purely to fix a
**volume-shadowing** problem and nothing else:

```dockerfile
ARG CLOUDREVE_VERSION=3.8.3
FROM cloudreve/cloudreve:${CLOUDREVE_VERSION} AS src

FROM cloudreve/cloudreve:${CLOUDREVE_VERSION}
COPY --from=src /cloudreve/cloudreve /usr/local/bin/cloudreve
WORKDIR /cloudreve
ENTRYPOINT ["/usr/local/bin/cloudreve"]
```

Upstream's `cloudreve/cloudreve` image keeps **both** the `cloudreve` binary
and its data (`cloudreve.db`, `conf.ini`, `uploads/`) in the same directory,
`/cloudreve`. Mounting a fresh persistent volume (GCS FUSE bucket on Cloud
Run, block PVC on GKE) at that path to persist the data would also **hide the
binary underneath it**, producing `exec ./cloudreve: no such file or
directory` at container start (a crash loop). The fix is a multi-stage build:
the first stage (`AS src`) is just a handle on the pristine upstream image;
the final stage `COPY --from=src`s the binary out to `/usr/local/bin/cloudreve`
— a path that is never mounted over — and sets `ENTRYPOINT` to that absolute
path, while `WORKDIR` stays `/cloudreve` so the app still reads/writes its
persistent data on the volume exactly as it expects. This is precisely why
Cloudreve is built as a **custom image** (`image_source = "custom"`,
`container_build_config.enabled = true`) rather than a bare pass-through of
the upstream tag.

Because the fix lives in the Dockerfile, editing it requires an image
rebuild — a content-hash trigger miss can be forced with:

```bash
tofu taint 'module.app_<cloudrun|gke>.module.app_build.null_resource.build_and_push_application_image[0]'
```

No environment-variable translation, URL correction, or startup scripting
happens anywhere in this layer — `environment_variables` passed in from the
platform deployment reach the container completely unmodified (see §5).

---

## 5. Core application settings

`Cloudreve_Common`'s `config` output is deliberately minimal compared to most
application Common modules — Cloudreve needs almost no baseline environment
to boot correctly, because it has no env-var-driven database DSN, no data-dir
override, and no queue/telemetry toggles:

- **`environment_variables`** — passed straight through from the platform
  deployment's own `environment_variables` variable with **no defaults
  injected**. Cloudreve has no data-directory environment variable (it uses
  relative paths from its working directory), so nothing needs to be set for
  a correct first boot.
- **`container_port`** — hardcoded to `5212` directly in the `config` output
  (not derived from a variable), matching Cloudreve's fixed internal listen
  port.
- **`database_type` / `db_name` / `db_user`** — hardcoded to `"NONE"` / `""` /
  `""`; **`enable_cloudsql_volume`** hardcoded to `false`. None of these are
  configurable per-deployment because Cloudreve has no database.
- **`min_instance_count` / `max_instance_count`** — forwarded from the
  variables of the same name, both defaulting to `1`. Cloudreve has no
  verified multi-node/clustering mode, and running more than one instance
  risks concurrent writers against the same single-writer SQLite file.
- **`container_resources`** — merges `cpu_limit`/`memory_limit` (or a full
  `container_resources` override) with `cpu_request`/`mem_request`/ephemeral
  storage left `null`, letting the foundation apply its own defaults for the
  unset fields.

Platform-specific adjustment handled here (via the `enable_gcs_storage_volume`
variable and the `_cloudreve_extra_storage_volumes` local):

- **Cloud Run** always leaves `enable_gcs_storage_volume = true` — Cloud Run
  has no block-volume option, so the auto-created `storage` bucket is always
  mounted via GCS FUSE at `/cloudreve`.
- **GKE** sets `enable_gcs_storage_volume = false` whenever
  `stateful_pvc_enabled = true` (the GKE variant's default), because the
  block PVC is mounted at the same `/cloudreve` path and a second GCS FUSE
  mount there would conflict. With the block PVC in place, the `storage`
  bucket still exists (see §7) but sits unmounted.

---

## 6. Health probe behaviour

`Cloudreve_Common` defines the `startup_probe` and `liveness_probe` variables
that both platform variants forward unchanged — there is **no CloudRun vs.
GKE difference** in probe configuration for Cloudreve, unlike applications
whose GKE and Cloud Run defaults diverge. Cloudreve has no dedicated health
endpoint distinct from its web UI; `/` returns HTTP 200 once the server is
serving requests.

- **Startup probe** — HTTP `GET /`, `initial_delay_seconds = 15`,
  `timeout_seconds = 5`, `period_seconds = 10`, `failure_threshold = 10`
  (i.e. up to ~100 seconds after the initial delay to become ready).
- **Liveness probe** — HTTP `GET /`, `initial_delay_seconds = 30`,
  `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

Both probes are declared as full `object` variables with defaults in
`Cloudreve_Common/variables.tf` and forwarded through the `config` output as
`startup_probe`/`liveness_probe`; the platform variants may override them via
their own `startup_probe`/`liveness_probe` variables, but ship with these
values unchanged.

---

## 7. Object storage

A single **Cloud Storage** bucket (`name_suffix = "storage"`) is declared in
the `storage_buckets` output and provisioned by the foundation:

- `location = ""` — left empty so the foundation resolves it via
  `coalesce(bucket.location, local.region)`, placing the bucket in the
  auto-discovered deployment region rather than pinning a location that could
  force a destructive replacement on re-apply in a different region.
- `storage_class = "STANDARD"`, `force_destroy = true`,
  `versioning_enabled = false`, `public_access_prevention = "enforced"`, no
  lifecycle rules.

Whether this bucket is actually **mounted** into the running container
depends on `enable_gcs_storage_volume` (see §5): when `true`, it is added to
`gcs_volumes` as `{ name = "storage", mount_path = "/cloudreve", read_only =
false }` and mounted via GCS FUSE — this is always the case on Cloud Run, and
on GKE only when the block PVC is disabled. When mounted at the same path as
a GKE block PVC, the two would double-mount and conflict, which is exactly
why the GKE variant flips this flag off by default.

List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

For the Cloudreve-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Cloudreve_GKE](Cloudreve_GKE.md)** and
**[Cloudreve_CloudRun](Cloudreve_CloudRun.md)**.
