---
title: "LiteLLM on Cloud Run — Overview"
sidebar_label: "LiteLLM CloudRun"
---

# LiteLLM on Cloud Run — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LiteLLM_CloudRun)**

## What is LiteLLM?

LiteLLM is an open-source LLM proxy and AI gateway with 20,000+ GitHub stars. It provides a **unified OpenAI-compatible API** that routes requests to 100+ LLM providers including OpenAI, Anthropic, Google Gemini, Azure OpenAI, AWS Bedrock, Hugging Face, Cohere, Mistral, Ollama, and many more.

Key features:
- Single OpenAI-compatible API endpoint for all providers
- Virtual API key management with per-key rate limiting and budgets
- Real-time cost tracking and spend alerts per model and team
- Response caching via Redis (reduce latency and API costs)
- Model fallback and load balancing across providers
- Admin UI for model management and usage analytics
- Prometheus-compatible metrics

## Module Summary

`LiteLLM_CloudRun` deploys LiteLLM on **Google Cloud Run v2** with:

| Component | Technology |
|---|---|
| Compute | Cloud Run v2 Gen2, Python/FastAPI |
| Database | Cloud SQL PostgreSQL 15 (for usage logging, virtual keys, cost tracking) |
| Container | Custom Cloud Build image with entrypoint script |
| Secrets | Secret Manager (`LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY`) |
| Response Caching | Redis (optional) |
| Security | Cloud Armor WAF, Binary Authorization (optional) |
| Scaling | Cloud Run auto-scaling (min 1, max 3 by default) |

## Key Configuration Points

### PostgreSQL Database (Auto-provisioned)

LiteLLM requires PostgreSQL for its Prisma ORM (usage logs, virtual keys, model routing). The module auto-provisions a Cloud SQL PostgreSQL 15 instance and creates the database and user via the `db-init` Cloud Run Job.

### Auto-Generated Secrets

Two secrets are created automatically:
- **`LITELLM_MASTER_KEY`** — prefixed `sk-` for OpenAI compatibility. Used for admin operations.
- **`LITELLM_SALT_KEY`** — used to hash virtual keys. **Do not rotate after virtual keys have been issued.**

### LLM Provider API Keys

Inject API keys via `secret_environment_variables`:

```hcl
secret_environment_variables = {
  OPENAI_API_KEY    = "openai-api-key"
  ANTHROPIC_API_KEY = "anthropic-api-key"
  GEMINI_API_KEY    = "gemini-api-key"
}
```

Or add them after deployment via the LiteLLM Admin UI or `/key/generate` API using the `LITELLM_MASTER_KEY`.

### Redis Caching (Recommended)

Enable Redis to cache responses to repeated identical LLM requests:

```hcl
enable_redis = true
redis_host   = "10.0.0.5"  # Cloud Memorystore IP
redis_port   = "6379"
```

### IAP Consideration

If using IAP (`enable_iap = true`), note that IAP blocks programmatic API calls from LLM client applications. Use IAP only for admin access or internal tooling. For public LLM API endpoints, use `ingress_settings = "all"` without IAP.

## Deployment Timeline

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Secret Manager provisioning | 1–2 min |
| Cloud Build image build | 5–10 min |
| Database initialization job | 1–2 min |
| Cloud Run service deployment | 2–3 min |
| **Total** | **17–29 min** |

## Quick Start

```hcl
module "litellm" {
  source = "./modules/LiteLLM_CloudRun"

  project_id           = "my-gcp-project"
  tenant_deployment_id = "prod"

  # Optional: LLM provider API keys
  secret_environment_variables = {
    OPENAI_API_KEY = "openai-api-key"
  }

  # Optional: Redis caching
  enable_redis = true
  redis_host   = "10.0.0.5"
}
```

## Lab Guide

For hands-on deployment steps, see the [LiteLLM Cloud Run Lab Guide](./LiteLLM_CloudRun_Lab.md).
