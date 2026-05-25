---
title: "n8n AI on GKE — Lab Guide"
sidebar_label: "N8N AI GKE"
---

# n8n AI on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE)**

This lab guide walks you through deploying, exploring, and operating the **n8n AI Starter Kit**
on Google Kubernetes Engine Autopilot using the **N8N_AI_GKE** module. You will build AI agent
workflows, manage Kubernetes workloads for Qdrant and Ollama, configure Workload Identity for
secure GCP access, and explore GKE-native scaling and observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access n8n AI on GKE](#exercise-1--access-n8n-ai-on-gke)
6. [Exercise 2 — Build an AI Workflow](#exercise-2--build-an-ai-workflow)
7. [Exercise 3 — AI Memory and Context](#exercise-3--ai-memory-and-context)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is n8n AI on GKE?

n8n AI is the AI-augmented variant of the popular open-source workflow automation platform.
The `N8N_AI_GKE` module deploys n8n version **2.4.7** on GKE Autopilot with **Qdrant** and
**Ollama** running as dedicated Kubernetes Deployments in the same namespace. Unlike the Cloud
Run variant where AI services run as separate Cloud Run services, on GKE all three workloads
share the same Kubernetes namespace and communicate via ClusterIP services over the pod network.
The Horizontal Pod Autoscaler (HPA) manages n8n replica scaling while Qdrant and Ollama run
as fixed-replica Deployments.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **AI Agent Workflows** | LangChain-style agent loops with Ollama as the local LLM via ClusterIP service discovery |
| **Kubernetes Workloads** | Deployments, Services, HPA, resource limits, pod lifecycle management |
| **Workload Identity** | GKE Workload Identity binding Kubernetes service accounts to GCP service accounts |
| **Internal Networking** | ClusterIP services for Qdrant (port 6333) and Ollama (port 11434) with cluster-local DNS |
| **NFS Persistence** | Cloud Filestore NFS for n8n workflow data, shared across replicas |
| **GCS Fuse Volumes** | Shared GCS bucket for Qdrant vector indices and Ollama model weights |
| **Observability** | kubectl log aggregation, Cloud Logging for k8s_container, Cloud Monitoring pod metrics |
| **Queue Mode** | Redis-backed n8n queue mode with HPA for reliable multi-replica execution |

---

## 2. Architecture

### Kubernetes Namespace Map

```
GKE Autopilot Cluster
  │
  └── Namespace: appn8naidemo<id>
        │
        ├── Deployment: appn8naidemo<id>        (n8n)
        │     containers: n8n + cloud-sql-proxy
        │     service:    LoadBalancer  port 5678
        │     HPA:        min=0, max=3, CPU target=80%
        │
        ├── Deployment: appn8naidemo<id>-qdrant  (Qdrant)
        │     container: qdrant/qdrant
        │     service:   ClusterIP  port 6333, 6334
        │     storage:   GCS Fuse at /mnt/gcs/qdrant
        │
        └── Deployment: appn8naidemo<id>-ollama  (Ollama)
              container: ollama/ollama
              service:   ClusterIP  port 11434
              storage:   GCS Fuse at /mnt/gcs/ollama/models
```

### Infrastructure

```
┌─────────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  GKE Autopilot Cluster (Services_GCP)                        │   │
│  │                                                              │   │
│  │  Namespace: appn8naidemo<id>                                 │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │  n8n Pod (2/2)      Qdrant Pod (1/1)  Ollama Pod (1/1) │  │   │
│  │  │  n8n + sql-proxy    qdrant             ollama           │  │  │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  HPA ──► n8n Deployment                                      │   │
│  │  LoadBalancer ──► n8n Service (external IP:5678)             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Cloud SQL PostgreSQL 15    NFS Filestore       GCS Bucket          │
│  db: n8n_db                 /mnt/nfs (n8n data) /mnt/gcs            │
│  Auth Proxy via socket      Redis on NFS IP     qdrant + ollama     │
│                                                                     │
│  Secret Manager             Cloud Logging       Cloud Monitoring    │
│  ├── encryption-key         k8s_container       pod CPU/memory      │
│  └── smtp-password          namespace filter    HPA metrics         │
└─────────────────────────────────────────────────────────────────────┘

Module variable wiring:

  N8N_AI_GKE
    enable_ai_components = true  →  Qdrant + Ollama Kubernetes Deployments
    enable_qdrant        = true  →  ClusterIP Service on port 6333
    enable_ollama        = true  →  ClusterIP Service on port 11434
    enable_redis         = true  →  queue mode, NFS_SERVER_IP placeholder
    enable_nfs           = true  →  Cloud Filestore NFS mount
    min_instance_count   = 0     →  HPA minimum replicas
    max_instance_count   = 3     →  HPA maximum replicas
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` | Any | System package manager |
| `jq` | 1.6+ | `apt install jq` / `brew install jq` |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
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
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `N8N_AI_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `n8nai` | Base name for all resources |
| `application_version` | `2.4.7` | n8n version |
| `min_instance_count` | `0` | HPA minimum (set `1` to keep webhooks live) |
| `max_instance_count` | `3` | HPA maximum replicas |
| `cpu_limit` | `2000m` | CPU limit per n8n pod |
| `memory_limit` | `4Gi` | Memory limit per n8n pod |
| `enable_ai_components` | `true` | Deploys Qdrant + Ollama |
| `enable_qdrant` | `true` | Qdrant vector database |
| `enable_ollama` | `true` | Local LLM inference |
| `ollama_model` | `llama3.2` | Default model |
| `enable_redis` | `true` | Queue mode for multi-replica |
| `enable_nfs` | `true` | NFS for Redis + workflow data |

Click **Deploy** and wait for provisioning to complete (approximately 12–18 minutes). Ollama downloads the model on first startup, which may add a few minutes.

> **What this provisions:** GKE namespace with n8n (LoadBalancer), Qdrant (ClusterIP), and
> Ollama (ClusterIP) Deployments; HPA for n8n; Cloud SQL PostgreSQL 15 with Auth Proxy sidecar;
> NFS Filestore; GCS bucket for AI data persistence; Workload Identity bindings; Secret Manager
> secrets for encryption key and SMTP password; Redis on NFS.

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

# Discover the n8n namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appn8nai" | head -1)

echo "Namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get service -n "${NAMESPACE}" \
  -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')

echo "n8n URL: http://${EXTERNAL_IP}:5678"
```

---

## Exercise 1 — Access n8n AI on GKE

### Objective

Use kubectl to retrieve the n8n LoadBalancer external IP, verify all three Kubernetes Deployments are running, and complete the initial n8n account setup.

### Step 1.1 — List All Services in the Namespace

**kubectl:**
```bash
kubectl get services -n "${NAMESPACE}"
```

**Expected result:**
```
NAME                          TYPE           CLUSTER-IP    EXTERNAL-IP   PORT(S)
appn8naidemo<id>              LoadBalancer   10.x.x.x      34.x.x.x      5678:XXX/TCP
appn8naidemo<id>-qdrant       ClusterIP      10.x.x.x      <none>        6333/TCP,6334/TCP
appn8naidemo<id>-ollama       ClusterIP      10.x.x.x      <none>        11434/TCP
```

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
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, status: .status, nodeCount: .currentNodeCount}'
```

### Step 1.2 — Verify All Pods Are Running

```bash
kubectl get pods -n "${NAMESPACE}"
```

**Expected pods:**
```
NAME                                    READY   STATUS    RESTARTS   AGE
appn8naidemo<id>-xxx-yyy                2/2     Running   0          5m
appn8naidemo<id>-qdrant-xxx-yyy         1/1     Running   0          5m
appn8naidemo<id>-ollama-xxx-yyy         1/1     Running   0          5m
```

n8n shows `2/2` because it runs with a Cloud SQL Auth Proxy sidecar.

### Step 1.3 — Get Internal Service DNS Names

Note the Kubernetes cluster-local DNS names for the AI services:

```bash
# Qdrant internal DNS
echo "Qdrant: http://${NAMESPACE}-qdrant.${NAMESPACE}.svc.cluster.local:6333"

# Ollama internal DNS
echo "Ollama: http://${NAMESPACE}-ollama.${NAMESPACE}.svc.cluster.local:11434"
```

These DNS names are used when configuring n8n AI nodes to connect to Qdrant and Ollama.

### Step 1.4 — Access n8n UI and Create Admin Account

Open your browser and navigate to `http://${EXTERNAL_IP}:5678`.

On first launch:
1. Complete the account setup wizard with your email and a strong password
2. Select your usage preferences and click **Get started**
3. You are redirected to the n8n canvas

Alternatively, use port-forward for local access:
```bash
kubectl port-forward service/"${NAMESPACE}" 5678:5678 -n "${NAMESPACE}"
# Then open http://localhost:5678
```

### Step 1.5 — Verify Ollama Model is Loaded

Test Ollama from within the cluster using a temporary pod:

```bash
kubectl run curl-test \
  --image=curlimages/curl \
  --restart=Never \
  -n "${NAMESPACE}" -- \
  curl -s "http://${NAMESPACE}-ollama.${NAMESPACE}.svc.cluster.local:11434/api/tags"

kubectl logs curl-test -n "${NAMESPACE}"
kubectl delete pod curl-test -n "${NAMESPACE}"
```

**Expected result:** JSON response listing the loaded model, e.g. `{"models":[{"name":"llama3.2",...}]}`.

---

## Exercise 2 — Build an AI Workflow

### Objective

Build a working AI agent workflow in n8n that uses the Ollama LLM via Kubernetes ClusterIP service discovery, demonstrating the full prompt-chain from user input to AI-generated output on GKE.

### Step 2.1 — Verify n8n Has the Ollama Environment Variable

Check that `OLLAMA_HOST` was injected into the n8n pod:

```bash
kubectl exec -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c "${NAMESPACE}" -- env | grep OLLAMA
```

**Expected result:** `OLLAMA_HOST=http://<namespace>-ollama.<namespace>.svc.cluster.local:11434`

### Step 2.2 — Build the AI Agent Workflow

1. In n8n, click **+ New workflow** and name it `AI Agent Demo`
2. Add a **Manual Trigger** node
3. Add a **Set** node to inject a test question:
   - Name: `question`
   - Value: `What is Kubernetes and how does it differ from Docker?`
4. Add an **AI Agent** node:
   - Click **Chat Model** → select **Ollama Chat Model**
   - Set **Base URL** to the Ollama ClusterIP DNS name:
     `http://${NAMESPACE}-ollama.${NAMESPACE}.svc.cluster.local:11434`
   - Set **Model** to `llama3.2`
5. Set the AI Agent **System Prompt**: `You are a concise technical assistant for cloud infrastructure topics.`
6. Set the **User Prompt** to: `{{ $json.question }}`
7. Connect: Manual Trigger → Set → AI Agent
8. Click **Save** and **Execute workflow**

**Expected result:** The AI Agent returns a text answer generated locally by Ollama. Response time on CPU is 5–60 seconds depending on question complexity and model size.

### Step 2.3 — Add a Prompt Chain

Add a second LLM call to extract key points from the first response:

1. After the AI Agent, add a **Set** node:
   - Name: `summary_prompt`
   - Value: `List exactly 3 key points from: {{ $json.output }}`
2. Add a second **AI Agent** node with the same Ollama configuration
3. Set its prompt to: `{{ $json.summary_prompt }}`
4. Connect the chain: AI Agent → Set → second AI Agent
5. **Save** and **Execute**

**Expected result:** The second AI Agent returns a three-point summary of the first response.

### Step 2.4 — Activate and Test via Webhook

1. Replace the Manual Trigger with a **Webhook** node: Path = `ask-ai`, Method = `POST`
2. Update the first AI Agent prompt to: `{{ $json.body.question }}`
3. Add **Respond to Webhook** at the end
4. **Save** and **Activate**

```bash
curl -X POST "http://${EXTERNAL_IP}:5678/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"question": "Explain what an AI agent is in simple terms."}'
```

**Expected result:** The webhook returns a JSON response containing the Ollama-generated answer.

---

## Exercise 3 — AI Memory and Context

### Objective

Configure the n8n AI Agent with a Window Buffer Memory node to retain conversation history across multiple requests within a session, demonstrating stateful AI interactions on GKE.

### Step 3.1 — Add Memory to the AI Agent

1. Open the `AI Agent Demo` workflow
2. Click the **Memory** input port of the AI Agent node
3. Add a **Window Buffer Memory** node:
   - Context Window Length: `5`
   - Session ID: `{{ $json.body.session_id }}` (for multi-user contexts)
4. **Save** the workflow

### Step 3.2 — Test Context Retention

Send two related requests with the same session ID:

```bash
# First message — introduce context
curl -X POST "http://${EXTERNAL_IP}:5678/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"question": "My name is Sam and I manage a GKE cluster.", "session_id": "session-001"}'

# Second message — test recall
curl -X POST "http://${EXTERNAL_IP}:5678/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is my name and what do I manage?", "session_id": "session-001"}'
```

**Expected result:** The second response correctly identifies "Sam" and "GKE cluster", demonstrating that the Buffer Memory node maintained context across requests.

### Step 3.3 — Verify Memory Isolation Between Sessions

```bash
# Different session ID — should not recall previous context
curl -X POST "http://${EXTERNAL_IP}:5678/webhook/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is my name?", "session_id": "session-002"}'
```

**Expected result:** The response does not recall "Sam", confirming memory is isolated per `session_id`.

### Step 3.4 — Inspect Memory Storage via Pod Logs

```bash
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c "${NAMESPACE}" \
  --tail=30
```

**Expected result:** Log entries showing workflow execution events and PostgreSQL operations where conversation history is stored.

### Step 3.5 — View Execution History in n8n

1. Open the workflow in n8n and click **Executions** (clock icon)
2. Click a completed execution to view the full node-by-node input/output data
3. Examine the memory node's output to see the conversation history object stored in the database

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the Kubernetes Deployments, resource limits, NFS volumes, and HPA configuration for the n8n AI stack on GKE Autopilot, and scale workloads manually.

### Step 4.1 — Inspect All Deployments

**kubectl:**
```bash
kubectl get deployments -n "${NAMESPACE}"

kubectl describe deployment "${NAMESPACE}" -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(nodeConfig.machineType, currentNodeCount)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.nodePools[] | {name: .name, machineType: .config.machineType, initialNodeCount: .initialNodeCount}'
```

### Step 4.2 — Inspect Resource Limits

```bash
# View n8n container resource limits
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.containers[*].resources}' | jq .

# View Ollama resource limits
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}-ollama" \
  -o jsonpath='{.items[0].spec.containers[0].resources}' | jq .
```

**Expected result:** n8n shows `cpu: 2000m, memory: 4Gi` limits. Ollama inherits the same limits because both use the `cpu_limit` and `memory_limit` module variables.

### Step 4.3 — Inspect NFS Volume Mounts

```bash
# Verify NFS volume is mounted in the n8n pod
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.volumes}' | jq '.[] | select(.name == "nfs")'

# Check the mount path
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.containers[0].volumeMounts}' | jq .
```

**Expected result:** An NFS volume mounted at `/mnt/nfs` (the `nfs_mount_path` variable value).

### Step 4.4 — Inspect the HPA

```bash
kubectl get hpa -n "${NAMESPACE}"

kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:**
```
NAME               REFERENCE                     TARGETS    MINPODS   MAXPODS   REPLICAS
appn8naidemo<id>   Deployment/appn8naidemo<id>   10%/80%    0         3         1
```

The HPA scales n8n based on CPU utilisation. Qdrant and Ollama run as fixed single-replica Deployments and must be scaled manually.

### Step 4.5 — Scale n8n Manually

```bash
# Scale n8n to 2 replicas
kubectl scale deployment "${NAMESPACE}" \
  --replicas=2 \
  -n "${NAMESPACE}"

# Watch the new pod start
kubectl get pods -n "${NAMESPACE}" -w
```

**Expected result:** A second n8n pod starts within 1–2 minutes. With Redis queue mode enabled, both pods share workflow execution without state conflicts.

```bash
# Scale back to 1
kubectl scale deployment "${NAMESPACE}" \
  --replicas=1 \
  -n "${NAMESPACE}"
```

### Step 4.6 — Check GCS Volume Mounts for AI Services

```bash
# Verify Qdrant GCS Fuse mount
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}-qdrant" \
  -o jsonpath='{.items[0].spec.containers[0].volumeMounts}' | jq .

# Verify Ollama GCS Fuse mount
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}-ollama" \
  -o jsonpath='{.items[0].spec.containers[0].volumeMounts}' | jq .
