---
title: "n8n AI on Cloud Run — Lab Guide"
sidebar_label: "N8N AI CloudRun"
---

# n8n AI on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun)**

This lab guide walks you through deploying, exploring, and operating the **n8n AI Starter Kit**
on Google Cloud Run using the **N8N_AI_CloudRun** module. You will build AI agent workflows,
configure a Qdrant vector database for Retrieval-Augmented Generation (RAG), run local LLM
inference with Ollama — all on your own GCP infrastructure with no external AI API dependencies.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access n8n AI and Initial Setup](#exercise-1--access-n8n-ai-and-initial-setup)
6. [Exercise 2 — Build an AI Workflow](#exercise-2--build-an-ai-workflow)
7. [Exercise 3 — AI Memory and Context](#exercise-3--ai-memory-and-context)
8. [Exercise 4 — Webhooks and AI Triggers](#exercise-4--webhooks-and-ai-triggers)
9. [Exercise 5 — Credential Management for AI](#exercise-5--credential-management-for-ai)
10. [Exercise 6 — Vector Store Integration](#exercise-6--vector-store-integration)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is n8n AI?

n8n AI is the AI-augmented variant of the popular open-source workflow automation platform
(189,000+ GitHub stars, top 50 on all of GitHub). The `N8N_AI_CloudRun` module deploys n8n
version **2.4.7** on Google Cloud Run alongside two companion AI services: **Qdrant** (a
high-performance vector database for embeddings and semantic search) and **Ollama** (a local
LLM inference server for privacy-first AI without external API dependencies). All three
services communicate over Private Service Connect within the VPC, with Qdrant and Ollama
accessible only from inside the network.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **AI Agent Workflows** | LangChain-style agent loops using the n8n AI Agent node with Ollama as the chat model |
| **Local LLM Inference** | Ollama serving Llama 3.2 (or other open models) inside your VPC — no external AI calls |
| **Vector Store (RAG)** | Qdrant as a vector database for document embedding, similarity search, and grounded LLM answers |
| **Serverless Scaling** | Cloud Run scale-to-zero with configurable min/max instances and Redis queue mode |
| **Internal Networking** | Private Service Connect endpoints for Qdrant and Ollama — internal-only ingress |
| **Secrets Management** | N8N_ENCRYPTION_KEY and FLOWISE_PASSWORD auto-generated and stored in Secret Manager |
| **Observability** | Cloud Logging for all three services, Cloud Monitoring uptime checks and request metrics |
| **GCS Persistence** | Shared GCS Fuse volume for Qdrant vector indices and Ollama model weights across restarts |

---

## 2. Architecture

### Service Map

```
Internet
  │
  ▼ (HTTPS, ingress: all)
Cloud Run — n8n (port 5678)
  │  app: n8nai   cpu: 2000m   mem: 4Gi
  │  min: 0 instances (scale-to-zero)
  │
  ├──── Private Service Connect ────►  Cloud Run — Qdrant (port 6333)
  │     INGRESS_TRAFFIC_INTERNAL_ONLY   cpu: 1000m   mem: 1Gi
  │     QDRANT_URL injected into n8n    GCS Fuse: /mnt/gcs/qdrant
  │
  └──── Private Service Connect ────►  Cloud Run — Ollama (port 11434)
        INGRESS_TRAFFIC_INTERNAL_ONLY   cpu: 2000m   mem: 4Gi (inherits n8n limits)
        OLLAMA_HOST injected into n8n   GCS Fuse: /mnt/gcs/ollama/models
```

### Infrastructure

```
┌─────────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  VPC (Services_GCP)                                          │   │
│  │                                                              │   │
│  │  Cloud Run (gen2)                  Cloud SQL PostgreSQL 15   │   │
│  │  ├── n8n (public)    ◄──────────── DB: n8n_db / n8n_user     │   │
│  │  ├── Qdrant (internal)             (Auth Proxy via /cloudsql) │   │
│  │  └── Ollama (internal)                                       │   │
│  │                                                              │   │
│  │  NFS Filestore (Redis host)        GCS Bucket               │   │
│  │  redis on NFS_SERVER_IP:6379       ├── /home/node/.n8n       │   │
│  │                                    ├── /mnt/gcs/qdrant       │   │
│  └────────────────────────────────────└── /mnt/gcs/ollama/models┘   │
│                                                                     │
│  Secret Manager                       Cloud Monitoring             │
│  ├── N8N_ENCRYPTION_KEY (32 chars)    ├── uptime check (n8n URL)   │
│  └── N8N_SMTP_PASS                    └── request_count alerts     │
└─────────────────────────────────────────────────────────────────────┘

Module variable wiring:

  N8N_AI_CloudRun
    enable_ai_components = true  →  Qdrant + Ollama companion services
    enable_qdrant        = true  →  Cloud Run service, internal ingress
    enable_ollama        = true  →  Cloud Run service, internal ingress
    enable_redis         = true  →  queue mode, NFS_SERVER_IP auto-discovery
    enable_nfs           = true  →  Cloud Filestore for Redis + workflow data
    min_instance_count   = 0     →  scale-to-zero (set 1 for webhooks)
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` | Any | System package manager |
| `jq` | 1.6+ | `apt install jq` / `brew install jq` |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/secretmanager.admin
roles/logging.viewer
roles/monitoring.viewer
roles/iam.serviceAccountUser
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set run/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `N8N_AI_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `n8nai` | Base name for all resources |
| `application_version` | `2.4.7` | n8n version |
| `min_instance_count` | `0` | Scale-to-zero (set `1` to keep webhooks live) |
| `max_instance_count` | `1` | Increase only with Redis enabled |
| `cpu_limit` | `2000m` | Required for AI workloads |
| `memory_limit` | `4Gi` | Required for AI workloads |
| `enable_ai_components` | `true` | Deploys Qdrant + Ollama |
| `enable_qdrant` | `true` | Vector database |
| `enable_ollama` | `true` | Local LLM inference |
| `ollama_model` | `llama3.2` | Default model |
| `enable_redis` | `true` | Queue mode |
| `enable_nfs` | `true` | NFS for Redis + workflow data |

Click **Deploy** and wait for provisioning to complete (approximately 10–15 minutes).

> **What this provisions:** Three Cloud Run services (n8n public, Qdrant internal, Ollama
> internal), Cloud SQL PostgreSQL 15, NFS Filestore, GCS bucket for AI model and vector data
> persistence, Private Service Connect for internal service discovery, Secret Manager secrets
> for encryption key and SMTP password, Redis on NFS, and Cloud Monitoring uptime checks.

### 4.2 Configure Shell Environment

After deployment completes, set shell variables using gcloud discovery:

```bash
# Discover the n8n Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --filter="metadata.name~n8nai" \
  --format="value(metadata.name)" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "n8n AI URL: ${SERVICE_URL}"

# Get companion service URLs
export QDRANT_URL=$(gcloud run services describe "${SERVICE}-qdrant" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

export OLLAMA_URL=$(gcloud run services describe "${SERVICE}-ollama" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Qdrant (internal): ${QDRANT_URL}"
echo "Ollama (internal): ${OLLAMA_URL}"
```

---

## Exercise 1 — Access n8n AI and Initial Setup

### Objective

Retrieve the n8n service URL, verify all three Cloud Run services are healthy, and complete the initial account setup.

### Step 1.1 — Verify All Services Are Running

**gcloud:**
```bash
gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --filter="metadata.name~n8nai"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.services[] | select(.name | test("n8nai")) | {name: .name, state: .terminalCondition.state}'
```

**Expected result:** Three services listed — n8n (public), Qdrant (internal), Ollama (internal), all in `ACTIVE` state.

### Step 1.2 — Check Companion Service Ingress Settings

```bash
# Verify Qdrant and Ollama have internal-only ingress
gcloud run services describe "${SERVICE}-qdrant" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(spec.template.metadata.annotations['run.googleapis.com/ingress'])"

gcloud run services describe "${SERVICE}-ollama" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(spec.template.metadata.annotations['run.googleapis.com/ingress'])"
```

**Expected result:** Both return `internal` — confirming Qdrant and Ollama are not accessible from the public internet.

### Step 1.3 — Access n8n UI and Create Admin Account

Open your browser and navigate to `${SERVICE_URL}`.

> **Cold start note:** If `min_instance_count = 0`, the first request may take 15–30 seconds while the instance initialises and connects to Cloud SQL.

On first launch:
1. Complete the account setup wizard with your email address and a strong password
2. Select your usage preferences and click **Get started**
3. You are redirected to the n8n canvas — the main workflow editor

### Step 1.4 — Create a Simple Test Workflow

1. Click **+ New workflow**
2. Add a **Manual Trigger** node
3. Add an **HTTP Request** node and set URL to `https://httpbin.org/get`
4. Add a **Set** node: Name = `message`, Value = `Hello from n8n AI`
5. Click **Save** and then **Execute workflow**

**Expected result:** All nodes turn green with data flowing between them, confirming n8n is connected to the database and functional.

### Step 1.5 — Verify Environment Variable Injection

Check that the AI service URLs were injected automatically:

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env[] | select(.name == "QDRANT_URL" or .name == "OLLAMA_HOST")'
```

**Expected result:** Both `QDRANT_URL` and `OLLAMA_HOST` appear with their respective internal service URLs.

---

## Exercise 2 — Build an AI Workflow

### Objective

Build a working AI agent workflow using the n8n AI Agent node connected to the local Ollama LLM, demonstrating a complete prompt-chain from input to AI-generated output.

### Step 2.1 — Verify Ollama Service Health

**gcloud:**
```bash
gcloud run services describe "${SERVICE}-ollama" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.conditions)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}-ollama" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.terminalCondition'
```

**Expected result:** `state: ACTIVE` — Ollama is running and the model is loaded.

### Step 2.2 — Build the AI Agent Workflow

1. In n8n, click **+ New workflow** and name it `AI Agent Demo`
2. Add a **Manual Trigger** node
3. Add a **Set** node to inject a test question:
   - Name: `question`
   - Value: `What is Retrieval-Augmented Generation and why is it useful?`
4. Add an **AI Agent** node:
   - Click **Chat Model** input → select **Ollama Chat Model**
   - Set **Base URL** to `${OLLAMA_URL}` (the internal Ollama URL from Step 4.2)
   - Set **Model** to `llama3.2`
5. Set the AI Agent **System Prompt** to: `You are a helpful technical assistant. Answer questions clearly and concisely.`
6. Set the **User Prompt** to: `{{ $json.question }}`
7. Connect: Manual Trigger → Set → AI Agent
8. Click **Save** and **Execute workflow**

**Expected result:** The AI Agent node returns a text explanation of RAG generated by the local Ollama model. Response time on CPU is typically 10–60 seconds depending on question complexity.

### Step 2.3 — Inspect the Execution Data

After execution completes:
1. Click the AI Agent node to view its output panel
2. Examine the `output` field containing the LLM response
3. Note the execution time — this reflects local CPU-based inference latency

### Step 2.4 — Add a Prompt Chain (Two-Step Reasoning)

Extend the workflow with a second AI call to refine the answer:

1. Add a second **Set** node after the AI Agent:
   - Name: `followup`
   - Value: `Summarize the above in exactly two sentences: {{ $json.output }}`
2. Add a second **AI Agent** node with the same Ollama configuration
3. Set its prompt to: `{{ $json.followup }}`
4. Connect: AI Agent → Set → second AI Agent
5. **Save** and **Execute**

**Expected result:** The second AI Agent returns a two-sentence summary of the first response, demonstrating a prompt chain where the output of one LLM call feeds into the next.

---

## Exercise 3 — AI Memory and Context

### Objective

Configure the n8n AI Agent with a memory node to maintain conversation history across multiple messages within a session, demonstrating stateful AI interactions.

### Step 3.1 — Add a Memory Node to the AI Agent

1. Open the `AI Agent Demo` workflow from Exercise 2
2. Click the **+** on the **Memory** input port of the AI Agent node
3. Select **Window Buffer Memory**:
   - Set **Context Window Length** to `5` (retains last 5 message pairs)
   - Leave **Session ID** empty (uses a default session)
4. Click **Save**

### Step 3.2 — Test Conversation Context Retention

Execute the workflow multiple times with different questions to observe context retention:

First execution (set question to):
```
My name is Alex and I work on cloud infrastructure.
```

Second execution (set question to):
```
What did I tell you my name was?
```

**Expected result:** The second response correctly recalls "Alex", demonstrating that the Buffer Memory node retains conversation history across executions within the same session.

### Step 3.3 — Inspect Memory Storage

Memory is stored in the n8n PostgreSQL database. Verify via Cloud Logging that database interactions are occurring:

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"execution\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="value(timestamp, textPayload)"
```

### Step 3.4 — Configure Session-Based Memory

For webhook-based workflows where each user needs a separate memory context:

1. Change the **Session ID** in the Buffer Memory node to: `{{ $json.body.session_id }}`
2. This allows each calling client to maintain its own conversation history
3. **Save** the workflow

**Expected result:** Different `session_id` values in webhook payloads produce independent conversation contexts, enabling multi-user AI chat scenarios.

### Step 3.5 — View Conversation History in n8n

1. In the n8n UI, click the **Executions** icon (clock) on the workflow
2. Select a completed execution to view the full input/output for each node
3. Examine the memory node's output to see the conversation history object

---

## Exercise 4 — Webhooks and AI Triggers

### Objective

Configure a webhook endpoint that triggers an AI pipeline, then test it with curl to simulate external service calls to the n8n AI workflow.

### Step 4.1 — Create a Webhook-Triggered AI Workflow

1. Create a new workflow named `AI Webhook`
2. Add a **Webhook** node:
   - Method: `POST`
   - Path: `ask-ai`
   - Response Mode: `Last Node`
3. Add an **AI Agent** node with Ollama Chat Model (same configuration as Exercise 2)
4. Set the AI Agent prompt to: `Answer this question helpfully: {{ $json.body.question }}`
5. Add a **Respond to Webhook** node connected to the AI Agent output
6. Connect: Webhook → AI Agent → Respond to Webhook
7. Click **Save** and **Activate** the workflow

### Step 4.2 — Test the Webhook with curl

**Test query:**
```bash
curl -X POST "${SERVICE_URL}/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"question": "Explain vector embeddings in simple terms."}'
```

**REST API (with auth token for secured endpoints):**
```bash
curl -X POST "${SERVICE_URL}/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"question": "What are the benefits of serverless AI deployment?"}'
```

**Expected result:** A JSON response containing the Ollama-generated answer. Note that response time includes LLM inference time (10–60 seconds on CPU).

### Step 4.3 — Test Webhook with Streaming Context

Send a follow-up question in the same session:

```bash
curl -X POST "${SERVICE_URL}/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"question": "Give me a concrete example of what you just explained.", "session_id": "lab-session-1"}'
```

**Expected result:** The AI response references the previous answer if session memory is configured.

### Step 4.4 — Monitor Webhook Cold Start Behaviour

Check Cloud Run instance scaling during webhook calls:

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.observedGeneration)"

# View active instances
gcloud run revisions list \
  --service="${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(name, active, instanceSplits)"
```

> **Note:** With `min_instance_count = 0`, webhooks only fire while an instance is running.
> Set `min_instance_count = 1` in the RAD UI and redeploy to keep webhook endpoints always active.

### Step 4.5 — Schedule a Trigger

1. Create a new workflow with a **Schedule Trigger** (every 1 minute)
2. Add an **HTTP Request** node pointing to a health endpoint
3. **Save** and **Activate**
4. Wait 2 minutes and verify an execution appears in the Executions tab
5. **Deactivate** the workflow when confirmed

---

## Exercise 5 — Credential Management for AI

### Objective

Store API keys for external AI providers (OpenAI, Vertex AI) as n8n credentials and examine how the n8n encryption key protects them in Secret Manager and the PostgreSQL database.

### Step 5.1 — View Auto-Generated Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8nai" \
  --format="table(name, replication.automatic)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:n8nai" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name, createTime: .createTime}'
```

**Expected result:** Two secrets — the n8n encryption key (`*-encryption-key`) and SMTP password (`*-smtp-password`).

### Step 5.2 — Add an OpenAI Credential in n8n

1. In the n8n UI, navigate to **Settings → Credentials**
2. Click **Add Credential**
3. Search for and select **OpenAI**
4. Enter your OpenAI API key in the `API Key` field
5. Click **Save**

n8n encrypts the API key using `N8N_ENCRYPTION_KEY` before writing it to PostgreSQL. The plaintext key never appears in logs or the database.

### Step 5.3 — Add a Vertex AI Credential

1. In **Settings → Credentials**, click **Add Credential**
2. Search for **Google Vertex AI** and select it
3. Choose **Service Account** authentication
4. Paste your Google service account JSON key
5. Click **Save**

### Step 5.4 — Use a Credential in a Workflow

1. Open the `AI Agent Demo` workflow
2. Add a second AI Agent node that uses the OpenAI credential instead of Ollama
3. Set the Chat Model to **OpenAI Chat Model**
4. Select your saved OpenAI credential
5. Connect it in parallel to compare responses

### Step 5.5 — Inspect Credential Encryption

Verify the credential is stored encrypted in the database by checking that the Secret Manager encryption key is referenced:

```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env[] | select(.name == "N8N_ENCRYPTION_KEY")'
```

**Expected result:** The `N8N_ENCRYPTION_KEY` is loaded from a Secret Manager reference (`valueSource.secretKeyRef`), not stored as plaintext in the container spec.

---

## Exercise 6 — Vector Store Integration

### Objective

Use the Qdrant vector database companion service to build a document ingestion and semantic search pipeline, then extend it into a full RAG (Retrieval-Augmented Generation) pattern.

### Step 6.1 — Verify Qdrant Service Health

**gcloud:**
```bash
gcloud run services describe "${SERVICE}-qdrant" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.conditions)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}-qdrant" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{state: .terminalCondition.state, url: .uri}'
```

**Expected result:** `state: ACTIVE`. Note that direct HTTP access to Qdrant from outside the VPC is blocked — it is accessible only from within the VPC (i.e., from the n8n Cloud Run service).

### Step 6.2 — Create a Document Ingestion Workflow

1. Create a new workflow named `RAG — Ingest`
2. Add a **Webhook** node: Path = `store-document`, Method = `POST`
3. Add an **Embeddings Ollama** node:
   - Base URL: `${OLLAMA_URL}` (internal Ollama URL)
   - Model: `nomic-embed-text` or `llama3.2`
4. Add a **Qdrant Vector Store** node (operation: **Insert**):
   - Qdrant URL: `${QDRANT_URL}` (internal Qdrant URL)
   - Collection Name: `documents`
5. Connect: Webhook → Embeddings Ollama → Qdrant Vector Store
6. **Save** and **Activate**

### Step 6.3 — Ingest Sample Documents

```bash
curl -X POST "${SERVICE_URL}/webhook/store-document" \
  -H "Content-Type: application/json" \
  -d '{"text": "Cloud Run is a managed serverless platform on Google Cloud that automatically scales containers from zero to thousands of instances.", "id": "doc-001"}'

curl -X POST "${SERVICE_URL}/webhook/store-document" \
  -H "Content-Type: application/json" \
  -d '{"text": "Qdrant is a vector database built for high-performance similarity search with support for filtering and payload storage.", "id": "doc-002"}'

curl -X POST "${SERVICE_URL}/webhook/store-document" \
  -H "Content-Type: application/json" \
  -d '{"text": "Private Service Connect allows Cloud Run services to communicate securely over internal IP addresses within a VPC without traffic traversing the public internet.", "id": "doc-003"}'
```

**Expected result:** Each webhook call returns a success response. Documents are embedded by Ollama and stored in Qdrant on the shared GCS Fuse volume.

### Step 6.4 — Create a Similarity Search Workflow

1. Create a new workflow named `RAG — Search`
2. Add a **Webhook** node: Path = `search-documents`, Method = `POST`
3. Add an **Embeddings Ollama** node (same configuration as ingestion)
4. Add a **Qdrant Vector Store** node (operation: **Search**):
   - Same Qdrant URL and collection
   - Limit: `3`
5. **Save** and **Activate**

```bash
curl -X POST "${SERVICE_URL}/webhook/search-documents" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is a serverless container platform?"}'
```

**Expected result:** The Cloud Run document (`doc-001`) ranks as the most similar result.

### Step 6.5 — Build a Full RAG Pipeline

Extend the search workflow to generate a grounded LLM answer:

1. After the Qdrant search results, add a **Code** node:
   ```javascript
   const query = $('Webhook').first().json.body.query;
   const docs = $input.all().map(d => d.json.payload.text).join('\n\n');
   return [{
     json: {
       prompt: `Context:\n${docs}\n\nQuestion: ${query}\n\nAnswer based only on the context above:`
     }
   }];
   ```
2. Add an **AI Agent** node with Ollama Chat Model
3. Set the prompt to: `{{ $json.prompt }}`
4. Add **Respond to Webhook**
5. **Save** and **Activate**

```bash
curl -X POST "${SERVICE_URL}/webhook/search-documents" \
  -H "Content-Type: application/json" \
  -d '{"query": "How does Cloud Run handle networking with other services?"}'
```

**Expected result:** A grounded answer referencing Private Service Connect and VPC connectivity, sourced from the ingested documents rather than the model's training data.

---

## Exercise 7 — Cloud Logging

### Objective

View and analyse logs for all three Cloud Run services (n8n, Qdrant, Ollama) using Cloud Logging to understand AI workflow execution patterns and diagnose issues.

### Step 7.1 — View n8n Application Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="value(timestamp, textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp: .timestamp, message: .textPayload}'
```

**Expected result:** Log entries showing n8n startup, workflow executions, and database connection events.

### Step 7.2 — View Ollama Inference Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}-ollama\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="value(timestamp, textPayload)"
```

**Expected result:** Ollama startup logs showing model load progress and inference server ready messages. Inference request logs appear after running AI Agent workflows.

### Step 7.3 — View Qdrant Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}-qdrant\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="value(timestamp, textPayload)"
```

**Expected result:** Qdrant startup confirmation showing the vector database is listening on port 6333 and ready for insert/search operations.

### Step 7.4 — Stream Live Logs

```bash
# Stream n8n logs in real time (trigger a workflow while watching)
gcloud alpha run services logs tail "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}"
```

Trigger a workflow execution while streaming to observe real-time log output.

### Step 7.5 — Open Cloud Logging Console

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%20AND%20resource.labels.service_name%3D%22${SERVICE}%22?project=${PROJECT}"
```

Explore log severity filters, log-based metrics, and the ability to create alerts from log patterns.

---

## Exercise 8 — Cloud Monitoring

### Objective

Inspect request metrics, instance scaling behaviour, and inference latency for all three Cloud Run services using Cloud Monitoring, and verify the automated uptime check.

### Step 8.1 — View Request Count Metrics

**gcloud:**
```bash
# List n8nai-related Cloud Run metrics
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com" \
  --project="${PROJECT}" \
  | grep -E "request_count|request_latencies|instance_count"
```

**REST API (request count for n8n service):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

### Step 8.2 — View Ollama Inference Latency

Ollama inference requests are significantly slower than typical web requests (10–60 seconds on CPU). Monitor latency separately:

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_latencies | filter resource.service_name = '${SERVICE}-ollama' | within 1h | group_by [], percentile(val(), 99)\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**Expected result:** P99 latency for Ollama will be in the seconds-to-minutes range for LLM inference on CPU. GPU instances dramatically reduce this.

### Step 8.3 — Check Instance Scaling

```bash
# View instance count over time
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/container/instance_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], max(val())\"
  }" | jq '.timeSeriesData[].pointData[] | {time: .timeInterval.endTime, instances: .values[0].int64Value}'
```

**Expected result:** Instance count rises from 0 to 1 when requests arrive and drops back to 0 after the idle timeout (with `min_instance_count = 0`).

### Step 8.4 — View Uptime Check Status

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {displayName, httpCheck: .httpCheck.path, period: .period}'
```

**Expected result:** An uptime check for the n8n service URL showing `Healthy` with a 60-second check interval.

### Step 8.5 — Open the Monitoring Console

```bash
echo "https://console.cloud.google.com/monitoring/dashboards?project=${PROJECT}"
```

Navigate to **Metrics Explorer** and create a custom chart comparing request counts across all three services (n8n, Qdrant, Ollama) to visualise the relative request volumes during AI workflow execution.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `N8N_AI_CloudRun` deployment. This removes all three Cloud Run services, Cloud SQL instance, NFS Filestore, GCS bucket, Private Service Connect resources, secrets, and IAM bindings.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete Cloud Run services
for svc in "${SERVICE}" "${SERVICE}-qdrant" "${SERVICE}-ollama"; do
  gcloud run services delete "${svc}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --quiet
done

# Delete secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8nai" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} \
    --project="${PROJECT}" --quiet
```

**REST API — delete a Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

> **Note:** If `enable_purge = false` was set, some resources are retained. Resources
> provisioned by the `Services_GCP` module (VPC, GKE cluster) are managed separately.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `n8nai` | Base name for all Cloud Run services and resources |
| `application_version` | string | `2.4.7` | n8n container image version |
| `cpu_limit` | string | `2000m` | CPU limit per n8n container (also used by Ollama) |
| `memory_limit` | string | `4Gi` | Memory limit per n8n container (also used by Ollama) |
| `min_instance_count` | number | `0` | Minimum instances (0 = scale-to-zero) |
| `max_instance_count` | number | `1` | Maximum instances (increase only with Redis enabled) |
| `enable_ai_components` | bool | `true` | Master toggle for Qdrant + Ollama companion services |
| `enable_qdrant` | bool | `true` | Deploy Qdrant as internal Cloud Run service |
| `qdrant_version` | string | `latest` | Qdrant Docker image tag |
| `enable_ollama` | bool | `true` | Deploy Ollama as internal Cloud Run service |
| `ollama_version` | string | `latest` | Ollama Docker image tag |
| `ollama_model` | string | `llama3.2` | Default LLM model for Ollama |
| `enable_redis` | bool | `true` | Enable Redis queue mode for n8n |
| `redis_host` | string | `""` | Redis host (auto-discovered from NFS when empty) |
| `enable_nfs` | bool | `true` | Provision Cloud Filestore NFS |
| `db_name` | string | `n8n_db` | PostgreSQL database name |
| `db_user` | string | `n8n_user` | PostgreSQL application user |
| `ingress_settings` | string | `all` | Cloud Run ingress (`all` required for public webhooks) |

### Useful Commands

```bash
# List all n8n AI Cloud Run services
gcloud run services list --project="${PROJECT}" --region="${REGION}" --filter="metadata.name~n8nai"

# Get n8n service URL
gcloud run services describe "${SERVICE}" --project="${PROJECT}" --region="${REGION}" --format="value(status.url)"

# View n8n logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" --project="${PROJECT}" --limit=50

# View Ollama logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}-ollama" --project="${PROJECT}" --limit=30

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~n8nai"

# Check uptime monitors
gcloud monitoring uptime list-configs --project="${PROJECT}"

# View Cloud Run revisions
gcloud run revisions list --service="${SERVICE}" --project="${PROJECT}" --region="${REGION}"
```

### Further Reading

- [n8n documentation](https://docs.n8n.io/)
- [n8n AI Starter Kit](https://n8n.io/blog/ai-starter-kit/)
- [Qdrant documentation](https://qdrant.tech/documentation/)
- [Ollama model library](https://ollama.com/library)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Private Service Connect for Cloud Run](https://cloud.google.com/run/docs/securing/private-networking)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [n8n AI Agent node reference](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/)
