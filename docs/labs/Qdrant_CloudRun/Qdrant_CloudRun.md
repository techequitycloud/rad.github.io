---
title: "Qdrant on Cloud Run — Overview"
sidebar_label: "Qdrant CloudRun"
---

# Qdrant on Cloud Run — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)**

## What is Qdrant?

[Qdrant](https://qdrant.tech/) is a high-performance vector database and similarity search engine with 22,000+ GitHub stars, built in Rust. It provides fast ANN (Approximate Nearest Neighbor) search, advanced filtering, payload storage, and built-in collection snapshots — integrating natively with LangChain, n8n AI, and other AI frameworks.

Qdrant stores collections as a combination of WAL (Write-Ahead Log), HNSW index files, and payload data, all persisted to disk under `/qdrant/storage`.

## Module: Qdrant_CloudRun

`Qdrant_CloudRun` deploys Qdrant on **Google Cloud Run v2 (Gen2)** with:

- **Cloud Storage** bucket mounted at `/qdrant/storage` via **GCS FUSE** for persistent collection storage
- **Optional API key** stored in Secret Manager and injected as `QDRANT__SERVICE__API_KEY`
- **Plan-time security validation** — `ingress_settings = "all"` blocked unless `enable_api_key = true`
- **Internal ingress** by default — Qdrant accessible only within the VPC
- **Single instance** — Qdrant is a single-writer store; `max_instance_count = 1`
- **Separate health probes**: startup on `/readyz`, liveness on `/livez`

### Use Cases

- RAG pipelines with LangChain, LlamaIndex, or n8n AI nodes
- Semantic search backends for AI applications
- Recommendation systems with vector similarity scoring
- Integration with Flowise, Open WebUI, and similar AI tools
- Development and staging of vector search features

### When to use Qdrant_CloudRun vs Qdrant_GKE

| Consideration | Qdrant_CloudRun | Qdrant_GKE |
|---|---|---|
| Deployment complexity | Low | Medium |
| Persistent storage | GCS FUSE at `/qdrant/storage` | StatefulSet PVC or GCS FUSE |
| Recommended for | Development, smaller workloads | Production, large collections |
| gRPC support | Limited (single port) | Full (add port 6334 to Service) |
| Scaling | Vertical only (single instance) | Vertical + StatefulSet |

## Architecture

```
Internet (or VPC)
  │
  ├─ [ingress_settings = "internal"] VPC only
  │
Cloud Run Service (Gen2)
  ├─ Qdrant container (qdrant/qdrant)
  │     Port: 6333 (REST API)
  │     QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage
  │     QDRANT__SERVICE__HTTP_PORT=6333
  │     QDRANT__SERVICE__API_KEY (if enable_api_key=true)
  │
  └─ GCS FUSE volume → <prefix>-storage → /qdrant/storage
```

## Key GCP Resources Provisioned

- Cloud Run v2 service (Gen2 execution environment)
- GCS bucket (`<prefix>-storage`) for Qdrant collection data
- Artifact Registry repository + Cloud Build image pipeline
- Secret Manager secret for API key (when `enable_api_key = true`)
- Serverless VPC Access / Direct VPC Egress
- Cloud Monitoring uptime check (targeting `/readyz`)
- Automated backup Cloud Run Job

## Quick Start

```hcl
module "qdrant_cloudrun" {
  source = "./modules/Qdrant_CloudRun"

  project_id           = "my-project-123"
  tenant_deployment_id = "demo"
  application_version  = "latest"

  enable_api_key   = true
  ingress_settings = "internal"
}
```

## Connecting to Qdrant

### Without API key

```python
from qdrant_client import QdrantClient

client = QdrantClient(url="<service-url>")
```

### With API key (`enable_api_key = true`)

Retrieve the key from Secret Manager:
```bash
gcloud secrets versions access latest \
  --secret="<prefix>-api-key" \
  --project=<project>
```

Then connect:
```python
from qdrant_client import QdrantClient

client = QdrantClient(
    url="<service-url>",
    api_key="<API_KEY>"
)
```

## Next Steps

See the [Lab Guide](../Qdrant_CloudRun_Lab/Qdrant_CloudRun_Lab.md) for a step-by-step deployment walkthrough.
