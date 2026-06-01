---
title: "Qdrant on GKE — Lab Guide"
sidebar_label: "Qdrant GKE"
---

# Qdrant on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)**

## Overview

**Estimated time:** 2–3 hours

Qdrant is a high-performance vector database and similarity search engine built in Rust. This lab deploys Qdrant on Google Kubernetes Engine (GKE) Autopilot backed by a StatefulSet with a Persistent Volume Claim (PVC) for production-grade storage. GKE Autopilot provides managed Kubernetes with automatic node provisioning.

### What the Module Automates

- GKE Autopilot namespace and StatefulSet (or Deployment)
- Kubernetes Service (ClusterIP by default)
- PersistentVolumeClaim for Qdrant collection storage at `/qdrant/storage`
- GCS bucket for supplementary/backup storage
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Secret Manager secret for API key (when enabled)
- HPA and PodDisruptionBudget
- Cloud Monitoring uptime checks (`/readyz`)
- Automated backup Cloud Run Job

### What You Do Manually

- Note deployment outputs from the RAD UI deployment panel
- Configure `kubectl` with cluster credentials
- Verify the Qdrant pod is running
- Connect to Qdrant via port-forwarding or from within the cluster
- Create collections and upsert vectors with payload
- Run filtered similarity searches
- Observe StatefulSet pod management and PVC binding
- Create collection snapshots

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, get cluster credentials, query GCP resources |
| `kubectl` | Inspect pods, StatefulSets, services, PVCs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC and GKE Autopilot cluster).
3. The following APIs enabled (Services GCP handles this):
   - `container.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `storage.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` installed and available in PATH.
6. Python 3.9+ and `pip` for the Qdrant client steps.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `deployment_id` | No | `""` | Auto-generated suffix |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"qdrant"` | Base name for Kubernetes and GCP resources |
| `application_version` | No | `"latest"` | Qdrant Docker image tag (e.g., `"v1.9.0"`) |
| `deploy_application` | No | `true` | Deploy workload |
| `cpu_limit` | No | `"1000m"` | CPU limit per pod |
| `memory_limit` | No | `"1Gi"` | Memory limit per pod |
| `enable_api_key` | No | `false` | Generate API key stored in Secret Manager |
| `stateful_pvc_enabled` | No | `null` | Set `true` for production PVC storage |
| `stateful_pvc_size` | No | `"20Gi"` | PVC size |
| `stateful_pvc_storage_class` | No | `"standard-rwo"` | `"standard-rwo"` or `"premium-rwo"` |
| `service_type` | No | `"ClusterIP"` | `"ClusterIP"` (internal) or `"LoadBalancer"` |
| `backup_schedule` | No | `"0 2 * * *"` | Automated backup schedule |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Artifact Registry image build (Cloud Build) | 5–8 min |
| GKE namespace and workload deployment | 3–5 min |
| PVC provisioning | 1–2 min |
| **Total** | **9–15 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | Internal ClusterIP service URL |
| `service_name` | Kubernetes service name |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Get GKE cluster credentials
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the Qdrant namespace and service
export NS=$(kubectl get namespaces -o name | grep qdrant | head -1 | cut -d/ -f2)
export SVC=$(kubectl get services -n ${NS} -o name | grep qdrant | head -1 | cut -d/ -f2)
echo "Namespace: ${NS}, Service: ${SVC}"
```

---

## Phase 2 — Verify Deployment [MANUAL]

### Step 2.1 — Check Pod Status

```bash
kubectl get pods -n ${NS}
```

**Expected result:** The Qdrant pod (`qdrant-0` for StatefulSet) shows `Running` with `1/1` containers ready.

**gcloud equivalent:**
```bash
gcloud container clusters describe ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status)"
```

### Step 2.2 — Inspect the StatefulSet

```bash
kubectl describe statefulset -n ${NS}
```

**Expected result:** The StatefulSet shows `1/1` ready replicas. Volume claim templates show the PVC mounted at `/qdrant/storage` with the configured size and storage class.

### Step 2.3 — Check PVC Binding

```bash
kubectl get pvc -n ${NS}
```

**Expected result:** The PVC named `<prefix>-data-qdrant-0` shows `Bound` status.

### Step 2.4 — Retrieve API Key (if enabled)

```bash
export API_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~qdrant" \
  --filter="name~api-key" \
  --format="value(name)" \
  --limit=1)

