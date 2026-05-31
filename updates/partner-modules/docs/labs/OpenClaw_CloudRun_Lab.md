# OpenClaw on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

OpenClaw is an AI agent gateway platform for managing stateful multi-tenant AI agents. It provides agent orchestration, conversation management, tool integration, and per-tenant isolation. This lab deploys OpenClaw on Google Cloud Run with GCS Fuse for durable agent state persistence across restarts, Secret Manager for API key management, and optional Telegram or Slack channel integration. The Gen2 execution environment is required and always-allocated CPU is enabled to support WebSocket connections and async agent operations.

### What the Module Automates

- Cloud Run service with Gen2 execution environment and always-allocated CPU
- GCS workspace bucket mounted via GCS Fuse at `/data`
- Secret Manager secrets for Anthropic API key and integration tokens
- Artifact Registry repository and Cloud Build image pipeline
- Cloud Run Jobs for workspace initialization and scheduled backups
- Serverless VPC Access for internal-only ingress (behind a shared router)
- Cloud Logging and Cloud Monitoring uptime checks
- Skills repository sync configuration on container startup

### What You Do Manually

- Note the service URL from the RAD UI deployment panel and verify the service is healthy
- Log in to the OpenClaw interface and explore the dashboard
- Create and configure an AI agent with a system prompt
- Start test conversations with the agent
- Configure multi-tenant isolation and explore per-tenant API keys
- Verify GCS Fuse state persistence across container restarts
- Query Cloud Logging for agent and API request logs
- Review Cloud Monitoring service metrics

---

## CLI and REST API Overview

This lab uses the following CLIs:

| Tool | Purpose |
|---|---|
| `gcloud` | GCP resource management, log queries, secret access |
| `curl` | API calls to the OpenClaw gateway |

Configure gcloud:

```bash
# Authenticate gcloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

---

## Prerequisites

Before deploying this module:

1. **Services_GCP deployed** — this module depends on `Services_GCP` for the VPC and Serverless VPC Access connector.
2. **GCP project** with billing enabled.
3. **gcloud CLI** authenticated with Owner or Editor role on the project.
4. **Anthropic API key** — required for LLM-powered agent responses. Obtain from [console.anthropic.com](https://console.anthropic.com).
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `openclaw` | Internal identifier used for Cloud Run service and secrets |
| `application_version` | No | `latest` | Container image tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale-to-zero) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances (keep at 1 per tenant to avoid split state) |
| `cpu_limit` | No | `2000m` | CPU limit per container instance |
| `memory_limit` | No | `2Gi` | Memory limit per container instance |
| `ingress_settings` | No | `internal` | Traffic source: `internal` (behind router) or `all` (direct public) |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `timeout_seconds` | No | `3600` | Request timeout (1 hour recommended for agent sessions) |
| `cpu_always_allocated` | No | `true` | Keep CPU allocated at all times (required for WebSocket support) |
| `anthropic_api_key` | No | `""` | Anthropic API key (stored in Secret Manager) |
| `skills_repo_url` | No | `""` | GitHub URL of a shared skills repository |
| `skills_repo_ref` | No | `main` | Git ref (branch or tag) for the skills repository |
| `enable_telegram` | No | `false` | Enable Telegram bot integration |
| `enable_slack` | No | `false` | Enable Slack bot integration |
| `backup_schedule` | No | `0 2 * * *` | Cron expression for automated workspace backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Expected Deployment Duration

| Phase | Duration |
|---|---|
| Secret Manager secrets | ~1 min |
| GCS workspace bucket provisioning | ~1 min |
| Cloud Build image pipeline | ~5–10 min |
| Cloud Run service deployment | ~2–3 min |
| **Total** | **~10–16 min** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name |
| `service_url` | HTTPS URL for the OpenClaw gateway |
| `service_location` | Cloud Run region |
| `storage_buckets` | GCS bucket names |
| `container_image` | Container image URI deployed |
| `deployment_id` | Unique deployment suffix |
| `network_name` | VPC network name |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "openclaw")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")
```

---

## Phase 2 — Get the Service URL [MANUAL]

### Steps

1. Note the service URL from the RAD UI deployment panel, or retrieve it directly:

```bash
echo "OpenClaw URL: ${SERVICE_URL}"
```

2. Alternatively, query the Cloud Run service directly:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.url)"
```

**Expected result:** A URL in the format `https://openclaw-HASH-uc.a.run.app`.

**Note:** With the default `ingress_settings = "internal"`, this service is not publicly reachable. It is designed to operate behind a shared router or Serverless VPC Access. For direct access in this lab, either:
- Change `ingress_settings` to `"all"` and redeploy, or
- Use a gcloud proxy:

```bash
gcloud run services proxy ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --port=8080
# Access at: http://localhost:8080
```

