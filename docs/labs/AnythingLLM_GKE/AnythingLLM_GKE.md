---
title: "AnythingLLM on GKE — Lab Guide"
sidebar_label: "AnythingLLM GKE"
---

# AnythingLLM on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/AnythingLLM_GKE)**

## Overview

**Estimated time:** 3–4 hours

AnythingLLM is a private AI workspace and Retrieval-Augmented Generation (RAG) platform. This lab deploys AnythingLLM on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, persistent volume storage for vector data, GCS document storage, and Secret Manager for credential management.

### What the Module Automates

- GKE Autopilot namespace, Deployment (or StatefulSet), and Kubernetes Service
- Cloud SQL PostgreSQL 15 instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- Secret Manager secrets: `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`, `DB_PASSWORD`
- GCS document storage bucket (`<prefix>-anythingllm-docs`)
- StatefulSet PVC (`20Gi` per pod at `/app/server/storage`) when `stateful_pvc_enabled = true`
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer), HPA (min/max replicas)
- Cloud Monitoring uptime checks and alert policies
- `db-init` Kubernetes Job (PostgreSQL database and user creation)

### What You Do Manually

- Note the deployment outputs (external IP, namespace) from the RAD UI
- Configure `kubectl` with cluster credentials
- Confirm AnythingLLM is reachable via the LoadBalancer IP
- Create an admin account in the AnythingLLM UI
- Connect an LLM provider
- Create workspaces and upload documents
- Chat with your documents
- Review logs in Cloud Logging, inspect pods with `kubectl`
- Scale pods and observe HPA behaviour

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources, view logs |
| `kubectl` | Inspect pods, deployments, services, and jobs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, GKE Autopilot cluster, Cloud SQL instance).
3. The following APIs enabled (Services_GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` and `kubectl` authenticated and installed.
5. Access to the RAD UI with permission to deploy modules.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"anythingllm"` | Base name for resources |
| `application_version` | No | `"latest"` | Container image version |
| `gke_cluster_name` | No | `""` | GKE cluster name (auto-discovered if empty) |
| `container_resources` | No | `{ cpu_limit="2000m", memory_limit="4Gi" }` | CPU and memory limits |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `1` | Maximum pod replicas |
| `workload_type` | No | `null` | `"Deployment"` or `"StatefulSet"` (auto-selects StatefulSet when `stateful_pvc_enabled = true`) |
| `stateful_pvc_enabled` | No | `null` | Enable persistent PVC per pod for vector store data |
| `stateful_pvc_size` | No | `"20Gi"` | Storage per pod |
| `stateful_pvc_mount_path` | No | `"/app/server/storage"` | PVC mount path (AnythingLLM storage directory) |
| `application_database_name` | No | `"anythingllmdb"` | PostgreSQL database name |
| `application_database_user` | No | `"anythingllmuser"` | PostgreSQL user |
| `environment_variables` | No | `{}` | LLM provider settings |
| `secret_environment_variables` | No | `{}` | LLM API key references |
| `enable_redis` | No | `false` | Enable Redis (optional) |
| `enable_nfs` | No | `false` | Enable NFS for shared file storage |
| `backup_schedule` | No | `"0 2 * * *"` | Backup schedule |
| `support_users` | No | `[]` | Alert email addresses |
| `enable_iap` | No | `false` | Enable Identity-Aware Proxy |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| GKE cluster validation and namespace creation | 2–5 min |
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Secret Manager secrets | 1–2 min |
| Cloud Build image pipeline | 5–10 min |
| `db-init` Kubernetes Job | 2–3 min |
| GKE Deployment/StatefulSet rollout | 3–5 min |
| **Total** | **21–37 min** |

> **Note:** If this is the first deployment to a newly created GKE cluster, `kubernetes_ready` may be `false` on the first apply. The CI/CD pipeline will automatically re-run apply to complete the Kubernetes resource deployment.

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | External URL or LoadBalancer IP |
| `service_external_ip` | External static IP (if `reserve_static_ip = true`) |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace
export NAMESPACE=$(kubectl get namespaces \
  --output="jsonpath={.items[*].metadata.name}" | tr ' ' '\n' | grep anythingllm | head -1)

echo "Namespace: ${NAMESPACE}"
echo "Cluster: ${CLUSTER}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the External IP

```bash
kubectl get service -n ${NAMESPACE} --output=wide
```

**gcloud equivalent:**
```bash
gcloud compute addresses list \
  --project=${PROJECT} \
  --filter="name~anythingllm" \
  --format="table(name, address, status)"
```

**Expected result:** The Service shows an `EXTERNAL-IP`. Note this address as `ANYTHINGLLM_IP`.

```bash
export ANYTHINGLLM_IP=$(kubectl get service -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "AnythingLLM IP: ${ANYTHINGLLM_IP}"
```

### Step 2.2 — Confirm AnythingLLM is Reachable

```bash
curl -s http://${ANYTHINGLLM_IP}:3001/api/ping
```

**Expected result:** `{"online":true}`. If not yet ready, wait 60–90 seconds and retry.

### Step 2.3 — Inspect the Pod Status

```bash
kubectl get pods -n ${NAMESPACE} -o wide
```

**Expected result:** At least one AnythingLLM pod with status `Running` and all containers `Ready` (2/2 — application + Cloud SQL Auth Proxy sidecar).

---

## Phase 3 — Initial Setup [MANUAL]

### Step 3.1 — Open AnythingLLM

Navigate to `http://${ANYTHINGLLM_IP}:3001` in a browser (or use the custom domain if configured).

**Expected result:** AnythingLLM setup wizard appears.

### Step 3.2 — Create the Admin Account

1. Enter a username and password.
2. Click **Get started**.

**Expected result:** You are redirected to the main AnythingLLM interface.

### Step 3.3 — Review Auto-Generated Secrets

```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anythingllm" \
  --format="table(name, createTime)"
```

**Expected result:** Four secrets: `jwt-secret`, `auth-token`, `sig-key`, `sig-salt`, plus the database password secret.

---

## Phase 4 — Connect an LLM Provider [MANUAL]

### Step 4.1 — Configure LLM in Settings

1. Open **Settings** > **AI Providers** > **LLM Preference**.
2. Select your provider and enter credentials.
3. Click **Save changes**.

**Verify env var injection:**
```bash
kubectl get pod -n ${NAMESPACE} -o name | head -1 | xargs -I{} \
  kubectl exec -n ${NAMESPACE} {} -c anythingllm -- env | grep LLM_PROVIDER
```

### Step 4.2 — Configure Embedding and Vector Database

1. **Settings** > **AI Providers** > **Embedding Preference**: Select `Native AnythingLLM Embedder`.
2. **Settings** > **AI Providers** > **Vector Database**: Select `LanceDB`.
3. Save both settings.

**Expected result:** All three AI provider settings show green indicators.

---

## Phase 5 — Create a Workspace and Upload Documents [MANUAL]

### Step 5.1 — Create a Workspace

1. Click **+ New Workspace** in the sidebar.
2. Enter a name and click **Create workspace**.

### Step 5.2 — Upload and Embed Documents

1. Click **Upload documents** in the workspace.
2. Upload one or more PDF or text files.
3. Wait for the embedding process to complete.

**Expected result:** Documents show "Embedded" status in the workspace.

### Step 5.3 — Chat with Documents

Type a question in the workspace chat and press Enter.

**Expected result:** AnythingLLM returns an AI-generated answer with citations from the uploaded documents.

---

## Phase 6 — Kubernetes Inspection [MANUAL]

### Step 6.1 — Describe the Deployment or StatefulSet

```bash
# Check for StatefulSet (if stateful_pvc_enabled = true)
kubectl get statefulset -n ${NAMESPACE}

# Or Deployment (if stateful_pvc_enabled = false)
kubectl get deployment -n ${NAMESPACE}
```

**Expected result:** The workload shows `1/1` ready replicas.

### Step 6.2 — Inspect Pod Details

```bash
kubectl describe pod -n ${NAMESPACE} $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
```

**Expected result:** Pod spec shows:
- Two containers: `anythingllm` and `cloud-sql-proxy`
- Resource limits: `cpu: 2000m`, `memory: 4Gi`
- Volume mounts including `/cloudsql` for Auth Proxy
- If StatefulSet: PVC mount at `/app/server/storage`

### Step 6.3 — Inspect Persistent Volume Claims

```bash
kubectl get pvc -n ${NAMESPACE}
```

**Expected result:** If `stateful_pvc_enabled = true`, one or more PVCs named `<prefix>-storage-<pod-name>` with `Bound` status and 20 Gi capacity.

### Step 6.4 — View the db-init Job

```bash
kubectl get jobs -n ${NAMESPACE}
kubectl logs -n ${NAMESPACE} job/$(kubectl get jobs -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}' | head -1)
```

**Expected result:** Job shows `1/1 Completions`. Logs show successful PostgreSQL user and database creation.

### Step 6.5 — Check the HPA

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows `MINPODS` and `MAXPODS` matching `min_instance_count` and `max_instance_count`.

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

**Expected result:** AnythingLLM startup logs showing `Server running on port 3001` and Prisma database migration completion.

### Step 7.2 — View Cloud SQL Proxy Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.cluster_name="'${CLUSTER}'" AND resource.labels.namespace_name="'${NAMESPACE}'" AND resource.labels.container_name="cloud-sql-proxy"' \
  --project=${PROJECT} \
  --limit=10 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Cloud SQL Auth Proxy connection establishment logs.

---

## Phase 8 — Scaling [MANUAL]

### Step 8.1 — Scale Up

```bash
kubectl scale deployment -n ${NAMESPACE} \
  $(kubectl get deployments -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  --replicas=2
```

**Expected result:** A second pod starts. Both pods share the same Cloud SQL instance. If `stateful_pvc_enabled = true`, each pod has its own PVC.

### Step 8.2 — Scale Back Down

```bash
kubectl scale deployment -n ${NAMESPACE} \
  $(kubectl get deployments -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  --replicas=1
```

**Expected result:** One pod terminates gracefully. Kubernetes respects the `termination_grace_period_seconds = 60` setting.

---

## Phase 9 — Undeploy [AUTOMATED]

Click **Undeploy** in the RAD UI.

**Approximate undeploy duration:** 20–30 minutes.

> **Warning:** This permanently deletes the database, GCS bucket, PVCs, and all workspace data. Export AnythingLLM data before undeploying if needed.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and workload provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 | 1 | Yes |
| Secret Manager secrets | 1 | Yes |
| GCS document bucket | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| db-init Kubernetes Job | 1 | Yes |
| Configure kubectl | 2 | No |
| Get external IP | 2 | No |
| Confirm `/api/ping` returns 200 | 2 | No |
| Create admin account | 3 | No |
| Connect LLM provider | 4 | No |
| Configure embedding and vector DB | 4 | No |
| Create workspace and upload documents | 5 | No |
| Chat with documents | 5 | No |
| Inspect pods and PVCs | 6 | No |
| View logs | 7 | No |
| Scale deployment | 8 | No |
| Undeploy | 9 | Yes |
