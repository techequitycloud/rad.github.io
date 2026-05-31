# LibreChat on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_GKE)**

## Overview

**Estimated time:** 1.5–2.5 hours

This lab deploys LibreChat on GKE Autopilot backed by a MongoDB-compatible Firestore database (or MongoDB Atlas), GCS file storage via the GCS Fuse CSI driver, Workload Identity for secure GCP API access, and optional Redis session management.

### What the Module Automates

- GKE Autopilot Deployment with LibreChat pods
- Horizontal Pod Autoscaler (HPA) for automatic scaling
- Firestore ENTERPRISE database with MongoDB compatibility (when no `mongodb_uri` is supplied)
- Firestore SCRAM user initialization Kubernetes Job
- Secret Manager secrets via Workload Identity
- GCS bucket (`librechat-uploads`) mounted via GCS Fuse CSI driver
- Kubernetes Service (LoadBalancer) for external access
- Cloud Monitoring uptime checks

### What You Do Manually

- Note the external service IP or URL from deployment outputs
- Register the initial admin account
- Configure AI provider API keys
- Explore conversations, file uploads, and multi-model switching
- Review Kubernetes pod logs and Cloud Monitoring metrics

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed (provides GKE Autopilot cluster and VPC).
3. `gcloud` and `kubectl` installed and authenticated.
4. Optional: MongoDB Atlas connection string.
5. Optional: Cloud Memorystore Redis instance.
6. Optional: Secret Manager secrets for AI provider API keys.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region |
| `mongodb_uri` | No | `""` | MongoDB URI. Leave empty for Firestore auto-provisioning. |
| `app_title` | No | `"LibreChat"` | UI title |
| `allow_registration` | No | `true` | Allow new user self-registration |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `container_resources` | No | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | Pod resources |
| `enable_redis` | No | `false` | Enable Redis for session management (strongly recommended) |
| `redis_host` | No | `""` | Redis host IP |
| `secret_environment_variables` | No | `{}` | AI provider API key secrets |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Pre-create AI Provider Secrets (Optional)

```bash
export PROJECT="your-gcp-project-id"

echo -n "sk-your-openai-key" | gcloud secrets create openai-api-key \
  --data-file=- --project=${PROJECT}

echo -n "sk-ant-your-key" | gcloud secrets create anthropic-api-key \
  --data-file=- --project=${PROJECT}
```

### Step 1.3 — Initiate Deployment

Deploy via the RAD UI. Click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Firestore database provisioning (if auto) | 2–5 min |
| SCRAM user initialization job | 1–2 min |
| Artifact Registry image mirror | 3–5 min |
| GKE pod scheduling and startup | 3–5 min |
| **Total** | **9–17 min** |

### Step 1.4 — Configure kubectl Access

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

# Find LibreChat namespace
export NAMESPACE=$(kubectl get namespaces \
  --selector="app.kubernetes.io/name=librechat" \
  --output="jsonpath={.items[0].metadata.name}" 2>/dev/null || echo "default")
```

### Step 1.5 — Record the Service URL

```bash
# Find the LibreChat service
export SERVICE_NAME=$(kubectl get service \
  --all-namespaces \
  --selector="app.kubernetes.io/name=librechat" \
  --output="jsonpath={.items[0].metadata.name}" 2>/dev/null)

# Get the external IP (may take 1–3 minutes for LoadBalancer provisioning)
export SERVICE_IP=$(kubectl get service ${SERVICE_NAME} \
  --namespace=${NAMESPACE} \
  --output="jsonpath={.status.loadBalancer.ingress[0].ip}")

echo "LibreChat URL: http://${SERVICE_IP}"
```

---

## Phase 2 — Verify Deployment [MANUAL]

### Step 2.1 — Check Pod Status

```bash
kubectl get pods \
  --namespace=${NAMESPACE} \
  --selector="app.kubernetes.io/name=librechat"
```

**Expected result:** Pods show `Running` status with `1/1` or `2/2` containers ready.

### Step 2.2 — Check Pod Logs

```bash
kubectl logs \
  --namespace=${NAMESPACE} \
  --selector="app.kubernetes.io/name=librechat" \
  --tail=50
```

**Expected result:** LibreChat startup logs appear, including MongoDB connection establishment and Express server startup on port 3080.

### Step 2.3 — Confirm LibreChat is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${SERVICE_IP}
```

**Expected result:** HTTP `200`.

### Step 2.4 — Check HPA Status

