# n8n AI on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE)**

## Overview

**Estimated time:** 1–2 hours

n8n AI extends the standard n8n workflow automation platform with integrated AI capabilities. This module deploys the n8n AI Starter Kit on GKE Autopilot, adding a **Qdrant** vector database (for embeddings and semantic search) and an **Ollama** LLM server (for local model inference) as separate Kubernetes Deployments alongside n8n. Together they enable building AI agent workflows, RAG (Retrieval-Augmented Generation) pipelines, and intelligent chatbots — all running on your own infrastructure with no external AI API dependencies.

### What the Module Automates

All GKE services from N8N_GKE, plus:
- Qdrant vector database Kubernetes Deployment and ClusterIP Service
- Ollama LLM server Kubernetes Deployment and ClusterIP Service
- ClusterIP-based service discovery for Qdrant (port 6333) and Ollama (port 11434)
- HPA for n8n; Qdrant and Ollama run as fixed-replica Deployments
- Cloud SQL PostgreSQL 15, NFS Filestore, GCS Fuse persistence
- Workload Identity, Secret Manager, and IAM for all components
- Private VPC networking between n8n, Qdrant, and Ollama

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Complete the n8n initial account setup on first login
- Build standard workflows (webhook, trigger, HTTP)
- Create AI Agent workflows connecting to Ollama
- Configure Qdrant as a vector store for embeddings
- Build a complete RAG pipeline

---

## CLI and REST API Overview

**Tools used:**
- `gcloud` CLI — GCP resource management
- `kubectl` — Kubernetes cluster operations
- `curl` — webhook, HTTP, and AI API testing

---

## Prerequisites

- A GCP project with the Services_GCP platform module already deployed
- `gcloud` CLI authenticated: `gcloud auth login && gcloud config set project PROJECT_ID`
- `kubectl` installed
- Owner or Editor role on the target GCP project
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the N8N_AI_GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for resource names |
| `region` | No | `us-central1` | GCP region for deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier (1–20 chars) |
| `application_name` | No | `n8nai` | Base name for Kubernetes and Artifact Registry resources |
| `application_version` | No | `2.4.7` | n8n image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | HPA minimum pod replicas |
| `max_instance_count` | No | `3` | HPA maximum pod replicas |
| `cpu_limit` | No | `2000m` | CPU limit per n8n pod |
| `memory_limit` | No | `4Gi` | Memory limit per n8n pod |
| `enable_redis` | No | `true` | Enable Redis queue mode backend |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP when empty) |
| `redis_port` | No | `6379` | Redis server port |
| `db_name` | No | `n8n_db` | PostgreSQL database name |
| `db_user` | No | `n8n_user` | PostgreSQL database username |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS |
| `nfs_mount_path` | No | `/mnt/nfs` | Container mount path for NFS volume |
| `enable_ai_components` | No | `true` | Master toggle for Qdrant + Ollama |
| `enable_qdrant` | No | `true` | Deploy Qdrant vector database |
| `qdrant_version` | No | `latest` | Qdrant Docker image tag |
| `enable_ollama` | No | `true` | Deploy Ollama LLM server |
| `ollama_version` | No | `latest` | Ollama Docker image tag |
| `ollama_model` | No | `llama3.2` | Default LLM model to load on startup |
| `service_type` | No | `LoadBalancer` | Kubernetes Service type for n8n |
| `session_affinity` | No | `None` | Session stickiness (None for AI workloads) |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Deploy

Click **Deploy** in the RAD UI. Deployment takes approximately 12–18 minutes. Ollama downloads the model on first startup, which may add an additional few minutes.

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `service_url` | Application URL |
| `database_instance_name` | Cloud SQL instance name |
| `nfs_server_ip` | NFS server IP (sensitive) |
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

# Discover the namespace (pattern: appn8naidemo<deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appn8nai" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~n8nai" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Configure kubectl and Verify Pods [MANUAL]

### Step 2.1 — Get GKE Credentials

```bash
gcloud container clusters get-credentials <cluster-name> \
  --region <region> \
  --project <project-id>
```

### Step 2.2 — Verify All Pods are Running

