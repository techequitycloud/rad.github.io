---
title: "n8n AI on Cloud Run — Lab Guide"
sidebar_label: "N8N AI CloudRun Lab"
---

# n8n AI on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

n8n AI extends the standard n8n workflow automation platform with integrated AI capabilities. This module deploys the n8n AI Starter Kit on Google Cloud Run, adding a **Qdrant** vector database (for embeddings and semantic search) and an **Ollama** LLM server (for local model inference) as companion Cloud Run services alongside n8n. Together they enable building AI agent workflows, RAG (Retrieval-Augmented Generation) pipelines, and intelligent chatbots — all running on your own infrastructure with no external AI API dependencies.

Unique to the Cloud Run variant: Qdrant and Ollama are deployed as internal Cloud Run services accessible via **Private Service Connect** and **Internal DNS**, providing VPC-native connectivity. Cloud Run GPU instances are supported for Ollama to enable production-grade LLM inference.

### What the Module Automates

All Cloud Run services from N8N_CloudRun, plus:
- Qdrant vector database deployed as an internal Cloud Run service
- Ollama LLM server deployed as an internal Cloud Run service (with optional GPU)
- Private Service Connect endpoints for internal service discovery
- Internal DNS entries for Qdrant and Ollama service URLs
- Cloud SQL PostgreSQL 15, NFS Filestore (via Serverless VPC Access), GCS Fuse
- Secret Manager secrets (encryption key, DB password, SMTP credentials)
- Cloud IAM bindings for all Cloud Run service accounts
- Redis host injection (defaults to NFS server IP when `enable_redis = true`)
- Cloud Run Jobs for initialization, backup Cloud Scheduler
- Cloud Monitoring uptime checks and alert policies

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Complete the n8n initial account setup on first login
- Build standard workflows (webhook, trigger, HTTP)
- Create AI Agent workflows connecting to the internal Ollama endpoint
- Configure Qdrant as a vector store for embeddings
- Build a complete RAG pipeline

---

## CLI and REST API Overview

**Tools used:**
- `gcloud` CLI — GCP resource management
- `curl` — webhook, HTTP, and AI API testing

---

## Prerequisites

- A GCP project with the Services_GCP platform module already deployed
- `gcloud` CLI authenticated: `gcloud auth login && gcloud config set project PROJECT_ID`
- Owner or Editor role on the target GCP project
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for resource names |
| `region` | No | `us-central1` | GCP region for deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier (1–20 chars) |
| `application_name` | No | `n8nai` | Base name for Cloud Run services and Artifact Registry |
| `application_version` | No | `2.4.7` | n8n image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale-to-zero) |
| `max_instance_count` | No | `1` | Maximum concurrent n8n instances |
| `cpu_limit` | No | `2000m` | CPU limit per n8n instance |
| `memory_limit` | No | `4Gi` | Memory limit per n8n instance |
| `enable_redis` | No | `true` | Enable Redis queue mode backend |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP when empty) |
| `redis_port` | No | `6379` | Redis server port |
| `db_name` | No | `n8n_db` | PostgreSQL database name |
| `db_user` | No | `n8n_user` | PostgreSQL database username |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS |
| `nfs_mount_path` | No | `/mnt/nfs` | Container mount path for NFS volume |
| `ingress_settings` | No | `all` | n8n traffic ingress: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `enable_ai_components` | No | `true` | Master toggle for Qdrant + Ollama |
| `enable_qdrant` | No | `true` | Deploy Qdrant as an internal Cloud Run service |
| `qdrant_version` | No | `latest` | Qdrant Docker image tag |
| `enable_ollama` | No | `true` | Deploy Ollama as an internal Cloud Run service |
| `ollama_version` | No | `latest` | Ollama Docker image tag |
| `ollama_model` | No | `llama3.2` | Default LLM model to load |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

Deployment takes approximately 10–15 minutes. After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the n8n AI Cloud Run service |
| `database_instance_name` | Cloud SQL instance name |
| `nfs_server_ip` | NFS server internal IP (sensitive) |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "n8nai")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret (filter by app name)
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~n8nai" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

### Step 2.1 — Retrieve the n8n Service URL

```bash
echo "n8n AI URL: ${SERVICE_URL}"
```

**gcloud equivalent:**
```bash
gcloud run services describe ${SERVICE} \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.url)"
```

### Step 2.2 — List All Cloud Run Services in the Deployment

```bash
gcloud run services list \
  --project ${PROJECT} \
  --region ${REGION} \
  --filter "metadata.name:n8nai"
```

**Expected result:** Three Cloud Run services — n8n (public), Qdrant (internal), and Ollama (internal):

