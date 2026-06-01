---
title: "Dify on Cloud Run — Lab Guide"
sidebar_label: "Dify CloudRun Lab"
---

# Dify on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Dify is an open-source LLM application development platform for building production-grade AI applications. This lab deploys Dify on Google Cloud Run backed by Cloud SQL PostgreSQL 15 with pgvector, Redis for Celery task queuing and LLM streaming, and GCS object storage. Cloud Run provides serverless auto-scaling with a minimum of 1 instance to keep Celery workers available. A separate Dify web frontend service is deployed automatically alongside the API.

### What the Module Automates

- Dify API Cloud Run service with Cloud SQL Auth Proxy sidecar
- Dify web frontend Cloud Run service (Next.js)
- Cloud SQL PostgreSQL 15 instance with `pgvector` extension
- Dify application database and user creation (`db-init` job)
- GCS `dify-storage` bucket for file uploads and model assets
- Secret Manager `SECRET_KEY` secret (64-character random value)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access connector for private networking
- Redis connectivity via NFS server IP (or external Memorystore)
- Cloud Monitoring uptime checks and alert policies
- Automated backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Complete the Dify admin setup wizard
- Configure LLM providers (OpenAI, Anthropic, etc.) in the Dify console
- Create and test AI workflows, chatbots, and RAG applications
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Test the Dify API |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL instance, and NFS server).
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `vpcaccess.googleapis.com`
   - `file.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g., `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"dify"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"0.15.0"` | Dify image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"4Gi"` | Memory per Cloud Run instance |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (keep at 1 for Celery) |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances |
| `db_name` | No | `"dify_db"` | PostgreSQL database name |
| `db_user` | No | `"dify_user"` | PostgreSQL database username |
| `enable_redis` | No | `true` | Enable Redis for Celery task queue (required) |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP) |
| `redis_port` | No | `"6379"` | Redis port |
| `enable_nfs` | No | `true` | Mount NFS (required for Redis co-location) |
| `nfs_mount_path` | No | `"/mnt/nfs"` | NFS mount path inside the container |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress setting |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Secret Manager secret creation | 1–2 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Cloud Run API service deployment | 2–4 min |
| Cloud Run web service deployment | 1–2 min |
| NFS provisioning and mount validation | 3–5 min |
| **Total** | **20–35 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Dify API Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Dify Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~dify" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the SECRET_KEY secret
export SECRET_KEY_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~dify AND name~secret-key" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the Service URL

```bash
echo "Dify URL: ${SERVICE_URL}"
```

**gcloud equivalent:**
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

**Expected result:** A URL in the format `https://<hash>-<hash>.a.run.app`. This is the Dify API service URL.

### Step 2.2 — Confirm Dify is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health
```

**Expected result:** HTTP `200`. If you see `503`, Cloud Run may still be initialising — wait 60 seconds and retry. Dify runs database migrations on first startup which takes additional time.

### Step 2.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image, resource limits, and VPC connector details.

---

## Phase 3 — Set Up Dify Admin [MANUAL]

### Step 3.1 — Access the Setup Wizard

Open a browser and navigate to:

```
${SERVICE_URL}
```

On the first visit, Dify displays a setup wizard.

**Expected result:** The Dify setup page appears with fields for admin email and password.

### Step 3.2 — Create Admin Account

1. Enter your **admin email address**.
2. Enter a **password** (minimum 8 characters).
3. Click **Setup**.
4. Dify redirects to the login page. Log in with your credentials.

**Expected result:** You are logged into the Dify home page.

### Step 3.3 — Verify SECRET_KEY Secret

```bash
gcloud secrets versions access latest \
  --secret="${SECRET_KEY_SECRET}" \
  --project=${PROJECT} \
  | wc -c
```

**Expected result:** The secret has 64 characters. This key is injected as `SECRET_KEY` into the Dify API container.

---

## Phase 4 — Configure LLM Providers [MANUAL]

### Step 4.1 — Add an LLM Provider

1. In the Dify Admin console, navigate to **Settings** > **Model Provider**.
2. Click **+ Add Model**.
3. Select a provider (e.g., **OpenAI**, **Anthropic**, or **Ollama** for local models).
4. Enter your API key.
5. Click **Save**.

**gcloud — verify environment variables in the Cloud Run revision:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | startswith("OPENAI"))'
```

