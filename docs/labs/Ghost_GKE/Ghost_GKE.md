# Ghost on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghost_GKE)**

This lab guide walks you through deploying, exploring, and operating the **Ghost** publishing
platform on Google Kubernetes Engine (GKE) Autopilot using the **Ghost_GKE** module. You will
explore a production-grade Kubernetes CMS architecture backed by Cloud SQL MySQL 8.0, Cloud
Filestore NFS shared content storage, Workload Identity IAM, and Secret Manager — and practice
Kubernetes workload inspection, database management, security verification, observability
queries, and horizontal scaling using kubectl, gcloud CLI, and REST API.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Ghost](#exercise-1--access-ghost)
6. [Exercise 2 — Content Management](#exercise-2--content-management)
7. [Exercise 3 — Kubernetes Workloads](#exercise-3--kubernetes-workloads)
8. [Exercise 4 — Database and Migrations](#exercise-4--database-and-migrations)
9. [Exercise 5 — Workload Identity and Security](#exercise-5--workload-identity-and-security)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring](#exercise-7--cloud-monitoring)
12. [Exercise 8 — Scaling and Operations](#exercise-8--scaling-and-operations)
13. [Cleanup](#13-cleanup)
14. [Reference](#14-reference)

---

## 1. Overview

### What Is Ghost?

Ghost is a professional open-source publishing platform for newsletters, memberships, and
content sites — trusted by Buffer, Cloudflare, DuckDuckGo, Duolingo, FreeCodeCamp, Revolut,
and Kickstarter. With 22,000+ active customers and 100,000+ websites, Ghost delivers built-in
subscription monetization, native SEO, and superior page speed. The `Ghost_GKE` module
deploys Ghost 6.x on GKE Autopilot with Cloud SQL MySQL 8.0, Cloud Filestore NFS, Redis
caching, Workload Identity, and a Kubernetes LoadBalancer service.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Managed Kubernetes with automatic node provisioning and security hardening |
| **MySQL 8.0 Backend** | Cloud SQL MySQL 8.0 connected via Cloud SQL Auth Proxy sidecar |
| **Workload Identity** | Pod-level GCP IAM without service account keys |
| **Shared NFS Storage** | Cloud Filestore NFS mounted into all Ghost pods for consistent content |
| **Redis Page Caching** | Redis backend reducing DB query load across multiple pods |
| **Horizontal Pod Autoscaler** | Automatic scaling based on CPU utilization |
| **Kubernetes Operations** | Deployment inspection, rolling updates, manual scaling, and rollbacks |

---

## 2. Architecture

```
External Traffic (HTTP)
        │
        ▼
  Kubernetes Service (LoadBalancer)
  External IP → NodePort → Ghost Pod(s)
  ┌──────────────────────────────────────────────┐
  │  Ghost Deployment  (namespace: appghost…)    │
  │                                              │
  │  ┌─────────────────────────────────────────┐ │
  │  │ ghost container                          │ │
  │  │   entrypoint.sh → Ghost 6.x Node.js      │ │
  │  │   port 2368                              │ │
  │  │ cloudsql-proxy sidecar                   │ │
  │  │   /cloudsql/<instance-connection-name>   │ │
  │  └─────────────────────────────────────────┘ │
  │  NFS PVC → Cloud Filestore /mnt/nfs          │
  └──────────────────────────────────────────────┘
        │ VPC Private Networking
        ├────────────────────────────┐
        ▼                            ▼
  Cloud SQL MySQL 8.0         Cloud Filestore NFS
  ghost database              shared content volume
        │
        ▼
  Redis (NFS VM IP:6379)
  Ghost page cache
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GKE Autopilot Cluster                                     │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Namespace: appghost<tenant><id>                     │  │  │
│  │  │                                                      │  │  │
│  │  │  Deployment: ghost         HPA: min=1 max=5          │  │  │
│  │  │  Service: LoadBalancer     PDB: minAvailable=1       │  │  │
│  │  │  ServiceAccount (Workload Identity bound)            │  │  │
│  │  │  Job: db-init (completed)                            │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Cloud SQL   │  │  Filestore   │  │  Redis (NFS VM)       │  │
│  │  MySQL 8.0   │  │  NFS share   │  │  page cache           │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Secret Mgr  │  │  Logging     │  │  Monitoring           │  │
│  │  DB creds    │  │  k8s_container│  │  uptime check         │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Ghost_GKE
    application_version   = "6.14.0"  →  Ghost container image tag
    min_instance_count    = 1         →  always one pod running
    max_instance_count    = 5         →  HPA maximum replicas
    enable_nfs            = true      →  Cloud Filestore NFS mounted
    enable_redis          = true      →  Redis page caching enabled
    enable_cloudsql_volume= true      →  Auth Proxy sidecar injected
    database_type         = MYSQL_8_0 →  Ghost requires MySQL 8.0
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

Deploy the `Ghost_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `ghost` | Base resource name |
| `application_version` | `6.14.0` | Ghost image tag |
| `tenant_deployment_id` | `demo` | Short deployment suffix |
| `deploy_application` | `true` | Deploy the Ghost workload |
| `enable_nfs` | `true` | Cloud Filestore NFS for content |
| `enable_redis` | `true` | Redis page caching |
| `db_name` | `ghost` | MySQL database name |
| `db_user` | `ghost` | MySQL application user |
| `min_instance_count` | `1` | Minimum pod replicas |
| `max_instance_count` | `5` | Maximum pod replicas (HPA) |
| `cpu_limit` | `2000m` | CPU per Ghost pod |
| `memory_limit` | `4Gi` | Memory per Ghost pod |
| `support_users` | `[your-email]` | Alert notification recipients |

Click **Deploy** and wait for provisioning to complete (approximately 20–30 minutes).

> **What this provisions:** GKE Autopilot namespace with Kubernetes Deployment, Service
> (LoadBalancer), HPA, PodDisruptionBudget, and ServiceAccount with Workload Identity.
> Cloud SQL MySQL 8.0 instance with `ghost` database and user. Cloud Filestore NFS instance.
> Secret Manager secrets for DB password. Artifact Registry repository. Cloud Build image
> pipeline. Cloud Monitoring uptime check. A `db-init` Kubernetes Job runs automatically
> during deployment to initialize the MySQL schema.

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

# Discover the DB password secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ghost" \
  --format="value(name)" \
  --limit=1)

echo "DB Secret: ${DB_SECRET}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes

# Discover the Ghost namespace (pattern: appghost<tenant><id>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appghost" | head -1)

echo "Namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Ghost URL: http://${EXTERNAL_IP}"
```

---

## Exercise 1 — Access Ghost

### Objective

Retrieve the external LoadBalancer IP, confirm Ghost is reachable, and log into the Ghost
Admin panel for the first time.

### Step 1.1 — Get the External Service IP

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}"

EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "Ghost URL: http://${EXTERNAL_IP}"
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --format="table(name, IPAddress, target)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.name'
```

**Expected result:** An external IP address is returned. If the IP shows `<pending>`, wait 1–2 minutes for the load balancer to provision.

### Step 1.2 — Verify Ghost is Running

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"
```

Expected output:
```
NAME                        READY   STATUS    RESTARTS   AGE
ghost-<hash>-<hash>         2/2     Running   0          5m
db-init-<hash>              0/1     Completed 0          6m
```

**Expected result:** The Ghost pod shows `2/2 READY` (ghost container + Cloud SQL Auth Proxy sidecar). The `db-init` job shows `Completed`.

### Step 1.3 — Confirm Ghost is Reachable via HTTP

```bash
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}"
```

**Expected result:** HTTP `200` (or a redirect). If `000`, wait for the pod to become fully ready.

### Step 1.4 — Access the Ghost Admin Setup Wizard

Open `http://${EXTERNAL_IP}/ghost` in a browser.

Complete the setup wizard:
1. Enter a site title (e.g. "My Ghost Blog").
2. Enter your admin name, email, and password.
3. Click **Create your account**.
4. Ghost redirects to the Admin dashboard.

**Expected result:** You are logged into Ghost Admin at `http://${EXTERNAL_IP}/ghost/#/dashboard`.

### Step 1.5 — Retrieve DB Credentials from Secret Manager

```bash
# List Ghost-related secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ghost" \
  --format="table(name, createTime)"

# Access the DB password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aghost" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[].name'
```

**Expected result:** Ghost-related secrets are listed and the DB password is returned as a plaintext value.

---

## Exercise 2 — Content Management

### Objective

Create and publish posts, manage pages and tags, upload images, and verify content appears
on the public Ghost site.

### Step 2.1 — Create and Publish a Post

1. In Ghost Admin, click **Posts** in the left sidebar.
2. Click **New post** (top-right).
3. Enter a title and body text.
4. Click the settings gear to add a tag and featured image.
5. Click **Publish** → **Publish** to confirm.

**Expected result:** The post appears in the Posts list with status `Published`. Navigate to `http://${EXTERNAL_IP}` — the post is visible on the front page.

### Step 2.2 — Create a Static Page

1. Click **Pages** in the sidebar.
2. Click **New page**, enter "About" as the title, add content.
3. Click **Publish** → **Publish**.

**Expected result:** The page is accessible at `http://${EXTERNAL_IP}/about`.

### Step 2.3 — Upload an Image

1. Open a post in the editor.
2. Click **+** to add a card, select **Image**, and upload a file.

**kubectl — verify NFS mount is active:**
```bash
kubectl describe pod -n "${NAMESPACE}" \
  $(kubectl get pods -n "${NAMESPACE}" -l app=ghost -o jsonpath='{.items[0].metadata.name}') \
  | grep -A5 "Volumes:"
```

**Expected result:** The NFS volume appears in the pod's volume list at `/mnt/nfs`, confirming uploaded images are stored on shared NFS.

### Step 2.4 — Manage Tags

1. Navigate to **Tags** in the left sidebar.
2. Click **New tag**, enter a name and description.
3. Associate the tag with your post via the post settings panel.

**Expected result:** Tags appear as filters on the public site.

### Step 2.5 — Verify Content Persists Across Pods

```bash
# Check that multiple pods see the same NFS content
kubectl get pods -n "${NAMESPACE}" -l app=ghost
```

**Expected result:** All ghost pods share the `/mnt/nfs` volume via the Cloud Filestore NFS mount, ensuring content created on one pod is visible on all pods.

---

## Exercise 3 — Kubernetes Workloads

### Objective

Inspect the Ghost Kubernetes Deployment, Service, ConfigMap, and NFS PersistentVolumeClaim
to understand how the module wires together GKE resources.

### Step 3.1 — Inspect the Deployment

**kubectl:**
```bash
kubectl describe deployment -n "${NAMESPACE}"
```

```bash
kubectl get deployment -n "${NAMESPACE}" -o json \
  | jq '{
    name: .items[0].metadata.name,
    replicas: .items[0].spec.replicas,
    image: .items[0].spec.template.spec.containers[0].image,
    cpu: .items[0].spec.template.spec.containers[0].resources.limits.cpu,
    memory: .items[0].spec.template.spec.containers[0].resources.limits.memory
  }'
```

**Expected result:** The Deployment shows the Ghost 6.x image, 2 vCPU / 4Gi resource limits, and 1 replica (minimum).

### Step 3.2 — Inspect the LoadBalancer Service

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}" -o wide

kubectl describe service -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --filter="name~ghost" \
  --format="table(name, IPAddress, portRange, region)"
```

**Expected result:** The Kubernetes Service of type `LoadBalancer` maps external port 80 to container port 2368.

### Step 3.3 — Inspect the Pod and Containers

**kubectl:**
```bash
GHOST_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=ghost \
  -o jsonpath='{.items[0].metadata.name}')

# List containers in the pod
kubectl get pod "${GHOST_POD}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.containers[*].name}' | tr ' ' '\n'

# View ghost container logs
kubectl logs "${GHOST_POD}" -n "${NAMESPACE}" -c ghost --tail=30

# View Cloud SQL Proxy sidecar logs
kubectl logs "${GHOST_POD}" -n "${NAMESPACE}" -c cloud-sql-proxy --tail=20
```

**Expected result:** Two containers are listed: `ghost` and `cloud-sql-proxy`. Ghost logs show `Ghost boot 6.x.x` and database connection confirmation.

### Step 3.4 — Inspect the NFS Volume Mount

**kubectl:**
```bash
kubectl get pod "${GHOST_POD}" -n "${NAMESPACE}" -o json \
  | jq '.spec.volumes[] | select(.name | test("nfs"))'

kubectl exec "${GHOST_POD}" -n "${NAMESPACE}" -c ghost -- \
  ls /mnt/nfs/ 2>/dev/null || echo "NFS directory accessible"
```

**Expected result:** The NFS volume is mounted at `/mnt/nfs` inside the Ghost container. The content directory may show Ghost subdirectories (images, themes, files).

### Step 3.5 — Check Horizontal Pod Autoscaler

**kubectl:**
```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** The HPA shows `min=1`, `max=5`, current CPU utilization, and the CPU target threshold (typically 80%). Current replicas is `1` under no-load conditions.

---

## Exercise 4 — Database and Migrations

### Objective

Inspect the Cloud SQL MySQL instance, verify the `db-init` job completed successfully,
examine the Ghost database schema, and understand how Auth Proxy provides database access.

### Step 4.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
export SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="databaseVersion:MYSQL_8_0" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe "${SQL_INSTANCE}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '{name: .name, version: .databaseVersion, tier: .settings.tier, state: .state}'
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name: .name, version: .databaseVersion, state: .state}'
```

**Expected result:** A `MYSQL_8_0` Cloud SQL instance is listed as `RUNNABLE`.

### Step 4.2 — Verify the db-init Job Completed

**kubectl:**
```bash
kubectl get jobs -n "${NAMESPACE}"
kubectl describe job -l app=db-init -n "${NAMESPACE}" 2>/dev/null || \
  kubectl get pods -n "${NAMESPACE}" --show-labels | grep db-init
```

**Expected result:** The `db-init` job shows `Completed` status with `1/1` successful completions. This job ran the `db-init.sh` script to create the `ghost` database and user with proper MySQL 8.0 charset and collation.

### Step 4.3 — Verify Ghost Database Exists

**gcloud:**
```bash
gcloud sql databases list \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT}" \
  --format="table(name, charset, collation)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}/databases" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name: .name, charset: .charset, collation: .collation}'
```

**Expected result:** The `ghost` database is listed with `utf8mb4` charset and `utf8mb4_0900_ai_ci` collation — the MySQL 8.0 defaults required by Ghost 6.x.

### Step 4.4 — Inspect Auth Proxy Connection String

**kubectl:**
```bash
kubectl get pod "${GHOST_POD}" -n "${NAMESPACE}" -o json \
  | jq '.spec.containers[] | select(.name == "cloud-sql-proxy") | .args'
```

**gcloud (check Cloud SQL instance connection name):**
```bash
gcloud sql instances describe "${SQL_INSTANCE}" \
  --project="${PROJECT}" \
  --format="value(connectionName)"
```

**Expected result:** The Auth Proxy container argument contains the Cloud SQL instance connection string in the format `project:region:instance`. The Ghost container connects via Unix socket at `/cloudsql/<connection-name>`.

### Step 4.5 — Review Ghost Database Environment Variables

**kubectl:**
```bash
kubectl exec "${GHOST_POD}" -n "${NAMESPACE}" -c ghost -- env \
  | grep -E "^DB_|^database__" | sort
```

**Expected result:** Database connection variables are present (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`). These are translated by `entrypoint.sh` into Ghost's double-underscore config syntax (`database__connection__host`, etc.).

