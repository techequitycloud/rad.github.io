---
title: "Netdata Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Netdata module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Netdata Common — Shared Application Configuration

`Netdata_Common` is the **shared application layer** for Netdata. It is not
deployed on its own; instead it supplies the Netdata-specific configuration that
both [Netdata_GKE](Netdata_GKE.md) and [Netdata_CloudRun](Netdata_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

Netdata is an open-source, real-time infrastructure and application monitoring
agent. It collects thousands of metrics per second and serves per-second-granularity
dashboards and a REST API on port **19999**. It has **no external database** — it
stores its metrics, alarm log, and health state on local disk under
`/var/lib/netdata` — and requires **no first-run wizard or schema bootstrap**.

For the infrastructure that actually provisions and runs Netdata, see the platform
guides ([Netdata_GKE](Netdata_GKE.md), [Netdata_CloudRun](Netdata_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Netdata_Common | Where it surfaces |
|---|---|---|
| Container image | Thin wrapper `FROM netdata/netdata:<version>` built via Cloud Build (Kaniko) and mirrored into **Artifact Registry** | `container_image` output of the platform deployment |
| Image version pinning | App-specific `NETDATA_VERSION` build arg (defaults to `v2.2.6` when `application_version = "latest"`) | Build config |
| Database engine | **None** — `database_type = "NONE"`; Netdata keeps metrics in its own on-disk dbengine | §Database in the platform guides |
| Database bootstrap | **None** — no `db-init` job is injected; only user-supplied `initialization_jobs` run | `initialization_jobs` output |
| Object storage | Declares one **Cloud Storage** data bucket (suffix `storage`) that persists `/var/lib/netdata` on Cloud Run | `storage_buckets` output |
| Persistence volume | Mounts the storage bucket as a **GCS FUSE** volume at `/var/lib/netdata` (`enable_gcs_storage_volume`), toggled off on GKE when a block PVC is used | §Persistence |
| Optional admin credential | When `enable_admin_password = true`, generates a 32-char password in **Secret Manager** and injects it as `NETDATA_ADMIN_PASSWORD` | `secret_ids` / `secret_values` outputs |
| Core settings | Sets `NETDATA_LISTENER_PORT = "19999"` (matches `container_port`) | Application behaviour |
| Health checks | Supplies the default startup/liveness probe targeting `/api/v1/info` | §Observability in the platform guides |

---

## 2. Container image and build

Netdata is a **prebuilt upstream image**, but this module still runs it through
the Foundation's Cloud Build path so the image is mirrored into the deployment's
Artifact Registry (avoiding a runtime pull from Docker Hub). The `Dockerfile` is a
thin wrapper:

```dockerfile
ARG NETDATA_VERSION=v2.2.6
FROM netdata/netdata:${NETDATA_VERSION}
```

- **`image_source = "custom"`** with `container_build_config.enabled = true`.
- **`NETDATA_VERSION` is an app-specific build arg**, deliberately *not* the generic
  `APP_VERSION` the Foundation injects. When `application_version = "latest"` the
  wrapper pins `v2.2.6` (a real tag) rather than a non-existent `netdata:latest`
  wrapper build; any explicit `application_version` is honoured verbatim.
- No custom entrypoint is layered on — the upstream image's own entrypoint starts
  the agent.

Inspect the built/mirrored image:

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo>/netdata --project "$PROJECT"
```

---

## 3. No database, no bootstrap job

Netdata does **not** use Cloud SQL, MySQL, PostgreSQL, or any managed database:

- `database_type = "NONE"`, `enable_cloudsql_volume = false`, `db_name`/`db_user`
  are empty in the Common config (the `db_name`/`db_user` variables on the variants
  exist only for Foundation compatibility and are not referenced).
- **No `db-init` job is injected.** The `initialization_jobs` list is empty unless
  an operator supplies custom jobs (e.g. seeding config or migrating data); Netdata
  needs none to start.
- There are **no schema migrations** on start — the agent writes its round-robin
  metrics database directly to disk.

---

## 4. Persistence and object storage

Netdata persists its metrics database (dbengine), alarm log, and health state under
**`/var/lib/netdata`**; `/var/cache/netdata` holds the ephemeral round-robin cache.
How `/var/lib/netdata` is backed differs by platform, and this layer wires both:

- **Cloud Run** — the declared Cloud Storage bucket is mounted as a **GCS FUSE**
  volume at `/var/lib/netdata` (`enable_gcs_storage_volume = true`). One data bucket
  is declared in the `storage_buckets` output (suffix `storage`, `STANDARD` class,
  `force_destroy = true`, `public_access_prevention = enforced`). Its location is
  left empty so the Foundation places it in the auto-discovered deployment region.
- **GKE** — a per-pod **block PVC** (StatefulSet) is mounted at the same
  `/var/lib/netdata`; the wrapper sets `enable_gcs_storage_volume = false` in that
  case to avoid a double-mount at the same path. Block storage is required on GKE
  because GCS FUSE cannot provide the filesystem semantics Netdata's SQLite/dbengine
  files need.

List the data bucket:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~netdata"
```

---

## 5. Optional admin password in Secret Manager

Netdata's local dashboard is **unauthenticated by default**. When
`enable_admin_password = true`, this layer:

1. Generates a **32-character** random password (`random_password`, no special
   characters),
2. Stores it in Secret Manager as
   `secret-<wrapper_prefix>-netdata-admin-password`,
3. Injects it into the container as the **`NETDATA_ADMIN_PASSWORD`** environment
   variable so an operator-side auth layer (a reverse proxy doing basic-auth, or a
   Netdata Cloud claim flow) can reference a stable, secret-backed credential
   instead of a hand-managed one.

The injection path differs by platform: **Cloud Run** injects it via the Foundation's
`module_secret_env_vars` (Secret Manager → secret env), while **GKE** injects it via
`explicit_secret_values` (a native Kubernetes Secret) so both variants deliver the
same raw value. When `enable_admin_password = false`, no secret is created and the
`secret_ids` output is empty.

Retrieve it after deployment:

```bash
# Find the secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~netdata-admin-password"

# Read the current value:
gcloud secrets versions access latest \
  --secret=secret-<wrapper_prefix>-netdata-admin-password --project "$PROJECT"
```

An orphaned-secret cleanup submodule runs first so a re-deploy after a prior destroy
does not collide on the secret name.

---

## 6. Core settings, port, and health probes

`Netdata_Common` establishes the baseline environment so the agent comes up
correctly on first boot:

- **Listener port** — `NETDATA_LISTENER_PORT = "19999"`, matching the
  `container_port` the Foundation routes traffic to. Netdata serves both the
  dashboard and the REST API on this single port.
- **Health path** — the default startup and liveness probes target **`/api/v1/info`**,
  which returns a `200` JSON body once the agent is fully initialised and continues
  to while it is running. The startup probe allows a 15-second initial delay and a
  10-retry window; the liveness probe polls every 30 seconds after a 30-second delay.
- **Scaling** — `min_instance_count = 1` / `max_instance_count = 1` by default.
  Netdata is a **per-instance** monitoring agent: each replica keeps its own local
  metrics database, so it is not horizontally shared-state scalable — running one
  instance is the norm.
- **Additional environment variables** supplied via `environment_variables` are
  merged on top of the baseline; there are no other mandatory app settings.

---

For the Netdata-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Netdata_GKE](Netdata_GKE.md)** and **[Netdata_CloudRun](Netdata_CloudRun.md)**.
