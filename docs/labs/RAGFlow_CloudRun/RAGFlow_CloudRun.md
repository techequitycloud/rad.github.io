---
title: "RAGFlow on Cloud Run — Lab Guide"
sidebar_label: "RAGFlow CloudRun"
---

# RAGFlow on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun)**

RAGFlow is an open-source document intelligence and Retrieval-Augmented Generation (RAG) engine
with 80,000+ GitHub stars. Unlike generic RAG frameworks, RAGFlow is purpose-built for deep
document understanding — it correctly parses PDFs, tables, and visual layouts before chunking
and retrieval. The `RAGFlow_CloudRun` module deploys RAGFlow on Cloud Run Gen2 with a managed
Cloud SQL MySQL 8.0 backend, Serverless VPC Access for private Redis and Elasticsearch
connectivity, and GCS for document artifact storage.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access RAGFlow](#exercise-1--access-ragflow)
6. [Exercise 2 — Upload and Parse Documents](#exercise-2--upload-and-parse-documents)
7. [Exercise 3 — Build a Knowledge Base](#exercise-3--build-a-knowledge-base)
8. [Exercise 4 — Create a Chat Application](#exercise-4--create-a-chat-application)
9. [Exercise 5 — API Integration](#exercise-5--api-integration)
10. [Exercise 6 — Storage and Embedding Storage](#exercise-6--storage-and-embedding-storage)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is RAGFlow?

RAGFlow is an open-source **document intelligence and RAG platform** that ingests PDFs, Word
documents, HTML pages, and other formats, chunks and embeds them using configurable strategies,
stores vectors in Elasticsearch, and exposes a REST API for question-answering and enterprise
search. The `RAGFlow_CloudRun` module deploys version **v0.13.0** on Cloud Run Gen2 with
scale-to-zero disabled (minimum one warm instance) because embedding model loading makes cold
starts too slow for Cloud Run's request timeout.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Document Intelligence** | PDF/DOCX/HTML ingestion with layout-aware chunking and embedding |
| **Knowledge Base Management** | Named collections with configurable chunking strategies |
| **RAG Chat** | LLM-powered Q&A with source citations from document chunks |
| **REST API** | Programmatic knowledge base and chat assistant management |
| **Cloud Run Gen2** | Serverless container with VPC egress, Cloud SQL Auth Proxy sidecar |
| **Elasticsearch Integration** | Vector indexing and semantic search via external Elasticsearch |
| **Cloud Logging** | Structured application and parsing event logs |
| **Cloud Monitoring** | Request metrics, latency, and uptime check dashboards |

---

## 2. Architecture

```
Browser / API Client
        │
        ▼
Cloud Run Gen2 Service (min=1 instance)
   ├── RAGFlow container (port 80, Nginx + Python workers)
   │       ├── Document ingestion pipeline (parse → chunk → embed)
   │       ├── REST API (/api/v1/...)
   │       └── Web UI (Knowledge Base, Chat, Files, Settings)
   └── Cloud SQL Auth Proxy sidecar (Unix socket at /cloudsql)
        │
        ├── Cloud SQL MySQL 8.0 ──────────────── RAGFlow metadata
        ├── Memorystore Redis ─────────────────── Task queue (document workers)
        └── Elasticsearch_GKE (LoadBalancer IP) ─ Vector index and search
```

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                             │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  Cloud Run Gen2 (RAGFlow)                                            │ │
│  │  ingress: all  ·  vpc_egress: PRIVATE_RANGES_ONLY  ·  min=1         │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│           │  VPC Connector (Serverless VPC Access)                         │
│  ┌────────┴──────────────────────────────────────────────────────────────┐ │
│  │  Private VPC                                                          │ │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │ │
│  │  │  Cloud SQL   │  │  Memorystore     │  │  Elasticsearch_GKE    │   │ │
│  │  │  MySQL 8.0   │  │  Redis           │  │  (LoadBalancer IP)    │   │ │
│  │  └──────────────┘  └──────────────────┘  └───────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌──────────────────┐  ┌───────────────────────┐  ┌───────────────────┐  │
│  │  GCS Bucket      │  │  Secret Manager       │  │  Artifact Registry│  │
│  │  ragflow-docs    │  │  DB password, Redis   │  │  Custom image     │  │
│  └──────────────────┘  └───────────────────────┘  └───────────────────┘  │
│                                                                           │
│  Module variable wiring:                                                  │
│    RAGFlow_CloudRun                                                        │
│      min_instance_count    = 1   → warm instance (scale-to-zero disabled)│
│      execution_environment = gen2 → GCS Fuse and Auth Proxy support       │
│      elasticsearch_hosts   = http://<ES_IP>:9200 → required              │
│      enable_redis          = true → task queue backend                    │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
roles/monitoring.viewer
roles/logging.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
gcloud auth application-default login
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `RAGFlow_CloudRun` module via the RAD UI. **Prerequisites:** `Services_GCP` and
`Elasticsearch_GKE` must be deployed first. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `elasticsearch_hosts` | `http://<ES_IP>:9200` | From Elasticsearch_GKE output |
| `redis_host` | `<REDIS_IP>` | From Services_GCP Memorystore output |
| `enable_redis` | `true` | Required for document processing workers |
| `cpu_limit` | `4000m` | RAGFlow is CPU-intensive for document parsing |
| `memory_limit` | `8Gi` | Embedding models require significant RAM |
| `application_version` | `v0.13.0` | RAGFlow version to deploy |

Click **Deploy** and wait for provisioning to complete (approximately 15–25 minutes, including
Cloud Build for the custom container image).

> **What this provisions:** Cloud Run Gen2 service with Cloud SQL Auth Proxy sidecar, Cloud SQL
> MySQL 8.0 instance and database/user creation, Serverless VPC Access connector, GCS bucket
> for document artifacts, Secret Manager secrets, Artifact Registry repository and container
> image built via Cloud Build, and Cloud Monitoring uptime checks.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~ragflow" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "RAGFlow service: ${SERVICE}"
echo "RAGFlow URL: ${SERVICE_URL}"

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="value(name)" \
  --limit=1)
```

---

## Exercise 1 — Access RAGFlow

### Objective

Retrieve the RAGFlow service URL, verify the health endpoint is responding, and complete the
initial admin account registration.

### Step 1.1 — Verify the Service Health Endpoint

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name: .name, url: .uri, state: .terminalCondition.state}'
```

**Health check:**
```bash
curl -s "${SERVICE_URL}/v1/health"
# Expected: {"code": 0}
```

If you receive a 502, wait 1–2 minutes for the startup probe to complete. RAGFlow loads
embedding models on first boot.

**Expected result:** `{"code": 0}` — RAGFlow is healthy and serving requests.

### Step 1.2 — Create the Admin Account

Navigate to `${SERVICE_URL}` in your browser.

1. On the registration page, enter an email address and password.
2. Click **Sign Up** to create the admin account.
3. Log in with the credentials you just created.

**Expected result:** The RAGFlow dashboard loads showing **Knowledge Base**, **Chat**, **Files**,
and **Settings** in the top navigation. All sections are empty on a fresh deployment.

### Step 1.3 — Explore the Dashboard

Navigate each section of the RAGFlow UI:

- **Knowledge Base** — document collections used for retrieval
- **Chat** — RAG-powered assistant configuration
- **Files** — global document storage manager
- **Settings** — LLM provider and API key configuration

### Step 1.4 — View Cloud Run Startup Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries showing Elasticsearch connection success, MySQL database
connection via Auth Proxy, and the web server starting on port 80.

---

## Exercise 2 — Upload and Parse Documents

### Objective

Upload documents of different types to RAGFlow, trigger the document parsing pipeline, and
inspect the resulting chunks and embeddings.

### Step 2.1 — Configure the Embedding Model

Before uploading documents, configure an embedding model in RAGFlow:

1. Navigate to **Settings > Model Providers**.
2. Select an embedding provider (e.g., OpenAI — enter your API key, or use a local model).
3. Save the model provider configuration.

**gcloud (verify the service is connecting to Elasticsearch):**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"elastic\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

### Step 2.2 — Upload a PDF Document

1. Navigate to **Files** in the top navigation.
2. Click **+ Upload** and select a PDF document (any document under 50 MB).
3. The file appears in the global file list with status `Unprocessed`.

**Expected result:** The file is uploaded to the RAGFlow service and stored in GCS.

### Step 2.3 — Create a Knowledge Base and Parse

1. Navigate to **Knowledge Base** and click **+ Create Knowledge Base**.
2. Configure the knowledge base:
   - **Name:** `Lab Documents`
   - **Chunking method:** `General`
   - **Embedding model:** select the model configured in Step 2.1
3. Click **Save**.
4. Inside the knowledge base, click **+ Add File** and select the PDF you uploaded.
5. Click **Parse** next to the document to start the ingestion pipeline.

**Expected result:** Document status changes from `Parsing` to `Done`. The chunk count is
displayed next to the document name.

### Step 2.4 — Inspect Chunks

Click the document name to view the resulting chunks and their metadata.

Review:
- **Chunk content** — the text extracted from each chunk
- **Page numbers** — source location in the original document
- **Token count** — size of each chunk in tokens
- **Embedding status** — confirmation that vector embeddings were computed

**Expected result:** Each chunk shows the extracted text, source page, token count, and a
green embedding status indicator.

### Step 2.5 — Try Different Chunking Methods

1. Edit the knowledge base settings and change the chunking method.
2. Re-parse the document with each method:
   - **General** — paragraph and sentence boundaries
   - **Q&A** — extracts question-answer pairs for FAQ documents
   - **Table** — preserves row/column structure for tabular data

**Expected result:** Different chunking strategies produce different chunk sizes and boundaries.

---

## Exercise 3 — Build a Knowledge Base

### Objective

Build a rich knowledge base by adding multiple document types, configuring embedding settings,
and verifying the Elasticsearch vector index.

### Step 3.1 — Add Multiple Document Types

Upload additional documents to the knowledge base:

1. Upload a `.docx` Word document.
2. Upload a `.txt` plain text file.
3. Parse each document using the **General** chunking method.

**Expected result:** All documents show `Done` status. The total chunk count reflects all
documents combined.

### Step 3.2 — Configure Embedding Settings

1. From the knowledge base settings, review the embedding model configuration.
2. Note the embedding dimension (e.g., 1536 for OpenAI ada-002).
3. Check the similarity metric (cosine by default).

**REST API (list knowledge bases — requires API key from Exercise 5):**
```bash
export API_KEY="<your-ragflow-api-key>"

curl -s -H "Authorization: Bearer ${API_KEY}" \
  "${SERVICE_URL}/api/v1/knowledge_bases" \
  | jq '.data[] | {id, name, doc_num, chunk_num}'
```

### Step 3.3 — Test Retrieval Quality

From within the knowledge base, use the **Test** or **Retrieval Test** feature:

1. Enter a query related to content in your uploaded documents.
2. Review the retrieved chunks and their similarity scores.

**Expected result:** The top-ranked chunks contain text that is semantically relevant to the
query. Similarity scores above 0.7 indicate strong retrieval.

### Step 3.4 — Verify GCS Document Storage

**gcloud:**
```bash
# List GCS buckets provisioned by the module
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~ragflow"

# List document files in the bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="value(name)" \
  --limit=1)

gcloud storage ls --recursive "gs://${BUCKET}/" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=ragflow" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, location, storageClass}'
```

**Expected result:** The RAGFlow documents bucket contains the uploaded files, organized by
knowledge base and document ID.

---

## Exercise 4 — Create a Chat Application

### Objective

Create a RAG-powered chat assistant linked to the knowledge base, test question-and-answer
interactions, and verify that responses include source citations.

### Step 4.1 — Create a Chat Assistant

1. Navigate to **Chat** and click **+ Create Assistant**.
2. Configure the assistant:
   - **Name:** `Lab Assistant`
   - **System prompt:** `You are a helpful assistant that answers questions based only on the provided documents. Always cite your sources.`
   - **Knowledge Base:** select `Lab Documents`
3. Under **LLM Settings**, select your configured LLM provider and model.
4. Click **Save**.

**Expected result:** The assistant appears in the Chat list with a green status indicator.

### Step 4.2 — Test Q&A with Source Citations

In the chat window on the right side of the screen:

1. Ask a question about content in your uploaded documents.
2. Review the response — source citations should appear below the answer.
3. Click a citation to jump to the source chunk.

**Expected result:** RAGFlow retrieves relevant chunks and passes them as context to the LLM.
The response is grounded in the document content, with chunk references shown below the answer.

### Step 4.3 — Test Multi-Turn Conversation

1. Ask a follow-up question that requires context from the previous answer.
2. Verify that the assistant maintains conversation history.

**Expected result:** The assistant correctly references context from earlier in the conversation,
demonstrating stateful multi-turn RAG.

### Step 4.4 — Review Retrieval Configuration

From the assistant settings, adjust retrieval parameters:

- **Top-N chunks:** how many chunks are retrieved per query (default: 6)
- **Similarity threshold:** minimum similarity score for retrieved chunks (default: 0.2)
- **Rerank model:** optional re-ranking of retrieved chunks

**REST API (list chat assistants):**
```bash
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "${SERVICE_URL}/api/v1/chat_assistants" \
  | jq '.data[] | {id, name, kb_ids}'
```

---

## Exercise 5 — API Integration

### Objective

Generate a RAGFlow API key, test the REST API endpoints programmatically, and query the
chat assistant via the API to understand integration patterns.

### Step 5.1 — Generate an API Key

1. In the RAGFlow UI, navigate to **Settings > API Key**.
2. Click **Generate API Key**.
3. Copy the key — it will not be shown again.

```bash
export API_KEY="<paste-your-api-key>"
```

### Step 5.2 — Test the API Endpoints

**Health check:**
```bash
curl -s "${SERVICE_URL}/v1/health"
# Expected: {"code": 0}
```

**List knowledge bases:**
```bash
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "${SERVICE_URL}/api/v1/knowledge_bases" \
  | jq '.data[] | {id, name, doc_num, chunk_num, embedding_model}'
```

**List chat assistants:**
```bash
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "${SERVICE_URL}/api/v1/chat_assistants" \
  | jq '.data[] | {id, name}'
```

**Expected result:** JSON responses listing your knowledge bases and assistants.

### Step 5.3 — Query the Chat Assistant via API

```bash
# Get the assistant ID
ASSISTANT_ID=$(curl -s -H "Authorization: Bearer ${API_KEY}" \
  "${SERVICE_URL}/api/v1/chat_assistants" \
  | jq -r '.data[0].id')

# Start a conversation session
SESSION=$(curl -s -X POST \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"api-test-session\"}" \
  "${SERVICE_URL}/api/v1/chat_assistants/${ASSISTANT_ID}/sessions" \
  | jq -r '.data.id')

# Send a message
curl -s -X POST \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"question\": \"What are the main topics in the uploaded documents?\",
       \"session_id\": \"${SESSION}\"}" \
  "${SERVICE_URL}/api/v1/chat_assistants/${ASSISTANT_ID}/completions" \
  | jq '.data.answer'
```

**Expected result:** The API returns a JSON response with the LLM answer and source chunk
references, identical to what the UI shows.

### Step 5.4 — Explore the Interactive API Docs

Navigate to `${SERVICE_URL}/api/v1/docs` for the interactive Swagger API documentation.

**gcloud (list Cloud Run revisions):**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].status, spec.containerConcurrency)"
```

---

## Exercise 6 — Storage and Embedding Storage

### Objective

Inspect the GCS bucket used for document storage, understand how the module wires storage
to the Cloud Run service, and examine the Elasticsearch index that stores vector embeddings.

### Step 6.1 — Inspect the Document Storage Bucket

**gcloud:**
```bash
# Describe the bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="value(name)" \
  --limit=1)

gcloud storage buckets describe "gs://${BUCKET}" \
  --project="${PROJECT}"

# List objects
gcloud storage ls --recursive "gs://${BUCKET}/" \
  --project="${PROJECT}" | head -30
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, size, updated}'
```

**Expected result:** The bucket contains document files organized by knowledge base ID and
document ID, along with thumbnail previews for PDF pages.

### Step 6.2 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="table(name, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aragflow" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | {name, createTime}'
```

### Step 6.3 — Verify Cloud SQL Auth Proxy Connectivity

**gcloud:**
```bash
# View Cloud SQL Auth Proxy logs from the Cloud Run sidecar
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"cloudsql|proxy|mysql\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries confirming the Cloud SQL Auth Proxy established a connection
to the MySQL 8.0 instance via the Unix socket at `/cloudsql`.

### Step 6.4 — List Cloud Run Environment Variable Configuration

**REST API (inspect service environment):**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.template.containers[0].env[] | select(.name | test("ELASTIC|MYSQL|REDIS")) | {name, value}'
```

**Expected result:** `ELASTICSEARCH_HOSTS`, `MYSQL_HOST`, `MYSQL_DATABASE`, `REDIS_HOST`, and
`REDIS_PORT` are all configured, confirming the module correctly wired all backend connections.

---

## Exercise 7 — Cloud Logging

### Objective

Query Cloud Run structured logs to observe RAGFlow application events, document parsing
activity, and database connectivity confirmations.

### Step 7.1 — View Application Logs in the Console

Open the Cloud Logging console:

```bash
echo "https://console.cloud.google.com/logs?project=${PROJECT}"
```

Use the following filter:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

### Step 7.2 — Query Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=100 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"cloud_run_revision\\\" resource.labels.service_name=\\\"${SERVICE}\\\"\",
    \"pageSize\": 50
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 7.3 — Filter for Document Parsing Events

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"parse|chunk|embed|elastic|index\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries showing document parsing steps: PDF extraction, text chunking,
embedding generation, and Elasticsearch indexing operations.

### Step 7.4 — Filter for Error-Level Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=20 \
  --freshness=6h
```

**Expected result:** For a healthy deployment, this query returns no entries. Any Elasticsearch
connection failures, MySQL errors, or Redis queue issues would appear here.

### Step 7.5 — Tail Live Logs

```bash
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

While tailing, trigger a document parse in the RAGFlow UI and observe the real-time log output.

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Run service metrics, inspect the uptime check configured by the module, and
create an alert policy for error-rate monitoring.

### Step 8.1 — View Cloud Run Metrics in the Console

```bash
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/metrics?project=${PROJECT}"
```

Review the built-in metric tabs:
- **Requests** — request count and latency distribution (P50, P95, P99)
- **Container** — CPU and memory utilization
- **Instances** — active instance count over time

### Step 8.2 — List Available Cloud Run Metrics

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type=starts_with(\"run.googleapis.com\")" \
  --project="${PROJECT}" \
  --format="table(metric.type)"
```

**REST API (query request count):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

### Step 8.3 — Review the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {name, displayName, httpCheck}'
```

**Expected result:** An uptime check polling `/v1/health` at 60-second intervals from multiple
global probe locations, showing green (passing) status.

### Step 8.4 — Query Request Latency

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_latencies | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], percentile(val(), 99)\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].distributionValue'
```

**Expected result:** P99 latency reflects embedding model processing time. Document parsing
requests will show higher latency than simple UI navigation requests.

### Step 8.5 — Create an Alert Policy

**gcloud:**
```bash
gcloud alpha monitoring policies create \
  --display-name="RAGFlow - High Error Rate" \
  --notification-channels="" \
  --condition-filter="metric.type=\"run.googleapis.com/request_count\" \
    resource.label.\"service_name\"=\"${SERVICE}\" \
    metric.label.\"response_code_class\"=\"5xx\"" \
  --condition-threshold-value=5 \
  --condition-threshold-duration=60s \
  --condition-threshold-comparison=COMPARISON_GT \
  --project="${PROJECT}"
