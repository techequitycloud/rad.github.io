---
title: "Ollama on Cloud Run — Lab Guide"
sidebar_label: "Ollama CloudRun"
---

# Ollama on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_CloudRun)**

Ollama is an open-source LLM inference server that runs large language models — Llama, Mistral,
Gemma, Phi, and others — via a REST API. It is OpenAI API-compatible, making it a drop-in
replacement for any application that already integrates with the OpenAI SDK. This lab deploys
Ollama on Google Cloud Run (gen2) with model weights persisted to a GCS bucket via GCS Fuse.
You will pull models, generate text, use the chat completions API, manage models, and monitor
resource utilisation.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Ollama API](#exercise-1--access-ollama-api)
6. [Exercise 2 — Pull and List Models](#exercise-2--pull-and-list-models)
7. [Exercise 3 — Generate Text](#exercise-3--generate-text)
8. [Exercise 4 — OpenAI-Compatible Chat API](#exercise-4--openai-compatible-chat-api)
9. [Exercise 5 — Model Management](#exercise-5--model-management)
10. [Exercise 6 — Performance and Scaling](#exercise-6--performance-and-scaling)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Ollama?

Ollama is a **standalone LLM inference server** that downloads, manages, and serves open-source
large language models through a clean REST API on port 11434. It supports streaming responses,
multi-turn conversations, and an OpenAI-compatible `/v1/` endpoint. The `Ollama_CloudRun`
module deploys Ollama on Cloud Run gen2 with GCS Fuse model storage so model weights persist
across instance restarts.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **API Access** | Service URL discovery, VPC proxy, health check |
| **Model Pull** | Download models from Ollama Hub to GCS storage |
| **Text Generation** | `POST /api/generate` with streaming and non-streaming modes |
| **Chat Completions** | OpenAI-compatible `/v1/chat/completions` endpoint |
| **Model Management** | List, inspect, copy, and delete models |
| **GCS Persistence** | Models survive Cloud Run instance restarts via GCS Fuse |
| **Cloud Logging** | Inference logs, model load events, request timing |
| **Cloud Monitoring** | CPU/memory during inference, request latency |

---

## 2. Architecture

```
VPC (internal) / Public internet (if ingress_settings=all)
       │
       ▼ HTTPS (Cloud Run ingress)
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Run (gen2)                                                │
│  ollama service — Ollama binary                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Ollama container                                          │  │
│  │  PORT: 11434                                               │  │
│  │  OLLAMA_MODELS = /mnt/gcs/ollama/models (GCS Fuse)        │   │
│  │  OLLAMA_HOST   = 0.0.0.0:11434                            │   │
│  │  OLLAMA_KEEP_ALIVE = 24h                                   │  │
│  │                                                            │  │
│  │  GCS Fuse mount → /mnt/gcs/ → <prefix>-models GCS bucket  │   │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  No database, no Cloud SQL, no secrets required                  │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────────────┐
│  GCS Bucket: <prefix>-models                   │
│  └── ollama/models/                            │
│      ├── manifests/<model-name>                │
│      └── blobs/<sha256>  ← model weights       │
│                                                │
│  Persists across Cloud Run instance restarts   │
│  Supports multiple model families              │
└────────────────────────────────────────────────┘

Networking:
  ingress_settings = internal (default) → VPC access only
  Use: gcloud run services proxy ${SERVICE} --port 11434
  Or set ingress_settings = all for public access (add auth)
```

Module variable wiring:

```
Ollama_CloudRun
  application_name    = "ollama"
  cpu_limit           = "4000m"     → 3B models: 4 vCPU; 7B: 8 vCPU
  memory_limit        = "8Gi"       → 3B models: 8Gi; 7B: 16Gi
  min_instance_count  = 1           → keep warm for low-latency
  max_instance_count  = 1           → single model server
  timeout_seconds     = 3600        → long requests for inference
  ingress_settings    = internal    → VPC-only access by default
  OLLAMA_MODELS       = /mnt/gcs/ollama/models
  OLLAMA_KEEP_ALIVE   = 24h
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` | Any | System package manager |
| `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/storage.admin
roles/logging.viewer
roles/monitoring.viewer
```

### Resource Requirements

| Model Size | Minimum CPU | Minimum Memory |
|---|---|---|
| 1B–3B (e.g., `llama3.2:1b`, `phi3.5`) | `4000m` | `8Gi` |
| 7B (e.g., `llama3.2`, `mistral`) | `8000m` | `16Gi` |
| 13B+ | Not recommended for CPU-only Cloud Run | — |

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"   # your GCP project ID
export REGION="us-central1"             # region you deployed into
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Ollama_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `ollama` | Base resource name |
| `cpu_limit` | `4000m` | For 3B model; use `8000m` for 7B |
| `memory_limit` | `8Gi` | For 3B model; use `16Gi` for 7B |
| `min_instance_count` | `1` | Keep warm to avoid model reload |
| `timeout_seconds` | `3600` | Long requests for inference |
| `default_model` | `gemma2:2b` | Optional — pre-pull a model |

Click **Deploy** and wait for provisioning (approximately 10–40 minutes, longer if
`default_model` is set — model pull can take 5–30 minutes).

> **What this provisions:** Cloud Run service (gen2), GCS bucket for model weights (mounted
> via GCS Fuse), Artifact Registry image mirroring, VPC Direct Egress configuration, and
> Cloud Monitoring uptime check. No Cloud SQL, no Secret Manager secrets.

### 4.2 Configure Shell Environment

```bash
# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~ollama" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Service: ${SERVICE}"
echo "URL: ${SERVICE_URL}"

# Discover the models GCS bucket
export MODELS_BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~ollama.*models OR name~appollama.*models" \
  --format="value(name)" \
  | head -1)

echo "Models bucket: gs://${MODELS_BUCKET}/"
```

---

## Exercise 1 — Access Ollama API

### Objective

Get the service URL, establish access via the Cloud Run proxy (since ingress is internal by
default), and verify the Ollama server is running.

### Step 1.1 — Verify the Service Is Running

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions[0].type, status.conditions[0].status)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{url: .uri, ready: .terminalCondition.state}'
```

**Expected result:** Service URL shown with condition `Ready: True`.

### Step 1.2 — Set Up the Cloud Run Proxy

Since `ingress_settings = internal` by default, use the Cloud Run proxy to access Ollama:

```bash
# Run this in a separate terminal — leave it running
gcloud run services proxy "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --port=11434
```

**Expected result:** `Proxying to [HTTPS] on port 11434`

All subsequent `curl http://localhost:11434/...` commands use this proxy.

> If `ingress_settings = all` was set during deployment, call the service URL directly with
> identity token auth:
> ```bash
> curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${SERVICE_URL}"
> ```

### Step 1.3 — Verify Ollama Is Running

```bash
curl http://localhost:11434
```

**Expected result:** `Ollama is running`

### Step 1.4 — Check the API Health

```bash
curl -s http://localhost:11434/api/tags | jq '{model_count: (.models | length)}'
```

**Expected result:** JSON with `model_count` (may be 0 if no models pulled yet, or > 0 if
`default_model` was set during deployment).

### Step 1.5 — List Cloud Run Revisions

**gcloud:**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].type, createTime)"
```

---

## Exercise 2 — Pull and List Models

### Objective

Pull a small model into the GCS-backed model store, verify the download, and list available
models.

### Step 2.1 — Check the Models Bucket

```bash
gcloud storage ls "gs://${MODELS_BUCKET}/"
```

**Expected result:** Empty bucket (if no `default_model` was set) or directories for the
pre-pulled model.

### Step 2.2 — Pull a Small Model

Pull `gemma2:2b` (~1.6 GB, runs well on CPU):

```bash
curl -s -X POST http://localhost:11434/api/pull \
  -H "Content-Type: application/json" \
  -d '{"name": "gemma2:2b"}'
```

**Expected result:** Streaming JSON response showing download progress:
```json
{"status":"pulling manifest"}
{"status":"pulling ...","completed":...,"total":...}
{"status":"verifying sha256 digest"}
{"status":"writing manifest"}
{"status":"success"}
```

> Model download to GCS Fuse can take 3–10 minutes depending on network speed.

### Step 2.3 — List Installed Models

```bash
curl -s http://localhost:11434/api/tags \
  | jq '.models[] | {name: .name, size: (.size | tostring + " bytes"), modified: .modified_at}'
```

**Expected result:** `gemma2:2b` listed with its size and modification timestamp.

### Step 2.4 — Verify Models Are in GCS

```bash
gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/"
```

```bash
gcloud storage du "gs://${MODELS_BUCKET}/" --summarize
```

**Expected result:** `blobs/` and `manifests/` directories containing the downloaded model
weights. Total size approximately 1.6 GB for `gemma2:2b`.

### Step 2.5 — Pull a Second Model (Optional)

```bash
curl -s -X POST http://localhost:11434/api/pull \
  -H "Content-Type: application/json" \
  -d '{"name": "phi3.5"}'
```

> `phi3.5` is Microsoft's small 3.8B model (~2.2 GB) with strong reasoning capabilities.

---

## Exercise 3 — Generate Text

### Objective

Use the `POST /api/generate` endpoint to generate text with both streaming and non-streaming
response modes.

### Step 3.1 — Non-Streaming Text Generation

```bash
curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "prompt": "Explain Kubernetes in one paragraph.",
    "stream": false
  }' | jq '{response: .response, eval_count: .eval_count, total_duration: .total_duration}'
```

**Expected result:** JSON with `response` containing the generated text, `eval_count`
(tokens generated), and `total_duration` (nanoseconds).

### Step 3.2 — Streaming Text Generation

```bash
curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "prompt": "What are the three main GCP compute services?",
    "stream": true
  }'
```

**Expected result:** A stream of JSON objects, each containing a `response` token. The final
object has `"done": true` and includes timing statistics.

### Step 3.3 — Generate with a System Prompt

```bash
curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "system": "You are a concise technical assistant. Answer in bullet points.",
    "prompt": "What is Cloud Run?",
    "stream": false
  }' | jq '.response'
