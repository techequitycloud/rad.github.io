---
title: "Ollama on GKE Autopilot — Lab Guide"
sidebar_label: "Ollama GKE"
---

# Ollama on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_GKE)**

## Overview

**Estimated time:** 1–2 hours

Ollama is a standalone open-source LLM inference server that runs large language models (Llama, Mistral, Gemma, Phi, and others) via a REST API on port 11434. This lab deploys Ollama on GKE Autopilot with model weights persisted to a GCS bucket via GCS Fuse CSI Driver. No database is required. Other pods in the same cluster can call the Ollama API at its ClusterIP URL.

### What the Module Automates

- GKE Autopilot Deployment + ClusterIP Service + HPA
- GCS bucket for model weight storage
- GCS Fuse CSI volume mount for persistent model storage
- Artifact Registry repository and image mirroring
- Workload Identity for GCS bucket access
- Secret Manager integration
- Cloud Monitoring uptime checks and notification channels
- Optional model-pull initialization job (when `default_model` is set)

### What You Do Manually

- Connect to the cluster and verify the Ollama pod
- Port-forward to access the Ollama API locally
- List available models
- Pull and run a model
- Use the chat completion API
- Explore model management
- Verify GCS model storage persistence
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

This lab uses three sets of tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Interact with GCP services (GCS, logs, metrics) |
| `kubectl` | Manage Kubernetes workloads and port-forward |
| `curl` | Call the Ollama REST API (port 11434) |

**Note:** Ollama is deployed with a `ClusterIP` service by default, meaning it is accessible only within the GKE cluster. To call the API from your local machine, use `kubectl port-forward`. Other workloads in the same cluster (e.g., Flowise, N8N) can call `http://ollama.<namespace>.svc.cluster.local:11434` directly.

---

## Prerequisites

- GCP project with billing enabled
- `Services GCP` module deployed (provides VPC and GKE Autopilot cluster)
- `gcloud` CLI authenticated (`gcloud auth application-default login`)
- `kubectl` configured or configurable via `gcloud container clusters get-credentials`
- Access to the RAD UI with permission to deploy modules in the target GCP project
- Sufficient CPU and memory quota: 3B models require ~8 GB RAM; 7B models require ~16 GB RAM

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Ollama GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for all resource names |
| `region` | No | `us-central1` | GCP region |
| `application_name` | No | `ollama` | Base name for Kubernetes resources and GCS bucket |
| `application_version` | No | `latest` | Ollama Docker image tag |
| `deploy_application` | No | `true` | Set `false` to provision storage and IAM only |
| `gke_cluster_name` | No | auto-discover | Name of the GKE Autopilot cluster |
| `default_model` | No | `""` | Model to pre-pull on first deployment (e.g., `llama3.2:3b`) |
| `model_pull_timeout_seconds` | No | `3600` | Timeout for model pull job (300–7200 s) |
| `min_instance_count` | No | `1` | Minimum pod replicas (set to 1 to keep a warm instance) |
| `max_instance_count` | No | `3` | Maximum pod replicas for HPA |
| `container_resources` | No | `cpu=8, mem=16Gi` | Pod CPU and memory limits |
| `service_type` | No | `ClusterIP` | Kubernetes Service type (use `ClusterIP` to keep API internal) |
| `workload_type` | No | `Deployment` | Use `Deployment` for GCS-backed storage |
| `timeout_seconds` | No | `300` | Pod termination grace period |

### Deploy

Click **Deploy** in the RAD UI.

### Estimated Deployment Duration

