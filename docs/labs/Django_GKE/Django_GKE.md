---
title: "Django on GKE — Lab Guide"
sidebar_label: "Django GKE"
---

# Django on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Django_GKE)**

This lab guide walks you through deploying, exploring, and operating a production-ready **Django** application on Google Kubernetes Engine (GKE) Autopilot using the **Django_GKE** module. You will explore Kubernetes workloads, Cloud SQL PostgreSQL, Workload Identity, GCS Fuse storage, and the full observability stack including Cloud Logging, Cloud Monitoring, and horizontal pod scaling.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access the Application](#exercise-1--access-the-application)
6. [Exercise 2 — Explore Kubernetes Workloads](#exercise-2--explore-kubernetes-workloads)
7. [Exercise 3 — Database and Migrations](#exercise-3--database-and-migrations)
8. [Exercise 4 — Static Files and Media Storage](#exercise-4--static-files-and-media-storage)
9. [Exercise 5 — Workload Identity and Security](#exercise-5--workload-identity-and-security)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring](#exercise-7--cloud-monitoring)
12. [Exercise 8 — Scaling and Rolling Updates](#exercise-8--scaling-and-rolling-updates)
13. [Cleanup](#13-cleanup)
14. [Reference](#14-reference)

---

## 1. Overview

### What Is Django on GKE?

Django is the most mature Python web framework, used by 35,570+ companies including Instagram, Spotify, Dropbox, and NASA. The `Django_GKE` module deploys a production-ready Django application on GKE Autopilot, backed by a managed Cloud SQL PostgreSQL 15 instance, Secret Manager for all credentials, Cloud Filestore NFS for shared media storage across pod replicas, and GCS media storage.

The module builds a custom container image via Cloud Build, creates a Kubernetes Deployment, Service, and HPA, and runs `db-init` and `db-migrate` Kubernetes Jobs before the Django pods start. Workload Identity binds the Kubernetes service account to a GCP service account, enabling pod-level GCP API access without stored credentials.

Unlike Cloud Run, GKE gives you persistent pods, explicit replica control, HPA-based scaling, and direct access to the full Kubernetes API for debugging and operations.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Serverless Kubernetes nodes with automatic provisioning and security hardening |
| **Workload Identity** | Pod-level GCP IAM access without service account key files |
| **Cloud SQL Auth Proxy** | Sidecar injection for secure Unix socket database connections |
| **HPA** | Horizontal Pod Autoscaler for CPU-based scaling |
| **Kubernetes Jobs** | `db-init` and `db-migrate` run sequentially at deploy time |
| **GCS Fuse CSI** | GCS bucket mounted as a container filesystem via the GCS Fuse CSI driver |
| **Filestore NFS** | Shared persistent storage accessible by all pod replicas via RWX PVC |

---

## 2. Architecture

```
Internet
   │
   ▼ HTTP
LoadBalancer Service (External IP)
   │
   ▼
Django Pods (Deployment)
   ├── Django container (Gunicorn, port 8080, UID 2000)
   │     ├── NFS mount: /mnt/nfs (Filestore RWX PVC)
   │     ├── GCS Fuse: /app/media (GCS CSI driver)
   │     └── DB: DATABASE_URL from env → Auth Proxy socket
   └── cloud-sql-proxy sidecar
         └── Unix socket /cloudsql/PROJECT:REGION:INSTANCE
               │
               ▼
         Cloud SQL (PostgreSQL 15)
               Database: gkeapp (or django_db)
               User: gkeapp (or django_user)

Init Jobs (run before pods):
  db-init    → postgres:15-alpine → creates DB + user + extensions
  db-migrate → app image         → manage.py migrate + collectstatic

Supporting Services:
  Secret Manager   → SECRET_KEY, DB_PASSWORD, ROOT_PASSWORD
  GCS Bucket       → django-media (objectAdmin via Workload Identity)
  Filestore NFS    → Bound PVC (RWX) shared across pod replicas
  Artifact Registry → Custom Django image (Cloud Build)
  Cloud Monitoring  → Uptime checks, alert policies
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GKE Autopilot Cluster                                     │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Namespace: appdjango<tenant><deployment_id>         │  │  │
│  │  │                                                      │  │  │
│  │  │  Deployment: django (2/2 containers)                 │  │  │
│  │  │  Service: LoadBalancer (EXTERNAL-IP)                 │  │  │
│  │  │  HPA: min 0, max 1 replicas                          │  │  │
│  │  │  PVC: NFS mount (RWX, Filestore)                     │  │  │
│  │  │  Jobs: db-init, db-migrate                           │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │  Cloud SQL     │  │  Secret Manager │  │  Cloud Filestore │   │
│  │  PostgreSQL 15 │  │  SECRET_KEY     │  │  NFS (RWX)       │   │
│  └────────────────┘  └────────────────┘  └──────────────────┘   │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐                         │
│  │  GCS Bucket    │  │  Cloud Monitor  │                         │
│  │  django-media  │  │  Uptime + Alerts│                         │
│  └────────────────┘  └────────────────┘                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install/Command |
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
roles/monitoring.admin
roles/logging.viewer
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

Deploy the `Django_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `tenant_deployment_id` | `demo` | Short environment label |
| `application_name` | `django` | Do not change after first deploy |
| `application_version` | `latest` | Pin to a specific tag in production |
| `min_instance_count` | `0` | Minimum pod replicas |
| `max_instance_count` | `1` | Maximum pod replicas |
| `application_database_name` | `gkeapp` | PostgreSQL database name |
| `application_database_user` | `gkeapp` | PostgreSQL application user |
| `enable_nfs` | `true` | Shared NFS for media files |
| `enable_redis` | `false` | Set `true` to enable Redis caching |

Click **Deploy** and wait for provisioning to complete (approximately 15–30 minutes).

> **What this provisions:** GKE namespace, Kubernetes Deployment, Service, HPA, Cloud Build custom Django image, Cloud SQL PostgreSQL 15 instance with application database and user, `db-init` and `db-migrate` Kubernetes Jobs, Secret Manager secrets, GCS media bucket, Filestore NFS instance, Workload Identity binding, static external IP, Cloud Monitoring uptime check, and alert policies.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Discover the admin password secret
export ADMIN_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~admin-password" \
  --format="value(name)" \
  --limit=1)

# Discover the GCS media bucket
export BUCKET=$(gcloud storage buckets list \
  --project=${PROJECT} \
  --format="value(name)" \
  --filter="name~django" \
  --limit=1)

echo "Cluster: ${CLUSTER}"
```

### 4.3 Configure kubectl

```bash
# Fetch cluster credentials
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Verify the context
kubectl config current-context

# Discover the Django namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appdjango" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null)

echo "Namespace:   ${NAMESPACE}"
echo "External IP: ${EXTERNAL_IP}"
```

---

## Exercise 1 — Access the Application

### Objective

Use kubectl to get the external service IP, open the Django application in a browser, and log in to Django Admin.

### Step 1.1 — Get the Service External IP

**kubectl:**
```bash
kubectl get service -n ${NAMESPACE}
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project=${PROJECT} \
  --filter="region:${REGION}" \
  --format="table(name, IPAddress, target)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, endpoint}'
```

**Expected result:** A `LoadBalancer` service with an `EXTERNAL-IP` assigned.

```
NAME     TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)        AGE
django   LoadBalancer   10.96.100.50   34.123.45.67   80:31234/TCP   10m
```

### Step 1.2 — Open the Application

```bash
echo "Application URL: http://${EXTERNAL_IP}"
```

Open `http://${EXTERNAL_IP}` in your browser.

**Expected result:** The Django application home page loads.

### Step 1.3 — Retrieve the Admin Password

```bash
# List secrets for this deployment
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="table(name)"

# Retrieve the admin password
gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project=${PROJECT}
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${ADMIN_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 --decode
```

**Expected result:** The admin password is printed to stdout.

### Step 1.4 — Log In to Django Admin

Navigate to `http://${EXTERNAL_IP}/admin` in your browser. Log in with username `admin` and the password retrieved in Step 1.3.

**Expected result:** The Django administration dashboard appears.

---

## Exercise 2 — Explore Kubernetes Workloads

### Objective

Inspect the Django Deployment, pods, Services, and ReplicaSets to understand the Kubernetes resource hierarchy.

### Step 2.1 — List Pods

```bash
kubectl get pods -n ${NAMESPACE} -o wide
```

**Expected result:** One or more pods with `2/2 READY` (Django container + Cloud SQL Auth Proxy sidecar).

```
NAME                      READY   STATUS    RESTARTS   AGE
django-7d9f8b6c4-xq2pj   2/2     Running   0          10m
```

### Step 2.2 — Inspect the Deployment

```bash
kubectl describe deployment django -n ${NAMESPACE}
```

Key fields to note:
- **Image:** the custom Django image URI in Artifact Registry
- **Replicas:** current vs. desired count
- **Environment variables:** `DB_HOST`, `DB_NAME`, `DB_USER`, `SECRET_KEY` references
- **Volume mounts:** NFS at `/mnt/nfs` and optional GCS Fuse mount

```bash
# View environment variables injected into the Django container
kubectl get deployment django -n ${NAMESPACE} \
  -o jsonpath='{.spec.template.spec.containers[0].env}' | jq .
```

### Step 2.3 — List Services

```bash
kubectl get services -n ${NAMESPACE}
```

**Expected result:** A `LoadBalancer` service exposing port 80 and a ClusterIP for internal access.

### Step 2.4 — List ReplicaSets

```bash
kubectl get replicasets -n ${NAMESPACE}
```

**Expected result:** One active ReplicaSet managing the current pods, and previous ReplicaSets (with 0 replicas) from prior deployments.

### Step 2.5 — Check the Horizontal Pod Autoscaler

```bash
kubectl get hpa -n ${NAMESPACE}

kubectl describe hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current and desired replica counts, along with CPU utilisation percentages and configured min/max bounds.

---

## Exercise 3 — Database and Migrations

### Objective

Inspect the Cloud SQL PostgreSQL instance, verify the `db-init` job completed successfully, review migration logs, and list databases.

### Step 3.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
gcloud sql instances list --project=${PROJECT}

# Describe the instance
export SQL_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe ${SQL_INSTANCE} \
  --project=${PROJECT} \
  --format="table(name, databaseVersion, state, settings.tier)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, state, databaseVersion, region}'
```

**Expected result:** A PostgreSQL 15 instance in `RUNNABLE` state.

### Step 3.2 — Verify the db-init Job Completed

```bash
kubectl get jobs -n ${NAMESPACE}
```

**Expected result:** The `db-init` job shows `COMPLETIONS: 1/1`:

```
NAME      COMPLETIONS   DURATION   AGE
db-init   1/1           45s        10m
```

### Step 3.3 — View db-init Job Logs

```bash
kubectl logs job/db-init -n ${NAMESPACE}
```

**Expected result:** Log output showing database creation, user creation, privilege grants, and PostgreSQL extension installation (`pg_trgm`, `unaccent`, `hstore`, `citext`).

### Step 3.4 — Check db-migrate Job

```bash
kubectl get jobs -n ${NAMESPACE}

# View migration logs
kubectl logs job/db-migrate -n ${NAMESPACE} 2>/dev/null || \
  kubectl logs -n ${NAMESPACE} -l job-name=db-migrate --tail=50
```

**Expected result:** Log output showing Django migration steps (`python manage.py migrate`) and `collectstatic` output, ending with `0 unapplied migration(s)`.

### Step 3.5 — List Databases in Cloud SQL

**gcloud:**
```bash
gcloud sql databases list \
  --instance=${SQL_INSTANCE} \
  --project=${PROJECT}
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}/databases" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, charset}'
```

**Expected result:** The application database (`gkeapp` or `django_db`) appears alongside the default `postgres` database.

---

## Exercise 4 — Static Files and Media Storage

### Objective

Explore the GCS media bucket, verify the GCS Fuse mount inside the Django pod, test a file upload through Django Admin, and check the NFS mount.

### Step 4.1 — Explore the GCS Bucket

**gcloud:**
```bash
gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="table(name, location, storageClass)"

# List bucket contents
gcloud storage ls gs://${BUCKET}/
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | select(.name | test("django")) | {name, location, storageClass}'
```

**Expected result:** A GCS bucket with a `django-media` suffix exists. It may contain directories for static assets or uploaded media.

### Step 4.2 — Verify GCS Fuse Mount Inside the Pod

```bash
export POD=$(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')

# Check for fuse filesystem mounts
kubectl exec -n ${NAMESPACE} ${POD} -c django -- df -h | grep fuse
```

**Expected result:** A GCS Fuse filesystem entry appears, mounted at the configured media path.

### Step 4.3 — Test File Upload Through Django Admin

1. In the Django Admin interface, navigate to a model that supports file attachments.
2. Upload a test image or document.
3. After saving, verify the file appeared in the GCS bucket:

```bash
gcloud storage ls -r gs://${BUCKET}/
```

**Expected result:** The uploaded file appears in the GCS bucket under the media directory path.

### Step 4.4 — Check the NFS Mount

The Filestore NFS mount at `/mnt/nfs` provides shared persistent storage across all pod replicas:

```bash
# Check NFS mount inside the pod
kubectl exec -n ${NAMESPACE} ${POD} -c django -- df -h /mnt/nfs

# Check PVC status
kubectl get pvc -n ${NAMESPACE}
```

**Expected result:** An NFS filesystem appears mounted from the Filestore instance IP. The PVC shows `STATUS: Bound` with `ACCESS MODES: RWX` (ReadWriteMany).

---

## Exercise 5 — Workload Identity and Security

### Objective

Verify the Workload Identity binding between the Kubernetes service account and GCP service account, inspect IAM bindings, and confirm secure secret access from within the pod.

### Step 5.1 — List Kubernetes Service Accounts

```bash
kubectl get serviceaccounts -n ${NAMESPACE}

# Show annotations (Workload Identity binding)
kubectl get serviceaccount -n ${NAMESPACE} \
  -o yaml | grep -A5 "annotations:"
```

**Expected result:** The Django Kubernetes service account has an annotation `iam.gke.io/gcp-service-account` pointing to a GCP service account. This is the Workload Identity binding.

### Step 5.2 — Check GCP Service Account IAM Bindings

```bash
# List GCP service accounts
gcloud iam service-accounts list \
  --project=${PROJECT} \
  --filter="email~django OR email~appdjango"

# Get IAM policy for the Django service account
DJANGO_SA=$(gcloud iam service-accounts list \
  --project=${PROJECT} \
  --filter="email~django" \
  --format="value(email)" \
  --limit=1)

gcloud iam service-accounts get-iam-policy ${DJANGO_SA} \
  --project=${PROJECT}
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.accounts[] | select(.email | test("django")) | {email, displayName}'
```

### Step 5.3 — Verify Secret Access from the Pod

```bash
# Confirm DB environment variables are injected
kubectl exec -n ${NAMESPACE} ${POD} -c django -- env | grep -E "^(DB_|SECRET_KEY)"

# Verify Django can connect to the database
kubectl exec -n ${NAMESPACE} ${POD} -c django -- \
  python manage.py check --database default
```

**Expected result:** `DB_HOST`, `DB_NAME`, `DB_USER`, and `SECRET_KEY` are present. The database check passes with no errors.

### Step 5.4 — Inspect Pod Security Context

```bash
kubectl get pod ${POD} -n ${NAMESPACE} \
  -o jsonpath='{.spec.containers[0].securityContext}' | jq .

kubectl get pod ${POD} -n ${NAMESPACE} \
  -o jsonpath='{.spec.securityContext}' | jq .
```

**Expected result:** The Django container runs as a non-root user (UID 2000). GKE Autopilot enforces additional security policies including read-only root filesystem requirements.

---

## Exercise 6 — Cloud Logging

### Objective

Query Cloud Logging for Django application logs, error logs, HTTP access logs, and Cloud SQL Auth Proxy sidecar logs.

### Step 6.1 — View All Namespace Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.cluster_name=\"${CLUSTER}\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\"" \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, severity, textPayload)"
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

### Step 6.2 — Filter Django Application Logs

Use the Cloud Console **Logs Explorer** with these queries:

**Django container logs only:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="django"
```

**Django error logs:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="django"
severity>=ERROR
```

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"django\" \
   AND severity>=ERROR" \
  --project=${PROJECT} \
  --limit=20
```

### Step 6.3 — Query Cloud SQL Auth Proxy Sidecar Logs

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"cloud-sql-proxy\"" \
  --project=${PROJECT} \
  --limit=20

# Or use kubectl directly for live logs
kubectl logs -n ${NAMESPACE} ${POD} -c cloud-sql-proxy --tail=30
```

**Expected result:** The Auth Proxy sidecar shows successful connection to Cloud SQL and the listening socket path.

### Step 6.4 — Inspect Logs via kubectl

```bash
# Django application logs
kubectl logs -n ${NAMESPACE} ${POD} -c django --tail=50

# Follow logs in real-time
kubectl logs -n ${NAMESPACE} -l app=django -c django -f

# View db-init job logs
kubectl logs -n ${NAMESPACE} -l job-name=db-init --tail=30
```

---

## Exercise 7 — Cloud Monitoring

### Objective

Explore the GKE dashboard, view pod CPU and memory metrics, inspect uptime checks, and observe resource utilisation.

### Step 7.1 — Open the GKE Dashboard

```bash
echo "https://console.cloud.google.com/kubernetes/workload?project=${PROJECT}"
```

Navigate to **Monitoring > Dashboards** and select the GKE dashboard. Explore:
- Node CPU and memory utilisation
- Pod count and restart events
- Network ingress/egress
- Container-level resource consumption

### Step 7.2 — View Pod CPU and Memory Metrics

**kubectl top:**
```bash
# Pod resource usage (requires Metrics Server — available on GKE Autopilot)
kubectl top pods -n ${NAMESPACE}

# Node-level resource summary
kubectl top nodes
```

**MQL query for Metrics Explorer:**
```
fetch k8s_container
| metric 'kubernetes.io/container/cpu/core_usage_time'
| filter (resource.namespace_name == '${NAMESPACE}')
| align rate(1m)
| every 1m
```

**REST API (container CPU, last 10 minutes):**
```bash
START=$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=metric.type%3D%22kubernetes.io%2Fcontainer%2Fcpu%2Fcore_usage_time%22%20AND%20resource.labels.namespace_name%3D%22${NAMESPACE}%22&interval.startTime=${START}&interval.endTime=${END}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.timeSeries[] | {container: .resource.labels.container_name, points: (.points | length)}'
```

### Step 7.3 — Check Uptime Checks

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project=${PROJECT} \
  --format="table(displayName, httpCheck.path, period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {displayName, path: .httpCheck.path}'
```

**Expected result:** An uptime check probing `http://${EXTERNAL_IP}/` from multiple global locations, checking every 60 seconds.

### Step 7.4 — GKE Security Posture

```bash
echo "https://console.cloud.google.com/kubernetes/security/dashboard?project=${PROJECT}"
```

The Security Posture Dashboard shows:
- Vulnerability findings in container images
- Kubernetes configuration misconfigurations
- Workload policy violations per namespace

---

## Exercise 8 — Scaling and Rolling Updates

### Objective

Scale the Django Deployment, observe the HPA, trigger a rolling update, and practice rollback.

### Step 8.1 — Scale the Deployment

```bash
# Scale to 3 replicas
kubectl scale deployment django \
  --replicas=3 \
  -n ${NAMESPACE}

# Watch pods come up
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** Three pods reach `Running` status within 1–3 minutes. Each pod shows `2/2 READY` (Django + Auth Proxy sidecar).

**REST API (patch replicas via Kubernetes API):**
```bash
CLUSTER_ENDPOINT=$(gcloud container clusters describe ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(endpoint)")

curl -s -X PATCH \
  "https://${CLUSTER_ENDPOINT}/apis/apps/v1/namespaces/${NAMESPACE}/deployments/django" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/merge-patch+json" \
  -d '{"spec":{"replicas":3}}'
```

### Step 8.2 — Observe HPA Behaviour

```bash
kubectl get hpa -n ${NAMESPACE} -w

# Generate load to trigger HPA
for i in {1..50}; do
  curl -s -o /dev/null "http://${EXTERNAL_IP}/" &
done
wait

kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** As CPU utilisation rises, the HPA increases the desired replica count up to `max_instance_count`.

### Step 8.3 — Trigger a Rolling Update

```bash
# Patch a label annotation to trigger a rolling restart
kubectl patch deployment django -n ${NAMESPACE} \
  -p '{"spec":{"template":{"metadata":{"annotations":{"restartedAt":"'$(date +%Y-%m-%dT%H:%M:%S)'"}}}}}'

# Monitor the rollout
kubectl rollout status deployment/django -n ${NAMESPACE}
```

**Expected result:** Output like `Waiting for deployment "django" rollout to finish: 1 out of 1 new replicas have been updated...` followed by `successfully rolled out`.

### Step 8.4 — Rollback

```bash
# View rollout history
kubectl rollout history deployment/django -n ${NAMESPACE}

# Roll back to the previous version
kubectl rollout undo deployment/django -n ${NAMESPACE}

# Confirm rollback
kubectl rollout status deployment/django -n ${NAMESPACE}
kubectl get pods -n ${NAMESPACE}
```

### Step 8.5 — Scale Back Down

```bash
kubectl scale deployment django \
  --replicas=1 \
  -n ${NAMESPACE}

kubectl get pods -n ${NAMESPACE}
```

---

## 13. Cleanup

Return to the RAD UI and click **Undeploy** on the `Django_GKE` deployment. This removes the Kubernetes namespace and all workloads, Cloud SQL database and user, Secret Manager secrets, GCS buckets, Filestore NFS instance, static IP reservation, and Cloud Monitoring checks.

### Manual Cleanup (if needed)

**kubectl:**
```bash
# Delete the namespace (removes all workloads)
kubectl delete namespace ${NAMESPACE}
```

**gcloud:**
```bash
# Delete secrets (confirm names first)
gcloud secrets list --project=${PROJECT} --filter="name~django"
gcloud secrets delete <secret-name> --project=${PROJECT} --quiet

# Delete GCS bucket
gsutil -m rm -r gs://${BUCKET}

# Delete static IP reservation
gcloud compute addresses list \
  --project=${PROJECT} \
  --filter="name~django"
gcloud compute addresses delete <address-name> \
  --global --project=${PROJECT} --quiet
```

> **Note:** Resources provisioned by the `Services_GCP` module (VPC, shared Cloud SQL instance, GKE cluster, Filestore) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## 14. Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `tenant_deployment_id` | string | `demo` | Short environment label; embedded in resource names |
| `application_name` | string | `django` | Base resource name; do not change after first deploy |
| `application_version` | string | `latest` | Container image version tag |
| `deploy_application` | bool | `true` | Set `false` for infrastructure-only deployment |
| `min_instance_count` | number | `0` | Minimum pod replicas (0 = scale-to-zero) |
| `max_instance_count` | number | `1` | Maximum pod replicas |
| `container_resources` | object | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits per pod |
| `container_port` | number | `8080` | Django Gunicorn listening port |
| `gke_cluster_name` | string | `""` | Target cluster name (empty = auto-discover) |
| `application_database_name` | string | `gkeapp` | PostgreSQL database name (do not change after deploy) |
| `application_database_user` | string | `gkeapp` | PostgreSQL application user |
| `enable_nfs` | bool | `true` | NFS shared storage for media files |
| `nfs_mount_path` | string | `/mnt/nfs` | Container path for NFS mount |
| `enable_redis` | bool | `false` | Inject `REDIS_HOST`/`REDIS_PORT` env vars |
| `redis_host` | string | `""` | Redis server hostname or IP |
| `session_affinity` | string | `ClientIP` | Route requests from same IP to same pod |
| `enable_cloudsql_volume` | bool | `true` | Inject Cloud SQL Auth Proxy sidecar |
| `backup_schedule` | string | `0 2 * * *` | Cron expression for automated backups (UTC) |
| `rotation_propagation_delay_sec` | number | `90` | Seconds to wait after password rotation before pod restart |

### Useful Commands Reference

```bash
# Get pods
kubectl get pods -n ${NAMESPACE}

# Get service external IP
kubectl get service -n ${NAMESPACE}

# View deployment
kubectl describe deployment django -n ${NAMESPACE}

# View HPA
kubectl get hpa -n ${NAMESPACE}

# Scale deployment
kubectl scale deployment django --replicas=3 -n ${NAMESPACE}

# Rolling restart
kubectl rollout restart deployment/django -n ${NAMESPACE}

# Rollback
kubectl rollout undo deployment/django -n ${NAMESPACE}

# View application logs
kubectl logs -n ${NAMESPACE} -l app=django -c django --tail=50

# View auth proxy logs
kubectl logs -n ${NAMESPACE} ${POD} -c cloud-sql-proxy --tail=20

# Exec into pod
kubectl exec -it ${POD} -n ${NAMESPACE} -c django -- bash

# Check DB environment variables
kubectl exec -n ${NAMESPACE} ${POD} -c django -- env | grep -E "^(DB_|SECRET_KEY)"

# View Cloud SQL instances
gcloud sql instances list --project=${PROJECT}

# List secrets
gcloud secrets list --project=${PROJECT} --filter="name~django"
```

### Further Reading

- [Django on GKE — Configuration Guide](https://docs.radmodules.dev/docs/modules/Django_GKE)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity documentation](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [GCS Fuse CSI driver](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/cloud-storage-fuse-csi-driver)
- [Cloud SQL Auth Proxy for GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
