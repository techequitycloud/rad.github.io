---
title: "Flowise on Cloud Run — Lab Guide"
sidebar_label: "Flowise CloudRun"
---

# Flowise on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Flowise_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Flowise is a visual AI workflow builder that lets users create LLM-powered chatflows, agentflows, and assistants using a drag-and-drop interface. This lab deploys Flowise on Google Cloud Run (v2) backed by Cloud SQL (PostgreSQL 15), Cloud Storage, and a Cloud SQL Auth Proxy sidecar for secure database connectivity.

### What the Module Automates

- Cloud Run v2 service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Cloud Storage bucket for Flowise data
- Artifact Registry repository and container image build (Cloud Build)
- Secret Manager secrets (database password, Flowise credentials)
- VPC Direct Egress configuration
- Cloud Monitoring uptime checks and alert policies
- Optional Cloud Armor WAF + Global HTTPS Load Balancer
- Database initialization Cloud Run Job

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Access the Flowise UI and log in
- Build chatflows using the drag-and-drop interface
- Test the Flowise REST API
- Browse the Marketplace for flow templates
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

This lab uses two sets of tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Interact with GCP services (Cloud Run, secrets, logs) |
| `curl` | Call the Flowise REST API |

---

## Prerequisites

- GCP project with billing enabled
- `Services_GCP` module deployed (provides VPC, Cloud SQL instance, Artifact Registry)
- `gcloud` CLI authenticated (`gcloud auth application-default login`)
- Access to the RAD UI with permission to deploy modules in the target GCP project
- An LLM API key (e.g., OpenAI, Google AI) if you want to test live AI nodes

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for all resource names |
| `region` | No | `us-central1` | GCP region |
| `application_name` | No | `flowise` | Base name for Cloud Run service and secrets |
| `application_version` | No | `latest` | Container image tag |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (set to 1 to avoid cold starts) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances |
| `cpu_limit` | No | `1000m` | CPU limit per instance |
| `memory_limit` | No | `1Gi` | Memory limit per instance |
| `flowise_username` | No | `admin` | Flowise UI admin username |
| `application_database_name` | No | `flowisedb` | PostgreSQL database name |
| `application_database_user` | No | `flowiseuser` | PostgreSQL database user |
| `database_password_length` | No | `32` | Generated password length (16–64) |
| `ingress_settings` | No | `all` | Cloud Run ingress: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `enable_iap` | No | `false` | Enable Identity-Aware Proxy |
| `enable_cloud_armor` | No | `false` | Enable Cloud Armor WAF |
| `create_cloud_storage` | No | `true` | Provision GCS data bucket |
| `timeout_seconds` | No | `300` | Maximum request duration (0–3600 s) |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

### Estimated Deployment Duration

| Step | Estimated Time |
|---|---|
| Cloud Build image build | 5–10 minutes |
| Cloud SQL provisioning | 5–10 minutes |
| Cloud Run service deployment | 2–3 minutes |
| Database init job execution | 1–2 minutes |
| Secret propagation and health checks | 1–2 minutes |
| **Total** | **15–30 minutes** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL for the Flowise Cloud Run service |
| `service_name` | Cloud Run service name |
| `service_location` | GCP region where the service is deployed |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for the DB password |
| `storage_buckets` | Created GCS bucket names |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps using gcloud discovery:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~flowise" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~flowise" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get Service URL [MANUAL]

**Goal:** Retrieve the Flowise service URL and verify the service is running.

1. Get the Cloud Run service URL with gcloud:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region=${REGION} \
     --project=${PROJECT} \
     --format="value(status.url)"
   ```

2. Verify the service is healthy:

   ```bash
   curl -I https://${SERVICE_URL}/api/v1/ping
   ```

   **Expected result:** HTTP 200 OK response.

3. List Cloud Run services:

   ```bash
   gcloud run services list \
     --region=${REGION} \
     --project=${PROJECT}
   ```

   **Expected result:** The Flowise service is listed with status `Ready`.

**REST API equivalent:**

```bash
curl -X GET \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Phase 3 — Explore the Flowise Interface [MANUAL]