3. Verify the health endpoint:

```bash
curl http://localhost:8080/health
```

**Expected result:** `{"status":"ok"}` or similar health response from the OpenClaw gateway.

4. View recent Cloud Run service logs to confirm startup completed:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Log lines indicating the Node.js server is listening on port 8080, the GCS Fuse workspace is mounted at `/data`, and the skills repository (if configured) was cloned.

### gcloud equivalent

```bash
# List all Cloud Run services
gcloud run services list \
  --region=${REGION} \
  --project=${PROJECT}
```

### REST API equivalent

```bash
curl -X GET \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Phase 3 — Explore the OpenClaw Interface [MANUAL]

### Steps

1. Open the OpenClaw UI at `http://localhost:8080` (using the gcloud proxy from Phase 2) or the service URL if publicly accessible.

2. Log in with admin credentials. Retrieve the admin token from Secret Manager:

```bash
gcloud secrets versions access latest \
  --secret="openclaw-admin-token" \
  --project=${PROJECT}
```

**Expected result:** The OpenClaw dashboard loads, showing the main navigation sections: **Agents**, **Conversations**, **Tenants**, **Tools**.

3. Explore each section briefly:
   - **Agents** — lists configured AI agents.
   - **Conversations** — lists active and historical conversations.
   - **Tenants** — tenant management for multi-tenant isolation.
   - **Tools** — available tools and capabilities the agents can use.

### gcloud equivalent

```bash
# Verify secrets are stored
gcloud secrets list \
  --filter="name:openclaw" \
  --project=${PROJECT}
```

---

## Phase 4 — Create an AI Agent [MANUAL]

### Steps

1. Navigate to **Agents** in the OpenClaw dashboard.

2. Click **New Agent** (or the **+** button).

3. Configure the agent:
   - **Name:** `gcp-assistant`
   - **Description:** `A helpful assistant for Google Cloud Platform questions`
   - **System prompt:**
     ```
     You are a helpful Google Cloud Platform expert. You help users understand GCP services,
     best practices, and how to architect cloud-native applications. Always provide concise,
     accurate, and practical answers.
     ```
   - **LLM backend:** Select `Claude` (or configure the Anthropic API key if prompted).
   - **Tools/capabilities:** Leave at defaults for this lab.

4. Click **Save** or **Create Agent**.

**Expected result:** The agent appears in the Agents list with a green status indicator.

5. Note the **Agent ID** shown in the agent details — you will use it in the next phase.

### REST API equivalent

```bash
# Create an agent via the OpenClaw REST API
curl -X POST http://localhost:8080/api/agents \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gcp-assistant",
    "description": "A helpful GCP assistant",
    "system_prompt": "You are a helpful GCP expert.",
    "llm_backend": "anthropic"
  }'
```

---

## Phase 5 — Test Agent Conversations [MANUAL]

### Steps

1. Navigate to **Conversations** in the OpenClaw dashboard.

2. Click **New Conversation** and select the `gcp-assistant` agent created in Phase 4.

3. Send a test message:

```
What is Google Cloud Run?
```

**Expected result:** The agent responds with a concise explanation of Cloud Run, its use cases, and key features.

4. Send a follow-up question:

```
How does GKE Autopilot differ from Standard?
```

**Expected result:** The agent explains the differences between GKE Autopilot (fully managed node pools, per-pod billing) and Standard (manual node management, per-node billing).

5. View the **conversation history** — scroll up to see the full exchange logged with timestamps.

6. Export the conversation transcript by clicking **Export** or **Download** in the conversation toolbar.

**Expected result:** A text or JSON file is downloaded containing the full conversation thread.

### REST API equivalent

```bash
# Send a message to the agent via API
curl -X POST http://localhost:8080/api/conversations \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "AGENT_ID",
    "message": "What is Google Cloud Run?"
  }'
```

---

## Phase 6 — Multi-Tenant Configuration [MANUAL]

### Steps

1. Navigate to **Tenants** in the OpenClaw dashboard.

2. Click **New Tenant** and create a tenant:
   - **Name:** `dev-team`
   - **Description:** `Development team tenant`
   - Click **Create**.

3. Create a second tenant:
   - **Name:** `production-team`
   - **Description:** `Production environment tenant`
   - Click **Create**.

4. Assign the `gcp-assistant` agent to the `dev-team` tenant:
   - Open the `dev-team` tenant.
   - Navigate to **Agents** within the tenant.
   - Click **Assign Agent** and select `gcp-assistant`.

**Expected result:** The `gcp-assistant` agent is now scoped to the `dev-team` tenant. Conversations and history within this tenant are isolated from other tenants.

5. Verify tenant isolation:
   - Switch to the `production-team` tenant context.
   - Navigate to **Agents** — the `gcp-assistant` agent should not appear here unless explicitly assigned.

