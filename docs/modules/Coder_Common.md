---
title: "Coder Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Coder module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Coder Common — Shared Application Configuration

`Coder_Common` is the **shared application layer** for Coder. It is not deployed on its own; instead it supplies the Coder-specific configuration that both [Coder_GKE](Coder_GKE.md) and [Coder_CloudRun](Coder_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Coder, see the platform guides ([Coder_GKE](Coder_GKE.md), [Coder_CloudRun](Coder_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Coder_Common | Where it surfaces |
|---|---|---|
| Container image | Builds a thin custom wrapper FROM `ghcr.io/coder/coder:<version>` via Cloud Build (base image mirrored into Artifact Registry) | `container_image` output of the platform deployment |
| Custom entrypoint | Installs `cloud-entrypoint.sh`, which assembles `CODER_PG_CONNECTION_URL` from the foundation `DB_*` env vars and sets `CODER_ACCESS_URL` before exec'ing `coder server` | Application behaviour in the platform guides |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (Coder requires PostgreSQL 13+) | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job that creates the empty database and owning role — Coder runs its own schema migrations on boot | `initialization_jobs` output |
| Secrets | **None** — Coder self-generates its signing keys and persists them in PostgreSQL; the `secret_ids` output is empty | Secret Manager holds only the foundation-managed DB password |
| Object storage | Declares one **Cloud Storage** bucket (`storage` suffix) | `storage_buckets` output |
| Core env defaults | `CODER_HTTP_ADDRESS=0.0.0.0:3000`, `CODER_TELEMETRY_ENABLE=false`, `CODER_VERBOSE=false` | Environment of the running container |
| Health checks | Startup (`/healthz`, 60s delay, 30 failures) and liveness (`/healthz`, 60s delay) probe defaults | §Observability in the platform guides |
| Readiness probe | HTTP `/healthz`, 30s initial delay, period 10s, 3 failures | Applied to the running container |

---

## 2. Container image and custom entrypoint

`Coder_Common` builds a thin wrapper over the upstream Coder control-plane image. The Dockerfile uses an **app-specific build ARG** (`CODER_VERSION`) rather than the generic `APP_VERSION` — the foundation injects `APP_VERSION` into every build and would otherwise overwrite the tag with `latest`, which Coder's semver-prefixed GHCR tags don't provide. When `application_version == "latest"`, the module pins `v2.24.1`.

The `cloud-entrypoint.sh` script (POSIX sh, installed at `/usr/local/bin/cloud-entrypoint.sh`, run as the non-root `coder` user) performs these actions on every container start:

1. **Connection URL assembly.** Coder consumes one variable, `CODER_PG_CONNECTION_URL`, parsed as a `postgres://` URL — the Cloud SQL Unix-socket path cannot live in the URL authority (its colons break parsing). On **Cloud Run**, where `DB_HOST` is the socket directory, the script prefers `DB_IP` (the instance private IP) over TCP with `sslmode=require` (Cloud SQL rejects unencrypted private-IP TCP). On **GKE**, `DB_HOST` is the `127.0.0.1` cloud-sql-proxy sidecar, so `sslmode=disable` (TLS already terminated by the proxy).
2. **Password encoding.** The database password is RFC-3986 percent-encoded before being placed in the URL userinfo, so generated passwords containing `%`, `@`, or `:` never break URL parsing.
3. **Access URL.** Exports `CODER_ACCESS_URL` from the injected `CLOUDRUN_SERVICE_URL` (or `GKE_SERVICE_URL`). Coder builds workspace/agent connection URLs and OAuth redirect URIs from this value.
4. **Launch.** Execs `coder server` (`CMD ["/opt/coder", "server"]`). Coder runs its own schema migrations on boot — there is no separate migrate step.

Explicitly provided `CODER_PG_CONNECTION_URL` or `CODER_ACCESS_URL` env vars always take precedence. To inspect what the entrypoint resolved:

```bash
# Cloud Run — the entrypoint logs its resolved config at startup
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep "cloud-entrypoint"

# GKE — check the Coder pod startup output
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep -E "cloud-entrypoint|Started HTTP listener"
```

---

## 3. Database engine and bootstrap

Coder requires **PostgreSQL 13+**; the engine is fixed at `POSTGRES_15` inside `Coder_Common` and MySQL is rejected by the platform variant's plan-time validation. On deployment a one-shot `db-init` job (`postgres:15-alpine`, `execute_on_apply = true`, 600s timeout) connects as the `postgres` superuser and idempotently:

1. Creates the application role with `LOGIN CREATEDB` (or resets its password if it exists).
2. Creates the database (owned by `postgres` — Cloud SQL's superuser cannot `SET ROLE` to application roles).
3. Grants all privileges on the database and on schema `public` to the app role, then reassigns `public` schema ownership to it — Coder's migrations create all objects there.
4. Sends a `POST /quitquitquit` shutdown signal to the Cloud SQL Proxy sidecar so the Job pod exits cleanly.

Coder itself applies schema migrations on every server boot, so the job never touches the schema. Inspect the database directly:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Secrets — deliberately none

Unlike most application Common modules, `Coder_Common` creates **no Secret Manager secret** and its `secret_ids` output is an empty map. Coder auto-generates its signing keys on first boot and persists them in the PostgreSQL database, so container recreation, scaling, and platform migration never desync a credential. The only secret in a Coder deployment is the foundation-managed database password:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~coder"
gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
```

Operators wanting SSO can inject OIDC client secrets through the platform variant's `secret_environment_variables` passthrough.

---

## 5. Core application settings

`Coder_Common` establishes the baseline environment so the control plane comes up correctly on first boot:

- **Bind address** — `CODER_HTTP_ADDRESS = "0.0.0.0:3000"` binds all interfaces on the foundation container port (3000).
- **Telemetry off** — `CODER_TELEMETRY_ENABLE = "false"`; the service is reachable via its own Cloud Run / GKE ingress, so Coder's automatic dev tunnel is unnecessary.
- **Structured logs** — `CODER_VERBOSE = "false"` keeps STDOUT log volume sane for Cloud Logging / GKE capture.
- **Migrations on start** — Coder applies its database migrations automatically on each startup, so version upgrades need no manual step.
- **Stateless control plane** — no NFS and no Redis are wired in: sessions, the workspace build queue, templates, and signing keys all live in PostgreSQL.

---

## 6. Health probe behaviour

The default probes target `/healthz`, which Coder serves unauthenticated with HTTP 200 once the server is listening.

- **Startup probe** — HTTP `/healthz`, initial delay 60 s, period 15 s, failure threshold 30. This gives Coder up to 60 + (30 × 15) = 510 seconds from container start — generous headroom for first-boot schema migration against a freshly provisioned Cloud SQL instance.
- **Liveness probe** — HTTP `/healthz`, initial delay 60 s, period 30 s, failure threshold 3.
- **Readiness probe** — HTTP `/healthz`, initial delay 30 s, period 10 s, failure threshold 3.

Because `/healthz` requires no authentication, the probes pass without credentials — do not repoint them at API paths under `/api/v2/*` that require a session token.

---

## 7. Object storage

A single **Cloud Storage** bucket (name suffix `storage`, `STANDARD` class, public access prevention enforced) is declared here and provisioned by the foundation in the deployment region. The stateless control plane does not depend on it — it is available for template assets or operator use. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~coder"
```

---

For the Coder-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides:
**[Coder_GKE](Coder_GKE.md)** and **[Coder_CloudRun](Coder_CloudRun.md)**.
