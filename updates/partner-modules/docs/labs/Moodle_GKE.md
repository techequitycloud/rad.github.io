# Moodle on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_GKE)**

This lab guide walks you through deploying, exploring, and operating **Moodle 4.5** on
Google Kubernetes Engine Autopilot with the **Moodle_GKE** module. You will explore the
world's most popular open-source LMS on Kubernetes, including course creation, user management,
Workload Identity, HPA-based scaling, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Moodle](#exercise-1--access-moodle)
6. [Exercise 2 — Create a Course and Learning Activities](#exercise-2--create-a-course-and-learning-activities)
7. [Exercise 3 — User Management](#exercise-3--user-management)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is Moodle?

Moodle is the world's most popular open-source Learning Management System (LMS), used by
educational institutions, corporations, and governments worldwide to deliver online courses
and training programs. It supports quizzes, assignments, forums, grading, and a rich plugin
ecosystem. The `Moodle_GKE` module deploys **Moodle 4.5** on GKE Autopilot, backed by
Cloud SQL PostgreSQL 15, Cloud Filestore NFS for shared moodledata, Redis session caching,
Workload Identity for keyless GCP access, and a Kubernetes Gateway with static IP.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot LMS** | Managed Kubernetes hosting Apache + PHP 8.3 + Moodle with HPA scaling |
| **NFS Persistence** | Cloud Filestore NFS (`/mnt`) for shared moodledata across pod replicas |
| **Workload Identity** | Keyless GCP access binding Kubernetes SA to GCP SA |
| **Private Database** | Cloud SQL PostgreSQL 15 with Cloud SQL Auth Proxy sidecar in pod |
| **Redis Sessions** | Redis session storage for Moodle with `moodle_prod_sess_` key prefix |
| **Static IP Gateway** | Kubernetes Gateway API with reserved static external IP |
| **Cloud Scheduler Cron** | Cloud Scheduler triggering Moodle cron every 5 minutes |
| **Observability** | Cloud Logging (GKE container logs) and Cloud Monitoring (K8s metrics) |

---

## 2. Architecture

```
Browser / Student / Admin
         │
         ▼
Kubernetes LoadBalancer Service (moodle, port 80/443)
  └── static external IP (reserved via Gateway API)
         │
         ▼
GKE Autopilot Pod (moodle)
  ├── Apache 2 + PHP 8.3 + Moodle 4.5
  ├── Cloud SQL Auth Proxy sidecar
  ├── NFS volume mount: /mnt (moodledata)
  ├── Startup probe: HTTP /health.php
  ├── Liveness probe: HTTP /health.php
  └── Workload Identity (GCP SA binding)
         │
         ├── Cloud SQL PostgreSQL 15 (Auth Proxy socket)
         │     └── database: moodle, user: moodle
         │         extension: pg_trgm
         │
         ├── Cloud Filestore NFS (/mnt)
         │     └── filedir/, temp/, cache/, localcache/
         │         (www-data ownership, 2770 permissions)
         │
         ├── Redis (session storage)
         │     └── MOODLE_REDIS_ENABLED=true
         │
         ├── Cloud Storage (moodle-media)
         │     └── GCS Fuse for themes/plugins
         │
         └── Secret Manager
               ├── DB password
               ├── cron password (MOODLE_CRON_PASSWORD)
               └── SMTP password (MOODLE_SMTP_PASSWORD)

Cloud Scheduler
  └── moodle-cron → POST /admin/cron.php (every 5 minutes)
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  GKE Autopilot Cluster                                    │   │
│  │                                                           │   │
│  │  ┌───────────────────────────────────────────────────┐   │    │
│  │  │  appmoodle<tenant><id> namespace                   │   │   │
│  │  │  ┌────────────────────────────────────────────┐   │   │    │
│  │  │  │  Deployment: moodle                         │   │   │   │
│  │  │  │  replicas: 0–5 (HPA-managed)                │   │   │   │
│  │  │  │  Containers: moodle + cloudsql-proxy         │   │   │  │
│  │  │  │  ServiceAccount: moodle (Workload Identity)  │   │   │  │
│  │  │  └────────────────────────────────────────────┘   │   │    │
│  │  │  ┌────────────────────────────────────────────┐   │   │    │
│  │  │  │  Service: moodle (LoadBalancer, port 80)    │   │   │   │
│  │  │  │  static external IP (Gateway API)           │   │   │   │
│  │  │  └────────────────────────────────────────────┘   │   │    │
│  │  │  ┌────────────────────────────────────────────┐   │   │    │
│  │  │  │  HPA: moodle (min=0, max=5)                  │   │   │  │
│  │  │  │  Jobs: db-init (completed), nfs-init (done)  │   │   │  │
│  │  │  └────────────────────────────────────────────┘   │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │  Cloud SQL        │  │  Filestore  │  │  Secret Manager      ││
│  │  PostgreSQL 15    │  │  NFS /mnt   │  │  (admin, cron, smtp) ││
│  │  (Auth Proxy)     │  │             │  │                      ││
│  └──────────────────┘  └─────────────┘  └──────────────────────┘ │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐│
│  │  Cloud Logging │  │  Cloud         │  │  Cloud Scheduler     ││
│  │  (k8s_         │  │  Monitoring    │  │  (moodle-cron)       ││
│  │   container)   │  │  (K8s metrics) │  │                      ││
│  └────────────────┘  └────────────────┘  └──────────────────────┘│
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Moodle_GKE
    application_version   = "4.5.1"     → Ubuntu + PHP 8.3 + Moodle 4.5
    enable_nfs            = true         → Cloud Filestore at /mnt (required)
    enable_redis          = true         → Redis session storage
    min_instance_count    = 0            → HPA can scale to zero
    max_instance_count    = 5            → horizontal scaling
    enable_custom_domain  = true         → Gateway API static IP
    reserve_static_ip     = true         → persistent external IP
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
roles/file.editor
roles/iam.serviceAccountAdmin
roles/cloudscheduler.admin
roles/monitoring.admin
roles/logging.admin
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

# Configure kubectl
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

# Discover the Moodle namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appmoodle" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the admin secret
export ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~moodle-admin" \
  --format="value(name)" \
  --limit=1)

export MOODLE_URL="http://${EXTERNAL_IP}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Moodle_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `moodle` | Base name for K8s resources |
| `application_version` | `4.5.1` | Moodle version |
| `min_instance_count` | `0` | HPA minimum (can scale to zero) |
| `max_instance_count` | `5` | HPA maximum replicas |
| `cpu_limit` | `2000m` | CPU per pod |
| `memory_limit` | `4Gi` | Memory per pod |
| `db_name` | `moodle` | PostgreSQL database |
| `db_user` | `moodle` | PostgreSQL user |
| `enable_redis` | `true` | Redis session caching |
| `enable_nfs` | `true` | NFS for moodledata (required) |
| `enable_custom_domain` | `true` | Gateway API with static IP |
| `reserve_static_ip` | `true` | Reserve persistent external IP |

Click **Deploy** and wait approximately 24–40 minutes.

> **What this provisions:** GKE namespace, Moodle Deployment with Cloud SQL Auth Proxy sidecar,
> Cloud SQL PostgreSQL 15 with pg_trgm, Cloud Filestore NFS, db-init and nfs-init Jobs,
> LoadBalancer Service with static IP, HPA, Workload Identity, Secret Manager secrets,
> Cloud Scheduler cron job, GCS bucket, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

Set the shell variables from Section 3 and verify:

```bash
# Confirm cluster and credentials
kubectl cluster-info
kubectl get nodes
```

### 4.3 Configure kubectl

```bash
# Get cluster credentials
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

# Discover namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appmoodle" | head -1)
echo "Namespace: ${NAMESPACE}"

# Verify pods
kubectl get pods -n "${NAMESPACE}"

# Get external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "Moodle URL: http://${EXTERNAL_IP}"
```

---

## Exercise 1 — Access Moodle

### Objective

Use kubectl to find the external IP, verify the Moodle pod is running, retrieve admin
credentials, and complete the initial Moodle setup.

### Step 1.1 — Verify Pods and Services

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"
# Expected: moodle-xxxxxxxxx-xxxxx  2/2  Running (moodle + cloudsql-proxy sidecars)

kubectl get svc -n "${NAMESPACE}"
# Copy the EXTERNAL-IP value

kubectl get jobs -n "${NAMESPACE}"
# db-init and nfs-init should show Completed
```

**gcloud:**
```bash
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="name~moodle"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("moodle")) | {name, address, status}'
```

**Expected result:** Pod shows `2/2` ready (moodle container + cloudsql-proxy sidecar). Service has an external IP assigned.

### Step 1.2 — Monitor Pod Startup

Moodle installs its database schema on first boot (5–10 minutes):

```bash
kubectl logs -n "${NAMESPACE}" -l app=moodle -c moodle -f --tail=30
```

Watch for `Apache/PHP ready` messages indicating Moodle is ready to serve traffic.

```bash
# Test connectivity
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}"
# Expected: 200 or 303
```

### Step 1.3 — Retrieve Admin Credentials

```bash
# List Moodle-related secrets
gcloud secrets list --project="${PROJECT}" --filter="name~moodle"

# Retrieve the admin password
gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${ADMIN_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq -r '.payload.data' | base64 -d
```

**Expected result:** The admin password is returned. Default admin username is `admin`.

### Step 1.4 — Log In to Moodle

1. Open `http://${EXTERNAL_IP}` in your browser.
2. If an installation wizard appears, confirm database settings and proceed.
3. Navigate to `http://${EXTERNAL_IP}/login` and log in as `admin`.

**Expected result:** Moodle dashboard loads as site administrator.

### Step 1.5 — Inspect the Cloud Run Service via kubectl

```bash
# View pod details (shows both containers)
kubectl describe pod -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=moodle -o jsonpath='{.items[0].metadata.name}')"
```

**Expected result:** Pod spec shows two containers: `moodle` (Apache+PHP+Moodle) and `cloudsql-proxy` (Auth Proxy). NFS volume mount at `/mnt` is listed.

---

## Exercise 2 — Create a Course and Learning Activities

### Objective

Create a Moodle course, add quiz, forum, and assignment activities, enrol a student, and
test the student experience.

### Step 2.1 — Create a New Course

1. Navigate to **Site administration > Courses > Add a new course**.
2. Fill in:
   - **Course full name:** `Introduction to Cloud Computing`
   - **Short name:** `CLOUD101`
   - **Category:** `Miscellaneous`
   - **Course format:** Weekly
3. Click **Save and display**.

**Expected result:** Empty course page with Week 1 section visible.

### Step 2.2 — Add Learning Activities

Click **Turn editing on** > **Add an activity or resource** in Week 1:

1. **Quiz**: Name `Week 1 Quiz`. Click **Edit quiz** > **Add question** > **Multiple choice**. Enter question text, options, and mark the correct answer. Save.
2. **Forum**: Name `General Discussion`, type `Standard forum for general use`. Save.
3. **Assignment**: Name `Lab Report`, submission type `Online text`, grading `100 points`. Save.
4. **File resource**: Upload a PDF syllabus document, display as `Embed`.

**Expected result:** Four activities appear in Week 1: Quiz, Forum, Assignment, and File.

### Step 2.3 — Create and Enrol a Student

1. **Site administration > Users > Add a new user**: username `student01`, set name and password.
2. Return to the course **Participants** page > **Enrol users** > search `student01` > assign **Student** role.

**Expected result:** student01 enrolled with Student role in CLOUD101.

### Step 2.4 — Test the Student Experience

1. Log in as `student01` (private browsing) or use **Switch role to > Student**.
2. Navigate to the course.
3. Attempt the **Week 1 Quiz** — answer the question and submit.
4. Post in the **General Discussion** forum.
5. Submit text for the **Lab Report** assignment.

**Expected result:** Student can interact with all activities. Quiz grade appears in the Gradebook.

### Step 2.5 — Review the Gradebook

1. As admin, navigate to the course > **Grades**.
2. The Grader report shows student01's quiz attempt and assignment submission.
3. Click **Grade** next to the assignment and enter a grade (85/100).

**Expected result:** Grades are recorded. The total grade for the course calculates automatically.

---

## Exercise 3 — User Management

### Objective

Create users with different roles, explore cohorts, configure authentication policies, and
understand the Moodle role permission model.

### Step 3.1 — Create a Teacher User

1. **Site administration > Users > Add a new user**: username `teacher01`, assign a name and password.
2. Enrol `teacher01` in CLOUD101 with **Teacher** role.
3. Log in as `teacher01` and verify they can edit course content.

**Expected result:** Teacher can edit activities, grade submissions, and manage enrolments. They cannot access Site administration.

### Step 3.2 — Create a Cohort

1. **Site administration > Users > Cohorts > Add new cohort**: name `Cloud 101 Students`.
2. Click **Add members** and add `student01`.
3. Navigate to the course > **Participants** > enrol cohort `Cloud 101 Students` with Student role.

**Expected result:** Cohort-based enrolment allows bulk management of student groups.

### Step 3.3 — Review Role Definitions

1. **Site administration > Users > Define roles > Student** — review capabilities.
2. **Site administration > Users > Define roles > Teacher** — compare with Student.
3. Note: Teachers can `moodle/grade:viewall`, Students cannot.

**Expected result:** Role capability matrix shows clear separation between Student and Teacher permissions.

### Step 3.4 — Configure Authentication Settings

1. **Site administration > Plugins > Authentication > Manage authentication**.
2. Review: Email-based self-registration (enabled), Manual accounts (enabled).
3. **Site administration > Security > Site security settings** — review password policy.

```bash
# View environment variables in pod (confirm APP_URL and admin credentials)
kubectl exec -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=moodle -o jsonpath='{.items[0].metadata.name}')" \
  -c moodle -- env | grep -E "^APP_URL|^MOODLE_|^DB_"
```

**Expected result:** `APP_URL` shows the Moodle public URL, `MOODLE_REDIS_ENABLED=true`, and `DB_NAME=moodle`.

### Step 3.5 — View Activity Reports

1. **Site administration > Reports > Activity**: select CLOUD101 and review student access times.
2. **Site administration > Reports > User list**: shows all platform users and last login times.

**Expected result:** Reports show student01's quiz attempt, forum post, and last access time.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Explore the GKE Deployment, HPA, sidecar containers, init Jobs, and understand how Kubernetes
manages the Moodle application lifecycle.

### Step 4.1 — Inspect the Moodle Deployment

```bash
kubectl describe deployment moodle -n "${NAMESPACE}"

# View container specs
kubectl get deployment moodle -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[*].name}' | tr ' ' '\n'
```

**Expected result:** Deployment shows `moodle` and `cloudsql-proxy` containers. Resource limits (2000m CPU, 4Gi memory), NFS volume mount at `/mnt`, and health probe targets `/health.php`.

### Step 4.2 — Inspect the HPA

```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, currentNodeCount, autoscaling.enabled)"
```

**Expected result:** HPA shows `minReplicas=0`, `maxReplicas=5`. Current replicas may be 0 if no traffic is flowing.

### Step 4.3 — Review Init Jobs

```bash
kubectl get jobs -n "${NAMESPACE}"

# View db-init logs
DB_INIT_JOB=$(kubectl get jobs -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')
kubectl logs -n "${NAMESPACE}" -l job-name="${DB_INIT_JOB}" --tail=20

# View nfs-init logs
NFS_INIT_JOB=$(kubectl get jobs -n "${NAMESPACE}" \
  -o jsonpath='{.items[1].metadata.name}' 2>/dev/null)
kubectl logs -n "${NAMESPACE}" -l job-name="${NFS_INIT_JOB}" --tail=20 2>/dev/null || \
  echo "nfs-init job logs may be cleaned up"
```

**Expected result:** db-init shows pg_trgm extension creation, moodle user and database setup. nfs-init shows NFS directory creation (filedir, temp, cache, localcache) with `www-data` ownership and `2770` permissions.

### Step 4.4 — Inspect the PersistentVolumeClaim (NFS)

```bash
kubectl get pvc -n "${NAMESPACE}"
kubectl describe pvc -n "${NAMESPACE}"
```

**REST API:**
```bash
curl -s \
  "https://file.googleapis.com/v1/projects/${PROJECT}/locations/-/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.instances[] | {name, state, tier, fileShares}'
```

**Expected result:** PVC is in `Bound` state, mounted to the Cloud Filestore NFS instance with sufficient capacity for moodledata.

### Step 4.5 — Perform a Rolling Restart

```bash
kubectl rollout restart deployment/moodle -n "${NAMESPACE}"
kubectl rollout status deployment/moodle -n "${NAMESPACE}"

kubectl get pods -n "${NAMESPACE}" -w
```

**Expected result:** New pod starts with 2/2 containers (moodle + cloudsql-proxy). After startup, Moodle is accessible at the same external IP. Course content persists because moodledata is on NFS.

---

## Exercise 5 — Security and Workload Identity

### Objective

Explore Workload Identity, verify Secret Manager access from the pod, inspect IAM bindings,
and confirm the private database configuration.

### Step 5.1 — Inspect Workload Identity Annotation

```bash
# View the Moodle service account
kubectl get serviceaccounts -n "${NAMESPACE}"

# Check Workload Identity annotation
kubectl get serviceaccount moodle -n "${NAMESPACE}" -o yaml \
  | grep -A3 "annotations:"
```

**Expected result:** `iam.gke.io/gcp-service-account` annotation points to the Moodle GCP service account.

### Step 5.2 — Verify GCP Service Account

```bash
MOODLE_SA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~moodle" \
  --format="value(email)" \
  --limit=1)

echo "Moodle GCP SA: ${MOODLE_SA}"

# View IAM roles
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${MOODLE_SA}" \
  --format="table(bindings.role)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.accounts[] | select(.email | test("moodle")) | {name, email}'
```

**Expected result:** The Moodle SA has `cloudsql.client`, `secretmanager.secretAccessor`, `storage.objectAdmin` roles.

### Step 5.3 — Verify Secret Access from Pod

```bash
MOODLE_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=moodle \
  -o jsonpath='{.items[0].metadata.name}')

# Confirm DB_PASSWORD is injected (truncated for security)
kubectl exec -n "${NAMESPACE}" "${MOODLE_POD}" -c moodle -- \
  env | grep "^DB_PASSWORD" | cut -c1-20
echo "...(truncated)"

# Confirm Redis is configured
kubectl exec -n "${NAMESPACE}" "${MOODLE_POD}" -c moodle -- \
  env | grep "MOODLE_REDIS"
```

**Expected result:** `DB_PASSWORD` is populated. `MOODLE_REDIS_ENABLED=true` and `MOODLE_REDIS_HOST` are set.

### Step 5.4 — Check Cloud SQL Private Connectivity

```bash
# Confirm no public IP on Cloud SQL instance
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~moodle" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe "${INSTANCE}" \
  --project="${PROJECT}" \
  --format="table(name, settings.ipConfiguration.authorizedNetworks[0].value, ipAddresses)"
```

**Expected result:** Cloud SQL has only a private IP. Public IP is not configured. All database traffic goes through the Auth Proxy sidecar within the pod.

### Step 5.5 — Review Secret Manager Secrets

```bash
# List all Moodle-related secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~moodle"

# Review secret metadata (not values)
for secret in $(gcloud secrets list --project="${PROJECT}" \
  --filter="name~moodle" --format="value(name)"); do
  echo "Secret: $secret"
  gcloud secrets describe "$secret" --project="${PROJECT}" \
    --format="table(name, replication.automatic)"
done
```

**Expected result:** Three Moodle secrets exist: DB password, cron password, SMTP password. All use automatic global replication.

---

## Exercise 6 — Cloud Logging

### Objective

Query Moodle container logs from GKE, view Cloud SQL Auth Proxy logs, filter for PHP errors,
and stream live logs.

### Step 6.1 — View Logs in Log Explorer

Navigate to **Cloud Console > Logging > Log Explorer** and use this filter:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="moodle"
```

**Expected result:** PHP/Apache access logs appear showing Moodle page requests.

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

**Expected result:** Apache access log lines appear (`GET /course/view.php HTTP/1.1 200`).

### Step 6.3 — View Cloud SQL Auth Proxy Logs

In Log Explorer, use this filter:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="cloudsql-proxy"
```

**kubectl:**
```bash
kubectl logs -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=moodle -o jsonpath='{.items[0].metadata.name}')" \
  -c cloudsql-proxy --tail=20
```

**Expected result:** Cloud SQL Auth Proxy connection and health check logs confirm successful database connectivity.

### Step 6.4 — Filter PHP Errors

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND textPayload=~"PHP Warning|PHP Fatal"' \
  --project="${PROJECT}" \
  --freshness=24h \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Under normal operation, no PHP fatal errors appear.

### Step 6.5 — View Cron Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND textPayload=~"cron.php"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Each Cloud Scheduler trigger produces a log entry for the cron.php call with HTTP 200.

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Explore GKE workload metrics for Moodle, review the uptime check, observe HPA behavior,
and scale the deployment to test horizontal pod scaling.

### Step 7.1 — View GKE Workload Metrics

Navigate to **Cloud Console > Kubernetes Engine > Workloads > moodle** and review the
metrics panel for CPU, memory, and pod count.

```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project="${PROJECT}" \
  | grep -E "cpu|memory|restart"
```

**Expected result:** Moodle containers show moderate CPU and memory usage. Memory reflects Apache + PHP + Moodle (typically 500 MB–1.5 Gi per pod).

### Step 7.2 — Query GKE Metrics via REST API

```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/memory/used_bytes | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, memBytes: .pointData[-1].values[0].int64Value}'
```

**Expected result:** Memory usage in bytes returned for both `moodle` and `cloudsql-proxy` containers.

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

**Expected result:** Uptime check targeting the Moodle LoadBalancer IP runs every 60 seconds with passing status.

### Step 7.4 — Scale the Deployment

```bash
# Scale to 2 replicas
kubectl scale deployment moodle --replicas=2 -n "${NAMESPACE}"
kubectl rollout status deployment/moodle -n "${NAMESPACE}"

kubectl get pods -n "${NAMESPACE}"
# Should show 2 pods both with 2/2 containers

# Check session distribution (Redis ensures sessions work across pods)
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}"

# Scale back to 1
kubectl scale deployment moodle --replicas=1 -n "${NAMESPACE}"
```

**Expected result:** Second Moodle pod starts with `2/2` containers. Redis session storage ensures users remain logged in regardless of which pod handles their request.

### Step 7.5 — Create an Alert Policy

**gcloud:**
```bash
gcloud alpha monitoring policies create \
  --display-name="Moodle GKE - High Memory Alert" \
  --condition-filter="metric.type=\"kubernetes.io/container/memory/limit_utilization\" resource.label.\"namespace_name\"=\"${NAMESPACE}\"" \
  --condition-threshold-value=0.9 \
  --condition-threshold-duration=300s \
  --condition-threshold-comparison=COMPARISON_GT \
  --project="${PROJECT}"
```

**Expected result:** Alert policy created. Fires if Moodle pod memory usage exceeds 90% of limit for 5 minutes.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Moodle_GKE` deployment. This removes the
Kubernetes namespace and workloads, Cloud SQL instance, Cloud Filestore NFS, GCS bucket,
Secret Manager secrets, static IP, Cloud Scheduler job, and all IAM bindings.

> **Warning:** This permanently deletes all data including the PostgreSQL database and NFS
> moodledata. Back up course content before undeploying via **Site administration >
> Courses > Restore/Backup**.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Cloud SQL instance
INSTANCE=$(gcloud sql instances list --project="${PROJECT}" \
  --filter="name~moodle" --format="value(name)" --limit=1)
gcloud sql instances delete "${INSTANCE}" --project="${PROJECT}" --quiet

# Delete Secret Manager secrets
gcloud secrets list --project="${PROJECT}" --filter="name~moodle" \
  --format="value(name)" | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet

# Release static IP
gcloud compute addresses list --project="${PROJECT}" --filter="name~moodle"
gcloud compute addresses delete <address-name> \
  --region="${REGION}" --project="${PROJECT}" --quiet
```

**REST API — list cluster namespaces:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, status: .status}'
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `moodle` | Base name for K8s and GCP resources |
| `application_version` | string | `4.5.1` | Moodle version (Ubuntu 24.04 + PHP 8.3) |
| `min_instance_count` | number | `0` | HPA minimum pod replicas |
| `max_instance_count` | number | `5` | HPA maximum pod replicas |
| `cpu_limit` | string | `2000m` | CPU limit per pod |
| `memory_limit` | string | `4Gi` | Memory limit per pod |
| `container_resources` | object | `{cpu_limit="1000m", memory_limit="512Mi"}` | Fine-grained resource object |
| `db_name` | string | `moodle` | PostgreSQL database name |
| `db_user` | string | `moodle` | PostgreSQL application user |
| `enable_redis` | bool | `true` | Enable Redis for session caching |
| `redis_host` | string | `""` | Redis host IP |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore NFS (required) |
| `nfs_mount_path` | string | `/mnt` | NFS mount path inside container |
| `enable_custom_domain` | bool | `true` | Enable Gateway API with static IP |
| `reserve_static_ip` | bool | `true` | Reserve a static external IP |
| `gke_cluster_name` | string | auto | Target GKE cluster (auto-discovers if empty) |
| `backup_schedule` | string | `0 2 * * *` | Automated backup cron schedule |
| `backup_retention_days` | number | `7` | Days to retain backup files |

### Useful Commands

```bash
# Get all resources in namespace
kubectl get all -n ${NAMESPACE}

# View pod logs (moodle container)
kubectl logs -n ${NAMESPACE} -l app=moodle -c moodle --tail=50

# View Auth Proxy logs
kubectl logs -n ${NAMESPACE} -l app=moodle -c cloudsql-proxy --tail=20

# Get external IP
kubectl get svc -n ${NAMESPACE} -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Scale deployment
kubectl scale deployment moodle --replicas=2 -n ${NAMESPACE}

# Rolling restart
kubectl rollout restart deployment/moodle -n ${NAMESPACE}

# Access admin password
gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT}

# List Filestore instances
gcloud filestore instances list --project=${PROJECT}

# List Cloud Scheduler jobs
gcloud scheduler jobs list --project=${PROJECT} --location=${REGION} --filter="name~moodle"

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# View Workload Identity annotation
kubectl get sa moodle -n ${NAMESPACE} -o yaml | grep iam.gke.io
```

### Further Reading

- [Moodle official documentation](https://docs.moodle.org/)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity documentation](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
- [Cloud Filestore NFS](https://cloud.google.com/filestore/docs)
- [Kubernetes HPA documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [Redis session caching in Moodle](https://docs.moodle.org/405/en/Session_handling)