| Step | Estimated Time |
|---|---|
| Artifact Registry image mirror | 3–5 minutes |
| GKE Autopilot pod scheduling | 3–5 minutes |
| GCS Fuse volume mount | 1–2 minutes |
| Model pull job (if `default_model` set) | 5–30 minutes (model size dependent) |
| **Total** | **15–45 minutes** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `ollama_cluster_url` | Internal cluster URL: `http://ollama.<namespace>.svc.cluster.local:11434` |
| `service_name` | Kubernetes service name |
| `namespace` | Kubernetes namespace |
| `service_cluster_ip` | ClusterIP address |
| `models_bucket` | GCS bucket name where model weights are stored |
| `storage_buckets` | All created GCS bucket names |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace (pattern: appollama<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appollama" | head -1)
```

---

## Phase 2 — Connect to the Cluster [MANUAL]

**Goal:** Authenticate `kubectl`, verify the Ollama pod, and set up port-forwarding.

1. Get credentials for the GKE cluster:

   ```bash
   gcloud container clusters get-credentials <cluster-name> \
     --region <region> \
     --project <project-id>
   ```

   **Expected result:** `kubeconfig entry generated for <cluster-name>`

2. Find the Ollama namespace:

   ```bash
   kubectl get namespaces | grep ollama
   ```

3. Verify the pod is running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:** A pod with name starting `ollama-` in `Running` status.

   > Note: If `default_model` was set, wait for the model-pull initialization job to complete before proceeding. You can check the job status with:
   > ```bash
   > kubectl get jobs -n ${NAMESPACE}
   > ```

4. Port-forward the Ollama service to your local machine:

   ```bash
   kubectl port-forward svc/<service-name> 11434:11434 -n ${NAMESPACE}
   ```

   Leave this running in a separate terminal window.

   **Expected result:** `Forwarding from 127.0.0.1:11434 -> 11434`

5. Verify Ollama is responding:

   ```bash
   curl http://localhost:11434
   ```

   **Expected result:** `Ollama is running`

**gcloud equivalent — list GKE workloads:**

```bash
gcloud container clusters describe <cluster-name> \
  --region <region> \
  --format="value(status)"
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

   **Expected result:** Directories corresponding to model names (e.g., `blobs/`, `manifests/`).

---

## Phase 4 — Pull and Run a Model [MANUAL]

**Goal:** Pull a small model and generate a response.

1. Pull a small model (gemma2:2b is ~1.6 GB and runs well on CPU):

   ```bash
   curl -X POST http://localhost:11434/api/pull \
     -d '{"name": "gemma2:2b"}'
   ```

   **Expected result:** A streaming JSON response showing download progress with `status` fields (`pulling manifest`, `pulling...`, `verifying sha256 digest`, `success`).

   > For a 3B model expect 3–10 minutes download time depending on network speed. The model is written directly to the GCS Fuse mount and will persist across pod restarts.

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

   **Expected result:** A JSON response in OpenAI format with `choices[0].message.content` containing the answer.

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

3. Explore streaming with the chat API:

   ```bash
   curl http://localhost:11434/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gemma2:2b",
       "messages": [{"role": "user", "content": "List 3 GCP services"}],
       "stream": true
     }'
   ```

   **Expected result:** A stream of `data:` prefixed JSON chunks (SSE format), compatible with any OpenAI SDK client.

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

3. List all locally available models again to see the newly pulled model:

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

**Goal:** Confirm models persist in GCS across pod restarts.

1. List the contents of the Ollama models bucket:

   ```bash
   gcloud storage ls gs://<models_bucket>/
   ```

2. Browse model manifests and blobs:

   ```bash
   gcloud storage ls gs://<models_bucket>/manifests/
   gcloud storage ls gs://<models_bucket>/blobs/
   ```

   **Expected result:** Directories and files corresponding to the pulled models. The `blobs/` directory contains the model weight files.

3. Understand the GCS Fuse mount:

   The Ollama container mounts the GCS bucket at `/root/.ollama/models` using GCS Fuse CSI Driver. When Ollama writes model files, they are written directly to GCS. When the pod restarts, the models are available immediately without re-downloading.

4. Test persistence by restarting the pod:

   ```bash
   kubectl rollout restart deployment/ollama -n ${NAMESPACE}
   kubectl rollout status deployment/ollama -n ${NAMESPACE}
   ```

5. Re-establish port-forwarding after the pod restarts:

   ```bash
   kubectl port-forward svc/<service-name> 11434:11434 -n ${NAMESPACE}
   ```

6. Verify models are still available:

   ```bash
   curl http://localhost:11434/api/tags
   ```

   **Expected result:** The same models are listed as before the restart, loaded from GCS.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

**Goal:** View Ollama server logs and model loading events.

1. Open the Cloud Console Logs Explorer:

   ```
   https://console.cloud.google.com/logs/query?project=<project-id>
   ```

2. Query Ollama container logs:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="<namespace>"
   resource.labels.container_name="ollama"
   ```

3. Look for log entries showing:
   - Server startup: `Listening on [::]:11434`
   - Model loading: `llm_load_print_meta` output when a model is first loaded
   - Request handling: inference start/complete events

4. Using gcloud CLI:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=<project-id> \
     --limit=50 \
     --format="table(timestamp,jsonPayload.message)"
   ```

5. Watch logs in real time while running a prompt:

   ```bash
   kubectl logs -f deployment/ollama -n ${NAMESPACE}
   ```

**Expected result:** Log entries showing model loading from GCS Fuse and inference request handling.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

**Goal:** Inspect pod resource utilization metrics.

1. Open the Cloud Console Monitoring dashboard:

   ```
   https://console.cloud.google.com/monitoring?project=<project-id>
   ```

2. Navigate to **Metrics Explorer** and query:

   - Metric: `kubernetes.io/container/cpu/request_utilization`
   - Filter by `namespace_name = ${NAMESPACE}`

3. Query memory utilization (important for LLM inference):

   - Metric: `kubernetes.io/container/memory/used_bytes`
   - Filter by `namespace_name = ${NAMESPACE}`

4. Check HPA (Horizontal Pod Autoscaler) status:

   ```bash
   kubectl get hpa -n ${NAMESPACE}
   kubectl describe hpa -n ${NAMESPACE}
   ```

5. Using gcloud CLI to list available GKE metrics:

   ```bash
   gcloud monitoring metrics list \
     --filter="metric.type=starts_with('kubernetes.io/container')" \
     --project=<project-id> \
     --limit=10
   ```

**Expected result:** CPU and memory graphs spiking during model inference, returning to baseline afterward.

---

## Phase 10 — Delete [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

**What is removed:**
- Kubernetes Deployment, Service, and namespace
- GCS models bucket (if `enable_purge = true`) — **note: this deletes all downloaded model weights**
- Artifact Registry mirrored image
- Secret Manager secrets (if any)
- Cloud Monitoring uptime checks and alert policies
- Workload Identity bindings

**Estimated time:** 5–10 minutes

Resources provisioned by the `Services GCP` module (VPC, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Learned |
|---|---|---|
| Phase 1 — Deploy | Automated | Module provisions GKE workload, GCS Fuse model storage, Workload Identity |
| Phase 2 — Connect to Cluster | Manual | `kubectl` authentication, pod verification, and port-forwarding |
| Phase 3 — List Available Models | Manual | Discovering pre-pulled and available models |
| Phase 4 — Pull and Run a Model | Manual | Downloading a model and generating text via REST API |
| Phase 5 — Chat API | Manual | OpenAI-compatible chat completions, multi-turn conversations, streaming |
| Phase 6 — Model Management | Manual | Listing running models, viewing metadata, copying, and deleting models |
| Phase 7 — GCS Model Storage | Manual | Verifying GCS persistence and testing pod restart durability |
| Phase 8 — Cloud Logging | Manual | Viewing Ollama server logs and model load events |
| Phase 9 — Cloud Monitoring | Manual | CPU/memory utilization during inference, HPA status |
| Phase 10 — Delete | Automated | Clean teardown of all resources |
