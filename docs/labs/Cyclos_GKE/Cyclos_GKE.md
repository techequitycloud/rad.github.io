---
title: "Cyclos on GKE — Lab Guide"
sidebar_label: "Cyclos GKE"
---

# Cyclos on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cyclos_GKE)**

This lab guide walks you through deploying, exploring, and operating **Cyclos Community Edition**
on Google Kubernetes Engine Autopilot with the **Cyclos_GKE** module. You will explore a
production-grade digital banking platform on Kubernetes, including Workload Identity, Horizontal
Pod Autoscaling, payment channel configuration, user management, transaction processing, and
Google Cloud observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Cyclos](#exercise-1--access-cyclos)
6. [Exercise 2 — User Management and Payment Channels](#exercise-2--user-management-and-payment-channels)
7. [Exercise 3 — Transactions and API](#exercise-3--transactions-and-api)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is Cyclos?

Cyclos is open-source banking and payment software powering 1,500+ payment systems worldwide,
particularly in developing economies and community currency initiatives. It enables financial
inclusion for microfinance institutions, local banks, barter networks, and remittance operators,
providing mobile-first online banking, POS integration, QR payments, and marketplace tools.
The `Cyclos_GKE` module deploys **Cyclos Community Edition v4.16.17** on GKE Autopilot, backed
by Cloud SQL PostgreSQL 15, Workload Identity for keyless GCP access, and a LoadBalancer Service
with optional static external IP.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Managed Kubernetes with automatic node provisioning and security hardening |
| **Workload Identity** | Keyless GCP service access binding Kubernetes SA to GCP SA |
| **Private Database** | Cloud SQL PostgreSQL 15 with private IP (TCP connection from pods) |
| **HPA** | Horizontal Pod Autoscaler for Cyclos replica scaling |
| **Payment Channels** | Web, Mobile, POS, and REST API channels with transfer types and fees |
| **Secret Management** | DB credentials in Secret Manager, injected into pods at runtime |
| **GCS File Storage** | Uploaded files stored in Cloud Storage via GCS content manager |
| **Observability** | Cloud Logging (container logs) and Cloud Monitoring (GKE workload metrics) |

---

## 2. Architecture

```
Browser / Mobile App / REST Client
         │
         ▼
LoadBalancer Service (cyclos, port 8080)
  └── static external IP (reserved)
         │
         ▼
GKE Autopilot Pod (cyclos)
  ├── Cyclos 4.16.17 (Apache Tomcat + Java)
  ├── Startup probe: HTTP /api, 90s delay
  ├── Liveness probe: HTTP /api, 120s delay
  └── Workload Identity (GCP SA binding)
         │
         ├── Cloud SQL PostgreSQL 15 (TCP private IP)
         │     └── database: cyclos, user: cyclos
         │         extensions: pg_trgm, uuid-ossp,
         │                     postgis, earthdistance
         │
         ├── Cloud Storage bucket (cyclos-storage)
         │     └── Uploaded files via GCS content manager
         │
         └── Secret Manager
               └── DB password (injected via K8s secret)
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  GKE Autopilot Cluster                                    │   │
│  │                                                           │   │
│  │  ┌───────────────────────────────────────────────────┐   │   │
│  │  │  appcyclos<tenant><id> namespace                   │   │   │
│  │  │  ┌────────────────────────────────────────────┐   │   │   │
│  │  │  │  Deployment: cyclos                         │   │   │   │
│  │  │  │  replicas: 1 (HPA: 1–1 default)             │   │   │   │
│  │  │  │  ServiceAccount: cyclos (Workload Identity)  │   │   │   │
│  │  │  └────────────────────────────────────────────┘   │   │   │
│  │  │  ┌────────────────────────────────────────────┐   │   │   │
│  │  │  │  Service: cyclos (LoadBalancer, port 8080)  │   │   │   │
│  │  │  │  static external IP reserved                │   │   │   │
│  │  │  └────────────────────────────────────────────┘   │   │   │
│  │  │  ┌────────────────────────────────────────────┐   │   │   │
│  │  │  │  Job: cyclos-db-init (completed)            │   │   │   │
│  │  │  │  HPA: cyclos (min=1, max=1)                  │   │   │   │
│  │  │  └────────────────────────────────────────────┘   │   │   │
│  │  └───────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  Cloud SQL        │  │  Secret Manager  │  │  Cloud        │  │
│  │  PostgreSQL 15    │  │  (db password)   │  │  Storage      │  │
│  │  (private IP)     │  │                  │  │  (cyclos-     │  │
│  │                   │  │                  │  │   storage)    │  │
│  └──────────────────┘  └──────────────────┘  └───────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Cloud Logging   │  │  Cloud Monitoring (GKE workload       │  │
│  │  (k8s_container) │  │   metrics, uptime check, alerts)      │  │
│  └──────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Cyclos_GKE
    application_version     = "4.16.17"  → cyclos/cyclos:4.16.17
    min_instance_count      = 1          → HPA minimum replicas
    max_instance_count      = 1          → single-instance (standalone)
    container_resources     = { cpu_limit = "2000m", memory_limit = "4Gi" }
    enable_nfs              = false      → GCS file storage
    reserve_static_ip       = true       → static external IP
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
roles/container.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/iam.serviceAccountAdmin
roles/monitoring.admin
roles/logging.admin
roles/storage.admin
```

### Environment Variables

```bash
export PROJECT="${PROJECT_ID}"   # your GCP project ID
export REGION="us-central1"      # region you deployed into

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

# Discover the Cyclos namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appcyclos" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~cyclos" \
  --format="value(name)" \
  --limit=1)
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Cyclos_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `cyclos` | Base name for K8s resources |
| `application_version` | `4.16.17` | Cyclos image tag |
| `min_instance_count` | `1` | Minimum HPA replicas |
| `max_instance_count` | `1` | Maximum replicas (standalone mode) |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | Java needs 2+ vCPU |
| `db_name` | `cyclos` | PostgreSQL database name |
| `db_user` | `cyclos` | PostgreSQL user |
| `enable_nfs` | `false` | Uses GCS storage instead |
| `reserve_static_ip` | `true` | Reserve static external IP |

Click **Deploy** and wait for provisioning to complete (approximately 12–20 minutes).

> **What this provisions:** GKE namespace and workloads, Cloud SQL PostgreSQL 15, db-init job
> for extensions, LoadBalancer Service with static IP, Secret Manager credential, GCS bucket
> for file storage, Workload Identity IAM bindings, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
# Configure kubectl access
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes
```

### 4.3 Configure kubectl

```bash
# Discover namespace after deployment
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appcyclos" | head -1)
echo "Namespace: ${NAMESPACE}"

# Verify pods are running
kubectl get pods -n "${NAMESPACE}"

# Get external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "Cyclos URL: http://${EXTERNAL_IP}:8080/cyclos"
```

---

## Exercise 1 — Access Cyclos

### Objective

Use kubectl to find the external IP, verify the Cyclos pod is running, complete the initial
configuration wizard, and explore the admin panel.

### Step 1.1 — Verify Pods and Get External IP

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"
# Expected: cyclos-xxxxxxxxx-xxxxx  1/1  Running

kubectl get svc -n "${NAMESPACE}"
# Copy the EXTERNAL-IP value

kubectl get jobs -n "${NAMESPACE}"
# db-init job should show Completed
```

**gcloud:**
```bash
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="name~cyclos"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("cyclos")) | {name, address, status}'
```

**Expected result:** One pod in `Running` state with `1/1` containers ready. The service shows a public external IP.

### Step 1.2 — Check Pod Readiness

```bash
# Monitor pod until running
kubectl get pods -n "${NAMESPACE}" -w

# View startup logs
kubectl logs -n "${NAMESPACE}" -l app=cyclos --tail=50
```

Allow 2–5 minutes for first-boot schema creation (startup probe allows up to ~8 minutes).

**Expected result:** Logs show Tomcat startup, database schema creation, and Cyclos initialization messages. The pod transitions to `Running` and `1/1` ready.

### Step 1.3 — Retrieve Admin Credentials

```bash
# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~cyclos"

# Access the database password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq -r '.payload.data' | base64 -d
```

Default Cyclos admin credentials: `admin` / `1234` (change immediately after login).

### Step 1.4 — Log In and Complete Setup Wizard

1. Open `http://${EXTERNAL_IP}:8080/cyclos` in your browser.
2. Log in with `admin` / `1234`.
3. Accept the licence agreement.
4. Set the **Network name**, administrator email, and change the default password.
5. Configure **Time zone** and **Language**, then click **Finish**.

**Expected result:** The Cyclos admin dashboard loads with System, Users, and Products navigation.

### Step 1.5 — Explore the Admin Panel Structure

1. Navigate to **System > Channels** — verify Web, Mobile App, POS, REST API, and WebServices are present.
2. Navigate to **System > Account types** — review Member Account and System Account.
3. Navigate to **System > Currencies** — note the default currency symbol and settings.

**Expected result:** All default Cyclos configuration is in place and accessible from the admin panel.

---

## Exercise 2 — User Management and Payment Channels

### Objective

Create users, assign groups and accounts, configure payment channels, and explore the Cyclos
currency and transfer type model.

### Step 2.1 — Create Test Users

1. Navigate to **Users > Search users > New user**.
2. Create `testuser1`: Name `Test User One`, email `testuser1@example.com`.
3. Create `testuser2`: Name `Test User Two`, email `testuser2@example.com`.
4. Assign both to the **Members** group.
5. Create Member accounts for each with initial credits: `testuser1 = 100.00`, `testuser2 = 50.00`.

**Expected result:** Both users appear in the user list with Member accounts and configured balances.

### Step 2.2 — Review User Group Permissions

1. Navigate to **System > User groups > Members**.
2. Review the permission matrix: payment visibility, account access, and channel restrictions.
3. Navigate to **System > Transfer types** and review which transfer types are available to Members.

**Expected result:** Members can perform member-to-member payments on the Web and REST API channels.

### Step 2.3 — Configure Payment Channel Settings

1. Navigate to **System > Channels > Web**.
2. Edit: set **Session timeout** to 60 minutes; review **Allowed payment types**.
3. Navigate to **System > Channels > REST API**.
4. Review the API base URL and **Access clients** for token authentication.

**Expected result:** Web channel timeout updated. REST API channel shows the `/api` endpoint for programmatic access.

### Step 2.4 — Review Transfer Types and Fees

1. Navigate to **System > Transfer types**.
2. Click on a member-to-member transfer type.
3. Review: From/To account types, available channels, and the **Fees** tab.
4. Review **Limits**: minimum and maximum payment amounts.

**Expected result:** Transfer type is configured for Web and REST API channels with optional fee structures.

### Step 2.5 — Inspect Deployment Environment

```bash
# View environment variables injected into the Cyclos pod
kubectl exec -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=cyclos -o jsonpath='{.items[0].metadata.name}')" \
  -- env | grep -E "^DB_|^cyclos\."
```

**Expected result:** `DB_HOST` shows the Cloud SQL private IP, `DB_NAME=cyclos`, `DB_USER=cyclos`, and `cyclos.storedFileContentManager=gcs` are set.

---

## Exercise 3 — Transactions and API

### Objective

Perform payments between users, view transaction history, access Cyclos via the REST API,
and make payment API calls programmatically.

### Step 3.1 — Create a Payment via UI

1. Open `testuser1` profile and click **Make payment**.
2. Set recipient to `testuser2`, amount `25.00`, description `Lab payment`.
3. Submit and confirm.
4. Verify: testuser1 balance = 75.00, testuser2 balance = 75.00.

**Expected result:** Payment processed; both account balances updated.

### Step 3.2 — View Transaction History

1. Open **Users > testuser1 > Accounts > Member account**.
2. Review the transaction listing showing the 25.00 debit.
3. Open testuser2's account and verify the 25.00 credit with matching timestamp.

**Expected result:** Transaction history is consistent across both accounts.

### Step 3.3 — Access the REST API

```bash
# Check the API reference page
curl -s -o /dev/null -w "%{http_code}" \
  "http://${EXTERNAL_IP}:8080/api"
# Expected: 200

# Authenticate
curl -s "http://${EXTERNAL_IP}:8080/api/auth" \
  -u "admin:your-new-password" \
  -H "Accept: application/json" \
  | jq '{sessionToken: .sessionToken}'
```

**REST API — list users:**
```bash
export SESSION_TOKEN="your-session-token"

curl -s "http://${EXTERNAL_IP}:8080/api/users?fields=id,username,display" \
  -H "Session-Token: ${SESSION_TOKEN}" \
  | jq '.[]'
```

**Expected result:** Session token returned; user list includes testuser1 and testuser2.

### Step 3.4 — Make a Payment via REST API

```bash
# Get user IDs
U1=$(curl -s "http://${EXTERNAL_IP}:8080/api/users?username=testuser1&fields=id" \
  -H "Session-Token: ${SESSION_TOKEN}" | jq -r '.[0].id')
U2=$(curl -s "http://${EXTERNAL_IP}:8080/api/users?username=testuser2&fields=id" \
  -H "Session-Token: ${SESSION_TOKEN}" | jq -r '.[0].id')

# Make a payment
curl -s -X POST "http://${EXTERNAL_IP}:8080/api/${U1}/payments" \
  -H "Session-Token: ${SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"member-to-member\",
    \"amount\": 10.00,
    \"subject\": \"${U2}\",
    \"description\": \"API test payment\"
  }" | jq '{id: .id, amount: .amount, status: .status}'
```

**Expected result:** Payment created with `PROCESSED` status and a transaction ID.

### Step 3.5 — Query Account Balance via API

```bash
curl -s "http://${EXTERNAL_IP}:8080/api/${U1}/accounts" \
  -H "Session-Token: ${SESSION_TOKEN}" \
  | jq '.[] | {type: .type.name, balance: .status.balance}'
```

**Expected result:** Account balance reflects all completed transactions.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Explore the GKE Deployment, Service, HPA, and init Job that the module creates, and understand
how Kubernetes manages the Cyclos application lifecycle.

### Step 4.1 — Inspect the Cyclos Deployment

```bash
kubectl describe deployment cyclos -n "${NAMESPACE}"

# View the pod spec
kubectl get deployment cyclos -n "${NAMESPACE}" -o yaml \
  | grep -A20 "containers:"
```

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, currentNodeCount, status)"
```

**Expected result:** Deployment shows 1 replica, resource limits (2000m CPU, 4Gi memory), startup and liveness probes targeting `/api`.

### Step 4.2 — Inspect the LoadBalancer Service

```bash
kubectl get svc -n "${NAMESPACE}" -o wide
kubectl describe svc cyclos -n "${NAMESPACE}"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, status: .status, nodeCount: .currentNodeCount}'
```

**Expected result:** Service type is LoadBalancer with `ClientIP` session affinity and the assigned external IP.

### Step 4.3 — Review the HPA

```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA shows `minReplicas=1`, `maxReplicas=1`, current replicas=1. Cyclos standalone mode requires a single instance.

