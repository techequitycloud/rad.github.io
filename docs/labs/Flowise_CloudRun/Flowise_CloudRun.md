---
title: "Flowise on Cloud Run — Lab Guide"
sidebar_label: "Flowise CloudRun"
---

# Flowise on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Flowise_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Flowise** — the
open-source visual AI workflow builder backed by Workday for enterprise deployments — on
Google Cloud Run using the **Flowise_CloudRun** module. You will build LangChain and
LlamaIndex pipelines through a drag-and-drop interface, call them via REST API, manage
credentials in Secret Manager, and explore Cloud Logging and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Flowise and Initial Setup](#exercise-1--access-flowise-and-initial-setup)
6. [Exercise 2 — Build a Chatflow](#exercise-2--build-a-chatflow)
7. [Exercise 3 — API Integration](#exercise-3--api-integration)
8. [Exercise 4 — Credentials Management](#exercise-4--credentials-management)
9. [Exercise 5 — Export and Import Flows](#exercise-5--export-and-import-flows)
10. [Exercise 6 — Database and Storage](#exercise-6--database-and-storage)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Flowise?

Flowise is an open-source visual AI workflow builder that lets users construct LangChain
and LlamaIndex pipelines through a drag-and-drop interface — with no boilerplate code. It
chains models, retrieval tools, prompt templates, memory nodes, and decision logic into
re-usable chatflows and agentflows. The `Flowise_CloudRun` module deploys Flowise version
**latest** on Google Cloud Run, backed by Cloud SQL PostgreSQL 15 and a GCS bucket for file
storage, using a custom Dockerfile built by Cloud Build.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Visual Pipeline Builder** | Drag-and-drop LLM pipeline construction with Chat Model, Memory, Chain, and Vector Store nodes |
| **REST API** | Programmatic chatflow predictions via `POST /api/v1/prediction/<chatflow-id>` |
| **Credentials Management** | OpenAI, Vertex AI, and other provider API keys stored as Flowise credentials and encrypted via `FLOWISE_PASSWORD` |
| **Flow Versioning** | JSON export/import for flow backup and version control |
| **Database Backend** | Cloud SQL PostgreSQL 15 with Cloud SQL Auth Proxy sidecar for secure Unix socket connectivity |
| **GCS File Storage** | Flowise uploads bucket (`-flowise-uploads`) for file attachments and API key files |
| **Serverless Scaling** | Cloud Run with `min_instance_count = 1` to avoid cold starts for AI workflow requests |
| **Observability** | Cloud Logging for Cloud Run revision, Cloud Monitoring uptime checks and request metrics |

---

## 2. Architecture

### Service Map

```
Internet
  │
  ▼ (HTTPS, ingress: all, port 3000)
Cloud Run — Flowise (gen2)
  │  app: flowise    cpu: 1000m   mem: 1Gi
  │  min: 1 instance  max: 1 instance
  │  image: custom Dockerfile (Cloud Build → Artifact Registry)
  │
  ├──── Cloud SQL Auth Proxy (sidecar) ──►  Cloud SQL PostgreSQL 15
  │     Unix socket: /cloudsql              db: flowisedb / flowiseuser
  │
  └──── GCS Fuse ──►  GCS Bucket: <prefix>-flowise-uploads
        STORAGE_TYPE=gcs                    file uploads, API key files
```

### Infrastructure

```
┌─────────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  VPC (Services_GCP)                                          │   │
│  │                                                              │   │
│  │  Cloud Run (gen2, port 3000)        Cloud SQL PostgreSQL 15  │   │
│  │  flowise + cloudsql-proxy  ◄──────► db: flowisedb            │   │
│  │                                     user: flowiseuser         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Artifact Registry              GCS Bucket                         │
│  flowise custom image            <prefix>-flowise-uploads           │
│  (built via Cloud Build)         STORAGE_TYPE=gcs                  │
│                                                                     │
│  Secret Manager                 Cloud Monitoring                   │
│  ├── FLOWISE_PASSWORD            uptime check (/)                  │
│  └── DB password                 request_count, latencies          │
└─────────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Flowise_CloudRun
    container_port           = 3000   →  Flowise listening port
    min_instance_count       = 1      →  always warm (no cold starts)
    enable_cloudsql_volume   = true   →  Auth Proxy sidecar socket
    container_image_source   = custom →  Cloud Build Dockerfile
    STORAGE_TYPE             = gcs    →  GCS bucket for uploads
    FLOWISE_PASSWORD         = Secret →  auto-generated, Secret Manager
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` | Any | System package manager |
| `jq` | 1.6+ | `apt install jq` / `brew install jq` |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
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
gcloud config set run/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Flowise_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `flowise` | Base name (do not change after deploy) |
| `application_version` | `latest` | Flowise image version |
| `flowise_username` | `admin` | UI admin username |
| `min_instance_count` | `1` | Keep warm — avoids AI workflow cold starts |
| `max_instance_count` | `1` | Increase for higher concurrency |
| `cpu_limit` | `1000m` | 1 vCPU per instance |
| `memory_limit` | `1Gi` | Memory per instance |
| `application_database_name` | `flowisedb` | PostgreSQL database |
| `application_database_user` | `flowiseuser` | PostgreSQL user |
| `create_cloud_storage` | `true` | GCS bucket for uploads |
| `ingress_settings` | `all` | Public access |

Click **Deploy** and wait for provisioning (approximately 15–30 minutes, including Cloud Build image build and Cloud SQL provisioning).

> **What this provisions:** Cloud Run gen2 service with Cloud SQL Auth Proxy sidecar,
> Cloud SQL PostgreSQL 15, database init Cloud Run Job (`create-db-and-user.sh`), Artifact
> Registry repo with custom Flowise image built by Cloud Build, GCS bucket for uploads,
> Secret Manager secret for admin password, Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --filter="metadata.name~flowise" \
  --format="value(metadata.name)" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Flowise URL: ${SERVICE_URL}"

# Discover the admin password secret
export FLOWISE_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~flowise" \
  --format="value(name)" \
  --limit=1)

echo "Secret: ${FLOWISE_SECRET}"
```

---

## Exercise 1 — Access Flowise and Initial Setup

### Objective

Retrieve the Flowise service URL, verify the Cloud Run service is healthy, retrieve admin credentials from Secret Manager, and navigate the Flowise UI.

### Step 1.1 — Verify the Service Is Running

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(status.url, status.conditions)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{url: .uri, state: .terminalCondition.state}'
```

**Expected result:** The service URL is shown with state `ACTIVE`.

### Step 1.2 — Health Check the Flowise Endpoint

```bash
curl -I "${SERVICE_URL}/api/v1/ping"
```

**Expected result:** HTTP `200 OK`. Flowise exposes `/api/v1/ping` as its dedicated health endpoint.

### Step 1.3 — Retrieve Admin Password from Secret Manager

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

Save the password — you will use it to log in to the Flowise UI.

### Step 1.4 — Log In to the Flowise UI

Open your browser and navigate to `${SERVICE_URL}`.

Log in with:
- **Username:** `admin` (or your configured `flowise_username`)
- **Password:** retrieved in Step 1.3

**Expected result:** The Flowise dashboard loads, showing the main navigation with **Chatflows**, **Agentflows**, **Assistants**, and **Marketplace**.

### Step 1.5 — Tour the Canvas

Explore the main sections:
1. **Chatflows** — visual LLM pipeline builder (drag-and-drop canvas)
2. **Agentflows** — multi-step agent orchestration with tool use
3. **Assistants** — OpenAI Assistants API integration
4. **Marketplace** — pre-built flow templates from the community

Click **Chatflows** and note the empty canvas — this is where AI pipelines are constructed visually.

---

## Exercise 2 — Build a Chatflow

### Objective

Create a complete working chatflow using drag-and-drop nodes: an LLM node, a Buffer Memory node, and a Conversation Chain — then test the chat with multi-turn conversation to verify memory.

### Step 2.1 — Create a New Chatflow

1. Navigate to **Chatflows** and click **Add New**
2. The canvas editor opens with an empty workspace

### Step 2.2 — Add a Chat Model Node

1. In the node search panel on the right, search for `ChatOpenAI` or `ChatGoogleGenerativeAI`
2. Drag the node onto the canvas
3. Configure:
   - **API Key:** enter your OpenAI or Google AI API key (or reference a Flowise credential created in Exercise 4)
   - **Model Name:** `gpt-3.5-turbo` (OpenAI) or `gemini-1.5-flash` (Google)
   - **Temperature:** `0.7`

### Step 2.3 — Add a Buffer Memory Node

1. Search for `Buffer Memory` in the node panel
2. Drag it onto the canvas
3. No configuration required — default settings are sufficient for this exercise

### Step 2.4 — Add a Conversation Chain Node

1. Search for `Conversation Chain` and drag it onto the canvas
2. Connect the **Chat Model** output to the **Language Model** input of Conversation Chain
3. Connect the **Buffer Memory** output to the **Memory** input of Conversation Chain

### Step 2.5 — Save and Test

1. Click **Save** and name the chatflow `My First Chatflow`
2. Click the **Chat** icon (speech bubble) in the top right to open the chat preview
3. Send test messages:
   - `Hello! My name is Alex and I work in cloud infrastructure.`
   - `What is Cloud Run?`
   - `What did I tell you my name was?`

**Expected result:** The chatflow responds to each message and correctly recalls "Alex" in the third message, demonstrating that Buffer Memory maintains conversation history within the session.

### Step 2.6 — Note the Chatflow ID

Copy the chatflow ID from the URL bar:
```
${SERVICE_URL}/chatflows/<chatflow-id>
```

Export the ID:
```bash
export CHATFLOW_ID="<paste-your-chatflow-id-here>"
```

---

## Exercise 3 — API Integration

### Objective

Use the Flowise REST API to send predictions programmatically via curl, create an API key for authenticated access, and list chatflows via the API.

### Step 3.1 — Send a Prediction (Unauthenticated)

```bash
curl -X POST "${SERVICE_URL}/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is GCP in one sentence?"}'
```

**REST API — full form:**
```bash
curl -s -X POST \
  "${SERVICE_URL}/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is LangChain?",
    "overrideConfig": {
      "temperature": 0.5
    }
  }' | jq '.'
```

**Expected result:** A JSON response containing the model answer in the `text` field.

### Step 3.2 — Create an API Key

1. In the Flowise UI, navigate to **Settings → API Keys**
2. Click **Add New Key**
3. Name: `lab-key`
4. Copy the generated API key value

```bash
export FLOWISE_API_KEY="<paste-your-api-key>"
```

### Step 3.3 — Send an Authenticated Prediction

```bash
curl -X POST "${SERVICE_URL}/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${FLOWISE_API_KEY}" \
  -d '{"question": "Summarise what Flowise does in one sentence."}'
```

**Expected result:** A JSON response identical in structure to the unauthenticated call. API keys are stored in the database (controlled by `APIKEY_STORAGE_TYPE=db`).

### Step 3.4 — List All Chatflows via API

```bash
curl -s "${SERVICE_URL}/api/v1/chatflows" \
  -H "Authorization: Bearer ${FLOWISE_API_KEY}" \
  | jq '.[] | {id: .id, name: .name, deployed: .deployed}'
```

**Expected result:** A JSON array listing all chatflows with their IDs and deployment status.

### Step 3.5 — List Cloud Run Service Metadata

Inspect the Cloud Run service to confirm the container port and environment:

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="json" \
  | jq '.spec.template.spec.containers[0] | {image: .image, port: .ports[0].containerPort, env: [.env[] | select(.name | test("DATABASE_TYPE|STORAGE_TYPE|FLOWISE_USERNAME"))]}'
```

**Expected result:** Container port `3000`, `DATABASE_TYPE=postgres`, `STORAGE_TYPE=gcs`, `FLOWISE_USERNAME=admin`.

---

## Exercise 4 — Credentials Management

### Objective

Add OpenAI and Vertex AI credentials in the Flowise credentials manager, inspect how the admin password is stored in Secret Manager, and verify that credentials are encrypted in the database.

### Step 4.1 — View the Auto-Generated Flowise Password Secret

**gcloud:**
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

**Expected result:** The `<prefix>-password` secret appears, which holds the auto-generated Flowise admin password (32 characters, no special characters).

### Step 4.2 — Add an OpenAI Credential

1. In the Flowise UI, navigate to **Settings → Credentials**
2. Click **Add Credential**
3. Search for and select **OpenAI API**
4. Enter your OpenAI API key
5. Give the credential a name: `openai-lab`
6. Click **Add**

The credential is encrypted by Flowise and stored in the PostgreSQL database.

### Step 4.3 — Add a Google Vertex AI Credential

1. In **Settings → Credentials**, click **Add Credential**
2. Search for and select **Google Generative AI**
3. Enter your Google AI API key or service account JSON
4. Name it: `google-ai-lab`
5. Click **Add**

### Step 4.4 — Use the Credential in a Chatflow

1. Open your chatflow from Exercise 2
2. Click the **ChatOpenAI** node
3. In the **Connect Credential** dropdown, select `openai-lab`
4. Click **Save** — the API key is now loaded from the encrypted credential store

### Step 4.5 — Inspect Secret Manager Access from Cloud Run

Verify the Cloud Run service accesses FLOWISE_PASSWORD from Secret Manager:

```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env[] | select(.name == "FLOWISE_PASSWORD")'
```

**Expected result:** `FLOWISE_PASSWORD` is loaded via a `secretKeyRef` pointing to the Secret Manager secret, not stored as a plaintext environment variable.

---

## Exercise 5 — Export and Import Flows

### Objective

Export a chatflow as a JSON file for backup and version control, then import it to create a copy — demonstrating Flowise's portability and the ability to manage flow configurations as code.

### Step 5.1 — Export a Chatflow via the UI

1. Navigate to **Chatflows** and locate your chatflow from Exercise 2
2. Click the **kebab menu** (three dots) on the chatflow card
3. Select **Export**
4. A `.json` file is downloaded to your local machine

### Step 5.2 — Examine the Exported JSON

Open the downloaded JSON file in a text editor. The flow JSON contains:
- `nodes` array: each node with type, position, and configuration
- `edges` array: connections between nodes
- `name`: chatflow display name

This JSON can be stored in version control (Git) to track chatflow evolution.

### Step 5.3 — Export a Chatflow via REST API

```bash
curl -s "${SERVICE_URL}/api/v1/chatflows/${CHATFLOW_ID}" \
  -H "Authorization: Bearer ${FLOWISE_API_KEY}" \
  | jq '{name: .name, nodes: (.flowData | fromjson | .nodes | length), created: .createdDate}'
```

**Expected result:** Chatflow metadata including name and node count.

### Step 5.4 — Import the Chatflow

1. Navigate to **Chatflows** and click **Add New** → **Load Chatflow**
   (or use the import icon if available)
2. Select the exported `.json` file
3. A new chatflow is created with the same nodes and connections

### Step 5.5 — Verify Both Chatflows via API

```bash
curl -s "${SERVICE_URL}/api/v1/chatflows" \
  -H "Authorization: Bearer ${FLOWISE_API_KEY}" \
  | jq '[.[] | {id: .id, name: .name}]'
```

**Expected result:** Both the original and the imported chatflow appear in the list.

### Step 5.6 — Inspect GCS Storage for Exported Files

If Flowise stores exported files to GCS, inspect the uploads bucket:

```bash
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~flowise" \
  --format="table(name, location, storageClass)"

gcloud storage ls "gs://$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~flowise-uploads" \
  --format="value(name)" \
  --limit=1)/"
```

---

## Exercise 6 — Database and Storage

### Objective

Inspect the Cloud SQL PostgreSQL instance and GCS uploads bucket that back the Flowise deployment, exploring how flow data and file uploads are persisted.

### Step 6.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~flowise" \
  --format="table(name, region, databaseVersion, state)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("flowise")) | {name: .name, version: .databaseVersion, state: .state, region: .region}'
```

**Expected result:** A `POSTGRES_15` instance in the `RUNNABLE` state.

### Step 6.2 — View the Database Init Job Result

The deployment ran a `db-init` Cloud Run Job (`create-db-and-user.sh`) to create the `flowisedb` database and `flowiseuser` role. Check its execution:

**gcloud:**
```bash
gcloud run jobs list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --filter="name~flowise" \
  --format="table(name, lastRunCompletionTime, lastRunCondition)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.jobs[] | select(.name | test("flowise")) | {name: .name, lastExecution: .latestCreatedExecution}'
```

**Expected result:** The db-init job shows a successful completion, confirming the database was created and privileges were granted.

### Step 6.3 — Inspect the GCS Uploads Bucket

**gcloud:**
```bash
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~flowise-uploads" \
  --format="table(name, location, storageClass, timeCreated)"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=flowise-uploads" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name: .name, location: .location, storageClass: .storageClass}'
```

**Expected result:** A bucket named `<prefix>-flowise-uploads` in `STANDARD` storage class.

### Step 6.4 — Verify GCS is Configured in the Container

```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env[] | select(.name == "STORAGE_TYPE" or .name == "GOOGLE_CLOUD_STORAGE_BUCKET_NAME" or .name == "GCLOUD_PROJECT")'
```

**Expected result:** `STORAGE_TYPE=gcs`, `GOOGLE_CLOUD_STORAGE_BUCKET_NAME=<prefix>-flowise-uploads`, and `GCLOUD_PROJECT=<project-id>` are all set, confirming Flowise is configured to use GCS for file storage.

### Step 6.5 — Test File Upload Storage

1. In the Flowise UI, open a chatflow that includes a **PDF File** or **Text File** loader node
2. Upload a small test document via the node's file input
3. Verify the file appears in the GCS bucket:

```bash
gcloud storage ls -r \
  "gs://$(gcloud storage buckets list --project="${PROJECT}" --filter="name~flowise-uploads" --format="value(name)" --limit=1)/"
```

---

## Exercise 7 — Cloud Logging

### Objective

View and analyse Flowise application logs in Cloud Logging, stream live logs during API calls, and explore log-based insights for diagnosing chatflow execution.

### Step 7.1 — View Flowise Startup Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="value(timestamp, textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 30
  }" | jq '.entries[] | {timestamp: .timestamp, message: .textPayload}'
```

**Expected result:** Log entries including `Flowise Server: Running` and database connection messages via Cloud SQL Auth Proxy.

### Step 7.2 — Filter for API Request Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND httpRequest.requestUrl=~\"api/v1/prediction\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="value(timestamp, httpRequest.requestMethod, httpRequest.requestUrl, httpRequest.status)"
```

**Expected result:** HTTP log entries for each `POST /api/v1/prediction` call made in Exercise 3.

### Step 7.3 — Stream Live Logs

In one terminal, stream logs:
```bash
gcloud alpha run services logs tail "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}"
```

In a second terminal, trigger an API call:
```bash
curl -X POST "${SERVICE_URL}/api/v1/prediction/${CHATFLOW_ID}" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is a vector database?"}'
```

**Expected result:** The log stream shows entries corresponding to the API request in near-real time.

### Step 7.4 — View Cloud SQL Auth Proxy Sidecar Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"cloud.sql.proxy\"" \
  --project="${PROJECT}" \
  --limit=15 \
  --format="value(timestamp, textPayload)"
```

**Expected result:** Cloud SQL Auth Proxy startup messages confirming the Unix socket connection to the PostgreSQL instance is established.

### Step 7.5 — Open the Cloud Logging Console

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%20AND%20resource.labels.service_name%3D%22${SERVICE}%22?project=${PROJECT}"
```

Explore the **Log fields** panel to filter by severity, and create a log-based metric to count prediction API calls.

---

## Exercise 8 — Cloud Monitoring

### Objective

Inspect request metrics and latency for the Flowise Cloud Run service, verify the automated uptime check, and navigate the Cloud Monitoring console to build a custom dashboard.

### Step 8.1 — View Request Count Metrics

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com/request_count" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [metric.response_code_class], sum(val())\"
  }" | jq '.timeSeriesData[] | {responseClass: .labelValues[0].stringValue, count: .pointData[-1].values[0].int64Value}'
```

**Expected result:** Request counts broken out by response code class (2xx, 4xx, 5xx).

### Step 8.2 — View Request Latency

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_latencies | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], percentile(val(), 95)\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].distributionValue'
```

**Expected result:** P95 latency distribution. AI workflow prediction requests will show higher latency than ping/health requests.

### Step 8.3 — Check Cloud Run Instance Count

```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/container/instance_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], max(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].int64Value'
```

**Expected result:** Instance count of `1` (with `min_instance_count = 1`, Flowise is always running).

### Step 8.4 — Verify the Uptime Check

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
  | jq '.uptimeCheckConfigs[] | {displayName, host: .httpCheck.host, path: .httpCheck.path, period: .period}'
```

**Expected result:** An uptime check targeting the Flowise service URL with a 60-second check interval showing `Healthy`.

### Step 8.5 — Open the Monitoring Console

```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

In Metrics Explorer, create a chart with:
- **Resource type:** `Cloud Run Revision`
- **Metric:** `request_count`
- **Filter:** `service_name = ${SERVICE}`
- **Group by:** `response_code_class`

This chart shows the split between successful (2xx) and failed (4xx/5xx) prediction requests over time.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Flowise_CloudRun` deployment. This removes the Cloud Run service, Cloud SQL instance, GCS bucket, Artifact Registry images, Secret Manager secrets, Cloud Monitoring uptime checks, and IAM bindings.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --quiet

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

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

> **Note:** If `enable_purge = false` was set, the GCS bucket and some resources are retained.
> Resources provisioned by the `Services_GCP` module are managed separately.
>
> **Known issue:** After Cloud Run service deletion, GCP may hold serverless IPv4 addresses
> for 20–30 minutes before the VPC subnet can be deleted. Wait and retry if the undeploy fails.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `flowise` | Base name (do not change after deploy) |
| `application_version` | string | `latest` | Flowise container image version tag |
| `flowise_username` | string | `admin` | Flowise UI admin username |
| `cpu_limit` | string | `1000m` | CPU limit per Cloud Run container |
| `memory_limit` | string | `1Gi` | Memory limit per Cloud Run container |
| `min_instance_count` | number | `1` | Minimum instances (1 avoids cold starts) |
| `max_instance_count` | number | `1` | Maximum instances |
| `container_port` | number | `3000` | Flowise listening port |
| `timeout_seconds` | number | `300` | Max request duration (increase for long AI flows) |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar for Unix socket |
| `application_database_name` | string | `flowisedb` | PostgreSQL database name |
| `application_database_user` | string | `flowiseuser` | PostgreSQL application user |
| `database_password_length` | number | `32` | Auto-generated DB password length |
| `create_cloud_storage` | bool | `true` | Provision GCS uploads bucket |
| `ingress_settings` | string | `all` | Cloud Run ingress settings |
| `enable_iap` | bool | `false` | Identity-Aware Proxy (blocks public webhooks when true) |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for automated backup |

### Useful Commands

```bash
# Get service URL
gcloud run services describe "${SERVICE}" --project="${PROJECT}" --region="${REGION}" --format="value(status.url)"

# Health check
curl -I "${SERVICE_URL}/api/v1/ping"

# List chatflows via API
curl "${SERVICE_URL}/api/v1/chatflows" -H "Authorization: Bearer ${FLOWISE_API_KEY}"

# Send a prediction
curl -X POST "${SERVICE_URL}/api/v1/prediction/${CHATFLOW_ID}" -H "Content-Type: application/json" -d '{"question": "Hello"}'

# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" --project="${PROJECT}" --limit=50

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~flowise"

# Check uptime monitors
gcloud monitoring uptime list-configs --project="${PROJECT}"

# Describe Cloud SQL instance
gcloud sql instances list --project="${PROJECT}" --filter="name~flowise"

# List Cloud Run jobs
gcloud run jobs list --project="${PROJECT}" --region="${REGION}" --filter="name~flowise"
```

### Further Reading

- [Flowise documentation](https://docs.flowiseai.com/)
- [Flowise GitHub repository](https://github.com/FlowiseAI/Flowise)
- [Flowise API reference](https://docs.flowiseai.com/using-flowise/api)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Secret Manager best practices](https://cloud.google.com/secret-manager/docs/best-practices)
- [LangChain documentation](https://python.langchain.com/docs/introduction/)
