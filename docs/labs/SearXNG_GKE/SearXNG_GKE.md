---
title: "SearXNG on GKE — Lab Guide"
sidebar_label: "SearXNG GKE"
---

# SearXNG on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_GKE)**

## Overview

**Estimated time:** 1–2 hours

SearXNG is a privacy-respecting, self-hosted metasearch engine that aggregates results from 70+ search services without tracking users or serving ads. This lab deploys SearXNG on GKE Autopilot — fully stateless with no database, a Kubernetes Deployment with HPA, and optional Redis for rate limiting and bot detection.

### What the Module Automates

- GKE Autopilot Kubernetes Deployment with Workload Identity
- Secret Manager secret for `SEARXNG_SECRET` (auto-generated session key, injected via CSI driver)
- Artifact Registry repository and image mirroring pipeline
- Kubernetes Service, HPA, and namespace
- Cloud Monitoring uptime checks targeting `/`

### What You Do Manually

- Note the Kubernetes Service URL from the RAD UI deployment panel
- Test the search engine across multiple result sources
- Explore the settings and engine configuration
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, view logs, describe GKE clusters |
| `kubectl` | Inspect pods, services, and deployments |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, GKE Autopilot cluster).
3. The following APIs enabled (Services GCP handles this):
   - `container.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
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
| `region` | No | `"us-central1"` | GCP region for GKE |
| `application_name` | No | `"searxng"` | Base name for Kubernetes resources and secrets |
| `application_version` | No | `"latest"` | SearXNG container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `max_instance_count` | No | `3` | Maximum pod replicas (minimum is always 1) |
| `enable_redis` | No | `false` | Enable Redis for rate limiting and bot detection |
| `service_type` | No | `"ClusterIP"` | Kubernetes Service type (`ClusterIP` or `LoadBalancer`) |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| GKE Autopilot node provisioning | 5–10 min |
| Artifact Registry image setup | 2–5 min |
| Kubernetes Deployment rollout | 2–3 min |
| **Total** | **9–18 min** |

> **Note:** SearXNG has no database, so deployment is significantly faster than database-backed modules.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | URL of the SearXNG Kubernetes Service |
| `service_name` | Kubernetes Service name |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export CLUSTER="your-gke-cluster-name"

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Find the SearXNG namespace
export NS=$(kubectl get namespaces \
  -o jsonpath='{.items[*].metadata.name}' \
  | tr ' ' '\n' | grep searxng)

echo "Namespace: ${NS}"

# Get the service URL (if using LoadBalancer)
export SERVICE_IP=$(kubectl get svc -n ${NS} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${SERVICE_IP}"
echo "SearXNG URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm SearXNG is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/healthz
```

**Expected result:** HTTP `200`. If you see a connection error, the GKE node may still be provisioning — wait 60 seconds and retry.

### Step 2.2 — Inspect the Kubernetes Deployment

```bash
kubectl get pods -n ${NS}
kubectl describe deployment -n ${NS}
```

**Expected result:** Pods show `Running` status. `min_instance_count = 1` is hardcoded — GKE does not support scale-to-zero.

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

The `SEARXNG_SECRET` is injected via the Kubernetes CSI Secret Manager driver — it is not stored as a plain environment variable.

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

**Expected result:** The session key is returned as a plain-text string. All running pods share this same value — it is generated once and stored in Secret Manager.

---

## Phase 5 — Explore Cloud Logging [MANUAL]

### Step 5.1 — View SearXNG Application Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app"=~"searxng"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** SearXNG request logs showing search activity (without query content).

### Step 5.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app"=~"searxng" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, no warnings appear.

---

## Phase 6 — GKE Features [MANUAL]

### Step 6.1 — Examine Horizontal Pod Autoscaler

```bash
kubectl get hpa -n ${NS}
kubectl describe hpa -n ${NS}
```

**Expected result:** The HPA shows current replicas (minimum 1), desired replicas, and CPU/memory utilization metrics.

### Step 6.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check shows **Passing** from multiple global locations.

---

## Phase 7 — Delete [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

**Approximate delete duration:** 5–10 minutes (no database to delete).

> **Note:** SearXNG is stateless — there is no user data to export before deleting.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Autopilot Deployment provisioning | 1 | Yes |
| SEARXNG_SECRET generation (CSI driver injection) | 1 | Yes |
| Artifact Registry image setup | 1 | Yes |
| Kubernetes Service and HPA | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Confirm SearXNG is reachable | 2 | No |
| Perform searches and explore engines | 3 | No |
| Review SEARXNG_SECRET in Secret Manager | 4 | No |
| Review Cloud Logging | 5 | No |
| Examine HPA and uptime checks | 6 | No |
| Delete infrastructure | 7 | Yes |
