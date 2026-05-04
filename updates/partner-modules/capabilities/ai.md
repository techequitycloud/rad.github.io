# Artificial Intelligence (AI)

> **Scope.** Canonical home for the AI/LLM application modules in this repo, the vector-store backing services, and the runtime characteristics specific to AI workloads. The agent-driven developer experience for Claude Code itself is canonical in [outcomes/education_enablement.md](../outcomes/education_enablement.md).

## What this repo uniquely brings to AI

### 1. Pre-built AI/LLM application modules (canonical)

| Module | Purpose | Notable scripts |
|---|---|---|
| `modules/Ollama_*` | Self-hosted LLM inference | `Ollama_Common/scripts/model-pull.sh` pre-pulls models at startup |
| `modules/Flowise_*` | Visual LLM workflow / chain builder | `Flowise_Common/scripts/flowise-entrypoint.sh` |
| `modules/RAGFlow_Common`, `modules/RAGFlow_GKE` | Open-source RAG engine (GKE-only due to Elasticsearch dep) | `RAGFlow_Common/scripts/entrypoint.sh` |
| `modules/N8N_AI_*` | N8N workflow automation with AI/LLM nodes | `N8N_AI_Common/scripts/entrypoint.sh` |
| `modules/Activepieces_*` | No-code automation with AI step support | — |

Each follows the standard four-tier wiring (see [practices/platform_engineering.md](../practices/platform_engineering.md)) so an AI workload deploys with the same `tofu apply` as any other application.

### 2. Vector-store / search backing services

- **Elasticsearch** — `modules/Elasticsearch_GKE` (used by RAGFlow as document + vector store).
- **AlloyDB** — `modules/Services_GCP/alloydb.tf` (PostgreSQL-compatible with `pgvector`).
- **Cloud SQL PostgreSQL 15** — supports `pgvector` via the Foundation module's `postgres_extensions` initialization-job pattern.

Service-tier configuration is canonical in [capabilities/data_and_databases.md](data_and_databases.md).

### 3. AI workload runtime characteristics

- **Cloud Run for inference** — scale-to-zero suits spiky LLM traffic; per-second billing avoids paying for idle capacity. Runtime mechanics in [capabilities/serverless.md](serverless.md).
- **GKE Autopilot for sustained AI workloads** — RAGFlow and N8N_AI_GKE use Autopilot for workloads needing persistent state, vector indices, or long-running background jobs. VPA right-sizes pod requests automatically.
- **Shared persistent storage for model weights** — Filestore NFS or GCS Fuse via `app_storage_wrapper` (canonical in [capabilities/data_and_databases.md](data_and_databases.md)).
- **Long deployment timeouts** — `deployment_timeout` is tunable per app, important for multi-GB AI container images (`AGENTS.md` `/performance`).

### 4. AI-aware security and cost posture

AI workloads inherit the platform-wide controls without extra wiring:

- Secret Manager for model-provider API keys (canonical in [practices/devsecops.md](../practices/devsecops.md)).
- IAP for fronting LLM admin UIs.
- VPC-SC for keeping inference traffic and embeddings inside a security perimeter.
- Cost discipline via scale-to-zero and AR cleanup policies (canonical in [practices/finops.md](../practices/finops.md)) — important when AI image variants are multi-GB.

## Cross-references

- [capabilities/data_and_databases.md](data_and_databases.md) — AlloyDB / pgvector / Elasticsearch / Filestore details
- [capabilities/serverless.md](serverless.md) — Cloud Run / Autopilot runtime mechanics
- [practices/devsecops.md](../practices/devsecops.md) — secret management for AI API keys
- [practices/finops.md](../practices/finops.md) — cost discipline for AI workloads
- [outcomes/education_enablement.md](../outcomes/education_enablement.md) — AI-native developer experience (CLAUDE.md, AGENTS.md, .agent/skills)
- [outcomes/developer_productivity.md](../outcomes/developer_productivity.md) — full application catalogue
