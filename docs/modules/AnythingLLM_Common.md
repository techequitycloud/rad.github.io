---
title: "AnythingLLM Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the AnythingLLM module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# AnythingLLM Common — Shared Application Configuration

`AnythingLLM_Common` is the **shared application layer** for AnythingLLM. It is not
deployed on its own; instead it supplies the AnythingLLM-specific configuration that both
[AnythingLLM_GKE](AnythingLLM_GKE.md) and [AnythingLLM_CloudRun](AnythingLLM_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs AnythingLLM, see the platform
guides ([AnythingLLM_GKE](AnythingLLM_GKE.md),
[AnythingLLM_CloudRun](AnythingLLM_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by AnythingLLM_Common | Where it surfaces |
|---|---|---|
| Application secrets | Generates and stores four secrets — `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT` — in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Pins the AnythingLLM Node.js image and the Cloud Build pipeline that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job that creates the database and user before the application starts | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `anythingllm-docs` document bucket; injects its name as `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` | `storage_buckets` output |
| Core settings | Sets the baseline AnythingLLM runtime environment (`SERVER_PORT`, `STORAGE_DIR`, `UID`, `GID`) | Application behaviour in the platform guides |
| Health checks | Supplies the HTTP `/api/ping` startup and liveness probe defaults, with an extended initial delay for AI model loading | §Observability in the platform guides |

---

## 2. Application secrets in Secret Manager

Four AnythingLLM application secrets are generated automatically on first deploy and
stored in Secret Manager — plaintext never appears in configuration or Terraform state.

| Secret | Environment variable | Purpose |
|---|---|---|
| `<prefix>-jwt-secret` | `JWT_SECRET` | Signs all AnythingLLM authentication tokens. Treat as immutable after first user login — rotating it immediately logs out all users. |
| `<prefix>-auth-token` | `AUTH_TOKEN` | Optional API bearer token for programmatic REST access. Leave empty to rely on application-level authentication only. |
| `<prefix>-sig-key` | `SIG_KEY` | HMAC signing key for request signatures (32 alphanumeric characters). |
| `<prefix>-sig-salt` | `SIG_SALT` | Salt used alongside `SIG_KEY` for HMAC signatures (32 alphanumeric characters). |

Retrieve any secret after deployment:

```bash
# List all secrets associated with the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~anythingllm"
# Read a specific secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its secret
name is reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

AnythingLLM requires **PostgreSQL 15** via its Prisma ORM; the engine is fixed and MySQL
is not supported. On the first deployment a one-shot `db-init` job connects to Cloud SQL
through the Auth Proxy and idempotently:

1. creates the AnythingLLM database user with the generated password,
2. creates the application database (if absent),
3. grants the user full privileges on that database.

The entrypoint script then constructs the `DATABASE_URL` Prisma connection string from
the `DB_*` environment variables at container start time, working correctly on both Unix
socket (Cloud Run) and TCP (GKE) connections.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`AnythingLLM_Common` establishes the baseline AnythingLLM runtime so the application
comes up correctly on first boot:

- **`SERVER_PORT = 3001`** — AnythingLLM's native HTTP port. Must match `container_port`.
- **`STORAGE_DIR = /app/server/storage`** — `AnythingLLM_Common`'s own default for the
  directory where AnythingLLM stores all workspace documents, vector indices, and
  conversation attachments. **Both calling platform modules override this value**, not via
  `environment_variables` but via their own `module_env_vars`, to the NFS mount path
  (`nfs_mount_path`, default `/mnt/nfs`) whenever `enable_nfs = true` — which is the
  default on both `AnythingLLM_CloudRun` and `AnythingLLM_GKE`. So a deployment's actual
  `STORAGE_DIR` is the NFS path unless `enable_nfs` is explicitly set to `false`; this
  keeps AnythingLLM's LanceDB vector index off ephemeral disk, where it would otherwise be
  silently wiped on every cold start / pod restart / redeploy.
- **`UID = 1000` / `GID = 1000`** — container user and group IDs. The `fsGroup = 1000`
  default in the GKE StatefulSet configuration matches these IDs so the volume is
  writable on attach.
- **`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`** — set automatically from the provisioned
  `anythingllm-docs` bucket so AnythingLLM can use GCS as a document storage backend.

Do not override `SERVER_PORT`, `UID`, or `GID` via `environment_variables` in the platform
module — they are set here and merged before forwarding to the foundation. `STORAGE_DIR` is
the one exception: it IS overridden, by the platform modules' own `module_env_vars`, not by
`environment_variables`, whenever `enable_nfs = true` (see above).

### Collector process (file uploads)

`anythingllm-entrypoint.sh` starts AnythingLLM's separate **collector** process — which
handles file uploads (PDF/HTML/docx via `POST /api/v1/document/upload`) — with
`( cd /app/collector && exec node index.js )`. The collector resolves its `hotdir` (where
the server drops an uploaded file for parsing) relative to its own working directory, so it
must start from `/app/collector`, matching upstream's `docker-entrypoint.sh`. Starting it
from `/app/server` (the CWD left by the preceding Prisma migration steps) makes every file
upload fail `ENOENT: .../collector/hotdir/<file>` even though the service reports healthy —
raw-text uploads (`/document/raw-text`) go through the server directly and are unaffected.

---

## 5. Health probe behaviour

Both the startup and liveness probes target `/api/ping` using HTTP. Unlike PHP/Apache
applications that redirect HTTP health traffic, AnythingLLM's Node.js server responds
directly to HTTP probes at this path, so no TCP fallback is needed on either platform.

- **GKE and Cloud Run** both use HTTP probes targeting `/api/ping`.
- The **startup probe** uses a 60-second initial delay and up to 30 failure periods
  (×10 seconds each = 5 minutes total) to accommodate AnythingLLM's AI model loading
  and Prisma migration on first boot.
- The **liveness probe** uses a 30-second initial delay and 3 failure threshold, providing
  a prompt restart if the application becomes unresponsive after startup.

---

## 6. Object storage

A dedicated **Cloud Storage** document bucket (with suffix `anythingllm-docs`) is declared
here and provisioned by the foundation, which also grants the workload service account
access. The bucket name is injected automatically as `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`.
Combined with StatefulSet PVCs or a Filestore NFS volume, this gives AnythingLLM durable
document storage that survives instance restarts. List buckets with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the AnythingLLM-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[AnythingLLM_GKE](AnythingLLM_GKE.md)** and
**[AnythingLLM_CloudRun](AnythingLLM_CloudRun.md)**.
