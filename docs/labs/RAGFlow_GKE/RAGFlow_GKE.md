---
title: "RAGFlow on GKE Autopilot — Lab Guide"
sidebar_label: "RAGFlow GKE"
---

# RAGFlow on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/RAGFlow_GKE)**

## Overview

**Estimated time:** 2–3 hours

RAGFlow is an intelligent document analysis and RAG (Retrieval-Augmented Generation) engine. It processes documents (PDF, Word, HTML, etc.) into searchable knowledge bases using Elasticsearch for vector indexing and Redis for task queuing. This lab deploys RAGFlow on GKE Autopilot with a managed Cloud SQL MySQL 8.0 backend and GCS for artifact storage.

### What the Module Automates

- GKE Autopilot cluster (via Services_GCP prerequisite)
- Cloud SQL MySQL 8.0 instance and database/user creation
- Cloud SQL Auth Proxy sidecar injection into the RAGFlow pod
- Kubernetes namespace, Deployment, and LoadBalancer Service
- Cloud Storage bucket for document artifacts
- Artifact Registry repository and container image build via Cloud Build
- Secret Manager secrets (database password, Redis auth)
- Workload Identity binding for least-privilege GCS and SQL access
- NFS Filestore instance (optional, for shared upload staging)
- Static external IP reservation
- Cloud Monitoring uptime checks and alert policies

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Connect `kubectl` to the GKE cluster
- Verify RAGFlow pod health and review startup logs
- Register an admin account and explore the RAGFlow UI
- Create a Knowledge Base and upload documents
- Configure an LLM API key and build a RAG chatbot
- Explore different chunking methods and document types
- Test the RAGFlow REST API with a generated API key
- Review Cloud Logging and Cloud Monitoring dashboards

---

## CLI and REST API Overview

This lab uses the following CLI tools:

| Tool | Purpose |
|---|---|
| `gcloud` | GCP project and cluster management |
| `kubectl` | Kubernetes workload inspection |
| `curl` | RAGFlow REST API testing |

Key REST APIs exercised:

| API | Base URL |
|---|---|
| RAGFlow Knowledge Base | `http://<EXTERNAL_IP>/api/v1/knowledge_bases` |
| RAGFlow Chat | `http://<EXTERNAL_IP>/api/v1/chat_assistants` |
| RAGFlow Health | `http://<EXTERNAL_IP>/v1/health` |
| GKE Cluster API | `https://container.googleapis.com/v1/projects/{project}/locations/{region}/clusters` |

---

## Prerequisites

Before deploying, ensure the following:

1. **Services_GCP** module is deployed (provides VPC, GKE cluster, Memorystore Redis, Cloud SQL instance).
2. **Elasticsearch_GKE** module is deployed and its `elasticsearch_endpoint` output is available.
3. `gcloud` CLI is authenticated: `gcloud auth application-default login`
4. `kubectl` is installed.
5. You have a GCP project with billing enabled.
6. Access to the RAD UI with permission to deploy modules in the target GCP project.
7. (Optional) An OpenAI API key or other LLM endpoint for the chatbot phase.

---

## Phase 1 — Deploy [AUTOMATED]

**Duration:** 20–35 minutes

### Variables

