---
title: "Wiki.js on GKE — Lab Guide"
sidebar_label: "Wikijs GKE"
---

# Wiki.js on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wikijs_GKE)**

This lab guide walks you through deploying, exploring, and operating **Wiki.js** on Google
Kubernetes Engine Autopilot using the **Wikijs_GKE** module. You will explore a modern
open-source wiki platform backed by Cloud SQL PostgreSQL with full-text search, GCS Fuse
asset storage, Workload Identity, and Kubernetes-native operations.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Wiki.js](#exercise-1--access-wikijs)
6. [Exercise 2 — Create and Edit Pages](#exercise-2--create-and-edit-pages)
7. [Exercise 3 — User Management](#exercise-3--user-management)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging and Monitoring](#exercise-6--cloud-logging-and-monitoring)
11. [Cleanup](#cleanup)
12. [Reference](#reference)

---

## 1. Overview

### What Is Wiki.js?

Wiki.js is a modern, powerful open-source wiki platform built on Node.js with 28,000+ GitHub
stars. The `Wikijs_GKE` module deploys version **2.5.311** on GKE Autopilot with Cloud SQL
PostgreSQL 15 and the `pg_trgm` extension for native full-text search. The GKE deployment
adds Kubernetes-native features: HPA auto-scaling, Workload Identity, GCS Fuse CSI, and
structured JSON pod logging.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Managed node provisioning, pod scheduling, auto-scaling with HPA |
| **Workload Identity** | Kubernetes SA bound to GCP SA — no key files, least-privilege IAM |
| **Cloud SQL Proxy** | Sidecar container providing Unix socket DB connection inside pods |
| **GCS Fuse CSI** | GCS bucket mounted at `/wiki-storage` for persistent asset storage |
| **Full-Text Search** | PostgreSQL `pg_trgm` trigram search powering Wiki.js search |
| **Authentication** | Local auth, SAML 2.0, OAuth 2.0/OIDC, LDAP/Active Directory |
| **Observability** | Cloud Logging structured JSON, Cloud Monitoring GKE dashboard |

---

## 2. Architecture

```
Browser / Client
       │
       ▼ HTTP (LoadBalancer)
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Namespace: appwikijs<tenant><deploymentid>                │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Pod: wikijs-<hash>   (READY 2/2)                     │  │ │
│  │  │  ┌──────────────────┐  ┌────────────────────────────┐ │  │ │
│  │  │  │ Container: wikijs │  │ Sidecar: cloud-sql-proxy   │ │  ││
│  │  │  │ Port: 3000        │  │ Unix socket: /cloudsql/... │ │  ││
│  │  │  │ /wiki-storage     │  └────────────────────────────┘ │  ││
│  │  │  │ (GCS Fuse mount)  │                               │  │  │
│  │  │  └──────────────────┘                                │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  Service: LoadBalancer → EXTERNAL_IP:80                   │   │
│  │  HPA: min=1  max=3  (CPU-based)                           │   │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼ Cloud SQL Auth Proxy (Unix socket)
┌──────────────────────────────────────────────────────────────────┐
│  Cloud SQL PostgreSQL 15 (private IP)                            │
│  Database: wikijs  │  pg_trgm extension                          │
└──────────────────────────────────────────────────────────────────┘

Supporting Services:
  Workload Identity   ← KSA → GSA binding (no key files)
  Secret Manager      ← DB password, JWT secret
  GCS Bucket          ← wikijs-storage (asset uploads via CSI)
  Artifact Registry   ← custom container image
  Cloud Monitoring    ← uptime check, alert policies
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
roles/storage.admin
roles/iam.serviceAccountAdmin
roles/monitoring.admin
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Wikijs_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `wikijs` | Base resource name |
| `application_version` | `2.5.311` | Wiki.js version |
| `min_instance_count` | `1` | Minimum pod replicas |
| `max_instance_count` | `3` | HPA maximum replicas |
| `enable_nfs` | `true` | Filestore NFS mount |
| `gke_cluster_name` | `""` | Auto-discover cluster |

Click **Deploy** and wait for provisioning to complete (approximately 15–25 minutes).

> **What this provisions:** GKE namespace and Deployment, HPA, Cloud SQL PostgreSQL 15 with
> `pg_trgm`, Artifact Registry (custom image), GCS Fuse CSI volume, Workload Identity binding,
> Secret Manager secrets, LoadBalancer Service with static IP, uptime check, and alert policies.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

# Discover the DB secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="value(name)" \
  --limit=1)

echo "Cluster: ${CLUSTER}"
echo "DB Secret: ${DB_SECRET}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info

# Discover the namespace (pattern: appwikijs<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appwikijs" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Namespace: ${NAMESPACE}"
echo "Wiki.js URL: http://${EXTERNAL_IP}"
```

---

## Exercise 1 — Access Wiki.js

### Objective

Get the external IP from the Kubernetes LoadBalancer Service, verify pods are running, obtain
admin credentials, and complete the Wiki.js first-run setup.

### Step 1.1 — Get the External IP

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="name~wikijs"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, endpoint}'
```

**Expected result:** The LoadBalancer Service shows an `EXTERNAL-IP` address.

### Step 1.2 — Verify Pods Are Running

```bash
kubectl get pods -n "${NAMESPACE}"
```

Expected output:
```
NAME                      READY   STATUS    RESTARTS   AGE
wikijs-<hash>-xxxxx       2/2     Running   0          5m
```

The `2/2` indicates the Wiki.js container plus the Cloud SQL Auth Proxy sidecar are running.

```bash
# View detailed pod description
kubectl describe pod -l app=wikijs -n "${NAMESPACE}"
```

### Step 1.3 — Retrieve Admin Credentials

**gcloud:**
```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 --decode
```

### Step 1.4 — Complete the Setup Wizard

1. Navigate to `http://${EXTERNAL_IP}` in a browser.
2. Complete the Wiki.js setup wizard with site title, admin email, and admin password.
3. Click **Install**.

**Expected result:** Wiki.js redirects to the home page.

### Step 1.5 — View Container Logs at Startup

```bash
# View Wiki.js container logs
kubectl logs -l app=wikijs \
  -c wikijs \
  -n "${NAMESPACE}" \
  --tail=50
```

**Expected result:** Log entries confirming database connection, `pg_trgm` extension activated,
and Wiki.js server started on port 3000.

---

## Exercise 2 — Create and Edit Pages

### Objective

Create pages using the Markdown editor, build a nested page tree, and verify content is
persisted in the PostgreSQL database.

### Step 2.1 — Create Pages with Markdown

1. Click **New Page** in the top navigation.
2. Select **Markdown** editor.
3. Set path to `lab/gke-overview`.
4. Add a heading, code block with `kubectl` commands, and a table.
5. Click **Create**.

**Expected result:** Page renders and appears in left sidebar under `lab/`.

### Step 2.2 — Build a Page Hierarchy

Create two more pages:
- `lab/architecture` — GKE architecture overview
- `lab/workload-identity` — Workload Identity explanation

**Expected result:** Three pages grouped under `lab/` in the sidebar navigation tree.

### Step 2.3 — Add Tags and Properties

1. Open `lab/gke-overview`.
2. Click **Page Actions** → **Properties**.
3. Add tags: `gke`, `kubernetes`, `wikijs`.
4. Save.

**Expected result:** Tags appear below the page title and are indexed for search.

### Step 2.4 — Test Full-Text Search

1. Click the **Search** icon in the top bar.
2. Search for `Workload Identity`.

**Expected result:** The `lab/workload-identity` page appears in results via `pg_trgm` search.

### Step 2.5 — Verify Search Engine

1. Navigate to **Administration > Search Engine**.
2. Confirm **Database — PostgreSQL** is selected.
3. Click **Rebuild Index**.

**Expected result:** Search index rebuild completes and search engine shows PostgreSQL provider.

---

## Exercise 3 — User Management

### Objective

Create user groups, add users, and configure page-level access control within Wiki.js.

### Step 3.1 — Review Default Groups

1. Navigate to **Administration > Groups**.
2. Click **Administrators** — review full-access page rules.
3. Click **Guests** — review read-only or restricted access.

**Expected result:** Two default groups with distinct permission profiles.

### Step 3.2 — Create an Editors Group

1. Click **New Group**, name it `Editors`.
2. Add a page rule: Path `/`, Access: Read + Write.
3. Save.

### Step 3.3 — Create a New User

1. Navigate to **Administration > Users** → **New User**.
2. Enter email `editor@example.com`, name `Lab Editor`, and a password.
3. Assign to the **Editors** group.
4. Save.

**Expected result:** User appears in the Users list assigned to Editors group.

### Step 3.4 — Explore Authentication Providers

1. Navigate to **Administration > Authentication**.
2. Review available providers: Local, Google OAuth, SAML 2.0, LDAP.
3. Note the configuration fields for Google OAuth (Client ID, Client Secret, Callback URL).

**Expected result:** Multiple authentication strategies visible, each configurable for
enterprise SSO integration.

### Step 3.5 — List Secrets from Kubernetes

```bash
# List Kubernetes secrets in the namespace (Workload Identity - no DB password in K8s secrets)
kubectl get secrets -n "${NAMESPACE}"
```

**gcloud:**
```bash
# The DB password is managed by Secret Manager, not a Kubernetes Secret
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="table(name, createTime)"
```

**Expected result:** Secret Manager holds the DB password; no plaintext credentials exist in
Kubernetes Secrets — they are injected via Workload Identity and the Auth Proxy sidecar.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the Kubernetes Deployment, Service, and HPA that manage the Wiki.js workload.

### Step 4.1 — Describe the Deployment

```bash
kubectl describe deployment -l app=wikijs -n "${NAMESPACE}"
```

Note:
- Two containers: `wikijs` (port 3000) and `cloud-sql-proxy` (Unix socket sidecar)
- Volume mounts: `/cloudsql`, `/wiki-storage` (GCS Fuse), `/mnt/nfs` (Filestore)
- Resource limits: `cpu=1000m`, `memory=2Gi`

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, nodeConfig}'
```

### Step 4.2 — View the HPA

```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA shows `MINPODS` and `MAXPODS` matching your `min_instance_count` and
`max_instance_count` settings.

### Step 4.3 — Check Pod Resource Usage

```bash
kubectl top pods -n "${NAMESPACE}"
```

**Expected result:** CPU and memory consumption for the Wiki.js pod.

### Step 4.4 — Inspect Volume Mounts

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -l app=wikijs \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec "${POD}" -c wikijs -n "${NAMESPACE}" -- df -h
```

**Expected result:** Filesystem mounts visible including the GCS Fuse mount at `/wiki-storage`
and NFS mount at `/mnt/nfs`.

### Step 4.5 — View All Namespace Resources

```bash
kubectl get all -n "${NAMESPACE}"
```

Expected resources:
```
NAME                       READY   STATUS    RESTARTS   AGE
pod/wikijs-xxx             2/2     Running   0          10m

NAME             TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)
service/wikijs   LoadBalancer   10.96.xx.xx    34.xx.xx.xx    80:31234/TCP

NAME                  READY   UP-TO-DATE   AVAILABLE
deployment.apps/wikijs   1/1     1            1

NAME                             REFERENCE       MINPODS   MAXPODS
horizontalpodautoscaler/wikijs   Deployment/...  1         3
```

---

## Exercise 5 — Security and Workload Identity

### Objective

Verify Workload Identity binding between the Kubernetes ServiceAccount and GCP ServiceAccount,
confirm Secret Manager access via IAM, and inspect GCS bucket permissions.

### Step 5.1 — Inspect the Kubernetes ServiceAccount

```bash
kubectl get serviceaccounts -n "${NAMESPACE}"
kubectl describe serviceaccount -n "${NAMESPACE}" \
  $(kubectl get serviceaccount -n "${NAMESPACE}" \
    -o jsonpath='{.items[0].metadata.name}')
```

**Expected result:** The ServiceAccount has annotation:
```
iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com
```

### Step 5.2 — Verify the GCP Service Account IAM Binding

**gcloud:**
```bash
# List GCP service accounts for this project
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~wikijs" \
  --format="table(email, displayName)"
```

```bash
# Get IAM policy for the wikijs service account
GSA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~wikijs" \
  --format="value(email)" --limit=1)

gcloud iam service-accounts get-iam-policy "${GSA}" \
  --project="${PROJECT}"
```

**Expected result:** The Kubernetes ServiceAccount (`serviceAccount:<project>.svc.id.goog[<namespace>/<ksa-name>]`) appears with `roles/iam.workloadIdentityUser`.

### Step 5.3 — Verify Secret Manager Access

```bash
# Confirm the GSA has secretAccessor on the DB secret
gcloud secrets get-iam-policy "${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}:getIamPolicy" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.bindings[] | select(.role == "roles/secretmanager.secretAccessor")'
```

**Expected result:** The wikijs GCP service account appears with `roles/secretmanager.secretAccessor`.

### Step 5.4 — Verify GCS Bucket Permissions

**gcloud:**
```bash
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="value(name)" --limit=1)

gcloud storage buckets get-iam-policy "gs://${BUCKET}" \
  --format="json" | jq '.bindings[] | select(.role | test("storage"))'
```

**Expected result:** The wikijs GCP service account has `roles/storage.objectAdmin` on the
wikijs-storage bucket, enabling GCS Fuse writes.

### Step 5.5 — View Pod Security Context

```bash
kubectl get pod -l app=wikijs -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].spec.securityContext}' | jq
```

**Expected result:** Security context shows `runAsNonRoot: true` and the UID for the wiki
process, confirming the container does not run as root.

---

## Exercise 6 — Cloud Logging and Monitoring

### Objective

Query Wiki.js pod logs via Cloud Logging and kubectl, inspect GKE metrics in Cloud Monitoring,
and verify the uptime check is passing.

### Step 6.1 — View Pod Logs via kubectl

```bash
kubectl logs -l app=wikijs \
  -c wikijs \
  -n "${NAMESPACE}" \
  --tail=100
