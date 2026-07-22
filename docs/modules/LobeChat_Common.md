---
title: "LobeChat Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the LobeChat module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# LobeChat Common — Shared Application Configuration

`LobeChat_Common` is the **shared application layer** for LobeChat. It is not
deployed on its own; instead it supplies the LobeChat-specific configuration that
[LobeChat_GKE](LobeChat_GKE.md) builds on. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs LobeChat, see the platform
guide ([LobeChat_GKE](LobeChat_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

> **Note:** LobeChat is only supported on GKE. The Cloud Run variant was removed —
> LobeChat's Next.js app hits a Cloud Run/GFE routing gap on certain parallel-route
> chunk paths that cannot be fixed at the module layer.

---

## 1. What this layer provides

| Area | Provided by LobeChat_Common | Where it surfaces |
|---|---|---|
| Container image | Thin **custom** build `FROM lobehub/lobe-chat`; version-pinned and mirrored into Artifact Registry via Cloud Build | `container_image` output of the platform deployment |
| Port | Fixes `container_port = 3210` — the LobeChat Next.js server (also pins `PORT=3210` in the image) | §Networking in the platform guides |
| Database engine | `database_type = "NONE"` — LobeChat's default **client-stored** mode keeps all state in the browser; no Cloud SQL is provisioned | §Overview in the platform guides |
| Secrets | **None.** `secret_ids` and `secret_values` are empty maps | — |
| Object storage | **None.** `storage_buckets` is empty — the app is stateless | — |
| Database bootstrap | **None.** `initialization_jobs` is empty — there is no schema to create | `initialization_jobs` output (empty) |
| Core settings | No module-injected env vars; all runtime overrides flow through `environment_variables` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup / liveness / readiness probes targeting `/` (HTTP 200, no auth) | §Observability in the platform guides |

---

## 2. Stateless by design — no secrets, no database, no storage

In its default **client-stored** mode LobeChat requires no server-side backing
services. Users add their own model-provider API keys (OpenAI, Anthropic, Google,
…) client-side, held in the browser's `localStorage`; conversations and settings
also live in the browser. As a result:

- **No secrets** are generated. `secret_ids` / `secret_values` are empty, and there
  are no cryptographic keys to protect or rotate.
- **No database** is provisioned. `database_type = "NONE"`, so no Cloud SQL instance,
  no `db-init` job, and no migrations run at deploy time.
- **No persistent storage** is declared. `storage_buckets` is empty — there is no GCS
  bucket, NFS mount, or block PVC by default.

LobeChat also offers an optional **server database mode** backed by Postgres for
cross-device sync and centralized history; that mode is **not** wired by this module.
Enabling it would require provisioning Cloud SQL and injecting the full
`DATABASE_URL` / `KEY_VAULTS_SECRET` / auth env set — out of scope for the stateless
default.

Because there are no server-side secrets, the only account gate available is the
optional `ACCESS_CODE` environment variable (see below).

---

## 3. Container image and build

The stock `lobehub/lobe-chat` image already ships a server entrypoint that starts
the Next.js server on `$PORT` (default 3210) and serves the UI at `/`. Because the
app needs no runtime config injection in client-stored mode, the Dockerfile is a
**thin wrapper** that only pins the version and sets `PORT=3210` — it does **not**
override the base entrypoint:

```dockerfile
ARG LOBECHAT_VERSION=latest
FROM lobehub/lobe-chat:${LOBECHAT_VERSION}
ENV PORT=3210
EXPOSE 3210
```

`LOBECHAT_VERSION` is an **app-specific** build ARG (not the generic `APP_VERSION`,
which the Foundation injects into `build_args` and would overwrite with `latest`).
`LobeChat_Common` sets it from `application_version`, mapping `"latest"` straight
through to the real rolling `lobehub/lobe-chat:latest` tag — a shell-capable image,
so `latest` deploys cleanly.

The image is built via Cloud Build (`image_source = "custom"`,
`container_build_config.enabled = true`) and, when `enable_image_mirroring = true`
(the default), mirrored into the project's Artifact Registry so runtime pulls stay
inside the project. Inspect the built image after deployment:

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
```

The `container_image` and `container_registry` values are in the platform
deployment [Outputs](LobeChat_GKE.md#5-outputs).

---

## 4. Health probes

All three probes target the root path `/`, which the LobeChat Next.js server serves
as an unauthenticated HTTP 200 once it has booted:

- **Startup probe** — HTTP `GET /`, 10 s initial delay, 10 s period, 6 failures
  tolerated. The generous window accommodates the Next.js `next-server` cold start.
- **Liveness probe** — HTTP `GET /`, 15 s initial delay, 30 s period, 3 failures.
- **Readiness probe** — HTTP `GET /`, 10 s initial delay, 10 s period, 3 failures.

The variant module ([LobeChat_GKE](LobeChat_GKE.md)) can override the startup and
liveness probe objects, but the `/` default works out of the box because it needs
no auth and no database connectivity.

---

## 5. Optional runtime overrides

`LobeChat_Common` injects no environment variables of its own — everything the
operator wants comes through the variant's `environment_variables` map. The two most
useful:

- **`ACCESS_CODE`** — a shared passphrase that gates the whole UI. Set this on any
  publicly reachable deployment to prevent anonymous use of the chat interface (and
  of any provider keys a user pastes in).
- **Model-provider defaults** — e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or
  `OPENAI_PROXY_URL` to preconfigure a server-side provider instead of relying on
  each user's browser-stored key. Treat any provider key you inject as sensitive and
  supply it via `secret_environment_variables` rather than plain
  `environment_variables`.

Redis is optional and off by default; when enabled it is used only for rate limiting
and bot detection on public deployments (see the platform guides' §Redis).

---

For the LobeChat-specific, user-facing configuration (variables by group, outputs,
and how to explore the service from the Console and CLI), see the platform guide:
**[LobeChat_GKE](LobeChat_GKE.md)**.
