# OpenClaw on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun)**

OpenClaw is an open-source AI agent gateway that takes actions — not just generates responses.
It manages stateful, multi-tenant AI agents with conversation history, tool integration, and
per-tenant isolation. The `OpenClaw_CloudRun` module deploys OpenClaw on Cloud Run Gen2 with
GCS Fuse for durable agent workspace persistence across container restarts, Secret Manager for
API key management, and always-allocated CPU to support WebSocket connections and async
agent operations.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access the Application](#exercise-1--access-the-application)
6. [Exercise 2 — Core Application Features](#exercise-2--core-application-features)
7. [Exercise 3 — Data Management and State Persistence](#exercise-3--data-management-and-state-persistence)
8. [Exercise 4 — API Integration](#exercise-4--api-integration)
9. [Exercise 5 — Database and Storage](#exercise-5--database-and-storage)
10. [Exercise 6 — Security and Secrets](#exercise-6--security-and-secrets)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is OpenClaw?

OpenClaw is an **open-source local AI agent gateway** built for multi-tenant deployments. It
orchestrates AI agents powered by Anthropic's Claude, maintains per-session conversation history,
supports tool/skill integration, and provides per-tenant isolation for enterprise deployments.
The `OpenClaw_CloudRun` module deploys it on Cloud Run Gen2 with GCS Fuse — all agent state
persists in a GCS workspace bucket mounted at `/data`, making state durable across container
restarts and revision deployments.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **AI Agent Orchestration** | Stateful Claude-powered agents with tool use and conversation history |
| **Multi-Tenant Isolation** | Per-tenant agent scoping, API keys, and conversation isolation |
| **GCS Fuse Persistence** | Agent workspace durability across Cloud Run container restarts |
| **Cloud Run Gen2** | Always-allocated CPU for WebSocket and async agent operations |
| **Secret Manager** | Anthropic API key and optional messaging platform credentials |
| **Skills Repository** | Optional GitHub-hosted shared skills library synced at startup |
| **Cloud Logging** | Agent invocation, LLM API call, and workspace activity logs |
| **Cloud Monitoring** | Request metrics, instance count, and uptime check dashboards |

---

## 2. Architecture

```
Browser / API Client / Messaging Bot
        │
        ▼
Cloud Run Gen2 Service (cpu_always_allocated=true)
   ├── OpenClaw gateway container (port 8080, Node.js)
   │       ├── Agent orchestration (Claude API calls)
   │       ├── Conversation management (per-tenant, per-session)
   │       ├── Tool/skill execution (from /data/workspace/skill-library)
   │       └── REST API (/api/agents, /api/conversations, /api/tenants)
   └── GCS Fuse mount at /data
           ├── /data/workspace/       ← Agent workspace
           │   └── skill-library/    ← Cloned skills repo (if configured)
           └── /data/agents/main/agent/ ← Agent state directory
```

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                            │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Cloud Run Gen2 (OpenClaw)                                         │  │
│  │  ingress: internal (behind router)  ·  cpu_always_allocated: true  │  │
│  │  min_instance_count: 0  ·  max_instance_count: 1 (per tenant)      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│           │  GCS Fuse extension                                           │
│           │  VPC Connector (Serverless VPC Access)                        │
│  ┌────────┴──────────────────────────────────────────────────────────┐   │
│  │  GCS Bucket (<prefix>-storage)                                    │   │
│  │  mounted at /data with uid=1000,gid=1000                          │   │
│  │  ├── workspace/                                                   │   │
│  │  └── agents/main/agent/                                           │   │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────┐  ┌───────────────────────────────────────────┐ │
│  │  Secret Manager      │  │  Artifact Registry                        │ │
│  │  - anthropic-api-key │  │  Custom image from ghcr.io/openclaw/      │ │
│  │  - (telegram/slack   │  │  openclaw:<version>                       │ │
│  │    if enabled)       │  │                                           │ │
│  └──────────────────────┘  └───────────────────────────────────────────┘ │
│                                                                          │
│  Module variable wiring:                                                 │
│    OpenClaw_CloudRun                                                      │
│      cpu_always_allocated  = true  → required for WebSocket/async        │
│      execution_environment = gen2  → required for GCS Fuse               │
│      max_instance_count    = 1     → avoid split state per tenant        │
│      ingress_settings      = internal → designed behind router            │
└──────────────────────────────────────────────────────────────────────────┘
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
roles/secretmanager.admin
roles/storage.admin
roles/monitoring.viewer
roles/logging.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
gcloud auth application-default login
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `OpenClaw_CloudRun` module via the RAD UI. **Prerequisite:** `Services_GCP` must
be deployed first. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `anthropic_api_key` | `sk-ant-...` | Required for agent responses |
| `ingress_settings` | `all` | Set `all` for direct lab access (default is `internal`) |
| `min_instance_count` | `1` | Set to 1 to avoid cold starts in this lab |
| `max_instance_count` | `1` | Keep at 1 per tenant to avoid split state |
| `cpu_limit` | `2000m` | Default — sufficient for moderate agent workloads |
| `memory_limit` | `2Gi` | Default |

Click **Deploy** and wait for provisioning (approximately 10–16 minutes).

> **What this provisions:** Cloud Run Gen2 service with GCS Fuse extension, GCS workspace bucket
> mounted at `/data`, Secret Manager secret for the Anthropic API key, Artifact Registry
> repository and custom container image built via Cloud Build, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~openclaw" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "OpenClaw service: ${SERVICE}"
echo "OpenClaw URL: ${SERVICE_URL}"
```

> **Note:** If `ingress_settings = "internal"`, use the gcloud proxy for direct access:
> ```bash
> gcloud run services proxy "${SERVICE}" \
>   --region="${REGION}" --project="${PROJECT}" --port=8080
> # Then use http://localhost:8080 as the service URL
> ```

---

## Exercise 1 — Access the Application

### Objective

Verify the OpenClaw service is running, retrieve admin credentials, and explore the main
dashboard sections.

### Step 1.1 — Verify the Service Health

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name: .name, url: .uri, state: .terminalCondition.state}'
```

**Health check:**
```bash
curl -s "${SERVICE_URL}/health"
# Expected: {"status": "ok"} or similar
```

**Expected result:** The service health endpoint returns a 200 OK response confirming the
OpenClaw Node.js gateway is running.

### Step 1.2 — Retrieve Admin Credentials

The admin token is stored in Secret Manager. Retrieve it:

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="table(name, createTime)"

# Access the admin token (check secret name from the list above)
ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${ADMIN_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 -d
```

### Step 1.3 — Explore the Dashboard

Navigate to `${SERVICE_URL}` in your browser. Log in with the admin credentials retrieved above.

Explore each main section:
- **Agents** — lists configured AI agents and their status
- **Conversations** — active and historical conversation threads
- **Tenants** — multi-tenant isolation management
- **Tools** — available capabilities agents can invoke

**Expected result:** The OpenClaw dashboard loads showing the main navigation. All sections
are empty on a fresh deployment.

### Step 1.4 — Verify Startup Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log lines showing: Node.js server listening on port 8080, GCS Fuse
workspace mounted at `/data`, and skills repository cloned (if configured).

---

## Exercise 2 — Core Application Features

### Objective

Create and configure an AI agent, start conversations, test multi-tenant isolation, and export
conversation transcripts.

### Step 2.1 — Create an AI Agent

1. Navigate to **Agents** and click **New Agent** (or the **+** button).
2. Configure the agent:
   - **Name:** `gcp-assistant`
   - **System prompt:** `You are a helpful Google Cloud Platform expert. You help users understand GCP services, best practices, and how to architect cloud-native applications.`
   - **LLM backend:** select `Claude` (uses the stored Anthropic API key)
3. Click **Save** or **Create Agent**.

**REST API:**
```bash
export ADMIN_TOKEN="<your-admin-token>"

curl -s -X POST "${SERVICE_URL}/api/agents" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gcp-assistant",
    "description": "A helpful GCP assistant",
    "system_prompt": "You are a helpful GCP expert.",
    "llm_backend": "anthropic"
  }' | jq '.id'
```

**Expected result:** The agent appears in the Agents list with a green status indicator.
Note the **Agent ID** for use in later steps.

### Step 2.2 — Start a Conversation

1. Navigate to **Conversations** and click **New Conversation**.
2. Select the `gcp-assistant` agent.
3. Send a test message: `What is Google Cloud Run?`
4. Review the response.

**Expected result:** The agent invokes the Anthropic Claude API and returns a contextual
explanation of Cloud Run, demonstrating live LLM invocation.

### Step 2.3 — Test Multi-Turn Conversation

Send a follow-up question: `How does it compare to GKE Autopilot?`

**Expected result:** The agent correctly references the previous Cloud Run context and compares
it with GKE Autopilot, demonstrating stateful multi-turn conversation history.

### Step 2.4 — Configure Multi-Tenant Isolation

1. Navigate to **Tenants** and click **New Tenant**.
2. Create tenant `dev-team` and tenant `production-team`.
3. Assign the `gcp-assistant` agent to `dev-team` only.
4. Switch to the `production-team` tenant context.

**REST API:**
```bash
# Create a tenant
curl -s -X POST "${SERVICE_URL}/api/tenants" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "dev-team", "description": "Development team tenant"}' \
  | jq '{id, name}'

# List tenants
curl -s "${SERVICE_URL}/api/tenants" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.[] | {id, name}'
```

**Expected result:** The `gcp-assistant` agent is not visible in the `production-team` tenant
context, confirming per-tenant isolation.

### Step 2.5 — Export a Conversation Transcript

From the conversation view, click **Export** or **Download** to save the full conversation log.

**Expected result:** A text or JSON file is downloaded containing the complete conversation
thread with timestamps.

---

## Exercise 3 — Data Management and State Persistence

### Objective

Verify that agent workspace state persists in GCS across container restarts, inspect the
workspace directory structure, and observe state recovery after a revision deployment.

### Step 3.1 — Inspect the GCS Workspace Bucket

**gcloud:**
```bash
# Find the workspace bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" \
  --limit=1)

echo "OpenClaw workspace bucket: ${BUCKET}"

# List workspace contents
gcloud storage ls --recursive "gs://${BUCKET}/" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, size, updated}'
```

**Expected result:** The bucket contains `/workspace/` directory with conversation state and
optionally a `skill-library/` directory if `skills_repo_url` was configured.

### Step 3.2 — Verify State Persistence Across Restarts

Trigger a container restart by updating an environment variable:

**gcloud:**
```bash
gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --update-env-vars=RESTART_TRIGGER=$(date +%s)

# Wait for the new revision to become active
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].status, spec.serviceAccountName)"
```

After the restart, verify conversations created in Exercise 2 are still present in the UI.

**Expected result:** All conversations and agent configurations are preserved after the restart,
because state is stored in GCS (not in the container's ephemeral filesystem).

### Step 3.3 — Verify the GCS Fuse Mount Configuration

**REST API (inspect service environment):**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.template.volumes[] | select(.name | test("openclaw")) | {name, gcs}'
```

**Expected result:** The volume spec shows the GCS bucket mounted at `/data` with `uid=1000,
gid=1000` mount options matching the container user.

### Step 3.4 — Inspect Workspace After Restart

After the revision restarts, the entrypoint.sh regenerates `openclaw.json` from environment
variables and re-clones the skills repository if configured.

**gcloud (view post-restart logs):**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"workspace|mount|data|skill\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries show GCS Fuse mount success and skills repository sync (if
configured) during the new revision startup.

