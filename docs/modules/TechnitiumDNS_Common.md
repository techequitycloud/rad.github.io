---
title: "TechnitiumDNS Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the TechnitiumDNS module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# TechnitiumDNS Common — Shared Application Configuration

`TechnitiumDNS_Common` is the **shared application layer** for Technitium DNS Server. It is not deployed
on its own; instead it supplies the TechnitiumDNS-specific configuration that both
[TechnitiumDNS_GKE](TechnitiumDNS_GKE.md) and [TechnitiumDNS_CloudRun](TechnitiumDNS_CloudRun.md) build
on, so the two platform variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains
the defaults you see in the platform docs.

> **Scoping reminder:** this layer (and both platform variants built on it) deploys only Technitium's
> web admin console + REST API (port 5380/HTTP). The DNS resolver protocol (port 53/udp+tcp) is never
> exposed — see the platform guides for the full disclosure.

For the infrastructure that actually provisions and runs TechnitiumDNS, see the platform guides
([TechnitiumDNS_GKE](TechnitiumDNS_GKE.md), [TechnitiumDNS_CloudRun](TechnitiumDNS_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by TechnitiumDNS_Common | Where it surfaces |
|---|---|---|
| Container image | The official `technitium/dns-server` image, deployed **unmodified** (`image_source = "prebuilt"`, no custom Dockerfile) | `container_image` output of the platform deployment |
| Database engine | **None** — `database_type = "NONE"`. Zones, settings, and logs are local flat files under `/etc/dns` | §Database in the platform guides |
| Database bootstrap | **None** — no `db-init` job is injected. `initialization_jobs` is passed through unchanged (empty by default) | `initialization_jobs` output |
| Cryptographic secrets | Generates `DNS_SERVER_ADMIN_PASSWORD` (24-char alnum) and stores it in **Secret Manager** | `secret_ids` output |
| Object storage | Declares the **config** Cloud Storage bucket, mounted at `/etc/dns` via GCS FUSE | `storage_buckets` output |
| Core settings | Sets the baseline TechnitiumDNS environment: web service port (5380) and a log path redirected inside the mounted volume | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` | §Observability in the platform guides |

The shape of the `config` output (the object both variants consume) is fixed here:
`container_port = 5380`, `database_type = "NONE"`, `image_source = "prebuilt"`,
`container_build_config.enabled = false`, `enable_image_mirroring = true`, and an empty
`initialization_jobs` set.

---

## 2. One secret, no database, one bucket

Unlike most application modules, `TechnitiumDNS_Common` provisions **no** Cloud SQL instance and
generates only a single bootstrap credential:

- **`DNS_SERVER_ADMIN_PASSWORD`** — a 24-character alphanumeric password generated with
  `random_password`, stored in Secret Manager, and injected as a secret env var on every container
  start. Technitium **only applies it on the very first boot** (when no `auth.config` yet exists in
  `/etc/dns`) — it bootstraps the initial `admin` web-console/API account. On every subsequent
  restart/redeploy, the existing `auth.config` on the persisted volume wins and the env var is ignored.
- `database_type = "NONE"` — no Cloud SQL for PostgreSQL/MySQL is created. The database-related
  variables that appear in the platform guides (`db_name`, `db_user`, `enable_cloudsql_volume`,
  `database_password_length`, …) are inert unless you deliberately opt in to an external database, which
  TechnitiumDNS does not require.
- `storage_buckets` declares exactly one bucket (`name_suffix = "config"`), mounted at `/etc/dns` so
  zones, settings, and logs survive container restarts and redeploys.

Retrieve the admin password after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 3. Container image — prebuilt, no custom Dockerfile

`TechnitiumDNS_Common` deploys the official `technitium/dns-server` image **unmodified**:

- `image_source = "prebuilt"`, `container_build_config.enabled = false` — no Cloud Build step runs; the
  image is pulled and (optionally) mirrored into Artifact Registry as-is.
- **Verified via local `docker run`:** the vendor image boots cleanly with no shell/entrypoint issues,
  honours `DNS_SERVER_ADMIN_PASSWORD` and `DNS_SERVER_DOMAIN` on first boot, and serves its console root
  (`/`) unauthenticated with HTTP 200 (~600KB of console HTML, not an empty body) — no wrapper entrypoint
  is needed, unlike most custom-built modules in this repository.
- `enable_image_mirroring = true` — mirrors `technitium/dns-server` into the project's Artifact Registry
  to avoid Docker Hub rate limits in production.

---

## 4. Core application settings and persistent storage

`TechnitiumDNS_Common` establishes the baseline TechnitiumDNS environment so the server comes up
correctly on first boot:

- **`DNS_SERVER_WEB_SERVICE_HTTP_PORT = "5380"`** — the web console bind port, matching
  `container_port = 5380`.
- **`DNS_SERVER_LOG_FOLDER_PATH = "/etc/dns/logs"`** — logs are redirected inside the mounted `/etc/dns`
  volume so logging keeps working under Cloud Run's read-only root filesystem (the vendor's own default
  log path, `/var/log/technitium/dns`, is NOT on a mounted volume and would fail to write).

**Persistent storage.** A GCS FUSE volume (bucket `name_suffix = "config"`) is mounted at `/etc/dns` by
default, covering zone files, the config JSON, the auth database, and (redirected) logs. On GKE, set
`stateful_pvc_enabled = true` to use a real StatefulSet block PVC at the same path instead —
`TechnitiumDNS_GKE` automatically disables the GCS volume in that case to avoid a double-mount, the same
pattern used by `Chroma_GKE`.

---

## 5. Health probe behaviour

The default startup and liveness probes target **`/`** — Technitium's web console root page, which
returns HTTP 200 with the full console HTML as soon as the server binds its port, with no authentication
required. Because Technitium has no database migrations to run, it becomes healthy within seconds of
boot; the startup window (20-second initial delay, 30 retries) is conservative headroom rather than a
requirement.

---

## 6. Scoping — web console only, no DNS resolver

This layer (and both platform variants) deploys **only** Technitium's web admin console + REST API.
Technitium's core DNS resolver function (answering queries on port 53/udp+tcp) is never exposed: Cloud
Run is HTTP(S)-only ingress with no raw TCP/UDP listener, and the GKE variant uses the standard HTTP(S)
Gateway pattern rather than a raw L4 port-53 LoadBalancer. This is an intentional, permanent scoping
decision — the same class of platform-boundary limitation already documented for this repository's
Headscale, Kopia, and RocketChat modules.

---

For the TechnitiumDNS-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guides:
**[TechnitiumDNS_GKE](TechnitiumDNS_GKE.md)** and **[TechnitiumDNS_CloudRun](TechnitiumDNS_CloudRun.md)**.