```

**Expected result:** A bullet-point answer about Cloud Run.

### Step 3.4 — Generate with Options

```bash
curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "prompt": "Name 5 programming languages.",
    "stream": false,
    "options": {
      "temperature": 0.1,
      "num_predict": 50
    }
  }' | jq '.response'
```

**Expected result:** A deterministic short response limited to 50 tokens.

### Step 3.5 — Inspect Generation Metrics

```bash
curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "gemma2:2b", "prompt": "Hi", "stream": false}' \
  | jq '{
    tokens_generated: .eval_count,
    tokens_per_second: (.eval_count / (.eval_duration / 1e9)),
    total_seconds: (.total_duration / 1e9)
  }'
```

**Expected result:** Tokens-per-second metric showing CPU inference speed (typically 2–8 tok/s on CPU).

---

## Exercise 4 — OpenAI-Compatible Chat API

### Objective

Use the `POST /v1/chat/completions` endpoint — compatible with any OpenAI SDK client.

### Step 4.1 — Single-Turn Chat Completion

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "messages": [
      {"role": "user", "content": "What is GCP?"}
    ]
  }' | jq '.choices[0].message.content'
```

**Expected result:** A text response about Google Cloud Platform in the `content` field.

### Step 4.2 — Multi-Turn Conversation

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "messages": [
      {"role": "user", "content": "My name is Alex and I work in GCP."},
      {"role": "assistant", "content": "Hello Alex! Great to know you work with GCP. How can I help?"},
      {"role": "user", "content": "What is my name and where do I work?"}
    ]
  }' | jq '.choices[0].message.content'
