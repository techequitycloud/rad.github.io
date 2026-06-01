---
title: "LiteLLM on GKE Autopilot — Lab Guide"
sidebar_label: "LiteLLM GKE"
---

# LiteLLM on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LiteLLM_GKE)**

## Overview

**Estimated time:** 2–3 hours

This lab deploys LiteLLM on GKE Autopilot backed by Cloud SQL PostgreSQL 15, with Workload Identity for secure GCP API access, Cloud SQL Auth Proxy for database connectivity, and optional Redis response caching.

### What the Module Automates

- GKE Autopilot Deployment with LiteLLM pods
- Horizontal Pod Autoscaler (HPA)
- Cloud SQL PostgreSQL 15 instance, database, and user
- Database initialization Kubernetes Job
- Secret Manager secrets via Workload Identity
- GCS data bucket
- Kubernetes Service (LoadBalancer) for external access
- Cloud Monitoring uptime checks

### What You Do Manually

- Configure kubectl access to the GKE cluster
- Record the service LoadBalancer IP
- Retrieve the `LITELLM_MASTER_KEY` from Secret Manager
- Add LLM provider models via Admin UI or API
- Generate virtual API keys for team members
- Test OpenAI-compatible API calls
- Review usage dashboards and cost tracking

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed (provides GKE Autopilot cluster and VPC).
3. `gcloud`, `kubectl` installed and authenticated.
4. Optional: LLM provider API keys.
5. Optional: Cloud Memorystore Redis instance.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `cpu_limit` | No | `"2000m"` | CPU per pod |
| `memory_limit` | No | `"2Gi"` | Memory per pod |
| `db_name` | No | `"litellm_db"` | PostgreSQL database name |
| `db_user` | No | `"litellm_user"` | PostgreSQL user |
| `enable_redis` | No | `false` | Enable Redis caching |
| `redis_host` | No | `""` | Redis host |
| `secret_environment_variables` | No | `{}` | LLM provider API key secrets |

### Step 1.2 — Initiate Deployment

Deploy via the RAD UI. Click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Secret Manager provisioning | 1–2 min |
| Cloud Build image build | 5–10 min |
| GKE pod scheduling and startup | 3–5 min |
| Database initialization job | 1–2 min |
| **Total** | **18–31 min** |

### Step 1.3 — Configure kubectl Access

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Get GKE cluster name
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

# Get credentials
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Find LiteLLM namespace
export NAMESPACE=$(kubectl get namespaces \
  --selector="app.kubernetes.io/name=litellm" \
  --output="jsonpath={.items[0].metadata.name}" 2>/dev/null || echo "default")
```

### Step 1.4 — Record the Service IP

```bash
# Get service external IP (may take 1–3 min for LoadBalancer)
export SERVICE_IP=$(kubectl get service \
  --all-namespaces \
  --selector="app.kubernetes.io/name=litellm" \
  --output="jsonpath={.items[0].status.loadBalancer.ingress[0].ip}" 2>/dev/null)

echo "LiteLLM URL: http://${SERVICE_IP}:4000"
export SERVICE_URL="http://${SERVICE_IP}:4000"
```

---

## Phase 2 — Verify Deployment [MANUAL]

### Step 2.1 — Check Pod Status

```bash
kubectl get pods \
  --namespace=${NAMESPACE} \
  --selector="app.kubernetes.io/name=litellm"
```

**Expected result:** Pods show `Running` with `2/2` containers ready (LiteLLM + Cloud SQL Auth Proxy sidecar).

### Step 2.2 — Check Pod Logs

```bash
kubectl logs \
  --namespace=${NAMESPACE} \
  --selector="app.kubernetes.io/name=litellm" \
  --container=litellm \
  --tail=50
