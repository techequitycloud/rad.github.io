---
title: "Uptime Kuma Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Uptime Kuma module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Uptime Kuma Common — Shared Application Configuration

`UptimeKuma_Common` is the **shared application layer** for Uptime Kuma. It is not deployed on its own; instead it supplies the Uptime Kuma-specific configuration that both [UptimeKuma_CloudRun](UptimeKuma_CloudRun.md) and the GKE variant build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Uptime Kuma, see the platform guide ([UptimeKuma_CloudRun](UptimeKuma_CloudRun.md)) and the foundation guides ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by UptimeKuma_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official prebuilt `louislam/uptime-kuma` image (tag `1`, the v1 stable line) with Artifact Registry mirroring enabled — **no Cloud Build** | `container_image` output of the platform deployment |
| Database engine | Fixes **`database_type = "NONE"`** — Uptime Kuma v1 uses an embedded SQLite database under `/app/data`; no Cloud SQL, no Auth Proxy | §Database in the platform guide |
| Secrets | Exposes an **empty `secret_ids` map** — no application secrets exist; admin credentials live in the SQLite database | `secret_ids` output |
| Object storage | Exposes an **empty `storage_buckets` list** — persistence comes from the Foundation's NFS volume, not GCS | `storage_buckets` output |
| Initialization jobs | None by default — Uptime Kuma creates its SQLite schema on first boot; user-supplied jobs are passed through if provided | `initialization_jobs` in the config |
| Container port | `3001` — Uptime Kuma's native listen port | Service and probe wiring |
| Health probes | Default startup (`/`, 30 s initial delay, 30 failures at 10 s) and liveness (`/`, 30 s delay, 3 failures at 30 s) HTTP probes on port 3001 | §Observability in the platform guide |

---

## 2. Container image

`UptimeKuma_Common` sets `image_source = "prebuilt"` and `container_build_config.enabled = false`: the official Docker Hub image `louislam/uptime-kuma:<version>` is deployed as-is, with no custom Dockerfile and no custom entrypoint. `enable_image_mirroring = true` copies the image into the project's Artifact Registry before deployment so production pulls never depend on Docker Hub availability or rate limits.

The default `application_version` is `1` — the v1 stable line, which stores all state in embedded SQLite. Inspect the mirrored image:

```bash
gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>" \
  --filter="package~uptime-kuma"
```

---

## 3. No database, no secrets

Uptime Kuma v1 keeps everything — monitors, check history, notification settings, status pages, and the admin user — in an **embedded SQLite database** under `/app/data`. Consequently this layer:

- fixes `database_type = "NONE"` and `enable_cloudsql_volume = false` (no Cloud SQL instance, no Auth Proxy sidecar, no `db-init` job);
- outputs `secret_ids = {}` and `secret_values = {}` — there is nothing to create in Secret Manager. The only credential is the admin account you create interactively on first access, stored inside SQLite.

Confirm no app-specific secrets or SQL instances exist for the deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~uptimekuma"
gcloud sql instances list --project "$PROJECT"
```

---

## 4. Persistence — SQLite on the NFS volume

Because state is a SQLite file, durability comes from **where that file lives**. The Application modules default to `enable_nfs = true` with `nfs_mount_path = "/app/data"`, so the Foundation mounts a Cloud Filestore (NFS) share over Uptime Kuma's data directory. The database, uploads, and settings then survive restarts, new revisions, and scale events.

Two operational rules follow directly from SQLite-on-NFS:

1. **The mount path must remain `/app/data`.** Any other path leaves Uptime Kuma writing to ephemeral container disk — total data loss on the next restart.
2. **Run a single writer.** SQLite is a single-writer database and relies on the NFS server honouring file locks; keep `max_instance_count = 1` in production to avoid lock contention or corruption.

```bash
gcloud filestore instances list --project "$PROJECT"
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format="yaml(spec.template.spec.volumes)"
```

---

## 5. Runtime defaults

The layer's resource and scaling defaults are sized for a typical monitoring workload:

- **CPU/memory** — `1000m` / `512Mi` per instance; ample for dozens of monitors.
- **Scaling** — `min_instance_count = 1` / `max_instance_count = 10` at this layer; the CloudRun variant overrides these (`min = 0`, `max = 3`) — see the platform guide's Pitfalls for why production monitoring wants `min = 1` and `max = 1`.
- **Always-allocated CPU** — set in the platform variant (`cpu_always_allocated = true`): Uptime Kuma's check scheduler runs in-process with no inbound request, so CPU must not be throttled between requests.

---

## 6. Health probe behaviour

Both probes are HTTP `GET /` on port `3001` — Uptime Kuma serves its root path unauthenticated with HTTP 200 once the Node.js server is up.

- **Startup probe** — HTTP `/`, initial delay 30 s, period 10 s, failure threshold 30. That allows up to 30 + (30 × 10) = 330 seconds from container start, covering first-boot SQLite schema creation on a cold NFS mount.
- **Liveness probe** — HTTP `/`, initial delay 30 s, period 30 s, failure threshold 3.

There is no separate authenticated health endpoint to worry about — the root path is public, so probes pass on both Cloud Run and GKE without special-casing.

---

For the Uptime Kuma-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guide:
**[UptimeKuma_CloudRun](UptimeKuma_CloudRun.md)**.
