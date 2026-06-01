---
title: "LiteLLM on Cloud Run — Lab Guide"
sidebar_label: "LiteLLM CloudRun Lab"
---

# LiteLLM on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LiteLLM_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

LiteLLM is an open-source LLM proxy and AI gateway that provides a unified OpenAI-compatible API across 100+ LLM providers. This lab deploys LiteLLM on Google Cloud Run backed by Cloud SQL PostgreSQL 15 for usage tracking and virtual key management, with optional Redis response caching.

### What the Module Automates

- Cloud Run service with LiteLLM container (custom Cloud Build image)
- Cloud SQL PostgreSQL 15 instance, database, and user
- Database initialization Cloud Run Job
- Secret Manager secrets: `LITELLM_MASTER_KEY` and `LITELLM_SALT_KEY`
- GCS data bucket
- Serverless VPC Access for Cloud SQL connectivity
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks

### What You Do Manually

- Note the Cloud Run service URL from deployment outputs
- Retrieve the `LITELLM_MASTER_KEY` from Secret Manager
- Configure LLM provider models via the LiteLLM Admin UI or API
- Generate virtual API keys for team members
- Make test API calls using the OpenAI-compatible API
- Review usage and cost dashboards
- Explore Cloud Logging for request traces

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project.
3. The following APIs enabled:
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Optional: LLM provider API keys (OpenAI, Anthropic, etc.)

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"litellm"` | Base name for resources |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances |
| `cpu_limit` | No | `"2000m"` | CPU per instance |
| `memory_limit` | No | `"2Gi"` | Memory per instance |
| `db_name` | No | `"litellm_db"` | PostgreSQL database name |
| `db_user` | No | `"litellm_user"` | PostgreSQL user |
| `enable_redis` | No | `false` | Enable Redis response caching |
| `redis_host` | No | `""` | Redis host (Cloud Memorystore IP) |
| `redis_port` | No | `"6379"` | Redis port |
| `secret_environment_variables` | No | `{}` | LLM provider API key secrets |
| `environment_variables` | No | `{ LITELLM_LOG = "INFO" }` | Plain-text env vars |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for DB backups |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Pre-create LLM Provider Secrets (Optional)

```bash
export PROJECT="your-gcp-project-id"

# OpenAI API key
echo -n "sk-your-openai-key" | gcloud secrets create openai-api-key \
  --data-file=- --project=${PROJECT}

# Anthropic API key
echo -n "sk-ant-your-key" | gcloud secrets create anthropic-api-key \
  --data-file=- --project=${PROJECT}

# Google Gemini API key
echo -n "AIzaSy-your-key" | gcloud secrets create gemini-api-key \
  --data-file=- --project=${PROJECT}
```

Then reference in the deployment:
```hcl
secret_environment_variables = {
  OPENAI_API_KEY    = "openai-api-key"
  ANTHROPIC_API_KEY = "anthropic-api-key"
  GEMINI_API_KEY    = "gemini-api-key"
}
```

### Step 1.3 — Initiate Deployment

Deploy via the RAD UI. Click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Secret Manager provisioning | 1–2 min |
| Cloud Build image build | 5–10 min |
| Database initialization job | 1–2 min |
| Cloud Run service deployment | 2–3 min |
| **Total** | **17–29 min** |

### Step 1.4 — Record Outputs

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Discover the LiteLLM Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~litellm" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "LiteLLM URL: ${SERVICE_URL}"
```

---

## Phase 2 — Retrieve the Master Key [MANUAL]

### Step 2.1 — Get the LITELLM_MASTER_KEY

```bash
# Find the master key secret
export MASTER_KEY_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~master-key" \
  --format="value(name)" \
  --limit=1)

# Access the key value
export LITELLM_MASTER_KEY=$(gcloud secrets versions access latest \
  --secret="${MASTER_KEY_SECRET}" \
  --project=${PROJECT})

echo "Master Key: ${LITELLM_MASTER_KEY}"
```

**Expected result:** A key starting with `sk-` is returned. This is your admin key for LiteLLM.

### Step 2.2 — Confirm LiteLLM is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health/liveliness
```

**Expected result:** HTTP `200`.

### Step 2.3 — Check Readiness (Database Connection)

```bash
curl -s ${SERVICE_URL}/health/readiness | jq .
```

**Expected result:** JSON response showing `status: "healthy"` or `status: "connected"` confirming PostgreSQL connectivity and Prisma migration completion.

---

## Phase 3 — Configure LLM Models [MANUAL]

### Step 3.1 — Access the LiteLLM Admin UI

Open a browser and navigate to:
```
${SERVICE_URL}/ui
```

Log in with your `LITELLM_MASTER_KEY` (the `sk-...` value retrieved in Step 2.1).

**Expected result:** The LiteLLM Admin dashboard appears, showing usage graphs, model list, and virtual key management.

### Step 3.2 — Add a Model via the Admin UI

1. Navigate to **Models** in the left sidebar.
2. Click **+ Add Model**.
3. Configure:
   - **Model Name**: `gpt-4o` (the name clients will use)
   - **LiteLLM Model**: `openai/gpt-4o`
   - **API Base**: `https://api.openai.com/v1` (or leave default)
   - **API Key**: Your OpenAI API key (or reference the secret)
4. Click **Save**.

**Expected result:** The model appears in the Models list and is available for API calls.

### Step 3.3 — Add Models via API

```bash
# Add a model via the REST API
curl -X POST ${SERVICE_URL}/model/new \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name": "claude-3-5-sonnet",
    "litellm_params": {
      "model": "anthropic/claude-3-5-sonnet-20241022",
      "api_key": "os.environ/ANTHROPIC_API_KEY"
    }
  }'
```