**Goal:** Access the Flowise web UI and navigate its main sections.

1. Open a browser and navigate to the Flowise service URL:

   ```
   https://${SERVICE_URL}
   ```

2. If authentication is enabled, retrieve your credentials from Secret Manager:

   ```bash
   gcloud secrets versions access latest \
     --secret="${DB_SECRET}" \
     --project=${PROJECT}
   ```

   Log in with username `admin` (or your configured `flowise_username`) and the retrieved password.

   **Expected result:** The Flowise dashboard loads.

3. Explore the main navigation tabs:

   - **Chatflows** — visual LLM pipeline builder
   - **Agentflows** — multi-step agent orchestration
   - **Assistants** — OpenAI Assistants integration
   - **Marketplace** — pre-built flow templates

4. Click **Chatflows** and note the empty canvas — this is where you build AI pipelines.

**gcloud equivalent — list secrets:**

```bash
gcloud secrets list --project=${PROJECT} --filter="name~flowise"
```

---

## Phase 4 — Build a Simple Chatflow [MANUAL]

**Goal:** Create a working AI chatflow using drag-and-drop nodes.

1. Navigate to **Chatflows** and click **Add New**.

2. In the node panel on the right, search for and drag a **Chat Model** node onto the canvas (e.g., `ChatOpenAI` or `ChatGoogleGenerativeAI`).

3. Configure the Chat Model node:
   - Set your API key (or reference a Secret Manager secret)
   - Choose a model (e.g., `gpt-3.5-turbo` or `gemini-1.5-flash`)

4. Search for and drag a **Conversation Chain** node onto the canvas.

5. Connect the Chat Model output to the **Language Model** input of the Conversation Chain.

6. Search for and drag a **Buffer Memory** node onto the canvas.

7. Connect the Buffer Memory output to the **Memory** input of the Conversation Chain.

8. Click **Save** and name your chatflow (e.g., `My First Chatflow`).

9. Click the **Chat** icon (speech bubble) in the top right to open the chat preview.

10. Type a few messages:
    - `Hello, how are you?`
    - `What is Cloud Run?`
    - `Remember that I prefer short answers.`

    **Expected result:** The model responds and retains context across messages (demonstrating Buffer Memory).

11. Close the chat preview and note the **Chatflow ID** in the URL bar — you will use it in the next phase.

---

## Phase 5 — Explore the API [MANUAL]

**Goal:** Use the Flowise REST API to send predictions programmatically.

1. Navigate to your chatflow and copy the **Chatflow ID** from the URL:

   ```
   https://${SERVICE_URL}/chatflows/<chatflow-id>
   ```

2. Send a prediction using the public API:

   ```bash
   curl -X POST https://${SERVICE_URL}/api/v1/prediction/<chatflow-id> \
     -H "Content-Type: application/json" \
     -d '{"question": "What is GCP?"}'
   ```

   **Expected result:** A JSON response containing the model's answer.

3. Create an API key for authenticated access:
   - In the Flowise UI, navigate to **Settings > API Keys**
   - Click **Add New Key**, name it `lab-key`
   - Copy the generated API key

4. Test authenticated API access:

   ```bash
   curl -X POST https://${SERVICE_URL}/api/v1/prediction/<chatflow-id> \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <your-api-key>" \
     -d '{"question": "Summarize what Flowise does in one sentence."}'
   ```

   **Expected result:** A JSON response identical in structure to the unauthenticated call.

5. List all available chatflows via API:

   ```bash
   curl https://${SERVICE_URL}/api/v1/chatflows \
     -H "Authorization: Bearer <your-api-key>"
   ```

**REST API reference:** `https://${SERVICE_URL}/api/v1/` (Swagger UI available at `/api/v1/`)

