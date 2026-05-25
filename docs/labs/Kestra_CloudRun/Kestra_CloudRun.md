---
title: "Kestra on Cloud Run — Lab Guide"
sidebar_label: "Kestra CloudRun"
---

# Kestra on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kestra_CloudRun)**

Kestra is an open-source, declarative, event-driven workflow orchestration platform (Apache 2.0) with
26,000+ GitHub stars, trusted by more than 30,000 organisations. This lab deploys Kestra in
**standalone mode** on Google Cloud Run — the server, worker, and scheduler run in a single container
backed by Cloud SQL PostgreSQL 15 and GCS artifact storage. You will explore YAML-based flow
authoring, scheduling, webhook triggers, namespace management, plugin integrations, execution
monitoring, and GCP observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Kestra](#exercise-1--access-kestra)
6. [Exercise 2 — Create Your First Flow](#exercise-2--create-your-first-flow)
7. [Exercise 3 — Scheduling and Triggers](#exercise-3--scheduling-and-triggers)
8. [Exercise 4 — Namespace Management](#exercise-4--namespace-management)
9. [Exercise 5 — Plugins and Integrations](#exercise-5--plugins-and-integrations)
10. [Exercise 6 — Execution History and Monitoring](#exercise-6--execution-history-and-monitoring)
11. [Exercise 7 — Database and Storage](#exercise-7--database-and-storage)
12. [Exercise 8 — Cloud Logging and Monitoring](#exercise-8--cloud-logging-and-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Kestra?

Kestra is a **declarative orchestration platform** for data pipelines, ETL/ELT workflows, and
API automation. Every flow is defined as a plain YAML document with tasks, triggers, and
namespace-scoped variables — making it fully version-controllable. The `Kestra_CloudRun` module
deploys Kestra in standalone mode on Cloud Run with a PostgreSQL 15 queue and repository backend.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **YAML Flow Authoring** | Create, edit, and version-control workflow definitions |
| **Scheduling** | Cron-based and event-driven execution triggers |
| **Webhook Triggers** | HTTP-triggered executions from external systems |
| **Namespace Management** | Organise flows into hierarchical namespaces with scoped variables |
| **Plugin Ecosystem** | GCS, BigQuery, HTTP, and PostgreSQL task integrations |
| **Execution Monitoring** | Per-execution logs, task traces, and failure replay |
| **GCP Observability** | Cloud Logging structured logs, Cloud Monitoring uptime checks |

---

## 2. Architecture

```
Browser / API Client
       │
       ▼ HTTPS (Cloud Run ingress)
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Run (gen2)                                                │
│  kestra service — standalone mode                                │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────┐   │
│  │  Kestra JVM │  │  Cloud SQL Auth  │  │  GCS Fuse (opt.)   │   │
│  │  Server     │  │  Proxy sidecar   │  │  flow storage      │   │
│  │  Worker     │  │  socat TCP bridge│  │                    │   │
│  │  Scheduler  │  │  → PostgreSQL    │  │                    │   │
│  └─────────────┘  └──────────────────┘  └────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
       │                    │
       ▼                    ▼
┌─────────────────┐  ┌─────────────────────────────────────────┐
│  GCS Bucket     │  │  Cloud SQL PostgreSQL 15                │
│  kestra-storage │  │  Queue + Repository backend             │
│  (artifacts,    │  │  (executions, flows, logs)              │
│   flow outputs) │  └─────────────────────────────────────────┘
└─────────────────┘

Supporting resources:
  Secret Manager     → KESTRA_BASICAUTH_PASSWORD (admin password)
  Artifact Registry  → custom Kestra container image
  Cloud Build        → image build and mirroring
  Serverless VPC     → private Cloud SQL access
  Cloud Monitoring   → uptime checks on /health
```

Module variable wiring:

```
Kestra_CloudRun
  application_name     = "kestra"
  cpu_limit            = "2000m"   → JVM needs ≥ 2 vCPU
  memory_limit         = "4Gi"     → JVM heap + OS overhead
  min_instance_count   = 1         → avoids cold-start scheduler loss
  max_instance_count   = 1         → standalone mode: single instance
  enable_cloudsql_volume = true    → Cloud SQL Auth Proxy sidecar
  KESTRA_QUEUE_TYPE    = postgres  → PostgreSQL execution queue
  KESTRA_STORAGE_TYPE  = gcs       → GCS artifact storage
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

Deploy the `Kestra_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `kestra` | Base resource name |
| `cpu_limit` | `2000m` | Minimum 2 vCPU for JVM |
| `memory_limit` | `4Gi` | Minimum 4Gi for JVM heap |
| `min_instance_count` | `1` | Keep warm — slow JVM cold start |
| `max_instance_count` | `1` | Standalone mode only |

Click **Deploy** and wait for provisioning (approximately 15–25 minutes).

> **What this provisions:** Cloud Run service (gen2), Cloud SQL PostgreSQL 15 instance and
> database, Secret Manager secret for admin password, Artifact Registry repository, Cloud Build
> custom image pipeline, Serverless VPC Access connector, IAM bindings, and Cloud Monitoring
> uptime check on `/health`.

### 4.2 Configure Shell Environment

```bash
# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~kestra" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Service: ${SERVICE}"
echo "URL: ${SERVICE_URL}"

# Discover the admin password secret
export ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~kestra.*admin" \
  --format="value(name)" \
  --limit=1)
```

---

## Exercise 1 — Access Kestra

### Objective

Retrieve the Cloud Run service URL, verify the health endpoint, and explore the Kestra UI.

### Step 1.1 — Verify Service Health

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

**Expected result:** Service URL shown and condition type `Ready` with status `True`.

### Step 1.2 — Check Kestra Health Endpoint

```bash
curl -s "${SERVICE_URL}/health"
```

**Expected result:** `{"status":"UP"}` JSON response.

> If Cloud Run returns `503` immediately after deployment, Kestra's JVM may still be
> initialising. Wait 2–3 minutes and retry. The startup probe allows up to 14 minutes
> (`initial_delay_seconds=30` + `failure_threshold=40` x `period_seconds=20`).

### Step 1.3 — Retrieve the Admin Password

```bash
gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}"
```

**Expected result:** A 24-character alphanumeric string — this is the `admin` user password.

### Step 1.4 — Explore the Kestra UI

Navigate to `${SERVICE_URL}` in a browser. Log in with:
- Username: `admin`
- Password: (value from Step 1.3)

Explore the main navigation tabs:
- **Flows** — list and manage YAML flow definitions
- **Executions** — view execution history, status, and task logs
- **Logs** — aggregated execution and system logs
- **Namespaces** — organise flows into hierarchical groups
- **Audit Log** — full audit trail of all user and system actions

### Step 1.5 — Check Cloud Run Revision Status

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

## Exercise 2 — Create Your First Flow

### Objective

Write and execute a YAML flow using the Kestra flow editor, then verify logs and execution graph.

### Step 2.1 — Create a Hello World Flow

In the Kestra UI, navigate to **Flows** and click **Create**. Replace the default content with:

```yaml
id: hello-world
namespace: company.team
tasks:
  - id: hello
    type: io.kestra.plugin.core.log.Log
    message: "Hello from Kestra on Cloud Run!"
  - id: show_date
    type: io.kestra.plugin.core.log.Log
    message: "Current date: {{ now() }}"
```

Click **Save**.

**Expected result:** Flow `hello-world` appears in the `company.team` namespace.

### Step 2.2 — Execute the Flow via UI

Click **Execute** (the play button) on the flow.

**Expected result:** Execution transitions: `CREATED` → `RUNNING` → `SUCCESS`.

### Step 2.3 — Execute the Flow via REST API

```bash
curl -s -X POST \
  "${SERVICE_URL}/api/v1/executions/company.team/hello-world" \
  -H "Content-Type: application/json" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '{id: .id, state: .state.current}'
```

**Expected result:** JSON with `id` and `state: "CREATED"` or `"SUCCESS"`.

### Step 2.4 — View the Execution Graph

Click on the execution in the Kestra UI. Explore:
- **Execution Graph** — visual topology of task dependencies
- **Logs** tab on each task — individual task output
- **Overview** tab — timing, trigger type, and namespace

### Step 2.5 — List Recent Executions

**REST API:**
```bash
curl -s \
  "${SERVICE_URL}/api/v1/executions?namespace=company.team&flowId=hello-world&size=5" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.results[] | {id: .id, state: .state.current, startDate: .state.startDate}'
```

**Expected result:** List of recent executions with their states and timestamps.

---

## Exercise 3 — Scheduling and Triggers

### Objective

Add a Schedule cron trigger and a Webhook trigger to a flow, then test both.

### Step 3.1 — Add Schedule and Webhook Triggers

Edit the `hello-world` flow in the Kestra UI and update it to:

```yaml
id: hello-world
namespace: company.team
tasks:
  - id: hello
    type: io.kestra.plugin.core.log.Log
    message: "Triggered by: {{ trigger.type ?? 'manual' }}"
triggers:
  - id: schedule
    type: io.kestra.plugin.core.trigger.Schedule
    cron: "*/5 * * * *"
  - id: webhook
    type: io.kestra.plugin.core.trigger.Webhook
    key: my-lab-key
```

Click **Save**.

**Expected result:** Flow shows two triggers in the definition.

### Step 3.2 — Test the Webhook Trigger

```bash
curl -s -X POST \
  "${SERVICE_URL}/api/v1/executions/webhook/company.team/hello-world/my-lab-key" \
  -H "Content-Type: application/json" \
  -d '{"source": "lab-test", "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
```

**Expected result:** JSON response with an `id` field — the new execution ID.

### Step 3.3 — Verify Webhook Execution

**REST API:**
```bash
curl -s \
  "${SERVICE_URL}/api/v1/executions?namespace=company.team&flowId=hello-world&triggerType=WEBHOOK&size=3" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.results[] | {id: .id, trigger: .trigger.type, state: .state.current}'
```

**Expected result:** An execution entry with `trigger.type = "WEBHOOK"`.

### Step 3.4 — Verify Schedule Trigger (Wait 5 minutes)

Wait for the next 5-minute mark on the clock. Then check:

```bash
curl -s \
  "${SERVICE_URL}/api/v1/executions?namespace=company.team&flowId=hello-world&triggerType=SCHEDULE&size=3" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.results[] | {id: .id, trigger: .trigger.type, state: .state.current}'
```

**Expected result:** A new execution with `trigger.type = "SCHEDULE"`.

### Step 3.5 — Inspect the Triggers Tab in the UI

In the Kestra UI, navigate to the `hello-world` flow and click the **Triggers** tab.

**Expected result:** Both triggers listed with their last-run time and next scheduled run.

---

## Exercise 4 — Namespace Management

### Objective

Create a namespace, add flows to it, configure namespace-level variables, and understand
namespace isolation.

### Step 4.1 — Create a Namespace

In the Kestra UI, navigate to **Namespaces** and click **Create Namespace**. Enter:

- Namespace: `lab.experiments`

Click **Save**.

**Expected result:** `lab.experiments` appears in the namespace list.

### Step 4.2 — Create a Flow in the New Namespace

Navigate to **Flows > Create** and enter:

```yaml
id: namespace-test
namespace: lab.experiments
tasks:
  - id: log
    type: io.kestra.plugin.core.log.Log
    message: "Environment: {{ namespace.environment }}"
```

Click **Save**.

### Step 4.3 — Add a Namespace Variable

In the **Namespaces** view, click on `lab.experiments` then **Variables > Add Variable**:
- Key: `environment`
- Value: `lab`

Click **Save**.

**Expected result:** Variable saved; referenced in flows as `{{ namespace.environment }}`.

### Step 4.4 — Execute the Namespace-Scoped Flow

```bash
curl -s -X POST \
  "${SERVICE_URL}/api/v1/executions/lab.experiments/namespace-test" \
  -H "Content-Type: application/json" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})"
```

**Expected result:** Execution succeeds and the task log shows `Environment: lab`.

### Step 4.5 — List Namespaces via REST API

**REST API:**
```bash
curl -s \
  "${SERVICE_URL}/api/v1/namespaces" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.[].id'
```

**Expected result:** Both `company.team` and `lab.experiments` are listed.

---

## Exercise 5 — Plugins and Integrations

### Objective

Explore the Kestra plugin ecosystem using GCS storage, HTTP tasks, and parameterised flows.

### Step 5.1 — Browse Available Plugins

In the Kestra UI, navigate to the flow editor and open the **Plugin** browser.

Plugin categories available in this deployment:
- **Core** — Log, HTTP Request, Script, If/EachSequential
- **GCP** — BigQuery, GCS, Pub/Sub, Dataflow
- **Database** — PostgreSQL, MySQL, JDBC

### Step 5.2 — Create a Flow with an HTTP Task

```yaml
id: http-integration
namespace: lab.experiments
tasks:
  - id: fetch_data
    type: io.kestra.plugin.core.http.Request
    uri: "https://httpbin.org/json"
    method: GET
  - id: log_response
    type: io.kestra.plugin.core.log.Log
    message: "Status: {{ outputs.fetch_data.code }}"
```

Save and execute this flow. 

**Expected result:** HTTP 200 response logged in the task output.

### Step 5.3 — Create a Flow with Input Parameters

```yaml
id: parameterised-flow
namespace: lab.experiments
inputs:
  - id: message
    type: STRING
    defaults: "Hello World"
tasks:
  - id: log
    type: io.kestra.plugin.core.log.Log
    message: "{{ inputs.message }}"
```

Execute with a custom input via REST API:

```bash
curl -s -X POST \
  "${SERVICE_URL}/api/v1/executions/lab.experiments/parameterised-flow" \
  -H "Content-Type: multipart/form-data" \
  -F "message=Hello from the API!" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '{id: .id, state: .state.current}'
```

**Expected result:** Execution with the custom message logged in task output.

### Step 5.4 — Explore GCS Plugin Configuration

In the Kestra UI, navigate to **Flows > Create** and inspect the GCS plugin:

```yaml
id: gcs-example
namespace: lab.experiments
tasks:
  - id: list_buckets
    type: io.kestra.plugin.gcp.gcs.List
    serviceAccount: "{{ secret('GCS_SERVICE_ACCOUNT') }}"
    projectId: "{{ envs.project_id }}"
    from: "gs://{{ namespace.gcs_bucket }}"
```

> Note: This flow requires GCS credentials configured as a Kestra secret. The structure
> shows how GCP-native plugins integrate with the namespace variable and secret system.

### Step 5.5 — Inspect Installed Plugins via REST API

**REST API:**
```bash
curl -s \
  "${SERVICE_URL}/api/v1/plugins" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.[].group' | sort | uniq
```

**Expected result:** List of plugin groups including `io.kestra.plugin.core`, `io.kestra.plugin.gcp`.

---

## Exercise 6 — Execution History and Monitoring

### Objective

Review execution history, inspect task-level logs, understand execution states, and replay
failed executions.

### Step 6.1 — View All Executions

**REST API:**
```bash
curl -s \
  "${SERVICE_URL}/api/v1/executions?size=10" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.results[] | {id: .id, flow: .flowId, state: .state.current, duration: .state.duration}'
```

**Expected result:** List of all recent executions with flow IDs, states, and durations.

### Step 6.2 — Get a Specific Execution

```bash
EXEC_ID=$(curl -s \
  "${SERVICE_URL}/api/v1/executions?namespace=company.team&flowId=hello-world&size=1" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq -r '.results[0].id')

curl -s \
  "${SERVICE_URL}/api/v1/executions/${EXEC_ID}" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '{id: .id, state: .state, taskRunList: [.taskRunList[].taskId]}'
```

**Expected result:** Full execution details including task run list and state transitions.

### Step 6.3 — View Task-Level Logs

```bash
curl -s \
  "${SERVICE_URL}/api/v1/logs/${EXEC_ID}" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.[] | {taskId: .taskId, level: .level, message: .message}'
```

**Expected result:** Per-task log entries with level (`INFO`, `WARN`, `ERROR`) and message text.

### Step 6.4 — Create and Replay a Failed Execution

Create a flow that deliberately fails:

```yaml
id: failing-flow
namespace: lab.experiments
tasks:
  - id: step1
    type: io.kestra.plugin.core.log.Log
    message: "Step 1 complete"
  - id: fail
    type: io.kestra.plugin.core.runner.Script
    script: "exit 1"
  - id: step3
    type: io.kestra.plugin.core.log.Log
    message: "This should not run"
```

Execute the flow. In the Kestra UI, navigate to the failed execution and use **Replay from
failed task** to restart execution from the `fail` task.

### Step 6.5 — Check Execution Statistics

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND jsonPayload.type="EXECUTION" AND severity="INFO"' \
  --project="${PROJECT}" \
  --limit=10 \
  --format=json \
  | jq '.[].jsonPayload | {flow: .flow, state: .state}'
```

**Expected result:** Structured log entries for each execution event.

---

## Exercise 7 — Database and Storage

### Objective

Inspect the Cloud SQL database backing Kestra and explore GCS artifact storage.

### Step 7.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~kestra" \
  --format="table(name, state, databaseVersion, settings.tier)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/sql/v1beta4/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | select(.name | test("kestra")) | {name: .name, state: .state, version: .databaseVersion}'
```

**Expected result:** Kestra Cloud SQL instance in `RUNNABLE` state, PostgreSQL 15.

### Step 7.2 — View Databases on the Instance

**gcloud:**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~kestra" \
  --format="value(name)" \
  --limit=1)

gcloud sql databases list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"
```

**Expected result:** `kestra` database listed on the instance.

### Step 7.3 — Inspect the GCS Storage Bucket

```bash
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~kestra-storage" \
  --format="value(name)" \
  | head -1)

gcloud storage ls "gs://${BUCKET}/"
```

**Expected result:** GCS bucket containing Kestra artifact directories (`executions/`, `flows/`).

### Step 7.4 — View Bucket Size

```bash
gcloud storage du "gs://${BUCKET}/" --summarize
```

**Expected result:** Total size of all Kestra artifacts and flow outputs stored in GCS.

### Step 7.5 — Check Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~kestra" \
  --format="table(name, createTime)"
```

**Expected result:** At least one secret for the Kestra admin password.

---

## Exercise 8 — Cloud Logging and Monitoring

### Objective

Find Kestra execution logs in Cloud Logging and review Cloud Run metrics in Cloud Monitoring.

### Step 8.1 — View Logs in Cloud Logging Console

Navigate to:
```
https://console.cloud.google.com/logs/query?project=${PROJECT}
```

Filter for Kestra Cloud Run logs:
```
resource.type="cloud_run_revision"
resource.labels.service_name=~"kestra"
```

**Expected result:** JVM startup, flow execution events, and scheduler tick logs.

### Step 8.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
  --project="${PROJECT}" \
  --limit=20 \
  --format=json \
  | jq '.[].jsonPayload // .[].textPayload'
```

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

### Step 8.3 — Filter for Execution-Related Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND jsonPayload.flow.id="hello-world"' \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** Structured JSON logs for the `hello-world` flow executions.

### Step 8.4 — Check the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**Expected result:** An uptime check configured against the Kestra `/health` endpoint.

### Step 8.5 — View Cloud Monitoring Metrics

Navigate to:
```
https://console.cloud.google.com/monitoring?project=${PROJECT}
```

In **Metrics Explorer**, query:
- `run.googleapis.com/request_count` — HTTP requests to Kestra UI and API
- `run.googleapis.com/container/memory/utilizations` — JVM heap usage (expect 60–80% of 4Gi)
- `run.googleapis.com/container/cpu/utilizations` — CPU (idle: 5–30%, executing flow: higher)

**gcloud:**
```bash
gcloud monitoring time-series list \
  --project="${PROJECT}" \
  --filter='metric.type="run.googleapis.com/container/memory/utilizations" AND resource.label.service_name="'"${SERVICE}"'"'
```

**Expected result:** Memory utilization chart showing JVM heap usage.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Kestra_CloudRun` deployment. This removes
the Cloud Run service, Cloud SQL instance, Secret Manager secrets, GCS bucket, Artifact
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
gcloud secrets list --project="${PROJECT}" --filter="name~kestra" \
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
| `application_name` | string | `kestra` | Base name for Cloud Run service |
| `application_version` | string | `latest` | Container image version tag |
| `cpu_limit` | string | `2000m` | CPU limit (JVM needs ≥ 2 vCPU) |
| `memory_limit` | string | `4Gi` | Memory limit (JVM needs ≥ 2Gi) |
| `min_instance_count` | number | `1` | Keep warm — JVM cold start is slow |
| `max_instance_count` | number | `1` | Standalone mode — single instance only |
| `execution_environment` | string | `gen2` | Required for GCS Fuse volumes |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar |
| `db_name` | string | `kestra` | PostgreSQL database name |
| `db_user` | string | `kestra` | PostgreSQL user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `enable_nfs` | bool | `false` | Mount Cloud Filestore NFS |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron schedule (UTC) |
| `backup_retention_days` | number | `7` | Backup retention period |

### Key Environment Variables (Auto-Injected)

| Variable | Value | Purpose |
|---|---|---|
| `KESTRA_QUEUE_TYPE` | `postgres` | PostgreSQL execution queue |
| `KESTRA_REPOSITORY_TYPE` | `postgres` | PostgreSQL flow repository |
| `KESTRA_STORAGE_TYPE` | `gcs` | GCS artifact storage |
| `KESTRA_BASICAUTH_ENABLED` | `true` | Enable basic auth |
| `KESTRA_BASICAUTH_USERNAME` | `admin` | Default admin username |
| `MICRONAUT_SERVER_PORT` | `8080` | Kestra server port |

### Useful Commands

```bash
# Get service URL
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --format="value(status.url)"

# Check service health
curl -s "${SERVICE_URL}/health"

# Retrieve admin password
gcloud secrets versions access latest --secret="${ADMIN_SECRET}" --project="${PROJECT}"

# List all executions
curl -s "${SERVICE_URL}/api/v1/executions?size=10" -u "admin:<password>"

# Trigger a webhook execution
curl -X POST "${SERVICE_URL}/api/v1/executions/webhook/<ns>/<flowId>/<key>"

# View Cloud Run logs
gcloud logging read 'resource.type="cloud_run_revision"' \
  --project="${PROJECT}" --limit=50

# Check uptime checks
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

### Further Reading

- [Kestra documentation](https://kestra.io/docs)
- [Kestra plugin index](https://kestra.io/plugins)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Cloud Logging query language](https://cloud.google.com/logging/docs/view/logging-query-language)
- [Cloud Monitoring metrics](https://cloud.google.com/monitoring/api/metrics_gcp)