export QDRANT_API_KEY=$(gcloud secrets versions access latest \
  --secret="${API_SECRET}" \
  --project=${PROJECT})
echo "API key retrieved: ${#QDRANT_API_KEY} characters"
```

---

## Phase 3 — Connect to Qdrant [MANUAL]

### Step 3.1 — Port-Forward for Local Access

```bash
kubectl port-forward service/${SVC} 6333:6333 -n ${NS} &
export PF_PID=$!
sleep 2
echo "Port-forward running (PID: ${PF_PID})"
```

### Step 3.2 — Verify Readiness via Port-Forward

```bash
curl -s http://localhost:6333/readyz
```

**Expected result:** `{"result": true, "status": "ok", "time": ...}`

**With API key:**
```bash
curl -s http://localhost:6333/readyz \
  -H "api-key: ${QDRANT_API_KEY}"
```

### Step 3.3 — Check Liveness Endpoint

```bash
curl -s http://localhost:6333/livez
```

**Expected result:** `{"result": true, "status": "ok", "time": ...}`

> Note: Qdrant exposes two distinct health endpoints. The startup probe uses `/readyz`; the liveness probe uses `/livez`. Qdrant marks itself not-ready during collection loading — using `/readyz` for liveness would cause spurious container restarts. The module uses `/livez` for the liveness probe to prevent this.

### Step 3.4 — Check Qdrant Version

```bash
curl -s http://localhost:6333/ | python3 -m json.tool
```

**Expected result:** A JSON object with the Qdrant server version and build information.

---

## Phase 4 — Create Collections and Search [MANUAL]

### Step 4.1 — Install Qdrant Python Client

```bash
pip install qdrant-client
```

### Step 4.2 — Connect to Qdrant

```python
from qdrant_client import QdrantClient

# Via port-forward — no API key
client = QdrantClient(host="localhost", port=6333)

# Via port-forward — with API key
client = QdrantClient(
    host="localhost",
    port=6333,
    api_key="<QDRANT_API_KEY>"
)

# Verify connection
print(client.get_collections())
```

**Expected result:** An empty `CollectionsResponse` is returned.

### Step 4.3 — Create a Collection

```python
from qdrant_client.models import Distance, VectorParams

client.create_collection(
    collection_name="knowledge_base",
    vectors_config=VectorParams(
        size=384,          # dimensionality matches your embedding model
        distance=Distance.COSINE
    )
)
print("Collection created")
```

**REST API equivalent:**
```bash
curl -s -X PUT http://localhost:6333/collections/knowledge_base \
  -H "Content-Type: application/json" \
  -H "api-key: ${QDRANT_API_KEY}" \
  -d '{
    "vectors": {
      "size": 384,
      "distance": "Cosine"
    }
  }' | python3 -m json.tool
```

### Step 4.4 — Upsert Points with Payload

```python
import numpy as np
from qdrant_client.models import PointStruct

vectors = np.random.rand(5, 384).tolist()

points = [
    PointStruct(
        id=i,
        vector=vectors[i],
        payload={
            "source": f"document_{i}",
            "category": ["database", "kubernetes", "ai", "storage", "search"][i],
            "score": round(float(np.random.random()), 3)
        }
    )
    for i in range(5)
]

client.upsert(
    collection_name="knowledge_base",
    points=points
)
print(f"Upserted {len(points)} points")
```

**Expected result:** 5 points added to the collection.

### Step 4.5 — Verify PVC Data Persistence

```bash
# Check what Qdrant has written to the PVC
kubectl exec -n ${NS} qdrant-0 -- ls /qdrant/storage/
```

**Expected result:** Qdrant's WAL, collection directories, and HNSW index files are listed under `/qdrant/storage`.

---

## Phase 5 — Run Searches [MANUAL]

### Step 5.1 — Basic Similarity Search

```python
import numpy as np

query_vector = np.random.rand(384).tolist()

results = client.search(
    collection_name="knowledge_base",
    query_vector=query_vector,
    limit=3,
    with_payload=True
)

for result in results:
    print(f"  ID: {result.id}, Score: {result.score:.4f}, Category: {result.payload['category']}")
