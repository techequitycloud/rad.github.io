---
title: "LibreChat on Cloud Run — Lab Guide"
sidebar_label: "LibreChat CloudRun"
---

# LibreChat on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

LibreChat is an open-source AI chat platform that provides a unified interface to 20+ LLM providers including OpenAI, Anthropic, Google Gemini, and Ollama. This lab deploys LibreChat on Google Cloud Run backed by a MongoDB-compatible Firestore database, GCS file storage for uploads, and optional Redis session management.

### What the Module Automates

- Cloud Run service with LibreChat container (mirrored from GHCR to Artifact Registry)
- Firestore ENTERPRISE database with MongoDB compatibility (when no `mongodb_uri` is supplied)
- Firestore SCRAM user initialization via Cloud Run Job
- Secret Manager secrets: JWT keys, credential encryption keys, and MONGO_URI
- GCS bucket (`librechat-uploads`) for user file uploads
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks

### What You Do Manually

- Note the Cloud Run service URL from the deployment outputs
- Register the initial admin account
- Configure AI provider API keys (via Secret Manager or LiteLLM integration)
- Create a LibreChat configuration (`librechat.yaml`) for advanced provider setup
- Explore conversations, file uploads, and multi-model switching
- Review Cloud Logging for request traces

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project.
3. The following APIs enabled (Services GCP handles this):
   - `run.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `firestore.googleapis.com` (for auto-provisioned MongoDB)
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Optional: A MongoDB Atlas connection string or Cloud Memorystore Redis instance.
6. Optional: Secret Manager secrets for AI provider API keys.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `region` | No | `"us-central1"` | GCP region |
| `mongodb_uri` | No | `""` | MongoDB Atlas or self-hosted URI. Leave empty for Firestore auto-provisioning. |
| `firestore_mongodb_host` | No | `""` | Manual Firestore endpoint (skip if using auto-provisioning or Atlas) |
| `app_title` | No | `"LibreChat"` | Title shown in the LibreChat UI |
| `allow_registration` | No | `true` | Allow new user self-registration |
| `allow_social_login` | No | `false` | Enable OAuth social login providers |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (1 recommended for chat apps) |
| `max_instance_count` | No | `5` | Maximum Cloud Run instances |
| `container_resources` | No | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per instance |
| `enable_redis` | No | `false` | Enable Redis for session management |
| `redis_host` | No | `""` | Redis host (Cloud Memorystore IP) |
| `redis_port` | No | `6379` | Redis port |
| `secret_environment_variables` | No | `{}` | AI provider API key secrets (e.g. `{ OPENAI_API_KEY = "my-openai-secret" }`) |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Pre-create AI Provider Secrets (Optional)

Create Secret Manager secrets for AI provider API keys before deploying:

```bash
export PROJECT="your-gcp-project-id"

# Create secrets for AI provider keys (populate before referencing in deployment)
echo -n "sk-your-openai-key" | gcloud secrets create openai-api-key \
  --data-file=- --project=${PROJECT}

echo -n "sk-ant-your-anthropic-key" | gcloud secrets create anthropic-api-key \
  --data-file=- --project=${PROJECT}

echo -n "AIzaSy-your-gemini-key" | gcloud secrets create google-ai-api-key \
  --data-file=- --project=${PROJECT}
```

Then reference them in `secret_environment_variables`:
```hcl
secret_environment_variables = {
  OPENAI_API_KEY    = "openai-api-key"
  ANTHROPIC_API_KEY = "anthropic-api-key"
  GOOGLE_API_KEY    = "google-ai-api-key"
}
```

### Step 1.3 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Secret Manager secrets creation | 1–2 min |
| Firestore database provisioning (if auto) | 2–5 min |
| SCRAM user initialization job | 1–2 min |
| Artifact Registry image mirror | 3–5 min |
| Cloud Run service deployment | 2–3 min |
| **Total** | **9–17 min** |

### Step 1.4 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the LibreChat Cloud Run service |
| `service_name` | Cloud Run service name |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~librechat" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "LibreChat URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm LibreChat is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}
```

**Expected result:** HTTP `200`. If you see `502` or `503`, LibreChat may still be starting up (MongoDB connection and initialization). Wait 30 seconds and retry.

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image and environment variables.

### Step 2.3 — View Auto-Generated Secrets

```bash
# List all LibreChat secrets
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~${SERVICE}"

# View JWT secret (metadata only — don't expose the value)
gcloud secrets describe $(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~jwt-secret AND NOT name~refresh" \
  --format="value(name)" --limit=1)
```

**Expected result:** Secrets for `creds-key`, `creds-iv`, `jwt-secret`, `jwt-refresh-secret`, and `mongo-uri` are listed.

---

## Phase 3 — Register Admin Account [MANUAL]

### Step 3.1 — Access LibreChat

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The LibreChat login/register page appears.

### Step 3.2 — Register the First Admin User

1. Click **Register** (or **Create an account**).
2. Enter your **name**, **email**, and a **password**.
3. Click **Submit**.
4. LibreChat logs you in automatically.

**Expected result:** You are redirected to the LibreChat conversation interface.

