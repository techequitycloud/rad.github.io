---
title: "Loki Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Loki module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Loki Common — Shared Application Configuration

`Loki_Common` is the **shared application layer** for
[Grafana Loki](https://grafana.com/oss/loki/). It is not deployed on its own;
instead it supplies the Loki-specific configuration that both
[Loki_GKE](Loki_GKE.md) and [Loki_CloudRun](Loki_CloudRun.md) build on, so the two
platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Loki, see the platform
guides ([Loki_GKE](Loki_GKE.md), [Loki_CloudRun](Loki_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Loki_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `grafana/loki` image with a custom entrypoint (config templating); builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | **None** — `database_type = "NONE"`. Loki has no external database; its chunks and TSDB index live in GCS | §Database in the platform guides |
| Database bootstrap | **None** — no `db-init` job is injected. `initialization_jobs` is passed through unchanged (empty by default) | `initialization_jobs` output |
| Cryptographic secrets | **None** — `secret_ids` and `secret_values` are both empty. Loki needs no deploy-time credentials (`auth_enabled: false`, single-tenant) | `secret_ids` / `secret_values` outputs |
| Object storage | **One GCS bucket** (`storage`), Loki's own object-storage backend for chunks and the shipped TSDB index | `storage_buckets` output, `storage_sa_bucket_name` output |
| IAM | Grants the running compute identity `roles/storage.objectAdmin` on the bucket | Configured directly in each variant's `loki.tf`, not in `Loki_Common` itself |
| Core settings | Fixes `container_port = 3100`; injects `LOKI_GCS_BUCKET` at deploy time | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/ready` | §Observability in the platform guides |
| Scaling guard | Overrides `max_instance_count = 1` in the config handed to the Foundation, regardless of the caller's value | §Application Behaviour in the platform guides |

---

## 2. No secrets, no database — one GCS bucket

Unlike most application modules, `Loki_Common` generates **nothing** in Secret
Manager and provisions **no** Cloud SQL instance:

```hcl
output "secret_ids" {
  value = {}
}

output "secret_values" {
  sensitive = true
  value     = {}
}
```

- `database_type = "NONE"`, `db_name = ""`, `db_user = ""` — no Cloud SQL instance is
  created. Every database-related variable exposed by the platform guides
  (`application_database_name`, `application_database_user`,
  `enable_cloudsql_volume`, `database_password_length`, …) is inert.
- With `auth_enabled: false` baked into Loki's own config, there is no built-in
  authentication layer for `Loki_Common` to bootstrap a credential for.

**Storage is not optional, unlike most modules' `storage_buckets`.** Loki
*requires* an object-storage backend for its chunks and index. `Loki_Common`'s
`storage_buckets` output always declares one bucket:

```hcl
output "storage_buckets" {
  value = [
    {
      name_suffix              = "storage"
      location                 = ""
      storage_class            = "STANDARD"
      force_destroy             = true
      versioning_enabled       = false
      lifecycle_rules          = []
      public_access_prevention = "enforced"
    }
  ]
}
```

Retrieve it post-deploy:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage du -s gs://<storage-bucket>/
```

---

## 3. Object storage IAM — configured per variant, not in Common

`Loki_Common` outputs `storage_sa_bucket_name` — the bucket's deterministic name,
`gcs-${service_name}-storage` — specifically so each platform variant's own
`loki.tf` (not `Loki_Common` itself) can grant the running compute identity access
to it directly:

```hcl
# Loki_CloudRun/loki.tf
resource "google_storage_bucket_iam_member" "loki_storage_admin" {
  bucket = module.app_cloudrun.storage_buckets["storage"]
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:cloudrun-sa-${local.resource_prefix}@${var.project_id}.iam.gserviceaccount.com"
}
```

The GKE variant does the identical thing against `gke-sa-${local.resource_prefix}`.
Both reference the storage submodule's own bucket output — not `depends_on = [the
whole Foundation module]` — deliberately, because Loki needs this grant before its
first pod/revision can even become healthy; depending on the whole Foundation
module (which itself waits for a healthy workload) would deadlock.

Loki's native GCS client uses **Application Default Credentials** (the running
service's own identity) — no HMAC key or S3-interop credential is used, unlike apps
that route through Loki's alternative S3-interop storage path (deliberately avoided
here to sidestep GCS/AWS-SDK checksum-compatibility risk).

---

## 4. Container image and entrypoint

The custom image wraps the official `grafana/loki` image — but `grafana/loki` is
**genuinely distroless**: inspecting the image filesystem shows only
`/usr/bin/loki` — no `/bin/sh`, no coreutils, and no dynamic linker at all.

```dockerfile
ARG LOKI_VERSION=3.6.12
FROM busybox:musl AS busybox

FROM grafana/loki:${LOKI_VERSION}
USER root
COPY --from=busybox /bin/busybox /bin/busybox
COPY loki-config.yaml /etc/loki/local-config.yaml.template
COPY entrypoint.sh /entrypoint.sh
USER 10001
EXPOSE 3100
ENTRYPOINT ["/bin/busybox", "sh", "/entrypoint.sh"]
```

- **App-specific build ARG.** The base tag is driven by `LOKI_VERSION`, **not** the
  generic `APP_VERSION` the Foundation injects (which would force it to `"latest"`
  — Loki's own tags have no `v` prefix, e.g. `3.6.12`). `Loki_Common` computes:
  `loki_image_version = var.application_version == "latest" ? "3.6.12" : var.application_version`.
- **Statically-linked busybox, deliberately.** Grafting a binary from the default
  `busybox:stable` tag fails with `exec /bin/busybox: no such file or directory`
  because it is dynamically linked and the distroless target has no dynamic linker.
  `busybox:musl` is genuinely statically linked (verified with `file`: static-PIE,
  no interpreter needed) and runs standalone inside the distroless target — the same
  fix pattern already established in this catalog for other scratch/distroless base
  images (e.g. Vikunja).
- **No applet symlinks.** Only the single `busybox` binary is grafted, so the
  entrypoint invokes busybox by absolute path and the entrypoint script itself calls
  `/bin/busybox sed ...` rather than a bare `sed`.
- **Built via Cloud Build and mirrored.** `image_source = "custom"` with
  `enable_image_mirroring = true`.
- **Runtime user restored.** `USER root` is only active for the `COPY` steps;
  `USER 10001` restores Grafana's own default non-root runtime user before the
  container starts.

---

## 5. Core application settings: config-file templating, not env vars

Loki is **entirely config-file driven** for storage and schema settings. There is no
`LOKI_STORAGE_BACKEND`-style environment variable Loki reads at all. `Loki_Common`
bakes a config template (`loki-config.yaml`) into the image with one placeholder for
the single piece of real per-deployment configuration:

```yaml
storage_config:
  gcs:
    bucket_name: __LOKI_GCS_BUCKET__
```

The entrypoint substitutes the actual bucket name (injected as the
`LOKI_GCS_BUCKET` environment variable by `Loki_Common`) into the template at
container start:

```sh
/bin/busybox sed "s#__LOKI_GCS_BUCKET__#${LOKI_GCS_BUCKET}#" \
  /etc/loki/local-config.yaml.template > /etc/loki/local-config.yaml
exec /usr/bin/loki -config.file=/etc/loki/local-config.yaml
```

Other important defaults baked into the config, inherited by both platform variants:

- **`auth_enabled: false`** — single-tenant, no multi-tenancy.
- **`common.ring.kvstore.store: inmemory`**, `replication_factor: 1` — correct for a
  single-instance monolithic deployment; this is also why `Loki_Common` hard-pins
  `max_instance_count = 1` in the config it passes to the Foundation.
- **`schema_config`** uses `store: tsdb`, `object_store: gcs`, `schema: v13`.
- **`compactor`** performs retention/deletion (`retention_enabled: true`,
  `delete_request_store: gcs`) — a genuine singleton operation.
- **`limits_config.retention_period: 720h`** (30 days) is the default retention
  window.

---

## 6. Health probe behaviour

The default startup and liveness probes target **`/ready`** — Loki's built-in
readiness endpoint, returning HTTP 200 once the server is listening. Because Loki
has no database migrations and config templating happens before the process execs,
it becomes ready within seconds of boot.

---

For the Loki-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Loki_GKE](Loki_GKE.md)** and **[Loki_CloudRun](Loki_CloudRun.md)**.
