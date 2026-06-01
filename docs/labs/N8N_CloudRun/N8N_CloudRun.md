---
title: "n8n on Cloud Run — Lab Guide"
sidebar_label: "N8N CloudRun"
---

# n8n on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

n8n is a fair-code workflow automation platform with a visual canvas editor, 400+ integrations, webhook triggers, HTTP request nodes, and scheduled workflows. This module deploys n8n on Google Cloud Run (gen2), backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for shared persistence via Serverless VPC Access, and optional Redis queue mode for scalable execution.

### What the Module Automates

- Cloud Run service deployment (gen2 execution environment)
- Container image mirror to Artifact Registry via Cloud Build
- Cloud SQL PostgreSQL 15 instance, database, and user provisioning
- Cloud SQL Auth Proxy sidecar injection into the Cloud Run service
- Cloud Filestore (NFS) provisioning and NFS volume mount (requires gen2)
- GCS Fuse volume mounts for Cloud Storage buckets
- Secret Manager secrets (encryption key, DB password, SMTP credentials)
- Serverless VPC Access connector for private networking
- Cloud IAM bindings for the Cloud Run service account
- Redis host injection (defaults to NFS server IP when `enable_redis = true`)
- Cloud Run Jobs for initialization and database setup
- Cloud Scheduler for backup automation and GCS backup bucket
- Cloud Monitoring uptime checks and alert policies

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Complete the n8n initial account setup on first login
- Create and test workflows, webhook triggers, and credentials
- Examine execution history, error handling, and logging
- Observe Cloud Run request metrics

---

## CLI and REST API Overview

The steps in this guide include equivalent `gcloud` commands alongside the console instructions. REST API equivalents are provided for key operations.

**Tools used:**
- `gcloud` CLI — GCP resource management
- `curl` — webhook and HTTP testing

---

## Prerequisites

- A GCP project with the Services GCP platform module already deployed
- `gcloud` CLI authenticated: `gcloud auth login && gcloud config set project PROJECT_ID`
- Owner or Editor role on the target GCP project
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for resource names |
| `region` | No | `us-central1` | GCP region for deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier (1–20 chars) |
| `application_name` | No | `n8n` | Base name for Cloud Run service and Artifact Registry |
| `application_version` | No | `2.4.7` | n8n image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum instances (0 = scale-to-zero) |
| `max_instance_count` | No | `1` | Maximum concurrent Cloud Run instances |
| `cpu_limit` | No | `2000m` | CPU limit per instance |
| `memory_limit` | No | `4Gi` | Memory limit per instance |
| `enable_redis` | No | `true` | Enable Redis queue mode backend |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP when empty) |
| `redis_port` | No | `6379` | Redis server port |
| `db_name` | No | `n8n_db` | PostgreSQL database name |
| `db_user` | No | `n8n_user` | PostgreSQL database username |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS for shared persistence |
| `nfs_mount_path` | No | `/mnt/nfs` | Container mount path for the NFS volume |
| `ingress_settings` | No | `all` | Traffic ingress: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

Deployment takes approximately 8–12 minutes. After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the n8n Cloud Run service |
| `database_instance_name` | Cloud SQL instance name |
| `nfs_server_ip` | NFS server internal IP (sensitive) |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "n8n")
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
  --filter="name~n8n" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

### Step 2.1 — Retrieve the Service URL

```bash
echo "n8n URL: ${SERVICE_URL}"
```

**gcloud equivalent:**
```bash
gcloud run services describe ${SERVICE} \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.url)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

### Step 2.2 — Verify the Service is Healthy

```bash
gcloud run services list \
  --project ${PROJECT} \
  --region ${REGION}
```

**Expected result:** The n8n service shows `READY` status.

```bash
# Check recent Cloud Run revisions
gcloud run revisions list \
  --service ${SERVICE} \
  --region ${REGION} \
  --project ${PROJECT}