```

**Expected result:** The model correctly recalls `Alex` and `GCP` from the conversation context.

### Step 4.3 — Streaming Chat Completions

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "messages": [{"role": "user", "content": "List 3 benefits of serverless computing."}],
    "stream": true
  }'
```

**Expected result:** A stream of `data:` prefixed JSON chunks in SSE format, compatible with
any OpenAI SDK client (Python `openai`, TypeScript `openai`, LangChain, etc.).

### Step 4.4 — Test OpenAI SDK Compatibility

```bash
# Using Python openai library (requires pip install openai)
python3 -c "
from openai import OpenAI

client = OpenAI(
    base_url='http://localhost:11434/v1',
    api_key='ollama'  # Ollama does not require a real key
)

response = client.chat.completions.create(
    model='gemma2:2b',
    messages=[{'role': 'user', 'content': 'Say hello in three languages.'}]
)
print(response.choices[0].message.content)
"
```

**Expected result:** A greeting in three languages — confirms OpenAI SDK drop-in compatibility.

### Step 4.5 — List OpenAI-Compatible Models

```bash
curl -s http://localhost:11434/v1/models | jq '.data[].id'
```

**Expected result:** List of installed model names in OpenAI format.

---

## Exercise 5 — Model Management

### Objective

Inspect running models, view metadata, copy a model to create a custom variant, and delete
unused models.