```

**Expected result:** Qdrant shows a volume mounted at `/mnt/gcs/qdrant` and Ollama at `/mnt/gcs/ollama/models`, backed by the shared GCS bucket for persistence across pod restarts.

---

## Exercise 5 — Security and Workload Identity

### Objective

Explore GKE Workload Identity configuration that binds Kubernetes service accounts to GCP service accounts, enabling n8n, Qdrant, and Ollama to access GCP resources without static credentials.

### Step 5.1 — List Service Accounts in the Namespace

**kubectl:**
```bash
kubectl get serviceaccounts -n "${NAMESPACE}"
```

**Expected result:** One or more service accounts, including one for n8n with a Workload Identity annotation.

### Step 5.2 — Inspect Workload Identity Annotation

```bash
# Check the Workload Identity annotation on the n8n service account
kubectl get serviceaccount -n "${NAMESPACE}" \
  -o yaml | grep -A3 "annotations:"
```

**Expected result:** An annotation like `iam.gke.io/gcp-service-account: <sa-name>@<project>.iam.gserviceaccount.com` binding the Kubernetes service account to a GCP service account.

**gcloud — verify IAM binding:**
```bash
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~n8nai" \
  --format="table(email, displayName)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.accounts[] | select(.email | test("n8nai")) | {email, displayName}'