```

```bash
# Cloud SQL Auth Proxy sidecar logs
kubectl logs -l app=wikijs \
  -c cloud-sql-proxy \
  -n "${NAMESPACE}" \
  --tail=50
```

**Expected result:** Wiki.js startup messages and Auth Proxy connection establishment logs.

### Step 6.2 — Query Logs in Cloud Logging

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"wikijs\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp,severity,jsonPayload.message)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"k8s_container\\\" AND resource.labels.namespace_name=\\\"${NAMESPACE}\\\"\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 6.3 — Filter for Errors

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=10
```

In the Cloud Console Log Explorer:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=ERROR
```

**Expected result:** No error entries under normal operation.

### Step 6.4 — Check the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(displayName, httpCheck.path, period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {displayName, period, httpCheck}'
```

**Expected result:** An uptime check for Wiki.js probing port 80 on the external IP.

### Step 6.5 — View GKE Pod Metrics

```bash
echo "https://console.cloud.google.com/monitoring/dashboards?project=${PROJECT}"
```

In Cloud Monitoring Metrics Explorer, query pod CPU:

**REST API (MQL):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/cpu/request_utilization' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** CPU utilisation charts for the wikijs pod.

### Step 6.6 — View Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --format="table(displayName, enabled)"
```

**Expected result:** CPU and memory alert policies for the wikijs workload.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Wikijs_GKE` deployment. This removes the
Kubernetes namespace and all workloads, Cloud SQL database and user, GCS bucket, Workload
Identity bindings, Secret Manager secrets, and monitoring resources.

