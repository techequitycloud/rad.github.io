# Ollama on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_GKE)**

Ollama is an open-source LLM inference server that runs large language models — Llama, Mistral,
Gemma, Phi, and others — via a REST API. It is OpenAI API-compatible, making it a drop-in
replacement for any application that uses the OpenAI SDK. This lab deploys Ollama on GKE
Autopilot with model weights persisted to a GCS bucket via GCS Fuse CSI Driver, accessible
within the cluster via ClusterIP. Other pods in the same cluster (Flowise, N8N, Django) can
call `http://ollama.<namespace>.svc.cluster.local:11434` directly.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Ollama API](#exercise-1--access-ollama-api)
6. [Exercise 2 — Pull and List Models](#exercise-2--pull-and-list-models)
7. [Exercise 3 — Generate Text and Chat](#exercise-3--generate-text-and-chat)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Model Storage and Persistence](#exercise-5--model-storage-and-persistence)
10. [Exercise 6 — Cloud Logging and Monitoring](#exercise-6--cloud-logging-and-monitoring)
11. [Cleanup](#cleanup)
12. [Reference](#reference)

---

## 1. Overview

### What Is Ollama?

Ollama is a **standalone LLM inference server** that downloads, manages, and serves open-source
large language models through a REST API on port 11434. The `Ollama_GKE` module deploys Ollama
as a GKE Autopilot Deployment with a ClusterIP service, GCS Fuse CSI volume for model
persistence, and Workload Identity for secure GCS access. kubectl port-forwarding provides
local API access.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **kubectl Access** | Cluster credentials, pod inspection, port-forwarding |
| **Model Pull** | Download models from Ollama Hub to GCS-backed storage |
| **Text Generation** | `POST /api/generate` streaming and non-streaming |
| **OpenAI Chat API** | `/v1/chat/completions` endpoint for SDK compatibility |
| **Kubernetes Workloads** | Pod lifecycle, HPA, GCS Fuse CSI volume |
| **Model Persistence** | GCS-backed storage survives pod restarts |
| **Cloud Observability** | Cloud Logging inference logs, Cloud Monitoring pod metrics |

---

## 2. Architecture

```
Local kubectl port-forward / In-cluster pods
       │
       ▼ HTTP port 11434
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Kubernetes Namespace (appollama<tenant><id>)              │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │  Ollama Pod (1/1 READY)                             │   │  │
│  │  │  ┌─────────────────────────────────────────────┐   │   │   │
│  │  │  │  ollama container                           │   │   │   │
│  │  │  │  PORT: 11434                                │   │   │   │
│  │  │  │  OLLAMA_MODELS = /mnt/gcs/ollama/models     │   │   │   │
│  │  │  │  GCS Fuse CSI volume → <prefix>-models      │   │   │   │
│  │  │  └─────────────────────────────────────────────┘   │   │   │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ClusterIP Service :11434 → Ollama pod :11434             │   │
│  │  In-cluster URL: http://ollama.<namespace>.svc:11434      │   │
│  │  HPA: minReplicas=1, maxReplicas=3                        │   │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────────┐
│  GCS Bucket: <prefix>-models               │
│  GCS Fuse CSI Driver mount at /mnt/gcs     │
│  OLLAMA_MODELS = /mnt/gcs/ollama/models    │
│  Persists across pod restarts              │
│  Workload Identity SA → storage.objectUser │
└────────────────────────────────────────────┘
```

Module variable wiring:

```
Ollama_GKE
  application_name    = "ollama"
  cpu_limit           = "8"          → 7B models need ≥ 6 vCPU
  memory_limit        = "16Gi"       → 7B models need ≥ 8Gi
  min_instance_count  = 1            → keep warm instance
  max_instance_count  = 3            → HPA scale-out
  service_type        = ClusterIP    → internal access only
  OLLAMA_MODELS       = /mnt/gcs/ollama/models
  OLLAMA_KEEP_ALIVE   = 24h
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` | Any | System package manager |
| `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
roles/storage.admin
roles/logging.viewer
roles/monitoring.viewer
```

### Resource Requirements

| Model Size | Minimum CPU | Minimum Memory |
|---|---|---|
| 1B–3B (e.g., `gemma2:2b`, `phi3.5`) | `4` vCPU | `8Gi` |
| 7B (e.g., `mistral`, `llama3.2`) | `8` vCPU | `16Gi` |
| 13B+ | `12`+ vCPU | `32Gi`+ |

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

Deploy the `Ollama_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `ollama` | Base resource name |
| `min_instance_count` | `1` | Keep warm pod |
| `max_instance_count` | `3` | HPA scale-out |
| `default_model` | `gemma2:2b` | Optional pre-pull |
| `model_pull_timeout_seconds` | `3600` | Allow enough time |

Click **Deploy** and wait for provisioning (approximately 15–45 minutes, longer if
`default_model` is set).

> **What this provisions:** GKE Autopilot namespace and Deployment, ClusterIP Service, HPA,
> GCS bucket for model weights (mounted via GCS Fuse CSI), Artifact Registry image mirroring,
> Workload Identity binding for GCS access, and optional model-pull initialization job.
> No Cloud SQL, no database credentials required.

### 4.2 Configure Shell Environment

```bash
# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

echo "Cluster: ${CLUSTER}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes
```

```bash
# Discover the Ollama namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appollama" | head -1)

echo "Namespace: ${NAMESPACE}"

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

Verify the Ollama pod is running, set up kubectl port-forwarding to access the API locally,
and confirm Ollama is responding.

### Step 1.1 — Verify the Pod Is Running

```bash
kubectl get pods -n "${NAMESPACE}"
```

**Expected result:** Ollama pod in `Running` status:
```
NAME                      READY   STATUS    RESTARTS   AGE
ollama-<hash>             1/1     Running   0          5m
```

If `default_model` was set, also check the initialization job:
```bash
kubectl get jobs -n "${NAMESPACE}"
```

### Step 1.2 — Check the ClusterIP Service

**kubectl:**
```bash
kubectl get svc -n "${NAMESPACE}"
```

**Expected result:** A `ClusterIP` service on port `11434`.

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{status: .status}'
```

### Step 1.3 — Set Up Port-Forwarding

```bash
# Get the service name
OLLAMA_SVC=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

echo "Service: ${OLLAMA_SVC}"

# Port-forward — run in a separate terminal or background
kubectl port-forward "svc/${OLLAMA_SVC}" 11434:11434 -n "${NAMESPACE}" &
```

**Expected result:** `Forwarding from 127.0.0.1:11434 -> 11434`

### Step 1.4 — Verify Ollama Is Running

```bash
curl http://localhost:11434
```

**Expected result:** `Ollama is running`

### Step 1.5 — Check the In-Cluster URL

Other pods in the same cluster can access Ollama at the internal service URL:

```bash
echo "In-cluster URL: http://${OLLAMA_SVC}.${NAMESPACE}.svc.cluster.local:11434"
```

This URL is used by other applications (Flowise, N8N, LangChain pods) to call the Ollama API.

---

## Exercise 2 — Pull and List Models

### Objective

Pull a model into GCS-backed storage and verify it persists in the GCS bucket.

### Step 2.1 — Check Current Model List

```bash
curl -s http://localhost:11434/api/tags \
  | jq '{model_count: (.models | length), models: [.models[].name]}'
```

**Expected result:** Empty list (if no `default_model` was set) or the pre-pulled model.

### Step 2.2 — Check the GCS Bucket

```bash
gcloud storage ls "gs://${MODELS_BUCKET}/"
```

**Expected result:** Empty or populated with model directories from `default_model`.

### Step 2.3 — Pull a Small Model

```bash
curl -s -X POST http://localhost:11434/api/pull \
  -H "Content-Type: application/json" \
  -d '{"name": "gemma2:2b"}'
```

**Expected result:** Streaming progress JSON ending with `{"status":"success"}`.

### Step 2.4 — List Installed Models

```bash
curl -s http://localhost:11434/api/tags \
  | jq '.models[] | {name: .name, size_bytes: .size}'
```

**Expected result:** `gemma2:2b` listed with size ~1.6 GB.

### Step 2.5 — Verify Models in GCS

```bash
gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/"
gcloud storage du "gs://${MODELS_BUCKET}/" --summarize
```

**Expected result:** `blobs/` and `manifests/` directories in GCS with ~1.6 GB for `gemma2:2b`.

---

## Exercise 3 — Generate Text and Chat

### Objective

Use both the Ollama native API (`/api/generate`, `/api/chat`) and the OpenAI-compatible
`/v1/chat/completions` endpoint.

### Step 3.1 — Non-Streaming Text Generation

```bash
curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "prompt": "Explain what Kubernetes is in two sentences.",
    "stream": false
  }' | jq '{response: .response, tokens: .eval_count}'
```

**Expected result:** Response text and token count.

### Step 3.2 — Streaming Text Generation

```bash
curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "prompt": "What are the main GCP storage services?",
    "stream": true
  }'
```

**Expected result:** Stream of JSON token objects ending with `"done": true`.

### Step 3.3 — Chat Completion (Ollama Native)

```bash
curl -s http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "messages": [
      {"role": "user", "content": "What is GKE Autopilot?"}
    ],
    "stream": false
  }' | jq '.message.content'
```

**Expected result:** A text explanation of GKE Autopilot.

### Step 3.4 — OpenAI-Compatible Chat Completion

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "messages": [
      {"role": "system", "content": "You are a concise GCP expert. Answer in one sentence."},
      {"role": "user", "content": "What is Cloud Run?"}
    ]
  }' | jq '.choices[0].message.content'
```

**Expected result:** One-sentence answer about Cloud Run.

### Step 3.5 — Multi-Turn Conversation

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "messages": [
      {"role": "user", "content": "My favourite GCP service is BigQuery."},
      {"role": "assistant", "content": "BigQuery is a great choice! It is excellent for analytics."},
      {"role": "user", "content": "What did I say was my favourite service?"}
    ]
  }' | jq '.choices[0].message.content'
```

**Expected result:** Model correctly recalls `BigQuery`.

### Step 3.6 — Streaming Chat in SSE Format

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma2:2b",
    "messages": [{"role": "user", "content": "Name 3 open source LLMs."}],
    "stream": true
  }'
```

**Expected result:** `data:` prefixed SSE chunks, compatible with any OpenAI SDK.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the Ollama Kubernetes Deployment, understand the GCS Fuse CSI volume mount, check
HPA configuration, and perform a rolling restart.

### Step 4.1 — Inspect the Deployment

```bash
kubectl describe deployment ollama -n "${NAMESPACE}"
```

Key sections to review:
- **Image:** Artifact Registry Ollama image
- **Volumes:** GCS Fuse CSI volume for model storage
- **Resources:** CPU and memory limits (GKE Autopilot enforces these strictly)
- **Environment:** `OLLAMA_MODELS`, `OLLAMA_HOST`, `OLLAMA_KEEP_ALIVE`

### Step 4.2 — Inspect the Pod

```bash
OLLAMA_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=ollama \
  -o jsonpath='{.items[0].metadata.name}')

# Check resource usage
kubectl top pod "${OLLAMA_POD}" -n "${NAMESPACE}"

# Describe pod volumes
kubectl describe pod "${OLLAMA_POD}" -n "${NAMESPACE}" | grep -A5 "Volumes:"
```

**Expected result:** GCS Fuse CSI volume mounted at `/mnt/gcs`.

### Step 4.3 — Verify the GCS Fuse Mount

```bash
kubectl exec -n "${NAMESPACE}" "${OLLAMA_POD}" -- \
  ls /mnt/gcs/ollama/models/
```

**Expected result:** `blobs/` and `manifests/` directories — the model files stored in GCS.

### Step 4.4 — Check HPA Status

**kubectl:**
```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{status: .status, nodeCount: .currentNodeCount}'
```

**Expected result:** HPA with `MINPODS=1`, `MAXPODS=3`, current `REPLICAS=1`.

### Step 4.5 — Perform a Rolling Restart

```bash
kubectl rollout restart deployment/ollama -n "${NAMESPACE}"
kubectl rollout status deployment/ollama -n "${NAMESPACE}" --timeout=300s
```

Re-establish port-forwarding after the restart:
```bash
kubectl port-forward "svc/${OLLAMA_SVC}" 11434:11434 -n "${NAMESPACE}" &
sleep 5
curl http://localhost:11434
```

**Expected result:** `Ollama is running` — the service recovered after the restart.

---

## Exercise 5 — Model Storage and Persistence

### Objective

Verify model weights persist in GCS across pod restarts, inspect the storage layout, and
understand the GCS Fuse CSI Driver.

### Step 5.1 — Inspect the GCS Bucket Structure

```bash
gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/"
gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/manifests/"
gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/blobs/" | head -10
```

**Expected result:**
- `manifests/` — model manifest files (small, contain model metadata)
- `blobs/` — actual model weight files (large binary files, content-addressed by SHA256)

### Step 5.2 — View Bucket Size

```bash
gcloud storage du "gs://${MODELS_BUCKET}/" --summarize
```

**Expected result:** Total storage used. For `gemma2:2b`, approximately 1.6 GB.

### Step 5.3 — Delete the Pod and Verify Persistence

```bash
# Delete the current pod (Kubernetes will restart it from the Deployment)
kubectl delete pod "${OLLAMA_POD}" -n "${NAMESPACE}"

# Wait for the new pod to start
kubectl rollout status deployment/ollama -n "${NAMESPACE}" --timeout=180s
```

Re-establish port-forwarding:
```bash
OLLAMA_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=ollama \
  -o jsonpath='{.items[0].metadata.name}')

kubectl port-forward "svc/${OLLAMA_SVC}" 11434:11434 -n "${NAMESPACE}" &
sleep 10
```

Verify models still available:
```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

**Expected result:** `gemma2:2b` is still listed — model loaded from GCS after pod restart.

### Step 5.4 — Inspect GCS Fuse CSI Configuration

```bash
kubectl get pvc -n "${NAMESPACE}"
kubectl describe pvc -n "${NAMESPACE}"
```

**Expected result:** Persistent Volume Claims bound to the GCS Fuse CSI volume.

### Step 5.5 — Check Workload Identity for GCS Access

```bash
kubectl get serviceaccount -n "${NAMESPACE}" -o yaml | grep -A3 "iam.gke.io"
```

**Expected result:** `iam.gke.io/gcp-service-account` annotation — the pod accesses GCS
through Workload Identity, not a static service account key.

---

## Exercise 6 — Cloud Logging and Monitoring

### Objective

View Ollama server logs in Cloud Logging and review pod-level resource metrics in Cloud
Monitoring during LLM inference.

### Step 6.1 — View Logs in Cloud Logging Console

Navigate to:
```
https://console.cloud.google.com/logs/query?project=${PROJECT}
```

Filter for Ollama pod logs:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="ollama"
```

Look for:
- Server startup: `Listening on [::]:11434`
- Model loading: `llm_load_print_meta` when model loads into memory
- Inference requests: start/complete events with token counts

### Step 6.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND resource.labels.container_name="ollama"' \
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
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND resource.labels.container_name=\"ollama\"",
    "orderBy": "timestamp desc",
    "pageSize": 30
  }' | jq '.entries[] | {timestamp, text: .textPayload}'
```

### Step 6.3 — Watch Logs During Inference

In one terminal, stream logs:
```bash
kubectl logs -f "deployment/ollama" -n "${NAMESPACE}"
```

In another terminal, send an inference request:
```bash
curl http://localhost:11434/api/generate \
  -d '{"model": "gemma2:2b", "prompt": "What is machine learning?", "stream": false}'
```

**Expected result:** Log entries appear in real time showing inference timing and token counts.

### Step 6.4 — View Cloud Monitoring Metrics

Navigate to:
```
https://console.cloud.google.com/monitoring?project=${PROJECT}
```

In **Metrics Explorer**, query:
- `kubernetes.io/container/cpu/request_utilization` — CPU (spikes to 100% during inference)
- `kubernetes.io/container/memory/used_bytes` — memory (stays elevated while model is loaded)
- `kubernetes.io/pod/network/received_bytes_count` — inbound traffic

Filter by `resource.namespace_name = "${NAMESPACE}"`.

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type=starts_with('kubernetes.io/container')" \
  --project="${PROJECT}" \
  --limit=10
```

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch k8s_container::kubernetes.io/container/memory/limit_utilization | filter resource.namespace_name = \"'"${NAMESPACE}"'\" | within 30m | group_by [resource.container_name], mean(val())"
  }' | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, utilization: .pointData[-1].values[0].doubleValue}'
