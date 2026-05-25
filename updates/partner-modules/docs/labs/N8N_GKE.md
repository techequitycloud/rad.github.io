# n8n on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_GKE)**

This lab guide walks you through deploying, exploring, and operating **n8n** workflow
automation on Google Kubernetes Engine (GKE) Autopilot using the **N8N_GKE** module. You
will access n8n via a Kubernetes LoadBalancer service, build and test workflows, inspect
Kubernetes workloads and NFS persistence, verify Workload Identity security, query Cloud
Logging for execution events, and scale the deployment horizontally using kubectl, gcloud CLI,
and REST API.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access n8n](#exercise-1--access-n8n)
6. [Exercise 2 — Create and Execute Workflows](#exercise-2--create-and-execute-workflows)
7. [Exercise 3 — Webhooks and Triggers](#exercise-3--webhooks-and-triggers)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#12-cleanup)
13. [Reference](#13-reference)

---

## 1. Overview

### What Is n8n?

n8n is a fair-code workflow automation platform with 189,000+ GitHub stars, 230,000+ active
users, and a $2.5B valuation as of 2025. It provides a visual canvas editor, 400+
integrations, webhook triggers, HTTP request nodes, and scheduled workflows. It is fully
self-hostable with no per-execution fees. The `N8N_GKE` module deploys n8n on GKE Autopilot
backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for persistent workflow data, Redis
queue mode, Workload Identity IAM, and a Kubernetes LoadBalancer with session affinity.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Managed Kubernetes with automatic node provisioning |
| **PostgreSQL Backend** | Cloud SQL PostgreSQL 15 via Cloud SQL Auth Proxy sidecar |
| **Workload Identity** | Pod-level GCP IAM without service account keys |
| **NFS Persistence** | Cloud Filestore NFS for workflow data and execution history |
| **Redis Queue Mode** | Bull queue backend enabling reliable multi-pod execution |
| **Session Affinity** | Kubernetes Service with `ClientIP` session stickiness for the n8n editor |
| **Horizontal Pod Autoscaler** | Automatic scaling based on CPU utilization |

---

## 2. Architecture

```
External Traffic (HTTP port 5678)
        │
        ▼
  Kubernetes Service (LoadBalancer, ClientIP session affinity)
  External IP:5678 → n8n Pod(s)
  ┌──────────────────────────────────────────────────────────┐
  │  n8n Deployment  (namespace: appn8n<tenant><id>)         │
  │                                                          │
  │  ┌─────────────────────────────────────────────────────┐ │
  │  │ n8n container                                        │ │
  │  │   entrypoint.sh → DB var mapping                     │ │
  │  │   n8n Node.js process (tini PID 1)                   │ │
  │  │   port 5678                                          │ │
  │  │ cloudsql-proxy sidecar                               │ │
  │  │   /cloudsql/<instance-connection-name>               │ │
  │  └─────────────────────────────────────────────────────┘ │
  │  NFS PVC → Cloud Filestore /mnt/nfs                      │
  └──────────────────────────────────────────────────────────┘
        │ VPC Private Networking
        ├──────────────────────────────┐
        ▼                              ▼
  Cloud SQL PostgreSQL 15       Cloud Filestore NFS
  n8n_db (n8n_user)             shared workflow data
        │
        ▼
  Redis (NFS VM IP:6379)
  Bull queue mode backend
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GKE Autopilot Cluster                                     │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Namespace: appn8n<tenant><id>                       │  │  │
│  │  │                                                      │  │  │
│  │  │  Deployment: n8n           HPA: min=1 max=3          │  │  │
│  │  │  Service: LoadBalancer     session affinity: ClientIP │  │  │
│  │  │  ServiceAccount (Workload Identity bound)            │  │  │
│  │  │  Job: db-init (completed)                            │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Cloud SQL   │  │  Filestore   │  │  Redis (NFS VM)       │  │
│  │  PostgreSQL  │  │  NFS share   │  │  queue mode backend   │  │
│  │  15          │  │  /mnt/nfs    │  │  port 6379            │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  Secret Mgr  │  │  Cloud Logging   │  │  Monitoring       │  │
│  │  N8N_ENC_KEY │  │  k8s_container   │  │  uptime check     │  │
│  │  SMTP pass   │  │  logs            │  │  alert policies   │  │
│  └──────────────┘  └──────────────────┘  └───────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  N8N_GKE
    application_version   = "2.4.7"     →  n8n container image tag
    min_instance_count    = 1           →  always one pod running
    max_instance_count    = 3           →  HPA maximum replicas
    enable_nfs            = true        →  Cloud Filestore NFS mounted
    enable_redis          = true        →  Redis queue mode enabled
    session_affinity      = "ClientIP"  →  session stickiness
    database_type         = POSTGRES_15 →  n8n requires PostgreSQL
    N8N_ENCRYPTION_KEY    → auto-generated, Secret Manager → k8s Secret
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.developer
roles/cloudsql.admin
roles/secretmanager.viewer
roles/logging.viewer
roles/monitoring.viewer
roles/iam.serviceAccountViewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export CLUSTER="your-gke-cluster-name"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `N8N_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `n8n` | Base resource name |
| `application_version` | `2.4.7` | n8n image tag |
| `tenant_deployment_id` | `demo` | Short deployment suffix |
| `deploy_application` | `true` | Deploy the n8n workload |
| `enable_nfs` | `true` | Cloud Filestore NFS for persistence |
| `enable_redis` | `true` | Redis queue mode |
| `db_name` | `n8n_db` | PostgreSQL database name |
| `db_user` | `n8n_user` | PostgreSQL application user |
| `min_instance_count` | `1` | Minimum pod replicas |
| `max_instance_count` | `3` | Maximum pod replicas (HPA) |
| `cpu_limit` | `2000m` | CPU per n8n pod |
| `memory_limit` | `4Gi` | Memory per n8n pod |
| `session_affinity` | `ClientIP` | Session stickiness |
| `support_users` | `[your-email]` | Alert notification recipients |

Click **Deploy** and wait for provisioning to complete (approximately 15–25 minutes).

> **What this provisions:** GKE Autopilot namespace with Kubernetes Deployment, LoadBalancer
> Service (ClientIP session affinity), HPA, PodDisruptionBudget, and ServiceAccount with
> Workload Identity. Cloud SQL PostgreSQL 15 instance with `n8n_db` database and `n8n_user`.
> Cloud Filestore NFS at `/mnt/nfs`. Secret Manager secrets for encryption key and SMTP
> password synced to Kubernetes Secrets. Artifact Registry repository. Cloud Build image
> pipeline. Cloud Monitoring uptime check. A `db-init` Kubernetes Job runs automatically
> to initialize the PostgreSQL schema.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

echo "Cluster: ${CLUSTER}"

# Discover secrets
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8n AND name~db-password" \
  --format="value(name)" \
  --limit=1)

export ENC_KEY_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8n AND name~encryption-key" \
  --format="value(name)" \
  --limit=1)
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes

# Discover the n8n namespace (pattern: appn8n<tenant><id>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appn8n" | head -1)

echo "Namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "n8n URL: http://${EXTERNAL_IP}:5678"
```

---

## Exercise 1 — Access n8n

### Objective

Retrieve the Kubernetes LoadBalancer external IP, confirm n8n is reachable, and complete
the initial owner account setup.

### Step 1.1 — Get the External Service IP

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}"

EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "n8n URL: http://${EXTERNAL_IP}:5678"
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --filter="name~n8n" \
  --format="table(name, IPAddress, portRange, region)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, status: .status, endpoint: .endpoint}'
```

**Expected result:** An external IP address is returned. If the IP shows `<pending>`, wait 1–2 minutes for the load balancer to provision.

### Step 1.2 — Verify the n8n Pod is Running

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"
```

Expected output:
```
NAME                        READY   STATUS    RESTARTS   AGE
appn8ndemo<id>-<hash>       2/2     Running   0          5m
db-init-<hash>              0/1     Completed 0          6m
```

**Expected result:** The n8n pod shows `2/2 READY` (n8n container + Cloud SQL Auth Proxy sidecar). The `db-init` job shows `Completed`.

### Step 1.3 — Confirm n8n is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}:5678"
```

Alternatively, use port-forward for local access:
```bash
kubectl port-forward service/"$(kubectl get svc -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  5678:5678 -n "${NAMESPACE}" &
# Then open http://localhost:5678
```

**Expected result:** HTTP `200`. If `000`, wait for the pod to become fully ready (startup probe allows up to 120 seconds for initial database connection).

### Step 1.4 — Create the Owner Account

Open `http://${EXTERNAL_IP}:5678` in a browser. On first launch, n8n prompts you to create an owner account:

1. Enter your **email address**.
2. Enter your **first name** and **last name**.
3. Enter a strong **password** (minimum 8 characters).
4. Click **Next** and complete the setup wizard.

**Expected result:** You are redirected to the n8n canvas (workflow editor).

### Step 1.5 — Retrieve the Encryption Key Secret

```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~n8n" \
  --format="table(name, createTime)"

# Verify the encryption key is stored in Secret Manager
gcloud secrets describe "${ENC_KEY_SECRET}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '{name: .name, createTime: .createTime}'
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3An8n" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[].name'
```

**Expected result:** Two n8n secrets are listed: `*-encryption-key` and `*-db-password`. These are synced to Kubernetes Secrets in the namespace.

---

## Exercise 2 — Create and Execute Workflows

### Objective

Build a three-node workflow using Manual Trigger, HTTP Request, and Set nodes — then
execute it and inspect the data flow between nodes.

### Step 2.1 — Create a New Workflow

1. Click **+ New workflow** in the left sidebar.
2. Click **+** on the canvas. Search for **Manual Trigger** and select it.
3. Click **+** on the right edge of the Manual Trigger. Search for **HTTP Request** and select it.
   - Set **URL** to `https://httpbin.org/get`
   - Set **Method** to `GET`
4. Click **+** after the HTTP Request. Search for **Set** and select it.
   - Click **Add Value → String**
   - Set **Name** to `message`
   - Set **Value** to `Workflow executed successfully`
5. Click **Save** (top-right).

### Step 2.2 — Execute the Workflow

Click **Execute workflow** (or the play button on the Manual Trigger node).

**Expected result:** Each node shows a green checkmark. Click any node to inspect its output data. The Set node output contains `{"message": "Workflow executed successfully"}`.

### Step 2.3 — Inspect Node Data

Click the HTTP Request node to inspect its output:
1. The **Output** panel shows the full JSON response from `httpbin.org/get`.
2. Note the `headers.Host` and `origin` fields in the response.

**kubectl — view n8n execution logs:**
```bash
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=n8n -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
     kubectl get pods -n "${NAMESPACE}" --no-headers -o custom-columns=':metadata.name' | grep -v db-init | head -1)" \
  -c n8n 2>/dev/null --tail=20 || \
  kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pods -n "${NAMESPACE}" --no-headers -o custom-columns=':metadata.name' | grep -v db-init | head -1)" \
  --tail=20
```

**Expected result:** n8n logs show workflow execution events including start time and completion.

### Step 2.4 — Create a More Complex Workflow

1. Create a new workflow.
2. Add a **Manual Trigger** node.
3. Add an **HTTP Request** node targeting `https://httpbin.org/uuid`.
4. Add a **Set** node:
   - Add string: Name = `uuid`, Value = `={{ $json.uuid }}`
5. Add an **IF** node:
   - Condition: `{{ $json.uuid }}` is not empty
6. Save and execute.

**Expected result:** The IF node evaluates the UUID condition and routes to the `true` branch, confirming the HTTP Request returned a valid UUID.

### Step 2.5 — View Execution History

Click **Executions** (clock icon) in the top navigation bar.

**Expected result:** All workflow executions are listed with status (success/error), start time, and duration.

---

## Exercise 3 — Webhooks and Triggers

### Objective

Create a webhook-triggered workflow, test it with curl, and configure a scheduled trigger
with automatic execution.

### Step 3.1 — Create a Webhook Workflow

1. Click **+ New workflow**.
2. Add a **Webhook** node as the trigger:
   - Set **HTTP Method** to `POST`
   - Set **Path** to `gke-webhook`
3. Add a **Set** node after the webhook:
   - Add a string value: Name = `received`, Value = `={{ $json.body }}`
4. Click **Save**.
5. Click **Listen for Test Event** in the Webhook node.

**Expected result:** The test webhook URL is:
`http://${EXTERNAL_IP}:5678/webhook-test/gke-webhook`

### Step 3.2 — Test the Webhook with curl

```bash
curl -X POST "http://${EXTERNAL_IP}:5678/webhook-test/gke-webhook" \
  -H "Content-Type: application/json" \
  -d '{"hello": "from curl", "environment": "gke"}'
```

**Expected result:** The n8n UI shows the webhook received the data. The payload `{"hello": "from curl", "environment": "gke"}` appears in the Webhook node output.

### Step 3.3 — Activate the Webhook for Production

1. Close the test listener.
2. **Activate** the workflow using the toggle in the top-right corner.
3. The production webhook URL: `http://${EXTERNAL_IP}:5678/webhook/gke-webhook`

```bash
# Test the production webhook
curl -X POST "http://${EXTERNAL_IP}:5678/webhook/gke-webhook" \
  -H "Content-Type: application/json" \
  -d '{"event": "production", "source": "lab"}'
```

**kubectl — verify the service session affinity:**
```bash
kubectl get service -n "${NAMESPACE}" -o json \
  | jq '.items[0].spec.sessionAffinity'
```

**Expected result:** The service uses `ClientIP` session affinity, ensuring webhook requests from the same client IP consistently route to the same n8n pod — important for stateful webhook listeners.

### Step 3.4 — Create a Scheduled Trigger

1. Create a new workflow.
2. Add a **Schedule Trigger** node:
   - Set **Trigger Interval** to `Minutes`
   - Set **Minutes Between Triggers** to `1`
3. Add an **HTTP Request** node targeting `https://httpbin.org/uuid`.
4. **Save** and **Activate** the workflow.

**REST API — check Cloud Logging for scheduled execution:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND textPayload=~\"Schedule\"",
    "pageSize": 5
  }' | jq '.entries[].textPayload'
```

**Expected result:** After 1 minute, an execution appears in the workflow's execution history. Deactivate the workflow after testing.

### Step 3.5 — Test Webhook Persistence Across Pod Restarts

Active webhooks are stored in the PostgreSQL database. Verify they survive a pod restart:

```bash
N8N_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  -o custom-columns=':metadata.name' | grep -v db-init | head -1)

# Restart the pod
kubectl delete pod "${N8N_POD}" -n "${NAMESPACE}"

# Wait for the new pod to be ready
kubectl rollout status deployment \
  "$(kubectl get deployment -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -n "${NAMESPACE}"

# Verify the webhook still works
curl -X POST "http://${EXTERNAL_IP}:5678/webhook/gke-webhook" \
  -H "Content-Type: application/json" \
  -d '{"event": "after-restart"}'
```

**Expected result:** The webhook continues to work after the pod restarts, because workflow state is stored in PostgreSQL (persistent across pod lifecycle).

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the n8n Kubernetes Deployment, Service, NFS persistence, and HPA configuration
to understand how the module wires together GKE resources.

### Step 4.1 — Inspect the Deployment

**kubectl:**
```bash
kubectl describe deployment -n "${NAMESPACE}"

kubectl get deployment -n "${NAMESPACE}" -o json \
  | jq '{
    name: .items[0].metadata.name,
    replicas: .items[0].spec.replicas,
    image: .items[0].spec.template.spec.containers[0].image,
    cpu: .items[0].spec.template.spec.containers[0].resources.limits.cpu,
    memory: .items[0].spec.template.spec.containers[0].resources.limits.memory,
    port: .items[0].spec.template.spec.containers[0].ports[0].containerPort
  }'
```

**Expected result:** The Deployment shows the n8n 2.4.7 image, 2 vCPU / 4Gi resource limits, port 5678, and 1 current replica.

### Step 4.2 — Inspect the LoadBalancer Service

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}" -o wide
kubectl describe service -n "${NAMESPACE}"
```

**Expected result:** The Kubernetes Service of type `LoadBalancer` maps external port 5678 to container port 5678 with `ClientIP` session affinity.

### Step 4.3 — Inspect Pod Containers

**kubectl:**
```bash
N8N_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  -o custom-columns=':metadata.name' | grep -v db-init | head -1)

# List containers in the pod
kubectl get pod "${N8N_POD}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.containers[*].name}' | tr ' ' '\n'

# View n8n container startup logs
kubectl logs "${N8N_POD}" -n "${NAMESPACE}" --tail=30 2>/dev/null || \
  kubectl logs "${N8N_POD}" -n "${NAMESPACE}" -c n8n --tail=30
```

**Expected result:** Two containers are listed: `n8n` and `cloud-sql-proxy`. The n8n container logs show database connection events and the n8n version banner.

### Step 4.4 — Inspect NFS Volume Mount

**kubectl:**
```bash
kubectl get pod "${N8N_POD}" -n "${NAMESPACE}" -o json \
  | jq '.spec.volumes[] | select(.name | test("nfs"))'

kubectl exec "${N8N_POD}" -n "${NAMESPACE}" -- \
  ls /mnt/nfs/ 2>/dev/null || echo "NFS directory accessible"
```

**gcloud — describe the Filestore instance:**
```bash
gcloud filestore instances list \
  --project="${PROJECT}" \
  --format="table(name, tier, networks[0].ipAddresses[0], fileShares[0].capacityGb)"
```

**Expected result:** The NFS volume is mounted at `/mnt/nfs`. The Cloud Filestore instance is listed as `READY` with its private IP address.

### Step 4.5 — Inspect the db-init Job

**kubectl:**
```bash
kubectl get jobs -n "${NAMESPACE}"
kubectl describe job -n "${NAMESPACE}" \
  "$(kubectl get jobs -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" 2>/dev/null
```

**Expected result:** The `db-init` job shows `1/1` successful completions. This job ran the `db-init.sh` script to create the `n8n_db` database and `n8n_user` PostgreSQL user before the n8n Deployment started.

---

## Exercise 5 — Security and Workload Identity

### Objective

Inspect the Kubernetes ServiceAccount Workload Identity binding, verify IAM roles assigned
to the n8n GCP service account, and review Kubernetes Secrets synced from Secret Manager.

### Step 5.1 — Inspect the Kubernetes ServiceAccount

**kubectl:**
```bash
kubectl get serviceaccounts -n "${NAMESPACE}" -o wide

kubectl describe serviceaccount \
  "$(kubectl get sa -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -n "${NAMESPACE}"
```

**Expected result:** The n8n ServiceAccount has the annotation:
`iam.gke.io/gcp-service-account=<gcp-sa-email>@${PROJECT}.iam.gserviceaccount.com`
This binds the Kubernetes ServiceAccount to a GCP IAM service account via Workload Identity federation.

### Step 5.2 — Verify IAM Roles on the GCP Service Account

**gcloud:**
```bash
export GCP_SA=$(kubectl get serviceaccount -n "${NAMESPACE}" \
  "$(kubectl get sa -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')" \
  -o jsonpath='{.metadata.annotations.iam\.gke\.io/gcp-service-account}')

echo "GCP SA: ${GCP_SA}"

# List IAM roles
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${GCP_SA}" \
  --format="table(bindings.role)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq --arg sa "${GCP_SA}" '.bindings[] | select(.members[] | test($sa)) | .role'
```

**Expected result:** The GCP service account has roles including `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, and `roles/storage.objectAdmin`.

### Step 5.3 — Verify the Workload Identity Binding

**gcloud:**
```bash
gcloud iam service-accounts get-iam-policy "${GCP_SA}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.bindings[] | select(.role == "roles/iam.workloadIdentityUser")'
```

**Expected result:** The binding shows `serviceAccount:${PROJECT}.svc.id.goog[${NAMESPACE}/<k8s-sa-name>]` as a member with `roles/iam.workloadIdentityUser`, confirming Workload Identity is correctly configured.

### Step 5.4 — Inspect Kubernetes Secrets

**kubectl:**
```bash
kubectl get secrets -n "${NAMESPACE}" \
  -o custom-columns="NAME:.metadata.name,TYPE:.type,AGE:.metadata.creationTimestamp"

# View the encryption key secret (shows key names, not values)
kubectl describe secret -n "${NAMESPACE}" \
  "$(kubectl get secrets -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')"
```

**Expected result:** Kubernetes Secrets for the n8n encryption key and DB password are listed. The `N8N_ENCRYPTION_KEY` secret was synced from Secret Manager during deployment.

### Step 5.5 — Verify Pod Uses Workload Identity

**kubectl:**
```bash
N8N_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  -o custom-columns=':metadata.name' | grep -v db-init | head -1)

