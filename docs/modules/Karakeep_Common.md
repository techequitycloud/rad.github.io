---
title: "Karakeep Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Karakeep module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Karakeep Common — Shared Application Configuration

`Karakeep_Common` is the **shared application layer** for Karakeep. It is not
deployed on its own; instead it supplies the Karakeep-specific configuration that
both [Karakeep_GKE](Karakeep_GKE.md) and [Karakeep_CloudRun](Karakeep_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Karakeep, see the
platform guides ([Karakeep_GKE](Karakeep_GKE.md),
[Karakeep_CloudRun](Karakeep_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Karakeep_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `NEXTAUTH_SECRET` (44-char alphanumeric) and `MEILI_MASTER_KEY` (32-char alphanumeric) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | References the official `ghcr.io/karakeep-app/karakeep` image directly — no custom build | `container_image` output of the platform deployment |
| Database engine | **None** — `database_type = "NONE"`; Karakeep uses no Cloud SQL instance | §Database in the platform guides |
| Persistence | Declares no database bootstrap job; state lives entirely on the platform's NFS volume, wired at the Application Module level | N/A — no `initialization_jobs` from this layer |
| Object storage | None — `storage_buckets = []` | `storage_buckets` output (empty) |
| Core settings | Sets the baseline port (3000) and probe targets | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager:

- **`NEXTAUTH_SECRET`** — a 44-character random alphanumeric string. Signs all
  session JWTs. Rotating it after first boot immediately invalidates every
  active user session, forcing everyone to log back in.
- **`MEILI_MASTER_KEY`** — a 32-character random alphanumeric string, shared
  between the Karakeep app and its Meilisearch sidecar. Both must present this
  key when talking to Meilisearch. It can be rotated, but the app and the
  sidecar must be redeployed together — a stale key on either side breaks
  search authentication between them.

Retrieve the secrets after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

No database password secret exists for this module — there is no database. See
[App_Common](App_Common.md) for the shared secret and Workload Identity model
used elsewhere in the catalogue.

---

## 3. No database, no bootstrap job

Karakeep persists entirely to an embedded SQLite database and uploaded assets
under `DATA_DIR` (`/data`) on the platform's NFS volume — there is no Cloud SQL
instance, and therefore no `db-init`-style bootstrap job from this layer.
`database_type = "NONE"` is set explicitly in the `config` output so the
Foundation skips provisioning a Cloud SQL instance entirely.

`enable_nfs` and `nfs_mount_path` are ordinary Foundation variables declared and
forwarded at the **Application Module** level (`Karakeep_CloudRun`/`Karakeep_GKE`),
not by this Common layer — Common only assumes the volume will be present.

---

## 4. Container image

`Karakeep_Common` sets `container_image = "ghcr.io/karakeep-app/karakeep:<tag>"`
and `image_source = "prebuilt"` directly — no Dockerfile, no Cloud Build step.
This is a deliberate departure from this module's clone source
(`UptimeKuma_Common`), which needed a custom build to patch SQLite's journal
mode away from WAL. Karakeep's own source already gates WAL mode behind an
opt-in `DB_WAL_MODE` environment variable (defaulting to the NFS-safe `DELETE`
mode), which this module never sets — so no patch is required.

`<tag>` resolves from `application_version`: `"latest"` maps to Karakeep's own
rolling `"release"` tag (there is no literal `"latest"` tag on Docker Hub/GHCR);
any other value passes through unchanged (e.g. `"0.28.0"`).

---

## 5. The Meilisearch sidecar (declared at the Application layer)

Karakeep requires Meilisearch for search — without it, `MEILI_ADDR` is unset and
search is silently disabled. This sidecar is **not** declared by
`Karakeep_Common`; it's added by each Application Module (`Karakeep_CloudRun`/
`Karakeep_GKE`) via the Foundation's `additional_services` mechanism, referencing
`Karakeep_Common`'s `MEILI_MASTER_KEY` secret output so the app and the sidecar
share the same authentication key. See the platform guides for the exact wiring.

---

## 6. Health probe behaviour

The default probes target `/` — Karakeep's public login/landing page, reachable
without authentication. Karakeep does not document a dedicated `/health` or
`/healthz` endpoint.

- **Cloud Run and GKE** both use an HTTP probe targeting `/` with a 30-second
  initial delay and a generous failure threshold (30 for startup) to tolerate
  first-boot schema setup.

---

For the Karakeep-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Karakeep_GKE](Karakeep_GKE.md)** and
**[Karakeep_CloudRun](Karakeep_CloudRun.md)**.
