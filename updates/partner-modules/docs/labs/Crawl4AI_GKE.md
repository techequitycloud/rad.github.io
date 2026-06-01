# Crawl4AI on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_GKE)**

## Overview

**Estimated time:** 1–2 hours

Crawl4AI is an open-source LLM-friendly web crawler and scraper. This lab deploys Crawl4AI on GKE Autopilot with supervisord managing embedded Redis (task queue) and Gunicorn (ASGI server) inside the container. Playwright/Chromium handles browser-based crawling with proper `/dev/shm` shared-memory support via emptyDir volume. No external database is required — Crawl4AI is fully stateless.

### What the Module Automates

- Kubernetes Deployment with Crawl4AI container and emptyDir for `/dev/shm`
- Artifact Registry repository and image mirror from Docker Hub
- Kubernetes namespace, service accounts, and RBAC
- Workload Identity binding for secure GCP API access
- Horizontal Pod Autoscaler (HPA) for replica scaling
- Kubernetes Service (LoadBalancer) for external access
- Cloud Monitoring uptime checks and alert policies
- Optional: Secret Manager secrets for LLM API keys

### What You Do Manually

- Configure `kubectl` to connect to the GKE cluster
- Confirm the `/health` endpoint responds
- Submit crawl jobs via the REST API or the interactive playground
- Explore extraction strategies (CSS, XPath, LLM-based)
- Review Kubernetes events and logs

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access GKE cluster credentials, view logs |
| `kubectl` | Inspect Kubernetes resources |
| `curl` | Submit crawl jobs to the Crawl4AI API |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC and GKE Autopilot cluster).
3. The following APIs enabled (Services GCP handles this):
   - `container.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `secretmanager.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region for GKE |
| `application_name` | No | `"crawl4ai"` | Base name for Kubernetes resources |
| `application_version` | No | `"latest"` | Docker image tag |
| `container_resources` | No | `{ cpu_limit = "4", memory_limit = "8Gi", cpu_request = "2", mem_request = "4Gi" }` | CPU and memory limits per pod |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `redis_task_ttl_seconds` | No | `3600` | TTL for task results in embedded Redis |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `secret_environment_variables` | No | `{}` | Inject LLM API keys (e.g., `{ OPENAI_API_KEY = "my-key" }`) |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| GKE namespace and workload provisioning | 5–8 min |
| Artifact Registry image mirror | 3–5 min |
| Kubernetes pod rollout | 3–5 min |
| **Total** | **11–18 min** |

### Step 1.3 — Record Outputs and Configure kubectl

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the Crawl4AI namespace
export NAMESPACE=$(kubectl get namespaces \
  -o jsonpath='{.items[*].metadata.name}' | tr ' ' '\n' | grep crawl4ai | head -1)
echo "Namespace: ${NAMESPACE}"

# Get the external IP of the Crawl4AI service
export SERVICE_IP=$(kubectl get service -n ${NAMESPACE} \
  -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${SERVICE_IP}"
echo "Crawl4AI URL: ${SERVICE_URL}"
```

**REST API equivalent (list GKE clusters):**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters" \
  | jq '.clusters[] | {name: .name, status: .status}'
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Verify Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** At least one pod shows `Running` status with all containers ready (`1/1` or `2/2`).

### Step 2.2 — Confirm Crawl4AI is Reachable

```bash
curl -s "${SERVICE_URL}/health" | jq .
```

**Expected result:**
```json
{"status": "healthy"}
```

If you see a connection refused error, supervisord may still be starting embedded Redis and Gunicorn (allow 40–60 seconds).

### Step 2.3 — Inspect Pod Details

```bash
kubectl describe pod -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o name | head -1) | grep -A10 "Containers:"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/nodePools" \
  | jq '.nodePools[] | {name: .name, status: .status}'