---

## Exercise 5 — Workload Identity and Security

### Objective

Inspect the Kubernetes ServiceAccount Workload Identity binding, verify IAM roles assigned
to the Ghost GCP service account, and review Kubernetes Secrets used by the deployment.

### Step 5.1 — Inspect the Kubernetes ServiceAccount

**kubectl:**
```bash
kubectl get serviceaccounts -n "${NAMESPACE}" \
  -o wide

kubectl describe serviceaccount -n "${NAMESPACE}" \
  $(kubectl get sa -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')
```

**Expected result:** The Ghost ServiceAccount has an annotation:
`iam.gke.io/gcp-service-account=<gcp-sa-email>@${PROJECT}.iam.gserviceaccount.com`
This binds the Kubernetes SA to a GCP service account via Workload Identity.

### Step 5.2 — Inspect Workload Identity IAM Binding

**gcloud:**
```bash
# Get the GCP service account email from the k8s SA annotation
export GCP_SA=$(kubectl get serviceaccount -n "${NAMESPACE}" \
  $(kubectl get sa -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}') \
  -o jsonpath='{.metadata.annotations.iam\.gke\.io/gcp-service-account}')

echo "GCP SA: ${GCP_SA}"

# List IAM roles for this service account
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

### Step 5.3 — Verify the Workload Identity Binding on the GCP SA

**gcloud:**
```bash
gcloud iam service-accounts get-iam-policy "${GCP_SA}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.bindings[] | select(.role == "roles/iam.workloadIdentityUser")'
```

**Expected result:** The binding shows `serviceAccount:${PROJECT}.svc.id.goog[${NAMESPACE}/<k8s-sa-name>]` as a member with `roles/iam.workloadIdentityUser`, confirming Workload Identity federation is correctly configured.

### Step 5.4 — Inspect Kubernetes Secrets

**kubectl:**
```bash
kubectl get secrets -n "${NAMESPACE}" \
  --field-selector type=Opaque \
  -o custom-columns="NAME:.metadata.name,TYPE:.type,AGE:.metadata.creationTimestamp"