```

### Step 5.3 — Verify Secret Manager Access

n8n uses Workload Identity to access Secret Manager secrets without embedding credentials:

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

**Expected result:** The encryption key and SMTP password secrets appear, confirming Secret Manager was provisioned and the n8n pod can access them via Workload Identity.

### Step 5.4 — Verify the Encryption Key Is Loaded

```bash
kubectl exec -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c "${NAMESPACE}" -- env | grep N8N_ENCRYPTION_KEY
```

**Expected result:** The variable is set (value will be the actual 32-char key), confirming Secret Manager secret resolution is working via Workload Identity.

### Step 5.5 — Check Pod Security Context

```bash
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.securityContext}' | jq .
```

Inspect the security context to understand the UID/GID settings for the n8n pod (UID 1000 to match the `node` user in the container image, required for the GCS Fuse volume mount to be writable).

---

## Exercise 6 — Cloud Logging

### Objective

View and correlate logs from all three Kubernetes workloads (n8n, Qdrant, Ollama) using both kubectl and Cloud Logging to understand AI workflow execution patterns and diagnose issues.

### Step 6.1 — View n8n Logs with kubectl

```bash
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c "${NAMESPACE}" \
  --tail=50
```

**Expected result:** n8n startup log entries including database connection, encryption key loading, and workflow engine initialisation.

### Step 6.2 — View Ollama Logs

```bash
kubectl logs -n "${NAMESPACE}" \
  deployment/"${NAMESPACE}-ollama" \
  --tail=50
