---
title: "Strapi on GKE — Lab Guide"
sidebar_label: "Strapi GKE"
---

# Strapi on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Strapi_GKE)**

This lab guide walks you through deploying, exploring, and operating **Strapi** — the leading open-source headless CMS — on Google Kubernetes Engine Autopilot using the **Strapi_GKE** module. You will work with kubectl, Kubernetes workloads, Content Type Builder, REST and GraphQL APIs, Workload Identity, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Strapi Admin](#exercise-1--access-strapi-admin)
6. [Exercise 2 — Content Type Builder](#exercise-2--content-type-builder)
7. [Exercise 3 — REST and GraphQL APIs](#exercise-3--rest-and-graphql-apis)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is Strapi?

Strapi is the leading open-source **headless CMS** with 71,000+ GitHub stars, trusted by Adidas, Airbus, Amazon, Cisco, and Toyota for omnichannel content delivery. Strapi delivers a fully customizable admin panel and REST/GraphQL API layer with no vendor lock-in, deployed here on GKE Autopilot for production-grade Kubernetes management.

The `Strapi_GKE` module deploys Strapi 5.0 on GKE Autopilot with Cloud SQL PostgreSQL, Cloud Filestore NFS for media uploads, GCS for object storage, and five auto-generated cryptographic secrets managed via Workload Identity.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Serverless Kubernetes with automatic node management |
| **Workload Identity** | Kubernetes pods access GCP services securely |
| **NFS Persistent Storage** | Cloud Filestore NFS shared across all Strapi pods |
| **Content Type Builder** | No-code schema design on Kubernetes-backed CMS |
| **REST and GraphQL APIs** | Auto-generated API surface from content schema |
| **Cloud Logging** | Structured pod logs forwarded to Cloud Logging |
| **HPA Scaling** | Horizontal Pod Autoscaler manages Strapi replicas |
| **Secret Manager** | Five Strapi cryptographic secrets auto-managed |

---

## 2. Architecture

```
Browser / API Client
       │
       ▼
LoadBalancer Service (external IP)
       │  port 80 → 1337
       ▼
Strapi Pod (GKE Autopilot namespace)
  ├── strapi container (port 1337)
  │     NFS mount: /mnt/nfs (shared media uploads)
  │     GCS Fuse: strapi-uploads bucket
  │
  └── (TCP connection to Cloud SQL private IP)
        DB: strapi / user: strapi

Supporting infrastructure:
  ┌──────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
  │  Cloud Filestore NFS │  │  Secret Manager   │  │  Artifact        │
  │  /mnt/nfs            │  │  APP_KEYS,        │  │  Registry        │
  │  shared media        │  │  JWT_SECRET,      │  │  Two-stage       │
  │  across all pods     │  │  ADMIN_JWT_SECRET │  │  Node.js image   │
  │                      │  │  API_TOKEN_SALT   │  │                  │
  │                      │  │  TRANSFER_TOKEN   │  │                  │
  └──────────────────────┘  └───────────────────┘  └──────────────────┘

  ┌──────────────────────┐  ┌───────────────────┐
  │  Cloud Logging       │  │  Cloud Monitoring  │
  │  pod logs, audit     │  │  metrics, HPA,     │
  │  logs, requests      │  │  uptime checks     │
  └──────────────────────┘  └───────────────────┘

Module variable wiring:
  Strapi_GKE
    application_version       = "5.0.0"    → Strapi image tag
    container_port            = 1337       → Kubernetes Service target port
    enable_nfs                = true       → Filestore NFS PersistentVolume
    min_instance_count        = 1          → Always keep one pod warm
    max_instance_count        = 10         → HPA maximum replicas
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
export APP_NS="${APP_NS:-strapi}"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Strapi_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `5.0.0` | Strapi image tag |
| `min_instance_count` | `1` | Keeps pod warm |
| `max_instance_count` | `10` | HPA maximum |
| `enable_nfs` | `true` | NFS for shared media |
| `application_database_name` | `strapi` | PostgreSQL DB name |
| `application_database_user` | `strapi` | PostgreSQL user |

Click **Deploy** and wait for provisioning to complete (approximately 25–45 minutes).

> **What this provisions:** GKE Autopilot cluster (or targets existing), Cloud SQL PostgreSQL instance, Cloud Filestore NFS volume, GCS uploads bucket, Artifact Registry with two-stage Strapi image built via Cloud Build, Secret Manager secrets, Kubernetes namespace, Deployment, Service, HPA, `db-init` Kubernetes Job, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT}"

kubectl cluster-info
kubectl get nodes
```

### 4.3 Configure kubectl for Strapi Namespace

```bash
export APP_NS=$(kubectl get namespaces \
  --selector="app.kubernetes.io/name=strapi" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "strapi")

kubectl get pods -n "${APP_NS}"

export STRAPI_IP=$(kubectl get service \
  -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Strapi URL: http://${STRAPI_IP}"
export SERVICE_URL="http://${STRAPI_IP}"
```

---

## Exercise 1 — Access Strapi Admin

### Objective

Retrieve the external IP, verify pod health, complete the initial admin registration, and log in to the Strapi Admin Panel.

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
  --filter="name~strapi" \
  --format="table(name,address,status)"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("strapi")) | {name, address, status}'
```

### Step 1.2 — Verify Pods Are Running

```bash
kubectl get pods -n "${APP_NS}" -o wide

kubectl describe pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  | grep -A5 "Containers:"
```

**Expected result:** Pods show `1/1 Running` (single container per pod for Strapi on GKE).

### Step 1.3 — Verify the Health Endpoint

```bash
curl -s "${SERVICE_URL}/_health" | jq .
```

**Expected result:** `{"status":"ok"}` — Strapi is running and connected to PostgreSQL.

### Step 1.4 — Initial Admin Setup

Open `${SERVICE_URL}/admin` in your browser. Complete the **Create your first Administrator** form:
- **First name:** Admin
- **Email:** `admin@example.com`
- **Password:** Choose a strong password

### Step 1.5 — Obtain an Admin Token

```bash
export STRAPI_TOKEN=$(curl -s -X POST "${SERVICE_URL}/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}' \
  | jq -r '.data.token')

echo "Admin token: ${STRAPI_TOKEN}"
```

**Expected result:** Admin JWT returned for use in subsequent API calls.

---

## Exercise 2 — Content Type Builder

### Objective

Create a Collection Type using the Strapi Content-Type Builder, add fields, and verify the schema is persisted in the Cloud SQL database.

### Step 2.1 — Create a Collection Type

1. Navigate to **Content-Type Builder** in the left sidebar.
2. Click **+ Create new collection type**.
3. Display name: `Product`
4. Click **Continue**.

### Step 2.2 — Add Fields

Add the following fields to `Product`:

| Field | Type | Options |
|---|---|---|
| `name` | Short text | Required |
| `description` | Long text | |
| `price` | Decimal | Required |
| `sku` | UID | Attached to `name` |
| `image` | Media | Single |
| `inStock` | Boolean | Default: true |

Click **Save**. Strapi will restart to apply schema changes.

**REST API (verify):**
```bash
curl -s "${SERVICE_URL}/api/products" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '{data: (.data | length), meta}'
```

### Step 2.3 — Verify Schema in Cloud SQL

```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~strapi" \
  --format="value(name)" \
  --limit=1)

gcloud sql databases list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"
```

**kubectl (check pod restart after schema change):**
```bash
kubectl rollout status deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi"

kubectl get pods -n "${APP_NS}" -o wide
```

**Expected result:** Pod restarts after schema save; deployment shows `1/1` available.

### Step 2.4 — Configure Permissions for the New Type

**REST API:**
```bash
# Enable public read for products
curl -s -X PUT "${SERVICE_URL}/admin/plugins/users-permissions/roles/2" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"permissions": {"api::product.product": {"find": {"enabled": true}, "findOne": {"enabled": true}}}}'
```

**Expected result:** Public role can read products without authentication.

---

## Exercise 3 — REST and GraphQL APIs

### Objective

Query the Strapi REST API with filtering and population, execute GraphQL queries and mutations, and use API tokens.

### Step 3.1 — Create Products via REST

```bash
curl -s -X POST "${SERVICE_URL}/api/products" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "name": "Cloud Widget Pro",
      "description": "A premium GKE-deployed widget.",
      "price": 99.99,
      "sku": "cloud-widget-pro",
      "inStock": true
    }
  }' | jq '.data | {id, name: .attributes.name, price: .attributes.price}'