> **Security note:** After registering the first admin account, set `allow_registration = false` in the deployment configuration and re-deploy to prevent unauthorized user registrations.

### Step 3.3 — Disable Self-Registration (Recommended)

Update the deployment variable:

```hcl
allow_registration = false
```

Re-deploy via the RAD UI. This prevents new users from self-registering.

---

## Phase 4 — Configure AI Providers [MANUAL]

### Step 4.1 — Add Providers via the LibreChat UI

1. Click the settings gear icon (bottom-left) or navigate to **Settings**.
2. Navigate to the **API Keys** section.
3. Enter your API keys for the providers you want to use:
   - OpenAI API Key
   - Anthropic API Key
   - Google AI / Gemini API Key
4. Keys entered here are encrypted using `CREDS_KEY` and `CREDS_IV` and stored in MongoDB.

**gcloud — verify encryption keys are injected:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | startswith("CREDS"))'
```

**Expected result:** `CREDS_KEY` and `CREDS_IV` are present as secret references (not plaintext values).

### Step 4.2 — Verify Provider Keys via API

```bash
# Check what providers are available via LibreChat API
curl -s -H "Authorization: Bearer <your-session-token>" \
  ${SERVICE_URL}/api/models | jq '.models[].name'
```

**Expected result:** A list of available model names from your configured providers.

### Step 4.3 — Test a Conversation

1. Click **New Conversation** (the pencil icon).
2. Select a model from the dropdown (e.g., `gpt-4o` or `claude-3-5-sonnet`).
3. Type a message and press Enter.

**Expected result:** The AI model responds within a few seconds. The conversation is saved to MongoDB.

---

## Phase 5 — File Uploads and Document Analysis [MANUAL]

### Step 5.1 — Upload a File

1. In a conversation, click the **paperclip** icon or drag-and-drop a file.
2. Upload a PDF, image, or text file.
3. Ask a question about the file content.

**Expected result:** LibreChat uploads the file to the `librechat-uploads` GCS bucket and sends the content to the AI model.

### Step 5.2 — Verify File Storage in GCS

```bash
# Find the uploads bucket
export UPLOADS_BUCKET=$(gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~librechat-uploads" \
  --format="value(name)" \
  --limit=1)

# List recent uploads
gcloud storage ls gs://${UPLOADS_BUCKET}/ --recursive | head -20
```

**Expected result:** Uploaded files appear in the GCS bucket with a directory structure organized by user ID.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View LibreChat Application Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** LibreChat startup logs appear, including MongoDB connection establishment, Express server startup on port 3080, and request logs.

### Step 6.2 — Check for MongoDB Connection

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND textPayload~"mongo"' \
  --project=${PROJECT} \
  --limit=10
```

**Expected result:** Logs show successful MongoDB connection or SCRAM authentication.

### Step 6.3 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Under normal operation, few or no warnings appear.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — View Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** The initial revision is listed, serving 100% of traffic.

### Step 7.2 — Check Instance Count

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.status.observedGeneration'
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.latestReadyRevision'
```

### Step 7.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The LibreChat uptime check shows **Passing** from multiple global locations.

### Step 7.4 — Verify Secret Injection

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.valueSource != null)'
```

**Expected result:** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`, and `MONGO_URI` all appear as secret references rather than plaintext env vars.

---

## Phase 8 — LibreChat Administration [MANUAL]

### Step 8.1 — Access Admin Panel

Navigate to `${SERVICE_URL}/admin` (requires admin account login).

**Expected result:** The LibreChat admin panel shows user management, model configuration, and system settings.

### Step 8.2 — Create Additional Users

In the Admin panel, navigate to **Users** and create accounts for team members. This is the recommended approach when `allow_registration = false`.

### Step 8.3 — Review Conversation Activity

Navigate to **Conversations** in the admin panel to view all user conversations and usage statistics.

---

## Phase 9 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 5–10 minutes.

> **Warning:** Undeploy permanently deletes all resources including Secret Manager secrets and GCS upload files. Export conversation history via the LibreChat UI before undeploying: **Settings > Data Controls > Export**.

> **Note:** The Firestore ENTERPRISE database is **not deleted** on destroy (ABANDON policy). It must be manually deleted via the GCP Console if no longer needed.

Resources provisioned by the `Services GCP` module (VPC, GKE cluster) are managed separately.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Secret Manager provisioning | 1 | Yes |
| Firestore MongoDB database provisioning | 1 | Yes |
| SCRAM user initialization job | 1 | Yes |
| Artifact Registry image mirror | 1 | Yes |
| Cloud Run service deployment | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Confirm LibreChat is reachable | 2 | No |
| Register admin account | 3 | No |
| Disable self-registration | 3 | No |
| Configure AI provider API keys | 4 | No |
| Test conversations | 4 | No |
| Test file uploads | 5 | No |
| Review Cloud Logging | 6 | No |
| Examine Cloud Run revisions | 7 | No |
| Review uptime check | 7 | No |
| Manage users via admin panel | 8 | No |
| Undeploy infrastructure | 9 | Yes |
