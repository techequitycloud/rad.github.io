---
title: "AnythingLLM on GKE — Lab Guide"
sidebar_label: "AnythingLLM GKE"
---

# AnythingLLM on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/AnythingLLM_GKE)**

## Overview

**Estimated time:** 3–4 hours

AnythingLLM is a private AI workspace and Retrieval-Augmented Generation (RAG) platform. This lab deploys AnythingLLM on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, persistent StatefulSet volumes for vector store data, GCS document storage, and Secret Manager.

### What the Module Automates

- GKE Autopilot namespace, StatefulSet (or Deployment), and Kubernetes Service (LoadBalancer)
- Cloud SQL PostgreSQL 15 instance, database (`anythingllmdb`), and user (`anythingllmuser`)
- Cloud SQL Auth Proxy sidecar container per pod
- Secret Manager secrets: `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`, `DB_PASSWORD`
- GCS document storage bucket (`<prefix>-anythingllm-docs`)
- PVC per pod at `/app/server/storage` (when `stateful_pvc_enabled = true`, default 20 Gi)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- HPA (Horizontal Pod Autoscaler)
- Cloud Monitoring uptime checks and alert policies
- `db-init` Kubernetes Job (creates PostgreSQL database and user)

### What You Do Manually

- Configure `kubectl` with cluster credentials
- Confirm the LoadBalancer external IP and AnythingLLM reachability
- Create an AnythingLLM admin account
- Connect an LLM provider in the Settings UI
- Configure embedding engine and vector database
- Create workspaces and upload documents
- Chat with documents using AI
- Inspect Kubernetes resources (pods, PVCs, jobs, HPA)
- Review logs in Cloud Logging

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources |
| `kubectl` | Inspect pods, deployments, services, PVCs, and jobs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, GKE Autopilot cluster, Cloud SQL instance).
3. `gcloud` authenticated: `gcloud auth application-default login`
4. `kubectl` installed and available in PATH.
5. Access to the RAD UI with permission to deploy modules.
6. The following APIs enabled:
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"anythingllm"` | Base name for all resources |
| `application_version` | No | `"latest"` | Container image version |
| `gke_cluster_name` | No | `""` | GKE cluster name (auto-discovered) |
| `namespace_name` | No | `""` | Kubernetes namespace (auto-generated) |
| `container_resources` | No | `{ cpu_limit="2000m", memory_limit="4Gi" }` | Pod resource limits |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `1` | Maximum pod replicas |
| `workload_type` | No | `null` | Auto-selects StatefulSet when `stateful_pvc_enabled = true` |
| `stateful_pvc_enabled` | No | `null` | Enable per-pod persistent storage for vector data |
| `stateful_pvc_size` | No | `"20Gi"` | PVC size per pod |
| `stateful_pvc_mount_path` | No | `"/app/server/storage"` | PVC mount path |
| `stateful_fs_group` | No | `1000` | fsGroup GID matching AnythingLLM container user |
| `application_database_name` | No | `"anythingllmdb"` | PostgreSQL database name |
| `application_database_user` | No | `"anythingllmuser"` | PostgreSQL user |
| `environment_variables` | No | `{}` | LLM provider settings |
| `secret_environment_variables` | No | `{}` | LLM API key references in Secret Manager |
| `backup_schedule` | No | `"0 2 * * *"` | Backup cron schedule (UTC) |
| `support_users` | No | `[]` | Alert email addresses |
| `enable_iap` | No | `false` | Enable Identity-Aware Proxy |
| `enable_pod_disruption_budget` | No | `false` | Create a PodDisruptionBudget |
| `enable_topology_spread` | No | `false` | Spread pods across zones |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| GKE namespace and ServiceAccount creation | 2–4 min |
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Secret Manager secrets | 1–2 min |
| Cloud Build image pipeline | 5–10 min |
| `db-init` Kubernetes Job | 2–3 min |
| StatefulSet/Deployment rollout (GKE Autopilot provisioning) | 5–10 min |
| **Total** | **23–41 min** |

> **Note on `kubernetes_ready`:** If deploying to a newly created inline GKE cluster, the first apply sets `kubernetes_ready = false` and skips Kubernetes resource creation. The CI/CD pipeline automatically re-runs apply to complete the deployment once the cluster endpoint is ready.

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | External service URL |
| `service_external_ip` | Static external IP (if `reserve_static_ip = true`) |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `deployment_id` | Unique deployment identifier |
| `kubernetes_ready` | Whether Kubernetes resources are fully deployed |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Get GKE cluster name
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the AnythingLLM namespace
export NAMESPACE=$(kubectl get namespaces \
  -o jsonpath='{.items[*].metadata.name}' | tr ' ' '\n' | grep anythingllm | head -1)

echo "Cluster: ${CLUSTER}"
echo "Namespace: ${NAMESPACE}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the LoadBalancer IP

```bash
kubectl get service -n ${NAMESPACE}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/services" \
  | jq '.items[] | select(.metadata.namespace=="'${NAMESPACE}'")'