```

### Step 3.2 — REST API Filtering and Pagination

```bash
# List all in-stock products sorted by price
curl -s "${SERVICE_URL}/api/products?filters[inStock][\$eq]=true&sort[0]=price:asc&pagination[pageSize]=10" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '.data[] | {id, name: .attributes.name, price: .attributes.price}'

# Search by name
curl -s "${SERVICE_URL}/api/products?filters[name][\$containsi]=widget" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '.data[] | {id, name: .attributes.name}'
```

**Expected result:** Filtered and sorted product list.

### Step 3.3 — GraphQL Query

**REST API (execute GraphQL):**
```bash
curl -s -X POST "${SERVICE_URL}/graphql" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { products(filters: {inStock: {eq: true}}) { data { id attributes { name price sku } } } }"
  }' | jq '.data.products.data[] | {id, name: .attributes.name, price: .attributes.price}'
```

**Expected result:** GraphQL response matching REST results.

### Step 3.4 — GraphQL Mutation

```bash
curl -s -X POST "${SERVICE_URL}/graphql" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { createProduct(data: {name: \"GKE Gadget\", price: 49.99, sku: \"gke-gadget\", inStock: true}) { data { id attributes { name price } } } }"
  }' | jq '.data.createProduct.data | {id, name: .attributes.name}'
```

### Step 3.5 — Create an API Token

1. Navigate to **Settings > API Tokens**.
2. Click **+ Create new API Token**.
3. Name: `gke-readonly`, Type: **Read-only**.
4. Copy the generated token.

```bash
READ_TOKEN="your-read-only-token"
curl -s "${SERVICE_URL}/api/products" \
  -H "Authorization: Bearer ${READ_TOKEN}" \
  | jq '.data | length'
```

**Expected result:** Products returned using the read-only token.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Explore the GKE Deployment, Service, PersistentVolume, and HPA resources backing the Strapi installation.

### Step 4.1 — Inspect the Deployment

```bash
kubectl describe deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi"

# View resource requests and limits
kubectl get deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  -o jsonpath='{.items[0].spec.template.spec.containers[0].resources}'
```

### Step 4.2 — Inspect the NFS PersistentVolume

```bash
kubectl get pv | grep -i strapi

kubectl get pvc -n "${APP_NS}"

kubectl describe pvc -n "${APP_NS}" \
  | grep -E "Capacity|Access|StorageClass|Volume"
```

**Expected result:** PVC bound to a Cloud Filestore NFS PV with `ReadWriteMany` access mode.

### Step 4.3 — Verify NFS Mount from Inside a Pod

```bash
POD=$(kubectl get pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "${APP_NS}" "${POD}" -- \
  df -h /mnt/nfs

kubectl exec -n "${APP_NS}" "${POD}" -- \
  ls -la /mnt/nfs/
```

**Expected result:** NFS share mounted at `/mnt/nfs` and writable by the Strapi process.

### Step 4.4 — View Environment Variables

```bash
kubectl exec -n "${APP_NS}" "${POD}" -- \
  env | grep -E "^DB_|^JWT_|GCS_|NODE_ENV|PORT"
```

**Expected result:** Database connection variables, JWT secrets, GCS bucket config, and PORT=1337.

### Step 4.5 — Check the Horizontal Pod Autoscaler

```bash
kubectl get hpa -n "${APP_NS}"

kubectl describe hpa -n "${APP_NS}" \
  | grep -E "Name|Namespace|Metrics|Min|Max|Replicas"
```

**Expected result:** HPA configured with CPU-based scaling, min 1, max 10 replicas.

### Step 4.6 — View the db-init Job

```bash
kubectl get jobs -n "${APP_NS}"

kubectl describe job -n "${APP_NS}" \
  -l "app.kubernetes.io/component=db-init" \
  | grep -E "Parallelism|Completions|Succeeded|Failed"
```

**Expected result:** `db-init` Job shows `1/1 Succeeded`.

---

## Exercise 5 — Security and Workload Identity

### Objective

Verify that Strapi pods use Workload Identity for GCP service access, inspect Secret Manager bindings, and review the GKE security posture.

### Step 5.1 — Inspect the Kubernetes Service Account

```bash
kubectl get serviceaccounts -n "${APP_NS}"

kubectl describe serviceaccount -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  | grep -A3 "Annotations:"
```

**Expected result:** Service account has `iam.gke.io/gcp-service-account` annotation.

### Step 5.2 — Verify IAM Bindings

```bash
GCP_SA=$(kubectl get serviceaccount -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
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

**Expected result:** GCP SA has roles for Secret Manager, GCS, and Cloud SQL access.

### Step 5.3 — Verify Secret Injection

```bash
POD=$(kubectl get pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "${APP_NS}" "${POD}" -- \
  env | grep -E "JWT_SECRET|APP_KEYS|API_TOKEN" | head -5
```

**Expected result:** Strapi cryptographic secrets injected as environment variables from Secret Manager.

### Step 5.4 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~strapi" \
  --format="table(name,createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:strapi" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name}'
```

**Expected result:** Five Strapi secrets (APP_KEYS, JWT_SECRET, ADMIN_JWT_SECRET, API_TOKEN_SALT, TRANSFER_TOKEN_SALT) plus DB_PASSWORD.

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

Query Cloud Logging for Strapi pod logs, inspect JSON log entries, and filter by request path and severity.

### Step 6.1 — View Recent Pod Logs

**kubectl:**
```bash
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  --tail=30
```

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name=\"strapi\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

### Step 6.2 — Filter API Request Logs

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND textPayload:\"/api/products\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {timestamp, message: .textPayload}'
```

**Expected result:** Log entries showing the `/api/products` requests made in Exercise 3.

### Step 6.3 — View db-init Job Logs

```bash
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/component=db-init" \
  --tail=30

gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name~\"db-init\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

### Step 6.4 — Query Logs by Severity

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND severity>=\"WARNING\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {timestamp, severity, message: (.jsonPayload.message // .textPayload)}'
```

### Step 6.5 — GKE Audit Logs

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"protoPayload.serviceName=container.googleapis.com AND protoPayload.methodName=~\\\"Deployment\\\" AND protoPayload.resourceName~\\\"${APP_NS}\\\"\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 5
  }" | jq '.entries[] | {timestamp, method: .protoPayload.methodName}'
```

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Review Cloud Monitoring metrics for GKE workloads, trigger HPA scaling, and observe pod autoscaling behavior.

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
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${APP_NS}' | filter resource.container_name = 'strapi' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

### Step 7.2 — Check HPA Status

```bash
kubectl get hpa -n "${APP_NS}" -o wide

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

### Step 7.3 — Trigger Scaling with Load

```bash
for i in $(seq 1 50); do
  curl -s "${SERVICE_URL}/api/products" \
    -H "Authorization: Bearer ${STRAPI_TOKEN}" > /dev/null &
done
wait

kubectl get hpa -n "${APP_NS}" -w &
HPA_PID=$!
sleep 30
kill ${HPA_PID} 2>/dev/null

kubectl get pods -n "${APP_NS}" -o wide
```

**Expected result:** HPA scales to additional replicas when CPU threshold is exceeded.

### Step 7.4 — View Uptime Check

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

### Step 7.5 — Scale Deployment Manually

```bash
kubectl scale deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  --replicas=2

kubectl rollout status deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi"

kubectl get pods -n "${APP_NS}" -o wide

kubectl scale deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=strapi" \
  --replicas=1
```

**Expected result:** Deployment scales to 2 then back to 1 replica.

### Step 7.6 — Open Monitoring Dashboards

```bash
echo "GKE Workload Dashboard:"
echo "https://console.cloud.google.com/kubernetes/workload_/goog-k8s-cluster-name=${CLUSTER_NAME}?project=${PROJECT}"

echo "Cloud Monitoring:"
echo "https://console.cloud.google.com/monitoring/dashboards?project=${PROJECT}"
```

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Strapi_GKE` deployment. This removes the GKE workloads, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${APP_NS}" --grace-period=30
```

**gcloud:**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~strapi" \
  --format="value(name)" --limit=1)
gcloud sql instances delete "${INSTANCE}" --project="${PROJECT}" --quiet

gcloud secrets list --project="${PROJECT}" --filter="name~strapi" \
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
| `application_name` | string | `strapi` | Base resource and workload name |
| `application_version` | string | `5.0.0` | Strapi container image tag |
| `container_port` | number | `1337` | Strapi default port |
| `min_instance_count` | number | `1` | Minimum pod replicas |
| `max_instance_count` | number | `10` | Maximum pod replicas (HPA) |
| `enable_nfs` | bool | `true` | Cloud Filestore NFS PersistentVolume |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS container mount path |
| `application_database_name` | string | `strapi` | PostgreSQL database name |
| `application_database_user` | string | `strapi` | PostgreSQL database user |
| `enable_redis` | bool | `false` | Redis session cache |
| `redis_host` | string | `""` | Redis host (empty = NFS server IP) |
| `redis_port` | string | `6379` | Redis TCP port |
| `database_type` | string | `POSTGRES` | Cloud SQL PostgreSQL version |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron |
| `backup_retention_days` | number | `7` | Backup retention days |

### Useful Commands Reference

```bash
# Get external IP
kubectl get service -n "${APP_NS}" -o wide

# Get all pods
kubectl get pods -n "${APP_NS}" -o wide

# View Strapi logs
kubectl logs -n "${APP_NS}" -l app.kubernetes.io/name=strapi --tail=50

# View HPA
kubectl get hpa -n "${APP_NS}"

# Scale deployment
kubectl scale deployment -n "${APP_NS}" -l app.kubernetes.io/name=strapi --replicas=2

# Execute in pod
POD=$(kubectl get pod -n "${APP_NS}" -l app.kubernetes.io/name=strapi -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "${APP_NS}" "${POD}" -- env | grep DB_

# Check Workload Identity
kubectl describe serviceaccount -n "${APP_NS}" | grep iam.gke.io

# View resource usage
kubectl top pods -n "${APP_NS}"
```

### Further Reading

- [Strapi Documentation](https://docs.strapi.io/)
- [Strapi REST API Reference](https://docs.strapi.io/dev-docs/api/rest)
- [Strapi GraphQL API](https://docs.strapi.io/dev-docs/api/graphql)
- [GKE Autopilot Overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud Filestore for GKE](https://cloud.google.com/filestore/docs/accessing-fileshares)
- [Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
