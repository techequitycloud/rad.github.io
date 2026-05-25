# Odoo on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Odoo_GKE)**

This lab guide walks you through deploying, exploring, and operating **Odoo Community Edition** — a comprehensive open-source ERP suite — on Google Kubernetes Engine Autopilot using the **Odoo_GKE** module. You will work with kubectl, Kubernetes workloads, Odoo CRM and Sales modules, Workload Identity security, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Odoo](#exercise-1--access-odoo)
6. [Exercise 2 — Install and Configure Modules](#exercise-2--install-and-configure-modules)
7. [Exercise 3 — CRM and Sales Workflow](#exercise-3--crm-and-sales-workflow)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is Odoo?

Odoo is a comprehensive open-source **ERP platform** with 16M+ users and 170,000+ enterprise customers. It covers CRM, accounting, inventory, manufacturing, HR, and e-commerce in one integrated suite at zero licensing cost. Deployed on GKE Autopilot, it benefits from Kubernetes-native scalability, Workload Identity security, and managed infrastructure.

The `Odoo_GKE` module deploys Odoo 18.0 Community Edition on GKE Autopilot with Cloud SQL PostgreSQL, mandatory Cloud Filestore NFS for the Odoo filestore, GCS for addons, and `ODOO_MASTER_PASS` managed in Secret Manager with Workload Identity injection.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Serverless Kubernetes for ERP workloads |
| **Workload Identity** | Pods access GCP services without key files |
| **NFS Persistent Storage** | Shared Filestore across Odoo pods |
| **Cloud SQL Auth Proxy** | Encrypted socket-based database connectivity |
| **CRM and Sales** | Lead management, pipeline, quotations |
| **Kubernetes Workloads** | Deployment, Service, HPA, NFS PVs |
| **Cloud Logging** | Odoo Python logs forwarded to Cloud Logging |
| **Cloud Monitoring** | GKE workload metrics and HPA scaling |

---

## 2. Architecture

```
Browser
       │
       ▼
LoadBalancer Service (external IP)
       │  port 80 → 8069
       ▼
Odoo Pod (GKE Autopilot namespace)
  ├── odoo container (port 8069)
  │     NFS mount: /mnt (filestore, sessions, extra-addons)
  │     GCS Fuse: odoo-addons bucket → /mnt/extra-addons
  │
  └── cloud-sql-proxy sidecar (Unix socket /cloudsql)
        │
        ▼  (Cloud SQL Auth Proxy)
Cloud SQL PostgreSQL 15 (private IP)
  DB: odoo / user: odoo

Supporting infrastructure:
  ┌──────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
  │  Cloud Filestore NFS │  │  Secret Manager   │  │  Artifact        │
  │  /mnt (filestore,    │  │  ODOO_MASTER_PASS │  │  Registry        │
  │  sessions,           │  │  DB_PASSWORD      │  │  Ubuntu-based    │
  │  extra-addons)       │  │  ROOT_PASSWORD    │  │  Odoo 18.0 image │
  └──────────────────────┘  └───────────────────┘  └──────────────────┘

Init jobs (Kubernetes Jobs at deploy time):
  nfs-init:  Creates /mnt/filestore, /mnt/sessions, /mnt/extra-addons
  db-init:   Creates PostgreSQL odoo database and user

  ┌──────────────────────┐  ┌───────────────────┐
  │  Cloud Logging       │  │  Cloud Monitoring  │
  │  pod logs, audit     │  │  GKE metrics, HPA, │
  │  logs                │  │  uptime checks     │
  └──────────────────────┘  └───────────────────┘

Module variable wiring:
  Odoo_GKE
    application_version    = "18.0"      → Odoo nightly package version
    container_port         = 8069        → Kubernetes Service target port
    enable_cloudsql_volume = true        → Auth Proxy sidecar (socket)
    enable_nfs             = true        → NFS mandatory for Odoo
    min_instance_count     = 1           → Keep one pod warm
    max_instance_count     = 3           → HPA maximum
    session_affinity       = "ClientIP"  → Route sessions to same pod
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` | Any | System package manager |
| `jq` | 1.6+ | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
roles/secretmanager.admin
roles/cloudsql.admin
roles/storage.admin
roles/logging.viewer
roles/monitoring.viewer
```

### Environment Variables

```bash
export PROJECT="${PROJECT:-your-gcp-project-id}"
export REGION="${REGION:-us-central1}"
export CLUSTER_NAME="${CLUSTER_NAME:-gke-cluster}"
export APP_NS="${APP_NS:-odoo}"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Odoo_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `18.0` | Odoo version |
| `min_instance_count` | `1` | Keeps pod warm |
| `max_instance_count` | `3` | HPA maximum |
| `enable_nfs` | `true` | Required for Odoo |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar |
| `application_database_name` | `odoo` | PostgreSQL DB name |
| `application_database_user` | `odoo` | PostgreSQL user |

Click **Deploy** and wait for provisioning to complete (approximately 30–50 minutes including Odoo's first-boot module installation).

> **What this provisions:** GKE Autopilot cluster (or targets existing), Cloud SQL PostgreSQL 15 instance, Cloud Filestore NFS volume, GCS addons bucket, Artifact Registry with custom Ubuntu-based Odoo image, Secret Manager secrets, Kubernetes namespace, Deployment with Cloud SQL Auth Proxy sidecar, Service with `ClientIP` session affinity, HPA, `nfs-init` and `db-init` Kubernetes Jobs, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT}"

kubectl cluster-info
kubectl get nodes
```

### 4.3 Configure kubectl for Odoo Namespace

```bash
export APP_NS=$(kubectl get namespaces \
  --selector="app.kubernetes.io/name=odoo" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "odoo")

kubectl get pods -n "${APP_NS}"

export ODOO_IP=$(kubectl get service \
  -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Odoo URL: http://${ODOO_IP}"
export SERVICE_URL="http://${ODOO_IP}"

# Get master password
MASTER_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~odoo AND name~master-password" \
  --format="value(name)" \
  --limit=1)

export MASTER_PASS=$(gcloud secrets versions access latest \
  --secret="${MASTER_SECRET}" \
  --project="${PROJECT}")

echo "Master password: ${MASTER_PASS}"
```

---

## Exercise 1 — Access Odoo

### Objective

Retrieve the external IP of the Kubernetes service, verify pod health, complete the Odoo initial database setup, and log in to the dashboard.

### Step 1.1 — Get the External IP

**kubectl:**
```bash
kubectl get service -n "${APP_NS}" -o wide

kubectl get service -n "${APP_NS}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'
```

**gcloud:**
```bash
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="name~odoo" \
  --format="table(name,address,status)"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("odoo")) | {name, address, status}'
```

### Step 1.2 — Verify Pods Are Running

```bash
kubectl get pods -n "${APP_NS}" -o wide

# Pods should show 2/2 READY (odoo + cloud-sql-proxy)
kubectl describe pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  | grep -A5 "Containers:"
```

**Expected result:** All pods show `2/2 Running`.

> **Note:** Odoo uses a TCP startup probe with 180s initial delay. Wait up to 5 minutes for pods to become Ready on first boot.

### Step 1.3 — Verify the Health Endpoint

```bash
curl -s "${SERVICE_URL}/web/health" | jq .
```

**Expected result:** `{"status": "pass"}` — Odoo is running and connected to the database.

### Step 1.4 — Initial Database Setup

Open `${SERVICE_URL}/web/database/selector` in your browser. Click **Create Database**:
- **Master Password:** `${MASTER_PASS}`
- **Database Name:** `odoo`
- **Email:** `admin@example.com`
- **Password:** Your chosen admin password
- **Language:** English
- **Country:** United States

Click **Create Database** and wait 3–5 minutes for Odoo to initialize.

### Step 1.5 — Authenticate via REST

```bash
curl -s -c /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/session/authenticate" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"call","params":{"db":"odoo","login":"admin@example.com","password":"your-password"}}' \
  | jq '.result | {uid, name, username}'
```

**Expected result:** Session authenticated; user ID and name returned.

---

## Exercise 2 — Install and Configure Modules

### Objective

Install key Odoo ERP modules (CRM, Sales, Inventory) from the integrated App Store and configure company settings.

### Step 2.1 — Configure the Company

1. Navigate to **Settings > General Settings**.
2. Under **Companies**, set:
   - **Company Name:** `Demo Corp GKE`
   - **Currency:** USD
3. Click **Save**.

### Step 2.2 — Install CRM Module

1. Click the main menu grid and navigate to **Apps**.
2. Search for **CRM** and click **Install**.
3. Wait for installation to complete.

**REST API (list installed modules):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "ir.module.module",
      "method": "search_read",
      "args": [[["state","=","installed"],["name","in",["crm","sale","stock"]]]],
      "kwargs": {"fields": ["name","state","shortdesc"]}
    }
  }' | jq '.result[] | {name, state}'
```

### Step 2.3 — Install Sales Module

Search for and install the **Sales** module from the App Store.

### Step 2.4 — Verify Modules are Active

```bash
# Check all installed modules
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "ir.module.module",
      "method": "search_read",
      "args": [[["state","=","installed"]]],
      "kwargs": {"fields": ["name"], "limit": 30}
    }
  }' | jq '[.result[].name] | sort'
```

**Expected result:** `crm` and `sale` appear in the installed modules list.

---

## Exercise 3 — CRM and Sales Workflow

### Objective

Create a CRM lead, manage the opportunity pipeline, create a quotation, and confirm a sales order — demonstrating Odoo's integrated ERP workflow.

### Step 3.1 — Create a Lead

1. Navigate to **CRM**.
2. Click **+ New** in the Pipeline view.
3. Create a lead:
   - **Opportunity:** `New Cloud Project`
   - **Contact:** Jane Smith
   - **Company:** TechCorp
   - **Expected Revenue:** $10,000
4. Click **Add**.

**REST API (create a lead):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "crm.lead",
      "method": "create",
      "args": [{"name": "GKE API Lead", "contact_name": "Bob Jones", "expected_revenue": 5000, "probability": 60}],
      "kwargs": {}
    }
  }' | jq '.result'
```

### Step 3.2 — Advance the Pipeline

**REST API (update lead stage and probability):**
```bash
LEAD_ID="<id from step 3.1>"
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"call\",
    \"params\": {
      \"model\": \"crm.lead\",
      \"method\": \"write\",
      \"args\": [[${LEAD_ID}], {\"probability\": 80, \"planned_revenue\": 8000}],
      \"kwargs\": {}
    }
  }" | jq '.result'
