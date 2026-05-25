# RAGFlow on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/RAGFlow_GKE)**

RAGFlow is an open-source document intelligence and Retrieval-Augmented Generation (RAG) engine
with 80,000+ GitHub stars. Unlike generic RAG frameworks, RAGFlow is purpose-built for deep
document understanding — it correctly parses PDFs, tables, and visual layouts before chunking
and retrieval. The `RAGFlow_GKE` module deploys RAGFlow on GKE Autopilot with a managed Cloud
SQL MySQL 8.0 backend, Cloud SQL Auth Proxy sidecar, NFS for shared document processing, and
GCS for artifact storage.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access RAGFlow](#exercise-1--access-ragflow)
6. [Exercise 2 — Upload Documents and Build Knowledge Base](#exercise-2--upload-documents-and-build-knowledge-base)
7. [Exercise 3 — Create Chat Application and Test Q&A](#exercise-3--create-chat-application-and-test-qa)
8. [Exercise 4 — API Integration](#exercise-4--api-integration)
9. [Exercise 5 — Kubernetes Workloads](#exercise-5--kubernetes-workloads)
10. [Exercise 6 — Security and Workload Identity](#exercise-6--security-and-workload-identity)
11. [Exercise 7 — Cloud Logging and Monitoring](#exercise-7--cloud-logging-and-monitoring)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is RAGFlow?

RAGFlow is an open-source **document intelligence and RAG platform** that ingests PDFs, Word
documents, HTML pages, and other formats, chunks and embeds them using configurable strategies,
stores vectors in Elasticsearch, and exposes a REST API for question-answering and enterprise
search. The `RAGFlow_GKE` module deploys version **v0.13.0** on GKE Autopilot with ClientIP
session affinity (ensuring upload sessions reach the same pod), NFS for shared processing, and
Workload Identity for least-privilege GCP API access.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Document Intelligence** | PDF/DOCX/HTML ingestion with layout-aware chunking and embedding |
| **Knowledge Base Management** | Named collections with configurable chunking strategies |
| **RAG Chat** | LLM-powered Q&A with source citations from document chunks |
| **REST API** | Programmatic knowledge base and chat assistant management |
| **GKE Autopilot** | Managed Kubernetes with auto-provisioned nodes and Workload Identity |
| **Cloud SQL Auth Proxy** | Secure sidecar-based MySQL 8.0 access via Unix socket |
| **Workload Identity** | Pod-level IAM binding — no service account key files |
| **NFS Storage** | Shared document processing via Cloud Filestore |

---

## 2. Architecture

```
Browser / API Client
        │
        ▼
LoadBalancer Service (external IP, port 80)
  │   ClientIP session affinity
  ▼
RAGFlow Deployment (GKE Autopilot)
   ├── RAGFlow container (port 80, Nginx + Python workers)
   │       ├── Document ingestion pipeline (parse → chunk → embed)
   │       ├── REST API (/api/v1/...)
   │       └── Web UI (Knowledge Base, Chat, Files, Settings)
   └── Cloud SQL Auth Proxy sidecar (127.0.0.1:3306)
```

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  GKE Autopilot Cluster                                             │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  ragflow namespace (appragflow<tenant><id>)                   │  │ │
│  │  │                                                              │  │  │
│  │  │  RAGFlow Deployment                                          │  │  │
│  │  │    containers: [ragflow, cloud-sql-proxy]                    │  │  │
│  │  │    session_affinity: ClientIP                                │  │  │
│  │  │    min_replicas: 1  max_replicas: 5                         │  │   │
│  │  │                                                              │  │  │
│  │  │  db-init Job (mysql:8.0-debian)                              │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                    │  │
│  │  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐  │   │
│  │  │  LoadBalancer  │  │ Workload       │  │  NFS (Filestore)    │  │   │
│  │  │  Service       │  │ Identity       │  │  /mnt/nfs           │  │   │
│  │  │  (external IP) │  │ (SA binding)   │  │  (shared docs)      │  │   │
│  │  └────────────────┘  └────────────────┘  └─────────────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │  Cloud SQL       │  │  Elasticsearch   │  │  Memorystore Redis    │   │
│  │  MySQL 8.0       │  │  GKE (external   │  │  (task queue)         │   │
│  │  (private IP)    │  │   LoadBalancer)  │  │                       │   │
│  └──────────────────┘  └──────────────────┘  └───────────────────────┘   │
│                                                                          │
│  Module variable wiring:                                                 │
│    RAGFlow_GKE                                                           │
│      service_type       = LoadBalancer   → external IP                   │
│      session_affinity   = ClientIP       → sticky upload sessions        │
│      enable_nfs         = true           → shared document processing    │
│      reserve_static_ip  = true           → stable external IP            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
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

Deploy the `RAGFlow_GKE` module via the RAD UI. **Prerequisites:** `Services_GCP` and
`Elasticsearch_GKE` must be deployed first. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `elasticsearch_hosts` | `http://<ES_IP>:9200` | From Elasticsearch_GKE output |
| `redis_host` | `<REDIS_IP>` | From Services_GCP Memorystore output |
| `enable_redis` | `true` | Required for document processing workers |
| `enable_nfs` | `true` | Shared document processing (default) |
| `cpu_limit` | `4000m` | RAGFlow is CPU-intensive |
| `memory_limit` | `8Gi` | Embedding models require significant RAM |

Click **Deploy** and wait for provisioning (approximately 20–35 minutes).

> **What this provisions:** GKE Autopilot namespace, Cloud SQL MySQL 8.0, Cloud SQL Auth Proxy
> sidecar, Kubernetes Deployment with LoadBalancer service, GCS bucket, NFS Filestore, Secret
> Manager secrets, Artifact Registry repository and custom container image via Cloud Build, and
> Cloud Monitoring uptime checks.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

echo "GKE cluster: ${CLUSTER}"

# Discover database password secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="value(name)" \
  --limit=1)
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes

# Discover the RAGFlow namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appragflow" | head -1)

echo "RAGFlow namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "RAGFlow URL: http://${EXTERNAL_IP}"
```

---

## Exercise 1 — Access RAGFlow

### Objective

Verify RAGFlow pod health, obtain the external IP, and complete the initial admin account
registration via the web UI.

### Step 1.1 — Verify Pod Health

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"
# Expected: pods in Running state with containers: ragflow + cloud-sql-proxy

kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\t"}{range .status.containerStatuses[*]}{.name}={.ready}{" "}{end}{"\n"}{end}'
```

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status, currentNodeCount)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, currentNodeCount: .currentNodeCount}'
```

**Expected result:** RAGFlow pod shows `Running` status. Allow 5–15 minutes after deployment
for the startup probe to pass (RAGFlow loads embedding models on first boot).

### Step 1.2 — Get External IP and Check Health

```bash
kubectl get service -n "${NAMESPACE}"

# Wait for EXTERNAL-IP assignment (may take a few minutes)
kubectl get service -n "${NAMESPACE}" -w

# Check health endpoint
curl -s "http://${EXTERNAL_IP}/v1/health"
# Expected: {"code": 0}
```

### Step 1.3 — Review Startup Logs

```bash
# View RAGFlow container logs
kubectl logs -n "${NAMESPACE}" \
  -l app=ragflow \
  -c ragflow \
  --tail=50

# View Cloud SQL Auth Proxy sidecar logs
kubectl logs -n "${NAMESPACE}" \
  -l app=ragflow \
  -c cloud-sql-proxy \
  --tail=20
```

**Expected result:** Log lines showing Elasticsearch connection success and the web server
starting on port 80.

### Step 1.4 — Create the Admin Account

Navigate to `http://${EXTERNAL_IP}` in your browser:

1. Register an admin account with an email and password.
2. Log in with the credentials you created.
3. Explore the main navigation: **Knowledge Base**, **Chat**, **Files**, **Settings**.

**Expected result:** The RAGFlow dashboard loads with all sections empty on a fresh deployment.

---

## Exercise 2 — Upload Documents and Build Knowledge Base

### Objective

Upload multiple document types, trigger the RAGFlow parsing pipeline, compare chunking
strategies, and build a knowledge base ready for retrieval.

### Step 2.1 — Configure Embedding Model

1. Navigate to **Settings > Model Providers**.
2. Add an embedding provider (e.g., OpenAI — enter your API key).
3. Save the configuration.

### Step 2.2 — Create a Knowledge Base

1. Navigate to **Knowledge Base** and click **+ Create Knowledge Base**.
2. Configure:
   - **Name:** `Lab Documents`
   - **Chunking method:** `General`
   - **Embedding model:** select your configured model
3. Click **Save**.

### Step 2.3 — Upload and Parse Documents

1. Inside the knowledge base, click **+ Add File**.
2. Upload a PDF document (under 50 MB).
3. Click **Parse** to trigger ingestion.

**Expected result:** Document status changes from `Parsing` to `Done`.

### Step 2.4 — Inspect Chunks and Embeddings

Click the document name to review:
- **Chunk content** and **page numbers**
- **Token count** per chunk
- **Embedding status** (green = indexed in Elasticsearch)

### Step 2.5 — Compare Chunking Strategies

Upload a second document and try different chunking methods:

**gcloud (view parsing logs):**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   resource.labels.container_name=\"ragflow\" \
   textPayload=~\"parse|chunk|embed|elastic\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries showing chunk generation and Elasticsearch indexing operations
for each document parsing run.

### Step 2.6 — Verify GCS Document Storage

**kubectl (check storage bucket env var):**
```bash
kubectl get deployment -n "${NAMESPACE}" -o yaml \
  | grep -A2 "BUCKET\|STORAGE"
```

**gcloud:**
```bash
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="value(name)" --limit=1)

gcloud storage ls --recursive "gs://${BUCKET}/" \
  --project="${PROJECT}" | head -20
```

**Expected result:** Document files and embeddings are stored in the GCS bucket organized by
knowledge base and document ID.

---

## Exercise 3 — Create Chat Application and Test Q&A

### Objective

Configure a RAG chat assistant linked to the knowledge base and test the full retrieval and
generation pipeline.

### Step 3.1 — Create a Chat Assistant

1. Navigate to **Chat** and click **+ Create Assistant**.
2. Configure:
   - **Name:** `Lab Assistant`
   - **System prompt:** `You are a helpful assistant that answers questions based only on the provided documents. Always cite your sources.`
   - **Knowledge Base:** select `Lab Documents`
   - **LLM Settings:** select your configured LLM provider
3. Click **Save**.

### Step 3.2 — Test Q&A with Source Citations

Ask questions about document content. Verify that:
- The response is grounded in the uploaded documents.
- Source citations appear below each answer.
- Clicking a citation shows the source chunk.

**Expected result:** Cited answers from document chunks with similarity scores above 0.2.

### Step 3.3 — Test Multi-Turn Conversation

Ask follow-up questions that require context from previous responses to verify stateful
multi-turn RAG behavior.

### Step 3.4 — Query via API

```bash
# Set API key (from Settings > API Key in the RAGFlow UI)
export API_KEY="<your-ragflow-api-key>"

# List chat assistants
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "http://${EXTERNAL_IP}/api/v1/chat_assistants" \
  | jq '.data[] | {id, name}'

# List knowledge bases
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "http://${EXTERNAL_IP}/api/v1/knowledge_bases" \
  | jq '.data[] | {id, name, doc_num, chunk_num}'
```

**Expected result:** JSON responses confirming the assistant and knowledge base are configured.

---

## Exercise 4 — API Integration

### Objective

Demonstrate programmatic access to RAGFlow through the REST API — listing resources, querying
the chat assistant, and integrating with external applications.

### Step 4.1 — Generate an API Key

1. Navigate to **Settings > API Key** in the RAGFlow UI.
2. Click **Generate API Key**. Copy the key.

```bash
export API_KEY="<paste-your-api-key>"
```

### Step 4.2 — Test Core API Endpoints

**Health check:**
```bash
curl -s "http://${EXTERNAL_IP}/v1/health"
```

**List knowledge bases:**
```bash
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "http://${EXTERNAL_IP}/api/v1/knowledge_bases" \
  | jq '.data[] | {id, name, doc_num, chunk_num, embedding_model}'
```

**List chat assistants:**
```bash
curl -s -H "Authorization: Bearer ${API_KEY}" \
  "http://${EXTERNAL_IP}/api/v1/chat_assistants" \
  | jq '.data[] | {id, name, kb_ids}'
```

### Step 4.3 — Send a Query via API

```bash
# Get assistant ID
ASSISTANT_ID=$(curl -s -H "Authorization: Bearer ${API_KEY}" \
  "http://${EXTERNAL_IP}/api/v1/chat_assistants" \
  | jq -r '.data[0].id')

# Start a session
SESSION=$(curl -s -X POST \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name": "api-session"}' \
  "http://${EXTERNAL_IP}/api/v1/chat_assistants/${ASSISTANT_ID}/sessions" \
  | jq -r '.data.id')

# Send a query
curl -s -X POST \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"question\": \"Summarize the main topics in the documents.\",
       \"session_id\": \"${SESSION}\"}" \
  "http://${EXTERNAL_IP}/api/v1/chat_assistants/${ASSISTANT_ID}/completions" \
  | jq '.data.answer'
```

**Expected result:** A JSON response with the LLM-generated answer and source chunk references.

### Step 4.4 — Browse Interactive API Documentation

Navigate to `http://${EXTERNAL_IP}/api/v1/docs` for the Swagger API documentation.

---

## Exercise 5 — Kubernetes Workloads

### Objective

Inspect the Kubernetes resources provisioned by the module, scale the deployment, and observe
how GKE Autopilot manages pod scheduling.

### Step 5.1 — Inspect the Deployment

**kubectl:**
```bash
kubectl describe deployment ragflow -n "${NAMESPACE}"

# Check container resources and probes
kubectl get deployment ragflow -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[*].name}' | tr ' ' '\n'

# View resource requests
kubectl top pods -n "${NAMESPACE}"
```

**Expected result:** Deployment shows `ragflow` and `cloud-sql-proxy` containers, resource
limits, startup/liveness probes targeting `/v1/health`, and Workload Identity annotations.

### Step 5.2 — Inspect the LoadBalancer Service

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}" -o wide

kubectl describe service -n "${NAMESPACE}"
# Note: sessionAffinity: ClientIP ensures upload sessions reach the same pod
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --filter="name~ragflow"
```

### Step 5.3 — Scale the Deployment

```bash
kubectl scale deployment ragflow \
  --replicas=2 \
  -n "${NAMESPACE}"

kubectl get pods -n "${NAMESPACE}" -w

# Verify both pods are running
kubectl get pods -n "${NAMESPACE}"
```

**Expected result:** GKE Autopilot automatically provisions a node for the second pod.
Both pods show Running status with both containers ready.

### Step 5.4 — Inspect the db-init Job

```bash
# View initialization jobs
kubectl get jobs -n "${NAMESPACE}"

# Describe the db-init job
kubectl describe job -n "${NAMESPACE}" \
  $(kubectl get jobs -n "${NAMESPACE}" \
    -o jsonpath='{.items[0].metadata.name}')

# View job logs
kubectl logs -n "${NAMESPACE}" \
  -l job-name=$(kubectl get jobs -n "${NAMESPACE}" \
    -o jsonpath='{.items[0].metadata.name}')
```

**Expected result:** The `db-init` job completed successfully, creating the `rag_flow` database
and `ragflow` MySQL user before the application started.

### Step 5.5 — View HPA Configuration

```bash
kubectl get hpa -n "${NAMESPACE}"

kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA configured with min=1, max=5 replicas with CPU-based autoscaling.

---

## Exercise 6 — Security and Workload Identity

### Objective

Verify Workload Identity binding, inspect Secret Manager secrets, and confirm that pods access
GCP APIs without service account key files.

### Step 6.1 — Verify Workload Identity Annotation

**kubectl:**
```bash
kubectl get serviceaccount -n "${NAMESPACE}" -o yaml \
  | grep -A5 "annotations:"
```

The annotation `iam.gke.io/gcp-service-account` links the Kubernetes service account to a
GCP IAM service account — this is the Workload Identity binding.

**gcloud:**
```bash
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~ragflow" \
  --format="table(email, displayName)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.accounts[] | select(.email | test("ragflow")) | {email, displayName}'
```

### Step 6.2 — Verify IAM Binding

**gcloud:**
```bash
SA_EMAIL=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~ragflow" \
  --format="value(email)" \
  --limit=1)

gcloud iam service-accounts get-iam-policy "${SA_EMAIL}" \
  --project="${PROJECT}"
```

**Expected result:** The IAM policy shows `roles/iam.workloadIdentityUser` binding for the
Kubernetes service account in the RAGFlow namespace.

### Step 6.3 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ragflow" \
  --format="table(name, createTime)"

# Access the database password secret
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aragflow" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | {name, createTime}'
```

### Step 6.4 — Review Audit Logs

**gcloud:**
```bash
gcloud logging read \
  "protoPayload.serviceName=secretmanager.googleapis.com \
   AND protoPayload.methodName=~\"AccessSecretVersion\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {
    timestamp,
    method: .protoPayload.methodName,
    caller: .protoPayload.authenticationInfo.principalEmail,
    resource: .protoPayload.resourceName
  }'
```

**Expected result:** Audit log entries show the RAGFlow GCP service account accessing the
database password secret during pod startup.

---

## Exercise 7 — Cloud Logging and Monitoring

### Objective

Query GKE container logs for application events and parsing activity, then review Cloud
Monitoring dashboards for container resource utilization and uptime check status.

### Step 7.1 — View Application Logs in the Console

```bash
echo "https://console.cloud.google.com/logs?project=${PROJECT}"
```

Use the following filter:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="ragflow"
```

### Step 7.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   resource.labels.container_name=\"ragflow\"" \
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
    \"filter\": \"resource.type=\\\"k8s_container\\\" resource.labels.namespace_name=\\\"${NAMESPACE}\\\"\",
    \"pageSize\": 50
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 7.3 — Filter for Parsing Events

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   textPayload=~\"parse|chunk|embed|elastic|index\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Entries showing document chunking, embedding generation, and Elasticsearch
indexing steps during document parsing runs.

### Step 7.4 — Stream Live Logs with kubectl

```bash
kubectl logs -f \
  -n "${NAMESPACE}" \
  -l app=ragflow \
  -c ragflow
```

Trigger a document parse in the UI and observe the real-time output.

### Step 7.5 — Review Cloud Monitoring Dashboards

```bash
echo "https://console.cloud.google.com/monitoring?project=${PROJECT}"
```

**gcloud (check uptime checks):**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period)"
```

**REST API (query GKE container CPU):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** CPU utilization shows elevated usage during document parsing (embedding
model inference). Memory usage reflects the embedding model in RAM (~2–4 Gi).

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `RAGFlow_GKE` deployment. This removes the
Kubernetes Deployment, Service, namespace, Cloud SQL instance and database, GCS bucket(s),
Secret Manager secrets, Artifact Registry images, NFS Filestore instance, and static IP.

**Note:** The GKE cluster itself is managed by `Services_GCP` and is not deleted.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete static IP
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="name~ragflow"

gcloud compute addresses delete <address-name> \
  --region="${REGION}" --project="${PROJECT}" --quiet

# Delete Secret Manager secrets
gcloud secrets list --project="${PROJECT}" --filter="name~ragflow" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete GKE namespace resources:**
```bash
curl -s -X DELETE \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/namespaces/${NAMESPACE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

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
| `redis_host` | string | `""` | Redis server IP (auto-resolved from NFS IP if empty) |
| `redis_port` | string | `6379` | Redis server port |
| `cpu_limit` | string | `4000m` | CPU limit per RAGFlow container |
| `memory_limit` | string | `8Gi` | Memory limit per RAGFlow container |
| `min_instance_count` | number | `1` | Minimum pod replicas (hard-capped at 1) |
| `max_instance_count` | number | `5` | Maximum pod replicas |
| `gke_cluster_name` | string | `""` | GKE cluster name (auto-discovered when empty) |
| `db_name` | string | `rag_flow` | MySQL database name |
| `db_user` | string | `ragflow` | MySQL database user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `enable_nfs` | bool | `true` | Cloud Filestore NFS for shared document processing |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS volume mount path in container |
| `service_type` | string | `LoadBalancer` | Kubernetes Service type |
| `session_affinity` | string | `ClientIP` | Sticky sessions for upload operations |
| `reserve_static_ip` | bool | `true` | Reserve global static external IP |
| `deployment_timeout` | number | `1800` | Terraform rollout timeout (RAGFlow startup is slow) |

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
# Get external IP
kubectl get service -n "${NAMESPACE}"

# Check pod health
kubectl get pods -n "${NAMESPACE}"

# View RAGFlow logs
kubectl logs -n "${NAMESPACE}" -l app=ragflow -c ragflow --tail=50

# View Auth Proxy logs
kubectl logs -n "${NAMESPACE}" -l app=ragflow -c cloud-sql-proxy --tail=20

# Stream live logs
kubectl logs -f -n "${NAMESPACE}" -l app=ragflow

# Scale deployment
kubectl scale deployment ragflow --replicas=2 -n "${NAMESPACE}"

# Check resource usage
kubectl top pods -n "${NAMESPACE}"

# Port-forward for local access
kubectl port-forward svc/ragflow 8080:80 -n "${NAMESPACE}"
# Then: curl http://localhost:8080/v1/health

# View HPA
kubectl get hpa -n "${NAMESPACE}"
```

### Further Reading

- [RAGFlow GitHub repository](https://github.com/infiniflow/ragflow)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy on GKE](https://cloud.google.com/sql/docs/mysql/connect-kubernetes-engine)
- [Cloud Filestore for GKE](https://cloud.google.com/filestore/docs/accessing-fileshares)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