# Check the service account used by the pod
kubectl get pod "${N8N_POD}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.serviceAccountName}'

# Verify the pod can access GCP services via Workload Identity
kubectl exec "${N8N_POD}" -n "${NAMESPACE}" -- \
  wget -qO- "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email" \
  -H "Metadata-Flavor: Google" 2>/dev/null || echo "Metadata server accessible via Workload Identity"
```

**Expected result:** The pod runs under the n8n Kubernetes ServiceAccount bound to the GCP service account via Workload Identity. The metadata server returns the GCP service account email.

---

## Exercise 6 — Cloud Logging

### Objective

Query n8n container logs via Cloud Logging, filter for workflow execution events, inspect
Cloud SQL Auth Proxy logs, and navigate the Logs Explorer.

### Step 6.1 — View n8n Application Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"n8n\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp, jsonPayload.message)"
```

**kubectl (live logs):**
```bash
N8N_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  -o custom-columns=':metadata.name' | grep -v db-init | head -1)

kubectl logs "${N8N_POD}" -n "${NAMESPACE}" --tail=30
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "orderBy": "timestamp desc",
    "pageSize": 20
  }' | jq '.entries[] | {timestamp: .timestamp, message: (.jsonPayload.message // .textPayload)}'
```

**Expected result:** n8n startup logs appear, including database connection events, webhook registration messages, and the n8n version banner.

