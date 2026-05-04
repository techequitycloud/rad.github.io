# Artificial Intelligence (AI)

> **Scope.** Canonical home for the AI/LLM application modules in this repo, the vector-store backing services, and the runtime characteristics specific to AI workloads. The agent-driven developer experience for Claude Code itself is canonical in [outcomes/education_enablement.md](../outcomes/education_enablement.md).

## What this repo uniquely brings to AI

### 1. Pre-built AI/LLM application modules (canonical)

| Module | Purpose | Notable scripts |
|---|---|---|
| `modules/Ollama_*` | Self-hosted LLM inference | `Ollama_Common/scripts/model-pull.sh` pre-pulls models at startup |
| `modules/Flowise_*` | Visual LLM workflow / chain builder | `Flowise_Common/scripts/flowise-entrypoint.sh` |
| `modules/RAGFlow_Common`, `modules/RAGFlow_GKE`, `modules/RAGFlow_CloudRun` | Open-source RAG engine | `RAGFlow_Common/scripts/entrypoint.sh` |
| `modules/N8N_AI_*` | N8N workflow automation with AI/LLM nodes | `N8N_AI_Common/scripts/entrypoint.sh` |
| `modules/Activepieces_*` | No-code automation with AI step support | — |

Each follows the standard four-tier wiring (see [practices/platform_engineering.md](../practices/platform_engineering.md)) so an AI workload deploys with the same `tofu apply` as any other application.

**Module details:**

- **Ollama** — deploys the Ollama inference server. `model-pull.sh` runs as a Cloud Run Job or Kubernetes Job at startup to pre-pull model weights into shared storage (Filestore NFS or GCS Fuse), avoiding repeated large downloads on cold starts. GPU node pools can be requested via GKE Autopilot node affinity for accelerated inference. Designed for spiky, scale-to-zero use cases on Cloud Run or persistent GKE deployments.

- **Flowise** — visual drag-and-drop chain builder for LLM workflows. Backed by Cloud SQL PostgreSQL for flow persistence. The `flowise-entrypoint.sh` script configures environment variables for database and secret injection at container startup. Runs well on Cloud Run (scale-to-zero between user sessions).

- **RAGFlow** — open-source end-to-end RAG framework. The GKE variant uses Elasticsearch (`modules/Elasticsearch_GKE`) as both the document store and vector store. A `RAGFlow_CloudRun` variant also exists for deployments backed by an externally managed Elasticsearch cluster. Requires Filestore NFS for shared document storage across replicas.

- **N8N AI** — N8N with AI/LLM-specific node configuration pre-enabled (OpenAI, Anthropic, Ollama integrations). Backed by Cloud SQL PostgreSQL for workflow persistence. Designed for long-running automation pipelines; GKE Autopilot is preferred over Cloud Run for sustained background execution. Cloud Run variant (`N8N_AI_CloudRun`) suits lighter, event-driven workloads.

- **Activepieces** — no-code automation platform with AI step support. Lightest AI module in the catalogue; Cloud Run is the default target. Backed by Cloud SQL PostgreSQL.

### 2. Vector-store / search backing services

- **Elasticsearch** — `modules/Elasticsearch_GKE` (used by RAGFlow as document + vector store).
- **AlloyDB** — `modules/Services_GCP/alloydb.tf` (PostgreSQL-compatible with `pgvector`; columnar engine well-suited to similarity search at scale).
- **Cloud SQL PostgreSQL 15/16** — supports `pgvector` via the Foundation module's `postgres_extensions` initialization-job pattern.

Service-tier configuration is canonical in [capabilities/data_and_databases.md](data_and_databases.md).

### 3. AI workload runtime characteristics

- **Cloud Run for inference** — scale-to-zero suits spiky LLM traffic; per-second billing avoids paying for idle capacity. Runtime mechanics in [capabilities/serverless.md](serverless.md).
- **GKE Autopilot for sustained AI workloads** — RAGFlow and N8N_AI_GKE use Autopilot for workloads needing persistent state, vector indices, or long-running background jobs. VPA right-sizes pod requests automatically.
- **Shared persistent storage for model weights** — Filestore NFS or GCS Fuse via `app_storage_wrapper` (canonical in [capabilities/data_and_databases.md](data_and_databases.md)). Multi-GB model weights (e.g. 4–70 B parameter models) are stored once on shared NFS and mounted read-only by multiple replicas, avoiding re-download on each cold start.
- **Long deployment timeouts** — `deployment_timeout` is tunable per app, important for multi-GB AI container images (`AGENTS.md` `/performance`).
- **Artifact Registry lifecycle policies** — critical for AI variants where images can exceed several GB; policies prevent unbounded registry growth (canonical in [practices/finops.md](../practices/finops.md)).

### 4. AI-aware security and cost posture

AI workloads inherit the platform-wide controls without extra wiring:

- Secret Manager for model-provider API keys (canonical in [practices/devsecops.md](../practices/devsecops.md)).
- IAP for fronting LLM admin UIs.
- VPC-SC for keeping inference traffic and embeddings inside a security perimeter.
- Binary Authorization — `enable_binary_authorization = true` enforces signed images, ensuring only attested AI container images are deployed. Relevant for AI supply-chain security given large, opaque base images.
- Cost discipline via scale-to-zero and AR cleanup policies (canonical in [practices/finops.md](../practices/finops.md)) — important when AI image variants are multi-GB.

## Cross-references

- [capabilities/data_and_databases.md](data_and_databases.md) — AlloyDB / pgvector / Elasticsearch / Filestore details
- [capabilities/serverless.md](serverless.md) — Cloud Run / Autopilot runtime mechanics, custom builds
- [practices/devsecops.md](../practices/devsecops.md) — secret management for AI API keys, Binary Authorization
- [practices/finops.md](../practices/finops.md) — cost discipline for AI workloads
- [outcomes/education_enablement.md](../outcomes/education_enablement.md) — AI-native developer experience (CLAUDE.md, AGENTS.md, .agent/skills)
- [outcomes/developer_productivity.md](../outcomes/developer_productivity.md) — full application catalogue
