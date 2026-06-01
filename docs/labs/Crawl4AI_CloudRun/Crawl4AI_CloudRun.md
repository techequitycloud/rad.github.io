---
title: "Crawl4AI on Cloud Run — Lab Guide"
sidebar_label: "Crawl4AI CloudRun"
---

# Crawl4AI on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Crawl4AI is an open-source LLM-friendly web crawler and scraper. It enables AI teams to rapidly ingest web content for RAG pipelines, knowledge bases, and monitoring. This lab deploys Crawl4AI on Google Cloud Run Gen2 with supervisord managing embedded Redis (task queue) and Gunicorn (ASGI server) inside the container. Playwright/Chromium handles browser-based crawling. No external database is required — Crawl4AI is fully stateless.

### What the Module Automates

- Cloud Run Gen2 service with supervisord + embedded Redis + Gunicorn
- Artifact Registry repository and image mirror from Docker Hub
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Optional: Secret Manager secrets for LLM API keys

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Confirm the `/health` endpoint responds
- Submit crawl jobs via the REST API or the interactive playground
- Explore extraction strategies (CSS, XPath, LLM-based)
- Review logs in Cloud Logging
- Monitor instance scaling behaviour

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Inspect Cloud Run services, view logs |
| `curl` | Submit crawl jobs to the Crawl4AI API |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC).
3. The following APIs enabled (Services GCP handles this):
   - `run.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region for Cloud Run |
| `application_name` | No | `"crawl4ai"` | Base name for Cloud Run service |
| `application_version` | No | `"latest"` | Docker image tag (e.g., `"0.6.0"` for pinned) |
| `cpu_limit` | No | `"4000m"` | CPU per instance (size to browser concurrency) |
| `memory_limit` | No | `"8Gi"` | Memory per instance (minimum 4 Gi) |
| `min_instance_count` | No | `1` | Minimum instances (1 for warm Chromium pool) |
| `max_instance_count` | No | `3` | Maximum instances |
| `redis_task_ttl_seconds` | No | `3600` | TTL for task results in embedded Redis (seconds) |
| `timeout_seconds` | No | `3600` | Max request duration (set high for long crawls) |
| `ingress_settings` | No | `"all"` | `"all"` for public API access |
| `vpc_egress_setting` | No | `"ALL_TRAFFIC"` | Must be `"ALL_TRAFFIC"` for internet crawling |
| `secret_environment_variables` | No | `{}` | Inject LLM API keys (e.g., `{ OPENAI_API_KEY = "my-key" }`) |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Artifact Registry image mirror | 3–5 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **5–9 min** |

### Step 1.3 — Record Outputs

After deployment completes, set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~crawl4ai" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Crawl4AI URL: ${SERVICE_URL}"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  | jq '.services[] | select(.name | contains("crawl4ai")) | {name: .name, url: .uri}'
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm Crawl4AI is Reachable

```bash
curl -s "${SERVICE_URL}/health" | jq .
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
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

**Expected result:**
```json
{"status": "healthy"}
```

If you see a timeout on the first request, supervisord is still booting Redis and Gunicorn (allow 40–60 seconds).

### Step 2.2 — Open the Interactive Playground

Navigate to `${SERVICE_URL}/playground` in a browser.

**Expected result:** The Crawl4AI playground UI loads with fields for URL input, crawl options, and a result viewer. No login is required by default.

### Step 2.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '{name: .name, uri: .uri, generation: .generation, executionEnvironment: .template.executionEnvironment}'
```

**Expected result:** Service status shows `Ready` with Gen2 execution environment, resource limits (`cpu: "4000m"`, `memory: "8Gi"`), and VPC egress setting `ALL_TRAFFIC`.

---

## Phase 3 — Submit Crawl Jobs [MANUAL]

### Step 3.1 — Synchronous Crawl (Simple)

The `/crawl/sync` endpoint blocks until the crawl completes and returns the result directly.

```bash
curl -X POST "${SERVICE_URL}/crawl/sync" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "crawler_params": {
      "headless": true
    }
  }' | jq '.result.markdown | length'
```

**REST API equivalent (using Cloud Run URL):**
```bash
curl -s -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/crawl/sync" \
  -d '{"urls":["https://example.com"],"crawler_params":{"headless":true}}' \
  | jq '.result.markdown | length'
```

**Expected result:** A positive integer (number of characters in the extracted Markdown). Typically 2000–5000 characters for a simple HTML page.

### Step 3.2 — Asynchronous Crawl (Batch)

For longer crawls, submit asynchronously and poll for completion.

```bash
# Submit async crawl job
TASK_ID=$(curl -s -X POST "${SERVICE_URL}/crawl" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://en.wikipedia.org/wiki/Artificial_intelligence"],
    "crawler_params": {
      "headless": true
    }
  }' | jq -r '.task_id')
