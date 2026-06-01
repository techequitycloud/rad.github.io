---
title: "Ollama on Cloud Run — Lab Guide"
sidebar_label: "Ollama CloudRun"
---

# Ollama on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Ollama is a standalone open-source LLM inference server that runs large language models (Llama, Mistral, Gemma, Phi, and others) via a REST API on port 11434. This lab deploys Ollama on Cloud Run (gen2) with model weights persisted to a GCS bucket via GCS Fuse. No database is required. The service is deployed with `ingress_settings = internal` by default — it is accessible from other services in the same VPC but not from the public internet, making it a shared AI inference endpoint for Flowise, N8N, Django, and other applications.

### What the Module Automates

- Cloud Run v2 service (gen2 execution environment for GCS Fuse support)
- GCS bucket for model weight storage (mounted via GCS Fuse)
- Artifact Registry repository and image mirroring
- VPC Direct Egress configuration
- Secret Manager integration
- Cloud Monitoring uptime checks and notification channels
- Optional model-pull initialization Cloud Run Job (when `default_model` is set)

### What You Do Manually

- Note the service URL from the RAD UI deployment panel
- Access the Ollama API (via Cloud Run invoker authentication or VPC)
- List available models
- Pull and run a model
- Use the chat completion API
- Explore model management
- Verify GCS model storage persistence
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

This lab uses two sets of tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Interact with GCP services (Cloud Run, GCS, logs) |
| `curl` | Call the Ollama REST API (port 11434) |

**Note:** Ollama is deployed with `ingress_settings = internal` by default. It is intended as a shared LLM backend accessible within the VPC, not directly from the internet. To call the API from your local machine, use `gcloud run services proxy` or temporarily set `ingress_settings = all` during testing.

**API Base URL Pattern:**
- `service_url` — the Cloud Run HTTPS URL
- `ollama_api_url` — `<service_url>/api` — use this for Ollama-native endpoints
- Append `/api/generate`, `/api/chat`, `/api/tags`, `/api/pull` etc. to the base URL

---

## Prerequisites

- GCP project with billing enabled
- `Services GCP` module deployed (provides VPC and Artifact Registry)
- `gcloud` CLI authenticated (`gcloud auth application-default login`)
- Access to the RAD UI with permission to deploy modules in the target GCP project
- Sufficient Cloud Run quotas: 3B models need `cpu_limit=4000m, memory_limit=8Gi`; 7B models need `cpu_limit=8000m, memory_limit=16Gi`

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for all resource names |
| `region` | No | `us-central1` | GCP region |
| `application_name` | No | `ollama` | Base name for Cloud Run service and GCS bucket |
| `application_version` | No | `latest` | Ollama Docker image tag |
| `deploy_application` | No | `true` | Set `false` to provision storage and IAM only |
| `default_model` | No | `""` | Model to pre-pull on first deployment (e.g., `llama3.2:3b`) |
| `model_pull_timeout_seconds` | No | `3600` | Timeout for model pull job (300–7200 s) |
| `min_instance_count` | No | `1` | Minimum instances (set to 1 to avoid cold-start model loading) |
| `max_instance_count` | No | `1` | Maximum concurrent instances |
| `cpu_limit` | No | `4000m` | CPU limit per instance (3B models: 4000m; 7B models: 8000m) |
| `memory_limit` | No | `8Gi` | Memory limit per instance (3B models: 8Gi; 7B models: 16Gi) |
| `timeout_seconds` | No | `3600` | Maximum request duration — increase for long inference |
| `ingress_settings` | No | `internal` | Traffic sources: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `execution_environment` | No | `gen2` | Cloud Run generation — must be `gen2` for GCS Fuse |
| `create_cloud_storage` | No | `true` | Provision GCS model bucket |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Estimated Deployment Duration

| Step | Estimated Time |
|---|---|
| Artifact Registry image mirror | 3–5 minutes |
| Cloud Run service deployment | 2–3 minutes |
| GCS Fuse volume mount | < 1 minute |
| Model pull job (if `default_model` set) | 5–30 minutes (model size dependent) |
| **Total** | **10–40 minutes** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL for the Ollama Cloud Run service |
| `ollama_api_url` | `<service_url>/api` — Ollama API base URL |
| `service_name` | Cloud Run service name |
| `service_location` | GCP region where the service is deployed |
| `models_bucket` | GCS bucket name where model weights are persisted |
| `storage_buckets` | All created GCS bucket names |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "ollama")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")
```

---

## Phase 2 — Get Service URL and Access the API [MANUAL]

**Goal:** Retrieve the Ollama service URL and verify the service is running.

1. Get the Cloud Run service URL:

   ```bash
   echo "Ollama URL: ${SERVICE_URL}"
   ```

   Or use gcloud:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --format="value(status.url)"
   ```