### Step 4.4 — Inspect the db-init Job

```bash
kubectl get jobs -n "${NAMESPACE}"
kubectl describe job cyclos-db-init -n "${NAMESPACE}" 2>/dev/null || \
  kubectl get jobs -n "${NAMESPACE}" -o wide

# View db-init job logs
kubectl logs -n "${NAMESPACE}" \
  -l job-name=$(kubectl get jobs -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}') \
  --tail=30
```

**Expected result:** The db-init job completed successfully. Logs show extension installation (pg_trgm, uuid-ossp, postgis, earthdistance, cube, unaccent) and user/database creation.

### Step 4.5 — Perform a Rolling Restart

```bash
# Trigger a rolling restart of the Cyclos deployment
kubectl rollout restart deployment/cyclos -n "${NAMESPACE}"

# Watch the rollout progress
kubectl rollout status deployment/cyclos -n "${NAMESPACE}"

# After rollout completes, verify pod is running
kubectl get pods -n "${NAMESPACE}"
```

**Expected result:** A new pod starts while the old one terminates. After ~3–5 minutes, the new pod is `Running` and `1/1` ready. Cyclos flows survive the restart.

---

## Exercise 5 — Security and Workload Identity

### Objective

Explore Workload Identity binding between the Kubernetes service account and the GCP service
account, verify Secret Manager access, and review IAM bindings.

