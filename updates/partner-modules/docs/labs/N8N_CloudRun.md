# n8n on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **n8n** workflow
automation on Google Cloud Run using the **N8N_CloudRun** module. You will set up the n8n
instance, build and execute workflows, configure webhook triggers, manage credentials in
Secret Manager, inspect execution history and error handling, verify Redis queue mode,
and explore observability using gcloud CLI, REST API, and the n8n visual canvas editor.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access n8n and Initial Setup](#exercise-1--access-n8n-and-initial-setup)
6. [Exercise 2 — Create and Execute Workflows](#exercise-2--create-and-execute-workflows)
7. [Exercise 3 — Webhooks and Triggers](#exercise-3--webhooks-and-triggers)
8. [Exercise 4 — Credential Management](#exercise-4--credential-management)
9. [Exercise 5 — Workflow History and Error Handling](#exercise-5--workflow-history-and-error-handling)
10. [Exercise 6 — Redis Queue Mode](#exercise-6--redis-queue-mode)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#13-cleanup)
14. [Reference](#14-reference)

---

## 1. Overview

### What Is n8n?

n8n is a fair-code workflow automation platform with 189,000+ GitHub stars, 230,000+ active
users, and a $2.5B valuation as of 2025. It provides a visual canvas editor, 400+
integrations, webhook triggers, HTTP request nodes, and scheduled workflows. It is fully
self-hostable with no per-execution fees. The `N8N_CloudRun` module deploys n8n on Cloud Run
(gen2) backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for workflow persistence, Redis
queue mode, and Secret Manager for encryption key and SMTP credentials.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Serverless Workflow Automation** | Cloud Run gen2 with scale-to-zero and Redis queue mode |
| **PostgreSQL Backend** | Cloud SQL PostgreSQL 15 via Cloud SQL Auth Proxy Unix socket |
| **NFS Persistence** | Cloud Filestore NFS for workflow data and execution history across instances |
| **Redis Queue Mode** | Bull queue backend enabling reliable multi-instance execution |
| **Secret Manager** | Auto-generated encryption key and SMTP password injected at runtime |
| **Webhook Endpoints** | n8n exposes HTTP webhooks on the Cloud Run service URL |
| **Observability** | Cloud Logging, Cloud Monitoring uptime checks, and request metrics |

---

## 2. Architecture

```
External HTTP/Webhook Traffic
        │
        ▼
  Cloud Run Service (gen2)
  n8n — port 5678
  ┌──────────────────────────────────────────────────────┐
  │  n8n container                                       │
  │    entrypoint.sh → maps DB_HOST, DB_NAME, etc.       │
  │    n8n Node.js process (tini PID 1)                  │
  │    WEBHOOK_URL = predicted service URL               │
  │                                                      │
  │  cloudsql-proxy sidecar                              │
  │    Unix socket: /cloudsql/<instance-connection>      │
  └────────────────────────┬─────────────────────────────┘
                            │ VPC Egress (Serverless VPC Access)
        ┌───────────────────┼──────────────────┐
        ▼                   ▼                   ▼
  Cloud SQL            Cloud Filestore     Redis
  PostgreSQL 15        NFS /mnt/nfs        (NFS VM IP:6379)
  n8n_db               workflow data       queue mode backend
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Cloud Run Service (gen2)   region: us-central1            │  │
│  │  n8n 2.4.7 · port 5678 · min=0 · max=1                    │   │
│  │  Sidecar: Cloud SQL Auth Proxy (Unix socket)               │  │
│  │  NFS mount: /mnt/nfs (Cloud Filestore)                     │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                          │ Serverless VPC Access Connector       │
│  ┌───────────────────────▼─────────────────────────────────────┐ │
│  │  VPC Network (Services_GCP)                                  ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │  Cloud SQL   │  │  Filestore   │  │  Redis (NFS VM)  │  │  │
│  │  │  PostgreSQL  │  │  NFS share   │  │  port 6379       │  │  │
│  │  │  15          │  │              │  │  queue mode      │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐    │
│  │  Secret Manager  │  │  Cloud Logging   │  │  Monitoring  │    │
│  │  N8N_ENCRYPTION  │  │  structured logs │  │  uptime check│    │
│  │  _KEY, SMTP pass │  │  Cloud Run       │  │  alert policy│    │
│  └──────────────────┘  └──────────────────┘  └──────────────┘    │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  N8N_CloudRun
    application_version   = "2.4.7"   →  n8n container image tag
    min_instance_count    = 0         →  scale-to-zero enabled
    max_instance_count    = 1         →  single instance by default
    enable_nfs            = true      →  Cloud Filestore NFS mounted
    enable_redis          = true      →  Redis queue mode enabled
    enable_cloudsql_volume= true      →  Auth Proxy Unix socket
    database_type         = POSTGRES_15 → n8n requires PostgreSQL
    N8N_ENCRYPTION_KEY    → auto-generated and stored in Secret Manager
    WEBHOOK_URL           → predicted before deployment
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.viewer
roles/logging.viewer
roles/monitoring.viewer
roles/iam.serviceAccountViewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

gcloud config set project "${PROJECT}"
gcloud config set run/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `N8N_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `n8n` | Base resource name |
| `application_version` | `2.4.7` | n8n image tag |
| `tenant_deployment_id` | `demo` | Short deployment suffix |
| `deploy_application` | `true` | Deploy the n8n service |
| `enable_nfs` | `true` | Cloud Filestore NFS for persistence |
| `enable_redis` | `true` | Redis queue mode |
| `db_name` | `n8n_db` | PostgreSQL database name |
| `db_user` | `n8n_user` | PostgreSQL application user |
| `min_instance_count` | `0` | Scale to zero when idle |
| `max_instance_count` | `1` | Single instance (increase only with Redis) |
| `cpu_limit` | `2000m` | 2 vCPU per instance |
| `memory_limit` | `4Gi` | 4 GiB memory per instance |
| `support_users` | `[your-email]` | Alert notification recipients |

Click **Deploy** and wait for provisioning to complete (approximately 15–25 minutes).

> **What this provisions:** Cloud Run service (gen2) with Cloud SQL Auth Proxy sidecar,
> Cloud SQL PostgreSQL 15 instance with `n8n_db` database and `n8n_user`, Cloud Filestore
> NFS at `/mnt/nfs`, GCS data bucket, Secret Manager secrets for encryption key and SMTP
> password, Serverless VPC Access connector, Artifact Registry repository, Cloud Build image
> pipeline, Cloud Monitoring uptime check, and a `db-init` Cloud Run Job that runs
> automatically to initialize the PostgreSQL schema.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Discover the n8n Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~n8n" \
  --limit=1)

# Get the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "n8n URL: ${SERVICE_URL}"

# Discover the DB secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8n AND name~db-password" \
  --format="value(name)" \
  --limit=1)

# Discover the encryption key secret
export ENC_KEY_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8n AND name~encryption-key" \
  --format="value(name)" \
  --limit=1)

echo "DB Secret: ${DB_SECRET}"
echo "Encryption Key Secret: ${ENC_KEY_SECRET}"
```

---

## Exercise 1 — Access n8n and Initial Setup

### Objective

Retrieve the Cloud Run service URL, confirm n8n is reachable, create the owner account,
and tour the n8n canvas editor.

### Step 1.1 — Retrieve the Service URL

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uri'
```

**Expected result:** A URL in the format `https://<hash>.a.run.app` is printed.

### Step 1.2 — Verify the Service is Healthy

**gcloud:**
```bash
gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(metadata.name, status.conditions[0].status, status.url)"

# Check revisions
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].status, spec.containerConcurrency)"
```

**Expected result:** The n8n service shows `Ready` status. The latest revision serves 100% of traffic.

### Step 1.3 — Confirm n8n is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}"
```

**Expected result:** HTTP `200`. If you see `503`, n8n may be cold-starting (15–30 seconds with `min_instance_count = 0`). Wait and retry.

### Step 1.4 — Create the Owner Account

Open `${SERVICE_URL}` in a browser. On first launch, n8n prompts you to create an owner account:

1. Enter your **email address**.
2. Enter your **first name** and **last name**.
3. Enter a strong **password** (minimum 8 characters).
4. Click **Next** and complete the setup wizard.

**Expected result:** You are redirected to the n8n canvas (workflow editor).

### Step 1.5 — Tour the n8n Canvas

1. **Canvas** — The main drag-and-drop workflow editor. Nodes represent operations; connections define data flow.
2. **Left sidebar** → **Workflows** — Lists all saved workflows. Click **+ New workflow** to create one.
3. **Left sidebar** → **Templates** — Browse 1,000+ pre-built workflow templates.
4. **Bottom-left user icon** → **Settings → Credentials** — Manage API keys and authentication.
5. **Top navigation** → **Executions** — View workflow execution history across all workflows.

**gcloud — inspect service configuration:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '{port: .template.containers[0].ports[0].containerPort, cpu: .template.containers[0].resources.limits.cpu, memory: .template.containers[0].resources.limits.memory}'
```

**Expected result:** n8n is running on port `5678` with 2 vCPU and 4Gi memory.

---

## Exercise 2 — Create and Execute Workflows

### Objective

Build a simple three-node workflow using the Manual Trigger, HTTP Request, and Set nodes —
then execute it and inspect the output data at each node.

### Step 2.1 — Create a New Workflow

1. Click **+ New workflow** in the left sidebar.
2. Click **+** on the canvas. Search for **Manual Trigger** and select it.
3. Click **+** on the right edge of the Manual Trigger. Search for **HTTP Request** and select it.
   - Set **URL** to `https://httpbin.org/get`
   - Set **Method** to `GET`
4. Click **+** after the HTTP Request. Search for **Set** and select it.
   - Click **Add Value → String**
   - Set **Name** to `message`
   - Set **Value** to `Workflow executed successfully`
5. Click **Save** (top-right).

### Step 2.2 — Execute the Workflow

Click **Execute workflow** (or click the play button on the Manual Trigger node).

**Expected result:** Each node shows a green checkmark. Click any node to inspect its input/output data. The Set node output contains `{"message": "Workflow executed successfully"}`.

### Step 2.3 — Inspect the HTTP Response Data

Click the HTTP Request node to inspect its output:
1. The **Output** panel shows the JSON response from `httpbin.org/get`.
2. Expand the response to see `args`, `headers`, `url`, and `origin` fields.

**Expected result:** The n8n canvas displays the full HTTP response data, which the Set node processes downstream.

### Step 2.4 — Add a Filter Node

1. Add a new **Filter** node between HTTP Request and Set.
2. Set **Field** to `{{ $json.headers["User-Agent"] }}` and **Operation** to `contains` with value `n8n`.
3. Re-execute the workflow.

**Expected result:** The Filter node passes data through only when the User-Agent header contains "n8n" (the n8n HTTP client sends this header by default).

### Step 2.5 — View Execution via gcloud Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"Workflow\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Log entries show workflow execution events including start and completion timestamps.

---

## Exercise 3 — Webhooks and Triggers

### Objective

Create a webhook-triggered workflow, test it with curl, and configure a schedule-based
trigger with automatic execution.

### Step 3.1 — Create a Webhook Workflow

1. Click **+ New workflow**.
2. Add a **Webhook** node as the trigger:
   - Set **HTTP Method** to `POST`
   - Set **Path** to `test-webhook`
3. Add a **Set** node after the webhook:
   - Add a string value: Name = `received`, Value = `={{ $json.body }}`
4. Click **Save**.
5. Click **Listen for Test Event** in the Webhook node.

**Expected result:** The Webhook node shows the test URL:
`${SERVICE_URL}/webhook-test/test-webhook`

### Step 3.2 — Test the Webhook with curl

```bash
curl -X POST "${SERVICE_URL}/webhook-test/test-webhook" \
  -H "Content-Type: application/json" \
  -d '{"hello": "from curl", "timestamp": "2026-05-25"}'
```

**Expected result:** The n8n UI shows the webhook received the data. The Webhook node turns green and displays the payload `{"hello": "from curl", "timestamp": "2026-05-25"}`.

### Step 3.3 — Activate the Webhook for Production Use

1. Close the test listener.
2. **Activate** the workflow using the toggle in the top-right corner.
3. The production webhook URL changes to: `${SERVICE_URL}/webhook/test-webhook`

```bash
# Test the production webhook
curl -X POST "${SERVICE_URL}/webhook/test-webhook" \
  -H "Content-Type: application/json" \
  -d '{"event": "production-test", "source": "lab"}'
```

**gcloud — verify the service is ready to receive webhooks:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.spec.containers[0].env[] | select(.name == "WEBHOOK_URL")'
```

**Expected result:** The `WEBHOOK_URL` environment variable is set to the predicted Cloud Run service URL, ensuring n8n advertises the correct webhook endpoint.

### Step 3.4 — Create a Schedule Trigger

1. Create a new workflow.
2. Add a **Schedule Trigger** node:
   - Set **Trigger Interval** to `Minutes`
   - Set **Minutes Between Triggers** to `1`
3. Add an **HTTP Request** node targeting `https://httpbin.org/uuid`.
4. **Save** and **Activate** the workflow.

**REST API — query Cloud Logging for scheduled execution:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\" AND textPayload=~\"Schedule\"",
    "pageSize": 5
  }' | jq '.entries[].textPayload'
```

**Expected result:** After 1 minute, an execution appears in the workflow's execution history. Deactivate the workflow after testing to avoid unnecessary polling.

### Step 3.5 — Scale-to-Zero Webhook Consideration

> **Note:** With `min_instance_count = 0`, the Cloud Run instance scales to zero when idle.
> Webhooks sent while the instance is down are lost (Cloud Run does not queue them). To ensure
> webhook availability at all times, set `min_instance_count = 1` via the RAD UI.

**gcloud — check current instance count:**
```bash
gcloud monitoring time-series list \
  --filter="metric.type=\"run.googleapis.com/container/instance_count\" AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.[].points[-1].value.int64Value'
```

---

## Exercise 4 — Credential Management

### Objective

Add an HTTP Basic Auth credential, verify it is encrypted and stored in Secret Manager,
and explore n8n's credential sharing feature for team deployments.

### Step 4.1 — Add an HTTP Basic Auth Credential

1. In any workflow, add an **HTTP Request** node.
2. Click **Authentication → Basic Auth → Create New Credential**.
3. Enter:
   - **Credential name:** `Lab Basic Auth`
   - **User:** `testuser`
   - **Password:** `testpassword`
4. Click **Save**.

**Expected result:** The credential is saved and listed under **Settings → Credentials**, encrypted using the `N8N_ENCRYPTION_KEY` stored in Secret Manager.

### Step 4.2 — View the Encryption Key in Secret Manager

**gcloud:**
```bash
# List n8n-related secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8n" \
  --format="table(name, createTime)"

# Verify the encryption key secret exists
gcloud secrets describe "${ENC_KEY_SECRET}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '{name: .name, createTime: .createTime, replication: .replication}'
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3An8n" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name, createTime: .createTime}'
```

**Expected result:** Two n8n secrets are listed: `*-encryption-key` and `*-db-password`. The plaintext values are never stored in Terraform state.

### Step 4.3 — Verify Encryption Key is Injected into Cloud Run

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.containers[0].env[] | select(.name == "N8N_ENCRYPTION_KEY")'
```

**Expected result:** The `N8N_ENCRYPTION_KEY` is injected as a reference to a Secret Manager secret version (not as a plaintext value), confirming secure credential storage.

### Step 4.4 — Explore Credential Sharing

1. In n8n, go to **Settings → Credentials**.
2. Click the `Lab Basic Auth` credential.
3. Click the **Sharing** tab.
4. Observe the sharing controls for team deployments.

**Expected result:** The Sharing tab allows granting other n8n users access to this credential without revealing the plaintext values. This is useful in team environments with multiple n8n users on a shared instance.

### Step 4.5 — Rotate the SMTP Password Secret

**gcloud:**
```bash
export SMTP_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8n AND name~smtp" \
  --format="value(name)" \
  --limit=1)

# Add a new version with a placeholder value (replace with real SMTP password)
echo -n "new-smtp-password-value" | \
  gcloud secrets versions add "${SMTP_SECRET}" \
  --data-file=- \
  --project="${PROJECT}"

# List versions
gcloud secrets versions list "${SMTP_SECRET}" \
  --project="${PROJECT}" \
  --format="table(name, state, createTime)"
```

**Expected result:** A new secret version is created. The previous version remains `ENABLED` until manually disabled. After the Cloud Run service restarts, it picks up the new version.

---

## Exercise 5 — Workflow History and Error Handling

### Objective

Review workflow execution history, build an error-handling workflow using the Error Trigger
node, configure per-node retry settings, and observe the error execution path.

### Step 5.1 — View Execution History

1. Open the simple workflow from Exercise 2.
2. Click **Executions** (clock icon) in the top navigation bar.

**Expected result:** A list of all executions for that workflow shows status (success/error), start time, and duration.

**gcloud — query execution events from Cloud Logging:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"Execution\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Cloud Logging shows workflow execution start and completion events corresponding to the executions in the n8n UI.

### Step 5.2 — Inspect a Successful Execution

1. Click any green (successful) execution in the history.
2. The workflow canvas highlights each node in green.
3. Click any node to see its input and output data at that step.

**Expected result:** The full data flow is visible — each node shows what data it received and what it passed to the next node.

### Step 5.3 — Create an Error Trigger Workflow

1. Create a new workflow.
2. Add an **HTTP Request** node:
   - Set **URL** to `https://invalid.example.invalid` (to force an error)
3. Add an **Error Trigger** node (a separate root node — it activates only when the workflow errors).
4. Connect the Error Trigger to a **Set** node:
   - Add a string value: Name = `error_captured`, Value = `true`
5. **Save** the workflow.

### Step 5.4 — Execute and Observe the Error Path

Click **Execute workflow**.

**Expected result:** The HTTP Request node fails (red node). The Error Trigger branch fires, and the Set node executes. The execution history shows the error path was taken, confirming the error handler worked correctly.

### Step 5.5 — Configure Per-Node Retry Settings

1. On the HTTP Request node (from Step 5.3), click the three-dot menu → **Settings**.
2. Under **On Error**, choose **Retry on Fail**.
3. Set **Max Tries** to `3`.
4. Set **Wait Between Tries** to `1000` ms.
5. Re-execute the workflow.

**Expected result:** n8n retries the HTTP Request node 3 times before triggering the Error Trigger branch. The execution log shows three retry attempts.

---

## Exercise 6 — Redis Queue Mode

### Objective

Verify that Redis is configured for n8n queue mode, inspect the Redis connection environment
variables, and understand how queue mode enables reliable multi-instance execution.

### Step 6.1 — Verify Redis Environment Variables

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.containers[0].env[] | select(.name | startswith("QUEUE_BULL") or . == "ENABLE_REDIS")'
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.template.containers[0].env[] | select(.name | startswith("ENABLE_REDIS") or startswith("QUEUE_BULL"))'
```

**Expected result:** Three environment variables are injected:
- `ENABLE_REDIS = "true"`
- `QUEUE_BULL_REDIS_HOST = $(NFS_SERVER_IP)` (resolved at runtime to the NFS server IP)
- `QUEUE_BULL_REDIS_PORT = "6379"`

### Step 6.2 — Inspect the NFS Server IP Resolution

```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.containers[0].env[] | select(.name == "NFS_SERVER_IP")'
```

**Expected result:** The `NFS_SERVER_IP` environment variable contains the private IP of the Cloud Filestore NFS instance. The `entrypoint.sh` script expands `$(NFS_SERVER_IP)` in `QUEUE_BULL_REDIS_HOST` at container startup.

### Step 6.3 — Check Queue Mode in Cloud Logging

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"redis|queue|bull\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** n8n startup logs show Redis connection establishment. In queue mode, n8n uses Bull queues backed by Redis for job scheduling and execution history.

### Step 6.4 — Understand Queue Mode Implications

With Redis queue mode enabled:
- Workflow executions are stored in a Bull queue in Redis
- Multiple Cloud Run instances can process workflows without conflicts
- The `max_instance_count` can be safely increased above `1`
- Webhooks are processed reliably with at-least-once delivery semantics

**gcloud — check current max_instance_count:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.scaling'
```

**Expected result:** `maxInstanceCount = 1` (default). With Redis queue mode enabled, you can safely increase this to `3` or more for horizontal scaling of workflow execution.

### Step 6.5 — View Redis Host Discovery in entrypoint.sh

**gcloud (check the Cloud Run job that ran db-init):**
```bash
gcloud run jobs list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(name, lastRunTime, status.latestCreatedExecution.completionTime)"
```

**Expected result:** A Cloud Run Job for the `db-init` initialization is listed as successfully completed, confirming the PostgreSQL database and `n8n_user` were created before the service started.

---

## Exercise 7 — Cloud Logging

### Objective

Query n8n application logs, filter for workflow execution events, inspect HTTP request
logs, and navigate the Cloud Logging Logs Explorer.

### Step 7.1 — View n8n Application Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND resource.labels.location=\"${REGION}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "orderBy": "timestamp desc",
    "pageSize": 20
  }' | jq '.entries[] | {timestamp: .timestamp, payload: (.textPayload // .jsonPayload.message)}'
```

**Expected result:** n8n startup logs appear, including database connection events, webhook registration messages, and the n8n version banner.

### Step 7.2 — Filter for Workflow Execution Events

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"Workflow\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\" AND textPayload=~\"Workflow\"",
    "pageSize": 10
  }' | jq '.entries[].textPayload'
```

**Expected result:** Log entries show workflow execution start and completion events, including workflow IDs and execution timestamps.

### Step 7.3 — Filter for Errors and Warnings

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=WARNING" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, only informational logs appear. Warnings may occur during cold starts or when Redis is temporarily unreachable.

### Step 7.4 — Inspect HTTP Access Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND httpRequest.status>=200" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {
    timestamp: .timestamp,
    method: .httpRequest.requestMethod,
    url: .httpRequest.requestUrl,
    status: .httpRequest.status,
    latency: .httpRequest.latency
  }'
```

**Expected result:** HTTP request logs show requests to the n8n UI, webhook endpoints, and the n8n API, with status codes and latency measurements.

### Step 7.5 — Navigate to Logs Explorer

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%0Aresource.labels.service_name%3D%22${SERVICE}%22?project=${PROJECT}"
```

Open the URL to use the interactive Logs Explorer with real-time streaming and advanced query syntax.

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Run request metrics and latency, check uptime monitor status, observe instance
scaling behavior, and inspect alert policies for the n8n deployment.

### Step 8.1 — View Cloud Run Request Metrics

Navigate to Metrics Explorer:
```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

Select:
- **Resource type:** `Cloud Run Revision`
- **Metric:** `run.googleapis.com/request_count`
- **Filter:** `service_name = ${SERVICE}`

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com" \
  --project="${PROJECT}" \
  --format="table(name)"
```

**REST API (query request count):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = \"'"${SERVICE}"'\" | within 1h | group_by [metric.response_code_class], sum(val())"
  }' | jq '.timeSeriesData[] | {code: .labelValues[0].stringValue, count: (.pointData[-1].values[0].int64Value // 0)}'
```

**Expected result:** A chart shows HTTP request counts per minute for the n8n service, broken down by response code class (2xx, 4xx, 5xx).

### Step 8.2 — View Request Latency

In Metrics Explorer, change the metric to `run.googleapis.com/request_latencies`:
```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch cloud_run_revision::run.googleapis.com/request_latencies | filter resource.service_name = \"'"${SERVICE}"'\" | within 1h | percentile(val(), 99)"
  }' | jq '.timeSeriesData[].pointData[-1].values[0].distributionValue'
```

**Expected result:** P99 latency for n8n UI requests is typically under 500ms for warm instances. Cold-start latency can be 15–30 seconds on first request with `min_instance_count = 0`.

### Step 8.3 — Check the Uptime Monitor

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period, timeout)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .name, displayName: .displayName, path: .httpCheck.path}'
```

**Expected result:** An uptime check polls n8n at `GET /` every 60 seconds from multiple global regions and shows **Passing** status. If `min_instance_count = 0`, the uptime check itself prevents full scale-to-zero by keeping the instance warm.

### Step 8.4 — Observe Instance Scaling

```bash
# Send 10 requests to observe scaling
for i in $(seq 1 10); do
  curl -s -o /dev/null "${SERVICE_URL}" &
done
wait

# Check instance count
gcloud monitoring time-series list \
  --filter="metric.type=\"run.googleapis.com/container/instance_count\" AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.[].points[-1].value.int64Value'
```

**Expected result:** Cloud Run scales up to handle concurrent requests. With `max_instance_count = 1`, only one instance runs. The instance count returns to `0` when traffic stops and `min_instance_count = 0`.

### Step 8.5 — Review Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --format="table(name, displayName, enabled)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.alertPolicies[] | {name: .name, displayName: .displayName, enabled: .enabled}'
```

**Expected result:** Alert policies for the n8n deployment are listed, including the uptime check alert. If `support_users` was configured, alerts notify those email addresses via email.

---

## 13. Cleanup

Return to the RAD UI and click **Undeploy** on the `N8N_CloudRun` deployment. This removes
the Cloud Run service, Cloud Run Jobs, Cloud SQL instance, NFS Filestore, GCS buckets,
Secret Manager secrets, and all associated IAM bindings.

> **Warning:** The `N8N_ENCRYPTION_KEY` is destroyed with the module. All credentials stored
> in n8n (API keys, OAuth tokens, passwords) are encrypted with this key and cannot be
> decrypted after re-deployment with a new key. Export credentials from n8n Settings → Export
> before undeploying if you need to re-import them.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" --quiet

# Delete secrets
gcloud secrets delete "${ENC_KEY_SECRET}" \
  --project="${PROJECT}" --quiet
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# Delete Cloud SQL instance
export SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="databaseVersion:POSTGRES_15" \
  --format="value(name)" --limit=1)
gcloud sql instances delete "${SQL_INSTANCE}" \
  --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## 14. Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID (required) |
| `region` | `string` | `us-central1` | GCP region for all resources |
| `application_name` | `string` | `n8n` | Base resource name |
| `application_version` | `string` | `2.4.7` | n8n container image tag |
| `tenant_deployment_id` | `string` | `demo` | Short suffix appended to resource names |
| `deploy_application` | `bool` | `true` | Deploy the n8n service (false = infra only) |
| `cpu_limit` | `string` | `2000m` | CPU per Cloud Run instance |
| `memory_limit` | `string` | `4Gi` | Memory per Cloud Run instance |
| `min_instance_count` | `number` | `0` | Scale-to-zero (set 1 for webhook availability) |
| `max_instance_count` | `number` | `1` | Max instances (increase only with Redis enabled) |
| `container_port` | `number` | `5678` | n8n listening port |
| `execution_environment` | `string` | `gen2` | Gen2 required for NFS mounts |
| `timeout_seconds` | `number` | `300` | Max request duration |
| `enable_nfs` | `bool` | `true` | Cloud Filestore NFS for workflow persistence |
| `nfs_mount_path` | `string` | `/mnt/nfs` | NFS mount path inside container |
| `enable_redis` | `bool` | `true` | Redis queue mode (uses NFS server IP by default) |
| `redis_host` | `string` | `""` | Redis hostname (blank = NFS server IP) |
| `redis_port` | `string` | `6379` | Redis TCP port |
| `db_name` | `string` | `n8n_db` | PostgreSQL database name |
| `db_user` | `string` | `n8n_user` | PostgreSQL application user |
| `database_password_length` | `number` | `32` | Auto-generated password length |
| `enable_auto_password_rotation` | `bool` | `false` | Automated DB password rotation |
| `ingress_settings` | `string` | `all` | Cloud Run ingress (all required for webhooks) |
| `vpc_egress_setting` | `string` | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `backup_schedule` | `string` | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | `number` | `7` | Days to retain backup files |
| `support_users` | `list(string)` | `[]` | Email addresses for monitoring alerts |

### Auto-Injected Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `N8N_PORT` | `5678` | Hardcoded to match `container_port` |
| `N8N_PROTOCOL` | `https` | Public protocol for webhook URL generation |
| `N8N_DIAGNOSTICS_ENABLED` | `true` | Usage telemetry |
| `N8N_METRICS` | `true` | Prometheus metrics endpoint |
| `N8N_SECURE_COOKIE` | `false` | Required because Cloud Run terminates TLS |
| `N8N_DEFAULT_BINARY_DATA_MODE` | `filesystem` | Binary data stored on GCS Fuse volume |
| `DB_TYPE` | `postgresdb` | Forces PostgreSQL backend |
| `WEBHOOK_URL` | Predicted service URL | Pre-computed before deployment |
| `N8N_EDITOR_BASE_URL` | Predicted service URL | Same as `WEBHOOK_URL` |
| `ENABLE_REDIS` | `true` / `false` | Reflects `enable_redis` variable |
| `N8N_ENCRYPTION_KEY` | Secret Manager ref | Auto-generated; never in plaintext state |
| `N8N_SMTP_PASS` | Secret Manager ref | Placeholder SMTP password |

### Useful Commands Reference

```bash
# Get n8n service URL
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --format="value(status.url)"

# Tail n8n logs
gcloud logging tail \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" \
  --project="${PROJECT}"

# List revisions
gcloud run revisions list --service="${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}"

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~n8n"

# Check uptime monitor
gcloud monitoring uptime list-configs --project="${PROJECT}"

# Check instance count
gcloud monitoring time-series list \
  --filter="metric.type=run.googleapis.com/container/instance_count AND resource.labels.service_name=${SERVICE}" \
  --project="${PROJECT}"
```

### Further Reading

- [n8n documentation](https://docs.n8n.io/)
- [n8n queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/)
- [n8n webhook nodes](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [Cloud Run gen2 execution environment](https://cloud.google.com/run/docs/about-execution-environments)
- [Cloud SQL Auth Proxy overview](https://cloud.google.com/sql/docs/postgres/sql-proxy)
- [Secret Manager for Cloud Run](https://cloud.google.com/run/docs/configuring/secrets)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Cloud Filestore NFS for Cloud Run](https://cloud.google.com/run/docs/tutorials/network-filesystems-fuse)