### Step 6.2 — Filter for Workflow Execution Events

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND jsonPayload.message=~\"Workflow\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {timestamp: .timestamp, message: .jsonPayload.message}'
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND jsonPayload.message=~\"Workflow\"",
    "pageSize": 10
  }' | jq '.entries[].jsonPayload.message'
```

**Expected result:** Log entries show workflow execution start, completion, and any error events, with workflow IDs and execution timestamps.

### Step 6.3 — View Cloud SQL Auth Proxy Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"cloud-sql-proxy\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**kubectl:**
```bash
N8N_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  -o custom-columns=':metadata.name' | grep -v db-init | head -1)
kubectl logs "${N8N_POD}" -n "${NAMESPACE}" -c cloud-sql-proxy --tail=20
```

**Expected result:** Auth Proxy logs show connection establishment to the PostgreSQL instance via Unix socket at `/cloudsql/<connection-name>`.

### Step 6.4 — Filter for Errors

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, severity, jsonPayload.message)"
```

**Expected result:** Under normal operation, no critical errors appear after startup. Warnings may appear during the db-init job execution or Redis connection establishment.

### Step 6.5 — Navigate to Logs Explorer

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22k8s_container%22%0Aresource.labels.namespace_name%3D%22${NAMESPACE}%22?project=${PROJECT}"
```

Open the URL to use the interactive Logs Explorer with filtering, time range selection, and log streaming for all containers in the n8n namespace.

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Review GKE container metrics for n8n, check the uptime monitor, observe HPA scaling
behavior, and practice manual and automatic scaling.

### Step 7.1 — View Container CPU and Memory Metrics

Navigate to Metrics Explorer:
```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