```

**Expected result:** Lead probability updated to 80%.

### Step 3.3 — Create a Sales Quotation

1. Navigate to **Sales > Quotations**.
2. Click **+ New**.
3. Set **Customer** to a contact from CRM.
4. Add an **Order Line** with product name and unit price.
5. Click **Save** then **Confirm** to create a Sales Order.

**REST API (list confirmed sales orders):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "sale.order",
      "method": "search_read",
      "args": [[["state","=","sale"]]],
      "kwargs": {"fields": ["name","state","amount_total","partner_id"], "limit": 5}
    }
  }' | jq '.result[] | {name, state, total: .amount_total, customer: .partner_id[1]}'
```

**Expected result:** Confirmed sales order with `sale` state.

### Step 3.4 — View Pipeline Analytics

1. Navigate to **CRM > Reporting > Pipeline Analysis**.
2. Group by **Stage** to see total expected revenue by pipeline stage.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Explore the GKE Deployment, Service, NFS PersistentVolume, and Cloud SQL Auth Proxy sidecar configuration for the Odoo workload.

### Step 4.1 — Inspect the Deployment

```bash
kubectl describe deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo"

# List containers (odoo + cloud-sql-proxy)
kubectl get deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  -o jsonpath='{.items[0].spec.template.spec.containers[*].name}' \
  | tr ' ' '\n'
```