---

## Exercise 4 — API Integration

### Objective

Use the OpenClaw REST API to create agents, start conversations, and integrate with external
applications programmatically.

### Step 4.1 — List Agents and Tenants

```bash
export ADMIN_TOKEN="<your-admin-token>"

# List all agents
curl -s "${SERVICE_URL}/api/agents" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.[] | {id, name}'

# List all tenants
curl -s "${SERVICE_URL}/api/tenants" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.[] | {id, name}'

# List all conversations
curl -s "${SERVICE_URL}/api/conversations" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.[] | {id, agentId}'
```

### Step 4.2 — Create an Agent via API

```bash
AGENT_RESP=$(curl -s -X POST "${SERVICE_URL}/api/agents" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "api-created-agent",
    "description": "Agent created via API",
    "system_prompt": "You are a concise assistant. Answer in 2 sentences or fewer.",
    "llm_backend": "anthropic"
  }')

export AGENT_ID=$(echo "${AGENT_RESP}" | jq -r '.id')
echo "Created agent: ${AGENT_ID}"
```

### Step 4.3 — Send Messages via API

```bash
# Start a conversation
CONV_RESP=$(curl -s -X POST "${SERVICE_URL}/api/conversations" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"${AGENT_ID}\", \"message\": \"What is Vertex AI?\"}")

echo "${CONV_RESP}" | jq '{id: .id, response: .response}'
```