### Step 5.1 — List Running Models

```bash
curl -s http://localhost:11434/api/ps \
  | jq '.models[] | {name: .name, size_vram: .size_vram, expires_at: .expires_at}'
```

**Expected result:** Models currently loaded in memory with expiry time (24h by default due
to `OLLAMA_KEEP_ALIVE=24h`).

### Step 5.2 — View Model Information

```bash
curl -s http://localhost:11434/api/show \
  -H "Content-Type: application/json" \
  -d '{"name": "gemma2:2b"}' \
  | jq '{
    family: .details.family,
    params: .details.parameter_size,
    quantization: .details.quantization_level,
    format: .details.format
  }'
```

**Expected result:** Model metadata showing parameter size, quantization level, and format.

### Step 5.3 — Copy a Model

```bash
curl -s -X POST http://localhost:11434/api/copy \
  -H "Content-Type: application/json" \
  -d '{"source": "gemma2:2b", "destination": "gemma2-lab"}'
```

Verify the copy:
```bash
curl -s http://localhost:11434/api/tags \
  | jq '.models[].name'
```

**Expected result:** Both `gemma2:2b` and `gemma2-lab` are listed.

### Step 5.4 — Inspect GCS After Copy

```bash
gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/manifests/"
```

**Expected result:** Manifest entries for both `gemma2:2b` and `gemma2-lab`. Note that
blobs are shared (content-addressed), so the copy adds only a new manifest.

### Step 5.5 — Delete the Copied Model

```bash
curl -s -X DELETE http://localhost:11434/api/delete \
  -H "Content-Type: application/json" \
  -d '{"name": "gemma2-lab"}'

# Verify deletion
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

**Expected result:** `gemma2-lab` is no longer listed; `gemma2:2b` remains.

---

## Exercise 6 — Performance and Scaling

### Objective

Test response times, verify model persistence across Cloud Run instance restarts, and
understand the scaling model.

### Step 6.1 — Measure Inference Response Time

```bash
time curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "gemma2:2b", "prompt": "What is 2+2?", "stream": false}' \
  | jq '.total_duration / 1e9'
```

**Expected result:** Total time in seconds. First call may be slightly slower (model warming);
subsequent calls use cached model weights.

### Step 6.2 — Concurrent Requests

```bash
# Send 3 concurrent requests
for i in 1 2 3; do
  curl -s http://localhost:11434/api/generate \
    -H "Content-Type: application/json" \
    -d '{"model": "gemma2:2b", "prompt": "Count to '"${i}"'", "stream": false}' \
    | jq '.response' &