In the RAD UI, open the RAGFlow_GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `region` | No | `us-central1` | GCP region for deployment |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `tenant_deployment_id` | No | `demo` | Environment identifier (e.g., `prod`, `dev`) |
| `application_name` | No | `ragflow` | Internal app identifier (must be lowercase) |
| `application_version` | No | `v0.13.0` | RAGFlow version tag; increment to trigger a new build |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `gke_cluster_name` | No | auto-discovered | Name of the GKE Autopilot cluster |
| `db_name` | No | `rag_flow` | MySQL database name |
| `db_user` | No | `ragflow` | MySQL database user |
| `database_password_length` | No | `32` | Length of the auto-generated database password |
| `elasticsearch_hosts` | No | `""` | Elasticsearch HTTP endpoint (e.g., `http://10.0.0.5:9200`) |
| `elasticsearch_username` | No | `""` | Elasticsearch username (leave blank if security disabled) |
| `enable_redis` | No | `true` | Enable Redis task queue backend |
| `redis_host` | No | `""` | Redis server IP (from Services_GCP Memorystore output) |
| `redis_port` | No | `6379` | Redis server port |
| `cpu_limit` | No | `4000m` | CPU limit per RAGFlow container |
| `memory_limit` | No | `8Gi` | Memory limit per RAGFlow container |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS for shared storage |
| `create_cloud_storage` | No | `true` | Provision GCS bucket for document artifacts |
| `container_image_source` | No | `custom` | `custom` builds from Dockerfile; `prebuilt` uses an existing image |
| `enable_inline_elasticsearch` | No | `false` | Deploy a dev-only single-node Elasticsearch alongside RAGFlow |

### Deploy

Click **Deploy** in the RAD UI.

### Approximate Phase Durations

| Step | Duration |
|---|---|
| Cloud Build (container image) | 8–15 minutes |
| GKE Deployment rollout (RAGFlow startup with Elasticsearch init) | 5–15 minutes |
| Total | **~20–35 minutes** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name |
| `service_url` | External service URL (may show IP) |
| `service_external_ip` | External IP for the LoadBalancer |
| `namespace` | Kubernetes namespace where RAGFlow is deployed |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | MySQL database name |
| `database_user` | MySQL database username |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `storage_buckets` | GCS bucket names |
| `nfs_server_ip` | NFS server internal IP (sensitive) |
| `container_image` | Full image URI deployed |
| `kubernetes_ready` | True when all Kubernetes resources are provisioned |

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

# Discover the namespace (pattern: appragflow<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appragflow" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~ragflow" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Connect kubectl and Verify Pods [MANUAL]

**Duration:** 5 minutes

### Steps

1. Fetch GKE credentials:

   ```bash
   gcloud container clusters get-credentials <CLUSTER_NAME> \
     --region <REGION> \
     --project <PROJECT_ID>
   ```

   **gcloud equivalent for listing clusters:**
   ```bash
   gcloud container clusters list --project <PROJECT_ID>
   ```

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://container.googleapis.com/v1/projects/<PROJECT_ID>/locations/<REGION>/clusters"
   ```

2. List pods in the RAGFlow namespace:

   ```bash
   kubectl get pods -n "${NAMESPACE}"
   ```

   **Expected result:** One or more pods in `Running` state. RAGFlow may take several minutes after the pod is `Running` before the UI is fully available — Elasticsearch initialization runs on first boot.

3. Check RAGFlow logs:

   ```bash
   kubectl logs -n "${NAMESPACE}" -l app=ragflow --tail=50
   ```

   Watch for log lines indicating Elasticsearch connection success and the web server starting on port 80.

4. Note the external IP:

   ```bash
   kubectl get service -n "${NAMESPACE}"
   ```

---

## Phase 3 — Access RAGFlow and Initial Setup [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open your browser and navigate to:

   ```
   http://${EXTERNAL_IP}
   ```

   RAGFlow serves the web UI on port 80.

2. On the registration page, create an admin account:
   - Enter an email address and password.
   - Click **Sign Up**.

3. Log in with the credentials you just created.

4. Explore the main navigation:
   - **Knowledge Base** — where document collections live.
   - **Chat** — where you create RAG-powered chatbot assistants.
   - **Files** — global document management.
   - **Settings** — LLM configuration and API key management.

   **Expected result:** The RAGFlow dashboard loads with empty Knowledge Base and Chat sections.

5. **gcloud logging equivalent** (view RAGFlow startup logs from Cloud Logging):

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=<PROJECT_ID> \
     --limit=50 \
     --format="table(timestamp,textPayload)"
   ```

---