```

**Expected result:** One or more revisions listed, with the latest showing traffic allocation of 100%.

---

## Phase 3 — Explore the n8n Workflow Editor [MANUAL]

### Step 3.1 — Access the n8n UI

Open your browser and navigate to the `service_url`:

```
${SERVICE_URL}
```

If `min_instance_count = 0` (scale-to-zero is enabled), the first request may experience a cold start of 15–30 seconds while a new instance starts. Subsequent requests are fast.

**Expected result:** The n8n welcome page or account creation screen appears.

### Step 3.2 — Create an Admin Account

On first launch, n8n prompts you to create an owner account. Enter:
- **Email:** your admin email address
- **First name / Last name:** your name
- **Password:** a strong password (minimum 8 characters)

Click **Next** and complete the setup wizard. The n8n encryption key is stored in Secret Manager; the admin account credentials are stored in the PostgreSQL database.

**Expected result:** You are redirected to the n8n canvas (workflow editor).

### Step 3.3 — Tour the Canvas

1. **Canvas:** The main drag-and-drop workflow editor. Nodes represent operations; connections define the data flow.
2. **Left sidebar:** Click **Workflows** to see all saved workflows. Click **+ New workflow** to create one.
3. **Template gallery:** Click **Templates** in the left sidebar to browse 1,000+ pre-built workflow templates.
4. **Credentials:** Click the user icon (bottom-left) and select **Settings → Credentials** to manage API keys and auth.

### Step 3.4 — Create a Simple Workflow

1. Click **+ New workflow**.
2. Click **+** on the canvas. Search for **Manual Trigger** and select it.
3. Click **+** on the right edge of the Manual Trigger. Search for **HTTP Request** and select it.
   - Set **URL** to `https://httpbin.org/get`
   - Set **Method** to `GET`
4. Click **+** after the HTTP Request. Search for **Set** and select it.
   - Click **Add Value → String**
   - Set **Name** to `message`
   - Set **Value** to `Workflow executed successfully`
5. Click **Save**, then click **Execute workflow**.

**Expected result:** Each node shows a green checkmark. Click any node to inspect its input/output data. The Set node output contains `{"message": "Workflow executed successfully"}`.

---

## Phase 4 — Webhooks and Triggers [MANUAL]

### Step 4.1 — Create a Webhook Trigger Workflow

1. Click **+ New workflow**.
2. Add a **Webhook** node as the trigger:
   - Set **HTTP Method** to `POST`
   - Set **Path** to `test-webhook`
   - The **Webhook URL** shown will be: `https://<service-url>/webhook-test/test-webhook` (test mode) or `https://<service-url>/webhook/test-webhook` (production)
3. Add a **Set** node after the webhook:
   - Add a string value: Name = `received`, Value = `={{ $json.body }}`
4. Click **Save**.
5. Click **Listen for Test Event** in the Webhook node.

### Step 4.2 — Test the Webhook

In a terminal, send a POST request:

```bash
curl -X POST "${SERVICE_URL}/webhook-test/test-webhook" \
  -H "Content-Type: application/json" \
  -d '{"hello": "from curl", "timestamp": "2026-05-15"}'
```

**Expected result:** The n8n UI shows the webhook received the data. The Webhook node turns green and displays the payload.

**Note on webhooks and scale-to-zero:** If `min_instance_count = 0`, webhooks may miss events while the service is scaled down. Set `min_instance_count = 1` to ensure webhook availability at all times.

### Step 4.3 — Explore a Scheduled Trigger

1. Create a new workflow.
2. Add a **Schedule Trigger** node:
   - Set **Trigger Interval** to `Minutes` and **Minutes Between Triggers** to `1`
3. Add an **HTTP Request** node targeting `https://httpbin.org/uuid`.
4. **Save** and **Activate** the workflow (toggle in the top-right).

**Expected result:** After 1 minute, an execution appears in the workflow's execution history. Deactivate the workflow after testing.

---

## Phase 5 — Credential Management [MANUAL]

### Step 5.1 — Add an HTTP Basic Auth Credential

1. In any workflow, add an **HTTP Request** node.
2. Click **Authentication → Basic Auth → Create New Credential**.
3. Enter a username and password. Click **Save**.

**Expected result:** The credential is saved and listed under **Settings → Credentials**, encrypted using the n8n encryption key stored in Secret Manager.

### Step 5.2 — View Credentials in Secret Manager

```bash
gcloud secrets list --project ${PROJECT} | grep n8n
```

