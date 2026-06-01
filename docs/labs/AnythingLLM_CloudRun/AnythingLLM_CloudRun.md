---
title: "AnythingLLM on Cloud Run — Lab Guide"
sidebar_label: "AnythingLLM CloudRun"
---

# AnythingLLM on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/AnythingLLM_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

AnythingLLM is a private AI workspace and Retrieval-Augmented Generation (RAG) platform. It lets teams chat with documents, connect to any LLM provider (OpenAI, Anthropic, Ollama, and more), and build AI-powered knowledge bases — without sending data to third-party services. This lab deploys AnythingLLM on Google Cloud Run backed by Cloud SQL PostgreSQL 15, GCS document storage, and Secret Manager for automatic credential management.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets (JWT_SECRET, AUTH_TOKEN, SIG_KEY, SIG_SALT, DB_PASSWORD)
- GCS document storage bucket (`anythingllm-docs`)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Automated backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Create an AnythingLLM admin account on first login
- Connect an LLM provider (OpenAI, Anthropic, or Ollama)
- Upload and chat with documents
- Explore workspaces, embeddings, and agent settings
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI and REST API Overview

This lab uses the following tool:

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL instance).
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.
6. (Optional) An API key for an LLM provider such as OpenAI or Anthropic, stored in Secret Manager before deployment.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"anythingllm"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"latest"` | AnythingLLM container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance (minimum 2 vCPU for AI workloads) |
| `memory_limit` | No | `"4Gi"` | Memory per Cloud Run instance (minimum 4 Gi) |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (keep warm for AI operations) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances |
| `application_database_name` | No | `"anythingllmdb"` | PostgreSQL database name |
| `application_database_user` | No | `"anythingllmuser"` | PostgreSQL database username |
| `enable_redis` | No | `false` | Enable Redis (not required for core AnythingLLM functionality) |
| `enable_nfs` | No | `false` | Enable NFS (required for multi-instance persistent document access) |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress routing |
| `environment_variables` | No | `{}` | LLM provider settings (e.g., `LLM_PROVIDER`, `EMBEDDING_ENGINE`) |
| `secret_environment_variables` | No | `{}` | LLM API key references (e.g., `{ OPENAI_API_KEY = "anythingllm-openai-key" }`) |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| Secret Manager secret creation and propagation | 1–2 min |
| **Total** | **16–28 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the AnythingLLM Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
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

echo "AnythingLLM URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the Service URL

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.url)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

**Expected result:** A URL in the format `https://<hash>.a.run.app` is printed.

### Step 2.2 — Confirm AnythingLLM is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/ping
```

**Expected result:** HTTP `200` with body `{"online":true}`. If you see `503`, Cloud Run may still be starting — wait 60 seconds and retry (AnythingLLM requires time to load AI models and run database migrations).

### Step 2.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready`. The container image, resource limits (2 vCPU, 4 Gi), and VPC egress settings are listed.

---

## Phase 3 — Set Up AnythingLLM [MANUAL]

### Step 3.1 — Access the Setup Wizard

Open a browser and navigate to `${SERVICE_URL}`.

AnythingLLM displays an initial setup wizard on the first visit.

**Expected result:** The AnythingLLM setup page appears asking you to create an admin account.

### Step 3.2 — Create an Admin Account

1. Enter a **username** and **password** for the admin account.
2. Click **Create Account**.

**Expected result:** You are redirected to the main AnythingLLM interface.

### Step 3.3 — Retrieve Auto-Generated Secrets

The module auto-generates `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, and `SIG_SALT`. To view them:

```bash
# List AnythingLLM-related secrets
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anythingllm" \
  --format="table(name, createTime)"
```

```bash
# Read a specific secret (e.g., auth-token)
SECRET_NAME=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anythingllm AND name~auth-token" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${SECRET_NAME}" \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aanythingllm"
```

**Expected result:** Four secrets are listed: `jwt-secret`, `auth-token`, `sig-key`, `sig-salt`. Each returns a 32-character alphanumeric string.

---

## Phase 4 — Connect an LLM Provider [MANUAL]

### Step 4.1 — Navigate to LLM Settings

1. In the AnythingLLM interface, click the **Settings** icon (gear/cog).
2. Navigate to **LLM Preference**.

**Expected result:** The LLM Preference page lists available providers: OpenAI, Anthropic, Azure OpenAI, Ollama, and others.

### Step 4.2 — Configure OpenAI (Example)

1. Select **OpenAI** as the LLM provider.
2. Enter your OpenAI API Key. If stored in Secret Manager, verify it is injected via `secret_environment_variables`.
3. Select a model (e.g., `gpt-4o`, `gpt-3.5-turbo`).
4. Click **Save**.

**gcloud — verify the API key is injected:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name == "OPENAI_API_KEY")'
```