## Phase 4 — Create a Knowledge Base [MANUAL]

**Duration:** 10–15 minutes

### Steps

1. Click **Knowledge Base** in the top navigation bar.

2. Click **+ Create Knowledge Base**.

3. Fill in the form:
   - **Name:** `GCP Documentation` (or any name you choose)
   - **Chunking method:** Select **General** to start
   - **Embedding model:** Select the available embedding model (configured in Settings)

4. Click **Save**.

5. Inside the Knowledge Base, click **+ Add File** (or drag and drop).
   - Upload a PDF or plain-text document (e.g., a GCP product overview PDF, a technical whitepaper, or any document under 50 MB).

6. Click **Parse** to start the ingestion pipeline.
   - RAGFlow will chunk, embed, and index the document into Elasticsearch.
   - Monitor progress via the status indicator next to the document name.

   **Expected result:** The document status changes from `Parsing` to `Done`. The chunk count is displayed.

7. Click the document name to view the resulting chunks and their metadata (page number, token count, embedding vector preview).

8. **REST API equivalent** (list knowledge bases):

   ```bash
   API_KEY="<your-ragflow-api-key>"

   curl -H "Authorization: Bearer $API_KEY" \
     "http://${EXTERNAL_IP}/api/v1/knowledge_bases"
   ```

---

## Phase 5 — Create a RAG Chatbot [MANUAL]

**Duration:** 10 minutes

### Steps

1. Click **Chat** in the top navigation bar.

2. Click **+ Create Assistant**.

3. Configure the assistant:
   - **Name:** `GCP Assistant`
   - **System prompt:** (optional) e.g., `You are a helpful assistant that answers questions based only on the provided documents.`

4. Under **Knowledge Base**, select the knowledge base you created in Phase 4 (`GCP Documentation`).

5. Under **LLM Settings**:
   - Navigate to **Settings > Model Providers** first.
   - Add your LLM provider (e.g., OpenAI — paste your API key).
   - Return to the assistant configuration and select the model.

6. Click **Save**.

7. In the chat window on the right, type a question about your uploaded document.

   **Expected result:** RAGFlow retrieves relevant chunks from the knowledge base and generates a cited answer. Source citations appear below the response, showing which document chunks were used.

8. Ask several follow-up questions to observe the retrieval quality.

---

## Phase 6 — Explore Document Analysis [MANUAL]

**Duration:** 10–15 minutes

### Steps

1. Return to **Knowledge Base** and open your existing knowledge base (or create a new one for this experiment).

2. Upload different document types:
   - A `.docx` Word document
   - A `.txt` plain text file
   - A second `.pdf` with tabular data

3. Try different chunking methods by editing the knowledge base settings:
   - **General** — splits by paragraph and sentence boundaries
   - **Q&A** — optimized for FAQ-style documents
   - **Manual** — you define chunk boundaries
   - **Table** — specialized for structured tabular data

4. Re-parse the document after changing the chunking method and compare the resulting chunks.

   **Expected result:** Different chunking strategies produce different chunk sizes and boundaries. Q&A mode extracts question-answer pairs explicitly; Table mode preserves row/column structure.

5. Examine chunk metadata: token count, embedding status, and source coordinates (page, bounding box for PDFs).

---

## Phase 7 — API Access [MANUAL]

**Duration:** 10 minutes

### Steps

1. In the RAGFlow UI, go to **Settings > API Key**.

2. Click **Generate API Key**. Copy the key — it will not be shown again.

3. Set variables and test the API:

   ```bash
   API_KEY="<paste-your-api-key>"

   # List knowledge bases
   curl -s -H "Authorization: Bearer $API_KEY" \
     "http://${EXTERNAL_IP}/api/v1/knowledge_bases" | python3 -m json.tool

   # List chat assistants
   curl -s -H "Authorization: Bearer $API_KEY" \
     "http://${EXTERNAL_IP}/api/v1/chat_assistants" | python3 -m json.tool

   # Check service health
   curl -s "http://${EXTERNAL_IP}/v1/health"
   ```

   **Expected result:** JSON responses listing your knowledge bases and assistants. The health endpoint returns `{"code": 0}`.