**gcloud (verify the API call triggered a Cloud Run request):**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.observedGeneration, status.latestCreatedRevisionName)"
```

**Expected result:** The API returns a JSON response with the agent's answer generated by
the Anthropic Claude API.

### Step 4.4 — Generate a Tenant-Scoped API Key

1. Navigate to **Tenants** > select `dev-team` > **API Keys**.
2. Generate a new API key.
3. Use this key for tenant-scoped API calls:

```bash
export TENANT_API_KEY="<tenant-api-key>"

# This key can only access dev-team tenant resources
curl -s "${SERVICE_URL}/api/conversations" \
  -H "Authorization: Bearer ${TENANT_API_KEY}" | jq 'length'
```

**Expected result:** The tenant-scoped API key returns only conversations belonging to the
`dev-team` tenant.

---

## Exercise 5 — Database and Storage

### Objective

Inspect the GCS workspace structure, verify that the module uses no Cloud SQL (OpenClaw is
stateless at the DB layer), and examine how GCS Fuse provides durable storage.

### Step 5.1 — Confirm No Database Dependency

OpenClaw has no Cloud SQL dependency. Verify:

**gcloud:**
```bash
# No Cloud SQL instances should exist for OpenClaw
gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~openclaw"

# No Redis is used either
gcloud redis instances list \
  --project="${PROJECT}" \
  --filter="name~openclaw"
