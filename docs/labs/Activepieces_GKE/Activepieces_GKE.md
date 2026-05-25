---
title: "Activepieces on GKE — Lab Guide"
sidebar_label: "Activepieces GKE"
---

# Activepieces on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Activepieces_GKE)**

Activepieces is an open-source, Apache 2.0-licensed workflow automation platform — a self-hosted
alternative to Zapier and Make — with 22,000+ GitHub stars and 100,000+ active installations.
This lab deploys Activepieces on GKE Autopilot with a Cloud SQL PostgreSQL 15 backend, GCS data
storage, Workload Identity, and auto-generated encryption keys. You will access the cluster with
kubectl, set up the admin account, build and test flows, manage connections, inspect Kubernetes
workloads, and explore GCP observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Activepieces](#exercise-1--access-activepieces)
6. [Exercise 2 — Create Flows and Webhooks](#exercise-2--create-flows-and-webhooks)
7. [Exercise 3 — Connections and Integrations](#exercise-3--connections-and-integrations)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging and Monitoring](#exercise-6--cloud-logging-and-monitoring)
11. [Cleanup](#cleanup)
12. [Reference](#reference)

---

## 1. Overview

### What Is Activepieces?

Activepieces is a **no-code / low-code workflow automation platform** that connects 450+ services
via a visual drag-and-drop flow builder. The `Activepieces_GKE` module deploys Activepieces on
GKE Autopilot with a Kubernetes LoadBalancer service, Cloud SQL Auth Proxy sidecar, GCS Fuse CSI
volume, Workload Identity, and auto-generated JWT and encryption keys stored in Secret Manager.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **kubectl Access** | Cluster credentials, pod inspection, and port-forwarding |
| **Admin Setup** | First-run account creation via external IP |
| **Flow Builder** | Visual automation flows with webhooks and HTTP actions |
| **Connections** | OAuth and API key credential management |
| **Kubernetes Workloads** | Pod lifecycle, HPA scaling, Cloud SQL sidecar |
| **Workload Identity** | Pod-to-GCP resource authentication without key files |
| **GCP Observability** | Cloud Logging structured logs, Cloud Monitoring pod metrics |

---

## 2. Architecture

```
Browser / External Webhook
       │
       ▼ HTTP (LoadBalancer external IP, port 80)
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Kubernetes Namespace (appactivepieces<tenant><id>)        │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │  Activepieces Pod (2/2 READY)                       │   │  │
│  │  │  ┌───────────────────┐  ┌──────────────────────────┐ │   │ │
│  │  │  │  activepieces     │  │  cloud-sql-proxy         │ │   │ │
│  │  │  │  container        │  │  sidecar                 │ │   │ │
│  │  │  │  Node.js server   │  │  TCP 127.0.0.1:5432      │ │   │ │
│  │  │  │  AP_QUEUE_MODE=   │  │  → Cloud SQL             │ │   │ │
│  │  │  │    MEMORY         │  │                          │ │   │ │
│  │  │  └───────────────────┘  └──────────────────────────┘ │   │ │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  LoadBalancer Service :80 → Activepieces pod :8080        │   │
│  │  HPA: minReplicas=1, maxReplicas=3                        │   │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
       │                    │
       ▼                    ▼
┌─────────────────┐  ┌─────────────────────────────────────────┐
│  GCS Bucket     │  │  Cloud SQL PostgreSQL 15                │
│  ap-data        │  │  flows, runs, connections, users        │
│  (file uploads) │  │  pgvector extension installed           │
│  Workload       │  └─────────────────────────────────────────┘
│  Identity SA                                                 │
└─────────────────┘

Supporting resources:
  Secret Manager  → AP_ENCRYPTION_KEY, AP_JWT_SECRET, DB password
  Artifact Registry → custom Activepieces container image
  Cloud Build     → image build and mirroring
  Workload Identity → pod SA ↔ GCP SA binding
  Cloud Monitoring  → pod CPU/memory metrics
```

Module variable wiring:

```
Activepieces_GKE
  application_name    = "activepieces"
  cpu_limit           = "2000m"
  memory_limit        = "2Gi"
  min_instance_count  = 1           → minimum pod replicas
  max_instance_count  = 3           → HPA max replicas
  AP_QUEUE_MODE       = MEMORY      → in-process queue (default)
  AP_EXECUTION_MODE   = UNSANDBOXED → required for GKE
  AP_ENCRYPTION_KEY   → auto-generated, stored in Kubernetes Secret
  AP_JWT_SECRET       → auto-generated, stored in Kubernetes Secret
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` | Any | System package manager |
| `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
roles/logging.viewer
roles/monitoring.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"   # your GCP project ID
export REGION="us-central1"             # region you deployed into
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Activepieces_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `activepieces` | Base resource name |
| `min_instance_count` | `1` | At least 1 replica for webhooks |
| `max_instance_count` | `3` | HPA scale-out limit |
| `cpu_limit` | `2000m` | Node.js CPU limit |
| `memory_limit` | `2Gi` | Node.js memory limit |

Click **Deploy** and wait for provisioning (approximately 10–30 minutes).

> **What this provisions:** GKE Autopilot namespace and Deployment, Kubernetes LoadBalancer
> Service, HPA, Cloud SQL PostgreSQL 15 instance and database (with pgvector), Secret Manager
> secrets for encryption keys, Artifact Registry repository, Cloud Build custom image pipeline,
> Workload Identity binding, and Cloud Monitoring notification channels.

### 4.2 Configure Shell Environment

```bash
# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

echo "Cluster: ${CLUSTER}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes
```

```bash
# Discover the Activepieces namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appactivepieces" | head -1)

echo "Namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Activepieces URL: http://${EXTERNAL_IP}"
```

---

## Exercise 1 — Access Activepieces

### Objective

Verify the GKE pod is running, access the Activepieces UI via the LoadBalancer external IP,
and complete the initial admin account setup.

### Step 1.1 — Verify the Pod Is Running

```bash
kubectl get pods -n "${NAMESPACE}"
```

**Expected result:** One or more pods in `Running` status:
```
NAME                            READY   STATUS    RESTARTS   AGE
activepieces-<hash>             2/2     Running   0          5m
```

The `2/2` indicates the Activepieces Node.js container plus the Cloud SQL Auth Proxy sidecar.

### Step 1.2 — Check the LoadBalancer Service

**kubectl:**
```bash
kubectl get svc -n "${NAMESPACE}"
```

**Expected result:** A `LoadBalancer` service with an `EXTERNAL-IP` assigned.

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{status: .status, nodeCount: .currentNodeCount}'
```

### Step 1.3 — Verify the Service Responds

```bash
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}"
```

**Expected result:** `200` or `302` (redirect to setup or login page).

### Step 1.4 — Create the Admin Account

Open `http://${EXTERNAL_IP}` in a browser. On first visit, Activepieces shows the account
setup page. Fill in:
- **Full name** — your name
- **Email address** — your work email
- **Password** — a strong password

Click **Get Started**.

**Expected result:** Redirected to the Activepieces dashboard.

### Step 1.5 — Explore the Dashboard

Note the main navigation sections:
- **Flows** — list and manage automation flows
- **Connections** — OAuth and API key credentials
- **Runs** — execution history and step traces
- **Settings** — platform configuration

---

## Exercise 2 — Create Flows and Webhooks

### Objective

Build an automation flow with a Webhook trigger and HTTP action, publish it, and test the
webhook from the command line.

### Step 2.1 — Create a New Flow

In the Activepieces UI, click **New Flow** and name it `GKE Webhook Flow`.

### Step 2.2 — Add a Webhook Trigger

Click **Add Trigger** and select **Webhook**. Copy the webhook URL:
```
http://${EXTERNAL_IP}/api/v1/webhooks/<id>
```

```bash
export WEBHOOK_URL="<paste-webhook-url-here>"
```

### Step 2.3 — Add an HTTP Request Action

Click `+` after the trigger and select **HTTP Request**:
- **Method:** `GET`
- **URL:** `https://httpbin.org/json`

### Step 2.4 — Publish the Flow

Toggle the **Published** switch. Flow status changes to `Enabled`.

### Step 2.5 — Test the Webhook via curl

```bash
curl -s -X POST "${WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{"source": "gke-lab", "event": "test"}'
```

**Expected result:** HTTP `200` response from Activepieces.

**gcloud (check pod logs):**
```bash
kubectl logs -n "${NAMESPACE}" \
  deployment/activepieces --tail=20
```

### Step 2.6 — View the Run in the UI

Navigate to **Runs** and click the latest execution. Inspect:
- **Trigger payload** — the JSON body sent to the webhook
- **HTTP Response** — the response from `httpbin.org`
- **Execution timeline** — timing for each step

### Step 2.7 — Add a Schedule Trigger

Create a new flow `Scheduled Flow` with a **Schedule** trigger:
- **Cron expression:** `*/10 * * * *` (every 10 minutes)
- Add a **Log to Console** action

Publish the flow. Navigate to **Runs** after 10 minutes and verify the schedule trigger fires.

---

## Exercise 3 — Connections and Integrations

### Objective

Configure a reusable connection, use it in a flow, and verify that credentials are encrypted
in the database.

### Step 3.1 — Navigate to Connections

Click **Connections** in the left navigation.

### Step 3.2 — Browse Available Pieces

Click **New Connection** and browse the pieces catalog (450+ integrations):
- **Communication:** Slack, Gmail, Discord
- **Data:** Google Sheets, Airtable, PostgreSQL
- **AI:** OpenAI, Anthropic

### Step 3.3 — Add an API Key Connection

Select the **HTTP** piece and configure:
- **Connection name:** `lab-api-key`
- **Auth type:** `API Key`
- **Header name:** `X-Api-Key`
- **Value:** `lab-test-key-12345`

Click **Save**.

**Expected result:** Connection appears in the list with a status indicator.

### Step 3.4 — Use the Connection in a Flow

Add a second HTTP Request step to your `GKE Webhook Flow`:
- Select your `lab-api-key` connection
- URL: `https://httpbin.org/headers`

Republish and test the webhook again. The Run trace should show the `X-Api-Key` header was
sent in the request.

### Step 3.5 — Verify Secret Storage in Secret Manager

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~activepieces" \
  --format="table(name, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | select(.name | test("activepieces")) | {name: .name}'
```

**Expected result:** `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, and database password secrets.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the Activepieces Kubernetes Deployment, understand the pod structure including the
Cloud SQL Auth Proxy sidecar, check HPA configuration, and perform a rolling restart.

### Step 4.1 — Inspect the Deployment

```bash
kubectl describe deployment activepieces -n "${NAMESPACE}"
```

Key sections to review:
- **Image:** Artifact Registry custom Activepieces image
- **Containers:** `activepieces` (Node.js) + `cloud-sql-proxy` (sidecar)
- **Resource requests/limits:** CPU and memory
- **Env from:** Kubernetes Secret references

### Step 4.2 — Inspect the Pod in Detail

```bash
AP_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=activepieces \
  -o jsonpath='{.items[0].metadata.name}')

# List containers
kubectl get pod "${AP_POD}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.containers[*].name}' | tr ' ' '\n'

# Check resource usage
kubectl top pod "${AP_POD}" -n "${NAMESPACE}"
```

**Expected result:** Two containers: `activepieces` and `cloud-sql-proxy`.

### Step 4.3 — Inspect the Cloud SQL Proxy Sidecar

```bash
kubectl logs "${AP_POD}" -n "${NAMESPACE}" -c cloud-sql-proxy --tail=20
```

**Expected result:** Cloud SQL Auth Proxy listening on `127.0.0.1:5432` and connected to
the Cloud SQL instance.

### Step 4.4 — Check HPA Status

**kubectl:**
```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.nodeConfig | {machineType, diskSizeGb}'
```

**Expected result:** HPA showing `MINPODS=1`, `MAXPODS=3`, `REPLICAS=1`.

### Step 4.5 — Perform a Rolling Restart

```bash
kubectl rollout restart deployment/activepieces -n "${NAMESPACE}"
kubectl rollout status deployment/activepieces -n "${NAMESPACE}" --timeout=180s
```

**Expected result:** Deployment rolls to a new pod. The webhook URL continues to work
throughout the restart due to the LoadBalancer session affinity.

---

## Exercise 5 — Security and Workload Identity

### Objective

Verify Workload Identity bindings between the Kubernetes service account and the GCP
service account, and inspect Kubernetes Secrets for injected credentials.

### Step 5.1 — List Service Accounts

```bash
kubectl get serviceaccounts -n "${NAMESPACE}"
```

**Expected result:** Service account for the Activepieces workload.

### Step 5.2 — Check Workload Identity Annotation

```bash
kubectl get serviceaccount -n "${NAMESPACE}" \
  -o yaml | grep -A3 "iam.gke.io"
```

**Expected result:** `iam.gke.io/gcp-service-account` annotation pointing to a GCP SA.

### Step 5.3 — Verify GCP Service Account IAM Binding

**gcloud:**
```bash
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~activepieces OR email~appactivepieces" \
  --format="table(email, displayName)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.accounts[] | select(.email | test("activepieces")) | {email: .email}'
```

**Expected result:** A service account for the Activepieces workload.

### Step 5.4 — Inspect Kubernetes Secrets

```bash
kubectl get secrets -n "${NAMESPACE}"
```

```bash
# List secret names (not values)
kubectl get secrets -n "${NAMESPACE}" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'
```

**Expected result:** Kubernetes secrets containing `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`,
and database credentials — injected directly from Secret Manager values at deployment.

### Step 5.5 — Verify Cloud SQL Access via Workload Identity

```bash
# Check that the pod can reach Cloud SQL via the proxy sidecar
kubectl exec -n "${NAMESPACE}" "${AP_POD}" -c activepieces -- \
  sh -c 'nc -zv 127.0.0.1 5432 && echo "Cloud SQL proxy reachable"'
```

**Expected result:** `Cloud SQL proxy reachable` — confirms the sidecar is forwarding to Cloud SQL.

---

## Exercise 6 — Cloud Logging and Monitoring

### Objective

View Activepieces logs in Cloud Logging and review pod-level resource metrics in Cloud
Monitoring.

### Step 6.1 — View Logs in Cloud Logging Console

Navigate to:
```
https://console.cloud.google.com/logs/query?project=${PROJECT}
```

Filter for Activepieces pod logs:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="activepieces"
```

**Expected result:** Node.js startup messages, webhook receipts, and flow execution events.

### Step 6.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'"' \
  --project="${PROJECT}" \
  --limit=20 \
  --format=json \
  | jq '.[].textPayload // .[].jsonPayload'
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "orderBy": "timestamp desc",
    "pageSize": 20
  }' | jq '.entries[] | {timestamp, payload: (.jsonPayload // .textPayload)}'
```

### Step 6.3 — Filter for Error Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND severity>=ERROR' \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** Any error-level entries from the Activepieces or Cloud SQL proxy containers.

### Step 6.4 — View Cloud Monitoring Metrics

Navigate to:
```
https://console.cloud.google.com/monitoring?project=${PROJECT}
```

In **Metrics Explorer**, query:
- `kubernetes.io/container/cpu/request_utilization` — CPU vs request (Node.js: 5–30%)
- `kubernetes.io/container/memory/request_utilization` — memory vs request
- `kubernetes.io/pod/network/received_bytes_count` — inbound network traffic

Filter by `resource.namespace_name = "${NAMESPACE}"` and `resource.pod_name =~ activepieces.*`.

**gcloud:**
```bash
gcloud monitoring time-series list \
  --project="${PROJECT}" \
  --filter='metric.type="kubernetes.io/container/cpu/core_usage_time" AND resource.label.namespace_name="'"${NAMESPACE}"'"'
```

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch k8s_container::kubernetes.io/container/memory/limit_utilization | filter resource.namespace_name = \"'"${NAMESPACE}"'\" | within 30m | group_by [resource.container_name], mean(val())"
  }' | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, utilization: .pointData[-1].values[0].doubleValue}'
```

### Step 6.5 — Check HPA Scaling Activity

```bash
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA status with current replica count and scaling thresholds. With
memory queue mode and low traffic, the replica count stays at 1.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Activepieces_GKE` deployment. This
removes the Kubernetes workloads, Cloud SQL instance, Secret Manager secrets, GCS bucket,
Artifact Registry images, Workload Identity bindings, and all supporting IAM resources.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Cloud SQL instance
INSTANCE=$(gcloud sql instances list --project="${PROJECT}" \
  --filter="name~activepieces" --format="value(name)" --limit=1)
gcloud sql instances delete "${INSTANCE}" --project="${PROJECT}" --quiet

# Delete GCS bucket
BUCKET=$(gcloud storage buckets list --project="${PROJECT}" \
  --filter="name~activepieces" --format="value(name)" | head -1)
gcloud storage rm -r "gs://${BUCKET}/"

# Delete secrets
gcloud secrets list --project="${PROJECT}" --filter="name~activepieces" \
  --format="value(name)" | \
  xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region |
| `application_name` | string | `activepieces` | Base name for Kubernetes resources |
| `application_version` | string | `latest` | Container image version tag |
| `gke_cluster_name` | string | `""` | GKE cluster name (auto-discovered if empty) |
| `cpu_limit` | string | `2000m` | CPU limit per pod |
| `memory_limit` | string | `2Gi` | Memory limit per pod |
| `min_instance_count` | number | `1` | Minimum pod replicas |
| `max_instance_count` | number | `3` | Maximum pod replicas (HPA) |
| `enable_redis` | bool | `false` | Enable Redis queue for horizontal scaling |
| `redis_host` | string | `""` | Redis hostname |
| `redis_port` | number | `6379` | Redis TCP port |
| `db_name` | string | `activepieces` | PostgreSQL database name |
| `db_user` | string | `activepieces` | PostgreSQL user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron (UTC) |

### Key Environment Variables (Auto-Injected)

| Variable | Value | Purpose |
|---|---|---|
| `AP_DB_TYPE` | `POSTGRES` | Use PostgreSQL backend |
| `AP_PORT` | `8080` | HTTP port |
| `AP_QUEUE_MODE` | `MEMORY` | In-process queue (default) |
| `AP_EXECUTION_MODE` | `UNSANDBOXED` | Required for GKE |
| `AP_ENVIRONMENT` | `production` | Activepieces run mode |
| `AP_TELEMETRY_ENABLED` | `false` | Disable telemetry |
| `AP_ENCRYPTION_KEY` | auto-generated | Credential encryption key |
| `AP_JWT_SECRET` | auto-generated | JWT signing secret |

### Useful Commands

```bash
# Get external IP
kubectl get svc -n "${NAMESPACE}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Check pod health
kubectl get pods -n "${NAMESPACE}"

# View application logs
kubectl logs deployment/activepieces -n "${NAMESPACE}" --tail=50

# View Cloud SQL proxy logs
kubectl logs "${AP_POD}" -n "${NAMESPACE}" -c cloud-sql-proxy --tail=20

# Trigger a webhook
curl -X POST "${WEBHOOK_URL}" -H "Content-Type: application/json" -d '{"key": "value"}'

# Rolling restart
kubectl rollout restart deployment/activepieces -n "${NAMESPACE}"

# View GKE logs
gcloud logging read 'resource.type="k8s_container"' --project="${PROJECT}" --limit=20

# HPA status
kubectl describe hpa -n "${NAMESPACE}"
```

### Further Reading

- [Activepieces documentation](https://www.activepieces.com/docs)
- [Activepieces pieces catalog](https://www.activepieces.com/pieces)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy for GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Horizontal Pod Autoscaler](https://cloud.google.com/kubernetes-engine/docs/concepts/horizontalpodautoscaler)
