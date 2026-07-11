---
title: "N8N AI Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the N8N AI module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# N8N AI Common — Shared Application Configuration

`N8N_AI_Common` is the **shared application layer** for n8n AI. It is not deployed on
its own; instead it supplies the n8n-specific configuration that both
[N8N_AI_GKE](N8N_AI_GKE.md) and [N8N_AI_CloudRun](N8N_AI_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs n8n AI, see the platform
guides ([N8N_AI_GKE](N8N_AI_GKE.md), [N8N_AI_CloudRun](N8N_AI_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. What this layer provides

| Area | Provided by N8N_AI_Common | Where it surfaces |
|---|---|---|
| Secrets | Auto-generates `N8N_ENCRYPTION_KEY` (32-char) and `N8N_SMTP_PASS` (16-char) in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Pins `n8nio/n8n` and the Cloud Build config that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Container port | Hard-codes port **5678** | Forwarded as `container_port` in the `config` output |
| Database bootstrap | Defines the `db-init` job that creates the database, user, and grants | `initialization_jobs` in the `config` output |
| Object storage | Declares the **Cloud Storage** AI data bucket (name suffix `data`) | `storage_buckets` output |
| Core settings | Sets baseline n8n environment (port, protocol, Redis, DB type, webhook URLs, diagnostics) | Application behaviour in the platform guides |
| AI companion services | Configures Qdrant and Ollama as additional services within the `config` output | Forwarded to the Foundation Module as `additional_services` |
| GCS Fuse volume | Declares the `n8n-data` GCS volume mounted at `/mnt/gcs`, shared by n8n, Qdrant, and Ollama | Visible in the Foundation Module's volume configuration |

---

## 2. Secrets in Secret Manager

Two secrets are generated automatically on first deploy:

| Secret ID suffix | Length | Special chars | Injected as env var | Purpose |
|---|---|---|---|---|
| `<prefix>-n8nai-encryption-key` | 32 characters | Yes | `N8N_ENCRYPTION_KEY` | Encrypts all n8n credentials at rest |
| `<prefix>-n8nai-smtp-password` | 16 characters | No | `N8N_SMTP_PASS` | Placeholder SMTP password |

**The encryption key is critical.** All n8n credentials — API keys, OAuth tokens,
workflow passwords — are encrypted with `N8N_ENCRYPTION_KEY`. If the module is
destroyed and redeployed with a different key, existing credentials become permanently
unreadable. Back up this secret before any destroy operation.

Retrieve the secrets after deployment:

```bash
# List all secrets to find the correct names
gcloud secrets list --project "$PROJECT" --filter="name~encryption-key"

# Read the encryption key (store securely — treat like a password)
gcloud secrets versions access latest \
  --secret=<prefix>-n8nai-encryption-key \
  --project "$PROJECT"

# Read the SMTP password (replace with real SMTP credentials before enabling email)
gcloud secrets versions access latest \
  --secret=<prefix>-n8nai-smtp-password \
  --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).

---

## 3. Database engine and bootstrap

n8n requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported. On
the first deployment a one-shot `db-init` Job connects to Cloud SQL through the Auth
Proxy and idempotently:

1. creates the n8n database (default: `n8n_db`),
2. creates the application user (default: `n8n_user`) with the generated password,
3. grants the user full privileges on that database.

The job uses the `postgres:15-alpine` image, runs `scripts/db-init.sh`, and
completes with a clean proxy shutdown. It is safe to re-run.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`N8N_AI_Common` establishes the baseline n8n environment so the application comes up
correctly on first boot:

- **Port and protocol.** `N8N_PORT = 5678` and `N8N_PROTOCOL = https` are fixed so
  n8n listens on the correct port and generates correct absolute URLs.
- **Webhook and editor URLs.** `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to the
  predicted service URL before the service is created, so webhooks function without a
  second apply after the URL is known.
- **Redis queue mode.** `QUEUE_BULL_REDIS_HOST` and `QUEUE_BULL_REDIS_PORT` are set
  when Redis is enabled. If `redis_host` is empty, the NFS server IP is substituted
  automatically at runtime using the `$(NFS_SERVER_IP)` mechanism.
- **Database type.** `DB_TYPE = postgresdb` is always injected; the Foundation Module
  supplies the remaining `DB_POSTGRESDB_*` connection variables from Cloud SQL outputs.
- **Binary data mode.** `N8N_DEFAULT_BINARY_DATA_MODE = filesystem` stores binary
  workflow data on the persistent GCS Fuse volume rather than in the database.
- **Diagnostics.** `N8N_DIAGNOSTICS_ENABLED = true` and `N8N_METRICS = true` expose
  health and Prometheus metrics without additional configuration.

---

## 5. AI companion services

When `enable_ai_components` is true, `N8N_AI_Common` injects two additional services
into the `config.additional_services` list consumed by the Foundation Module. Both
share the `n8n-data` GCS volume mounted at `/mnt/gcs`.

### Qdrant

| Field | Value |
|---|---|
| Image | `qdrant/qdrant:<qdrant_version>` |
| Port | 6333 |
| CPU | 1000m (1 vCPU) |
| Memory | 1Gi |
| Replicas | 1 (fixed) |
| Ingress | Internal-only |
| Storage path | `/mnt/gcs/qdrant` (via `QDRANT__STORAGE__STORAGE_PATH`) |
| Health check | HTTP `GET /readyz` — 15s initial delay |
| Injected into n8n as | `QDRANT_URL` (auto-populated by Foundation Module) |

### Ollama

| Field | Value |
|---|---|
| Image | `ollama/ollama:<ollama_version>` |
| Port | 11434 |
| CPU | Inherited from `cpu_limit` (default: `2000m`) |
| Memory | Inherited from `memory_limit` (default: `4Gi`) |
| Replicas | 1 (fixed) |
| Ingress | Internal-only |
| Models path | `/mnt/gcs/ollama/models` (via `OLLAMA_MODELS`) |
| Health check | HTTP `GET /` — 20s initial delay |
| Injected into n8n as | `OLLAMA_HOST` (auto-populated by Foundation Module) |

Both services are removed when `enable_ai_components = false` or their respective
toggle (`enable_qdrant`, `enable_ollama`) is set to `false`.

---

## 6. Object storage

A dedicated **Cloud Storage** bucket with name suffix `data` is declared here and
provisioned by the foundation, which also grants the workload service account access.
The bucket is the backing store for GCS Fuse volumes shared by all three services.
List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~n8n"
```

---

For the n8n AI-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[N8N_AI_GKE](N8N_AI_GKE.md)** and **[N8N_AI_CloudRun](N8N_AI_CloudRun.md)**.