**Expected result:** `{"message": "Model added successfully"}`.

### Step 3.4 — List Configured Models

```bash
curl -s -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  ${SERVICE_URL}/model/info | jq '.data[].model_name'
```

**Expected result:** A list of configured model names.

---

## Phase 4 — Make API Calls [MANUAL]

### Step 4.1 — Test a Chat Completion

```bash
# Direct call using your LiteLLM master key
curl -X POST ${SERVICE_URL}/v1/chat/completions \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }' | jq '.choices[0].message.content'
```

**Expected result:** A response from the OpenAI GPT-4o model via LiteLLM.

### Step 4.2 — Test with Different Providers

```bash
# Use Anthropic Claude via the same OpenAI-compatible API
curl -X POST ${SERVICE_URL}/v1/chat/completions \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "What is the capital of France?"}]
  }' | jq '.choices[0].message.content'
```

**Expected result:** A response from Claude via LiteLLM — same API shape regardless of provider.

### Step 4.3 — List Available Models (OpenAI-compatible endpoint)

```bash
curl -s -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  ${SERVICE_URL}/v1/models | jq '.data[].id'
```

**Expected result:** All configured models are listed in OpenAI-compatible format.

---

## Phase 5 — Virtual Key Management [MANUAL]

### Step 5.1 — Generate a Virtual Key for a Team Member

```bash
# Generate a virtual key with rate limits
curl -X POST ${SERVICE_URL}/key/generate \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "models": ["gpt-4o", "claude-3-5-sonnet"],
    "max_budget": 10.0,
    "budget_duration": "1mo",
    "metadata": {"team": "engineering", "user": "alice@example.com"},
    "key_alias": "alice-dev-key"
  }' | jq '.key'
```

**Expected result:** A new virtual key starting with `sk-` is returned. This key can be distributed to team members.

### Step 5.2 — Test the Virtual Key

```bash
export VIRTUAL_KEY="sk-..." # paste the generated key

curl -X POST ${SERVICE_URL}/v1/chat/completions \
  -H "Authorization: Bearer ${VIRTUAL_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Test"}]}' \
  | jq '.choices[0].message.content'
```

**Expected result:** The AI responds. LiteLLM tracks usage against Alice's budget.

### Step 5.3 — Check Key Usage

```bash
curl -s -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  ${SERVICE_URL}/key/info \
  -H "Content-Type: application/json" \
  -d '{"key": "'"${VIRTUAL_KEY}"'"}' | jq '.info.spend'
```

**Expected result:** Current spend for the virtual key is returned.

---

## Phase 6 — Usage and Cost Tracking [MANUAL]

### Step 6.1 — View Spend Summary

```bash
curl -s -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  "${SERVICE_URL}/spend/logs?limit=10" | jq '.[]'
```

**Expected result:** Per-request spend logs showing model, tokens, cost, and timestamp.

### Step 6.2 — View Total Spend by Model

```bash
curl -s -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  "${SERVICE_URL}/spend/models" | jq '.[]'
```

**Expected result:** Spend breakdown by model name.

### Step 6.3 — View Admin Dashboard

Navigate to `${SERVICE_URL}/ui` in the browser.

1. Go to **Usage** in the left sidebar.
2. Review **Total Requests**, **Successful Requests**, and **Cost** graphs.
3. Navigate to **Teams/Keys** to see per-key spend.

**Expected result:** Usage graphs and cost breakdowns are visible for all API calls made.

---

## Phase 7 — Database Inspection [MANUAL]

### Step 7.1 — Verify PostgreSQL Connection

```bash
# Check the Cloud SQL instance
gcloud sql instances list \
  --project=${PROJECT} \
  --filter="name~litellm"

# Connect via Cloud SQL Auth Proxy (requires the proxy installed locally)
# Or use Cloud Shell with:
gcloud sql connect $(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="name~litellm" \
  --format="value(name)" --limit=1) \
  --user=litellm_user \
  --project=${PROJECT}
```

**Expected result:** Cloud SQL instance details are shown. You can connect and query the `litellm_db` database.

### Step 7.2 — Inspect Database Tables

Once connected to the PostgreSQL instance:

```sql
\dt
```

**Expected result:** Prisma-managed tables appear: `LiteLLM_SpendLogs`, `LiteLLM_VerificationToken`, `LiteLLM_UserTable`, `LiteLLM_TeamTable`, etc.

---

## Phase 8 — Cloud Logging [MANUAL]

### Step 8.1 — View LiteLLM Application Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** LiteLLM request logs appear showing model routing, provider selection, and latency.

### Step 8.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Under normal operation, few or no warnings appear.

### Step 8.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The LiteLLM uptime check shows **Passing**.

---

## Phase 9 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the PostgreSQL database with all usage logs and virtual keys. Export usage data from the LiteLLM Admin UI before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud SQL PostgreSQL instance creation | 1 | Yes |
| Secret Manager (master key, salt key) | 1 | Yes |
| Cloud Build image build | 1 | Yes |
| Database initialization job | 1 | Yes |
| Cloud Run service deployment | 1 | Yes |
| Retrieve master key from Secret Manager | 2 | No |
| Confirm LiteLLM is reachable | 2 | No |
| Access Admin UI | 3 | No |
| Add LLM provider models | 3 | No |
| Test chat completions | 4 | No |
| Test multi-provider routing | 4 | No |
| Generate virtual keys | 5 | No |
| Test virtual key rate limits | 5 | No |
| Review cost and usage dashboards | 6 | No |
| Inspect PostgreSQL tables | 7 | No |
| Review Cloud Logging | 8 | No |
| Undeploy | 9 | Yes |
