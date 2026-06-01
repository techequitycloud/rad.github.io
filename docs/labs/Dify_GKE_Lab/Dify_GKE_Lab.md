---
title: "Dify on GKE — Lab Guide"
sidebar_label: "Dify GKE Lab"
---

# Dify on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_GKE)**

## Overview

**Estimated time:** 2–3 hours

Dify is an open-source LLM application development platform for building production-grade AI applications. This lab deploys Dify on GKE Autopilot backed by Cloud SQL PostgreSQL 15 with pgvector, Redis for Celery task queuing, and GCS object storage. GKE Autopilot provides managed Kubernetes with Horizontal Pod Autoscaling and full data sovereignty.

### What the Module Automates

- Dify API Kubernetes Deployment with Cloud SQL Auth Proxy sidecar
- Dify web frontend Kubernetes Deployment (Next.js)
- Cloud SQL PostgreSQL 15 instance with `pgvector` extension
- Dify application database and user creation (`db-init` job)
- GCS `dify-storage` bucket for file uploads and model assets
- Secret Manager `SECRET_KEY` secret (64-character random value)
- Artifact Registry repository and Cloud Build image pipeline
- Kubernetes namespace, service accounts, and RBAC
- Workload Identity binding for secure GCP API access
- Redis connectivity via NFS server IP (or external Memorystore)
- Cloud Monitoring uptime checks and alert policies

### What You Do Manually

- Note the GKE service external IP from the RAD UI deployment panel
- Complete the Dify admin setup wizard
- Configure LLM providers in the Dify console
- Create and test AI workflows, chatbots, and RAG applications
- Inspect Kubernetes resources and logs

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect GKE cluster, view logs |
| `kubectl` | Inspect Kubernetes resources |
| `curl` | Test the Dify API |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, GKE Autopilot cluster, Cloud SQL instance, and NFS server).
3. `gcloud` authenticated: `gcloud auth application-default login`
4. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region for GKE and Cloud SQL |
| `application_name` | No | `"dify"` | Base name for Kubernetes resources |
| `application_version` | No | `"0.15.0"` | Dify image version tag |
| `cpu_limit` | No | `"2000m"` | CPU limit per pod |
| `memory_limit` | No | `"4Gi"` | Memory limit per pod |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `db_name` | No | `"dify_db"` | PostgreSQL database name |
| `db_user` | No | `"dify_user"` | PostgreSQL database username |
| `enable_redis` | No | `true` | Enable Redis (required for Celery) |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP) |
| `enable_nfs` | No | `true` | Mount NFS (required for Redis) |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `backup_schedule` | No | `"0 2 * * *"` | Backup cron schedule |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| GKE namespace and workload provisioning | 5–8 min |
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Kubernetes pod rollout | 3–5 min |
| NFS provisioning and mount validation | 3–5 min |
| **Total** | **24–40 min** |

### Step 1.3 — Record Outputs and Configure kubectl

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

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

# Discover the Dify namespace
export NAMESPACE=$(kubectl get namespaces \
  -o jsonpath='{.items[*].metadata.name}' | tr ' ' '\n' | grep dify | head -1)
echo "Namespace: ${NAMESPACE}"

# Get the external IP
export SERVICE_IP=$(kubectl get service -n ${NAMESPACE} \
  -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${SERVICE_IP}"
echo "Dify URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Verify Pods are Running

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** All pods show `Running` status — at least one API pod and one web pod.

### Step 2.2 — Confirm Dify is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health
```

**Expected result:** HTTP `200`.

### Step 2.3 — Inspect Pod Details

```bash
kubectl describe pod -n ${NAMESPACE} -l app=dify | grep -A5 "Containers:"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/nodePools"
```

**Expected result:** Pod details show the Dify API container, Cloud SQL Auth Proxy sidecar, and NFS volume mount.

---

## Phase 3 — Set Up Dify Admin [MANUAL]

### Step 3.1 — Access the Setup Wizard

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The Dify setup page appears.

### Step 3.2 — Create Admin Account

1. Enter your **admin email address** and **password**.
2. Click **Setup**.
3. Log in with your credentials.

**Expected result:** You are logged into the Dify home page.

### Step 3.3 — Verify SECRET_KEY Secret

```bash
export SECRET_KEY_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~dify AND name~secret-key" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${SECRET_KEY_SECRET}" \
  --project=${PROJECT} | wc -c
```

**Expected result:** The secret has 64 characters.

---

## Phase 4 — Configure LLM Providers [MANUAL]

### Step 4.1 — Add an LLM Provider

1. Navigate to **Settings** > **Model Provider**.
2. Add a provider and enter your API key.

### Step 4.2 — Create a Knowledge Base (RAG)

1. Navigate to **Knowledge** > **Create Knowledge**.
2. Upload a document and process it.

**Expected result:** Documents are embedded and stored in pgvector (PostgreSQL `vector` extension).

### Step 4.3 — Build an AI Application

1. Create a **Chatbot** with the knowledge base as context.
2. Test it with questions from your uploaded document.

---

## Phase 5 — Explore Kubernetes Features [MANUAL]

### Step 5.1 — View HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current replica count and scaling thresholds.

### Step 5.2 — View All Deployments

```bash
kubectl get deployments -n ${NAMESPACE}
```

**Expected result:** At least two Deployments: the Dify API and the `dify-web` frontend.

### Step 5.3 — View Application Logs

```bash
kubectl logs -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o name | grep -v web | head -1) \
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
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Dify startup logs appear, including Flask-Migrate migration output and Celery worker confirmation.

### Step 5.4 — View Kubernetes Events

```bash
kubectl get events -n ${NAMESPACE} --sort-by='.lastTimestamp' | tail -20
```

**Expected result:** Events show successful pod scheduling. No `OOMKilled` or `CrashLoopBackOff` events.

### Step 5.5 — Scale the Deployment

```bash
kubectl scale deployment -n ${NAMESPACE} \
  $(kubectl get deployment -n ${NAMESPACE} -o name | grep -v web | head -1) \
  --replicas=2
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** A second API pod starts. Press `Ctrl+C` to stop watching. GKE Autopilot provisions additional node capacity automatically.

---

## Phase 6 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–25 minutes.

> **Warning:** This permanently deletes all Kubernetes resources, the database, vector store data, and GCS file storage.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and Kubernetes resources | 1 | Yes |
| Cloud SQL PostgreSQL 15 with pgvector | 1 | Yes |
| SECRET_KEY secret generation | 1 | Yes |
| GCS storage bucket | 1 | Yes |
| Workload Identity binding | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Configure kubectl and get service IP | 1 | No |
| Confirm Dify is reachable | 2 | No |
| Dify admin setup wizard | 3 | No |
| Configure LLM providers | 4 | No |
| Create knowledge base (RAG) | 4 | No |
| Build AI application | 4 | No |
| Inspect HPA and scaling | 5 | No |
| View deployments and pods | 5 | No |
| Review logs and events | 5 | No |
| Manual scaling test | 5 | No |
| Undeploy infrastructure | 6 | Yes |