**Expected result:** Secrets such as `appn8ndemo<id>-encryption-key` and `appn8ndemo<id>-db-password` appear. The plaintext values are never stored in the deployment configuration.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:n8n"
```

### Step 5.3 — Explore Credential Sharing

Go to **Settings → Credentials**. Click any credential. The **Sharing** tab allows you to share the credential with other n8n users on the same instance — useful in team environments.

---

## Phase 6 — Workflow History and Error Handling [MANUAL]

### Step 6.1 — View Execution History

1. Open a workflow that has been executed.
2. Click **Executions** (clock icon) in the top bar.

**Expected result:** A list of all executions for that workflow, showing status, start time, and duration.

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project ${PROJECT} \
  --limit 50 \
  --format "value(timestamp, textPayload)"
```

### Step 6.2 — Add Error Handling with Error Trigger

1. Create a new workflow.
2. Add an **HTTP Request** node with an invalid URL (e.g., `https://invalid.example.invalid`).
3. Click **+** and add an **Error Trigger** node.
4. Connect the Error Trigger to a **Set** node that records the error.
5. Execute the workflow.

**Expected result:** The HTTP Request fails, the Error Trigger branch fires, and the execution history shows the error path was taken.

### Step 6.3 — Retry Settings

On any node, click the three-dot menu and select **Settings**. Under **On Error**, choose **Retry on Fail** and set **Max Tries** to `3`. n8n will automatically retry the node on transient failures before triggering the error branch.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View n8n Logs in Cloud Logging

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project ${PROJECT} \
  --limit 50 \
  --format "value(timestamp, textPayload)"
```

**Expected result:** Log lines from the n8n application showing database connection events, workflow execution events, and webhook registration messages.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=cloud_run_revision AND resource.labels.service_name='"${SERVICE}"'",
    "pageSize": 20
  }'
```

### Step 7.2 — Query for Workflow Execution Events

In the GCP Console, navigate to **Cloud Logging → Logs Explorer**. Enter the following query:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"Workflow"
```

**Expected result:** Log entries showing workflow execution start and completion events.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### Step 8.1 — View Cloud Run Request Metrics

Navigate to **Cloud Monitoring → Metrics Explorer**.

Select:
- **Resource type:** `Cloud Run Revision`
- **Metric:** `run.googleapis.com/request_count`
- **Filter:** `service_name = ${SERVICE}`

**Expected result:** A chart showing HTTP request counts per minute for the n8n service, broken down by response code.

**gcloud equivalent:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com" \
  --project ${PROJECT}
```

### Step 8.2 — View Request Latency

In Metrics Explorer, change the metric to `run.googleapis.com/request_latencies`. This shows p50, p95, and p99 latency percentiles for requests to the n8n service.

### Step 8.3 — Check the Uptime Monitor

```bash
gcloud monitoring uptime list-configs --project ${PROJECT}
```

**Expected result:** An uptime check for the n8n service URL appears with status `Healthy`.

### Step 8.4 — View Active Instances

```bash
gcloud run services describe ${SERVICE} \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.observedGeneration, status.conditions)"
```

To see current instance count in real time, navigate to the Cloud Run service page in the GCP Console and click the **Metrics** tab.

---

## Phase 9 — Delete [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

The delete operation removes the Cloud Run service, Cloud Run Jobs, Cloud SQL instance, NFS Filestore, GCS buckets, secrets, and IAM bindings created by this module.

**Note:** If `enable_purge = false` was set, some resources (database, buckets) are retained after deletion to protect against accidental data loss.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Phase | Activity | Method |
|---|---|---|
| 1 | Deploy n8n on Cloud Run | Automated (RAD UI) |
| 2 | Get service URL, verify deployment | Manual (gcloud) |
| 3 | Access UI, create first workflow | Manual (browser) |
| 4 | Webhooks and scheduled triggers | Manual (browser + curl) |
| 5 | Credential management | Manual (browser) |
| 6 | Execution history, error handling | Manual (browser) |
| 7 | Cloud Logging — query workflow events | Manual (gcloud / console) |
| 8 | Cloud Monitoring — request metrics | Manual (console) |
| 9 | Delete all resources | Automated (RAD UI) |