```

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `RAGFlow_CloudRun` deployment. This removes
the Cloud Run service and revisions, Cloud SQL instance and database, GCS bucket(s), Secret
Manager secrets, Artifact Registry images, and Cloud Monitoring uptime checks.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --quiet

# Delete Secret Manager secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} \
    --project="${PROJECT}" --quiet

# Delete the Cloud SQL instance
DB_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="value(name)" \
  --limit=1)
gcloud sql instances delete "${DB_INSTANCE}" \
  --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

> **Note:** GCP holds serverless IPv4 addresses asynchronously after Cloud Run service deletion.
> If VPC subnet deletion fails, wait 20–30 minutes and retry the destroy command.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_version` | string | `v0.13.0` | RAGFlow version tag |
| `elasticsearch_hosts` | string | — | Elasticsearch HTTP endpoint (required) |
| `elasticsearch_username` | string | `""` | Elasticsearch username (leave blank if no auth) |
| `enable_redis` | bool | `true` | Enable Redis task queue backend |
| `redis_host` | string | `""` | Redis server IP (from Services_GCP output) |
| `redis_port` | string | `6379` | Redis server port |
| `cpu_limit` | string | `4000m` | CPU per Cloud Run instance |
| `memory_limit` | string | `8Gi` | Memory per Cloud Run instance |
| `max_instance_count` | number | `5` | Maximum Cloud Run instances |
| `timeout_seconds` | number | `600` | Max request timeout (large docs can be slow) |
| `execution_environment` | string | `gen2` | Cloud Run gen2 required for NFS |
| `db_name` | string | `rag_flow` | MySQL database name |
| `db_user` | string | `ragflow` | MySQL database user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `enable_nfs` | bool | `false` | Cloud Filestore NFS (requires gen2) |
| `ingress_settings` | string | `all` | Traffic sources: `all`, `internal` |