Select:
- **Resource type:** `k8s_container`
- **Metric:** `kubernetes.io/container/cpu/core_usage_time`
- **Filter:** `namespace_name = ${NAMESPACE}`

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project="${PROJECT}" \
  --format="table(name)" \
  --limit=10
```

**REST API (query CPU usage):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = \"'"${NAMESPACE}"'\" | within 30m | group_by [resource.container_name], mean(val())"
  }' | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, utilisation: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** CPU utilization for the n8n container is near zero under no-load conditions. Memory usage is typically 300–800 MB depending on the number of active workflows.

### Step 7.2 — Review the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period, timeout)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .name, displayName: .displayName, host: .httpCheck.host}'
```

**Expected result:** An uptime check polls n8n at `GET /` every 60 seconds and shows **Passing** status.

### Step 7.3 — Inspect the HPA

**kubectl:**
```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** The HPA shows `min=1`, `max=3`, current CPU utilization, and target CPU threshold (typically 80%). Current replicas is `1` under no-load conditions.

### Step 7.4 — Scale the Deployment Manually

**kubectl:**
```bash
DEPLOY_NAME=$(kubectl get deployment -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')

# Scale to 2 replicas
kubectl scale deployment "${DEPLOY_NAME}" \
  --replicas=2 \
  -n "${NAMESPACE}"

# Watch pods scaling up
kubectl get pods -n "${NAMESPACE}" -w
```

**Expected result:** A second n8n pod starts within 60–90 seconds. Both pods share the NFS `/mnt/nfs` volume for workflow persistence, and session affinity ensures the editor session stays on one pod.

### Step 7.5 — Perform a Rolling Update and Rollback

```bash
# Trigger a rolling update via an env var change
kubectl set env "deployment/${DEPLOY_NAME}" \
  LAB_VERSION=test-update \
  -n "${NAMESPACE}"

# Watch the rolling update
kubectl rollout status "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"

# View rollout history
kubectl rollout history "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"

# Rollback to previous revision
kubectl rollout undo "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"
kubectl rollout status "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"
```

**REST API — verify cluster health after rollback:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{status: .status, currentNodeCount: .currentNodeCount}'
```

**Expected result:** The rolling update replaces pods one at a time, maintaining availability. The rollback completes successfully and restores the previous deployment state.

### Step 7.6 — Return to Minimum Replicas

```bash
kubectl scale deployment "${DEPLOY_NAME}" --replicas=1 -n "${NAMESPACE}"
kubectl get pods -n "${NAMESPACE}"
```

**Expected result:** One pod terminates gracefully. The remaining pod continues serving traffic. The HPA resumes control and may scale back down to the minimum.

---

## 12. Cleanup

Return to the RAD UI and click **Undeploy** on the `N8N_GKE` deployment. This removes
the Kubernetes namespace and all workloads, Cloud SQL instance, NFS Filestore, GCS buckets,
Secret Manager secrets, Workload Identity bindings, and all associated IAM resources.

> **Warning:** The `N8N_ENCRYPTION_KEY` is destroyed with the module. All workflow
> credentials encrypted with this key cannot be decrypted after re-deployment. Export
> credentials from n8n Settings before undeploying if you need to preserve them.

### Manual Cleanup (if needed)

**kubectl:**
```bash
# Delete the namespace and all its resources
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete secrets
gcloud secrets delete "${ENC_KEY_SECRET}" \
  --project="${PROJECT}" --quiet
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# Delete Cloud SQL instance
export SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="databaseVersion:POSTGRES_15" \
  --format="value(name)" --limit=1)
gcloud sql instances delete "${SQL_INSTANCE}" \
  --project="${PROJECT}" --quiet
```

**REST API — delete Cloud SQL instance:**
```bash
curl -s -X DELETE \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## 13. Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID (required) |
| `region` | `string` | `us-central1` | GCP region for all resources |
| `application_name` | `string` | `n8n` | Base resource name |
| `application_version` | `string` | `2.4.7` | n8n container image tag |
| `tenant_deployment_id` | `string` | `demo` | Short suffix appended to resource names |
| `deploy_application` | `bool` | `true` | Deploy the n8n workload (false = infra only) |
| `gke_cluster_name` | `string` | `""` | Target GKE cluster name (auto-discovered if empty) |
| `cpu_limit` | `string` | `2000m` | CPU per n8n pod |
| `memory_limit` | `string` | `4Gi` | Memory per n8n pod |
| `min_instance_count` | `number` | `1` | HPA minimum replicas |
| `max_instance_count` | `number` | `3` | HPA maximum replicas |
| `container_port` | `number` | `5678` | n8n listening port |
| `service_type` | `string` | `LoadBalancer` | Kubernetes Service type |
| `session_affinity` | `string` | `ClientIP` | Session stickiness for LoadBalancer |
| `enable_nfs` | `bool` | `true` | Cloud Filestore NFS for workflow persistence |
| `nfs_mount_path` | `string` | `/mnt/nfs` | NFS mount path inside containers |
| `enable_redis` | `bool` | `true` | Redis queue mode (uses NFS server IP by default) |
| `redis_host` | `string` | `""` | Redis hostname (blank = NFS server IP) |
| `redis_port` | `string` | `6379` | Redis TCP port |
| `db_name` | `string` | `n8n_db` | PostgreSQL database name |
| `db_user` | `string` | `n8n_user` | PostgreSQL application user |
| `database_password_length` | `number` | `32` | Auto-generated password length |
| `enable_auto_password_rotation` | `bool` | `false` | Automated DB password rotation |
| `backup_schedule` | `string` | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | `number` | `7` | Days to retain backup files |
| `support_users` | `list(string)` | `[]` | Email addresses for monitoring alerts |
| `resource_labels` | `map(string)` | `{}` | Labels applied to all provisioned resources |

### Auto-Injected Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `N8N_PORT` | `5678` | Fixed to match `container_port` |
| `DB_TYPE` | `postgresdb` | Forces PostgreSQL backend |
| `N8N_ENCRYPTION_KEY` | Kubernetes Secret ref | Auto-generated; synced from Secret Manager |
| `WEBHOOK_URL` | Internal ClusterIP URL | Pre-computed service URL |
| `N8N_EDITOR_BASE_URL` | Internal ClusterIP URL | Same as `WEBHOOK_URL` |
| `ENABLE_REDIS` | `true` / `false` | Reflects `enable_redis` variable |
| `QUEUE_BULL_REDIS_HOST` | NFS server IP | Resolved at runtime from `NFS_SERVER_IP` |
| `QUEUE_BULL_REDIS_PORT` | `6379` | Redis TCP port |

### Useful Commands Reference

```bash
# Get n8n external IP
kubectl get svc -n "${NAMESPACE}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Tail n8n logs
kubectl logs -n "${NAMESPACE}" -l app=n8n -f

# Check pod health
kubectl get pods -n "${NAMESPACE}" -o wide

# Describe deployment
kubectl describe deployment -n "${NAMESPACE}"

# Check HPA status
kubectl get hpa -n "${NAMESPACE}"

# Scale deployment
kubectl scale deployment -n "${NAMESPACE}" <name> --replicas=<n>

# Rolling update status
kubectl rollout status deployment/<name> -n "${NAMESPACE}"

# Rollback deployment
kubectl rollout undo deployment/<name> -n "${NAMESPACE}"

# List n8n secrets
gcloud secrets list --project="${PROJECT}" --filter="name~n8n"

# Check uptime monitor
gcloud monitoring uptime list-configs --project="${PROJECT}"

# View Cloud SQL instance
gcloud sql instances list --project="${PROJECT}"
```

### Further Reading

- [n8n documentation](https://docs.n8n.io/)
- [n8n queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy for GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Kubernetes Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Cloud Filestore NFS for GKE](https://cloud.google.com/filestore/docs/accessing-fileshares)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