### Step 5.1 — Inspect Workload Identity

```bash
# List service accounts in the Cyclos namespace
kubectl get serviceaccounts -n "${NAMESPACE}"

# View the Workload Identity annotation
kubectl get serviceaccount cyclos -n "${NAMESPACE}" -o yaml \
  | grep -A3 "annotations:"
```

**Expected result:** The `cyclos` Kubernetes service account has an `iam.gke.io/gcp-service-account` annotation pointing to the GCP service account.

### Step 5.2 — Verify GCP Service Account

```bash
# List service accounts related to Cyclos
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~cyclos"

# Get the SA email
CYCLOS_SA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~cyclos" \
  --format="value(email)" \
  --limit=1)

echo "Cyclos SA: ${CYCLOS_SA}"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.accounts[] | select(.email | test("cyclos")) | {name, email}'
```

**Expected result:** A GCP service account named after the deployment exists with the Workload Identity User binding.

### Step 5.3 — Review IAM Bindings

```bash
# View IAM roles granted to the Cyclos SA
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${CYCLOS_SA}" \
  --format="table(bindings.role)"
```

**Expected result:** The Cyclos SA has roles: `cloudsql.client`, `secretmanager.secretAccessor`, `storage.objectAdmin`.

### Step 5.4 — Verify Secret Manager Access from Pod