### Automatically Injected Environment Variables

| Variable | Value | Source |
|---|---|---|
| `MYSQL_HOST` | `127.0.0.1` | Cloud SQL Auth Proxy sidecar |
| `MYSQL_PORT` | `3306` | MySQL standard port |
| `MYSQL_DATABASE` | `var.db_name` | RAGFlow database name |
| `MYSQL_USER` | `var.db_user` | RAGFlow database user |
| `ELASTICSEARCH_HOSTS` | `var.elasticsearch_hosts` | Elasticsearch endpoint |
| `ELASTICSEARCH_USERNAME` | `var.elasticsearch_username` | Elasticsearch username |
| `REDIS_HOST` | `var.redis_host` | Redis server host |
| `REDIS_PORT` | `var.redis_port` | Redis server port |

### Useful Commands

```bash
# Get the service URL
gcloud run services describe ${SERVICE} \
  --region="${REGION}" --project="${PROJECT}" \
  --format="value(status.url)"

# Check service health
curl -s "${SERVICE_URL}/v1/health"

# View live logs
gcloud run services logs tail ${SERVICE} \
  --region="${REGION}" --project="${PROJECT}"

# List knowledge bases via API
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "${SERVICE_URL}/api/v1/knowledge_bases"

# List GCS buckets
gcloud storage buckets list \
  --project="${PROJECT}" --filter="name~ragflow"

# List Secret Manager secrets
gcloud secrets list \
  --project="${PROJECT}" --filter="name~ragflow"

# View Cloud Run revisions
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}"

# Update an env var (forces new revision)
gcloud run services update "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --update-env-vars=KEY=VALUE
```

### Further Reading

- [RAGFlow GitHub repository](https://github.com/infiniflow/ragflow)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Auth Proxy on Cloud Run](https://cloud.google.com/sql/docs/mysql/connect-run)
- [Serverless VPC Access](https://cloud.google.com/vpc/docs/configure-serverless-vpc-access)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Secret Manager documentation](https://cloud.google.com/secret-manager/docs)
