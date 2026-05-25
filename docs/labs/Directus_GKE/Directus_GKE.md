---
title: "Directus on GKE — Lab Guide"
sidebar_label: "Directus GKE"
---

# Directus on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Directus_GKE)**

This lab guide walks you through deploying, exploring, and operating **Directus** — an open-source headless CMS and Backend-as-a-Service platform — on Google Kubernetes Engine Autopilot using the **Directus_GKE** module. You will work with kubectl, Kubernetes workloads, Workload Identity, Directus REST and GraphQL APIs, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Directus Studio](#exercise-1--access-directus-studio)
6. [Exercise 2 — Data Modeling](#exercise-2--data-modeling)
7. [Exercise 3 — REST and GraphQL APIs](#exercise-3--rest-and-graphql-apis)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Workload Identity and Security](#exercise-5--workload-identity-and-security)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is Directus?

Directus is an open-source **composable data platform** and Backend-as-a-Service that wraps any SQL database with auto-generated REST and GraphQL APIs and a no-code Data Studio — without modifying your schema. With 34,500+ GitHub stars and customers including Tripadvisor, Adobe, and Mercedes-Benz, Directus is among the top open-source headless CMS choices in 2026. Its native MCP server support (v11.13+) enables direct AI tool integration.

The `Directus_GKE` module deploys Directus on GKE Autopilot with Cloud SQL PostgreSQL (Auth Proxy socket), Cloud Filestore NFS for shared uploads, GCS for object storage, Redis caching, and Workload Identity for secure GCP service access.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Serverless Kubernetes with automatic node provisioning and security hardening |
| **Workload Identity** | Kubernetes pods access GCP services without service account key files |
| **NFS Persistent Storage** | Cloud Filestore NFS shared across all Directus pods |
| **Cloud SQL Auth Proxy** | Encrypted database connectivity via Unix socket sidecar |
| **Directus Studio** | No-code data modeling, content editing, file management |
| **REST and GraphQL APIs** | Auto-generated API surface from database schema |
| **Cloud Logging** | Structured JSON pod logs forwarded to Cloud Logging |
| **HPA Scaling** | Horizontal Pod Autoscaler scales Directus under load |

---

## 2. Architecture

```
Browser / API Client
       │
       ▼
LoadBalancer Service (external IP)
       │  port 80 → 8055
       ▼
Directus Pod (GKE Autopilot namespace)
  ├── directus container (port 8055)
  │     NFS mount: /mnt/nfs (shared uploads)
  │     GCS Fuse: directus-uploads bucket
  │
  └── cloud-sql-proxy sidecar (Unix socket /cloudsql)
        │
        ▼  (Cloud SQL Auth Proxy)
Cloud SQL PostgreSQL 15 (private IP)
  DB: directus / user: directus

Supporting infrastructure:
  ┌──────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
  │  Cloud Filestore NFS │  │  Secret Manager   │  │  Artifact        │
  │  /mnt/nfs            │  │  KEY, SECRET,     │  │  Registry        │
  │  shared uploads      │  │  ADMIN_PASSWORD,  │  │  Custom Directus │
  │  across all pods     │  │  REDIS, DB_PASS   │  │  image           │
  └──────────────────────┘  └───────────────────┘  └──────────────────┘

  ┌──────────────────────┐  ┌───────────────────┐
  │  Cloud Logging       │  │  Cloud Monitoring  │
  │  pod logs, audit     │  │  metrics, HPA,     │
  │  logs, requests      │  │  uptime checks     │
  └──────────────────────┘  └───────────────────┘

Module variable wiring:
  Directus_GKE
    application_version    = "11.1.0"   → Directus container image tag
    container_port         = 8055       → Kubernetes Service target port
    enable_cloudsql_volume = true       → Auth Proxy sidecar + Unix socket
    enable_nfs             = true       → Filestore NFS PersistentVolume
    enable_redis           = true       → Redis caching and rate limiting
    min_instance_count     = 0          → Scale-to-zero minimum
    max_instance_count     = 8          → HPA maximum replicas
    cpu_limit              = "2000m"    → 2 vCPU per pod
    memory_limit           = "2Gi"      → 2 GiB per pod
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
export APP_NS="${APP_NS:-directus}"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Directus_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `11.1.0` | Directus image tag |
| `cpu_limit` | `2000m` | Recommended for production |
| `memory_limit` | `2Gi` | Minimum recommended |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `8` | HPA maximum |
| `enable_redis` | `true` | Redis caching |
| `enable_nfs` | `true` | NFS for shared uploads |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar |

Click **Deploy** and wait for provisioning to complete (approximately 25–45 minutes).

> **What this provisions:** GKE Autopilot cluster (or targets an existing one), Cloud SQL PostgreSQL 15 instance, Cloud Filestore NFS volume, GCS uploads bucket, Artifact Registry with custom Directus image built via Cloud Build, Secret Manager secrets, Kubernetes namespace, Deployment, Service, HPA, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT}"

kubectl cluster-info
kubectl get nodes
```

### 4.3 Configure kubectl for Directus Namespace

```bash
# Get the Directus namespace (may vary based on deployment config)
export APP_NS=$(kubectl get namespaces \
  --selector="app.kubernetes.io/name=directus" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "directus")

# Verify pods are running
kubectl get pods -n "${APP_NS}"

# Get the external IP for the Directus service
export DIRECTUS_IP=$(kubectl get service \
  -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Directus URL: http://${DIRECTUS_IP}"
export SERVICE_URL="http://${DIRECTUS_IP}"
```

---

## Exercise 1 — Access Directus Studio

### Objective

Retrieve the external IP of the Directus Kubernetes service, verify pod health, log in to Directus Studio, and perform the initial admin setup.

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
  --filter="name~directus" \
  --format="table(name,address,status)"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("directus")) | {name, address, status}'
```

### Step 1.2 — Verify Pods Are Running

```bash
kubectl get pods -n "${APP_NS}" -o wide

# Pods should show 2/2 READY (directus + cloud-sql-proxy sidecar)
kubectl describe pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  | grep -A5 "Containers:"
```

**Expected result:** All pods show `2/2 Running`.

### Step 1.3 — Verify the Health Endpoint

```bash
curl -s "${SERVICE_URL}/server/health" | jq .
```

**Expected result:** `{"status":"ok"}` confirming Directus is running and connected to the database.

### Step 1.4 — Log In and Obtain a Token

Retrieve the admin password from Secret Manager:

```bash
ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~directus AND name~admin-password" \
  --format="value(name)" \
  --limit=1)

export ADMIN_PASS=$(gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}")

# Obtain an access token
export DIRECTUS_TOKEN=$(curl -s -X POST "${SERVICE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"${ADMIN_PASS}\"}" \
  | jq -r '.data.access_token')

echo "Token: ${DIRECTUS_TOKEN}"
```

**Expected result:** Access token returned.

### Step 1.5 — Tour Directus Studio

Open `${SERVICE_URL}/admin` in your browser and log in. Navigate:
- **Content** — browse collections and items
- **Files** — manage media assets stored in GCS
- **Users** — manage accounts and roles
- **Settings > Data Model** — schema management
- **Settings > Roles & Permissions** — access control

---

## Exercise 2 — Data Modeling

### Objective

Create a Collection in Directus, add custom fields, and verify that the changes are reflected in the PostgreSQL database schema.

### Step 2.1 — Create a Collection via Studio

1. Navigate to **Settings > Data Model**.
2. Click **+ Create Collection** and name it `blog_posts`.
3. Enable the **Status** optional field.
4. Click **Finish Setup**.

### Step 2.2 — Add Fields

Add the following fields to `blog_posts`:

| Field | Interface | Type |
|---|---|---|
| `title` | Input | String |
| `content` | WYSIWYG | Text |
| `published_at` | DateTime | Timestamp |
| `slug` | Input | String |

**REST API (verify collection):**
```bash
curl -s "${SERVICE_URL}/collections/blog_posts" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data | {collection, schema}'
```

### Step 2.3 — Verify Schema in the Database

```bash
# List Cloud SQL instances
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~directus" \
  --format="value(name)" \
  --limit=1)

gcloud sql databases list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"
```

**kubectl (exec into pod to check schema):**
```bash
POD=$(kubectl get pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "${APP_NS}" "${POD}" -c directus -- \
  npx directus schema snapshot /tmp/schema-snapshot.yaml 2>/dev/null
kubectl exec -n "${APP_NS}" "${POD}" -c directus -- \
  grep "blog_posts" /tmp/schema-snapshot.yaml | head -5
```

**Expected result:** `blog_posts` table appears in the schema snapshot.

### Step 2.4 — Configure Permissions

**REST API:**
```bash
PUBLIC_ROLE=$(curl -s "${SERVICE_URL}/roles?filter[name][_eq]=Public" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq -r '.data[0].id')

curl -s -X POST "${SERVICE_URL}/permissions" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"role\": \"${PUBLIC_ROLE}\",
    \"collection\": \"blog_posts\",
    \"action\": \"read\",
    \"permissions\": {\"status\": {\"_eq\": \"published\"}}
  }" | jq '.data | {id, collection, action}'
```

**Expected result:** Permission created for public read access to published blog posts.

---

## Exercise 3 — REST and GraphQL APIs

### Objective

Query the Directus REST API, explore the GraphQL interface, and manage authentication tokens for programmatic access.

### Step 3.1 — Create Content and Query via REST

```bash
# Create a blog post
curl -s -X POST "${SERVICE_URL}/items/blog_posts" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "First GKE Blog Post",
    "content": "Deployed via Directus_GKE module on GKE Autopilot.",
    "slug": "first-gke-post",
    "status": "published"
  }' | jq '.data | {id, title, status}'

# Query all published posts
curl -s "${SERVICE_URL}/items/blog_posts?filter[status][_eq]=published" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data[] | {id, title, slug}'
```

### Step 3.2 — Filter and Sort

```bash
curl -s "${SERVICE_URL}/items/blog_posts?sort=-date_created&limit=10&fields=id,title,slug,status" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data'
```

### Step 3.3 — GraphQL Query

**REST API:**
```bash
curl -s -X POST "${SERVICE_URL}/graphql" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { blog_posts(filter: {status: {_eq: \"published\"}}) { id title slug status } }"
  }' | jq '.data.blog_posts'
```

**Expected result:** GraphQL response matches the REST API result.

### Step 3.4 — OpenAPI Specification

```bash
curl -s "${SERVICE_URL}/server/specs/oas" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '{openapi, info: .info, paths: (.paths | keys | length)}'
```

**Expected result:** OpenAPI 3.0 spec with auto-generated paths including `/items/blog_posts`.

### Step 3.5 — Create a Static Access Token

```bash
curl -s -X POST "${SERVICE_URL}/auth/access-tokens" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "gke-lab-token"}' \
  | jq '.data | {id, name, token}'
```

**Expected result:** Static token created for long-lived programmatic access.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Explore the GKE Deployment, Service, and PersistentVolume resources backing Directus, and inspect the NFS mount and Cloud SQL Auth Proxy sidecar configuration.

### Step 4.1 — Inspect the Deployment

```bash
kubectl describe deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus"

# List containers per pod
kubectl get deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  -o jsonpath='{.items[0].spec.template.spec.containers[*].name}' \
  | tr ' ' '\n'
```

**Expected result:** Two containers per pod: `directus` and `cloud-sql-proxy`.

### Step 4.2 — Inspect the NFS PersistentVolume

```bash
kubectl get pv | grep -i directus

kubectl get pvc -n "${APP_NS}"

kubectl describe pvc -n "${APP_NS}" \
  | grep -E "Capacity|Access|StorageClass|Volume"
```

**Expected result:** A PVC bound to a Cloud Filestore NFS PersistentVolume with `ReadWriteMany` access mode.

### Step 4.3 — Verify NFS Mount from Inside a Pod

```bash
POD=$(kubectl get pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "${APP_NS}" "${POD}" -c directus -- \
  df -h /mnt/nfs

kubectl exec -n "${APP_NS}" "${POD}" -c directus -- \
  ls -la /mnt/nfs/
```

**Expected result:** NFS share mounted at `/mnt/nfs` and writable by the Directus process.

### Step 4.4 — Inspect the Cloud SQL Auth Proxy Sidecar

```bash
kubectl logs -n "${APP_NS}" "${POD}" -c cloud-sql-proxy --tail=20

kubectl exec -n "${APP_NS}" "${POD}" -c directus -- \
  ls -la /cloudsql/
```

**Expected result:** Auth Proxy logs show a successful connection; socket file appears under `/cloudsql/`.

### Step 4.5 — Check the Horizontal Pod Autoscaler

```bash
kubectl get hpa -n "${APP_NS}"

kubectl describe hpa -n "${APP_NS}" \
  | grep -E "Name|Namespace|Metrics|Min|Max|Replicas"
```

**Expected result:** HPA configured with CPU-based scaling, min 0, max 8 replicas.

---

## Exercise 5 — Workload Identity and Security

### Objective

Verify that Directus pods use Workload Identity to access GCP services without key files, and inspect the GKE cluster security configuration.

### Step 5.1 — Inspect the Kubernetes Service Account

```bash
kubectl get serviceaccounts -n "${APP_NS}"

kubectl describe serviceaccount -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  | grep -A3 "Annotations:"
```

**Expected result:** Service account has annotation `iam.gke.io/gcp-service-account` pointing to a GCP service account.

### Step 5.2 — Verify GCP Service Account IAM Binding

```bash
GCP_SA=$(kubectl get serviceaccount -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
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

**Expected result:** GCP SA has roles for Secret Manager access, GCS object admin, and Cloud SQL client.

### Step 5.3 — Test Secret Access from Inside the Pod

```bash
POD=$(kubectl get pod -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "${APP_NS}" "${POD}" -c directus -- \
  env | grep -E "^KEY=|^SECRET=|ADMIN_EMAIL"
```

**Expected result:** KEY and SECRET environment variables present, injected from Secret Manager.

### Step 5.4 — Review GKE Cluster Security Configuration

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

**Expected result:** Workload Identity enabled (`workloadPool` set to `${PROJECT}.svc.id.goog`).

### Step 5.5 — Inspect Network Policies

```bash
kubectl get networkpolicies -n "${APP_NS}"

kubectl describe networkpolicy -n "${APP_NS}" \
  | grep -E "Name|PodSelector|Ingress|Egress" | head -20
```

**Expected result:** Network policies restricting traffic to necessary paths only.

---

## Exercise 6 — Cloud Logging

### Objective

Query Cloud Logging for Directus pod logs, inspect structured JSON log entries, and filter by severity and content.

### Step 6.1 — View Recent Pod Logs

**kubectl:**
```bash
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  --tail=30 -c directus
```

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name=\"directus\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,severity,jsonPayload.message)"
```

### Step 6.2 — Filter HTTP Request Logs

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name=\"directus\" \
   AND jsonPayload.url:\"/items/\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {timestamp, url: .jsonPayload.url, method: .jsonPayload.method, status: .jsonPayload.status}'
```

**Expected result:** JSON log entries for Directus API requests.

### Step 6.3 — View Cloud SQL Proxy Logs

```bash
kubectl logs -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  --tail=20 -c cloud-sql-proxy

gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${APP_NS}\" \
   AND resource.labels.container_name=\"cloud-sql-proxy\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,severity,textPayload)"
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
  | jq '.[] | {timestamp, severity, container: .resource.labels.container_name, message: (.jsonPayload.message // .textPayload)}'
```

### Step 6.5 — View GKE Audit Logs

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"protoPayload.serviceName=container.googleapis.com AND protoPayload.methodName=~\\\"Deployment\\\"\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 5
  }" | jq '.entries[] | {timestamp, method: .protoPayload.methodName, principal: .protoPayload.authenticationInfo.principalEmail}'
```

**Expected result:** GKE audit log entries showing Kubernetes API server calls.

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Review Cloud Monitoring metrics for GKE workloads, observe HPA scaling behavior, and explore the GKE workload monitoring dashboard.

### Step 7.1 — View Container CPU and Memory Metrics

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${APP_NS}' | filter resource.container_name = 'directus' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, cpu_utilization: .pointData[-1].values[0].doubleValue}'
```

**kubectl:**
```bash
kubectl top pods -n "${APP_NS}"
kubectl top nodes
```

**Expected result:** CPU and memory utilization per pod and node.

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
  --limit=5 \
  --format="table(metricDescriptor.type)"
```

### Step 7.3 — Trigger Auto-Scaling

Generate load to observe HPA scaling:

```bash
for i in $(seq 1 50); do
  curl -s "${SERVICE_URL}/items/blog_posts?limit=10" \
    -H "Authorization: Bearer ${DIRECTUS_TOKEN}" > /dev/null &
done
wait

# Watch HPA scaling
kubectl get hpa -n "${APP_NS}" -w &
HPA_PID=$!
sleep 30
kill ${HPA_PID} 2>/dev/null

kubectl get pods -n "${APP_NS}"
```

**Expected result:** HPA increases replica count when CPU utilization exceeds threshold.

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

### Step 7.5 — Scale Deployment Manually

```bash
kubectl scale deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  --replicas=2

kubectl rollout status deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus"

kubectl get pods -n "${APP_NS}" -o wide

# Scale back down
kubectl scale deployment -n "${APP_NS}" \
  -l "app.kubernetes.io/name=directus" \
  --replicas=1
```

**Expected result:** Deployment scales to 2 pods, both showing 2/2 READY, then back to 1.

### Step 7.6 — Open Monitoring Dashboard

```bash
echo "https://console.cloud.google.com/kubernetes/workload_/goog-k8s-cluster-name=${CLUSTER_NAME}?project=${PROJECT}"
echo "https://console.cloud.google.com/monitoring/dashboards?project=${PROJECT}"
```

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Directus_GKE` deployment. This removes the GKE workloads, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${APP_NS}" --grace-period=30
```

**gcloud:**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~directus" \
  --format="value(name)" --limit=1)
gcloud sql instances delete "${INSTANCE}" --project="${PROJECT}" --quiet

gcloud secrets list --project="${PROJECT}" --filter="name~directus" \
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
| `application_name` | string | `directus` | Base resource and workload name |
| `application_version` | string | `11.1.0` | Directus container image tag |
| `cpu_limit` | string | `2000m` | CPU limit per pod (2 vCPU) |
| `memory_limit` | string | `2Gi` | Memory limit per pod |
| `min_instance_count` | number | `0` | Minimum pod replicas |
| `max_instance_count` | number | `8` | Maximum pod replicas (HPA) |
| `container_port` | number | `8055` | Directus default port |
| `enable_nfs` | bool | `true` | Cloud Filestore NFS PersistentVolume |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS container mount path |
| `enable_redis` | bool | `true` | Redis for caching |
| `redis_host` | string | `""` | Redis host (empty = NFS server IP) |
| `redis_port` | string | `6379` | Redis TCP port |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar |
| `db_name` | string | `directus` | PostgreSQL database name |
| `db_user` | string | `directus` | PostgreSQL database user |
| `database_type` | string | `POSTGRES_15` | Cloud SQL PostgreSQL version |
| `enable_postgres_extensions` | bool | `true` | Install uuid-ossp extension |

### Useful Commands Reference

```bash
# Get external IP
kubectl get service -n "${APP_NS}" -o wide

# Get all pods
kubectl get pods -n "${APP_NS}" -o wide

# View pod logs
kubectl logs -n "${APP_NS}" -l app.kubernetes.io/name=directus -c directus --tail=50

# View HPA status
kubectl get hpa -n "${APP_NS}"

# Scale deployment
kubectl scale deployment -n "${APP_NS}" -l app.kubernetes.io/name=directus --replicas=2

# Execute in a pod
POD=$(kubectl get pod -n "${APP_NS}" -l app.kubernetes.io/name=directus -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "${APP_NS}" "${POD}" -c directus -- env | grep KEY

# Check Workload Identity
kubectl describe serviceaccount -n "${APP_NS}" | grep iam.gke.io

# View resource usage
kubectl top pods -n "${APP_NS}"
```

### Further Reading

- [Directus Documentation](https://docs.directus.io/)
- [Directus REST API Reference](https://docs.directus.io/reference/introduction.html)
- [GKE Autopilot Overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy on GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