**Expected result:** Two containers: `odoo` and `cloud-sql-proxy`.

### Step 4.2 — Inspect the NFS PersistentVolume

```bash
kubectl get pv | grep -i odoo

kubectl get pvc -n "${APP_NS}"

kubectl describe pvc -n "${APP_NS}" \
  | grep -E "Capacity|Access|StorageClass|Volume"
```

**Expected result:** PVC bound to a Cloud Filestore NFS PV with `ReadWriteMany` access mode.

### Step 4.3 — Verify NFS Directories from Inside a Pod

```bash
POD=$(kubectl get pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "${APP_NS}" "${POD}" -c odoo -- \
  ls -la /mnt/

kubectl exec -n "${APP_NS}" "${POD}" -c odoo -- \
  df -h /mnt
```

**Expected result:** Three directories: `filestore`, `sessions`, `extra-addons` with owner UID 101.

### Step 4.4 — Inspect the Cloud SQL Auth Proxy Sidecar

```bash
kubectl logs -n "${APP_NS}" "${POD}" -c cloud-sql-proxy --tail=20

kubectl exec -n "${APP_NS}" "${POD}" -c odoo -- \
  ls -la /cloudsql/
```

**Expected result:** Auth Proxy connected; socket file under `/cloudsql/`.

### Step 4.5 — Check the Service Session Affinity

```bash
kubectl describe service -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  | grep -E "Session Affinity|Type|Port"
```

**Expected result:** `Session Affinity: ClientIP` — Odoo sessions are pinned to a specific pod.

