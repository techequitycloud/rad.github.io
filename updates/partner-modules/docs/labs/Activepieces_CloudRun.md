# Activepieces on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Activepieces_CloudRun)**

Activepieces is an open-source, Apache 2.0-licensed workflow automation platform — a self-hosted
alternative to Zapier and Make — with 22,000+ GitHub stars and 100,000+ active installations.
This lab deploys Activepieces on Google Cloud Run with a Cloud SQL PostgreSQL 15 backend, GCS data
storage, and auto-generated encryption keys. You will configure the admin account, build and test
automation flows, connect external services, create webhook triggers, explore templates, inspect
backing infrastructure, and review GCP observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Activepieces](#exercise-1--access-activepieces)
6. [Exercise 2 — Create an Automation Flow](#exercise-2--create-an-automation-flow)
7. [Exercise 3 — Connections and Integrations](#exercise-3--connections-and-integrations)
8. [Exercise 4 — Webhook Triggers](#exercise-4--webhook-triggers)
9. [Exercise 5 — Flow Templates and Sharing](#exercise-5--flow-templates-and-sharing)
10. [Exercise 6 — Database and Storage](#exercise-6--database-and-storage)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Activepieces?

Activepieces is a **no-code / low-code workflow automation platform** that connects 450+ services
via a visual drag-and-drop flow builder. Flows respond to events (webhooks, schedules, or app
triggers), run steps (HTTP requests, data transforms, service integrations), and can branch on
conditions. The `Activepieces_CloudRun` module deploys Activepieces on Cloud Run with a
Node.js container, PostgreSQL 15 backend, and auto-generated JWT and encryption keys.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Admin Setup** | First-run account creation, dashboard overview |
| **Flow Builder** | Visual drag-and-drop automation with triggers and actions |
| **Connections** | OAuth and API key credential management |
| **Webhook Triggers** | HTTP event-driven flow execution from external systems |
| **Flow Templates** | Pre-built automation templates, export/import |
| **Database Inspection** | Cloud SQL backing store and Secret Manager secrets |
| **Cloud Logging** | Structured log queries for flow execution events |
| **Cloud Monitoring** | Cloud Run metrics, uptime checks, and alert policies |

---

## 2. Architecture

```
Browser / External Webhook
       │
       ▼ HTTPS (Cloud Run ingress, port 443/8080)
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Run (gen2)                                                │
│  activepieces service — Node.js                                  │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐   │
│  │  Activepieces       │  │  Cloud SQL Auth Proxy sidecar    │   │
│  │  Node.js server     │  │  Unix socket bridge              │   │
│  │  (API + UI + worker │  │  → PostgreSQL 15                 │   │
│  │   in one process)   │  │                                  │   │
│  └─────────────────────┘  └──────────────────────────────────┘   │
│  AP_QUEUE_MODE = MEMORY                                          │
│  AP_EXECUTION_MODE = UNSANDBOXED                                 │
└──────────────────────────────────────────────────────────────────┘
       │                    │
       ▼                    ▼
┌─────────────────┐  ┌─────────────────────────────────────────┐
│  GCS Bucket     │  │  Cloud SQL PostgreSQL 15                │
│  ap-data        │  │  flows, runs, connections,              │
│  (file uploads, │  │  users, pieces metadata                 │
│   attachments)  │  └─────────────────────────────────────────┘
└─────────────────┘

Supporting resources:
  Secret Manager  → AP_ENCRYPTION_KEY, AP_JWT_SECRET, DB password
  Artifact Registry → custom Activepieces container image
  Cloud Build     → image build and mirroring
  Serverless VPC  → private Cloud SQL access
  Cloud Monitoring → uptime check on service URL
```

Module variable wiring:

```
Activepieces_CloudRun
  application_name    = "activepieces"
  cpu_limit           = "2000m"
  memory_limit        = "2Gi"
  min_instance_count  = 0           → scale-to-zero (set 1 for webhooks)
  max_instance_count  = 1
  AP_QUEUE_MODE       = MEMORY      → in-process queue (no Redis)
  AP_EXECUTION_MODE   = UNSANDBOXED → required for Cloud Run
  AP_ENCRYPTION_KEY   → auto-generated, stored in Secret Manager
  AP_JWT_SECRET       → auto-generated, stored in Secret Manager
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` | Any | System package manager |
| `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
roles/logging.viewer
roles/monitoring.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"   # your GCP project ID
export REGION="us-central1"             # region you deployed into
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Activepieces_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `activepieces` | Base resource name |
| `min_instance_count` | `1` | Recommended for webhook reliability |
| `max_instance_count` | `1` | Default; set higher for scale-out |
| `cpu_limit` | `2000m` | Node.js needs adequate CPU |
| `memory_limit` | `2Gi` | Sufficient for typical workloads |

Click **Deploy** and wait for provisioning (approximately 10–18 minutes).

> **What this provisions:** Cloud Run service (gen2), Cloud SQL PostgreSQL 15 instance and
> database (with `pgvector` extension), Secret Manager secrets for `AP_ENCRYPTION_KEY`,
> `AP_JWT_SECRET`, and DB password, Artifact Registry repository, Cloud Build custom image
> pipeline, Serverless VPC Access connector, IAM bindings, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~activepieces" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Service: ${SERVICE}"
echo "URL: ${SERVICE_URL}"

# Discover secrets
export ENC_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~activepieces.*encryption OR name~activepieces.*enc" \
  --format="value(name)" \
  --limit=1)

export JWT_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~activepieces.*jwt" \
  --format="value(name)" \
  --limit=1)
```

---

## Exercise 1 — Access Activepieces

### Objective

Retrieve the service URL, verify the service is running, and complete the initial admin
account setup.

### Step 1.1 — Verify the Service Is Running

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions[0].type, status.conditions[0].status)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{url: .uri, ready: .terminalCondition.state}'
```

**Expected result:** Service URL shown with condition `Ready: True`.

### Step 1.2 — Check the Service Responds

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}"
```

**Expected result:** HTTP `200` or `302` (redirect to login or setup page).

> If Cloud Run returns `503`, the first boot database migration may still be running. The
> startup probe allows up to ~7 minutes. Wait and retry.

### Step 1.3 — Create the Admin Account

Open `${SERVICE_URL}` in a browser. On first visit, Activepieces shows the account setup page.

Fill in:
- **Full name** — your name
- **Email address** — your work email
- **Password** — a strong password

Click **Get Started**.

**Expected result:** Redirected to the Activepieces dashboard.

### Step 1.4 — Explore the Dashboard

Note the main navigation sections:
- **Flows** — list and manage automation flows
- **Connections** — manage OAuth and API key credentials
- **Runs** — view execution history and step traces
- **Settings** — platform and user configuration

### Step 1.5 — Check the Cloud Run Revision

**gcloud:**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].type, status.conditions[0].status)"
```

**Expected result:** Latest revision shows `Ready: True`.

---

## Exercise 2 — Create an Automation Flow

### Objective

Build a complete automation flow with a Webhook trigger, an HTTP Request action, and a
conditional branch. Publish and test the flow end-to-end.

### Step 2.1 — Create a New Flow

In the Activepieces UI, click **New Flow** (or the `+` button in the Flows section).

Name the flow `My First Automation`.

### Step 2.2 — Add a Webhook Trigger

Click **Add Trigger** and select **Webhook** from the list.

Copy the webhook URL shown in the trigger panel — it has the form:
```
${SERVICE_URL}/api/v1/webhooks/<id>
```

Save this URL in your shell:
```bash
export WEBHOOK_URL="<paste-webhook-url-here>"
```

### Step 2.3 — Add an HTTP Request Action

Click the `+` after the Webhook trigger and select **HTTP Request**:
- **Method:** `GET`
- **URL:** `https://httpbin.org/json`

**Expected result:** HTTP Request step appears in the flow canvas.

### Step 2.4 — Add a Branch Action

Click the `+` after the HTTP Request step and select **Branch**:
- Add a condition: `{{steps.httpRequest.response.status}}` equals `200`

**Expected result:** Flow branches into `true` and `false` paths.

### Step 2.5 — Publish the Flow

Toggle the **Published** switch at the top of the editor.

**Expected result:** Toggle turns green and flow status changes to `Enabled`.

### Step 2.6 — Test the Flow with curl

```bash
curl -s -X POST "${WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{"test": "data", "source": "lab-exercise-2"}'
```

**Expected result:** HTTP `200` response from Activepieces.

**gcloud (check execution logs):**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
  --project="${PROJECT}" \
  --limit=10
```

### Step 2.7 — View the Run in the UI

Navigate to **Runs** in the Activepieces UI. Click on the most recent run.

**Expected result:** Step-by-step trace showing the Webhook trigger, HTTP Request response,
and Branch evaluation.

---

## Exercise 3 — Connections and Integrations

### Objective

Add an authenticated connection, understand credential storage, and use the connection in a flow.

### Step 3.1 — Navigate to Connections

In the Activepieces UI, navigate to **Connections** in the left navigation.

### Step 3.2 — Browse Available Pieces

Click **New Connection** (or browse from within a flow's step picker). Filter by category:
- **Communication:** Slack, Gmail, Discord
- **Data:** Google Sheets, Airtable, PostgreSQL
- **Utilities:** HTTP Request, Delay, Branch
- **AI:** OpenAI, Anthropic

**Expected result:** 450+ integration pieces visible.

### Step 3.3 — Add an HTTP Basic Auth Connection

Click **New Connection** and select the **HTTP** piece:
- **Connection name:** `lab-http-auth`
- **Auth type:** `Basic Auth`
- **Username:** `testuser`
- **Password:** `testpass`

Click **Save**.

**Expected result:** Connection appears in the Connections list with a status indicator.

### Step 3.4 — Verify Secret Storage

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~activepieces" \
  --format="table(name, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | select(.name | test("activepieces")) | {name: .name}'
```

**Expected result:** Secrets for `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, and database password.

> Connection credentials are encrypted using `AP_ENCRYPTION_KEY` before being stored in the
> PostgreSQL database — they never appear in plain text in Secret Manager or the database.

### Step 3.5 — Use the Connection in a Flow

Create a new flow:

1. Add a **Webhook** trigger
2. Add an **HTTP Request** step and select your `lab-http-auth` connection
3. Set URL to `https://httpbin.org/basic-auth/testuser/testpass`
4. Publish and test with curl

**Expected result:** The flow authenticates successfully and returns a `200` response.

---

## Exercise 4 — Webhook Triggers

### Objective

Create dedicated webhook endpoints, test them with curl, and inspect trigger behaviour.

### Step 4.1 — Create a Webhook-Only Flow

Create a new flow named `Webhook Echo`:

1. Add a **Webhook** trigger and copy the webhook URL
2. Add a **Log to Console** step (or HTTP Request to `https://httpbin.org/post`)
3. Publish the flow

```bash
export ECHO_WEBHOOK="${SERVICE_URL}/api/v1/webhooks/<your-webhook-id>"
```

### Step 4.2 — Test with a Simple Payload

```bash
curl -s -X POST "${ECHO_WEBHOOK}" \
  -H "Content-Type: application/json" \
  -d '{"event": "user.created", "user_id": 42, "email": "test@example.com"}'
```

**Expected result:** HTTP `200` response from Activepieces.

### Step 4.3 — Test with Query Parameters

```bash
curl -s -X POST "${ECHO_WEBHOOK}?source=lab&env=test" \
  -H "Content-Type: application/json" \
  -d '{"action": "ping"}'
```

**Expected result:** Webhook receives both query parameters and body in the trigger payload.

### Step 4.4 — Inspect the Webhook Run

Navigate to **Runs** and click the latest execution. Examine:
- **Trigger payload** — the full JSON body received
- **Query parameters** — URL parameters passed to the webhook
- **Headers** — HTTP headers from the request
- **Step outputs** — results from each action step

### Step 4.5 — Test Cold Start Behaviour

If `min_instance_count = 0`, test the cold start behaviour:

```bash
# Note the response time on first call after idle period
time curl -s -X POST "${ECHO_WEBHOOK}" \
  -H "Content-Type: application/json" \
  -d '{"test": "cold-start"}'
```

**Expected result:** First call may take 15–30 seconds if the instance scaled to zero. Subsequent calls respond in < 1 second.

> For production webhooks, set `min_instance_count = 1` to eliminate cold starts.

---

## Exercise 5 — Flow Templates and Sharing

### Objective

Explore built-in flow templates, export a flow as JSON, and import it back.

### Step 5.1 — Browse Templates

In the Activepieces UI, click **New Flow** and look for a **Browse Templates** option (if
available in your deployment version).

Common template categories:
- **Lead Management** — CRM and email automation
- **Developer Tools** — GitHub notifications, CI/CD alerts
- **E-commerce** — order notifications, inventory alerts
- **AI Workflows** — LLM-powered content generation

### Step 5.2 — Export a Flow as JSON

In the Flows list, click on your `My First Automation` flow, then select **Export** (or
look for a download icon in the flow editor top menu).

Save the exported JSON as `my-first-flow.json`.

```bash
# Examine the exported flow structure
cat my-first-flow.json | jq '{
  displayName: .displayName,
  triggers: [.trigger.type],
  steps: [.trigger.nextAction.type]
}'
```

**Expected result:** JSON structure showing the flow definition including trigger type and step configuration.

### Step 5.3 — Import the Flow

In the Flows list, click the **Import** button (or `+` > Import). Select `my-first-flow.json`.

**Expected result:** An imported copy of the flow appears in the flow list with `(Copy)` appended.

### Step 5.4 — Duplicate and Modify a Flow

In the flow list, find your `Webhook Echo` flow and select **Duplicate**.

In the duplicate, change the webhook trigger configuration and add a **Delay** step of 2 seconds.

Publish and test the modified flow to verify the delay executes correctly.

### Step 5.5 — View Flow Version History

In the flow editor, look for a **Versions** option to see the history of changes to the flow definition.

**Expected result:** Each published version is listed with a timestamp and can be restored.

---

## Exercise 6 — Database and Storage

### Objective

Inspect the Cloud SQL database backing Activepieces and the GCS data storage bucket.

### Step 6.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~activepieces" \
  --format="table(name, state, databaseVersion, settings.tier)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/sql/v1beta4/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | select(.name | test("activepieces")) | {name: .name, state: .state, version: .databaseVersion}'
```

**Expected result:** Activepieces Cloud SQL instance in `RUNNABLE` state, PostgreSQL 15.

### Step 6.2 — View Databases on the Instance

**gcloud:**
```bash
export INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~activepieces" \
  --format="value(name)" \
  --limit=1)

gcloud sql databases list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"
```

**Expected result:** `activepieces` database listed on the instance.

### Step 6.3 — Inspect the GCS Data Bucket

```bash
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~activepieces.*storage OR name~activepieces.*data" \
  --format="value(name)" \
  | head -1)

gcloud storage ls "gs://${BUCKET}/"
```

**Expected result:** GCS bucket with file attachment or output directories.

### Step 6.4 — Check Secret Manager Secrets

```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~activepieces" \
  --format="table(name, createTime)"
```

**Expected result:** Secrets for `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, and database credentials.

### Step 6.5 — Verify the pgvector Extension

The `db-init.sh` script installs the `pgvector` extension during database initialisation.
Verify by checking the Cloud Build initialization job logs:

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.service_name~"db-init" AND resource.labels.service_name~"activepieces"' \
  --project="${PROJECT}" \
  --limit=10 \
  --format=json \
  | jq '.[].textPayload // .[].jsonPayload'
```

**Expected result:** Log entries showing database creation and `pgvector` extension installation.

---

## Exercise 7 — Cloud Logging

### Objective

Find Activepieces application logs in Cloud Logging using the console and gcloud CLI.

### Step 7.1 — View Logs in Cloud Logging Console

Navigate to:
```
https://console.cloud.google.com/logs/query?project=${PROJECT}
```

Filter for Activepieces Cloud Run logs:
```
resource.type="cloud_run_revision"
resource.labels.service_name=~"activepieces"
```

**Expected result:** Node.js startup messages, webhook receipts, and flow execution events.

### Step 7.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
  --project="${PROJECT}" \
  --limit=20 \
  --format=json \
  | jq '.[].textPayload // .[].jsonPayload'
```

### Step 7.3 — Filter for Error Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND severity>=ERROR' \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** Any error-level log entries from the Activepieces service.

### Step 7.4 — Query via REST API

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "orderBy": "timestamp desc",
    "pageSize": 20
  }' | jq '.entries[] | {timestamp, payload: (.jsonPayload // .textPayload)}'
```

### Step 7.5 — Stream Logs in Real Time

```bash
gcloud alpha run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

While the tail is running in one terminal, trigger a webhook from another:
```bash
curl -s -X POST "${WEBHOOK_URL}" -d '{"live": true}'
```

**Expected result:** Log entries appear in real time as the flow executes.

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Run request metrics, memory and CPU utilization, and the uptime check for
the Activepieces service.

### Step 8.1 — Open Cloud Monitoring

Navigate to:
```
https://console.cloud.google.com/monitoring?project=${PROJECT}
```

### Step 8.2 — Explore Key Metrics in Metrics Explorer

In **Metrics Explorer**, query these Cloud Run metrics:
- `run.googleapis.com/request_count` — requests per revision (filter by service name)
- `run.googleapis.com/request_latencies` — P50/P95/P99 latency
- `run.googleapis.com/container/cpu/utilizations` — CPU (Node.js: typically 5–20% at idle)
- `run.googleapis.com/container/memory/utilizations` — memory (Activepieces: 40–70% of 2Gi)
- `run.googleapis.com/container/instance_count` — active instance count

Filter by `resource.service_name = ${SERVICE}` and `resource.location = ${REGION}`.

### Step 8.3 — Check the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {name: .displayName, host: .httpCheck.path}'
```

**Expected result:** An uptime check probing the Activepieces service URL.

### Step 8.4 — Query Metrics via REST API

```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch cloud_run_revision | metric run.googleapis.com/container/memory/utilizations | filter resource.service_name = \"'"${SERVICE}"'\" | every 5m | within 1h | group_by [], mean(val())"
  }' | jq '.timeSeriesData[].pointData[-1].values[0].doubleValue'
```

**Expected result:** Average memory utilization value (0.0–1.0 scale).

### Step 8.5 — Create an Alert Policy

**gcloud:**
```bash
gcloud alpha monitoring policies create \
  --display-name="Activepieces - Memory Alert" \
  --condition-filter='metric.type="run.googleapis.com/container/memory/utilizations" resource.label.service_name="'"${SERVICE}"'"' \
  --condition-threshold-value=0.9 \
  --condition-threshold-duration=300s \
  --condition-threshold-comparison=COMPARISON_GT \
  --project="${PROJECT}"
```

**Expected result:** Alert policy created; fires if memory exceeds 90% for 5 minutes.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Activepieces_CloudRun` deployment. This
removes the Cloud Run service, Cloud SQL instance, Secret Manager secrets, GCS bucket, Artifact
Registry images, and all supporting IAM resources.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --quiet

# Delete Cloud SQL instance
gcloud sql instances delete "${INSTANCE}" \
  --project="${PROJECT}" --quiet

# Delete GCS bucket
gcloud storage rm -r "gs://${BUCKET}/"

# Delete secrets
gcloud secrets list --project="${PROJECT}" --filter="name~activepieces" \
  --format="value(name)" | \
  xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region |
| `application_name` | string | `activepieces` | Base resource name |
| `application_version` | string | `latest` | Container image version tag |
| `cpu_limit` | string | `2000m` | CPU limit per instance |
| `memory_limit` | string | `2Gi` | Memory limit per instance |
| `min_instance_count` | number | `0` | Set to `1` for webhook reliability |
| `max_instance_count` | number | `1` | Maximum instances |
| `enable_redis` | bool | `false` | Enable Redis queue for horizontal scaling |
| `redis_host` | string | `""` | Redis hostname (leave blank for NFS IP) |
| `redis_port` | number | `6379` | Redis TCP port |
| `db_name` | string | `activepieces` | PostgreSQL database name |
| `db_user` | string | `activepieces` | PostgreSQL user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron (UTC) |
| `backup_retention_days` | number | `7` | Backup retention period |

### Key Environment Variables (Auto-Injected)

| Variable | Value | Purpose |
|---|---|---|
| `AP_DB_TYPE` | `POSTGRES` | Use PostgreSQL backend |
| `AP_PORT` | `8080` | HTTP port |
| `AP_QUEUE_MODE` | `MEMORY` | In-process queue (default) |
| `AP_EXECUTION_MODE` | `UNSANDBOXED` | Required for Cloud Run |
| `AP_ENVIRONMENT` | `production` | Activepieces run mode |
| `AP_TELEMETRY_ENABLED` | `false` | Disable telemetry |
| `AP_SIGN_UP_ENABLED` | `true` | Allow user registration |
| `AP_ENCRYPTION_KEY` | auto-generated | Credential encryption key |
| `AP_JWT_SECRET` | auto-generated | JWT signing secret |

### Useful Commands

```bash
# Get service URL
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --format="value(status.url)"

# Check service health
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}"

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~activepieces"

# Trigger a webhook
curl -X POST "${WEBHOOK_URL}" -H "Content-Type: application/json" -d '{"key": "value"}'

# View Cloud Run logs
gcloud logging read 'resource.type="cloud_run_revision"' \
  --project="${PROJECT}" --limit=50

# Check uptime checks
gcloud monitoring uptime list-configs --project="${PROJECT}"

# Stream live logs
gcloud alpha run services logs tail "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}"
```

### Further Reading

- [Activepieces documentation](https://www.activepieces.com/docs)
- [Activepieces pieces catalog](https://www.activepieces.com/pieces)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [pgvector extension](https://github.com/pgvector/pgvector)
- [Cloud Logging query language](https://cloud.google.com/logging/docs/view/logging-query-language)