2. Since `ingress_settings = internal` by default, use the Cloud Run proxy to access the service locally:

   ```bash
   gcloud run services proxy ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --port 11434
   ```

   Leave this running in a separate terminal window.

   Alternatively, if `ingress_settings = all`, call the service URL directly:

   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
     https://${SERVICE_URL}
   ```

3. Verify Ollama is responding:

   ```bash
   curl http://localhost:11434
   ```

   **Expected result:** `Ollama is running`

4. List Cloud Run services:

   ```bash
   gcloud run services list \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **Expected result:** The Ollama service is listed with status `Ready`.

**REST API equivalent — describe Cloud Run service:**

```bash
curl -X GET \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Phase 3 — List Available Models [MANUAL]

**Goal:** See which models are available in the Ollama instance.

1. List all models currently installed:

   ```bash
   curl http://localhost:11434/api/tags
   ```

   **Expected result:** A JSON object with a `models` array listing installed models and their sizes. If `default_model` was set during deployment, it appears here.

2. Format the output for readability:

   ```bash
   curl -s http://localhost:11434/api/tags | python3 -m json.tool
   ```

3. Note the difference between models that are pre-downloaded (in GCS) and models that must still be pulled.

4. Verify the GCS models bucket contains the model files:

   ```bash
   gcloud storage ls gs://<models_bucket>/
   ```

   **Expected result:** Directories corresponding to model data (e.g., `blobs/`, `manifests/`).

---

## Phase 4 — Pull and Run a Model [MANUAL]

**Goal:** Pull a small model and generate a response.

1. Pull a small model (gemma2:2b is ~1.6 GB and runs well on CPU):

   ```bash
   curl -X POST http://localhost:11434/api/pull \
     -d '{"name": "gemma2:2b"}'
   ```

   **Expected result:** A streaming JSON response showing download progress with `status` fields (`pulling manifest`, `pulling...`, `verifying sha256 digest`, `success`).

   > For a 3B model expect 3–10 minutes download time. The model is written to the GCS Fuse mount and will persist across Cloud Run instance restarts.

2. Once the pull is complete, run a prompt (non-streaming):

   ```bash
   curl http://localhost:11434/api/generate \
     -d '{
       "model": "gemma2:2b",
       "prompt": "Explain Kubernetes in one paragraph",
       "stream": false
     }'
   ```

   **Expected result:** A JSON response with a `response` field containing the generated text and metadata including `eval_count` and `total_duration`.

3. Run a streaming prompt and observe the token-by-token output:

   ```bash
   curl http://localhost:11434/api/generate \
     -d '{
       "model": "gemma2:2b",
       "prompt": "What is the capital of France?",
       "stream": true
     }'
   ```

   **Expected result:** A stream of JSON objects, each with a `response` token, ending with `"done": true`.

---

## Phase 5 — Chat API [MANUAL]

**Goal:** Use the OpenAI-compatible chat completions endpoint.

1. Send a chat message using the OpenAI-compatible API:

   ```bash
   curl http://localhost:11434/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gemma2:2b",
       "messages": [
         {"role": "user", "content": "What is GCP?"}
       ]
     }'
   ```

   **Expected result:** A JSON response in OpenAI format with `choices[0].message.content` containing the answer. This format is compatible with any OpenAI SDK client.

2. Send a multi-turn conversation:

   ```bash
   curl http://localhost:11434/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gemma2:2b",
       "messages": [
         {"role": "user", "content": "My name is Alex."},
         {"role": "assistant", "content": "Hello Alex! How can I help you today?"},
         {"role": "user", "content": "What is my name?"}
       ]
     }'
   ```

   **Expected result:** The model recalls the name `Alex`.

3. Explore streaming responses with the chat API:

   ```bash
   curl http://localhost:11434/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gemma2:2b",
       "messages": [{"role": "user", "content": "List 3 GCP services"}],
       "stream": true
     }'
   ```

   **Expected result:** A stream of `data:` prefixed JSON chunks in SSE format.

---

## Phase 6 — Model Management [MANUAL]

**Goal:** Inspect running models and explore model metadata.

1. List running models (models currently loaded in memory):

   ```bash
   curl http://localhost:11434/api/ps
   ```

   **Expected result:** A JSON object listing loaded models, their sizes, and when they were last used. Ollama keeps models in memory for a configurable duration (`OLLAMA_KEEP_ALIVE`).

2. View detailed model information:

   ```bash
   curl http://localhost:11434/api/show \
     -d '{"name": "gemma2:2b"}'
   ```

   **Expected result:** A JSON object with `modelfile`, `parameters`, `template`, `details` (family, parameter size, quantization level), and `model_info`.

3. List all locally available models:

   ```bash
   curl http://localhost:11434/api/tags
   ```

4. Copy a model to create a custom variant:

   ```bash
   curl -X POST http://localhost:11434/api/copy \
     -d '{"source": "gemma2:2b", "destination": "gemma2-custom"}'
   ```

5. Delete a model when no longer needed:

   ```bash
   curl -X DELETE http://localhost:11434/api/delete \
     -d '{"name": "gemma2-custom"}'
   ```

---

## Phase 7 — Verify GCS Model Storage [MANUAL]

**Goal:** Confirm models persist in GCS across Cloud Run instance restarts.

1. List the contents of the Ollama models bucket:

   ```bash
   gcloud storage ls gs://<models_bucket>/
   ```

2. Browse model manifests and blobs:

   ```bash
   gcloud storage ls gs://<models_bucket>/manifests/
   gcloud storage ls gs://<models_bucket>/blobs/
   ```

   **Expected result:** Directories and files corresponding to the pulled models. The `blobs/` directory contains the model weight files (often tens of gigabytes for larger models).

3. Understand the GCS Fuse mount:

   The Ollama Cloud Run container (gen2) mounts the GCS bucket at `/root/.ollama/models` using GCS Fuse. When Ollama writes model files, they are written to GCS. When a new Cloud Run instance starts, the models are available immediately without re-downloading — only a metadata read is needed to load the model.

4. Get the size of the models bucket:

   ```bash
   gcloud storage du gs://<models_bucket>/ --summarize
   ```

5. Confirm model data survives a new Cloud Run revision deployment:

   ```bash
   # Deploy a new revision by updating a label
   gcloud run services update ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --update-labels updated-at=$(date +%s)
   ```

6. After the revision is active, reconnect the proxy and list models:

   ```bash
   gcloud run services proxy ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --port 11434

   curl http://localhost:11434/api/tags
   ```

   **Expected result:** The same models are listed as before.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

**Goal:** View Ollama server logs and model loading events.

1. Open the Cloud Console Logs Explorer:

   ```
   https://console.cloud.google.com/logs/query?project=${PROJECT}
   ```

2. Query Ollama Cloud Run logs:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   resource.labels.location="${REGION}"
   ```