**Expected result:** The env var shows a `valueFrom.secretKeyRef` reference (not a plaintext value).

### Step 4.3 — Configure Embedding Settings

1. Navigate to **Settings** > **Embedding Preference**.
2. Select `Native` (AnythingLLM's built-in embedder) or a provider matching your LLM.
3. Click **Save**.

**Expected result:** Embedding model is configured. Document uploads will use this embedder.

### Step 4.4 — Configure Vector Database

1. Navigate to **Settings** > **Vector Database**.
2. Select `LanceDB` (recommended for Cloud Run — embedded, no external service required).
3. Click **Save**.

**Expected result:** Vector database is set to LanceDB, which stores vectors in the `STORAGE_DIR` path.

---

## Phase 5 — Create a Workspace and Upload Documents [MANUAL]

### Step 5.1 — Create a Workspace

1. In the AnythingLLM sidebar, click **+ New Workspace**.
2. Enter a workspace name (e.g., "Company Knowledge Base").
3. Click **Create workspace**.

**Expected result:** A new workspace appears in the sidebar.

### Step 5.2 — Upload Documents

1. Click on the workspace you created.
2. Click the **Upload** button or drag-and-drop files.
3. Upload a PDF, Word document, or text file.

**Expected result:** The document appears in the workspace with "Processing" status, then changes to "Ready" after embedding is complete.

### Step 5.3 — Chat with Documents

1. In the workspace chat interface, type a question about your uploaded document.
2. Press **Enter** to send.

**Expected result:** AnythingLLM retrieves relevant document chunks and uses the LLM to generate a contextual answer with source citations.

---

## Phase 6 — View the GCS Document Bucket [MANUAL]

AnythingLLM's document bucket is named `<resource-prefix>-anythingllm-docs`.

```bash
# List buckets for this deployment
gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~anythingllm"
```

```bash
# List objects in the bucket
BUCKET=$(gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~anythingllm-docs" \
  --format="value(name)" \
  --limit=1)
gcloud storage ls gs://${BUCKET}/
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=anythingllm"
```

**Expected result:** The `anythingllm-docs` bucket is listed. Uploaded documents may be visible as objects if GCS-backed storage is configured.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console, or use:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** AnythingLLM startup logs appear, including the database connection and server ready messages.

### Step 7.2 — Filter for Database Initialisation Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND labels."run.googleapis.com/job_name"~"db-init"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Logs from the `db-init` Cloud Run Job show database user and database creation steps.

---

## Phase 8 — Cloud Run Features [MANUAL]

### Step 8.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions with traffic percentages. The most recent revision serves 100% of traffic.

### Step 8.2 — Check Scaling Behaviour

```bash
# Send several requests to trigger scaling
for i in $(seq 1 5); do curl -s -o /dev/null ${SERVICE_URL}/api/ping; done

# Check instance count
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** With `min_instance_count = 1`, at least one instance is always running. No cold starts occur for AI operations.

### Step 8.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `${SERVICE_URL}` shows **Passing** from multiple global locations.

### Step 8.4 — View Secret Manager Secrets

```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="labels.application=anythingllm" \
  --format="table(name, createTime)"
```

**Expected result:** Four AnythingLLM secrets (`jwt-secret`, `auth-token`, `sig-key`, `sig-salt`) and the database password secret are listed.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 12–18 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database, GCS bucket, and all uploaded documents. Export your AnythingLLM workspaces before undeploying if needed.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials (JWT, AUTH, SIG) | 1 | Yes |
| GCS document storage bucket | 1 | Yes |
| VPC networking and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Confirm AnythingLLM is reachable | 2 | No |
| Create admin account | 3 | No |
| Review auto-generated secrets | 3 | No |
| Connect LLM provider | 4 | No |
| Configure embedding and vector database | 4 | No |
| Create workspace and upload documents | 5 | No |
| Chat with documents | 5 | No |
| Inspect GCS document bucket | 6 | No |
| Review Cloud Logging | 7 | No |
| Examine revisions and scaling | 8 | No |
| Review uptime checks | 8 | No |
| Undeploy infrastructure | 9 | Yes |