```bash
kubectl get pods --all-namespaces | grep n8nai
# Or with the namespace directly:
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** Three running pods — n8n (with Cloud SQL Auth Proxy sidecar), Qdrant, and Ollama:

```
NAME                                  READY   STATUS    RESTARTS   AGE
appn8naidemo<id>-xxx-yyy              2/2     Running   0          5m
appn8naidemo<id>-qdrant-xxx-yyy       1/1     Running   0          5m
appn8naidemo<id>-ollama-xxx-yyy       1/1     Running   0          5m
```

### Step 2.3 — Verify Qdrant and Ollama Services

```bash
kubectl get services -n ${NAMESPACE}
```

**Expected result:** ClusterIP services for Qdrant (port 6333) and Ollama (port 11434) alongside the n8n LoadBalancer service:

```
NAME                          TYPE           CLUSTER-IP    EXTERNAL-IP   PORT(S)
appn8naidemo<id>              LoadBalancer   10.x.x.x      34.x.x.x      5678:XXX/TCP
appn8naidemo<id>-qdrant       ClusterIP      10.x.x.x      <none>        6333/TCP,6334/TCP
appn8naidemo<id>-ollama       ClusterIP      10.x.x.x      <none>        11434/TCP
```

### Step 2.4 — Get Internal Service Endpoints

Note the internal DNS names for Qdrant and Ollama — you will use these when configuring n8n AI nodes:

- **Qdrant:** `http://appn8naidemo<id>-qdrant.appn8naidemo<id>.svc.cluster.local:6333`
- **Ollama:** `http://appn8naidemo<id>-ollama.appn8naidemo<id>.svc.cluster.local:11434`

**gcloud equivalent:**
```bash
gcloud container clusters list --project <project-id>
```

---

## Phase 3 — Explore the n8n Workflow Editor [MANUAL]

### Step 3.1 — Access the n8n UI

```bash
kubectl get service -n ${NAMESPACE}
```

Open your browser and navigate to `http://${EXTERNAL_IP}:5678`.

For local port-forward access:
```bash
kubectl port-forward service/${NAMESPACE} 5678:5678 -n ${NAMESPACE}
# Then open http://localhost:5678
```

### Step 3.2 — Create an Admin Account

On first launch, create an owner account with your email and a strong password. The n8n encryption key is stored in Secret Manager; credentials are stored in PostgreSQL.

**Expected result:** You are redirected to the n8n canvas.

### Step 3.3 — Tour the Canvas and Create a Simple Workflow

1. Click **+ New workflow**.
2. Add a **Manual Trigger** node, then an **HTTP Request** node (URL: `https://httpbin.org/get`).
3. Add a **Set** node and set a value: Name = `message`, Value = `Hello from n8n AI`.
4. **Save** and **Execute workflow**.

**Expected result:** All nodes turn green. Each node shows its input/output data.

---

## Phase 4 — Webhooks and Triggers [MANUAL]

### Step 4.1 — Create a Webhook Workflow

1. Create a new workflow with a **Webhook** node (Method: `POST`, Path: `ai-test`).
2. Add a **Set** node to record the payload: `received = {{ $json.body }}`
3. **Save** and click **Listen for Test Event**.

### Step 4.2 — Test the Webhook

```bash
curl -X POST http://${EXTERNAL_IP}:5678/webhook-test/ai-test \
  -H "Content-Type: application/json" \
  -d '{"query": "Tell me about vector databases", "user": "lab-user"}'
```

**Expected result:** The Webhook node receives the payload and displays it in the UI.

### Step 4.3 — Scheduled Trigger

Create a workflow with a **Schedule Trigger** (every 1 minute) → **HTTP Request** → **Save and Activate**. Verify an execution appears after one minute, then deactivate.

---

## Phase 5 — Credential Management [MANUAL]

### Step 5.1 — Add Credentials

In any workflow, add an **HTTP Request** node. Click **Authentication → Basic Auth → Create New Credential**. Enter credentials and save.

### Step 5.2 — View Secrets in Secret Manager

```bash
gcloud secrets list --project <project-id> | grep n8nai
```

**Expected result:** Secrets for the n8n encryption key and database password appear, encrypted at rest.

---

## Phase 6 — Workflow History and Error Handling [MANUAL]

