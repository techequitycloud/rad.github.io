# RAGFlow on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

RAGFlow is an intelligent document analysis and RAG (Retrieval-Augmented Generation) engine. It processes documents (PDF, Word, HTML, etc.) into searchable knowledge bases using Elasticsearch for vector indexing and Redis for task queuing. This lab deploys RAGFlow on Cloud Run Gen2 with a managed Cloud SQL MySQL 8.0 backend, Serverless VPC Access for private service connectivity, and GCS for document artifact storage.

### What the Module Automates

- Cloud Run Gen2 service with Cloud SQL Auth Proxy sidecar
- Cloud SQL MySQL 8.0 instance and database/user creation
- Serverless VPC Access connector for Redis and SQL private networking
- Cloud Storage bucket for document artifacts
- Artifact Registry repository and container image build via Cloud Build
- Secret Manager secrets (database password, Redis auth)
- Cloud Run service account with least-privilege IAM bindings
- NFS Filestore instance (optional, requires gen2)
- Cloud Monitoring uptime checks and alert policies
- Cloud Run Jobs for initialization and scheduled tasks

### What You Do Manually

- Note the service URL from the RAD UI deployment panel
- Verify the service health endpoint
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
| `gcloud` | GCP project and Cloud Run management |
| `curl` | RAGFlow REST API and health check testing |

Key REST APIs exercised:

| API | Base URL |
|---|---|
| RAGFlow Knowledge Base | `https://<SERVICE_URL>/api/v1/knowledge_bases` |
| RAGFlow Chat | `https://<SERVICE_URL>/api/v1/chat_assistants` |
| RAGFlow Health | `https://<SERVICE_URL>/v1/health` |
| Cloud Run Service API | `https://run.googleapis.com/v2/projects/{project}/locations/{region}/services` |

---

## Prerequisites

Before deploying, ensure the following:

1. **Services_GCP** module is deployed (provides VPC, Serverless VPC Access connector, Memorystore Redis, Cloud SQL instance).
2. **Elasticsearch_GKE** module is deployed and its `elasticsearch_endpoint` output (the LoadBalancer external IP on port 9200) is available.
3. `gcloud` CLI is authenticated: `gcloud auth application-default login`
4. You have a GCP project with billing enabled.
5. (Optional) An OpenAI API key or other LLM endpoint for the chatbot phase.
6. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

**Duration:** 15–25 minutes

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `region` | No | `us-central1` | GCP region for deployment |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `tenant_deployment_id` | No | `demo` | Environment identifier (e.g., `prod`, `dev`) |
| `application_name` | No | `ragflow` | Internal app identifier (must be lowercase) |
| `application_version` | No | `v0.13.0` | RAGFlow version tag; increment to trigger a new revision |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum warm Cloud Run instances (0 = scale-to-zero) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances |
| `cpu_limit` | No | `2000m` | CPU per Cloud Run instance |
| `memory_limit` | No | `4Gi` | Memory per Cloud Run instance |
| `db_name` | No | `rag_flow` | MySQL database name |
| `db_user` | No | `ragflow` | MySQL database user |
| `database_password_length` | No | `32` | Length of the auto-generated database password |
| `elasticsearch_hosts` | No | `""` | Elasticsearch endpoint (e.g., `http://10.0.0.5:9200`) |
| `elasticsearch_username` | No | `""` | Elasticsearch username (leave blank if security disabled) |
| `enable_redis` | No | `true` | Enable Redis task queue backend |
| `redis_host` | No | `""` | Redis server IP (from Services_GCP Memorystore output) |
| `redis_port` | No | `6379` | Redis server port |
| `execution_environment` | No | `gen2` | Cloud Run execution environment (`gen2` required for NFS) |
| `ingress_settings` | No | `all` | Traffic sources: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | Route private IPs (Redis/SQL) through VPC |
| `timeout_seconds` | No | `600` | Max seconds Cloud Run waits for a response |
| `create_cloud_storage` | No | `true` | Provision GCS bucket for document artifacts |
| `enable_nfs` | No | `false` | Provision NFS Filestore (requires gen2) |
| `container_image_source` | No | `custom` | `custom` builds from Dockerfile; `prebuilt` uses an existing image |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Approximate Phase Durations

| Step | Duration |
|---|---|
| Cloud Build (container image) | 8–12 minutes |
| Cloud Run service deployment (including startup probe) | 3–8 minutes |
| Total | **~15–25 minutes** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name |
| `service_url` | HTTPS URL for the Cloud Run service |
| `service_location` | GCP region where the service is deployed |
| `project_id` | GCP project ID |
| `deployment_id` | Auto-generated or provided deployment ID |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | MySQL database name |
| `database_user` | MySQL database username |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `storage_buckets` | GCS bucket names |
| `nfs_server_ip` | NFS server internal IP (sensitive, if NFS enabled) |
| `container_image` | Full image URI deployed |
| `cicd_enabled` | Whether CI/CD pipeline is configured |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "ragflow")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret (filter by app name)
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~ragflow" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

**Duration:** 2 minutes

### Steps

1. Note the service URL from the RAD UI deployment panel:

   ```bash
   echo "RAGFlow URL: ${SERVICE_URL}"
   ```

