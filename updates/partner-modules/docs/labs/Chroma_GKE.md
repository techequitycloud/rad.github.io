# Chroma on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chroma_GKE)**

## Overview

**Estimated time:** 2–3 hours

Chroma is an AI-native open-source vector database for embeddings and similarity search. This lab deploys Chroma on Google Kubernetes Engine (GKE) Autopilot backed by a StatefulSet with a Persistent Volume Claim (PVC) for production-grade storage. GKE Autopilot provides managed Kubernetes with automatic node provisioning.

### What the Module Automates

- GKE Autopilot namespace and StatefulSet (or Deployment)
- Kubernetes Service (ClusterIP by default)
- PersistentVolumeClaim for Chroma data storage
- GCS bucket for supplementary/backup storage
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Secret Manager secret for authentication token (when enabled)
- HPA and PodDisruptionBudget
- Cloud Monitoring uptime checks (`/api/v2/heartbeat`)

### What You Do Manually

- Note deployment outputs from the RAD UI deployment panel
- Configure `kubectl` with cluster credentials
- Verify the Chroma pod is running
- Connect to Chroma via port-forwarding or from within the cluster
- Create collections and upsert embeddings
- Run similarity searches
- Observe StatefulSet pod management and PVC binding

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, get cluster credentials, query GCP resources |
| `kubectl` | Inspect pods, deployments, services, PVCs |

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
6. Python 3.9+ and `pip` for the Chroma client steps.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `deployment_id` | No | `""` | Auto-generated suffix |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"chroma"` | Base name for Kubernetes and GCP resources |
| `application_version` | No | `"latest"` | Chroma Docker image tag |
| `deploy_application` | No | `true` | Deploy workload |
| `cpu_limit` | No | `"1000m"` | CPU limit per pod |
| `memory_limit` | No | `"1Gi"` | Memory limit per pod |
| `enable_auth_token` | No | `false` | Generate auth token |
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

# Discover the Chroma namespace and service
export NS=$(kubectl get namespaces -o name | grep chroma | head -1 | cut -d/ -f2)
export SVC=$(kubectl get services -n ${NS} -o name | grep chroma | head -1 | cut -d/ -f2)
echo "Namespace: ${NS}, Service: ${SVC}"
```

---

## Phase 2 — Verify Deployment [MANUAL]

### Step 2.1 — Check Pod Status

```bash
kubectl get pods -n ${NS}
```

**Expected result:** The Chroma pod (`chroma-0` for StatefulSet) shows `Running` with `1/1` containers ready.

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

**Expected result:** The StatefulSet shows `1/1` ready replicas. Volume claim templates show the PVC of the configured size and storage class.

### Step 2.3 — Check PVC Binding

```bash
kubectl get pvc -n ${NS}
```

**Expected result:** The PVC named `<prefix>-data-chroma-0` shows `Bound` status.

### Step 2.4 — Retrieve Auth Token (if enabled)

```bash
export AUTH_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~chroma" \
  --filter="name~auth-token" \
  --format="value(name)" \
  --limit=1)

export CHROMA_TOKEN=$(gcloud secrets versions access latest \
  --secret="${AUTH_SECRET}" \
  --project=${PROJECT})
echo "Token retrieved: ${#CHROMA_TOKEN} characters"
```

---

## Phase 3 — Connect to Chroma [MANUAL]

### Step 3.1 — Port-Forward for Local Access

```bash
kubectl port-forward service/${SVC} 8000:8000 -n ${NS} &
export PF_PID=$!
sleep 2
echo "Port-forward running (PID: ${PF_PID})"
```

### Step 3.2 — Verify Heartbeat via Port-Forward

```bash
curl -s http://localhost:8000/api/v2/heartbeat
```

**Expected result:** `{"nanosecond heartbeat": <timestamp>}`

**With auth token:**
```bash
curl -s http://localhost:8000/api/v2/heartbeat \
  -H "Authorization: Bearer ${CHROMA_TOKEN}"
```

### Step 3.3 — Check Chroma Version

```bash
curl -s http://localhost:8000/api/v2/version
```