echo "Task ID: ${TASK_ID}"

# Poll for completion
sleep 10
curl -s "${SERVICE_URL}/task/${TASK_ID}" | jq '{status: .status, markdown_length: (.result.markdown | length)}'
```

**Expected result:** Task status transitions from `processing` to `completed` with Markdown content extracted from the Wikipedia article. The task ID is stored in the embedded Redis instance for up to `redis_task_ttl_seconds` seconds.

### Step 3.3 — CSS Selector Extraction

Extract structured content using CSS selectors.

```bash
curl -X POST "${SERVICE_URL}/crawl/sync" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://news.ycombinator.com"],
    "extraction_strategy": {
      "type": "css",
      "instruction": ".titleline > a"
    }
  }' | jq '.result.extracted_content[:500]'
```

**Expected result:** A list of Hacker News post titles extracted via CSS selector, returned as a JSON string.

### Step 3.4 — Multi-URL Batch Crawl

Submit multiple URLs in a single asynchronous job.

```bash
TASK_ID=$(curl -s -X POST "${SERVICE_URL}/crawl" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com",
      "https://example.org"
    ],
    "crawler_params": {
      "headless": true,
      "wait_for": "load"
    }
  }' | jq -r '.task_id')

echo "Batch Task ID: ${TASK_ID}"

sleep 15
curl -s "${SERVICE_URL}/task/${TASK_ID}" \
  | jq '{status: .status, results_count: (.results | length)}'
```

**Expected result:** Status transitions to `completed` with a `results` array containing one entry per URL.

---

## Phase 4 — Explore Cloud Logging [MANUAL]

### Step 4.1 — View Crawl4AI Application Logs

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
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 30
  }'
```

**Expected result:** Supervisord startup logs appear (Redis start, Gunicorn start), followed by Crawl4AI request logs showing crawled URLs, browser session durations, and extraction results.

### Step 4.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Under normal operation, no errors appear. Memory warnings may appear during high-concurrency Chromium sessions — increase `memory_limit` if these are frequent. Browser launch failures indicate insufficient CPU or memory.

---

## Phase 5 — Cloud Run Features [MANUAL]

### Step 5.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}/revisions" \
  | jq '.revisions[] | {name: .name, createTime: .createTime, conditions: .conditions[0].state}'
```

**Expected result:** A list of revisions. The most recent revision serves 100% of traffic. Each revision shows the image digest, resource limits, and service account.

### Step 5.2 — Check Scaling Behaviour

```bash
# Submit 3 concurrent crawl jobs
for i in 1 2 3; do
  curl -s -X POST "${SERVICE_URL}/crawl" \
    -H "Content-Type: application/json" \
    -d '{"urls":["https://example.com"],"crawler_params":{"headless":true}}' \
    | jq -r '.task_id' &
done
wait

# Check instance count via Cloud Monitoring
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Cloud Run maintains at least 1 instance (`min_instance_count = 1`) and may scale up for concurrent crawl requests. Each Chromium browser session consumes approximately 500 MB RAM — with 8 Gi per instance, approximately 10–12 concurrent sessions are possible before scale-out.

### Step 5.3 — Verify Gen2 Execution Environment

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.metadata.annotations["run.googleapis.com/execution-environment"]'
```

**Expected result:** `"gen2"`. Gen2 is required for supervisord's process management model. Gen1 does not support running multiple processes inside the container.

### Step 5.4 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check polls `/health` and shows **Passing** from multiple global locations.

---

## Phase 6 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 5–10 minutes.

> **Note:** Crawl4AI is stateless — no database or persistent storage is provisioned by default. Task results in the embedded Redis instance are lost on container restart. This is expected behaviour.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run Gen2 service provisioning | 1 | Yes |
| Artifact Registry image mirror | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Cloud Monitoring uptime checks | 1 | Yes |
| Note service URL from RAD UI | 1 | No |
| Confirm Crawl4AI is reachable | 2 | No |
| Open playground UI | 2 | No |
| Inspect Cloud Run service | 2 | No |
| Submit synchronous crawl jobs | 3 | No |
| Submit asynchronous crawl jobs | 3 | No |
| CSS selector extraction | 3 | No |
| Multi-URL batch crawl | 3 | No |
| Review Cloud Logging | 4 | No |
| Examine revisions | 5 | No |
| Check scaling behaviour | 5 | No |
| Verify Gen2 environment | 5 | No |
| Review uptime checks | 5 | No |
| Undeploy infrastructure | 6 | Yes |