```

**Expected result:** Kubernetes Secrets are listed for DB credentials and other sensitive configuration. Secret values are base64-encoded and never stored in plaintext in the cluster.

### Step 5.5 — Verify Secrets Store CSI Integration

**kubectl:**
```bash
kubectl get secretproviderclass -n "${NAMESPACE}" 2>/dev/null || echo "Secrets Store CSI not configured in this deployment"

# Check if secrets are mounted as files
kubectl exec "${GHOST_POD}" -n "${NAMESPACE}" -c ghost -- \
  ls /run/secrets/ 2>/dev/null || echo "No mounted secret files"
```

**Expected result:** If the Secrets Store CSI driver is enabled, a `SecretProviderClass` resource exists and secrets from Secret Manager are mounted as files into the pod.

---

## Exercise 6 — Cloud Logging

### Objective

Query Ghost application logs, filter for Kubernetes container logs, inspect HTTP access
patterns, and investigate error events using Cloud Logging.

### Step 6.1 — View Ghost Application Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"ghost\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp, jsonPayload.message)"
```

**kubectl (live logs):**
```bash
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=ghost -o jsonpath='{.items[0].metadata.name}')" \
  -c ghost --tail=30
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND resource.labels.container_name=\"ghost\"",
    "orderBy": "timestamp desc",
    "pageSize": 20
  }' | jq '.entries[] | {timestamp: .timestamp, message: .jsonPayload.message}'
```