done
wait
```

**Expected result:** All three responses complete (Ollama queues requests and processes them
sequentially on CPU).

### Step 6.3 — Test Model Persistence Across Restart

Deploy a new Cloud Run revision to simulate an instance restart:

```bash
gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --update-labels="lab-restart=$(date +%s)"
```

Wait for the new revision to be ready:
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --limit=3
```

Re-establish the proxy and verify models are still available:
```bash
gcloud run services proxy "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --port=11434 &

sleep 5
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

**Expected result:** `gemma2:2b` is still listed — model persisted in GCS Fuse across the
instance restart.

### Step 6.4 — View Instance Count

```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.observedGeneration)"
```

**gcloud (list revisions and traffic):**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].status, spec.containerConcurrency)"
```

---

## Exercise 7 — Cloud Logging

### Objective

View Ollama server logs in Cloud Logging and identify model load events and inference timing.

### Step 7.1 — View Logs in Cloud Logging Console

Navigate to:
```
https://console.cloud.google.com/logs/query?project=${PROJECT}
```

Filter for Ollama Cloud Run logs:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

Look for log entries showing:
- Server startup: `Listening on [::]:11434`
- Model loading: `llm_load_print_meta` (printed when a model loads into memory)
- Inference requests: timing and token counts
- GCS Fuse activity

### Step 7.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "orderBy": "timestamp desc",
    "pageSize": 30
  }' | jq '.entries[] | {timestamp, text: .textPayload}'
```

### Step 7.3 — Filter for Model Load Events

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"llm_load"' \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** Log entries showing model metadata printed during model load (layers,
context window size, quantization).

### Step 7.4 — Stream Live Logs During Inference

In one terminal, stream logs:
```bash
gcloud alpha run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

In another terminal, send an inference request:
```bash
curl http://localhost:11434/api/generate \
  -d '{"model": "gemma2:2b", "prompt": "Hello Ollama!", "stream": false}'
```

**Expected result:** Log entries appear in real time as the inference executes.

### Step 7.5 — Filter for Error Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND severity>=WARNING' \
  --project="${PROJECT}" \
  --limit=10
```

---

## Exercise 8 — Cloud Monitoring

### Objective

Inspect Cloud Run resource utilization metrics during LLM inference and verify the uptime check.

### Step 8.1 — Open Cloud Monitoring

Navigate to:
```
https://console.cloud.google.com/monitoring?project=${PROJECT}
```

### Step 8.2 — Explore CPU Metrics During Inference

In **Metrics Explorer**, query:
- Metric: `run.googleapis.com/container/cpu/utilizations`
- Filter: `resource.service_name = ${SERVICE}`

Send several inference requests while monitoring:
```bash
for i in 1 2 3; do
  curl -s http://localhost:11434/api/generate \
    -d '{"model": "gemma2:2b", "prompt": "List GCP regions", "stream": false}' &
done
wait
```

**Expected result:** CPU utilization chart shows spikes during inference (typically 80–100%
for CPU-only inference on a single vCPU) returning to low baseline when idle.

### Step 8.3 — Monitor Memory Utilization

Query memory metrics (critical for LLM inference — model weights stay in RAM):
- Metric: `run.googleapis.com/container/memory/utilizations`

**Expected result:** Memory stays elevated while the model is loaded (Ollama `KEEP_ALIVE=24h`
keeps the model in memory). For `gemma2:2b` on 8Gi, expect 30–50% memory utilization.

### Step 8.4 — View Request Latency

```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch cloud_run_revision | metric run.googleapis.com/request_latencies | filter resource.service_name = \"'"${SERVICE}"'\" | every 1m | within 1h | group_by [], percentile(val(), 95)"
  }' | jq '.timeSeriesData[].pointData[-1].values[0].distributionValue'
```

**Expected result:** P95 request latency value. LLM inference requests are much longer than
typical web requests (seconds, not milliseconds).

### Step 8.5 — Check the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {name: .displayName, host: .httpCheck.path}'
```