```

### Step 6.5 — Check HPA Scaling Activity

```bash
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA status showing current replicas and scaling thresholds. Ollama
uses memory-based scaling; as memory pressure increases with larger models, HPA may trigger.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Ollama_GKE` deployment. This removes the
Kubernetes workloads, GCS models bucket (`enable_purge = true` by default — model weights are
deleted), Artifact Registry image, Workload Identity bindings, and Cloud Monitoring resources.

> **Note:** Undeploying with `enable_purge = true` deletes all downloaded model weights.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete GCS models bucket (deletes all model weights)
gcloud storage rm -r "gs://${MODELS_BUCKET}/"

# Delete Artifact Registry images
gcloud artifacts docker images list \
  --repository="ollama" --location="${REGION}" --project="${PROJECT}"
```

**REST API — delete GCS bucket:**
```bash
curl -s -X DELETE \
  "https://storage.googleapis.com/storage/v1/b/${MODELS_BUCKET}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region |
| `application_name` | string | `ollama` | Base name for Kubernetes resources |
| `application_version` | string | `latest` | Ollama image tag |
| `gke_cluster_name` | string | auto-discover | GKE cluster name |
| `cpu_limit` | string | `8` | vCPU limit (7B models: 8; 3B models: 4) |
| `memory_limit` | string | `16Gi` | Memory limit (7B: 16Gi; 3B: 8Gi) |
| `min_instance_count` | number | `1` | Minimum pod replicas |
| `max_instance_count` | number | `3` | Maximum pod replicas (HPA) |
| `service_type` | string | `ClusterIP` | Kubernetes Service type |
| `workload_type` | string | `Deployment` | Use `Deployment` for GCS storage |
| `default_model` | string | `""` | Model to pre-pull on first deployment |
| `model_pull_timeout_seconds` | number | `3600` | Timeout for model pull job |

### Key Environment Variables (Auto-Injected)

| Variable | Value | Purpose |
|---|---|---|
| `OLLAMA_MODELS` | `/mnt/gcs/ollama/models` | GCS Fuse model directory |
| `OLLAMA_HOST` | `0.0.0.0:11434` | Bind to all interfaces |
| `OLLAMA_KEEP_ALIVE` | `24h` | Keep loaded model in memory |

### Useful Commands

```bash
# Configure kubectl
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" --project="${PROJECT}"

# Set up port-forwarding
kubectl port-forward "svc/${OLLAMA_SVC}" 11434:11434 -n "${NAMESPACE}"

# Check Ollama is running
curl http://localhost:11434

# List installed models
curl http://localhost:11434/api/tags | jq '.models[].name'

# Pull a model
curl -X POST http://localhost:11434/api/pull \
  -d '{"name": "gemma2:2b"}'

# Generate text
curl http://localhost:11434/api/generate \
  -d '{"model": "gemma2:2b", "prompt": "Hello!", "stream": false}'

# OpenAI-compatible chat
curl http://localhost:11434/v1/chat/completions \
  -d '{"model": "gemma2:2b", "messages": [{"role": "user", "content": "Hi!"}]}'

# View pod logs
kubectl logs deployment/ollama -n "${NAMESPACE}" -f

# View GCS bucket size
gcloud storage du "gs://${MODELS_BUCKET}/" --summarize

# HPA status
kubectl describe hpa -n "${NAMESPACE}"

# Rolling restart
kubectl rollout restart deployment/ollama -n "${NAMESPACE}"
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
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [GCS Fuse CSI Driver for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/cloud-storage-fuse-csi-driver)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [OpenAI API compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md)