```

**Expected result:** No Cloud SQL or Redis instances — OpenClaw is entirely GCS-backed.

### Step 5.2 — Inspect the Full Workspace Structure

**gcloud:**
```bash
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" --limit=1)

# List all objects recursively
gcloud storage ls --recursive "gs://${BUCKET}/" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=workspace/" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, size}'
```

**Expected result:** The workspace directory contains conversation logs, agent configurations,
and optionally a cloned skills library.

### Step 5.3 — Review Bucket Configuration

**gcloud:**
```bash
gcloud storage buckets describe "gs://${BUCKET}" \
  --project="${PROJECT}" \
  --format="table(name, location, storageClass, iamConfiguration.uniformBucketLevelAccess)"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b/${BUCKET}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, location, storageClass, iamConfiguration}'
```

**Expected result:** STANDARD storage class, uniform bucket-level access enabled, and the
bucket is in the deployment region.

---

## Exercise 6 — Security and Secrets

### Objective

Inspect Secret Manager secrets, verify the Cloud Run service account permissions, and review
VPC egress configuration.

### Step 6.1 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="table(name, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aopenclaw" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | {name, createTime}'
```

**Expected result:** At minimum, the `anthropic-api-key` secret. If Telegram or Slack
integration was enabled, additional secrets for bot tokens and webhook/signing secrets.

### Step 6.2 — Review Cloud Run Service Account

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{
    serviceAccount: .template.serviceAccount,
    ingress: .ingress,
    vpcAccess: .template.vpcAccess
  }'
```

**Expected result:** The service runs under a dedicated service account with
`roles/secretmanager.secretAccessor` and `roles/storage.objectAdmin` for the workspace bucket.

### Step 6.3 — Verify VPC Egress Configuration

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(template.vpcAccess)"
```

**Expected result:** `PRIVATE_RANGES_ONLY` egress — OpenClaw routes only RFC 1918 traffic
through the VPC connector, while direct API calls (Anthropic, GitHub) use the default internet
path.

### Step 6.4 — Review Audit Logs

**gcloud:**
```bash
gcloud logging read \
  "protoPayload.serviceName=secretmanager.googleapis.com \
   AND protoPayload.methodName=~\"AccessSecretVersion\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {
    timestamp,
    caller: .protoPayload.authenticationInfo.principalEmail,
    resource: .protoPayload.resourceName
  }'
```

**Expected result:** The OpenClaw Cloud Run service account accessing the Anthropic API key
secret during container startup.

---

## Exercise 7 — Cloud Logging

### Objective

Query Cloud Run structured logs for agent invocations, LLM API calls, and workspace activity.

### Step 7.1 — View Application Logs in the Console

```bash
echo "https://console.cloud.google.com/logs?project=${PROJECT}"
```

Use the following filter:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

### Step 7.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=100 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"cloud_run_revision\\\" resource.labels.service_name=\\\"${SERVICE}\\\"\",
    \"pageSize\": 50
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 7.3 — Filter for Agent API Requests

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"POST /api|agent|conversation|anthropic\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries showing incoming API requests, agent invocations, and outbound
Anthropic Claude API calls for each conversation message.

### Step 7.4 — Filter for Error Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=20 \
  --freshness=6h
```

**Expected result:** For a healthy deployment, no error entries. Any Anthropic API errors,
Secret Manager access failures, or GCS Fuse mount issues appear here.

### Step 7.5 — Tail Live Logs

```bash
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

While tailing, send a conversation message in the UI and observe the real-time agent
invocation and Claude API call logs.

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Run service metrics including request count, latency, instance count, and the
uptime check status.

### Step 8.1 — View Cloud Run Metrics in the Console

```bash
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/metrics?project=${PROJECT}"
```

Review:
- **Requests** — request count and latency percentiles
- **Container** — CPU and memory utilization (note: CPU is always allocated)
- **Instances** — active instance count (1 for stateful single-tenant deployments)