```

**Expected result:** The 3 nearest vectors are returned with cosine similarity scores (higher = more similar).

### Step 5.2 — Filtered Search

```python
from qdrant_client.models import Filter, FieldCondition, MatchValue

results = client.search(
    collection_name="knowledge_base",
    query_vector=query_vector,
    query_filter=Filter(
        must=[
            FieldCondition(
                key="category",
                match=MatchValue(value="kubernetes")
            )
        ]
    ),
    limit=3,
    with_payload=True
)
print(f"Filtered results: {len(results)}")
```

**REST API equivalent:**
```bash
curl -s -X POST http://localhost:6333/collections/knowledge_base/points/search \
  -H "Content-Type: application/json" \
  -H "api-key: ${QDRANT_API_KEY}" \
  -d '{
    "vector": [0.1, 0.2, 0.3],
    "filter": {
      "must": [{"key": "category", "match": {"value": "kubernetes"}}]
    },
    "limit": 3,
    "with_payload": true
  }' | python3 -m json.tool
```

### Step 5.3 — Scroll Through All Points

```python
results, next_offset = client.scroll(
    collection_name="knowledge_base",
    limit=10,
    with_payload=True,
    with_vectors=False
)
print(f"Retrieved {len(results)} points")
for point in results:
    print(f"  {point.id}: {point.payload}")
```

### Step 5.4 — Collection Info

```python
info = client.get_collection("knowledge_base")
print(f"Points count:   {info.points_count}")
print(f"Vectors count:  {info.vectors_count}")
print(f"Indexed vectors:{info.indexed_vectors_count}")
```

---

## Phase 6 — Observe Kubernetes Features [MANUAL]

### Step 6.1 — View Pod Resource Usage

```bash
kubectl top pods -n ${NS}
```

**Expected result:** CPU and memory consumption for the Qdrant pod. Memory usage reflects the HNSW index in addition to runtime overhead.

### Step 6.2 — Inspect Pod Disruption Budget

```bash
kubectl get pdb -n ${NS}
```

**Expected result:** A PodDisruptionBudget with `minAvailable: 1` is listed, preventing simultaneous eviction.

### Step 6.3 — View Logs

```bash
kubectl logs -n ${NS} qdrant-0 --tail=50
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NS}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Qdrant startup logs showing GCS FUSE (or PVC) mount initialization, WAL recovery, and the HTTP server startup on port 6333.

### Step 6.4 — Create a Collection Snapshot

Qdrant supports collection snapshots for backup and migration:

```python
snapshot = client.create_snapshot(collection_name="knowledge_base")
print(f"Snapshot created: {snapshot.name}")
```

**REST API equivalent:**
```bash
curl -s -X POST http://localhost:6333/collections/knowledge_base/snapshots \
  -H "api-key: ${QDRANT_API_KEY}" | python3 -m json.tool
```

**Expected result:** A snapshot record is returned with the snapshot name and creation timestamp. Snapshots are stored within the PVC under `/qdrant/storage/snapshots/`.

### Step 6.5 — Clean Up Port-Forward

```bash
kill ${PF_PID}
```

---

## Phase 7 — Delete [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources.

**Approximate delete duration:** 10–15 minutes.

> **Warning:** This permanently deletes all resources including the PVC and all stored Qdrant collections. Use Qdrant's snapshot API or the automated backup job to export collections before deleting.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and StatefulSet | 1 | Yes |
| PVC provisioning | 1 | Yes |
| Secret Manager API key | 1 | Yes (if enabled) |
| Container image build (Cloud Build) | 1 | Yes |
| Workload Identity and IAM bindings | 1 | Yes |
| Note outputs from RAD UI | 2 | No |
| Configure kubectl credentials | 2 | No |
| Verify pod status and PVC binding | 2 | No |
| Port-forward for local access | 3 | No |
| Verify readiness and liveness probes | 3 | No |
| Install Python client | 4 | No |
| Create collections | 4 | No |
| Upsert vectors with payload | 4 | No |
| Run similarity searches | 5 | No |
| Run filtered searches | 5 | No |
| Inspect Kubernetes features | 6 | No |
| Create collection snapshots | 6 | No |
| Review logs | 6 | No |
| Delete infrastructure | 7 | Yes |