```
SERVICE                         REGION       URL                               LAST DEPLOYED
appn8naidemo<id>                us-central1  https://appn8naidemo...run.app     2m
appn8naidemo<id>-qdrant         us-central1  https://appn8naidemo-qdrant...app  2m
appn8naidemo<id>-ollama         us-central1  https://appn8naidemo-ollama...app  2m
```

Qdrant and Ollama services have `ingress = internal-only`, meaning they are accessible only from within the VPC or from other Cloud Run services with VPC egress configured.

### Step 2.3 — Get Internal Endpoints for Qdrant and Ollama

The internal DNS names are auto-configured via Private Service Connect. Note the internal URLs from the RAD UI deployment panel or retrieve them:

```bash
# Get Qdrant internal URL
gcloud run services describe ${SERVICE}-qdrant \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.url)"

# Get Ollama internal URL
gcloud run services describe ${SERVICE}-ollama \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.url)"
```

These internal HTTPS URLs are used when configuring n8n AI nodes. They are only accessible from within the VPC.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  | python3 -m json.tool
```

---

## Phase 3 — Explore the n8n Workflow Editor [MANUAL]

### Step 3.1 — Access the n8n UI

Open your browser and navigate to the `service_url`:

```
${SERVICE_URL}
```

If `min_instance_count = 0`, the first request may experience a cold start of 15–30 seconds.

### Step 3.2 — Create an Admin Account

On first launch, create an owner account with your email and a strong password. The n8n encryption key is stored in Secret Manager; credentials are stored in PostgreSQL.

### Step 3.3 — Create a Simple Workflow

1. Click **+ New workflow**.
2. Add a **Manual Trigger** → **HTTP Request** (URL: `https://httpbin.org/get`) → **Set** (Name: `message`, Value: `Hello from n8n AI`).
3. **Save** and **Execute workflow**.

**Expected result:** All nodes turn green with data flowing between them.

---

## Phase 4 — Webhooks and Triggers [MANUAL]

### Step 4.1 — Create a Webhook Workflow

1. Create a new workflow with a **Webhook** node (Method: `POST`, Path: `ai-test`).
2. Add a **Set** node to record the payload.
3. **Save** and click **Listen for Test Event**.

### Step 4.2 — Test the Webhook

```bash
curl -X POST "${SERVICE_URL}/webhook-test/ai-test" \
  -H "Content-Type: application/json" \
  -d '{"query": "Tell me about RAG pipelines", "user": "lab-user"}'
```

**Expected result:** The webhook receives the payload and displays it in the n8n UI.

**Note:** Set `min_instance_count = 1` to ensure webhook availability without cold starts.

### Step 4.3 — Scheduled Trigger

Create a workflow with a **Schedule Trigger** (every 1 minute) → **HTTP Request** → **Activate**. Verify an execution appears after one minute, then deactivate.

---

## Phase 5 — Credential Management [MANUAL]

### Step 5.1 — Add Credentials

Add an **HTTP Request** node to any workflow. Click **Authentication → Basic Auth → Create New Credential**. Save the credential.

### Step 5.2 — View Secrets

```bash
gcloud secrets list --project ${PROJECT} | grep n8nai
```

**Expected result:** Secrets for the n8n AI encryption key and database password.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:n8nai"
```

---

## Phase 6 — Workflow History and Error Handling [MANUAL]

### Step 6.1 — View Execution History

Open any workflow and click **Executions** (clock icon).

```bash
# View Cloud Run logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project ${PROJECT} \
  --limit 30 \
  --format "value(timestamp, textPayload)"
```

### Step 6.2 — Add Error Handling

1. Add an **Error Trigger** node.
2. Connect it to a **Set** node recording the error.
3. Force a failure (invalid URL in HTTP Request) and execute.
4. Verify the error branch fires and appears in execution history.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View n8n Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project ${PROJECT} \
  --limit 50 \
  --format "value(timestamp, textPayload)"
```

### Step 7.2 — View Ollama Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'-ollama"' \
  --project ${PROJECT} \
  --limit 30 \
  --format "value(timestamp, textPayload)"
```

**Expected result:** Ollama startup logs showing model download/load progress and inference server ready messages.

### Step 7.3 — View Qdrant Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'-qdrant"' \
  --project ${PROJECT} \
  --limit 30 \
  --format "value(timestamp, textPayload)"
```

**REST API equivalent for any service:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=cloud_run_revision AND resource.labels.service_name='"${SERVICE}"'-ollama",
    "pageSize": 20
  }'
