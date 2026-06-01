# Chroma on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chroma_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Chroma is an AI-native open-source vector database for embeddings and similarity search. This lab deploys Chroma on Google Cloud Run backed by a Cloud Storage bucket for persistent collection storage. Cloud Run provides serverless hosting with scale-to-zero capability.

### What the Module Automates

- Cloud Run v2 (Gen2) service with GCS FUSE volume mount
- Cloud Storage bucket for Chroma collection data (`/data`)
- Artifact Registry repository and Cloud Build image pipeline
- Secret Manager secret for authentication token (when enabled)
- Serverless VPC Access / Direct VPC Egress
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks (`/api/v2/heartbeat`)
- Automated backup Cloud Run Job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Retrieve the auth token from Secret Manager (if enabled)
- Connect to Chroma using the Python client or REST API
- Create collections and upsert embeddings
- Run similarity searches
- Review logs in Cloud Logging

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Direct Chroma REST API calls |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC and networking).
3. The following APIs enabled (Services GCP handles this):
   - `run.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `storage.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Python 3.9+ and `pip` for the Chroma client steps.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `deployment_id` | No | `""` | Auto-generated suffix |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"chroma"` | Base name for Cloud Run service and resources |
| `application_version` | No | `"latest"` | Chroma Docker image tag |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying |
| `cpu_limit` | No | `"1000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"1Gi"` | Memory per Cloud Run instance |
| `min_instance_count` | No | `1` | Min instances (1 avoids cold starts) |
| `max_instance_count` | No | `1` | Max instances (keep at 1 — single-writer) |
| `enable_auth_token` | No | `false` | Generate and store auth token in Secret Manager |
| `ingress_settings` | No | `"internal"` | `"internal"` (VPC only) or `"all"` (requires auth token) |
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
| `service_url` | HTTPS URL of the Chroma Cloud Run service |
| `service_name` | Cloud Run service name |
| `deployment_id` | Unique deployment identifier |
| `storage_buckets` | Chroma data bucket name |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~chroma" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Chroma URL: ${SERVICE_URL}"
```

---

## Phase 2 — Verify Deployment [MANUAL]

### Step 2.1 — Check the Heartbeat Endpoint

```bash
curl -s "${SERVICE_URL}/api/v2/heartbeat"
```

**Expected result:**
```json
{"nanosecond heartbeat": 1234567890}
```

If the response is empty or returns a 503, the Cloud Run instance may still be starting. Wait 30 seconds and retry.

**gcloud equivalent — inspect Cloud Run service:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.conditions)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

### Step 2.2 — Check Chroma API Version

```bash
curl -s "${SERVICE_URL}/api/v2/version"
```

**Expected result:** A JSON object with the Chroma server version string.

### Step 2.3 — Retrieve Auth Token (if enabled)

If `enable_auth_token = true`, retrieve the token before making further API calls:

```bash
# Find the auth token secret
export AUTH_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~chroma" \
  --filter="name~auth-token" \
  --format="value(name)" \
  --limit=1)

# Retrieve the token value
export CHROMA_TOKEN=$(gcloud secrets versions access latest \
  --secret="${AUTH_SECRET}" \
  --project=${PROJECT})

echo "Auth token retrieved: ${#CHROMA_TOKEN} characters"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${AUTH_SECRET}/versions/latest:access" \
  | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['payload']['data']).decode())"
```

---

## Phase 3 — Create Collections [MANUAL]

### Step 3.1 — Install the Chroma Python Client

```bash
pip install chromadb
```

### Step 3.2 — Connect to Chroma

```python
import chromadb

# Without auth token
client = chromadb.HttpClient(
    host="<SERVICE_URL without https://>",
    port=443,
    ssl=True
)

