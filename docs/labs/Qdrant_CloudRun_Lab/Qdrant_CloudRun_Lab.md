---
title: "Qdrant on Cloud Run — Lab Guide"
sidebar_label: "Qdrant CloudRun Lab"
---

# Qdrant on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Qdrant is a high-performance vector database and similarity search engine built in Rust. This lab deploys Qdrant on Google Cloud Run backed by a Cloud Storage bucket for persistent collection storage. Cloud Run provides serverless hosting with scale-to-zero capability.

### What the Module Automates

- Cloud Run v2 (Gen2) service with GCS FUSE volume mount
- Cloud Storage bucket for Qdrant collection data (`/qdrant/storage`)
- Artifact Registry repository and Cloud Build image pipeline
- Secret Manager secret for API key (when enabled)
- Serverless VPC Access / Direct VPC Egress
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks (`/readyz`)
- Automated backup Cloud Run Job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Retrieve the API key from Secret Manager (if enabled)
- Connect to Qdrant using the Python client or REST API
- Create collections and upsert vectors with payload
- Run filtered similarity searches
- Review logs in Cloud Logging

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Direct Qdrant REST API calls |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC and networking).
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `storage.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Python 3.9+ and `pip` for the Qdrant client steps.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `deployment_id` | No | `""` | Auto-generated suffix |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"qdrant"` | Base name for Cloud Run service and resources |
| `application_version` | No | `"latest"` | Qdrant Docker image tag (e.g., `"v1.9.0"`) |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying |
| `cpu_limit` | No | `"1000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"1Gi"` | Memory per Cloud Run instance |
| `min_instance_count` | No | `1` | Min instances (1 avoids cold starts during index loading) |
| `max_instance_count` | No | `1` | Max instances (keep at 1 — single-writer) |
| `enable_api_key` | No | `false` | Generate and store API key in Secret Manager |
| `ingress_settings` | No | `"internal"` | `"internal"` (VPC only) or `"all"` (requires API key) |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Artifact Registry image build (Cloud Build) | 5–8 min |
| Cloud Run service deployment | 2–3 min |
| GCS bucket creation | 1 min |
| **Total** | **8–12 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Qdrant Cloud Run service |
| `service_name` | Cloud Run service name |
| `deployment_id` | Unique deployment identifier |
| `storage_buckets` | Qdrant storage bucket name |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~qdrant" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Qdrant URL: ${SERVICE_URL}"
```

---

## Phase 2 — Verify Deployment [MANUAL]

### Step 2.1 — Check the Readiness Endpoint

```bash
curl -s "${SERVICE_URL}/readyz"
```

**Expected result:**
```json
{"result": true, "status": "ok", "time": 0.000012}
```

If the response returns a 503, Cloud Run may still be starting. Wait 30 seconds and retry.

**gcloud equivalent:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.conditions)"
```

### Step 2.2 — Check the Liveness Endpoint

```bash
curl -s "${SERVICE_URL}/livez"
```

**Expected result:** `{"result": true, "status": "ok", "time": ...}`

> Note: The liveness endpoint (`/livez`) and readiness endpoint (`/readyz`) are distinct in Qdrant. The startup probe uses `/readyz`; the liveness probe uses `/livez`. This prevents spurious container restarts during large collection loading.

### Step 2.3 — Check Qdrant Health Details

```bash
curl -s "${SERVICE_URL}/healthz" | python3 -m json.tool
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

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

## Phase 3 — Create Collections [MANUAL]

### Step 3.1 — Install the Qdrant Python Client

```bash
pip install qdrant-client
```

### Step 3.2 — Connect to Qdrant

```python
from qdrant_client import QdrantClient

# Without API key
client = QdrantClient(url="${SERVICE_URL}")

# With API key
client = QdrantClient(
    url="${SERVICE_URL}",
    api_key="${QDRANT_API_KEY}"
)

# Verify connection
print(client.get_collections())
```

**Expected result:** An empty `CollectionsResponse` is returned.

### Step 3.3 — Create a Collection

```python
from qdrant_client.models import Distance, VectorParams

client.create_collection(
    collection_name="my_knowledge_base",
    vectors_config=VectorParams(
        size=384,         # dimensionality matches your embedding model
        distance=Distance.COSINE
    )
)
print("Collection created")
```

**REST API equivalent:**
```bash
curl -s -X PUT "${SERVICE_URL}/collections/my_knowledge_base" \
  -H "Content-Type: application/json" \
  -H "api-key: ${QDRANT_API_KEY}" \
  -d '{
    "vectors": {
      "size": 384,
      "distance": "Cosine"
    }
  }' | python3 -m json.tool
