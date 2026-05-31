# Chroma on GKE — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chroma_GKE)**

## What is Chroma?

[Chroma](https://www.trychroma.com/) is the AI-native open-source vector database with 18,000+ GitHub stars, purpose-built for embeddings and similarity search. It provides a simple, developer-friendly interface for building RAG (Retrieval-Augmented Generation) pipelines, semantic search, and LangChain/LlamaIndex workflows.

## Module: Chroma_GKE

`Chroma_GKE` deploys Chroma on **Google Kubernetes Engine (GKE) Autopilot** with:

- **StatefulSet** workload type with per-pod PVC (recommended for production)
- **OR GCS FUSE** volume mounted at `/data` for development/lower-cost deployments
- **Optional authentication token** stored in Secret Manager and injected as `CHROMA_SERVER_AUTH_CREDENTIALS`
- **ClusterIP service** by default — Chroma accessible only within the cluster
- **Workload Identity** for GCS and Secret Manager access
- **Health probes** targeting `/api/v2/heartbeat`
- **PodDisruptionBudget** enabled by default

### Use Cases

- Production RAG pipelines requiring stable, low-latency vector storage
- AI applications co-deployed in the same GKE cluster
- LangChain/LlamaIndex backends with predictable performance
- High-throughput embedding upsert workloads

### When to use Chroma_GKE vs Chroma_CloudRun

| Consideration | Chroma_CloudRun | Chroma_GKE |
|---|---|---|
| Storage latency | Higher (GCS FUSE) | Lower (PVC Balanced/Premium PD) |
| Persistence | GCS FUSE | StatefulSet PVC or GCS FUSE |
| Recommended for | Development, smaller workloads | Production, large collections |
| Infrastructure required | VPC + Cloud Run | VPC + GKE cluster (Services_GCP) |
| Scaling | Vertical only (single instance) | Vertical + StatefulSet replicas |

## Architecture

```
GKE Autopilot Cluster
  │
  Namespace: <prefix>
  │
  StatefulSet: <prefix>
    ├─ Pod: chroma-0
    │    ├─ Chroma container (chromadb/chroma)
    │    │    Port: 8000
    │    │    ANONYMIZED_TELEMETRY=false
    │    │    CHROMA_SERVER_HTTP_PORT=8000
    │    │    CHROMA_SERVER_AUTH_CREDENTIALS (if enable_auth_token=true)
    │    └─ PVC: <prefix>-data-chroma-0 → /data
    │
  Service: <prefix> (ClusterIP → port 8000)
```

## Key GCP Resources Provisioned

- GKE Autopilot namespace and StatefulSet (or Deployment)
- Kubernetes Service (ClusterIP by default)
- PersistentVolumeClaim (when `stateful_pvc_enabled = true`)
- GCS bucket (`<prefix>-data`) for fallback/supplementary storage
- Artifact Registry repository + Cloud Build image pipeline
- Secret Manager secret for auth token (when `enable_auth_token = true`)
- Workload Identity IAM bindings
- HPA (when `max_instance_count > 1`)
- PodDisruptionBudget
- Cloud Monitoring uptime checks

## Quick Start

```hcl
module "chroma_gke" {
  source = "./modules/Chroma_GKE"

  project_id           = "my-project-123"
  tenant_deployment_id = "prod"
  application_version  = "latest"

  # Production: StatefulSet with Persistent Volume
  stateful_pvc_enabled = true
  stateful_pvc_size    = "20Gi"

  # Authentication
  enable_auth_token = true
}
```

## Connecting to Chroma from Within the Cluster

```python
import chromadb

# Internal ClusterIP service
client = chromadb.HttpClient(
    host="<service-name>.<namespace>.svc.cluster.local",
    port=8000,
    ssl=False,
    headers={"Authorization": "Bearer <token>"}  # if auth enabled
)
```

## Next Steps

See the [Lab Guide](Chroma_GKE_Lab.md) for a step-by-step deployment walkthrough.
