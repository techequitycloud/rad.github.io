---
title: "VictoriaMetrics Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the VictoriaMetrics module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# VictoriaMetrics Common — Shared Application Configuration

`VictoriaMetrics_Common` is the **shared application layer** for
VictoriaMetrics. It is not deployed on its own; instead it supplies the
VictoriaMetrics-specific configuration that
[VictoriaMetrics_GKE](VictoriaMetrics_GKE.md) builds on. Unlike most
Common modules in this catalog, it has only a single consumer — there is
**no Cloud Run variant** (see §1 of the [VictoriaMetrics_GKE guide](VictoriaMetrics_GKE.md)
for why). End users never configure this layer directly — it has no
deployment UI inputs of its own — but understanding what it provides explains
the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs VictoriaMetrics, see
the platform guide ([VictoriaMetrics_GKE](VictoriaMetrics_GKE.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by VictoriaMetrics_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official `victoriametrics/victoria-metrics` image via a custom build (`image_source = "custom"`) | `container_image` output of the platform deployment |
| No SQL database | Fixes `database_type = "NONE"` — VictoriaMetrics is itself a time-series database | No Cloud SQL instance or database credentials are created |
| No Redis | No cache dependency | `enable_redis` is hard-coded to `false` in `VictoriaMetrics_GKE`'s `main.tf` |
| CLI-flag entrypoint | Pins `-storageDataPath=/victoria-metrics-data`, `-httpListenAddr=:8428`, `-retentionPeriod=12` in the custom Dockerfile's `ENTRYPOINT` | Container startup command; not exposed as environment variables |
| No object storage bucket | `storage_buckets` output is always `[]` — VictoriaMetrics's GCS/S3 integration is backup-only, never live query-serving storage | Primary storage is exclusively the GKE StatefulSet PVC (defined entirely in `VictoriaMetrics_GKE`) |
| No secrets | `secret_ids` output is always `{}` — VictoriaMetrics has no built-in authentication | No Secret Manager secrets are created for this module |
| Health probes | Supplies the default startup and liveness probe configuration, both targeting the single `/health` endpoint | §Observability in the platform guide |

---

## 2. No authentication, no secrets

VictoriaMetrics has no built-in user/password or API-key authentication
model, so `VictoriaMetrics_Common` generates nothing to store in Secret
Manager — its `secret_ids` output is unconditionally `{}`:

```hcl
output "secret_ids" {
  description = "VictoriaMetrics has no built-in authentication and needs no generated secrets. Gate access at the network layer (ClusterIP + internal-only ingress, or IAP)."
  value       = {}
}
```

Access control for this module is entirely a network-layer decision made in
`VictoriaMetrics_GKE`: `service_type = "ClusterIP"` by default keeps the
workload reachable only from inside the cluster (e.g. by Grafana or a
Prometheus `remote_write` sender running alongside it). If you need to expose
it more broadly, layer on IAP or Cloud Armor — VictoriaMetrics will accept
and act on any request that reaches it.

---

## 3. Storage — StatefulSet PVC only, no bucket

VictoriaMetrics manages its own embedded time-series storage engine. There is
**no Cloud SQL database**, **no GCS FUSE storage mode**, and **no database
bootstrap job**. On first start, VictoriaMetrics initialises its data
directory at `/victoria-metrics-data` automatically.

Unlike Common modules for apps that support both a GCS FUSE bucket and a PVC
(e.g. Qdrant), `VictoriaMetrics_Common` declares **no storage bucket at all**
— its `storage_buckets` output is hard-coded to `[]`:

```hcl
# No object-storage bucket is created — VictoriaMetrics's S3/GCS integration
# is backup-only (vmbackup/vmrestore snapshots), never live query-serving
# storage. Primary storage is exclusively the GKE StatefulSet PVC.
output "storage_buckets" {
  value = []
}
```

The `enable_gcs_storage_volume` variable exists purely for interface parity
with sibling modules' PVC-vs-bucket toggle pattern. `VictoriaMetrics_GKE`
always passes `false` for it (since `stateful_pvc_enabled = true` is the
default), and it must never be `true` in practice — VictoriaMetrics's mmap'd
local-disk data files are not GCS FUSE compatible even as a fallback mode
(unlike some apps where FUSE is a slower-but-workable degraded option).

Explore storage resources:

```bash
# PVC status
kubectl get pvc -n "$NAMESPACE"
kubectl describe pvc -n "$NAMESPACE"

# Underlying Persistent Disk
gcloud compute disks list --project "$PROJECT" --filter="name~victoriametrics"

# Data files inside the pod
kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /victoria-metrics-data
```

---

## 4. Core application settings — CLI flags, not environment variables

`VictoriaMetrics_Common` establishes the VictoriaMetrics baseline
configuration entirely through a custom `ENTRYPOINT`, because **VictoriaMetrics
has no environment-variable-based configuration — only CLI flags**:

```dockerfile
ARG VM_VERSION=v1.148.0
FROM victoriametrics/victoria-metrics:${VM_VERSION}

ENTRYPOINT ["/victoria-metrics-prod", "-storageDataPath=/victoria-metrics-data", "-httpListenAddr=:8428", "-retentionPeriod=12"]
```

- **Storage path** — `-storageDataPath=/victoria-metrics-data` matches the
  StatefulSet PVC mount path configured in `VictoriaMetrics_GKE`
  (`stateful_pvc_mount_path`, same default). The upstream image's default
  `CMD` otherwise writes to a *relative* `./victoria-metrics-data` path with
  no listen-address override, which is why a thin custom `ENTRYPOINT` is
  needed at all.
- **Listen address** — `-httpListenAddr=:8428` binds all interfaces on
  VictoriaMetrics's documented default port.
- **Retention** — `-retentionPeriod=12` sets a 12-month (1-year) retention
  window. VictoriaMetrics interprets a bare integer as months (a suffix like
  `d`/`w`/`y` selects a different unit). **This is baked into the image, not a
  Terraform variable** — changing it means editing this Dockerfile and
  forcing a rebuild (e.g. `tofu taint` on the module's build resource).
- **Build argument naming** — the Dockerfile's version pin uses the
  app-specific `VM_VERSION` build ARG, not the generic `APP_VERSION` that the
  Foundation module injects into `build_args` and would otherwise silently
  win the merge. `application_version = "latest"` maps to the pinned known-good
  release `v1.148.0` at build time (the upstream image has no floating
  `latest` tag of its own).
- **`environment_variables` is still forwarded** into the container
  environment for interface parity with every other module in this catalog,
  but values set there have no effect on VictoriaMetrics's own behaviour
  unless the upstream binary happens to read that exact variable name (it
  does not, by default).

---

## 5. Health probe behaviour

VictoriaMetrics exposes a single, unauthenticated health endpoint used by
both probes:

| Endpoint | Purpose | Used by |
|---|---|---|
| `/health` | Returns `OK` once the process is up and serving | Startup probe **and** liveness probe |

Unlike apps with a heavier startup sequence that need distinct readiness and
liveness semantics (e.g. Qdrant's `/readyz` vs `/livez` split, where
readiness can legitimately flap while data loads), VictoriaMetrics has no
equivalent long-loading phase for a fresh or moderately sized dataset, so one
endpoint suffices for both probe types.

---

## 6. No initialization job

VictoriaMetrics manages its own embedded storage engine and requires no
schema, migration, or seed data — it is a self-contained binary. No
initialization job is injected by default. If `var.initialization_jobs` is
non-empty in the wrapper (for a custom bootstrap task you add yourself),
those jobs are passed through to the foundation after normalizing field
types; otherwise none is created.

---

For the VictoriaMetrics-specific, user-facing configuration (variables by
group, outputs, and how to explore each service from the Console and CLI),
see the platform guide: **[VictoriaMetrics_GKE](VictoriaMetrics_GKE.md)**.