### Step 8.2 — Query Request Count

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type=starts_with(\"run.googleapis.com\")" \
  --project="${PROJECT}" \
  --format="table(metric.type)" | grep -E "request|instance|cpu|memory"
```

### Step 8.3 — Query Request Latency

Agent LLM calls can push P95+ latency higher than typical web services.

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_latencies | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], percentile(val(), 95)\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].distributionValue'
```

**Expected result:** P95 latency reflects Anthropic API call duration (typically 2–10 seconds
per agent response depending on model and prompt length).

### Step 8.4 — Review the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {name, displayName, httpCheck}'
```

**Expected result:** An uptime check polling `/health` at 60-second intervals, showing green
(passing) status from multiple global probe locations.

### Step 8.5 — Review Instance Count

Since `max_instance_count = 1`, the instance count should remain at 1 for stateful per-tenant
deployments:

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/container/instance_count | filter resource.service_name = '${SERVICE}' | within 30m | group_by [], mean(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].doubleValue'
```

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `OpenClaw_CloudRun` deployment. This removes
the Cloud Run service, GCS workspace bucket, Secret Manager secrets, and IAM bindings.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --quiet

# Delete Secret Manager secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet

# Delete GCS workspace bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" --limit=1)
gcloud storage rm --recursive "gs://${BUCKET}/"
gcloud storage buckets delete "gs://${BUCKET}"
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

> **Note:** GCP holds serverless IPv4 addresses asynchronously after service deletion.
> If VPC subnet deletion fails, wait 20–30 minutes and retry.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_version` | string | `latest` | OpenClaw image tag (pin for reproducibility) |
| `anthropic_api_key` | string | `""` | Anthropic API key (stored in Secret Manager) |
| `cpu_limit` | string | `2000m` | CPU per container instance |
| `memory_limit` | string | `2Gi` | Memory per container instance |
| `min_instance_count` | number | `0` | `0` = scale-to-zero; set `1` to eliminate cold starts |
| `max_instance_count` | number | `1` | Keep at 1 per tenant to avoid split state |
| `ingress_settings` | string | `internal` | `internal` behind router, `all` for direct access |
| `timeout_seconds` | number | `3600` | Max request duration (1 hour for long agent sessions) |
| `cpu_always_allocated` | bool | `true` | Required for WebSocket and async operations |
| `execution_environment` | string | `gen2` | Required for GCS Fuse volume mounts |
| `skills_repo_url` | string | `""` | GitHub URL of shared skills repository |
| `skills_repo_ref` | string | `main` | Git ref for skills repository |
| `enable_telegram` | bool | `false` | Enable Telegram bot integration |
| `enable_slack` | bool | `false` | Enable Slack bot integration |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for workspace backups |
| `backup_retention_days` | number | `7` | Days to retain backup files |

### Fixed Environment Variables (set by module)

| Variable | Value | Purpose |
|---|---|---|
| `OPENCLAW_STATE_DIR` | `/tmp/openclaw` | Local state dir (avoids GCS Fuse hard-link limits) |
| `XDG_CONFIG_HOME` | `/tmp/openclaw` | Config dir on local disk |
| `NODE_ENV` | `production` | Node.js production mode |
| `NODE_OPTIONS` | `--max-old-space-size=1536` | Prevents OOM on 2Gi containers |
| `SKILLS_REPO_URL` | from `var.skills_repo_url` | Skills library GitHub URL |
| `SKILLS_REPO_REF` | from `var.skills_repo_ref` | Git ref to check out |
| `NPM_CONFIG_CACHE` | `/tmp/.npm` | npm cache on local disk |

### Useful Commands

```bash
# Get service URL
gcloud run services describe ${SERVICE} \
  --region="${REGION}" --project="${PROJECT}" \
  --format="value(status.url)"

# Proxy for internal ingress access
gcloud run services proxy "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --port=8080

# Check health
curl -s "${SERVICE_URL}/health"

# View live logs
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}"

# List GCS workspace contents
gcloud storage ls --recursive "gs://${BUCKET}/" --project="${PROJECT}"

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~openclaw"

# Force new revision (trigger restart)
gcloud run services update "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --update-env-vars=RESTART_TRIGGER=$(date +%s)

# List Cloud Run revisions
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}"
```

### Further Reading

- [OpenClaw GitHub repository](https://github.com/openclaw/openclaw)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [GCS Fuse on Cloud Run](https://cloud.google.com/run/docs/tutorials/network-filesystems-fuse)
- [Secret Manager documentation](https://cloud.google.com/secret-manager/docs)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Anthropic Claude API](https://docs.anthropic.com/en/api/getting-started)
