# AnythingLLM on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/AnythingLLM_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

AnythingLLM is a private AI workspace and Retrieval-Augmented Generation (RAG) platform. It lets teams chat with documents, connect to any LLM provider (OpenAI, Anthropic, Ollama, and more), and build AI-powered knowledge bases — without sending data to third-party services. This lab deploys AnythingLLM on Google Cloud Run backed by Cloud SQL PostgreSQL 15, GCS document storage, and Secret Manager for automatic credential management.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database (`anythingllmdb`), and user (`anythingllmuser`)
- Secret Manager secrets: `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`, `DB_PASSWORD`
- GCS document storage bucket (`<prefix>-anythingllm-docs`)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access for private networking to Cloud SQL
- Cloud Run IAM and Workload Identity service account bindings
- Cloud Monitoring uptime check (polls `/api/ping`) and alert policies
- `db-init` Cloud Run Job (PostgreSQL database and user creation)

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Create an AnythingLLM admin account on first login
- Connect an LLM provider in the Settings UI
- Configure embedding and vector database preferences
- Create a workspace and upload documents
- Chat with your documents using AI
- Review Cloud Logging and Cloud Monitoring
- Examine Cloud Run revisions

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, Cloud SQL instance, and service accounts).
3. The following APIs enabled (Services GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.
6. (Optional) LLM API keys stored as Secret Manager secrets before deployment, for injection via `secret_environment_variables`.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"anythingllm"` | Base name for resources and secrets |
| `application_version` | No | `"latest"` | AnythingLLM container image version |
| `cpu_limit` | No | `"2000m"` | CPU per instance (minimum 2 vCPU for AI workloads) |
| `memory_limit` | No | `"4Gi"` | Memory per instance (minimum 4 Gi for embeddings) |
| `min_instance_count` | No | `1` | Minimum instances (1 = always warm, no cold starts) |
| `max_instance_count` | No | `1` | Maximum instances (increase with NFS for multi-instance) |
| `container_port` | No | `3001` | AnythingLLM HTTP port |
| `application_database_name` | No | `"anythingllmdb"` | PostgreSQL database name |
| `application_database_user` | No | `"anythingllmuser"` | PostgreSQL user |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `environment_variables` | No | `{}` | LLM provider env vars (e.g., `{ LLM_PROVIDER = "openai" }`) |
| `secret_environment_variables` | No | `{}` | LLM API key references (e.g., `{ OPENAI_API_KEY = "my-openai-secret" }`) |
| `backup_schedule` | No | `"0 2 * * *"` | Backup cron schedule (UTC) |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |
| `enable_iap` | No | `false` | Enable Identity-Aware Proxy for Google auth |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL 15 instance creation | 8–12 min |
| Secret Manager secrets and propagation | 1–2 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| `db-init` Cloud Run Job execution | 2–3 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **18–31 min** |

### Step 1.3 — Record Outputs

After deployment completes, capture the outputs from the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the AnythingLLM Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~anythingllm" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Service: ${SERVICE}"
echo "URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Check Service Readiness

```bash
curl -s ${SERVICE_URL}/api/ping
```

**gcloud equivalent:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.conditions[0].status)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.conditions[] | select(.type=="Ready")'
```

**Expected result:** `/api/ping` returns `{"online":true}`. The REST API shows `"status": "True"` for the `Ready` condition.

### Step 2.2 — Inspect the Service Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '{
    image: .spec.template.spec.containers[0].image,
    cpu: .spec.template.spec.containers[0].resources.limits.cpu,
    memory: .spec.template.spec.containers[0].resources.limits.memory,
    minInstances: .spec.template.metadata.annotations["autoscaling.knative.dev/minScale"],
    maxInstances: .spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"]
  }'
```

**Expected result:** JSON shows `cpu: "2000m"`, `memory: "4Gi"`, `minInstances: "1"`, `maxInstances: "1"`.

---

## Phase 3 — Initial Setup [MANUAL]

### Step 3.1 — Open AnythingLLM in a Browser

Navigate to `${SERVICE_URL}` in a browser.

**Expected result:** The AnythingLLM setup wizard appears with fields for admin username and password.

### Step 3.2 — Create the Admin Account

1. Enter a username and strong password.
2. Click **Get started**.

**Expected result:** You are redirected to the AnythingLLM main interface showing the workspace list (empty initially).

### Step 3.3 — Review Auto-Generated Secrets

The four application secrets were created by `AnythingLLM Common` on deployment:

```bash
# List all AnythingLLM secrets in this project
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anythingllm" \
  --format="table(name, labels.application)"
