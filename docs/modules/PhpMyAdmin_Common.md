---
title: "PhpMyAdmin Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the PhpMyAdmin module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# PhpMyAdmin Common — Shared Application Configuration

`PhpMyAdmin_Common` is the **shared application layer** for phpMyAdmin. It is
not deployed on its own; instead it supplies the phpMyAdmin-specific configuration
that both [PhpMyAdmin_GKE](PhpMyAdmin_GKE.md) and
[PhpMyAdmin_CloudRun](PhpMyAdmin_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

phpMyAdmin is unusual among the applications in this repository: it is a **completely
stateless** PHP + Apache web client for administering MySQL/MariaDB databases. It has
**no database of its own, no secrets, no Redis, no object storage, and no persistent
volume**. The target MySQL server is selected entirely through environment variables
read by the stock image at container start. As a result, this Common layer is
deliberately thin — it exists mainly to pin the image tag and describe the container.

For the infrastructure that actually provisions and runs phpMyAdmin, see the
platform guides ([PhpMyAdmin_GKE](PhpMyAdmin_GKE.md),
[PhpMyAdmin_CloudRun](PhpMyAdmin_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by PhpMyAdmin_Common | Where it surfaces |
|---|---|---|
| Container image | A thin **custom build** `FROM phpmyadmin/phpmyadmin`, mirrored into Artifact Registry with the base tag pinned via an app-specific build ARG | `container_image` output of the platform deployment |
| Image version pinning | Maps `application_version = "latest"` to a known-good tag (`5.2.2`) so the build never references a non-existent tag | `container_build_config.build_args.PHPMYADMIN_VERSION` |
| Database engine | Fixes **`database_type = "NONE"`** — phpMyAdmin has no database of its own | §Database in the platform guides |
| Cryptographic secrets | **None** — `secret_ids` and `secret_values` are empty maps | n/a |
| Object storage | **None** — `storage_buckets` is an empty list | n/a |
| Database bootstrap | **None** — `initialization_jobs` is an empty list | n/a |
| Container port | Fixes port **80** (Apache `apache2-foreground`) | §Networking in the platform guides |
| Core settings | Exposes the MySQL-target env vars `PMA_HOST` / `PMA_PORT` / `PMA_ARBITRARY` | Application behaviour in the platform guides |
| Health checks | Supplies default startup/liveness/readiness probes targeting `/` | §Observability in the platform guides |

---

## 2. Container image and build

phpMyAdmin ships as a **thin custom build** rather than a raw prebuilt image. The
`Dockerfile` is a two-line wrapper:

```dockerfile
ARG PHPMYADMIN_VERSION=5.2.2
FROM phpmyadmin/phpmyadmin:${PHPMYADMIN_VERSION}
EXPOSE 80
```

This build exists **only** to mirror the upstream `phpmyadmin/phpmyadmin` image into
Artifact Registry and to pin the base tag — there is **no runtime config file and no
custom entrypoint**. The stock image is fully env-driven and inherits its own
`ENTRYPOINT` (`/docker-entrypoint.sh`) and `CMD` (`apache2-foreground`, listening on
port 80) unchanged.

The build ARG is deliberately named **`PHPMYADMIN_VERSION`**, not the generic
`APP_VERSION`. The foundation injects `APP_VERSION = application_version` into every
custom build's `build_args` and *wins the merge* — so a Dockerfile that derived its
base tag from `APP_VERSION` would be forced to `latest` (which
`phpmyadmin/phpmyadmin:latest` does publish, but the campaign convention is to pin).
`PhpMyAdmin_Common` sets `PHPMYADMIN_VERSION` from a `var.application_version == "latest" ? "5.2.2" : var.application_version`
map so a `latest` request resolves to the pinned known-good tag while an explicit
version (e.g. `5.2.2`) passes through verbatim.

Inspect the deployed image:

```bash
# CloudRun:
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
# List the mirrored image in Artifact Registry:
gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo>/phpmyadmin
```

---

## 3. No secrets, no database, no storage

Unlike most applications in this repository, phpMyAdmin declares **none** of the
usual stateful resources:

- **`secret_ids` / `secret_values` are empty.** phpMyAdmin holds no application
  secret of its own. Users authenticate against the **target MySQL/MariaDB server's
  own credentials** at the phpMyAdmin login page (cookie-based auth); those
  credentials are never stored by phpMyAdmin. Because there are no generated secrets,
  there is nothing to rotate and nothing that can corrupt on redeploy.
- **`database_type = "NONE"`.** No Cloud SQL instance is provisioned for phpMyAdmin
  itself. (phpMyAdmin *connects to* a MySQL server, but that server is external to
  this module — it is not created here.) The GKE variant enforces this with a
  plan-time validation guard.
- **`initialization_jobs = []`.** There is no schema to create, so no `db-init` job
  runs. First deploy has no migration step.
- **`storage_buckets = []` and no NFS.** phpMyAdmin is stateless — session state
  lives in a short-lived cookie, nothing is written to disk that must survive a
  restart.

There are therefore no `gcloud secrets` or `gcloud sql` resources owned by this
module to retrieve — a deliberately small footprint.

---

## 4. MySQL target selection (the only real configuration)

phpMyAdmin decides which database server to administer purely from three environment
variables, read by the stock image at container start (no rebuild, no config file):

- **`PMA_ARBITRARY`** — when `"1"` (the default), the login page shows a
  **server-input box** so users can type *any* reachable MySQL/MariaDB host. When
  `"0"`, connections are restricted to the fixed `PMA_HOST`.
- **`PMA_HOST`** — hostname or IP of a fixed target server. Left blank by default
  (arbitrary mode). Set it to the platform Cloud SQL private IP or any reachable
  MySQL host to pin a single server.
- **`PMA_PORT`** — TCP port of the target server; defaults to the standard MySQL
  port `3306`.

These surface as the `pma_arbitrary` / `pma_host` / `pma_port` variables on both
platform variants and are the primary thing an operator configures. See the platform
guides for how they map to the deployment UI.

---

## 5. Health probe behaviour

The default startup, liveness, and readiness probes all target **`/`** over HTTP —
Apache serves the phpMyAdmin login page there and returns `200` as soon as the PHP
runtime is up, so no application-specific health endpoint is needed. Because there is
no database migration on boot, phpMyAdmin becomes ready quickly (a few seconds); the
generous startup window is a safety margin only.

---

For the phpMyAdmin-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[PhpMyAdmin_GKE](PhpMyAdmin_GKE.md)** and
**[PhpMyAdmin_CloudRun](PhpMyAdmin_CloudRun.md)**.