```

**Expected result:** Ollama model loading progress and inference server ready message on port 11434.

### Step 6.3 — View Qdrant Logs

```bash
kubectl logs -n "${NAMESPACE}" \
  deployment/"${NAMESPACE}-qdrant" \
  --tail=50
```

**Expected result:** Qdrant startup logs showing the vector database is listening on port 6333 and the storage path is `/mnt/gcs/qdrant`.

### Step 6.4 — Query Cloud Logging for All Namespace Containers

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="value(timestamp, resource.labels.container_name, jsonPayload.message)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE}\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp: .timestamp, container: .resource.labels.containerName, message: .jsonPayload.message}'
```

### Step 6.5 — Filter Logs by Container

```bash
# Ollama logs only
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"${NAMESPACE}-ollama\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="value(timestamp, jsonPayload.message)"

# Qdrant logs only
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"${NAMESPACE}-qdrant\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="value(timestamp, jsonPayload.message)"
```

### Step 6.6 — Open Cloud Logging Console

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22k8s_container%22%20AND%20resource.labels.namespace_name%3D%22${NAMESPACE}%22?project=${PROJECT}"
```

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Inspect pod-level CPU and memory metrics, monitor HPA scaling events, and use Cloud Monitoring to compare resource usage across all three Kubernetes workloads.

### Step 7.1 — View Pod CPU and Memory Usage

**kubectl (live resource usage — requires Metrics Server):**
```bash
kubectl top pods -n "${NAMESPACE}"
```

**Expected result:** Current CPU and memory usage for each pod (n8n, Qdrant, Ollama).

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project="${PROJECT}" \
  | grep -E "cpu|memory"
```