```

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### Step 8.1 — View Cloud Run Request Metrics

Navigate to **Cloud Monitoring → Metrics Explorer**:
- **Resource type:** `Cloud Run Revision`
- **Metric:** `run.googleapis.com/request_count`
- **Filter:** `service_name starts_with n8nai`

**Expected result:** Request count charts for n8n, Qdrant, and Ollama services.

### Step 8.2 — View Request Latency for Ollama

Ollama inference requests are much slower than typical web requests. Monitor them separately:
- **Metric:** `run.googleapis.com/request_latencies`
- **Filter:** `service_name = ${SERVICE}-ollama`

**Expected result:** Latency percentiles showing that Ollama p99 may be in the seconds range for LLM inference on CPU. This is expected behaviour — GPU instances dramatically reduce inference time.

### Step 8.3 — Check the Uptime Monitor

```bash
gcloud monitoring uptime list-configs --project ${PROJECT}
```

**Expected result:** An uptime check for the n8n service URL showing `Healthy`.

---

## Phase 9 — AI Agent Workflows [MANUAL]

### Step 9.1 — Verify Ollama is Accessible from n8n

n8n and Ollama communicate over the internal VPC via Private Service Connect. Verify the Ollama service is healthy:

```bash
gcloud run services describe ${SERVICE}-ollama \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.conditions)"
```

**Expected result:** Service condition shows `READY = True`.

### Step 9.2 — Get the Internal Ollama URL

The internal URL for Ollama follows the Cloud Run internal service pattern. Retrieve it:

```bash
OLLAMA_URL=$(gcloud run services describe ${SERVICE}-ollama \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.url)")
echo "Ollama internal URL: ${OLLAMA_URL}"
```

This internal URL is only accessible from within the VPC (including from n8n's Cloud Run service via the configured VPC egress).

### Step 9.3 — Create an AI Agent Workflow

1. In n8n, click **+ New workflow**.
2. Add a **Manual Trigger** node.
3. Add a **Set** node to inject a test question:
   - Name: `question`, Value: `What is Retrieval-Augmented Generation?`
4. Add an **AI Agent** node:
   - Click **Chat Model** → Add **Ollama** model
   - Set **Base URL** to the internal Ollama URL (from Step 9.2)
   - Set **Model** to `llama3.2`
   - Set **Prompt** to: `Answer this question concisely: {{ $json.question }}`
5. Connect: Manual Trigger → Set → AI Agent.
6. **Save** and **Execute workflow**.

**Expected result:** The AI Agent returns a text response from the local Ollama model. Response time on CPU is typically 10–60 seconds depending on question complexity and model size.

### Step 9.4 — Test with a Live Webhook

1. Replace Manual Trigger with a **Webhook** node (Path: `ask-ai`, Method: `POST`).
2. Update the AI Agent prompt to: `Answer this question: {{ $json.body.question }}`
3. **Save** and **Activate**.

```bash
curl -X POST "${SERVICE_URL}/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"question": "Explain vector embeddings in simple terms."}'
```

**Expected result:** A JSON response containing the Ollama-generated answer about vector embeddings.

---

## Phase 10 — Vector Store Integration [MANUAL]

### Step 10.1 — Verify Qdrant is Ready

```bash
QDRANT_URL=$(gcloud run services describe ${SERVICE}-qdrant \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.url)")

# Qdrant health check (requires authentication token if configured)
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "${QDRANT_URL}/collections"
```

**Expected result:** `{"result":{"collections":[]},"status":"ok","time":0.0001}` — Qdrant is running with no collections yet.

### Step 10.2 — Document Ingestion Workflow

1. Create a workflow with a **Webhook** trigger (Path: `store-document`, Method: `POST`).
2. Add an **Embeddings Ollama** node:
   - **Base URL:** internal Ollama URL (from Phase 9.2)
   - **Model:** `nomic-embed-text` or `llama3.2`
3. Add a **Qdrant Vector Store** node (Insert operation):
   - **Qdrant URL:** internal Qdrant URL (from Step 10.1)
   - **Collection Name:** `documents`
4. **Save** and **Activate**.

**Test document ingestion:**

```bash
curl -X POST "${SERVICE_URL}/webhook/store-document" \
  -H "Content-Type: application/json" \
  -d '{"text": "Cloud Run is a managed serverless platform on Google Cloud that automatically scales containers.", "id": "doc-001"}'

curl -X POST "${SERVICE_URL}/webhook/store-document" \
  -H "Content-Type: application/json" \
  -d '{"text": "Qdrant is a vector database designed for high-performance similarity search with support for filtering.", "id": "doc-002"}'
