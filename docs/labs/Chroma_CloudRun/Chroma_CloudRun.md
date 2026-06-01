---
title: "Chroma on Cloud Run — Overview"
sidebar_label: "Chroma CloudRun"
---

# Chroma on Cloud Run — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chroma_CloudRun)**

## What is Chroma?

[Chroma](https://www.trychroma.com/) is the AI-native open-source vector database with 18,000+ GitHub stars, purpose-built for embeddings and similarity search. It provides a simple, developer-friendly interface for building RAG (Retrieval-Augmented Generation) pipelines, semantic search, and LangChain/LlamaIndex workflows.

Chroma is written in Python and stores collections as persistent SQLite databases alongside HNSW index files.

## Module: Chroma_CloudRun

`Chroma_CloudRun` deploys Chroma on **Google Cloud Run v2 (Gen2)** with:

- **Cloud Storage** bucket mounted at `/data` via **GCS FUSE** for persistent collection storage
- **Optional authentication token** stored in Secret Manager and injected as `CHROMA_SERVER_AUTH_CREDENTIALS`
- **Internal ingress** by default — Chroma is accessible only within the VPC
- **Single instance** — Chroma is a single-writer store; `max_instance_count = 1`
- **Health probes** targeting `/api/v2/heartbeat`

### Use Cases

- RAG pipelines with LangChain, LlamaIndex, or custom embedding workflows
- Semantic search backends for AI applications
- Development and testing of vector search features
- Integration with n8n AI nodes and Flowise

### When to use Chroma_CloudRun vs Chroma_GKE

| Consideration | Chroma_CloudRun | Chroma_GKE |
|---|---|---|
| Deployment complexity | Low | Medium |
| Persistent storage | GCS FUSE at `/data` | StatefulSet PVC or GCS FUSE |
| Recommended for | Development, smaller workloads | Production, large collections |
| Cold starts | Possible (mitigated by `min_instance_count = 1`) | Controlled pod restarts |
| Scaling | Vertical only (single instance) | Vertical + StatefulSet |

## Architecture

```
Internet (or VPC)
  │
  ├─ [ingress_settings = "internal"] VPC only
  │
Cloud Run Service (Gen2)
  ├─ Chroma container (chromadb/chroma)
  │     Port: 8000
  │     ANONYMIZED_TELEMETRY=false
  │     CHROMA_SERVER_HTTP_PORT=8000
  │     CHROMA_SERVER_AUTH_CREDENTIALS (if enable_auth_token=true)
  │
  └─ GCS FUSE volume → <prefix>-data → /data
```

## Key GCP Resources Provisioned

- Cloud Run v2 service (Gen2 execution environment)
- GCS bucket (`<prefix>-data`) for Chroma collection storage
- Artifact Registry repository + Cloud Build image pipeline
- Secret Manager secret for auth token (when `enable_auth_token = true`)
- Serverless VPC Access / Direct VPC Egress
- Cloud Monitoring uptime check (targeting `/api/v2/heartbeat`)
- Automated backup Cloud Run Job

## Quick Start

```hcl
module "chroma_cloudrun" {
  source = "./modules/Chroma_CloudRun"

  project_id           = "my-project-123"
  tenant_deployment_id = "demo"
  application_version  = "latest"

  # Recommended for any deployment accessible outside the VPC
  enable_auth_token = true
  ingress_settings  = "internal"
}
```

## Connecting to Chroma

### Without authentication

```python
import chromadb

client = chromadb.HttpClient(
    host="<service-url>",
    port=443,
    ssl=True
)
```

### With authentication token (`enable_auth_token = true`)

Retrieve the token from Secret Manager:
```bash
gcloud secrets versions access latest \
  --secret="<prefix>-auth-token" \
  --project=<project>
```

Then connect:
```python
import chromadb
from chromadb.config import Settings

client = chromadb.HttpClient(
    host="<service-url>",
    port=443,
    ssl=True,
    headers={"Authorization": "Bearer <token>"}
)
```

## Next Steps

See the [Lab Guide](../Chroma_CloudRun_Lab/Chroma_CloudRun_Lab.md) for a step-by-step deployment walkthrough.