```

```bash
# Read the JWT secret (to verify it was generated)
JWT_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anythingllm AND name~jwt-secret" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest --secret="${JWT_SECRET}" --project=${PROJECT} | wc -c
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aanythingllm"
```

**Expected result:** Four secrets are listed. The JWT secret length should be 32 characters.

---

## Phase 4 — Connect an LLM Provider [MANUAL]

### Step 4.1 — Open LLM Settings

1. In the AnythingLLM sidebar, click the gear icon to open **Settings**.
2. Navigate to **AI Providers** > **LLM Preference**.

**Expected result:** The LLM provider selection page is displayed.

### Step 4.2 — Select and Configure a Provider

**Option A — OpenAI:**
1. Click **OpenAI**.
2. Enter your API key (or verify it is pre-populated if injected via `secret_environment_variables`).
3. Select a model (e.g., `gpt-4o-mini`).
4. Click **Save changes**.

**Option B — Native (no external API required):**
1. Click **Native Embedder** and configure a local LLM endpoint (e.g., Ollama running in a sidecar or on-premise server).

```bash
# Verify the LLM provider env var is set
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name == "LLM_PROVIDER")'
```

**Expected result:** The env var shows the configured provider, or the UI shows the provider was saved successfully.

### Step 4.3 — Configure Embedding Preference

1. Navigate to **Settings** > **AI Providers** > **Embedding Preference**.
2. Select `Native AnythingLLM Embedder` (no external API needed) or match your LLM provider.
3. Click **Save changes**.

### Step 4.4 — Configure Vector Database

1. Navigate to **Settings** > **AI Providers** > **Vector Database**.
2. Select `LanceDB` (embedded, recommended for Cloud Run — stores vectors in `/app/server/storage`).
3. Click **Save changes**.

**Expected result:** All three AI settings (LLM, Embedding, Vector DB) show green checkmarks.

---

## Phase 5 — Create a Workspace and Chat with Documents [MANUAL]

### Step 5.1 — Create a New Workspace

1. In the AnythingLLM sidebar, click **+ New Workspace**.
2. Enter a name (e.g., "Product Documentation").
3. Click **Create workspace**.

**Expected result:** The workspace appears in the sidebar. The chat interface opens on the right.

### Step 5.2 — Upload Documents

1. Click the **Upload documents** icon or area inside the workspace.
2. Upload one or more files (PDF, DOCX, TXT, CSV, or Markdown).
3. Wait for the processing indicator to show "Complete".

**Expected result:** The document appears in the document list with "Embedded" status.

### Step 5.3 — Chat with Your Documents

Type a question in the chat box related to the uploaded document content and press **Enter**.

**Expected result:** AnythingLLM retrieves relevant document chunks using the vector database, sends the context to the LLM, and returns an answer with citations from the source document.

### Step 5.4 — Explore Workspace Settings

1. Click the workspace settings icon.
2. Explore **Chat Settings** (LLM override per workspace, temperature, chat history window).
3. Explore **Vector Database** settings for workspace-level overrides.

---

## Phase 6 — Cloud Storage Verification [MANUAL]

### Step 6.1 — List the Document Bucket

```bash
gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~anythingllm-docs" \
  --format="table(name, location, storageClass)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=anythingllm"
```

**Expected result:** A bucket named `<prefix>-anythingllm-docs` is listed in the STANDARD storage class.

### Step 6.2 — List Bucket Contents

```bash
BUCKET=$(gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~anythingllm-docs" \
  --format="value(name)" \
  --limit=1)

gcloud storage ls --recursive gs://${BUCKET}/ 2>/dev/null | head -20
```

**Expected result:** Bucket contents are listed. Documents uploaded to AnythingLLM may appear here if the GCS backend is active.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Application Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=30 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** AnythingLLM startup logs appear, including `Server running on port 3001` and database connection messages.

### Step 7.2 — View db-init Job Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND labels."run.googleapis.com/job_name"~"db-init"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** PostgreSQL user and database creation log lines from the `create-db-and-user.sh` script.

### Step 7.3 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=10 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, no errors appear.

---

## Phase 8 — Cloud Run Features [MANUAL]

### Step 8.1 — View Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** At least one revision with 100% traffic.

### Step 8.2 — View Traffic Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.traffic'
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.traffic'
```

**Expected result:** 100% of traffic directed to `TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST`.

### Step 8.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The AnythingLLM uptime check targeting `/` shows **Passing** from multiple global locations.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI and click **Undeploy** (or **Delete**).

**Approximate undeploy duration:** 12–18 minutes.

> **Warning:** This permanently deletes the database, GCS bucket, and all uploaded documents and workspace data. Export AnythingLLM data before undeploying if needed.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 | 1 | Yes |
| Secret Manager secrets (JWT, AUTH, SIG) | 1 | Yes |
| GCS document bucket | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| db-init job (PostgreSQL user and DB creation) | 1 | Yes |
| Note service URL | 2 | No |
| Confirm `/api/ping` returns 200 | 2 | No |
| Create admin account | 3 | No |
| Review auto-generated secrets | 3 | No |
| Connect LLM provider | 4 | No |
| Configure embedding and vector DB | 4 | No |
| Create workspace | 5 | No |
| Upload and embed documents | 5 | No |
| Chat with documents | 5 | No |
| Verify GCS bucket | 6 | No |
| Review Cloud Logging | 7 | No |
| Examine revisions and uptime checks | 8 | No |
| Undeploy | 9 | Yes |