**Expected result:** Ghost startup logs appear, including `Ghost boot 6.x.x` banner and database connection messages.

### Step 6.2 — View Cloud SQL Auth Proxy Logs

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
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=ghost -o jsonpath='{.items[0].metadata.name}')" \
  -c cloud-sql-proxy --tail=20
```

**Expected result:** Cloud SQL Auth Proxy logs show connection establishment to the MySQL instance via Unix socket.

### Step 6.3 — Filter for Errors

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, severity, jsonPayload.message)"
```

**Expected result:** Under normal operation, no critical errors appear after startup completes. Warnings may appear during first-boot database migrations.

### Step 6.4 — Query for HTTP Access Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND jsonPayload.message=~\"GET|POST\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {timestamp: .timestamp, message: .jsonPayload.message}'
```

**Expected result:** HTTP access log entries show GET requests served by Ghost, including response status codes and request paths.

### Step 6.5 — Navigate to Logs Explorer

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22k8s_container%22%0Aresource.labels.namespace_name%3D%22${NAMESPACE}%22?project=${PROJECT}"
```

**Expected result:** The Logs Explorer opens pre-filtered to the Ghost namespace, enabling interactive log exploration.

---

## Exercise 7 — Cloud Monitoring

### Objective

Explore GKE container metrics for Ghost, review uptime check status, and inspect the
pre-configured alert policies for the deployment.

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
  --format="table(name)"
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

