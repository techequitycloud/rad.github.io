---
title: "Open WebUI Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Open WebUI module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Open WebUI Common — Shared Application Configuration

`OpenWebUI_Common` is the **shared application layer** for Open WebUI. It is not
deployed on its own; instead it supplies the Open WebUI-specific configuration that
both [OpenWebUI_GKE](OpenWebUI_GKE.md) and [OpenWebUI_CloudRun](OpenWebUI_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End users
never configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Open WebUI, see the platform
guides ([OpenWebUI_GKE](OpenWebUI_GKE.md), [OpenWebUI_CloudRun](OpenWebUI_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by OpenWebUI_Common | Where it surfaces |
|---|---|---|
| Session key | Generates `WEBUI_SECRET_KEY` and stores it in **Secret Manager** | Injected as a secret env var in both platform variants |
| Container image | Pins `ghcr.io/open-webui/open-webui` and wraps it with a custom entrypoint | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database and user | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** data bucket (`openwebui-data`) | `storage_buckets` output |
| Core settings | Sets the baseline Open WebUI environment: AI backend URLs, user registration policy, authentication switch, telemetry opt-outs | Application behaviour in the platform guides |
| Health checks | Supplies the default startup and liveness probe behaviour targeting `/health` | §Observability in the platform guides |

---

## 2. Session key in Secret Manager

The `WEBUI_SECRET_KEY` is generated automatically and stored as a Secret Manager
secret — it is never set in plain text. Open WebUI uses it to sign all user sessions.

```bash
# List and read the secret (the name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<secret-key-secret> --project "$PROJECT"
```

**Important:** this key is immutable after the first user logs in. Changing it
immediately logs out every active user and invalidates all remember-me tokens. Do not
rotate it without coordinating a maintenance window.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Open WebUI requires **PostgreSQL 15**; the engine is fixed and no other database type
is supported. On the first deployment a one-shot `db-init` job runs
`postgres:15-alpine`, connects to Cloud SQL through the Auth Proxy, and idempotently:

1. creates the Open WebUI database (if absent),
2. creates the application user with the generated password,
3. grants the user full privileges on that database.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
  --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`OpenWebUI_Common` establishes the baseline Open WebUI environment so the application
comes up correctly on first boot:

- **AI backend URLs** — `OLLAMA_BASE_URL` and `OPENAI_API_BASE_URL` are set from the
  calling module's variables. Both default to empty (disabled). At least one must be
  set for the application to have a functioning AI backend.
- **User registration policy** — `DEFAULT_USER_ROLE`, `ENABLE_SIGNUP`, and `WEBUI_AUTH`
  control who can register and how new accounts are activated (configurable in Group 5
  of the platform modules).
- **Telemetry opt-outs** — `SCARF_NO_ANALYTICS=true`, `DO_NOT_TRACK=true`, and
  `ANONYMIZED_TELEMETRY=false` are hard-coded, mirroring the official image defaults.
- **Data directory** — `DATA_DIR=/app/backend/data` tells Open WebUI where to write
  its backend data files inside the container.
- **`WEBUI_URL`** — set to the predicted service URL so Open WebUI generates correct
  absolute links and OAuth redirect URIs.

---

## 5. `DATABASE_URL` assembly and the custom entrypoint

The official Open WebUI image expects a `DATABASE_URL` environment variable. Rather
than storing the database password in plain text, a custom `entrypoint.sh` wrapper
assembles `DATABASE_URL` at container start-time from the platform-injected `DB_HOST`,
`DB_USER`, `DB_PASSWORD`, and `DB_NAME` environment variables. The password is
URL-encoded in the process so special characters do not break URL parsing.

- When the Cloud SQL Auth Proxy is enabled, `DB_HOST` points to the Unix socket
  directory (`/cloudsql`). The entrypoint detects this and constructs the appropriate
  `host=` query-parameter form for psycopg2.
- When connecting over TCP (external PostgreSQL), `DB_HOST` is the IP or hostname and
  a standard `postgresql://user:password@host/dbname` URL is assembled.

Do not set `DATABASE_URL` directly — it will be overwritten unless you also clear the
`DB_*` variables.

---

## 6. Health probe behaviour

The default probes target Open WebUI's native `/health` endpoint using HTTP GET. The
endpoint returns HTTP 200 once the application process and its database connection are
ready.

- The startup probe allows a 30-second initial delay and up to 30 failures (300 seconds
  total) to accommodate first-boot database migrations — these can take 30–60 seconds
  on a fresh PostgreSQL instance.
- The liveness probe starts after a 60-second initial delay and allows 3 failures
  before the pod is restarted.
- Both GKE and Cloud Run use HTTP probes against `/health`. Unlike some PHP/Apache
  apps that issue HTTP→HTTPS redirects, Open WebUI serves `/health` over plain HTTP
  without redirect, so HTTP probes work correctly on both platforms.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (`openwebui-data`) is declared here and
provisioned by the foundation, which also grants the workload service account access.
Open WebUI's backend data directory (`DATA_DIR`) points into this bucket when a GCS
Fuse mount is configured. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Open WebUI-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[OpenWebUI_GKE](OpenWebUI_GKE.md)** and **[OpenWebUI_CloudRun](OpenWebUI_CloudRun.md)**.