```bash
# Get pod name
CYCLOS_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=cyclos \
  -o jsonpath='{.items[0].metadata.name}')

# Confirm DB_PASSWORD is injected (via Workload Identity + Secret Manager)
kubectl exec -n "${NAMESPACE}" "${CYCLOS_POD}" -- \
  env | grep DB_PASSWORD | head -c 20
echo "..."
```

**Expected result:** The `DB_PASSWORD` environment variable is populated (value hidden). This confirms Workload Identity successfully accessed Secret Manager.

### Step 5.5 — Check Network Policy

```bash
# List network policies in the namespace
kubectl get networkpolicies -n "${NAMESPACE}" 2>/dev/null || \
  echo "No NetworkPolicies defined (GKE Autopilot default)"

# Verify private database connection (no public IP on Cloud SQL)
gcloud sql instances describe \
  "$(gcloud sql instances list --project=${PROJECT} --filter='name~cyclos' --format='value(name)' --limit=1)" \
  --project="${PROJECT}" \
  --format="table(name, settings.ipConfiguration.authorizedNetworks[0].value, ipAddresses[0].ipAddress)"
```

**Expected result:** Cloud SQL has only a private IP address; no public IP is configured. All database traffic stays within the VPC.

---

## Exercise 6 — Cloud Logging