**Expected result:** Tenant isolation is enforced — agents and conversations scoped to `dev-team` are not visible in `production-team`.

6. Explore **API keys** per tenant:
   - Open a tenant.
   - Navigate to **API Keys** or **Settings**.
   - Generate a tenant-scoped API key.

**Expected result:** A unique API key is generated for the tenant, which can be used to make tenant-scoped API calls.

### REST API equivalent

```bash
# List tenants
curl -X GET http://localhost:8080/api/tenants \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Create a tenant
curl -X POST http://localhost:8080/api/tenants \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "dev-team", "description": "Development team tenant"}'
```

---

## Phase 7 — Explore State Persistence [MANUAL]

### Steps

1. Verify the GCS workspace bucket contents from the GCS side:

```bash
gcloud storage ls --recursive gs://GCS_BUCKET_NAME/ \
  --project=${PROJECT}
```

**Expected result:** Workspace files including conversation history, agent configuration, and the skills library (if `skills_repo_url` was configured) are visible in GCS.

2. Trigger a new Cloud Run revision to simulate a container restart:

```bash
gcloud run services update ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --update-env-vars=RESTART_TRIGGER=$(date +%s)
```

3. Wait for the new revision to receive 100% traffic:

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

4. Reconnect to the service and verify conversation history is preserved:

```bash
curl http://localhost:8080/api/conversations \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Expected result:** All conversations created in Phase 5 are returned. The GCS Fuse mount restores state on container startup, preserving conversation history across restarts.

5. Verify the workspace contents are intact after restart:

```bash
gcloud storage ls --recursive gs://GCS_BUCKET_NAME/workspace/ \
  --project=${PROJECT}
```

**Expected result:** Workspace files from before the restart are still present in GCS, demonstrating durable state persistence.

### gcloud equivalent

```bash
# View Cloud Run revision history
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### Steps

1. Open the [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs).

2. Select your project.

3. Query OpenClaw Cloud Run logs:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

**Expected result:** Log entries include incoming API requests, agent invocations, LLM API calls to Anthropic, conversation events, and GCS Fuse mount activity.

4. Filter for API request logs:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload:"POST /api"
```

5. Use the gcloud CLI to query logs from the terminal:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, severity, textPayload)"
```

6. Filter for error-level logs:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=ERROR' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Any LLM API errors, authentication failures, or GCS Fuse mount issues appear here.

### REST API equivalent

```bash
curl -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

### Steps

1. Open [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Metrics Explorer**.

3. Query Cloud Run request metrics:
   - **Metric:** `run.googleapis.com/request_count`
   - **Filter:** `service_name = ${SERVICE}`

**Expected result:** A time-series graph showing incoming request counts to the OpenClaw service.

4. Query request latency:
   - **Metric:** `run.googleapis.com/request_latencies`
   - **Filter:** `service_name = ${SERVICE}`

**Expected result:** Latency percentiles (p50, p95, p99) for the OpenClaw service. Agent LLM calls may push p95 latency higher than typical web applications.

5. Query active instance count:
   - **Metric:** `run.googleapis.com/container/instance_count`
   - **Filter:** `service_name = ${SERVICE}`

**Expected result:** Instance count shows 1 active instance (since `max_instance_count = 1` by default for stateful per-tenant deployments).

6. Navigate to **Uptime Checks** to review the uptime check configured by the module (if `uptime_check_config.enabled = true`).

**Expected result:** The uptime check polls `/health` and shows a green (passing) status from multiple global probe locations.

7. Check the **Alerting** section to review any alert policies configured by the module.

### gcloud equivalent

```bash
# Describe the Cloud Run service traffic and health
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

---

## Phase 10 — Undeploy [AUTOMATED]

When the lab is complete, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** The Cloud Run service, GCS workspace bucket, Secret Manager secrets, and IAM bindings created by this module are deleted.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Description |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisions Cloud Run service, GCS workspace, secrets, Cloud Build |
| Phase 2 — Get Service URL | Manual | Retrieves and verifies the Cloud Run HTTPS endpoint |
| Phase 3 — Explore Interface | Manual | Admin login and dashboard orientation |
| Phase 4 — Create an AI Agent | Manual | Configure agent with system prompt and LLM backend |
| Phase 5 — Test Conversations | Manual | Agent conversation, history, and transcript export |
| Phase 6 — Multi-Tenant Config | Manual | Tenant creation, agent assignment, isolation verification |
| Phase 7 — State Persistence | Manual | GCS Fuse workspace durability across container restarts |
| Phase 8 — Cloud Logging | Manual | Agent and API request log exploration |
| Phase 9 — Cloud Monitoring | Manual | Cloud Run metrics and uptime checks |
| Phase 10 — Undeploy | Automated | Tears down all module-managed resources |