### Step 4.6 — View the Init Jobs

```bash
kubectl get jobs -n "${APP_NS}"

# Check nfs-init completion
kubectl describe job -n "${APP_NS}" \
  -l "app.kubernetes.io/component=nfs-init" \
  | grep -E "Succeeded|Failed|Completions"

# Check db-init completion
kubectl describe job -n "${APP_NS}" \
  -l "app.kubernetes.io/component=db-init" \
  | grep -E "Succeeded|Failed|Completions"
```

**Expected result:** Both `nfs-init` and `db-init` jobs show `1/1 Succeeded`.

---

## Exercise 5 — Security and Workload Identity

### Objective

Verify that Odoo pods use Workload Identity for secure access to Secret Manager and GCS, and inspect the cluster security configuration.

### Step 5.1 — Inspect the Kubernetes Service Account

```bash
kubectl get serviceaccounts -n "${APP_NS}"

kubectl describe serviceaccount -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  | grep -A3 "Annotations:"
```

**Expected result:** Service account has `iam.gke.io/gcp-service-account` annotation.

### Step 5.2 — Verify IAM Bindings

```bash
GCP_SA=$(kubectl get serviceaccount -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  -o jsonpath='{.items[0].metadata.annotations.iam\.gke\.io/gcp-service-account}')

echo "GCP SA: ${GCP_SA}"

gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${GCP_SA}" \
  --format="table(bindings.role)"
```

**gcloud:**
```bash
gcloud iam service-accounts get-iam-policy "${GCP_SA}" \
  --project="${PROJECT}" \
  --format="yaml"
```

**Expected result:** GCP SA has roles for Secret Manager access, GCS, and Cloud SQL client.

### Step 5.3 — Verify ODOO_MASTER_PASS Injection

```bash
POD=$(kubectl get pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "${APP_NS}" "${POD}" -c odoo -- \
  env | grep ODOO_MASTER_PASS | wc -c
# Expected: non-zero (variable is present)

kubectl exec -n "${APP_NS}" "${POD}" -c odoo -- \
  env | grep -E "DB_HOST|DB_USER|DB_NAME"
```

**Expected result:** `ODOO_MASTER_PASS` present; `DB_*` connection variables injected.

### Step 5.4 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~odoo" \
  --format="table(name,createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:odoo" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name}'
```

**Expected result:** Secrets for `master-password`, `db-password`, and `root-password`.

### Step 5.5 — Review GKE Cluster Security

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --format="yaml(workloadIdentityConfig,shieldedNodes,binaryAuthorization)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER_NAME}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{workloadIdentity: .workloadIdentityConfig, shieldedNodes: .shieldedNodes}'
```

**Expected result:** Workload Identity pool set, Shielded Nodes enabled.

---

## Exercise 6 — Cloud Logging

### Objective

Query Cloud Logging for Odoo pod logs, inspect structured log entries, and view the output from initialization jobs.

### Step 6.1 — View Recent Pod Logs

**kubectl:**
```bash
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  --tail=30 -c odoo
```

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name=\"odoo\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

### Step 6.2 — Filter HTTP Requests to Odoo Web

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name=\"odoo\" \
   AND textPayload:\"/web\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {timestamp, message: .textPayload}' | head -30
```

**Expected result:** Log entries showing Odoo web request processing.

### Step 6.3 — View Init Job Logs

```bash
# nfs-init logs
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/component=nfs-init" \
  --tail=20

# db-init logs
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/component=db-init" \
  --tail=20

gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name~\"nfs-init|db-init\"" \
  --project="${PROJECT}" \
  --limit=15 \
  --format="table(timestamp,container: resource.labels.container_name,textPayload)"
```

### Step 6.4 — View Cloud SQL Proxy Logs

```bash
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  --tail=20 -c cloud-sql-proxy

gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name=\"cloud-sql-proxy\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

### Step 6.5 — Query by Severity

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND severity>=\"WARNING\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {timestamp, severity, container: .resource.labels.container_name, message: .textPayload}'
```

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Review Cloud Monitoring metrics for GKE workloads, check HPA configuration, and observe Odoo's resource consumption patterns.

### Step 7.1 — View Pod Resource Metrics

**kubectl:**
```bash
kubectl top pods -n "${APP_NS}"
kubectl top nodes
```

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/memory/limit_utilization | filter resource.namespace_name = '${APP_NS}' | filter resource.container_name = 'odoo' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, memory_util: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** Odoo memory utilization per pod — typically 60–80% of the limit.

### Step 7.2 — Check HPA Status

```bash
kubectl get hpa -n "${APP_NS}"