```

**Expected result:** LiteLLM startup logs showing Prisma DB connection and proxy server startup on port 4000.

### Step 2.3 — Check Readiness

```bash
curl -s ${SERVICE_URL}/health/readiness | jq .
```

**Expected result:** `{"status": "healthy"}` or similar confirmation of DB connectivity.

### Step 2.4 — Check HPA

```bash
kubectl get hpa --namespace=${NAMESPACE}
```

**Expected result:** HPA configured with min/max replicas and current resource utilization.

---

## Phase 3 — Retrieve Master Key [MANUAL]

### Step 3.1 — Get the LITELLM_MASTER_KEY

```bash
export MASTER_KEY_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~master-key" \
  --format="value(name)" \
  --limit=1)

export LITELLM_MASTER_KEY=$(gcloud secrets versions access latest \
  --secret="${MASTER_KEY_SECRET}" \
  --project=${PROJECT})

echo "Master Key: ${LITELLM_MASTER_KEY}"
```

**Expected result:** A key starting with `sk-`.

---

## Phase 4 — Configure Models and Test [MANUAL]

### Step 4.1 — Access the Admin UI

Open `http://${SERVICE_IP}:4000/ui` in a browser. Log in with `${LITELLM_MASTER_KEY}`.

### Step 4.2 — Add a Model via API

```bash
curl -X POST ${SERVICE_URL}/model/new \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name": "gpt-4o",
    "litellm_params": {
      "model": "openai/gpt-4o",
      "api_key": "os.environ/OPENAI_API_KEY"
    }
  }'
```

### Step 4.3 — Test a Chat Completion

```bash
curl -X POST ${SERVICE_URL}/v1/chat/completions \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello from GKE!"}]
  }' | jq '.choices[0].message.content'
```

**Expected result:** AI response from the configured provider.

### Step 4.4 — Generate a Virtual Key

```bash
curl -X POST ${SERVICE_URL}/key/generate \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "models": ["gpt-4o"],
    "max_budget": 5.0,
    "metadata": {"user": "developer@example.com"}
  }' | jq '.key'
```

**Expected result:** A new virtual API key is returned.

---

## Phase 5 — Kubernetes Features [MANUAL]

### Step 5.1 — Inspect Workload Identity

```bash
kubectl get serviceaccount \
  --namespace=${NAMESPACE} \
  --output="json" | jq '.items[] | select(.metadata.annotations."iam.gke.io/gcp-service-account" != null) | .metadata.name, .metadata.annotations'
```

**Expected result:** Kubernetes SA annotated with GCP SA email for Workload Identity.

### Step 5.2 — Inspect Cloud SQL Auth Proxy Sidecar

```bash
kubectl get pod \
  --namespace=${NAMESPACE} \
  --selector="app.kubernetes.io/name=litellm" \
  --output="jsonpath={.items[0].spec.containers[*].name}"
```

**Expected result:** Both the `litellm` container and `cloud-sql-proxy` sidecar are shown.

### Step 5.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** LiteLLM uptime check shows **Passing**.

---

## Phase 6 — Cloud Logging [MANUAL]

```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app_kubernetes_io/name"="litellm"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** LiteLLM request logs appear including model routing decisions and response times.

---

## Phase 7 — Delete [AUTOMATED]

Return to the RAD UI and click **Delete**.

**Approximate delete duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** All resources including PostgreSQL usage logs and virtual keys are permanently deleted. Export usage data from the Admin UI before deleting.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud SQL PostgreSQL instance | 1 | Yes |
| Secret Manager (master/salt keys) | 1 | Yes |
| Cloud Build image | 1 | Yes |
| GKE Deployment, Service, HPA | 1 | Yes |
| Database initialization Job | 1 | Yes |
| Configure kubectl access | 1 | No |
| Record service IP | 1 | No |
| Verify pod status | 2 | No |
| Retrieve master key | 3 | No |
| Add LLM models | 4 | No |
| Test chat completions | 4 | No |
| Generate virtual keys | 4 | No |
| Inspect Workload Identity | 5 | No |
| Review Cloud Logging | 6 | No |
| Delete | 7 | Yes |