4. Explore the interactive API documentation at:

   ```
   http://${EXTERNAL_IP}/api/v1/docs
   ```

---

## Phase 8 — Explore Cloud Logging [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open the [Cloud Logging console](https://console.cloud.google.com/logs).

2. Set the project to your GCP project.

3. Query RAGFlow application logs:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="ragflow"
   ```

   **gcloud equivalent:**
   ```bash
   gcloud logging read \
     "resource.type=\"k8s_container\" resource.labels.namespace_name=\"${NAMESPACE}\" resource.labels.container_name=\"ragflow\"" \
     --project=<PROJECT_ID> \
     --limit=100 \
     --format="table(timestamp,severity,textPayload)"
   ```

4. Filter for document parsing events by adding:
   ```
   textPayload=~"parse|chunk|embed|elastic"
   ```

5. Query Elasticsearch sidecar logs (if using inline Elasticsearch):

   ```
   resource.type="k8s_container"
   resource.labels.container_name="elasticsearch"
   ```

   **Expected result:** Log entries showing Elasticsearch cluster health checks, indexing operations, and RAGFlow task queue activity.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open the [Cloud Monitoring console](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and look for the GKE workload dashboard.

3. View key metrics for the RAGFlow deployment:

   ```bash
   # gcloud equivalent: list available GKE metrics
   gcloud monitoring metrics list \
     --filter="metric.type=starts_with(\"kubernetes.io/container\")" \
     --project=<PROJECT_ID>
   ```

4. Check CPU and memory utilization for the RAGFlow pods:
   - Metric: `kubernetes.io/container/cpu/limit_utilization`
   - Metric: `kubernetes.io/container/memory/limit_utilization`
   - Filter by: `namespace_name = ${NAMESPACE}`, `container_name = ragflow`

5. Review the uptime check status (if configured):

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://monitoring.googleapis.com/v3/projects/<PROJECT_ID>/uptimeCheckConfigs"
   ```

   **Expected result:** Uptime checks show green (passing) status after RAGFlow finishes its initial startup. CPU and memory graphs show the resource usage of the embedding model and Elasticsearch operations.

---

## Phase 10 — Undeploy [AUTOMATED]

**Duration:** 10–15 minutes

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**What is removed:** Kubernetes Deployment, Service, namespace, Cloud SQL instance and database, GCS bucket(s), Secret Manager secrets, Artifact Registry images, NFS Filestore instance, static IP, Cloud Monitoring uptime checks.

**What is not removed:** The GKE cluster itself (managed by Services_GCP), the VPC (managed by Services_GCP), Elasticsearch (managed by Elasticsearch_GKE).

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action | Duration |
|---|---|---|---|
| 1 — Deploy | Automated | RAD UI deployment provisions GKE workload, Cloud SQL, GCS, Artifact Registry | 20–35 min |
| 2 — Verify Pods | Manual | `kubectl get pods`, check logs, note external IP | 5 min |
| 3 — Initial Setup | Manual | Register admin account, explore RAGFlow UI | 5 min |
| 4 — Knowledge Base | Manual | Upload document, parse and chunk, view results | 10–15 min |
| 5 — RAG Chatbot | Manual | Create assistant, connect LLM, ask questions | 10 min |
| 6 — Document Analysis | Manual | Try different doc types and chunking methods | 10–15 min |
| 7 — API Access | Manual | Generate API key, test REST endpoints | 10 min |
| 8 — Cloud Logging | Manual | Query container logs and parsing events | 5 min |
| 9 — Cloud Monitoring | Manual | Review GKE metrics and uptime checks | 5 min |
| 10 — Undeploy | Automated | RAD UI removes all module resources | 10–15 min |
