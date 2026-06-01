---
title: "SearXNG on Cloud Run — Lab Guide"
sidebar_label: "SearXNG CloudRun Lab"
---

# SearXNG on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

SearXNG is a privacy-respecting, self-hosted metasearch engine that aggregates results from 70+ search services without tracking users or serving ads. This lab deploys SearXNG on Google Cloud Run — fully stateless with no database, serverless auto-scaling to zero, and optional Redis for rate limiting and bot detection.

### What the Module Automates

- Cloud Run service with serverless auto-scaling to zero
- Secret Manager secret for `SEARXNG_SECRET` (auto-generated session key)
- Artifact Registry repository and image mirroring pipeline
- Serverless VPC Access connector for private networking (when Redis is enabled)
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks targeting `/`

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Test the search engine across multiple result sources
- Explore the settings and engine configuration
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
2. The `Services_GCP` module deployed in the same project (provides VPC).
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `vpcaccess.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region for Cloud Run |
| `application_name` | No | `"searxng"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"latest"` | SearXNG container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances (minimum is always 0) |
| `cpu_limit` | No | `"500m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"512Mi"` | Memory per Cloud Run instance |
| `enable_redis` | No | `false` | Enable Redis for rate limiting and bot detection |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Artifact Registry image setup | 2–5 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **4–9 min** |

> **Note:** SearXNG has no database, so deployment is significantly faster than database-backed modules.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the SearXNG Cloud Run service |
| `service_name` | Cloud Run service name |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~searxng" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "SearXNG URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm SearXNG is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/healthz
```

**Expected result:** HTTP `200`. If you see `503`, Cloud Run is starting a new instance (cold start) — wait 10 seconds and retry.

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image, resource limits, and min-instances set to 0 (scale to zero).

---

## Phase 3 — Use SearXNG [MANUAL]

### Step 3.1 — Open SearXNG in a Browser

Navigate to `${SERVICE_URL}` in your browser.

**Expected result:** The SearXNG search interface appears with a search box.

### Step 3.2 — Perform a Search

1. Enter a search query (e.g., "open source search engine").
2. Press **Enter** or click the search button.
3. Review aggregated results from multiple search engines.

**Expected result:** Search results are displayed without any tracking or personalization.

### Step 3.3 — Explore Engine Categories

1. Click the **!** bang shortcut or navigate to the **Preferences** page.
2. Under **Search Engines**, review the list of enabled sources.
3. Enable or disable specific engines by category (Web, Images, News, Maps, etc.).

**Expected result:** Your engine preferences are saved and applied to subsequent searches.

### Step 3.4 — Use Bang Shortcuts

SearXNG supports bang shortcuts to target specific engines:

```
!g open source terraform modules    # Google
!ddg privacy search engine          # DuckDuckGo
!gh terraform modules               # GitHub
!w kubernetes                       # Wikipedia
```

**Expected result:** Each search is routed to the specified engine.

---

## Phase 4 — Review the SEARXNG_SECRET [MANUAL]

### Step 4.1 — Retrieve the Session Secret

```bash
# List SearXNG-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~searxng"

# Retrieve the SEARXNG_SECRET
export SECRET_NAME=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~searxng" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${SECRET_NAME}" \
  --project=${PROJECT}
```

**Expected result:** The session key is returned as a plain-text string. This key is used to sign user preferences cookies and must remain consistent across all instances.

---

## Phase 5 — Explore Cloud Logging [MANUAL]

### Step 5.1 — View SearXNG Application Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** SearXNG request logs showing search queries processed (without query content — SearXNG does not log queries).

### Step 5.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, no warnings appear.

---

## Phase 6 — Cloud Run Features [MANUAL]

### Step 6.1 — Examine Scale-to-Zero Behaviour

SearXNG is configured with `min_instance_count = 0` — it scales to zero when idle.

```bash
# Check current instance count
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.observedGeneration)"
```

Wait 5 minutes without sending any requests, then send a request and observe the cold start latency.

**Expected result:** The first request after an idle period takes 1–3 seconds longer due to instance startup.

### Step 6.2 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions. The most recent revision serves 100% of traffic.

---

## Phase 7 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 5–10 minutes (no database to delete).

> **Note:** SearXNG is stateless — there is no user data to export before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| SEARXNG_SECRET generation | 1 | Yes |
| Artifact Registry image setup | 1 | Yes |
| VPC connector and IAM | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Confirm SearXNG is reachable | 2 | No |
| Perform searches and explore engines | 3 | No |
| Review SEARXNG_SECRET in Secret Manager | 4 | No |
| Review Cloud Logging | 5 | No |
| Examine scale-to-zero and revisions | 6 | No |
| Undeploy infrastructure | 7 | Yes |