### Step 7.2 — Query Pod CPU Usage via REST API

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/core_usage_time | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], rate(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, cpuRate: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** CPU usage broken out by container — `n8n`, `qdrant`, and `ollama`. Ollama shows elevated CPU during LLM inference.

### Step 7.3 — Monitor HPA Scaling Events

```bash
# Watch HPA in real time (trigger workflows to generate CPU load)
kubectl get hpa -n "${NAMESPACE}" -w
```

To trigger scaling, execute several AI Agent workflows in parallel from multiple terminal sessions:

```bash
for i in {1..5}; do
  curl -X POST "http://${EXTERNAL_IP}:5678/webhook/ask-ai" \
    -H "Content-Type: application/json" \
    -d "{\"question\": \"Count to ${i} in French.\"}" &
done
wait
```

**Expected result:** HPA detects elevated CPU and schedules additional n8n replicas (up to `max_instance_count = 3`).

### Step 7.4 — Query Memory Usage

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/memory/used_bytes | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, memoryBytes: .pointData[-1].values[0].int64Value}'
```

### Step 7.5 — View the GKE Workloads Dashboard

```bash
echo "https://console.cloud.google.com/kubernetes/workload?project=${PROJECT}"
```

Explore:
- **Workloads** tab — Deployment status, replica count, rollout history for n8n, Qdrant, and Ollama
- **Services & Ingress** — LoadBalancer external IP and ClusterIP services
- **Pod details** — Container resource utilisation graphs

### Step 7.6 — Check Cloud Monitoring Uptime Check

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
  | jq '.uptimeCheckConfigs[] | {displayName, httpCheck: .httpCheck.path}'
```

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `N8N_AI_GKE` deployment. This removes all Kubernetes resources (Deployments, Services, HPA, namespace), Cloud SQL instance, NFS Filestore, GCS bucket, secrets, and IAM bindings.