---

## Phase 6 — Marketplace and Templates [MANUAL]

**Goal:** Discover and import pre-built chatflow templates.

1. Navigate to **Marketplace** in the left sidebar.

2. Browse the available templates. Look for categories such as:
   - RAG (Retrieval-Augmented Generation)
   - Agent templates
   - Memory chatflows

3. Click a template (e.g., a **RAG chatflow** or a **ReAct Agent**) to preview it.

4. Click **Use Template** to import it into your Chatflows.

5. Open the imported flow and explore its nodes:
   - Identify the data source node (e.g., PDF Loader, URL Loader)
   - Identify the vector store node (e.g., Chroma, Pinecone)
   - Identify the LLM node

6. Note how the nodes are pre-wired — Marketplace templates give you a working starting point.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

**Goal:** View Flowise application logs in Cloud Logging.

1. Open the Cloud Console Logs Explorer:

   ```
   https://console.cloud.google.com/logs/query?project=<project-id>
   ```

2. Query Flowise Cloud Run logs:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   resource.labels.location="${REGION}"
   ```

3. Look for log entries showing:
   - Flowise server startup: `Flowise Server: Running`
   - Database connection events via Cloud SQL Auth Proxy
   - API prediction requests
   - Any error messages

4. Using gcloud CLI:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --format="table(timestamp,textPayload)"
   ```

5. Stream logs in real time while making API calls:

   ```bash
   gcloud alpha run services logs tail ${SERVICE} \
     --region=${REGION} \
     --project=${PROJECT}
   ```

**Expected result:** Log entries showing the Flowise Node.js server running and handling requests.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

**Goal:** Inspect service-level metrics for the Flowise Cloud Run service.

1. Open the Cloud Console Monitoring dashboard:

   ```
   https://console.cloud.google.com/monitoring?project=<project-id>
   ```

2. Navigate to **Metrics Explorer** and query:

   - Metric: `run.googleapis.com/request_count`
   - Filter by `service_name = ${SERVICE}`

3. Check request latency:

   - Metric: `run.googleapis.com/request_latencies`

4. Using gcloud CLI to describe the service and its traffic:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region=${REGION} \
     --project=${PROJECT}
   ```

5. Check uptime check status:

   ```bash
   gcloud monitoring uptime list --project=${PROJECT}
   ```

**REST API equivalent — get Cloud Run service metrics:**

```bash
curl -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch cloud_run_revision | metric run.googleapis.com/request_count | every 1m"
  }'
```

**Expected result:** Request count and latency graphs for the Flowise Cloud Run service.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**What is removed:**
- Cloud Run service and revisions
- Cloud Run initialization job
- Cloud SQL instance, database, and user
- GCS storage bucket (if `enable_purge = true`)
- Secret Manager secrets
- Artifact Registry images
- Cloud Monitoring uptime checks and alert policies
- Cloud Armor policy (if enabled)

**Estimated time:** 10–20 minutes

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Learned |
|---|---|---|
| Phase 1 — Deploy | Automated | RAD UI deployment provisions Cloud Run, Cloud SQL, GCS, and secrets |
| Phase 2 — Get Service URL | Manual | Cloud Run service discovery and health verification |
| Phase 3 — Explore the UI | Manual | Flowise dashboard navigation and authentication via Secret Manager |
| Phase 4 — Build a Chatflow | Manual | Drag-and-drop LLM pipeline with memory |
| Phase 5 — Explore the API | Manual | REST API predictions and API key management |
| Phase 6 — Marketplace | Manual | Importing pre-built flow templates |
| Phase 7 — Cloud Logging | Manual | Viewing Flowise container logs in Cloud Run |
| Phase 8 — Cloud Monitoring | Manual | Request count and latency metrics, uptime checks |
| Phase 9 — Undeploy | Automated | Clean teardown of all resources |