```bash
kubectl get hpa \
  --namespace=${NAMESPACE}
```

**Expected result:** HPA shows `MINPODS`, `MAXPODS`, `REPLICAS`, and current CPU utilization.

---

## Phase 3 — Register Admin Account [MANUAL]

### Step 3.1 — Access LibreChat

Open a browser and navigate to `http://${SERVICE_IP}`.

### Step 3.2 — Register the First Admin User

1. Click **Register** (or **Create an account**).
2. Enter your **name**, **email**, and a **password**.
3. Click **Submit**.

**Expected result:** You are logged into the LibreChat interface.

### Step 3.3 — Disable Self-Registration

After creating the admin account, set `allow_registration = false` and re-deploy.

---

## Phase 4 — Configure AI Providers [MANUAL]

### Step 4.1 — Add Keys via LibreChat UI

1. Navigate to **Settings** (gear icon, bottom-left).
2. Go to the **API Keys** section.
3. Add your API keys for enabled providers.

### Step 4.2 — Verify Secrets via kubectl

```bash
# List Secret Manager secrets used by the deployment
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~librechat"
```

**Expected result:** Secrets for `creds-key`, `creds-iv`, `jwt-secret`, `jwt-refresh-secret`, and `mongo-uri` are listed.

### Step 4.3 — Test a Conversation

1. Click **New Conversation**.
2. Select a model (e.g., `gpt-4o`).
3. Send a test message.

**Expected result:** AI responds within a few seconds. Conversation saved to MongoDB.

---

## Phase 5 — File Uploads [MANUAL]

### Step 5.1 — Upload a File

In a conversation, click the paperclip icon and upload a PDF or image.

**Expected result:** File is uploaded to GCS, and you can ask questions about its content.

### Step 5.2 — Verify GCS Storage

```bash
export UPLOADS_BUCKET=$(gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~librechat-uploads" \
  --format="value(name)" \
  --limit=1)

gcloud storage ls gs://${UPLOADS_BUCKET}/ --recursive | head -20
```

**Expected result:** Uploaded files appear in the GCS bucket.

---

## Phase 6 — Explore Kubernetes Features [MANUAL]

### Step 6.1 — View Pod Topology

```bash
kubectl describe pods \
  --namespace=${NAMESPACE} \
  --selector="app.kubernetes.io/name=librechat" | grep -A5 "Node:"
```

**Expected result:** Pods are distributed across GKE Autopilot nodes.

### Step 6.2 — Inspect Workload Identity Annotation

```bash
kubectl get serviceaccount \
  --namespace=${NAMESPACE} \
  --output="json" | jq '.items[] | select(.metadata.annotations."iam.gke.io/gcp-service-account" != null)'
```

**Expected result:** The Kubernetes service account has a Workload Identity annotation pointing to the GCP service account.

### Step 6.3 — Check Pod Resource Requests

```bash
kubectl get pods \
  --namespace=${NAMESPACE} \
  --selector="app.kubernetes.io/name=librechat" \
  --output="json" | jq '.items[0].spec.containers[0].resources'
```

**Expected result:** CPU and memory requests/limits are configured for the LibreChat container.

### Step 6.4 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The LibreChat uptime check shows **Passing**.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Logs via gcloud

```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app_kubernetes_io/name"="librechat"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** LibreChat application logs appear including conversation request logs.

---

## Phase 8 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 10–15 minutes (GKE pod termination + Kubernetes resource cleanup).

> **Warning:** Undeploy permanently deletes Secret Manager secrets and GCS upload files. Export conversation history before undeploying.

> **Note:** The Firestore ENTERPRISE database is NOT deleted on destroy (ABANDON policy). Delete manually via the GCP Console if no longer needed.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Firestore MongoDB database provisioning | 1 | Yes |
| SCRAM user initialization job | 1 | Yes |
| Artifact Registry image mirror | 1 | Yes |
| GKE Deployment and Service | 1 | Yes |
| HPA configuration | 1 | Yes |
| Configure kubectl access | 1 | No |
| Record service IP/URL | 1 | No |
| Verify pod status | 2 | No |
| Check pod logs | 2 | No |
| Register admin account | 3 | No |
| Disable self-registration | 3 | No |
| Configure AI provider keys | 4 | No |
| Test conversations | 4 | No |
| Test file uploads | 5 | No |
| Inspect Workload Identity | 6 | No |
| Review uptime check | 6 | No |
| Undeploy | 8 | Yes |