> **Warning:** Undeploy deletes the Cloud SQL database and GCS bucket contents. Back up any
> important data before proceeding.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Secret Manager secrets
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# Delete GCS bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="value(name)" --limit=1)
gcloud storage rm -r "gs://${BUCKET}" --quiet

# Delete service account
GSA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~wikijs" \
  --format="value(email)" --limit=1)
gcloud iam service-accounts delete "${GSA}" \
  --project="${PROJECT}" --quiet
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `wikijs` | Base name for Kubernetes and GCP resources |
| `application_version` | string | `2.5.311` | Wiki.js image tag |
| `min_instance_count` | number | `1` | HPA minimum pod replicas |
| `max_instance_count` | number | `3` | HPA maximum pod replicas |
| `application_database_name` | string | `wikijs` | PostgreSQL database name |
| `application_database_user` | string | `wikijs` | PostgreSQL user name |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore at `/mnt/nfs` |
| `enable_redis` | bool | `false` | Enable Redis session cache |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar |
| `gke_cluster_name` | string | `""` | Target GKE cluster (auto-discovered when empty) |
| `tenant_deployment_id` | string | `demo` | Tenant identifier in resource names |
| `support_users` | list | `[]` | Email addresses for monitoring alerts |
| `deploy_application` | bool | `true` | Deploy the GKE workload |

### Useful Commands

```bash
# Get external IP
kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Check pod status
kubectl get pods -n ${NAMESPACE}

# View application logs
kubectl logs -l app=wikijs -c wikijs -n ${NAMESPACE} --tail=100

# View Auth Proxy logs
kubectl logs -l app=wikijs -c cloud-sql-proxy -n ${NAMESPACE} --tail=50

# Describe deployment
kubectl describe deployment -l app=wikijs -n ${NAMESPACE}

# View HPA
kubectl get hpa -n ${NAMESPACE}

# Access DB password from Secret Manager
gcloud secrets versions access latest --secret="${DB_SECRET}" --project=${PROJECT}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# Verify Workload Identity
kubectl describe serviceaccount -n ${NAMESPACE}
```

### Further Reading

- [Wiki.js documentation](https://docs.requarks.io/)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity documentation](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy for GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [GCS Fuse CSI Driver](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/cloud-storage-fuse-csi-driver)
- [Cloud Logging for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/installing)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/observing)