**Expected result:** CPU utilization for the Ghost container is near zero under no-load conditions and increases during content publishing or page rendering.

### Step 7.2 — View Pod Restart Count

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}" \
  -o custom-columns="NAME:.metadata.name,RESTARTS:.status.containerStatuses[0].restartCount,STATUS:.status.phase"
```

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch k8s_pod::kubernetes.io/pod/restart_count | filter resource.namespace_name = \"'"${NAMESPACE}"'\" | within 1h | group_by [resource.pod_name], max(val())"
  }' | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, restarts: .pointData[-1].values[0].int64Value}'
```

**Expected result:** Restart count is `0` under normal operation. Frequent restarts indicate resource pressure or health probe failures.

### Step 7.3 — Review the Uptime Check

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

**Expected result:** An uptime check polls Ghost at `GET /` every 60 seconds from multiple global regions and shows **Passing** status.

### Step 7.4 — View the GKE Monitoring Dashboard

```bash
echo "https://console.cloud.google.com/kubernetes/clusters/details/${REGION}/${CLUSTER}/observability?project=${PROJECT}"
```

Explore:
- **Workloads** — CPU, memory, and network for the Ghost deployment
- **Nodes** — Autopilot node provisioning and resource consumption
- **Logs** — Integrated log streaming from the dashboard