### Step 6.1 — View Execution History

Open any workflow and click **Executions** (clock icon). View completed and failed execution records.

```bash
# View pod logs for execution events
kubectl logs -n ${NAMESPACE} deployment/${NAMESPACE} -c ${NAMESPACE} --tail=100
```

### Step 6.2 — Add Error Handling

1. Add an **Error Trigger** node to a workflow.
2. Connect it to a **Set** node that records `error = true`.
3. Deliberately fail the main workflow (use an invalid URL in HTTP Request).
4. Execute and verify the error branch fires.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View n8n Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project <project-id> \
  --limit 50 \
  --format "value(timestamp, jsonPayload.message)"
```

### Step 7.2 — View Ollama Logs

```bash
kubectl logs -n ${NAMESPACE} deployment/${NAMESPACE}-ollama --tail=50
```

**Expected result:** Ollama startup logs showing model loading and inference server ready messages.

### Step 7.3 — View Qdrant Logs

```bash
kubectl logs -n ${NAMESPACE} deployment/${NAMESPACE}-qdrant --tail=50
```

**Expected result:** Qdrant startup logs confirming the vector database is ready and listening on port 6333.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### Step 8.1 — View Pod Metrics

Navigate to **Cloud Monitoring → Metrics Explorer**:
- **Resource type:** `k8s_container`
- **Metric:** `kubernetes.io/container/cpu/core_usage_time`
- **Filter:** `namespace_name = ${NAMESPACE}`

**Expected result:** CPU time-series for n8n, Qdrant, and Ollama pods.

### Step 8.2 — Check HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
kubectl describe hpa -n ${NAMESPACE}
```

**Expected result:** HPA details for the n8n deployment showing current/target CPU utilization and replica counts.

---

## Phase 9 — Scaling [MANUAL]

### Step 9.1 — Examine HPA Configuration

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:**
```
NAME               REFERENCE                      TARGETS   MINPODS   MAXPODS   REPLICAS
appn8naidemo<id>   Deployment/appn8naidemo<id>   10%/80%   0         3         1
```

Qdrant and Ollama run as fixed single-replica Deployments — scale them manually if needed for higher throughput.

### Step 9.2 — Manually Scale n8n Workers

```bash
kubectl scale deployment/${NAMESPACE} --replicas=2 -n ${NAMESPACE}
kubectl get pods -n ${NAMESPACE} -w
```

---

## Phase 10 — AI Agent Workflows [MANUAL]

### Step 10.1 — Verify Ollama is Ready

Test Ollama directly from within the cluster using a temporary pod:

```bash
kubectl run curl-test --image=curlimages/curl --restart=Never -n ${NAMESPACE} -- \
  curl -s http://${NAMESPACE}-ollama.${NAMESPACE}.svc.cluster.local:11434/api/tags
kubectl logs curl-test -n ${NAMESPACE}
kubectl delete pod curl-test -n ${NAMESPACE}
```

**Expected result:** JSON response listing the loaded model (e.g., `llama3.2`).

### Step 10.2 — Create an AI Agent Workflow

1. In n8n, click **+ New workflow**.
2. Add a **Manual Trigger** node.
3. Click **+** and search for **AI Agent** node. Select it.
4. In the AI Agent node configuration:
   - Click **Chat Model** → Add a model. Search for **Ollama**.
   - Set the **Base URL** to the internal Ollama endpoint:
     ```
     http://appn8naidemo<id>-ollama.appn8naidemo<id>.svc.cluster.local:11434
     ```
   - Set **Model** to `llama3.2` (or the model configured in `ollama_model`)
5. In the **Prompt** field, set:
   ```
   You are a helpful assistant. Answer this question: {{ $json.question }}
   ```
6. Add a **Set** node before the AI Agent to inject a test question:
   - Name: `question`, Value: `What is Kubernetes?`
7. Connect: Manual Trigger → Set → AI Agent.
8. **Save** and **Execute workflow**.

**Expected result:** The AI Agent node shows the LLM response. The output contains a text explanation of Kubernetes generated locally by Ollama. Response time depends on the model size — llama3.2 takes 5–30 seconds on CPU.