3. Look for log entries showing:
   - Server startup: `Listening on [::]:11434`
   - Model loading: `llm_load_print_meta` output when a model is first loaded into memory
   - Inference requests: timing and token counts
   - GCS Fuse mount activity

4. Using gcloud CLI:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --format="table(timestamp,textPayload)"
   ```

5. Stream logs in real time while running an inference request:

   ```bash
   gcloud alpha run services logs tail ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

**Expected result:** Log entries showing Ollama server startup, GCS Fuse model access, and inference durations.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

**Goal:** Inspect Cloud Run instance resource utilization metrics.

1. Open the Cloud Console Monitoring dashboard:

   ```
   https://console.cloud.google.com/monitoring?project=${PROJECT}
   ```

2. Navigate to **Metrics Explorer** and query:

   - Metric: `run.googleapis.com/container/cpu/utilizations`
   - Filter by `service_name = ${SERVICE}`

3. Check memory utilization (critical for LLM inference — model weights are loaded into RAM):

   - Metric: `run.googleapis.com/container/memory/utilizations`

4. Query request latency (inference requests take longer than typical web requests):

   - Metric: `run.googleapis.com/request_latencies`
   - Filter by `service_name = ${SERVICE}`

5. Using gcloud CLI to describe the service:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

6. Check uptime check status:

   ```bash
   gcloud monitoring uptime list --project=${PROJECT}
   ```

**REST API equivalent — get Cloud Run metrics:**

```bash
curl -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch cloud_run_revision | metric run.googleapis.com/container/memory/utilizations | every 1m"
  }'
```

**Expected result:** CPU and memory graphs spiking during model inference and returning to baseline when idle. Memory remains elevated while models are loaded.

---

## Phase 10 — Delete [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

**What is removed:**
- Cloud Run service and all revisions
- Cloud Run model-pull initialization job (if created)
- GCS models bucket (if `enable_purge = true`) — **note: this deletes all downloaded model weights**
- Artifact Registry mirrored image
- Secret Manager secrets (if any)
- Cloud Monitoring uptime checks and alert policies

**Estimated time:** 5–10 minutes

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Learned |
|---|---|---|
| Phase 1 — Deploy | Automated | Module provisions Cloud Run, GCS Fuse model storage, VPC Direct Egress |
| Phase 2 — Get Service URL | Manual | Cloud Run service discovery and VPC-internal access via proxy |
| Phase 3 — List Available Models | Manual | Discovering pre-pulled and available models |
| Phase 4 — Pull and Run a Model | Manual | Downloading a model and generating text via REST API |
| Phase 5 — Chat API | Manual | OpenAI-compatible chat completions, multi-turn conversations, streaming |
| Phase 6 — Model Management | Manual | Listing running models, viewing metadata, copying, and deleting models |
| Phase 7 — GCS Model Storage | Manual | Verifying GCS persistence and testing revision restart durability |
| Phase 8 — Cloud Logging | Manual | Viewing Ollama server logs and model load events in Cloud Run |
| Phase 9 — Cloud Monitoring | Manual | CPU/memory utilization and request latency metrics |
| Phase 10 — Delete | Automated | Clean teardown of all resources |