```

**Expected result:** Documents are embedded by Ollama and stored in Qdrant. The Qdrant service processes the vectors over the internal VPC connection.

### Step 10.3 — Similarity Search Workflow

1. Create a workflow with a **Webhook** trigger (Path: `search-documents`, Method: `POST`).
2. Add **Embeddings Ollama** to embed the search query.
3. Add **Qdrant Vector Store** (Search operation) — same URL and collection, **Limit:** `3`.
4. Add a **Set** node to format results.
5. **Save** and **Activate**.

**Test search:**

```bash
curl -X POST "${SERVICE_URL}/webhook/search-documents" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is a serverless container platform?"}'
```

**Expected result:** The Cloud Run document ranks as the most similar result.

---

## Phase 11 — RAG Pipeline [MANUAL]

Build a complete Retrieval-Augmented Generation pipeline: retrieve context from Qdrant, then generate a grounded answer via Ollama.

### Step 11.1 — Ingestion Workflow (with Text Splitting)

Extend the ingestion workflow from Phase 10 with a **Text Splitter** node (chunk size: 500 chars) for longer documents:

**Webhook** (Path: `ingest`) → **Text Splitter** → **Embeddings Ollama** → **Qdrant Vector Store** (Insert)

Ingest sample documents:

```bash
curl -X POST "${SERVICE_URL}/webhook/ingest" \
  -H "Content-Type: application/json" \
  -d '{"text": "Cloud Run gen2 execution environment provides full Linux compatibility, including NFS mounts, custom system calls, and improved networking. Gen2 supports larger instance sizes and faster startup times compared to gen1.", "source": "cloudrun-docs"}'

curl -X POST "${SERVICE_URL}/webhook/ingest" \
  -H "Content-Type: application/json" \
  -d '{"text": "Private Service Connect allows Cloud Run services to communicate securely over internal IP addresses within a VPC, without traffic traversing the public internet. This enables microservice architectures with private endpoints.", "source": "networking-docs"}'
```

### Step 11.2 — Query Workflow with LLM Response Generation

1. Create a workflow with a **Webhook** trigger (Path: `rag-query`, Method: `POST`).
2. **Embeddings Ollama** — embed the query.
3. **Qdrant Vector Store** (Search) — retrieve top 3 similar chunks.
4. **Code** node — assemble the prompt:
   ```javascript
   const query = $input.first().json.query;
   const docs = $input.all().map(d => d.json.payload.text).join('\n\n');
   return [{
     json: {
       prompt: `Use the following context to answer the question accurately.\n\nContext:\n${docs}\n\nQuestion: ${query}\n\nAnswer:`
     }
   }];
   ```
5. **Ollama** or **AI Agent (Ollama)** node — generate the answer from the assembled prompt.
6. **Respond to Webhook** — return the answer.
7. **Save** and **Activate**.

**Test the RAG pipeline:**

```bash
curl -X POST "${SERVICE_URL}/webhook/rag-query" \
  -H "Content-Type: application/json" \
  -d '{"query": "How does Cloud Run gen2 differ from gen1?"}'
```

**Expected result:** A grounded answer that mentions NFS mounts, custom system calls, and faster startup — sourced from the ingested document, not the model's training data.

### Step 11.3 — Compare RAG vs. Direct Inference

Test the same question against Ollama without context to observe the grounding effect:

```bash
# Invoke Ollama directly via Cloud Run (requires auth since it is internal-only)
# From within the VPC or via gcloud proxy:
gcloud run services proxy ${SERVICE}-ollama --port=11434 --region ${REGION} --project ${PROJECT} &

curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.2", "prompt": "How does Cloud Run gen2 differ from gen1?", "stream": false}'
```

**Expected result:** A more generic answer from the base model. The RAG response includes specific details (NFS support, custom system calls) sourced from your ingested documents — demonstrating how RAG grounds model responses in your actual data.

---

## Phase 12 — Undeploy [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

The undeploy operation removes all Cloud Run services (n8n, Qdrant, Ollama), Cloud SQL instance, NFS Filestore, GCS buckets, Private Service Connect resources, secrets, and IAM bindings.

**Note:** If `enable_purge = false` was set, some resources are retained to protect against accidental data loss.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Activity | Method |
|---|---|---|
| 1 | Deploy n8n AI on Cloud Run | Automated (RAD UI) |
| 2 | Get service URLs, verify all services | Manual (gcloud) |
| 3 | Access UI, create first workflow | Manual (browser) |
| 4 | Webhooks and scheduled triggers | Manual (browser + curl) |
| 5 | Credential management | Manual (browser) |
| 6 | Execution history, error handling | Manual (browser) |
| 7 | Cloud Logging — n8n, Ollama, Qdrant logs | Manual (gcloud / console) |
| 8 | Cloud Monitoring — request metrics, latency | Manual (console) |
| 9 | AI Agent workflow with Ollama LLM | Manual (browser + curl) |
| 10 | Qdrant vector store — ingest and search | Manual (browser + curl) |
| 11 | RAG pipeline — end-to-end document QA | Manual (browser + curl) |
| 12 | Undeploy all resources | Automated (RAD UI) |