```

**gcloud — verify the collection is persisted in GCS:**
```bash
export STORAGE_BUCKET=$(gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~qdrant" \
  --format="value(name)" \
  --limit=1)
gcloud storage ls gs://${STORAGE_BUCKET}/
```

**Expected result:** Qdrant's WAL and collection directory structure appear in the bucket.

### Step 3.4 — Upsert Points with Payload

```python
import numpy as np
from qdrant_client.models import PointStruct

# Generate sample vectors
vectors = np.random.rand(5, 384).tolist()

points = [
    PointStruct(
        id=i,
        vector=vectors[i],
        payload={
            "source": f"document_{i}",
            "category": ["database", "cloud", "ai", "kubernetes", "search"][i],
            "score": round(float(np.random.random()), 3)
        }
    )
    for i in range(5)
]

client.upsert(
    collection_name="my_knowledge_base",
    points=points
)
print(f"Upserted {len(points)} points")
```

**Expected result:** 5 points added to the collection.

---

## Phase 4 — Run Searches [MANUAL]

### Step 4.1 — Basic Similarity Search

```python
import numpy as np

query_vector = np.random.rand(384).tolist()

results = client.search(
    collection_name="my_knowledge_base",
    query_vector=query_vector,
    limit=3,
    with_payload=True
)

for result in results:
    print(f"  ID: {result.id}, Score: {result.score:.4f}, Category: {result.payload['category']}")
```

**Expected result:** The 3 nearest vectors are returned with their similarity scores (higher = more similar for cosine distance).

### Step 4.2 — Filtered Search

```python
from qdrant_client.models import Filter, FieldCondition, MatchValue

results = client.search(
    collection_name="my_knowledge_base",
    query_vector=query_vector,
    query_filter=Filter(
        must=[
            FieldCondition(
                key="score",
                range={"gte": 0.5}
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
curl -s -X POST "${SERVICE_URL}/collections/my_knowledge_base/points/search" \
  -H "Content-Type: application/json" \
  -H "api-key: ${QDRANT_API_KEY}" \
  -d '{
    "vector": [0.1, 0.2, 0.3],
    "filter": {
      "must": [{"key": "category", "match": {"value": "database"}}]
    },
    "limit": 3,
    "with_payload": true
  }' | python3 -m json.tool
```

### Step 4.3 — Scroll Through All Points

```python
results, next_offset = client.scroll(
    collection_name="my_knowledge_base",
    limit=10,
    with_payload=True,
    with_vectors=False
)
print(f"Retrieved {len(results)} points")
for point in results:
    print(f"  {point.id}: {point.payload}")
```

### Step 4.4 — Collection Info

```python
info = client.get_collection("my_knowledge_base")
print(f"Points count: {info.points_count}")
print(f"Vectors count: {info.vectors_count}")
print(f"Indexed vectors: {info.indexed_vectors_count}")
```

**REST API equivalent:**
```bash
curl -s "${SERVICE_URL}/collections/my_knowledge_base" \
  -H "api-key: ${QDRANT_API_KEY}" | python3 -m json.tool
```

---

## Phase 5 — Explore Cloud Logging [MANUAL]

### Step 5.1 — View Qdrant Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Qdrant startup logs appear, showing GCS FUSE mount initialization and the HTTP server startup on port 6333.

### Step 5.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `/readyz` shows **Passing** from multiple global locations.

---

## Phase 6 — Cloud Run Features [MANUAL]

### Step 6.1 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service shows `Ready`. Container spec shows the GCS FUSE volume mount at `/qdrant/storage`, environment variables (`QDRANT__STORAGE__STORAGE_PATH`, `QDRANT__SERVICE__HTTP_PORT`), and probe configuration.

### Step 6.2 — View Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** The active revision shows 100% traffic.

### Step 6.3 — Create a Collection Snapshot

Qdrant supports collection snapshots for backup and migration:

```python
snapshot = client.create_snapshot(collection_name="my_knowledge_base")
print(f"Snapshot created: {snapshot.name}")
```

**REST API equivalent:**
```bash
curl -s -X POST "${SERVICE_URL}/collections/my_knowledge_base/snapshots" \
  -H "api-key: ${QDRANT_API_KEY}" | python3 -m json.tool
```

---

## Phase 7 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 5–10 minutes.

> **Warning:** This permanently deletes the Qdrant storage bucket and all stored collections. Use Qdrant's snapshot API to export collections before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| GCS storage bucket creation | 1 | Yes |
| Secret Manager API key | 1 | Yes (if enabled) |
| Container image build (Cloud Build) | 1 | Yes |
| IAM and service account bindings | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Verify Qdrant readiness endpoint | 2 | No |
| Retrieve API key | 2 | No |
| Install Python client | 3 | No |
| Create collections | 3 | No |
| Upsert vectors with payload | 3 | No |
| Run similarity searches | 4 | No |
| Run filtered searches | 4 | No |
| Create collection snapshots | 6 | No |
| Review Cloud Logging | 5 | No |
| Undeploy infrastructure | 7 | Yes |