```

**Expected result:** Pod details show the Crawl4AI container with emptyDir volume for `/dev/shm`, resource limits (`cpu: "4"`, `memory: "8Gi"`), and Workload Identity service account annotation.

### Step 2.4 — Open the Interactive Playground

Navigate to `${SERVICE_URL}/playground` in a browser.

**Expected result:** The Crawl4AI playground UI loads with fields for URL input, crawl options, and a result viewer.

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

**Expected result:** A positive integer (number of Markdown characters extracted). Typically 2000–5000 characters for a simple HTML page.

### Step 3.2 — Asynchronous Crawl (Batch)

For longer crawls, submit asynchronously and poll for completion.

```bash
# Submit async crawl job
TASK_ID=$(curl -s -X POST "${SERVICE_URL}/crawl" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://en.wikipedia.org/wiki/Machine_learning"],
    "crawler_params": {
      "headless": true
    }
  }' | jq -r '.task_id')
echo "Task ID: ${TASK_ID}"

# Poll for completion
sleep 10
curl -s "${SERVICE_URL}/task/${TASK_ID}" \
  | jq '{status: .status, markdown_length: (.result.markdown | length)}'
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

**Expected result:** A list of Hacker News post titles extracted via CSS selector.

### Step 3.4 — Multi-URL Batch Crawl

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

## Phase 4 — Explore Kubernetes Features [MANUAL]

### Step 4.1 — View HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current replica count and scaling thresholds based on CPU utilisation.

### Step 4.2 — View All Deployments

```bash
kubectl get deployments -n ${NAMESPACE}
```

**Expected result:** One Deployment listed — the Crawl4AI application.

### Step 4.3 — View Application Logs

```bash
kubectl logs -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o name | head -1) \
  --tail=50
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --limit=30 \
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
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Supervisord startup logs appear (Redis start, Gunicorn start), followed by Crawl4AI request logs showing crawled URLs, browser session durations, and extraction results.

### Step 4.4 — View Kubernetes Events

```bash
kubectl get events -n ${NAMESPACE} --sort-by='.lastTimestamp' | tail -20
```

**Expected result:** Events show successful pod scheduling and container starts. No `OOMKilled` or `CrashLoopBackOff` events under normal operation.

### Step 4.5 — Check /dev/shm Mount

```bash
kubectl exec -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o name | head -1) \
  -- df -h /dev/shm
```

**Expected result:** `/dev/shm` is mounted as a `tmpfs` volume (the emptyDir providing shared memory for Chromium).

### Step 4.6 — Scale the Deployment

```bash
kubectl scale deployment -n ${NAMESPACE} \
  $(kubectl get deployment -n ${NAMESPACE} -o name | head -1) \
  --replicas=2
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** A second pod starts. Press `Ctrl+C` to stop watching. GKE Autopilot provisions additional node capacity automatically. Each additional pod runs its own embedded Redis and Gunicorn stack independently.

---

## Phase 5 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 5–10 minutes.

> **Note:** Crawl4AI is stateless — no database or persistent storage is provisioned by default. Task results in the embedded Redis instance are lost on pod restart. This is expected behaviour.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and Kubernetes resources | 1 | Yes |
| Artifact Registry image mirror | 1 | Yes |
| Workload Identity binding | 1 | Yes |
| HPA provisioning | 1 | Yes |
| Configure kubectl and get service IP | 1 | No |
| Confirm Crawl4AI is reachable | 2 | No |
| Inspect pod details | 2 | No |
| Open playground UI | 2 | No |
| Submit synchronous crawl jobs | 3 | No |
| Submit asynchronous crawl jobs | 3 | No |
| CSS selector extraction | 3 | No |
| Multi-URL batch crawl | 3 | No |
| Inspect HPA and scaling | 4 | No |
| View deployments | 4 | No |
| Review logs and events | 4 | No |
| Verify /dev/shm mount | 4 | No |
| Manual scaling test | 4 | No |
| Undeploy infrastructure | 5 | Yes |
