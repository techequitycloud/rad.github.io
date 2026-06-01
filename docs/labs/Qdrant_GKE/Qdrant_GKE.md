---
title: "Qdrant on GKE — Overview"
sidebar_label: "Qdrant GKE"
---

# Qdrant on GKE — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)**

## What is Qdrant?

[Qdrant](https://qdrant.tech/) is a high-performance vector database and similarity search engine with 22,000+ GitHub stars, built in Rust. It provides fast ANN (Approximate Nearest Neighbor) search, advanced filtering, payload storage, and built-in collection snapshots — integrating natively with LangChain, n8n AI, and other AI frameworks.

Qdrant stores collections as a combination of WAL (Write-Ahead Log), HNSW index files, and payload data, all persisted to disk under `/qdrant/storage`.

## Module: Qdrant_GKE

`Qdrant_GKE` deploys Qdrant on **Google Kubernetes Engine (GKE) Autopilot** with:

- **StatefulSet** workload type with per-pod PVC mounted at `/qdrant/storage` (recommended for production)
- **OR GCS FUSE** volume mounted at `/qdrant/storage` for development/lower-cost deployments
- **Optional API key** stored in Secret Manager and injected as `QDRANT__SERVICE__API_KEY`
- **Plan-time security validation** — `service_type = "LoadBalancer"` without `enable_api_key = true` is blocked
- **ClusterIP service** by default — Qdrant accessible only within the cluster
- **Single instance** — Qdrant is a single-writer store; `max_instance_count = 1`
- **Separate health probes**: startup on `/readyz`, liveness on `/livez`
- **Workload Identity** for GCS and Secret Manager access
- **PodDisruptionBudget** enabled by default

### Why Separate Liveness and Readiness Probes?

Qdrant marks itself as not-ready during large collection loading. If the liveness probe also targeted `/readyz`, Kubernetes would restart the container during a normal collection-loading cycle. The module therefore uses `/livez` for liveness — the container is only restarted when it is genuinely unhealthy, not merely busy loading data.

### Use Cases

- Production RAG pipelines with predictable, low-latency vector search
- AI applications co-deployed in the same GKE cluster
- LangChain/LlamaIndex backends requiring high-throughput ANN queries
- Large collections that benefit from PVC-backed Persistent Disk performance
- Semantic search and recommendation systems

### When to use Qdrant_GKE vs Qdrant_CloudRun

| Consideration | Qdrant_CloudRun | Qdrant_GKE |
|---|---|---|
| Deployment complexity | Low | Medium |
| Persistent storage | GCS FUSE at `/qdrant/storage` | StatefulSet PVC or GCS FUSE |
| Recommended for | Development, smaller workloads | Production, large collections |
| gRPC support | Limited (single port) | Enabled via `environment_variables` |
| Scaling | Vertical only (single instance) | Vertical + StatefulSet |
| Infrastructure required | VPC + Cloud Run | VPC + GKE cluster (Services_GCP) |

## Architecture

```
GKE Autopilot Cluster
  │
  Namespace: <prefix>
  │
  StatefulSet: <prefix>
    ├─ Pod: qdrant-0
    │    ├─ Qdrant container (qdrant/qdrant)
    │    │    Port: 6333 (REST API)
    │    │    QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage
    │    │    QDRANT__SERVICE__HTTP_PORT=6333
    │    │    QDRANT__SERVICE__API_KEY (if enable_api_key=true)
    │    └─ PVC: <prefix>-data-qdrant-0 → /qdrant/storage
    │
  Service: <prefix> (ClusterIP → port 6333)
```

## Key GCP Resources Provisioned

- GKE Autopilot namespace and StatefulSet (or Deployment)
- Kubernetes Service (ClusterIP by default)
- PersistentVolumeClaim (when `stateful_pvc_enabled = true`)
- GCS bucket (`<prefix>-storage`) for fallback/supplementary storage
- Artifact Registry repository + Cloud Build image pipeline
- Secret Manager secret for API key (when `enable_api_key = true`)
- Workload Identity IAM bindings
- HPA (when `max_instance_count > 1`)
- PodDisruptionBudget
- Cloud Monitoring uptime checks (targeting `/readyz`)

## Quick Start

```hcl
module "qdrant_gke" {
  source = "./modules/Qdrant_GKE"

  project_id           = "my-project-123"
  tenant_deployment_id = "prod"
  application_version  = "latest"

  # Production: StatefulSet with Persistent Volume
  stateful_pvc_enabled = true
  stateful_pvc_size    = "20Gi"

  # Authentication
  enable_api_key = true
}
```

## Connecting to Qdrant from Within the Cluster

### Python client

```python
from qdrant_client import QdrantClient

# Internal ClusterIP service — no API key
client = QdrantClient(
    host="<service-name>.<namespace>.svc.cluster.local",
    port=6333
)

# With API key
client = QdrantClient(
    host="<service-name>.<namespace>.svc.cluster.local",
    port=6333,
    api_key="<API_KEY>"
)
```

### REST API

```bash
# From within the cluster (e.g., after kubectl exec or port-forward)
curl http://<service-name>.<namespace>.svc.cluster.local:6333/readyz
```

## Enabling gRPC

gRPC (port 6334) is not enabled by default. To enable it, pass the `QDRANT__SERVICE__GRPC_PORT` environment variable:

```hcl
environment_variables = {
  QDRANT__SERVICE__GRPC_PORT = "6334"
}
```

You must also expose port 6334 on the Kubernetes Service (or use a separate Service for gRPC traffic).

## Next Steps

See the [Lab Guide](../Qdrant_GKE_Lab/Qdrant_GKE_Lab.md) for a step-by-step deployment walkthrough.