### Objective

Query Cyclos container logs from GKE, filter Tomcat application messages, view db-init job
output, and stream live logs via gcloud.

### Step 6.1 — View Logs in Log Explorer

Navigate to **Cloud Console > Logging > Log Explorer** and use this filter:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="cyclos"
```

**Expected result:** Tomcat startup messages, Cyclos initialization output, and HTTP request logs appear.

### Step 6.2 — Filter Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=50 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectIds\": [\"${PROJECT}\"],
    \"filter\": \"resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE}\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp: .timestamp, text: .textPayload}'
```

**Expected result:** Tomcat/Cyclos log entries including database connection pool messages.

### Step 6.3 — Stream Live Logs via kubectl

```bash
kubectl logs -n "${NAMESPACE}" -l app=cyclos -f --tail=20
```

Make requests to the Cyclos UI and observe access log entries appear in real time.

**Expected result:** Access log entries appear as you interact with the Cyclos web interface.

### Step 6.4 — View db-init Job Logs

```bash
INIT_JOB=$(kubectl get jobs -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')

gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND resource.labels.container_name~"init"' \
  --project="${PROJECT}" \
  --freshness=24h \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** db-init job logs show extension installation, user creation, and privilege grants confirming successful database initialization.

### Step 6.5 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND severity>=ERROR' \
  --project="${PROJECT}" \
  --freshness=24h \
  --format="table(timestamp,severity,textPayload)"
```

**Expected result:** Under normal operation, no application errors should appear.

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Explore GKE workload metrics, review the uptime check, inspect the HPA behavior, and
understand how to scale Cyclos in a Kubernetes environment.

### Step 7.1 — View GKE Workload Metrics

Navigate to **Cloud Console > Kubernetes Engine > Workloads > cyclos** and review the
metrics panel for CPU, memory, and pod restarts.

```bash
# List available GKE container metrics
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project="${PROJECT}" \
  | grep -E "cpu|memory|restart"
```

**Expected result:** Cyclos CPU utilisation is low during idle periods. Memory usage reflects the JVM heap (typically 1–2 Gi).

### Step 7.2 — Query GKE Metrics via REST API

**REST API — CPU utilisation:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** Cyclos container CPU utilisation is returned as a decimal fraction (e.g., 0.05 = 5%).

### Step 7.3 — Review the Uptime Check

```bash
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .displayName, period: .period}'
```

**Expected result:** An uptime check targeting the Cyclos LoadBalancer IP runs every 60 seconds. Status shows passing from multiple global locations.

### Step 7.4 — Scale the Deployment (Test Only)

```bash
# Scale to 2 replicas to observe GKE Autopilot node provisioning
kubectl scale deployment cyclos --replicas=2 -n "${NAMESPACE}"

# Watch pods come up
kubectl get pods -n "${NAMESPACE}" -w

# Scale back to 1 (Cyclos requires Hazelcast for multi-instance clustering)
kubectl scale deployment cyclos --replicas=1 -n "${NAMESPACE}"
kubectl rollout status deployment/cyclos -n "${NAMESPACE}"
```