### Step 10.3 — Test with a Webhook Input

1. Replace the Manual Trigger with a **Webhook** node (Path: `ask-ai`, Method: `POST`).
2. Change the AI Agent prompt to: `Answer this question: {{ $json.body.question }}`
3. **Save** the workflow and **Activate** it.
4. Send a test request:

```bash
curl -X POST http://${EXTERNAL_IP}:5678/webhook/ask-ai \
  -H "Content-Type: application/json" \
  -d '{"question": "Explain vector databases in simple terms."}'
```

**Expected result:** The webhook returns a JSON response containing the Ollama-generated answer.

---

## Phase 11 — Vector Store Integration [MANUAL]

### Step 11.1 — Verify Qdrant is Ready

```bash
kubectl run curl-test --image=curlimages/curl --restart=Never -n ${NAMESPACE} -- \
  curl -s http://appn8naidemo<id>-qdrant.appn8naidemo<id>.svc.cluster.local:6333/collections
kubectl logs curl-test -n ${NAMESPACE}
kubectl delete pod curl-test -n ${NAMESPACE}
```

**Expected result:** `{"result":{"collections":[]},"status":"ok","time":0.0001}` — Qdrant is running with no collections yet.

### Step 11.2 — Create a Vector Store Workflow

This workflow accepts text, generates embeddings via Ollama, and stores them in Qdrant.

1. Create a new workflow with a **Webhook** trigger (Path: `store-document`, Method: `POST`).
2. Add an **Embeddings Ollama** node:
   - Set **Base URL**: `http://appn8naidemo<id>-ollama.appn8naidemo<id>.svc.cluster.local:11434`
   - Set **Model** to an embedding model such as `nomic-embed-text` (or `llama3.2` for text embeddings)
3. Add a **Qdrant Vector Store** node (Insert operation):
   - Set **Qdrant URL**: `http://appn8naidemo<id>-qdrant.appn8naidemo<id>.svc.cluster.local:6333`
   - Set **Collection Name**: `documents`
   - Connect the embeddings output
4. **Save** and **Activate** the workflow.

**Test document ingestion:**

```bash
curl -X POST http://${EXTERNAL_IP}:5678/webhook/store-document \
  -H "Content-Type: application/json" \
  -d '{"text": "Kubernetes is an open-source container orchestration platform.", "id": "doc-001"}'

curl -X POST http://${EXTERNAL_IP}:5678/webhook/store-document \
  -H "Content-Type: application/json" \
  -d '{"text": "Qdrant is a vector database optimized for similarity search.", "id": "doc-002"}'
```

**Expected result:** Documents are embedded and stored in Qdrant. Verify by checking the collection:

```bash
kubectl run curl-test --image=curlimages/curl --restart=Never -n ${NAMESPACE} -- \
  curl -s "http://appn8naidemo<id>-qdrant.appn8naidemo<id>.svc.cluster.local:6333/collections/documents"
kubectl logs curl-test -n ${NAMESPACE}
kubectl delete pod curl-test -n ${NAMESPACE}
```

**Expected result:** Collection info shows `vectors_count: 2`.

### Step 11.3 — Retrieve Similar Documents

1. Create a new workflow with a **Webhook** trigger (Path: `search-documents`, Method: `POST`).
2. Add an **Embeddings Ollama** node to embed the search query.
3. Add a **Qdrant Vector Store** node (Search operation):
   - Same Qdrant URL and collection name
   - Set **Limit** to `3`
4. Add a **Set** node to format the results.
5. **Save** and **Activate**.

**Test similarity search:**

```bash
curl -X POST http://${EXTERNAL_IP}:5678/webhook/search-documents \
  -H "Content-Type: application/json" \
  -d '{"query": "What is container orchestration?"}'
```

**Expected result:** The response returns the most similar documents from Qdrant. The Kubernetes document should rank highest for this query.

---

## Phase 12 — RAG Pipeline [MANUAL]

Build a complete Retrieval-Augmented Generation pipeline that retrieves context from Qdrant and generates a grounded answer using Ollama.

### Step 12.1 — Document Ingestion Workflow

Reuse or extend the ingestion workflow from Phase 11. Add a **Text Splitter** node before embedding to chunk large documents:

1. **Webhook** (Path: `ingest`) → **Text Splitter** (chunk size: 500 chars) → **Embeddings Ollama** → **Qdrant Vector Store** (Insert)

Ingest several sample documents:

```bash
curl -X POST http://${EXTERNAL_IP}:5678/webhook/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "GKE Autopilot is a managed Kubernetes service where Google manages the underlying infrastructure. It provides automatic scaling, patching, and node management. Users only pay for the resources their workloads consume.", "source": "gke-docs"}'

curl -X POST http://${EXTERNAL_IP}:5678/webhook/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "Cloud SQL is a fully managed relational database service supporting PostgreSQL, MySQL, and SQL Server. It provides automated backups, replication, and failover. PostgreSQL 15 supports advanced JSON features and improved performance.", "source": "cloudsql-docs"}'
```

### Step 12.2 — Query Workflow with Context Retrieval and LLM Response

1. Create a new workflow with a **Webhook** trigger (Path: `rag-query`, Method: `POST`).
2. **Embeddings Ollama** node — embed the incoming query.
3. **Qdrant Vector Store** (Search) — retrieve the top 3 similar document chunks.
4. **Code** node — assemble the context prompt:
   ```javascript
   const query = $input.first().json.query;
   const docs = $input.all().map(d => d.json.payload.text).join('\n\n');
   return [{
     json: {
       prompt: `Use the following context to answer the question.\n\nContext:\n${docs}\n\nQuestion: ${query}\n\nAnswer:`
     }
   }];
   ```
5. **Ollama** node (or AI Agent with Ollama Chat Model) — generate the answer using the assembled prompt.
6. **Respond to Webhook** node — return the answer to the caller.

**Test the RAG pipeline:**

```bash
curl -X POST http://${EXTERNAL_IP}:5678/webhook/rag-query \
  -H "Content-Type: application/json" \
  -d '{"query": "How does GKE Autopilot handle node management?"}'
```

**Expected result:** A contextually grounded answer about GKE Autopilot, referencing the ingested document rather than relying solely on the model's training data. The response should mention that Google manages the infrastructure and users pay for consumed resources.

### Step 12.3 — Compare RAG vs. Direct LLM

Test the same question directly against Ollama without context retrieval to see how grounding improves accuracy:

```bash
kubectl run curl-test --image=curlimages/curl --restart=Never -n ${NAMESPACE} -- \
  curl -s -X POST \
  http://appn8naidemo<id>-ollama.appn8naidemo<id>.svc.cluster.local:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.2", "prompt": "How does GKE Autopilot handle node management?", "stream": false}'
kubectl logs curl-test -n ${NAMESPACE}
kubectl delete pod curl-test -n ${NAMESPACE}
```

**Expected result:** A more generic answer from the base model without the specific details from your ingested documents. This demonstrates the value of RAG — the retrieved context anchors the LLM's response to your actual data.

---

## Phase 13 — Undeploy [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module. This removes all Kubernetes resources (n8n, Qdrant, Ollama Deployments and Services), Cloud SQL instance, NFS Filestore, GCS buckets, secrets, and IAM bindings.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Activity | Method |
|---|---|---|
| 1 | Deploy n8n AI on GKE Autopilot | Automated (RAD UI) |
| 2 | Configure kubectl, verify all pods | Manual (gcloud, kubectl) |
| 3 | Access UI, create first workflow | Manual (browser) |
| 4 | Webhooks and scheduled triggers | Manual (browser + curl) |
| 5 | Credential management | Manual (browser) |
| 6 | Execution history, error handling | Manual (browser) |
| 7 | Cloud Logging — n8n, Ollama, Qdrant logs | Manual (gcloud / kubectl) |
| 8 | Cloud Monitoring — pod metrics | Manual (console) |
| 9 | HPA scaling configuration | Manual (kubectl) |
| 10 | AI Agent workflow with Ollama LLM | Manual (browser + curl) |
| 11 | Qdrant vector store — store and search | Manual (browser + curl) |
| 12 | RAG pipeline — end-to-end document QA | Manual (browser + curl) |
| 13 | Undeploy all resources | Automated (RAD UI) |
