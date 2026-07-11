---
title: "LiteLLM Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the LiteLLM module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# LiteLLM Common — Shared Application Configuration

`LiteLLM_Common` is the **shared application layer** for LiteLLM. It is not
deployed on its own; instead it supplies the LiteLLM-specific configuration that
both [LiteLLM_GKE](LiteLLM_GKE.md) and [LiteLLM_CloudRun](LiteLLM_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of
its own — but understanding what it provides explains the defaults you see in
the platform docs.

For the infrastructure that actually provisions and runs LiteLLM, see the
platform guides ([LiteLLM_GKE](LiteLLM_GKE.md),
[LiteLLM_CloudRun](LiteLLM_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by LiteLLM_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates `LITELLM_MASTER_KEY` (`sk-` prefixed) and `LITELLM_SALT_KEY`, stores both in **Secret Manager** | Retrieved via Secret Manager (see below) |
| Container image | Pins the official LiteLLM image (`ghcr.io/berriai/litellm`) and builds a custom Cloud Build image with an `entrypoint.sh` | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`postgres:15-alpine`) that creates the database, user, and grants | `initialization_jobs` output |
| Core settings | Sets the baseline LiteLLM environment (`HOST`, `STORE_MODEL_IN_DB`, `PROXY_BASE_URL`, Redis settings) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup probe (`/health/readiness`) and liveness probe (`/health/liveliness`) | §Observability in the platform guides |

---

## 2. Master key and salt key in Secret Manager

Two secrets are generated automatically on first deployment and stored in Secret
Manager — they are never set in plain text.

| Secret | Environment variable | Purpose |
|---|---|---|
| `<resource-prefix>-<app-name>-master-key` | `LITELLM_MASTER_KEY` | Primary admin API key, prefixed `sk-` for OpenAI compatibility. Required for `/key/generate` and all admin operations. |
| `<resource-prefix>-<app-name>-salt-key` | `LITELLM_SALT_KEY` | Salt for hashing virtual keys. **Never rotate after virtual keys have been issued** — all existing keys become permanently invalid. |

Retrieve the master key after deployment:

```bash
# List secrets to find the right name, then access it:
gcloud secrets list --project "$PROJECT" --filter="name~master-key"
gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

LiteLLM requires **PostgreSQL 15**; the engine is fixed and MySQL is not
supported. On the first deployment a one-shot job runs `postgres:15-alpine` and
connects to Cloud SQL through the Auth Proxy to idempotently:

1. create the LiteLLM database (if absent),
2. create the application user with the generated password,
3. grant the user full privileges on that database.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`LiteLLM_Common` establishes the baseline LiteLLM environment so the application
comes up correctly on first boot:

- **`STORE_MODEL_IN_DB = "true"`** — model routing configuration is stored in
  PostgreSQL, enabling the Admin UI to manage models and virtual keys at runtime
  without container restarts. Setting this to `"False"` disables database-backed
  key management.
- **`PROXY_BASE_URL`** — set to the predicted service URL so LiteLLM generates
  correct redirect URLs and the OpenAI-compatible base URL advertised to clients.
- **`HOST = "0.0.0.0"`** — binds the proxy to all interfaces inside the container.
- **`LITELLM_LOG = "INFO"`** — default log level; override via
  `environment_variables` for more or less verbosity.
- **Redis settings** — `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` are
  injected when `enable_redis = true` and a host is supplied. Redis enables
  response caching and shared rate-limit counters across replicas.

---

## 5. Container image and build

LiteLLM uses `image_source = "custom"` with a Cloud Build Dockerfile. The custom
image extends the official `ghcr.io/berriai/litellm` image and embeds an
`entrypoint.sh` script that assembles `DATABASE_URL` at container startup from
the `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD`, and `DB_PORT` environment
variables injected by the foundation. This is necessary because the Cloud SQL Auth
Proxy socket path is only known at runtime.

---

## 6. Health probe behaviour

The default probes target LiteLLM's dedicated health endpoints:

- **Startup probe** — HTTP GET `/health/readiness`, which validates database
  connectivity and confirms Prisma ORM migrations have completed before traffic
  is routed to the instance. A generous failure threshold accommodates the
  first-boot Prisma migration time.
- **Liveness probe** — HTTP GET `/health/liveliness`, which confirms the proxy
  process is running without re-checking the database.

Both GKE and Cloud Run keep HTTP probes for these endpoints — no TCP probe
adjustment is needed because LiteLLM does not issue HTTP→HTTPS redirects that
would break health checks.

---

For the LiteLLM-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[LiteLLM_GKE](LiteLLM_GKE.md)** and
**[LiteLLM_CloudRun](LiteLLM_CloudRun.md)**.