### Manual Cleanup (if needed)

**kubectl:**
```bash
# Delete the namespace (removes all resources within it)
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8nai" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} \
    --project="${PROJECT}" --quiet
```

**REST API — delete namespace:**
```bash
curl -s -X DELETE \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/namespaces/${NAMESPACE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

> **Note:** Resources provisioned by the `Services_GCP` module (VPC, GKE cluster) are managed
> separately and must be undeployed via their own RAD UI deployment entry.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `n8nai` | Base name for Kubernetes resources |
| `application_version` | string | `2.4.7` | n8n container image version |
| `cpu_limit` | string | `2000m` | CPU limit per n8n pod (also used by Ollama) |
| `memory_limit` | string | `4Gi` | Memory limit per n8n pod (also used by Ollama) |
| `min_instance_count` | number | `0` | HPA minimum replicas |
| `max_instance_count` | number | `3` | HPA maximum replicas |
| `enable_ai_components` | bool | `true` | Master toggle for Qdrant + Ollama Deployments |
| `enable_qdrant` | bool | `true` | Deploy Qdrant as Kubernetes Deployment + ClusterIP Service |
| `qdrant_version` | string | `latest` | Qdrant Docker image tag |
| `enable_ollama` | bool | `true` | Deploy Ollama as Kubernetes Deployment + ClusterIP Service |
| `ollama_version` | string | `latest` | Ollama Docker image tag |
| `ollama_model` | string | `llama3.2` | Default LLM model loaded at startup |
| `enable_redis` | bool | `true` | Enable Redis queue mode for multi-replica n8n |
| `redis_host` | string | `""` | Redis host (auto-discovered from NFS when empty) |
| `enable_nfs` | bool | `true` | Provision Cloud Filestore NFS |
| `db_name` | string | `n8n_db` | PostgreSQL database name |
| `db_user` | string | `n8n_user` | PostgreSQL application user |
| `service_type` | string | `LoadBalancer` | Kubernetes Service type for n8n |

### Useful Commands

```bash
# Get all pods in namespace
kubectl get pods -n "${NAMESPACE}"

# Get all services in namespace
kubectl get services -n "${NAMESPACE}"

# View HPA
kubectl get hpa -n "${NAMESPACE}"

# View n8n logs
kubectl logs deployment/"${NAMESPACE}" -n "${NAMESPACE}" --tail=50

# View Ollama logs
kubectl logs deployment/"${NAMESPACE}-ollama" -n "${NAMESPACE}" --tail=50

# View Qdrant logs
kubectl logs deployment/"${NAMESPACE}-qdrant" -n "${NAMESPACE}" --tail=50

# Scale n8n
kubectl scale deployment "${NAMESPACE}" --replicas=2 -n "${NAMESPACE}"

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~n8nai"

# Test Ollama from within cluster
kubectl run curl-test --image=curlimages/curl --restart=Never -n "${NAMESPACE}" -- \
  curl -s "http://${NAMESPACE}-ollama.${NAMESPACE}.svc.cluster.local:11434/api/tags"
```

### Further Reading

- [n8n documentation](https://docs.n8n.io/)
- [Qdrant documentation](https://qdrant.tech/documentation/)
- [Ollama model library](https://ollama.com/library)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [GKE Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [Kubernetes HPA documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [n8n AI Agent node reference](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/)
