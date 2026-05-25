---
title: "Flowise on GKE — Lab Guide"
sidebar_label: "Flowise GKE"
---

# Flowise on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Flowise_GKE)**

This lab guide walks you through deploying, exploring, and operating **Flowise** — the
open-source visual AI workflow builder backed by Workday for enterprise deployments — on
Google Kubernetes Engine Autopilot using the **Flowise_GKE** module. You will connect to
the GKE cluster with kubectl, build LangChain and LlamaIndex pipelines via drag-and-drop,
call them via the Flowise REST API, and explore Kubernetes workloads, Workload Identity,
Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Flowise on GKE](#exercise-1--access-flowise-on-gke)
6. [Exercise 2 — Build a Chatflow](#exercise-2--build-a-chatflow)
7. [Exercise 3 — API Integration](#exercise-3--api-integration)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Workload Identity and Security](#exercise-5--workload-identity-and-security)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is Flowise on GKE?

Flowise is an open-source visual AI workflow builder that lets users construct LangChain and
LlamaIndex pipelines through a drag-and-drop interface. The `Flowise_GKE` module deploys
Flowise on GKE Autopilot with a custom container image built via Cloud Build, backed by
Cloud SQL PostgreSQL 15 and a GCS bucket for file storage. A Cloud SQL Auth Proxy sidecar
handles secure database connectivity via Unix socket. A Kubernetes LoadBalancer Service
exposes Flowise externally on port 3000, and an HPA manages pod scaling.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Visual Pipeline Builder** | Drag-and-drop chatflow and agentflow construction on GKE |
| **REST API** | Programmatic predictions via `POST /api/v1/prediction/<chatflow-id>` |
| **Kubernetes Workloads** | Deployment, Service (LoadBalancer), HPA, Cloud SQL Auth Proxy sidecar pod |
| **Workload Identity** | GKE Workload Identity binding Kubernetes SA to GCP SA for secretless GCP access |
| **GCS Storage** | Flowise uploads bucket for file attachments, API key files, and flow exports |
| **Cloud SQL Backend** | PostgreSQL 15 with Auth Proxy Unix socket — all `DATABASE_*` variables injected via entrypoint |
| **Observability** | kubectl logs, Cloud Logging for k8s_container, Cloud Monitoring CPU/memory metrics |
| **Scaling** | HPA scaling Flowise pods based on CPU utilisation |

---

## 2. Architecture

### Kubernetes Namespace Map

```
GKE Autopilot Cluster
  │
  └── Namespace: appflowise<tenant><id>
        │
        ├── Deployment: appflowise<tenant><id>   (Flowise)
        │     containers: flowise + cloud-sql-proxy
        │     service:    LoadBalancer  port 3000
        │     HPA:        min=1, max=1, CPU target=80%
        │
        └── ConfigMap / Secret: DB credentials, FLOWISE_PASSWORD
```

### Infrastructure

```
┌─────────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  GKE Autopilot Cluster (Services_GCP)                        │   │
│  │                                                              │   │
│  │  Namespace: appflowise<tenant><id>                           │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │  Flowise Pod (2/2)                                     │  │   │
│  │  │  flowise + cloud-sql-proxy sidecar                     │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  LoadBalancer ──► Flowise Service (external IP:3000)         │   │
│  │  HPA ──► Flowise Deployment                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Cloud SQL PostgreSQL 15    GCS Bucket                             │
│  db: flowisedb               <prefix>-flowise-uploads              │
│  Auth Proxy via Unix socket  STORAGE_TYPE=gcs                      │
│                                                                     │
│  Artifact Registry          Secret Manager     Cloud Monitoring    │
│  flowise custom image        FLOWISE_PASSWORD   pod CPU/memory      │
│  (built via Cloud Build)     DB password        HPA metrics        │
└─────────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Flowise_GKE
    container_port           = 3000     →  Flowise listening port
    min_instance_count       = 1        →  always warm, no cold starts
    enable_cloudsql_volume   = true     →  Auth Proxy sidecar in pod
    container_image_source   = custom   →  Cloud Build Dockerfile
    STORAGE_TYPE             = gcs      →  GCS bucket for uploads
    FLOWISE_PASSWORD         = Secret   →  auto-generated, Kubernetes Secret
    service_type             = LoadBalancer → external access on port 3000
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
roles/cloudsql.admin
roles/secretmanager.admin
roles/logging.viewer
roles/monitoring.viewer
roles/artifactregistry.reader
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

Deploy the `Flowise_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `flowise` | Base name (do not change after deploy) |
| `application_version` | `latest` | Flowise image version |
| `flowise_username` | `admin` | UI admin username |
| `min_instance_count` | `1` | Keep warm — recommended for AI workloads |
| `max_instance_count` | `1` | Increase for higher concurrency |
| `container_resources` | `cpu=1000m, mem=1Gi` | Pod resource limits |
| `application_database_name` | `flowisedb` | PostgreSQL database |
| `application_database_user` | `flowiseuser` | PostgreSQL user |
| `create_cloud_storage` | `true` | GCS bucket for uploads |
| `service_type` | `LoadBalancer` | External IP access |

Click **Deploy** and wait for provisioning (approximately 15–30 minutes, including Cloud Build image build and Cloud SQL provisioning).

> **What this provisions:** GKE namespace with Flowise Deployment (2 containers: flowise +
> cloud-sql-proxy), LoadBalancer Service on port 3000, HPA, Cloud SQL PostgreSQL 15, database
> init Kubernetes Job (`create-db-and-user.sh`), Artifact Registry repo with custom Flowise
> image, GCS bucket for uploads, Kubernetes Secret for `FLOWISE_PASSWORD`, Workload Identity
> for GCP service account binding, Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

echo "Cluster: ${CLUSTER}"

# Discover the database password secret
export FLOWISE_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~flowise" \
  --format="value(name)" \
  --limit=1)

echo "Secret: ${FLOWISE_SECRET}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info

# Discover the Flowise namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appflowise" | head -1)

echo "Namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get service -n "${NAMESPACE}" \
  -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')

echo "Flowise URL: http://${EXTERNAL_IP}:3000"
```

---

## Exercise 1 — Access Flowise on GKE

### Objective

Use kubectl to retrieve the Flowise LoadBalancer external IP, verify the Flowise pod is running with both containers healthy, retrieve admin credentials, and navigate the Flowise UI.

### Step 1.1 — List All Resources in the Namespace

**kubectl:**
```bash
kubectl get all -n "${NAMESPACE}"
```

**Expected result:** A Deployment, ReplicaSet, Pod, Service (LoadBalancer), and HPA for Flowise.

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status, currentNodeCount)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, status: .status, nodeCount: .currentNodeCount}'
```

### Step 1.2 — Verify Pod Status

```bash
kubectl get pods -n "${NAMESPACE}"
```

**Expected result:**
```
NAME                                READY   STATUS    RESTARTS   AGE
appflowise<id>-xxx-yyy              2/2     Running   0          5m
```

The pod shows `2/2` because it runs both the Flowise container and the Cloud SQL Auth Proxy sidecar.

### Step 1.3 — Describe the Pod

```bash
kubectl describe pod -l app="${NAMESPACE}" -n "${NAMESPACE}"
```

Inspect:
- Container names: `flowise` and `cloud-sql-proxy` (or similar)
- Resource limits: `cpu: 1000m, memory: 1Gi`
- Volume mounts: Cloud SQL socket at `/cloudsql`
- Environment variables (from ConfigMap and Secret references)

### Step 1.4 — Get the External IP

```bash
kubectl get service -n "${NAMESPACE}"
```

**Expected result:**
```
NAME                    TYPE           CLUSTER-IP    EXTERNAL-IP    PORT(S)
appflowise<id>          LoadBalancer   10.x.x.x      34.x.x.x       3000:XXXXX/TCP
```

### Step 1.5 — Retrieve Admin Password

**gcloud:**
```bash
gcloud secrets versions access latest \
  --secret="${FLOWISE_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${FLOWISE_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq -r '.payload.data' | base64 -d
```

### Step 1.6 — Access the Flowise UI

Open your browser and navigate to `http://${EXTERNAL_IP}:3000`.

Log in with:
- **Username:** `admin` (or your configured `flowise_username`)
- **Password:** retrieved in Step 1.5

**Expected result:** The Flowise dashboard loads. Explore the main sections: **Chatflows**, **Agentflows**, **Assistants**, and **Marketplace**.

---

## Exercise 2 — Build a Chatflow

### Objective

Create a complete working chatflow on GKE using drag-and-drop nodes — an LLM Chat Model, Buffer Memory, and Conversation Chain — then test multi-turn conversation to verify memory persistence in PostgreSQL.

### Step 2.1 — Create a New Chatflow

1. Navigate to **Chatflows** and click **Add New**
2. The canvas editor opens with an empty workspace

### Step 2.2 — Add a Chat Model Node

1. Search for `ChatOpenAI` or `ChatGoogleGenerativeAI` in the node panel
2. Drag it onto the canvas
3. Configure:
   - **API Key:** your OpenAI or Google AI API key
   - **Model Name:** `gpt-3.5-turbo` or `gemini-1.5-flash`
   - **Temperature:** `0.7`

### Step 2.3 — Add Memory and Chain Nodes

1. Search for `Buffer Memory` and drag it onto the canvas
2. Search for `Conversation Chain` and drag it onto the canvas
3. Connect:
   - **Chat Model** output → **Language Model** input of Conversation Chain
   - **Buffer Memory** output → **Memory** input of Conversation Chain

### Step 2.4 — Save and Test

1. Click **Save** and name the chatflow `GKE Chatflow`
2. Click the **Chat** icon to open the chat preview
3. Send test messages:
   - `Hello! My name is Jordan and I manage Kubernetes clusters.`
   - `What is GKE Autopilot?`
   - `What infrastructure do I manage?`

**Expected result:** The chatflow responds to each message and correctly recalls "Jordan" and "Kubernetes clusters" in the third message, demonstrating that Buffer Memory maintains conversation history stored in PostgreSQL on Cloud SQL.

### Step 2.5 — Export the Chatflow ID

Click on the chatflow and copy its ID from the URL:
```
http://${EXTERNAL_IP}:3000/chatflows/<chatflow-id>
```

```bash
export CHATFLOW_ID="<paste-your-chatflow-id>"
```

### Step 2.6 — Explore the Marketplace

1. Navigate to **Marketplace** in the left sidebar
2. Browse templates: RAG, Agent, Memory chatflows
3. Click a **RAG chatflow** template and select **Use Template**
4. Open the imported flow and identify the data source, vector store, and LLM nodes
5. Note the pre-wired connections — Marketplace templates are ready-to-use starting points

---

## Exercise 3 — API Integration

### Objective

Use the Flowise REST API to send chatflow predictions programmatically via curl, create an API key for authenticated access, and list available chatflows.

### Step 3.1 — Send a Prediction (Unauthenticated)

```bash
curl -X POST "http://${EXTERNAL_IP}:3000/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is GCP in one sentence?"}'
```

**gcloud (describe service for metadata):**
```bash
gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --filter="metadata.name~flowise"
```

**REST API — full prediction call:**
```bash
curl -s -X POST \
  "http://${EXTERNAL_IP}:3000/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is LangChain?",
    "overrideConfig": {"temperature": 0.3}
  }' | jq '{text: .text}'
```

**Expected result:** A JSON response with the model answer in the `text` field.

### Step 3.2 — Create an API Key

1. In the Flowise UI, navigate to **Settings → API Keys**
2. Click **Add New Key** and name it `gke-lab-key`
3. Copy the generated API key

```bash
export FLOWISE_API_KEY="<paste-your-api-key>"
```

### Step 3.3 — Send an Authenticated Prediction

```bash
curl -X POST "http://${EXTERNAL_IP}:3000/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${FLOWISE_API_KEY}" \
  -d '{"question": "Explain what Flowise does in one sentence."}'
```

**Expected result:** Same response structure as the unauthenticated call. API keys are stored in the PostgreSQL database (controlled by `APIKEY_STORAGE_TYPE=db`).

### Step 3.4 — List All Chatflows

```bash
curl -s "http://${EXTERNAL_IP}:3000/api/v1/chatflows" \
  -H "Authorization: Bearer ${FLOWISE_API_KEY}" \
  | jq '[.[] | {id: .id, name: .name, deployed: .deployed}]'
```

### Step 3.5 — Verify Environment from Inside the Pod

```bash
kubectl exec -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c flowise -- env | grep -E "DATABASE_TYPE|STORAGE_TYPE|FLOWISE_USERNAME|APIKEY_STORAGE_TYPE"
```

**Expected result:** `DATABASE_TYPE=postgres`, `STORAGE_TYPE=gcs`, `FLOWISE_USERNAME=admin`, `APIKEY_STORAGE_TYPE=db` — confirming the `flowise-entrypoint.sh` variable mappings are applied.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the Kubernetes Deployment, pod spec, resource limits, Cloud SQL Auth Proxy sidecar, volume mounts, and HPA configuration for Flowise on GKE Autopilot.

### Step 4.1 — Describe the Flowise Deployment

**kubectl:**
```bash
kubectl describe deployment "${NAMESPACE}" -n "${NAMESPACE}"
```

Inspect:
- **Replicas:** 1 desired / 1 available
- **Strategy:** RollingUpdate
- **Image:** custom Flowise image from Artifact Registry
- **Containers:** `flowise` + `cloud-sql-proxy`
- **Environment:** `DATABASE_TYPE`, `STORAGE_TYPE`, `FLOWISE_USERNAME`

**gcloud:**
```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, version: .currentMasterVersion}'
```

### Step 4.2 — Inspect Resource Limits

```bash
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.containers[*].resources}' | jq .
```

**Expected result:** Flowise container shows `cpu: 1000m, memory: 1Gi` limits.

### Step 4.3 — Inspect the Cloud SQL Auth Proxy Sidecar

```bash
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.containers[*].name}' | tr ' ' '\n'
```

**Expected result:** Two containers — `flowise` and `cloud-sql-proxy` (or similar name).

```bash
# View Cloud SQL proxy container details
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.containers[1]}' | jq '{name: .name, image: .image, args: .args}'
```

**Expected result:** The proxy container shows the Cloud SQL instance connection string as an argument.

### Step 4.4 — Inspect Volume Mounts

```bash
kubectl get pod -n "${NAMESPACE}" \
  -l app="${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.containers[0].volumeMounts}' | jq .
```

**Expected result:** A volume mounted at `/cloudsql` for the Cloud SQL Auth Proxy Unix socket.

### Step 4.5 — Inspect the HPA

```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:**
```
NAME                    REFERENCE                        TARGETS   MINPODS   MAXPODS   REPLICAS
appflowise<id>          Deployment/appflowise<id>        5%/80%    1         1         1
```

### Step 4.6 — Scale the Deployment

```bash
# Scale to 2 replicas to test multi-instance handling
kubectl scale deployment "${NAMESPACE}" \
  --replicas=2 \
  -n "${NAMESPACE}"

kubectl get pods -n "${NAMESPACE}" -w
```

**Expected result:** A second pod starts within 1–2 minutes. Both pods connect to the same Cloud SQL instance via the Auth Proxy.

```bash
# Scale back to 1
kubectl scale deployment "${NAMESPACE}" \
  --replicas=1 \
  -n "${NAMESPACE}"
```

---

## Exercise 5 — Workload Identity and Security

### Objective

Explore GKE Workload Identity configuration that binds the Kubernetes service account to a GCP service account, enabling the Flowise pod to access Cloud SQL and Secret Manager without static credentials.

### Step 5.1 — List Service Accounts in the Namespace

**kubectl:**
```bash
kubectl get serviceaccounts -n "${NAMESPACE}"
```

### Step 5.2 — Inspect the Workload Identity Annotation

```bash
kubectl get serviceaccounts -n "${NAMESPACE}" \
  -o yaml | grep -A5 "annotations:"
```

**Expected result:** An annotation `iam.gke.io/gcp-service-account: <sa>@<project>.iam.gserviceaccount.com` binding the Kubernetes service account to a GCP service account.

**gcloud — list GCP service accounts:**
```bash
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~flowise" \
  --format="table(email, displayName)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.accounts[] | select(.email | test("flowise")) | {email, displayName}'
```

### Step 5.3 — Verify the IAM Binding

```bash
gcloud iam service-accounts get-iam-policy \
  "$(gcloud iam service-accounts list \
    --project="${PROJECT}" \
    --filter="email~flowise" \
    --format="value(email)" \
    --limit=1)" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.bindings[] | select(.role == "roles/iam.workloadIdentityUser")'
```

**Expected result:** A binding granting `roles/iam.workloadIdentityUser` to the Kubernetes service account, enabling Workload Identity federation.

### Step 5.4 — Verify Secret Manager Access

The Flowise pod accesses the admin password secret via Workload Identity:

```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~flowise" \
  --format="table(name, replication.automatic, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:flowise" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name, createTime: .createTime}'
```

### Step 5.5 — Inspect the FLOWISE_PASSWORD in the Pod

```bash
kubectl exec -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c flowise -- env | grep FLOWISE_PASSWORD | wc -c
```

**Expected result:** A non-zero character count confirming `FLOWISE_PASSWORD` is set (the value should be the 32-character generated password, confirming Secret Manager resolution via Workload Identity is working).

### Step 5.6 — Review Audit Logs for Secret Access

```bash
gcloud logging read \
  "protoPayload.serviceName=\"secretmanager.googleapis.com\" \
   AND protoPayload.resourceName=~\"flowise\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {timestamp, method: .protoPayload.methodName, caller: .protoPayload.authenticationInfo.principalEmail}'
```

---

## Exercise 6 — Cloud Logging

### Objective

View and analyse Flowise container logs using both kubectl and Cloud Logging, stream live logs during API calls, and filter by container name to isolate Flowise vs Cloud SQL Auth Proxy output.

### Step 6.1 — View Flowise Container Logs with kubectl

```bash
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c flowise \
  --tail=50
```

**Expected result:** Flowise startup log including `Flowise Server: Running` and database connection success messages.

### Step 6.2 — View Cloud SQL Proxy Sidecar Logs

```bash
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app="${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -c cloud-sql-proxy \
  --tail=30
```

**Expected result:** Cloud SQL Auth Proxy startup messages confirming the Unix socket is listening for connections.

### Step 6.3 — Query All Namespace Logs via Cloud Logging

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

### Step 6.4 — Filter for API Prediction Logs

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND jsonPayload.message=~\"prediction\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="value(timestamp, jsonPayload.message)"
```

Trigger an API call while watching:
```bash
# In one terminal:
kubectl logs -n "${NAMESPACE}" deployment/"${NAMESPACE}" -c flowise -f

# In another terminal:
curl -X POST "http://${EXTERNAL_IP}:3000/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is a vector database?"}'
```

### Step 6.5 — Open Cloud Logging Console

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22k8s_container%22%20AND%20resource.labels.namespace_name%3D%22${NAMESPACE}%22?project=${PROJECT}"
```

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Inspect pod CPU and memory metrics, monitor HPA scaling behaviour, verify the uptime check, and build a custom Cloud Monitoring dashboard for the Flowise GKE deployment.

### Step 7.1 — View Pod Resource Usage

**kubectl:**
```bash
kubectl top pods -n "${NAMESPACE}"
kubectl top nodes
```

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project="${PROJECT}" \
  | grep -E "cpu|memory"
```

### Step 7.2 — Query CPU Usage via REST API

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

**Expected result:** CPU usage for the `flowise` and `cloud-sql-proxy` containers.

### Step 7.3 — Query Memory Usage

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

### Step 7.4 — Monitor HPA Scaling

Generate load to trigger HPA scaling by sending concurrent predictions:

```bash
for i in {1..10}; do
  curl -s -X POST "http://${EXTERNAL_IP}:3000/api/v1/prediction/${CHATFLOW_ID}" \
    -H "Content-Type: application/json" \
    -d "{\"question\": \"Count to ${i} in Spanish.\"}" &
done
wait

kubectl get hpa -n "${NAMESPACE}" -w
```

**Expected result:** HPA metrics show elevated CPU, and if `max_instance_count > 1`, additional pods are scheduled.

### Step 7.5 — Verify the Uptime Check

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
  | jq '.uptimeCheckConfigs[] | {displayName, path: .httpCheck.path, period: .period}'
```

**Expected result:** An uptime check probing the Flowise service endpoint, showing `Healthy` status.

### Step 7.6 — Open GKE Workloads Console

```bash
echo "https://console.cloud.google.com/kubernetes/workload?project=${PROJECT}"
```

Explore the **Workloads** tab to view the Flowise Deployment's rollout history, replica count, and resource utilisation graphs directly in the GCP Console.

### Step 7.7 — Open Monitoring Dashboard

```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

Build a custom chart with:
- **Resource type:** `Kubernetes Container`
- **Metric:** `kubernetes.io/container/cpu/request_utilization`
- **Filter:** `namespace_name = ${NAMESPACE}`
- **Group by:** `container_name`

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Flowise_GKE` deployment. This removes all Kubernetes resources (Deployment, Service, HPA, namespace), Cloud SQL instance, GCS bucket, Artifact Registry images, Secret Manager secrets, Cloud Monitoring uptime checks, and IAM bindings.

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
  --filter="name~flowise" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} \
    --project="${PROJECT}" --quiet

# Delete Cloud SQL instance
gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~flowise" \
  --format="value(name)" \
  | xargs -I{} gcloud sql instances delete {} \
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
| `application_name` | string | `flowise` | Base name for Kubernetes resources (do not change after deploy) |
| `application_version` | string | `latest` | Flowise container image version tag |
| `flowise_username` | string | `admin` | Flowise UI admin username |
| `container_resources` | object | `cpu=1000m, mem=1Gi` | Pod CPU and memory limits |
| `min_instance_count` | number | `1` | Minimum pod replicas |
| `max_instance_count` | number | `1` | Maximum pod replicas |
| `container_port` | number | `3000` | Flowise listening port |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar in pod |
| `application_database_name` | string | `flowisedb` | PostgreSQL database name |
| `application_database_user` | string | `flowiseuser` | PostgreSQL application user |
| `database_password_length` | number | `32` | Auto-generated DB password length |
| `service_type` | string | `LoadBalancer` | Kubernetes Service type |
| `create_cloud_storage` | bool | `true` | Provision GCS uploads bucket |
| `enable_iap` | bool | `false` | Identity-Aware Proxy |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for automated backup |
| `gke_cluster_name` | string | auto-discover | Target GKE cluster name |

### Useful Commands

```bash
# Get all resources in namespace
kubectl get all -n "${NAMESPACE}"

# View Flowise pod logs
kubectl logs deployment/"${NAMESPACE}" -n "${NAMESPACE}" -c flowise --tail=50

# View Cloud SQL proxy logs
kubectl logs deployment/"${NAMESPACE}" -n "${NAMESPACE}" -c cloud-sql-proxy --tail=30

# Get external IP
kubectl get service -n "${NAMESPACE}"

# View HPA status
kubectl get hpa -n "${NAMESPACE}"

# Scale deployment
kubectl scale deployment "${NAMESPACE}" --replicas=2 -n "${NAMESPACE}"

# Health check
curl -I "http://${EXTERNAL_IP}:3000/api/v1/ping"

# List chatflows via API
curl "http://${EXTERNAL_IP}:3000/api/v1/chatflows" -H "Authorization: Bearer ${FLOWISE_API_KEY}"

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~flowise"

# Check uptime monitors
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

### Further Reading

- [Flowise documentation](https://docs.flowiseai.com/)
- [Flowise GitHub repository](https://github.com/FlowiseAI/Flowise)
- [Flowise API reference](https://docs.flowiseai.com/using-flowise/api)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [GKE Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy on Kubernetes](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [LangChain documentation](https://python.langchain.com/docs/introduction/)