# With auth token
client = chromadb.HttpClient(
    host="<SERVICE_URL without https://>",
    port=443,
    ssl=True,
    headers={"Authorization": "Bearer <CHROMA_TOKEN>"}
)
```

**Test the connection:**
```python
client.heartbeat()
```

**Expected result:** A nanosecond timestamp integer.

### Step 3.3 — Create a Collection

```python
collection = client.create_collection(
    name="my_documents",
    metadata={"description": "Document embeddings for RAG"}
)
print(f"Collection created: {collection.name}")
```

**Expected result:** The collection is created and its name is printed.

**gcloud — verify the collection persists in GCS:**
```bash
export DATA_BUCKET=$(gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~chroma" \
  --format="value(name)" \
  --limit=1)
gcloud storage ls gs://${DATA_BUCKET}/
```

**Expected result:** Chroma's SQLite database file and directory structure appear in the bucket.

### Step 3.4 — Upsert Documents

```python
# Upsert documents with embeddings
collection.upsert(
    ids=["doc1", "doc2", "doc3"],
    documents=[
        "Chroma is an open-source vector database for AI applications.",
        "Google Cloud Run provides serverless container hosting.",
        "RAG pipelines combine vector search with language models."
    ],
    metadatas=[
        {"source": "chroma_docs", "category": "database"},
        {"source": "gcp_docs", "category": "cloud"},
        {"source": "ai_guide", "category": "ml"}
    ]
)
print("Documents upserted successfully")
```

**Expected result:** Documents are stored in the collection. Chroma auto-embeds using its default embedding function.

**REST API equivalent:**
```bash
curl -s -X POST "${SERVICE_URL}/api/v2/collections/my_documents/upsert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${CHROMA_TOKEN}" \
  -d '{
    "ids": ["doc1", "doc2"],
    "documents": ["Chroma vector database", "Cloud Run serverless"],
    "metadatas": [{"source": "test"}, {"source": "test"}]
  }'
```

---

## Phase 4 — Run Similarity Searches [MANUAL]

### Step 4.1 — Query the Collection

```python
results = collection.query(
    query_texts=["What is a vector database?"],
    n_results=2,
    include=["documents", "distances", "metadatas"]
)

for i, (doc, dist) in enumerate(zip(results["documents"][0], results["distances"][0])):
    print(f"Result {i+1}: {doc[:60]}... (distance: {dist:.4f})")
```

**Expected result:** The two most semantically similar documents are returned with their distances. The Chroma document about the vector database should rank highest.

### Step 4.2 — Filter by Metadata

```python
results = collection.query(
    query_texts=["cloud infrastructure"],
    n_results=2,
    where={"category": "cloud"},
    include=["documents", "metadatas", "distances"]
)
print(results)
```

**Expected result:** Only documents with `category = "cloud"` in their metadata are returned.

### Step 4.3 — List Collections

```python
collections = client.list_collections()
for c in collections:
    print(f"  Collection: {c.name}")
```

**REST API equivalent:**
```bash
curl -s "${SERVICE_URL}/api/v2/collections" \
  -H "Authorization: Bearer ${CHROMA_TOKEN}" | python3 -m json.tool
```

**Expected result:** `my_documents` appears in the collection list.

---

## Phase 5 — Explore Cloud Logging [MANUAL]

### Step 5.1 — View Chroma Application Logs

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

**Expected result:** Chroma startup logs appear, including the port binding line and request logs for your API calls.

### Step 5.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `/api/v2/heartbeat` shows **Passing** from multiple global locations.

---

## Phase 6 — Cloud Run Features [MANUAL]

### Step 6.1 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready`. Container spec shows the GCS FUSE volume mount at `/data`, CPU/memory limits, and environment variables.

### Step 6.2 — View Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** The active revision is listed with 100% traffic allocation.

### Step 6.3 — Check Instance Count

```bash
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** With `min_instance_count = 1`, at least one instance is always running. No cold starts.

---

## Phase 7 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 5–10 minutes.

> **Warning:** This permanently deletes the Chroma data bucket and all stored collections. Export collection data before undeploying if needed.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| GCS data bucket creation | 1 | Yes |
| Secret Manager auth token | 1 | Yes (if enabled) |
| Container image build (Cloud Build) | 1 | Yes |
| IAM and service account bindings | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Verify Chroma heartbeat | 2 | No |
| Retrieve auth token | 2 | No |
| Install Python client | 3 | No |
| Create collections | 3 | No |
| Upsert documents | 3 | No |
| Run similarity searches | 4 | No |
| Review Cloud Logging | 5 | No |
| Inspect Cloud Run service | 6 | No |
| Undeploy infrastructure | 7 | Yes |
