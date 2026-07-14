---
title: "DokuWiki Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the DokuWiki module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# DokuWiki Common — Shared Application Configuration

`DokuWiki_Common` is the **shared application layer** for DokuWiki. It is not
deployed on its own; instead it supplies the DokuWiki-specific configuration that
both [DokuWiki_GKE](DokuWiki_GKE.md) and [DokuWiki_CloudRun](DokuWiki_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs DokuWiki, see the platform
guides ([DokuWiki_GKE](DokuWiki_GKE.md), [DokuWiki_CloudRun](DokuWiki_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by DokuWiki_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | **None.** DokuWiki stores its admin credentials in the flat-file data dir (created via `/install.php`), not in a runtime secret env var — `secret_ids` is an empty map | n/a |
| Container image | Thin custom build **FROM `dokuwiki/dokuwiki`** with a wrapper entrypoint; built via Cloud Build (Kaniko) | `container_image` output of the platform deployment |
| Database engine | **None** (`database_type = "NONE"`). DokuWiki is a flat-file wiki — no Cloud SQL, no MySQL, no PostgreSQL | §Database in the platform guides |
| Database bootstrap | **None.** `initialization_jobs = []` — there is no schema to create | n/a |
| Persistent storage | Declares the **Cloud Storage** data bucket backing `/storage` (Cloud Run gcsfuse mount). GKE overrides this to a block PVC instead | `storage_buckets` / `gcs_volumes` in the platform guides |
| Core settings | Fixes the container port (`8080`), image source (`custom`), and the pinned DokuWiki release tag | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting `/` | §Observability in the platform guides |

---

## 2. No cryptographic secrets, no database

DokuWiki is a **lightweight, flat-file wiki**: it stores *all* of its state — pages,
media, plugins, users, and configuration — under a single persistent directory
(`/storage` in the `dokuwiki/dokuwiki` image). There is:

- **No external database.** `database_type = "NONE"`, `enable_cloudsql_volume = false`,
  `initialization_jobs = []`. No Cloud SQL instance is provisioned. Both platform
  variants carry a plan-time validation guard that rejects any non-`NONE`
  `database_type`.
- **No Redis or in-memory cache.**
- **No runtime secret env vars.** `secret_ids` and `secret_values` are both empty
  maps. The administrator account is **not** injected from Secret Manager — it is
  created interactively on the first visit to `/install.php` (see §5).

Because there are no generated secrets or database passwords, the usual
`gcloud secrets` retrieval flow does not apply to DokuWiki. All durable state lives
in the `/storage` volume alone.

---

## 3. Container image and entrypoint

The custom image is a **thin wrapper** around the official upstream image:

```dockerfile
ARG DOKUWIKI_VERSION=2024-02-06b
FROM dokuwiki/dokuwiki:${DOKUWIKI_VERSION}
USER root
COPY dokuwiki-entrypoint.sh /usr/local/bin/dokuwiki-entrypoint.sh
RUN chmod +x /usr/local/bin/dokuwiki-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/dokuwiki-entrypoint.sh"]
```

- **Base image:** `dokuwiki/dokuwiki` (built on the official `php:apache` image),
  serving Apache on **port 8080**.
- **Pinned version:** `dokuwiki/dokuwiki` publishes dated release tags (e.g.
  `2024-02-06b`) plus the moving aliases `stable`/`latest`. `DokuWiki_Common` maps
  the campaign default `application_version = "latest"` to a **pinned dated tag**
  (`2024-02-06b`) so the build never depends on a moving alias. The build ARG is the
  app-specific `DOKUWIKI_VERSION` (not the generic `APP_VERSION`, which the
  Foundation injects into `build_args` and would otherwise overwrite with `latest`).
- **Wrapper entrypoint (`dokuwiki-entrypoint.sh`):** does *not* replace the upstream
  entrypoint. It only ensures the mounted data dir (`/storage`) exists and is
  writable — freshly-provisioned volumes can be empty or root-owned — then hands off
  unchanged to the stock `/dokuwiki-entrypoint.sh`, which seeds `/storage` with the
  default wiki content on first run and starts Apache on 8080. If the stock
  entrypoint is absent it falls back to `docker-php-entrypoint apache2-foreground`.

The image is built with Cloud Build using Kaniko (see `scripts/cloudbuild.yaml`) and,
by default, mirrored into Artifact Registry (`enable_image_mirroring = true`).

---

## 4. Persistent storage

DokuWiki needs a **durable data directory** at `/storage` that survives container
restarts. The two platform variants back it differently:

- **Cloud Run** — `DokuWiki_Common` declares a single `dokuwiki-data` **Cloud Storage**
  bucket and mounts it at `/storage` via **gcsfuse** (`implicit-dirs`,
  `stat-cache-ttl=60s`, `type-cache-ttl=60s`). The bucket name matches the bucket the
  Foundation actually creates: `gcs-${application_name}${tenant_resource_prefix}-data`
  (app-scoped). List it with:
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/       # bucket name is in the platform Outputs
  ```
- **GKE** — the GKE variant overrides `gcs_volumes = []` and mounts a **block
  PersistentVolumeClaim** at `/storage` instead (`stateful_pvc_enabled = true`,
  `stateful_pvc_mount_path = "/storage"`). A block PVC handles DokuWiki's flat-file
  locking far better than gcsfuse, so `module_storage_buckets` is empty on GKE.

---

## 5. First-run setup and health probes

- **First-run installer.** On the first visit, open `/install.php` to create the
  administrator account, set the wiki title, and choose the ACL policy. After the
  admin account exists, **delete or disable `install.php`** (DokuWiki refuses to run
  the installer again once a config exists, but removing it is best practice). All of
  this is written into `/storage`, so it persists for the life of the volume.
- **No auto-migrations.** There is no database and no migration job; upgrading the
  image simply ships new PHP/wiki engine code that reads the same `/storage` data.
- **Health probes.** The default startup, liveness, and readiness probes are all
  HTTP against the root path `/` — DokuWiki serves its start page there without
  authentication, so the probe passes as soon as Apache is up and `/storage` is
  seeded. Startup allows a modest window (10s initial delay); DokuWiki boots in
  seconds because there is no database to migrate.

---

For the DokuWiki-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[DokuWiki_GKE](DokuWiki_GKE.md)** and **[DokuWiki_CloudRun](DokuWiki_CloudRun.md)**.