> **Note:** Cyclos requires Hazelcast configuration (`cyclos.clusterHandler = hazelcast`) before
> running multiple replicas. The scale-up above is for observation only; revert to 1 replica.

**Expected result:** GKE Autopilot provisions an additional node within 2–3 minutes. The second Cyclos pod starts but may show session inconsistency without Hazelcast clustering enabled.

### Step 7.5 — Create an Alert Policy

**gcloud:**
```bash
gcloud alpha monitoring policies create \
  --display-name="Cyclos GKE - Pod Restart Alert" \
  --condition-filter="metric.type=\"kubernetes.io/container/restart_count\" resource.label.\"namespace_name\"=\"${NAMESPACE}\"" \
  --condition-threshold-value=3 \
  --condition-threshold-duration=300s \
  --condition-threshold-comparison=COMPARISON_GT \
  --project="${PROJECT}"
```

**Expected result:** Alert policy created. It will fire if the Cyclos pod restarts more than 3 times within 5 minutes.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Cyclos_GKE` deployment. This removes the
Kubernetes namespace and workloads, Cloud SQL instance, GCS bucket, Secret Manager secrets,
static IP, and all IAM bindings.

### Manual Cleanup (if needed)

**kubectl:**
```bash
# Delete the namespace (removes all resources within it)
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Cloud SQL instance
INSTANCE=$(gcloud sql instances list --project="${PROJECT}" \
  --filter="name~cyclos" --format="value(name)" --limit=1)
gcloud sql instances delete "${INSTANCE}" --project="${PROJECT}" --quiet

# Delete Secret Manager secrets
gcloud secrets delete "${DB_SECRET}" --project="${PROJECT}" --quiet

# Release static IP
gcloud compute addresses list --project="${PROJECT}" --filter="name~cyclos"
gcloud compute addresses delete <address-name> \
  --region="${REGION}" --project="${PROJECT}" --quiet
```

**REST API — delete GKE namespace:**
```bash
curl -s -X DELETE \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `cyclos` | Base name for K8s and GCP resources |
| `application_version` | string | `4.16.17` | Cyclos Docker image tag |
| `min_instance_count` | number | `1` | Minimum HPA pod replicas |
| `max_instance_count` | number | `1` | Maximum replicas (standalone mode) |
| `container_resources` | object | `{cpu_limit="1000m", memory_limit="2Gi"}` | Container CPU/memory limits |
| `cpu_limit` | string | `2000m` | Passed to Cyclos_Common (override via container_resources) |
| `memory_limit` | string | `4Gi` | Passed to Cyclos_Common (override via container_resources) |
| `db_name` | string | `cyclos` | PostgreSQL database name |
| `db_user` | string | `cyclos` | PostgreSQL application user |
| `database_password_length` | number | `32` | Generated password length |
| `enable_nfs` | bool | `false` | NFS disabled; GCS used for file storage |
| `reserve_static_ip` | bool | `true` | Reserve a static external IP |
| `gke_cluster_name` | string | auto | Target GKE cluster name (auto-discovers if empty) |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | number | `7` | Days to retain backup files |
| `deploy_application` | bool | `true` | Set `false` to provision infra only |

### Useful Commands

```bash
# Get all resources in Cyclos namespace
kubectl get all -n ${NAMESPACE}

# View pod logs
kubectl logs -n ${NAMESPACE} -l app=cyclos --tail=50

# View startup probe config
kubectl get deployment cyclos -n ${NAMESPACE} \
  -o jsonpath='{.spec.template.spec.containers[0].startupProbe}' | jq .

# Get external IP
kubectl get svc -n ${NAMESPACE} -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Scale deployment
kubectl scale deployment cyclos --replicas=1 -n ${NAMESPACE}

# Rolling restart
kubectl rollout restart deployment/cyclos -n ${NAMESPACE}

# Access secret
gcloud secrets versions access latest --secret=${DB_SECRET} --project=${PROJECT}

# List Cloud SQL instances
gcloud sql instances list --project=${PROJECT} --filter="name~cyclos"

# View Workload Identity annotation
kubectl get sa cyclos -n ${NAMESPACE} -o yaml | grep iam.gke.io

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}
```

### Further Reading

- [Cyclos official documentation](https://www.cyclos.org/documentation/)
- [Cyclos REST API reference](https://demo.cyclos.org/api)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity documentation](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Secret Manager overview](https://cloud.google.com/secret-manager/docs)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [Kubernetes HPA documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
