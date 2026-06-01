# Open WebUI on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenWebUI_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Open WebUI is an open-source, extensible self-hosted web interface for large language models. It supports Ollama and OpenAI-compatible APIs with a feature-rich chat interface, RAG pipelines, and multi-user management. This lab deploys Open WebUI on Google Cloud Run backed by Cloud SQL PostgreSQL 15 and serverless auto-scaling.

### What the Module Automates

- Cloud Run service with Cloud SQL private IP TCP connection
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secret for `WEBUI_SECRET_KEY` (auto-generated session key)
- Artifact Registry repository and Cloud Build custom image pipeline
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks targeting `/health`

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Complete the Open WebUI admin account setup
- Connect to your Ollama or OpenAI-compatible AI backend
- Create users and configure roles
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, Cloud SQL instance).
3. The following APIs enabled (Services GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `vpcaccess.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.
6. An Ollama instance or OpenAI-compatible API endpoint (optional but recommended).

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"openwebui"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"latest"` | Open WebUI container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances |
| `cpu_limit` | No | `"1000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"2Gi"` | Memory per Cloud Run instance |
| `application_database_name` | No | `"openwebui"` | PostgreSQL database name |
| `application_database_user` | No | `"openwebui"` | PostgreSQL database username |
| `ollama_base_url` | No | `""` | Base URL of your Ollama instance |
| `openai_api_base_url` | No | `""` | Base URL of an OpenAI-compatible API |
| `default_user_role` | No | `"pending"` | Role assigned to new sign-ups (`pending`, `user`, `admin`) |
| `enable_signup` | No | `true` | Allow new users to register |
| `webui_auth` | No | `true` | Enable authentication |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **15–26 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Open WebUI Cloud Run service |
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
  --filter="metadata.name~openwebui" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Open WebUI URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm Open WebUI is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health
```

**Expected result:** HTTP `200`. If you see `503`, Cloud Run may still be starting — wait 30 seconds and retry.

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image, resource limits, and VPC connector details.

---

## Phase 3 — Set Up Open WebUI [MANUAL]

### Step 3.1 — Open Open WebUI in a Browser

Navigate to `${SERVICE_URL}` in your browser.

**Expected result:** Open WebUI displays a sign-up page for the initial admin account.

### Step 3.2 — Create the Admin Account

1. Enter your **name**, **email address**, and a **strong password**.
2. Click **Sign Up**.
3. The first user to register becomes the admin.

**Expected result:** You are logged into Open WebUI. The chat interface appears.

### Step 3.3 — Retrieve the WebUI Secret Key

```bash
# List Open WebUI-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~openwebui"

# Retrieve the WEBUI_SECRET_KEY
export SECRET_NAME=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~webui-secret" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${SECRET_NAME}" \
  --project=${PROJECT}
```

**Expected result:** The session key is returned as a plain-text string.

---

## Phase 4 — Connect to an AI Backend [MANUAL]

### Step 4.1 — Configure Ollama Connection

If you have an Ollama instance running:

1. Navigate to **Settings > Admin Panel > Connections**.
2. Under **Ollama**, enter your Ollama base URL (e.g., `http://your-ollama-host:11434`).
3. Click **Verify Connection**.

**Expected result:** Open WebUI confirms the connection and lists available Ollama models.

### Step 4.2 — Configure OpenAI-Compatible API

1. Navigate to **Settings > Admin Panel > Connections**.
2. Under **OpenAI**, enter your API base URL and API key.
3. Click **Verify Connection**.

**Expected result:** Available models from the OpenAI-compatible API are listed.

### Step 4.3 — Start a Chat

1. Select a model from the dropdown in the chat interface.
2. Type a message and press **Enter**.

**Expected result:** The AI model responds to your message.

---

## Phase 5 — User Management [MANUAL]

### Step 5.1 — Manage User Roles

1. Navigate to **Settings > Admin Panel > Users**.
2. Review pending users (if `default_user_role = "pending"`).
3. Approve users by changing their role to **User** or **Admin**.

**Expected result:** Users are listed with their current roles.

### Step 5.2 — Configure Authentication Settings

1. Navigate to **Settings > Admin Panel > General**.
2. Toggle **Enable New Sign Ups** to control registration.
3. Set **Default User Role** for new registrations.

**Expected result:** Settings are saved and applied to new user registrations.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Open WebUI Application Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Open WebUI startup logs including the database connection confirmation.

### Step 6.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, no warnings appear.

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

### Step 7.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check shows **Passing** from multiple global locations. The check targets `/health`.

---

## Phase 8 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database and all chat history. Export your data before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| WEBUI_SECRET_KEY generation | 1 | Yes |
| VPC connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Confirm Open WebUI is reachable | 2 | No |
| Open WebUI admin account setup | 3 | No |
| Connect to Ollama or OpenAI-compatible API | 4 | No |
| User management and role configuration | 5 | No |
| Review Cloud Logging | 6 | No |
| Examine revisions and uptime checks | 7 | No |
| Undeploy infrastructure | 8 | Yes |