**Expected result:** An uptime check monitoring the Ollama service endpoint.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Ollama_CloudRun` deployment. This removes
the Cloud Run service, GCS models bucket (`enable_purge = true` by default — model weights
are deleted), Artifact Registry image, and Cloud Monitoring resources.

> **Note:** Undeploying with `enable_purge = true` deletes all downloaded model weights from
> the GCS bucket. Re-downloading models after re-deployment will be required.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --quiet

# Delete GCS models bucket (deletes all model weights)
gcloud storage rm -r "gs://${MODELS_BUCKET}/"
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region |
| `application_name` | string | `ollama` | Base resource name |
| `application_version` | string | `latest` | Ollama image tag |
| `cpu_limit` | string | `4000m` | 3B models: 4000m; 7B models: 8000m |
| `memory_limit` | string | `8Gi` | 3B models: 8Gi; 7B models: 16Gi |
| `min_instance_count` | number | `1` | Keep warm for low-latency inference |
| `max_instance_count` | number | `1` | Single inference server |
| `timeout_seconds` | number | `3600` | Max request duration for long inference |
| `ingress_settings` | string | `internal` | `internal`, `all`, or `internal-and-cloud-load-balancing` |
| `execution_environment` | string | `gen2` | Must be gen2 for GCS Fuse |
| `default_model` | string | `""` | Model to pre-pull on first deployment |
| `model_pull_timeout_seconds` | number | `3600` | Timeout for model pull job |
| `create_cloud_storage` | bool | `true` | Provision GCS models bucket |

### Key Environment Variables (Auto-Injected)

| Variable | Value | Purpose |
|---|---|---|
| `OLLAMA_MODELS` | `/mnt/gcs/ollama/models` | GCS Fuse model directory |
| `OLLAMA_HOST` | `0.0.0.0:11434` | Bind to all interfaces |
| `OLLAMA_KEEP_ALIVE` | `24h` | Keep loaded model in memory |

### Useful Commands

```bash
# Set up local proxy (internal ingress)
gcloud run services proxy "${SERVICE}" --region="${REGION}" --port=11434

# Check Ollama is running
curl http://localhost:11434

# List installed models
curl http://localhost:11434/api/tags | jq '.models[].name'

# Pull a model
curl -X POST http://localhost:11434/api/pull -d '{"name": "gemma2:2b"}'

# Generate text
curl http://localhost:11434/api/generate \
  -d '{"model": "gemma2:2b", "prompt": "Hello!", "stream": false}'

# OpenAI-compatible chat
curl http://localhost:11434/v1/chat/completions \
  -d '{"model": "gemma2:2b", "messages": [{"role": "user", "content": "Hi!"}]}'

# List running models
curl http://localhost:11434/api/ps

# View Cloud Run logs
gcloud logging read 'resource.type="cloud_run_revision"' \
  --project="${PROJECT}" --limit=30 --format="table(timestamp,textPayload)"

# Check GCS bucket size
gcloud storage du "gs://${MODELS_BUCKET}/" --summarize
```

### Model Reference

| Model | Size | Parameters | Best For |
|---|---|---|---|
| `gemma2:2b` | ~1.6 GB | 2B | Quick tests, Q&A |
| `phi3.5` | ~2.2 GB | 3.8B | Reasoning, coding |
| `llama3.2:3b` | ~2.0 GB | 3B | General purpose |
| `mistral` | ~4.1 GB | 7B | High quality responses |
| `llama3.2` | ~4.7 GB | 7B | State-of-the-art open model |

### Further Reading

- [Ollama REST API reference](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [Ollama model library](https://ollama.com/library)
- [Cloud Run gen2 execution environment](https://cloud.google.com/run/docs/about-execution-environments)
- [GCS Fuse for Cloud Run](https://cloud.google.com/run/docs/tutorials/network-filesystems-fuse)
- [OpenAI API compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md)