**Expected result:** The GKE monitoring dashboard shows the Ghost deployment health with real-time metrics.

---

## Exercise 8 — Scaling and Operations

### Objective

Scale the Ghost deployment horizontally, trigger a rolling update, observe HPA behavior,
and practice rollback procedures.

### Step 8.1 — Scale the Deployment Manually

**kubectl:**
```bash
# Scale to 2 replicas
kubectl scale deployment -n "${NAMESPACE}" \
  $(kubectl get deployment -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}') \
  --replicas=2

# Watch pods coming up
kubectl get pods -n "${NAMESPACE}" -w
```

**gcloud (via Cloud Console):**
```bash
echo "https://console.cloud.google.com/kubernetes/workload/${REGION}/${CLUSTER}/${NAMESPACE}/ghost?project=${PROJECT}"
```

**Expected result:** A second Ghost pod starts within 60–90 seconds. Both pods share the NFS content volume, so content created on one pod is immediately available on the other.

### Step 8.2 — Observe HPA Behavior

**kubectl:**
```bash
kubectl get hpa -n "${NAMESPACE}" -w
```

```bash
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** The HPA shows current CPU utilization and may scale down to `min_instance_count=1` when load is low, overriding the manual scale if CPU drops below the target.

### Step 8.3 — Trigger a Rolling Update

```bash
DEPLOY_NAME=$(kubectl get deployment -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')

# Trigger a rolling update by updating an environment variable
kubectl set env "deployment/${DEPLOY_NAME}" \
  APP_LAB_VERSION=lab-test \
  -n "${NAMESPACE}"

# Watch the rolling update
kubectl rollout status "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"
```

**Expected result:** The rolling update replaces pods one at a time (respecting the PodDisruptionBudget), ensuring zero downtime. Both old and new pods run briefly during the transition.

### Step 8.4 — Rollback the Deployment

```bash
# View rollout history
kubectl rollout history "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"

# Rollback to the previous revision
kubectl rollout undo "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"

kubectl rollout status "deployment/${DEPLOY_NAME}" -n "${NAMESPACE}"
```

**REST API (get deployment details):**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.status.conditions[] | {type: .type, status: .status}'
```

**Expected result:** The rollback completes successfully and the previous revision is restored. The Ghost service continues to serve traffic throughout.

### Step 8.5 — Return to Minimum Replicas

```bash
kubectl scale deployment -n "${NAMESPACE}" "${DEPLOY_NAME}" --replicas=1

kubectl get pods -n "${NAMESPACE}"
```

**Expected result:** One pod terminates gracefully. The remaining pod continues serving traffic. The Ghost content on NFS persists unchanged.

---

## 13. Cleanup

Return to the RAD UI and click **Undeploy** on the `Ghost_GKE` deployment. This removes
the Kubernetes namespace and all workloads, Cloud SQL instance, NFS Filestore, GCS buckets,
Secret Manager secrets, Workload Identity bindings, and all associated IAM resources.

> **Warning:** This permanently deletes all resources including the database and NFS content.
> Export Ghost content before undeploying: Ghost Admin → Settings → Labs → Export.

### Manual Cleanup (if needed)

**kubectl:**
```bash
# Delete the namespace and all its resources
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Cloud SQL instance
gcloud sql instances delete "${SQL_INSTANCE}" \
  --project="${PROJECT}" --quiet

# Delete secrets
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet
```

**REST API — delete Cloud SQL instance:**
```bash
curl -s -X DELETE \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## 14. Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID (required) |
| `region` | `string` | `us-central1` | GCP region for all resources |
| `application_name` | `string` | `ghost` | Base resource name |
| `application_version` | `string` | `6.14.0` | Ghost container image tag |
| `tenant_deployment_id` | `string` | `demo` | Short suffix appended to resource names |
| `deploy_application` | `bool` | `true` | Deploy the Ghost workload (false = infra only) |
| `gke_cluster_name` | `string` | `""` | Target GKE cluster name (auto-discovered if empty) |
| `cpu_limit` | `string` | `2000m` | CPU per Ghost pod |
| `memory_limit` | `string` | `4Gi` | Memory per Ghost pod |
| `min_instance_count` | `number` | `1` | HPA minimum replicas |
| `max_instance_count` | `number` | `5` | HPA maximum replicas |
| `enable_nfs` | `bool` | `true` | Cloud Filestore NFS for shared content |
| `nfs_mount_path` | `string` | `/mnt/nfs` | NFS mount path inside containers |
| `enable_redis` | `bool` | `true` | Redis page caching |
| `redis_host` | `string` | `""` | Redis hostname (blank = NFS server IP) |
| `redis_port` | `string` | `6379` | Redis TCP port |
| `db_name` | `string` | `ghost` | MySQL database name |
| `db_user` | `string` | `ghost` | MySQL application user |
| `database_password_length` | `number` | `32` | Auto-generated password length |
| `enable_auto_password_rotation` | `bool` | `false` | Automated DB password rotation |
| `enable_cloudsql_volume` | `bool` | `true` | Cloud SQL Auth Proxy sidecar |
| `backup_schedule` | `string` | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | `number` | `7` | Days to retain backup files |
| `support_users` | `list(string)` | `[]` | Email addresses for monitoring alerts |
| `resource_labels` | `map(string)` | `{}` | Labels applied to all provisioned resources |

### Useful Commands Reference

```bash
# Get Ghost external IP
kubectl get svc -n "${NAMESPACE}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# View Ghost pod logs
kubectl logs -n "${NAMESPACE}" -l app=ghost -c ghost --tail=50

# Tail Ghost logs live
kubectl logs -n "${NAMESPACE}" -l app=ghost -c ghost -f

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

# View GCP service account IAM
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${GCP_SA}" \
  --format="table(bindings.role)"

# List Cloud SQL instances
gcloud sql instances list --project="${PROJECT}"
```

### Further Reading

- [Ghost documentation](https://ghost.org/docs/)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy for GKE](https://cloud.google.com/sql/docs/mysql/connect-kubernetes-engine)
- [Kubernetes Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Cloud Filestore NFS for GKE](https://cloud.google.com/filestore/docs/accessing-fileshares)
- [Secret Manager with GKE Workload Identity](https://cloud.google.com/secret-manager/docs/using-other-products/google-kubernetes-engine)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