**Expected result:** JSON with the Chroma server version.

---

## Phase 4 — Create Collections and Search [MANUAL]

### Step 4.1 — Install Chroma Client

```bash
pip install chromadb
```

### Step 4.2 — Create a Collection

```python
import chromadb

# Via port-forward
client = chromadb.HttpClient(
    host="localhost",
    port=8000,
    # headers={"Authorization": "Bearer <CHROMA_TOKEN>"}  # if auth enabled
)

client.heartbeat()  # verify connection

collection = client.create_collection(
    name="knowledge_base",
    metadata={"hnsw:space": "cosine"}
)
print(f"Created: {collection.name}")
```

**Expected result:** Collection created successfully.

### Step 4.3 — Upsert Documents with Custom Embeddings

```python
import numpy as np

# Simulate embedding vectors (384-dim for illustration)
embeddings = np.random.rand(4, 384).tolist()

collection.upsert(
    ids=["item1", "item2", "item3", "item4"],
    embeddings=embeddings,
    documents=[
        "Chroma vector database on GKE Autopilot",
        "StatefulSet provides stable persistent storage",
        "GCS FUSE mounts Cloud Storage as a filesystem",
        "Kubernetes Workload Identity for GCP authentication"
    ],
    metadatas=[
        {"topic": "database", "tier": "production"},
        {"topic": "kubernetes", "tier": "infrastructure"},
        {"topic": "storage", "tier": "infrastructure"},
        {"topic": "security", "tier": "platform"}
    ]
)
print(f"Upserted {collection.count()} documents")
```

**Expected result:** 4 documents added to the collection.

### Step 4.4 — Query the Collection

```python
query_embedding = np.random.rand(1, 384).tolist()

results = collection.query(
    query_embeddings=query_embedding,
    n_results=2,
    include=["documents", "distances", "metadatas"]
)

for doc, dist, meta in zip(
    results["documents"][0],
    results["distances"][0],
    results["metadatas"][0]
):
    print(f"  [{meta['topic']}] {doc[:50]}... (dist: {dist:.4f})")
```

**Expected result:** Two nearest documents are returned with cosine distances.

### Step 4.5 — Verify PVC Data Persistence

```bash
# Check what Chroma has written to the PVC
kubectl exec -n ${NS} chroma-0 -- ls /data/
```

**Expected result:** Chroma's SQLite database file (`chroma.sqlite3`) and collection directories are listed.

---

## Phase 5 — Observe Kubernetes Features [MANUAL]

### Step 5.1 — View Pod Resource Usage

```bash
kubectl top pods -n ${NS}
```

**Expected result:** CPU and memory consumption for the Chroma pod. For a lightly loaded collection, memory usage should be well under the configured limit.

### Step 5.2 — Inspect Pod Disruption Budget

```bash
kubectl get pdb -n ${NS}
```

**Expected result:** A PodDisruptionBudget with `minAvailable: 1` is listed.

### Step 5.3 — View Logs

```bash
kubectl logs -n ${NS} chroma-0 --tail=50
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NS}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Chroma startup logs and request logs for your API calls appear.

### Step 5.4 — Clean Up Port-Forward

```bash
kill ${PF_PID}
```

---

## Phase 6 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 10–15 minutes.

> **Warning:** This permanently deletes all resources including the PVC and stored collections. Export Chroma collection data before undeploying if needed.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and StatefulSet | 1 | Yes |
| PVC provisioning | 1 | Yes |
| Secret Manager auth token | 1 | Yes (if enabled) |
| Container image build (Cloud Build) | 1 | Yes |
| Workload Identity and IAM bindings | 1 | Yes |
| Note outputs from RAD UI | 2 | No |
| Configure kubectl credentials | 2 | No |
| Verify pod status and PVC binding | 2 | No |
| Port-forward for local access | 3 | No |
| Create collections | 4 | No |
| Upsert documents | 4 | No |
| Run similarity searches | 4 | No |
| Inspect Kubernetes features | 5 | No |
| Review logs | 5 | No |
| Undeploy infrastructure | 6 | Yes |