2. Verify the health endpoint is responding:

   ```bash
   curl -s "${SERVICE_URL}/v1/health"
   ```

   **Expected result:** `{"code": 0}` — RAGFlow is healthy. If you see a 502 or connection error, wait 1–2 minutes for the startup probe to complete (RAGFlow loads embedding models on first boot).

3. **gcloud equivalent** (describe the Cloud Run service):

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --format="value(status.url)"
   ```

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
   ```

---

## Phase 3 — Access RAGFlow and Initial Setup [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open your browser and navigate to the service URL:

   ```
   ${SERVICE_URL}
   ```

   RAGFlow serves the web UI on port 80 via nginx (proxied through Cloud Run).

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

5. **gcloud logging equivalent** (view Cloud Run startup logs):

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" resource.labels.service_name="'${SERVICE}'"' \
     --project=${PROJECT} \
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

8. **REST API equivalent** (list knowledge bases — requires an API key from Phase 7):

   ```bash
   API_KEY="<your-ragflow-api-key>"

   curl -s -H "Authorization: Bearer $API_KEY" \
     "${SERVICE_URL}/api/v1/knowledge_bases" | python3 -m json.tool
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
     "${SERVICE_URL}/api/v1/knowledge_bases" | python3 -m json.tool

   # List chat assistants
   curl -s -H "Authorization: Bearer $API_KEY" \
     "${SERVICE_URL}/api/v1/chat_assistants" | python3 -m json.tool

   # Check service health
   curl -s "${SERVICE_URL}/v1/health"
   ```

   **Expected result:** JSON responses listing your knowledge bases and assistants. The health endpoint returns `{"code": 0}`.

4. Explore the interactive API documentation at:

   ```
   ${SERVICE_URL}/api/v1/docs
   ```

5. **gcloud equivalent** (describe Cloud Run revision):

   ```bash
   gcloud run revisions list \
     --service ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

---

## Phase 8 — Explore Cloud Logging [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open the [Cloud Logging console](https://console.cloud.google.com/logs).

2. Set the project to your GCP project.

3. Query RAGFlow application logs:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   ```

   **gcloud equivalent:**
   ```bash
   gcloud logging read \
     "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${SERVICE}\"" \
     --project=${PROJECT} \
     --limit=100 \
     --format="table(timestamp,severity,textPayload)"
   ```

4. Filter for document parsing events:
   ```
   textPayload=~"parse|chunk|embed|elastic"
   ```

5. Filter for Cloud SQL Auth Proxy logs to confirm database connectivity:
   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   textPayload=~"cloudsql"
   ```

   **Expected result:** Log entries showing Cloud SQL Auth Proxy successful connections, RAGFlow startup completion, and Elasticsearch indexing activity during document parsing.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open the [Cloud Monitoring console](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and look for Cloud Run service dashboards.

3. View key Cloud Run metrics for the RAGFlow service:

   ```bash
   # gcloud equivalent: list available Cloud Run metrics
   gcloud monitoring metrics list \
     --filter="metric.type=starts_with(\"run.googleapis.com\")" \
     --project=${PROJECT}
   ```

4. Check key metrics in the console:
   - `run.googleapis.com/request_count` — total requests served
   - `run.googleapis.com/request_latencies` — response time distribution
   - `run.googleapis.com/container/cpu/utilizations` — CPU usage per revision
   - `run.googleapis.com/container/memory/utilizations` — memory usage

5. Review the uptime check status (if configured):

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs"
   ```

   **Expected result:** Request latency graphs show initial cold-start latency (RAGFlow loads AI models), then stable sub-second latency for subsequent requests. Memory utilization reflects embedding model overhead.

---

## Phase 10 — Undeploy [AUTOMATED]

**Duration:** 5–10 minutes

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**What is removed:** Cloud Run service and revisions, Cloud SQL instance and database, GCS bucket(s), Secret Manager secrets, Artifact Registry images, NFS instance (if enabled), Cloud Monitoring uptime checks.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry. Elasticsearch (managed by Elasticsearch_GKE) must also be undeployed separately.

---

## Summary

| Phase | Type | Key Action | Duration |
|---|---|---|---|
| 1 — Deploy | Automated | RAD UI deploys Cloud Run, Cloud SQL, GCS, Artifact Registry | 15–25 min |
| 2 — Get Service URL | Manual | Note service URL, verify health endpoint | 2 min |
| 3 — Initial Setup | Manual | Register admin account, explore RAGFlow UI | 5 min |
| 4 — Knowledge Base | Manual | Upload document, parse and chunk, view results | 10–15 min |
| 5 — RAG Chatbot | Manual | Create assistant, connect LLM, ask questions | 10 min |
| 6 — Document Analysis | Manual | Try different doc types and chunking methods | 10–15 min |
| 7 — API Access | Manual | Generate API key, test REST endpoints | 10 min |
| 8 — Cloud Logging | Manual | Query Cloud Run logs and parsing events | 5 min |
| 9 — Cloud Monitoring | Manual | Review Cloud Run metrics and uptime checks | 5 min |
| 10 — Undeploy | Automated | RAD UI removes all module resources | 5–10 min |