**Expected result:** The model provider appears in the model list with status `Active`.

### Step 4.2 — Verify pgvector Integration

```bash
export DB_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="name~dify" \
  --format="value(name)" \
  --limit=1)

echo "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';" | \
  gcloud sql connect ${DB_INSTANCE} \
    --user=postgres \
    --project=${PROJECT} \
    --quiet
```

**Expected result:** The query returns `vector` with a version number (e.g., `0.7.0`). pgvector enables Dify to store and query vector embeddings directly in PostgreSQL.

---

## Phase 5 — Explore AI Features [MANUAL]

### Step 5.1 — Create a Chatbot Application

1. Navigate to the Dify home page and click **Create** > **Blank App**.
2. Select **Chatbot** as the application type.
3. Enter a name (e.g., "My Assistant") and click **Create**.
4. In the application editor, select a model from the model dropdown.
5. Enter a system prompt and click **Publish**.

**Expected result:** The chatbot is published and accessible. Click **Run** to test it in your browser.

### Step 5.2 — Create a Knowledge Base (RAG)

1. Navigate to **Knowledge** in the left sidebar.
2. Click **Create Knowledge**.
3. Upload a text document or paste text content.
4. Select **Automatic** chunking mode and click **Save & Process**.
5. Wait for the processing status to show `Available`.

**Expected result:** Dify chunks the document, generates embeddings via the configured LLM provider, and stores them in the pgvector store.

### Step 5.3 — Build a RAG-powered Application

1. Create a new **Chatbot** or **Agent** application.
2. In the application editor, click **Context** and add your knowledge base.
3. Test the application — ask a question that can be answered from your uploaded document.

**Expected result:** Dify retrieves relevant chunks from the knowledge base and includes them in the LLM context. The response cites information from your document.

### Step 5.4 — Explore the Workflow Builder

1. Navigate to **Studio** > **Create** > **Workflow**.
2. Add nodes from the left panel: **Start** → **LLM** → **End**.
3. Configure the LLM node with a prompt template using `{{input}}` variables.
4. Click **Run** and provide test input.

**Expected result:** The workflow executes and returns LLM output in the preview panel. Each node shows its execution time and output.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Dify Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console, or use gcloud:

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

**Expected result:** Dify startup logs appear, including Flask-Migrate migration output and Celery worker startup messages.

### Step 6.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Under normal operation, only informational logs appear.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions. The most recent revision serves 100% of traffic.

### Step 7.2 — View Dify Web Frontend Service

```bash
gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --filter="metadata.name~dify"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  | jq '.services[] | select(.name | contains("dify")) | {name: .name, url: .uri}'
```

**Expected result:** Two Cloud Run services are listed — the Dify API service and the `dify-web` Next.js frontend service.

### Step 7.3 — Check Scaling Behaviour

```bash
# Send 5 requests to the health endpoint
for i in $(seq 1 5); do curl -s -o /dev/null ${SERVICE_URL}/health; done

# Check current instance count
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Cloud Run maintains at least 1 instance (`min_instance_count = 1`) and scales up to handle concurrent requests.

### Step 7.4 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check shows **Passing** from multiple global locations.

---

## Phase 8 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database, vector store data, and GCS file storage. Export your Dify applications and knowledge bases before undeploying via the Dify console.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run API service provisioning | 1 | Yes |
| Cloud Run web frontend service | 1 | Yes |
| Cloud SQL PostgreSQL 15 with pgvector | 1 | Yes |
| SECRET_KEY secret generation | 1 | Yes |
| GCS storage bucket | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Confirm Dify is reachable | 2 | No |
| Dify admin setup wizard | 3 | No |
| Configure LLM providers | 4 | No |
| Verify pgvector integration | 4 | No |
| Create chatbot application | 5 | No |
| Create knowledge base (RAG) | 5 | No |
| Build RAG-powered application | 5 | No |
| Explore workflow builder | 5 | No |
| Review Cloud Logging | 6 | No |
| Examine revisions and traffic splitting | 7 | No |
| Review uptime checks | 7 | No |
| Undeploy infrastructure | 8 | Yes |