kubectl describe hpa -n "${APP_NS}" \
  | grep -E "Name|Current|Min|Max|Desired|Conditions"
```

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/autoscaler" \
  --project="${PROJECT}" \
  --limit=5
```

### Step 7.3 — Scale the Deployment

```bash
# Scale up Odoo to 2 replicas
kubectl scale deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  --replicas=2

kubectl rollout status deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo"

kubectl get pods -n "${APP_NS}" -o wide

# Scale back down
kubectl scale deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=odoo" \
  --replicas=1
```

**Expected result:** Second Odoo pod starts and becomes `2/2 Running`, then scales back to 1.

> **Note:** When multiple Odoo pods run without Redis, sessions are tied to specific pods via `ClientIP` affinity. Enable Redis for fully stateless multi-pod deployments.

### Step 7.4 — View Uptime Check Status

**gcloud:**
```bash
gcloud monitoring uptime list \
  --project="${PROJECT}" \
  --format="table(displayName,monitoredResource.labels.host,period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {displayName, period, path: .httpCheck.path}'
```

### Step 7.5 — Check CPU Utilization

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${APP_NS}' | filter resource.container_name = 'odoo' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, cpu_util: .pointData[-1].values[0].doubleValue}'
```

### Step 7.6 — Open Monitoring Dashboard

```bash
echo "GKE Workload Dashboard:"
echo "https://console.cloud.google.com/kubernetes/workload_/goog-k8s-cluster-name=${CLUSTER_NAME}?project=${PROJECT}"

echo "Cloud Monitoring:"
echo "https://console.cloud.google.com/monitoring/dashboards?project=${PROJECT}"
```

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Odoo_GKE` deployment. This removes the GKE workloads, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${APP_NS}" --grace-period=30
```

**gcloud:**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~odoo" \
  --format="value(name)" --limit=1)
gcloud sql instances delete "${INSTANCE}" --project="${PROJECT}" --quiet

gcloud secrets list --project="${PROJECT}" --filter="name~odoo" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete GKE cluster:**
```bash
curl -s -X DELETE \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER_NAME}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region fallback |
| `application_name` | string | `odoo` | Base resource and workload name |
| `application_version` | string | `18.0` | Odoo nightly package version |
| `container_port` | number | `8069` | Odoo HTTP port |
| `min_instance_count` | number | `1` | Minimum pod replicas |
| `max_instance_count` | number | `3` | Maximum pod replicas (HPA) |
| `enable_nfs` | bool | `true` | Cloud Filestore NFS (required) |
| `nfs_mount_path` | string | `/mnt` | NFS container mount path |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar |
| `application_database_name` | string | `odoo` | PostgreSQL database name |
| `application_database_user` | string | `odoo` | PostgreSQL database user |
| `enable_redis` | bool | `false` | Redis session store |
| `redis_host` | string | `""` | Redis host (empty = NFS server IP) |
| `database_type` | string | `POSTGRES` | Cloud SQL PostgreSQL version |
| `enable_pod_disruption_budget` | bool | `true` | PDB for high availability |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron |
| `backup_retention_days` | number | `7` | Backup retention days |

### Useful Commands Reference

```bash
# Get external IP
kubectl get service -n "${APP_NS}" -o wide

# Get all pods
kubectl get pods -n "${APP_NS}" -o wide

# View Odoo logs
kubectl logs -n "${APP_NS}" -l app.kubernetes.io/name=odoo -c odoo --tail=50

# View HPA
kubectl get hpa -n "${APP_NS}"

# Scale deployment
kubectl scale deployment -n "${APP_NS}" -l app.kubernetes.io/name=odoo --replicas=2

# Execute in pod
POD=$(kubectl get pod -n "${APP_NS}" -l app.kubernetes.io/name=odoo -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "${APP_NS}" "${POD}" -c odoo -- odoo --version

# Check resource usage
kubectl top pods -n "${APP_NS}"

# Check Workload Identity
kubectl describe serviceaccount -n "${APP_NS}" | grep iam.gke.io

# List init jobs
kubectl get jobs -n "${APP_NS}"
```

### Further Reading

- [Odoo Documentation](https://www.odoo.com/documentation/18.0/)
- [Odoo CRM Guide](https://www.odoo.com/documentation/18.0/applications/sales/crm.html)
- [Odoo RPC API](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html)
- [GKE Autopilot Overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy on GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Cloud Filestore for GKE](https://cloud.google.com/filestore/docs/accessing-fileshares)