```

**Expected result:** The Service shows an `EXTERNAL-IP` value (the static IP if `reserve_static_ip = true`).

```bash
export ANYTHINGLLM_IP=$(kubectl get service -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "AnythingLLM IP: ${ANYTHINGLLM_IP}"
```

### Step 2.2 — Confirm AnythingLLM is Reachable

```bash
curl -s http://${ANYTHINGLLM_IP}:3001/api/ping
```

**Expected result:** `{"online":true}`. If the response is a connection error, AnythingLLM may still be starting up — wait 60–90 seconds and retry.

### Step 2.3 — Inspect Pod Status

```bash
kubectl get pods -n ${NAMESPACE} -o wide
```

**Expected result:** Pods show `Running` status with `2/2` containers ready (AnythingLLM + Cloud SQL Auth Proxy sidecar).

```bash
# Describe the first pod
kubectl describe pod -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
```

**Expected result:** Pod description shows resource limits (`cpu: 2000m`, `memory: 4Gi`), volume mounts (`/cloudsql`, `/app/server/storage`), and the Auth Proxy container spec.

---

## Phase 3 — Initial Setup [MANUAL]

### Step 3.1 — Open AnythingLLM

Navigate to `http://${ANYTHINGLLM_IP}:3001` in a browser.

**Expected result:** AnythingLLM setup wizard appears.

### Step 3.2 — Create the Admin Account

1. Enter a username and password.
2. Click **Get started**.

**Expected result:** Main AnythingLLM interface loads showing the workspace list.

### Step 3.3 — Verify Auto-Generated Secrets

```bash
# List AnythingLLM secrets
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anythingllm" \
  --format="table(name, createTime)"
```

```bash
# Read the JWT secret length as a sanity check
JWT=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anythingllm AND name~jwt-secret" \
  --format="value(name)" --limit=1)

gcloud secrets versions access latest --secret="${JWT}" --project=${PROJECT} | wc -c
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aanythingllm"
```

**Expected result:** Four application secrets plus the database password secret. JWT secret is 32 characters.

---

## Phase 4 — Connect an LLM Provider [MANUAL]

### Step 4.1 — Configure LLM Preference

1. Open **Settings** (gear icon) > **AI Providers** > **LLM Preference**.
2. Select a provider (e.g., **OpenAI**) and enter your API key.
3. Choose a model and click **Save changes**.

**Verify the env var:**
```bash
kubectl exec -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  -c anythingllm -- env | grep -E "LLM_PROVIDER|OPENAI|ANTHROPIC"
```

**Expected result:** The env var shows your configured provider.

### Step 4.2 — Configure Embedding and Vector DB

1. **Settings** > **AI Providers** > **Embedding Preference**: Select `Native AnythingLLM Embedder`.
2. **Settings** > **AI Providers** > **Vector Database**: Select `LanceDB`.
3. Save both.

---

## Phase 5 — Workspaces and Documents [MANUAL]

### Step 5.1 — Create a Workspace

1. Click **+ New Workspace** in the sidebar.
2. Name it and click **Create workspace**.

### Step 5.2 — Upload and Embed Documents

1. Click **Upload documents** in the workspace.
2. Upload a PDF or text file.
3. Wait for embedding to complete.

**Monitor embedding from the pod:**
```bash
kubectl logs -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  -c anythingllm --tail=20 -f
```

**Expected result:** Log lines show document processing and vector storage operations.

### Step 5.3 — Chat with Documents

Type a question in the workspace chat.

**Expected result:** AnythingLLM returns an AI-generated response with citations from the uploaded document.

---

## Phase 6 — Kubernetes Deep Dive [MANUAL]

### Step 6.1 — Inspect the StatefulSet

```bash
kubectl get statefulset -n ${NAMESPACE} -o wide
```

```bash
kubectl describe statefulset -n ${NAMESPACE} \
  $(kubectl get statefulsets -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
```

**Expected result:** StatefulSet shows `1/1` ready replicas. PVC template shows `20Gi` `standard-rwo` storage.

### Step 6.2 — Inspect Persistent Volume Claims

```bash
kubectl get pvc -n ${NAMESPACE}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  | jq '.masterAuth.clusterCaCertificate' -r | base64 -d > /tmp/ca.crt
```

**Expected result:** One PVC per pod with `Bound` status and `20Gi` capacity. The PVC name follows the pattern `<prefix>-storage-<pod-name>`.

### Step 6.3 — Verify Vector Storage in the PVC

```bash
kubectl exec -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  -c anythingllm -- ls /app/server/storage
```

**Expected result:** The storage directory contains AnythingLLM's database files, vector store data (LanceDB directory), and uploaded document caches.

### Step 6.4 — Inspect the db-init Job

```bash
kubectl get jobs -n ${NAMESPACE}
```

```bash
# Get job logs
JOB=$(kubectl get jobs -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
kubectl logs -n ${NAMESPACE} job/${JOB}
```

**Expected result:** Job shows `1/1 Completions`. Logs show PostgreSQL database user and database creation.

### Step 6.5 — Check the HPA

```bash
kubectl get hpa -n ${NAMESPACE}
kubectl describe hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows `MINPODS: 1`, `MAXPODS: 1`, `REPLICAS: 1`.

### Step 6.6 — Check Workload Identity

```bash
kubectl get serviceaccount -n ${NAMESPACE}
```

```bash
kubectl get serviceaccount -n ${NAMESPACE} \
  $(kubectl get serviceaccounts -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  -o jsonpath='{.metadata.annotations}'
```

**Expected result:** The Kubernetes ServiceAccount has an `iam.gke.io/gcp-service-account` annotation pointing to the GCP Workload Identity SA.

---

## Phase 7 — Cloud Logging [MANUAL]

### Step 7.1 — View Application Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.cluster_name="'${CLUSTER}'" AND resource.labels.namespace_name="'${NAMESPACE}'" AND resource.labels.container_name="anythingllm"' \
  --project=${PROJECT} \
  --limit=30 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** AnythingLLM startup logs including `Server running on port 3001` and Prisma migration success.

### Step 7.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.cluster_name="'${CLUSTER}'" AND resource.labels.namespace_name="'${NAMESPACE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=10 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** No errors under normal operation.

### Step 7.3 — View Cloud SQL Auth Proxy Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.cluster_name="'${CLUSTER}'" AND resource.labels.namespace_name="'${NAMESPACE}'" AND resource.labels.container_name="cloud-sql-proxy"' \
  --project=${PROJECT} \
  --limit=10 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Auth Proxy logs show successful connection to the Cloud SQL PostgreSQL instance.

---

## Phase 8 — Undeploy [AUTOMATED]

Click **Undeploy** in the RAD UI.

**Approximate undeploy duration:** 20–30 minutes.

> **Warning:** This permanently deletes all resources including the database, GCS bucket, PVCs, and all workspace data. Export AnythingLLM data before undeploying if needed.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and StatefulSet/Deployment | 1 | Yes |
| Cloud SQL PostgreSQL 15 | 1 | Yes |
| Secret Manager secrets (JWT, AUTH, SIG, DB) | 1 | Yes |
| GCS document bucket | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| db-init Kubernetes Job | 1 | Yes |
| Configure kubectl | 2 | No |
| Get LoadBalancer IP | 2 | No |
| Confirm `/api/ping` returns 200 | 2 | No |
| Inspect pod status and sidecars | 2 | No |
| Create admin account | 3 | No |
| Verify auto-generated secrets | 3 | No |
| Connect LLM provider | 4 | No |
| Configure embedding and vector DB | 4 | No |
| Create workspace | 5 | No |
| Upload and embed documents | 5 | No |
| Chat with documents | 5 | No |
| Inspect StatefulSet, PVCs, and HPA | 6 | No |
| Verify Workload Identity | 6 | No |
| Review Cloud Logging | 7 | No |
| Undeploy | 8 | Yes |
