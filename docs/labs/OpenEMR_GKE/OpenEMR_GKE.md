---
title: "OpenEMR on GKE — Lab Guide"
sidebar_label: "OpenEMR GKE"
---

# OpenEMR on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenEMR_GKE)**

OpenEMR is a HIPAA-compliant, open-source Electronic Health Records (EHR) and medical practice
management application. The `OpenEMR_GKE` module deploys version **7.0.4** on GKE Autopilot
with Cloud SQL MySQL 8.0 accessed via Cloud SQL Auth Proxy sidecar, NFS storage for the patient
sites directory, Redis for PHP session management, and Workload Identity for secure GCP API
access without service account key files.

> **Healthcare Security Note:** All database credentials are stored in Secret Manager, storage
> uses enforced public access prevention, and Workload Identity eliminates key file exposure.
> For production HIPAA deployments, enable `enable_audit_logging = true`,
> `manage_storage_kms_iam = true`, and `enable_artifact_registry_cmek = true`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access OpenEMR](#exercise-1--access-openemr)
6. [Exercise 2 — Patient Management](#exercise-2--patient-management)
7. [Exercise 3 — Clinical Documentation](#exercise-3--clinical-documentation)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and HIPAA Compliance Posture](#exercise-5--security-and-hipaa-compliance-posture)
10. [Exercise 6 — Cloud Logging and Monitoring](#exercise-6--cloud-logging-and-monitoring)
11. [Cleanup](#cleanup)
12. [Reference](#reference)

---

## 1. Overview

### What Is OpenEMR?

OpenEMR is an open-source **Electronic Health Records (EHR) and medical practice management**
platform. It provides patient records, appointment scheduling, clinical documentation (SOAP
notes, prescriptions, problem lists), billing workflows, and a patient-facing portal. The
`OpenEMR_GKE` module deploys version 7.0.4 on GKE Autopilot with the `K8S=yes` environment
variable enabling multi-pod aware clustering, ClientIP session affinity for sticky PHP sessions,
and Workload Identity replacing service account key files.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Patient Records** | Full demographic, insurance, and clinical chart management |
| **Clinical Documentation** | SOAP notes, prescriptions, problem list, immunizations |
| **GKE Autopilot** | Managed Kubernetes with auto-provisioned nodes and security hardening |
| **Cloud SQL Auth Proxy** | Sidecar-based MySQL 8.0 access via Unix socket |
| **Workload Identity** | Pod-level IAM binding — no service account key files |
| **NFS Storage** | Cloud Filestore for OpenEMR sites directory (sqlconf, documents) |
| **HIPAA Compliance Posture** | Secrets, audit logs, Workload Identity, and encryption controls |
| **Cloud Logging / Monitoring** | PHP/Apache logs, GKE metrics, uptime checks |

---

## 2. Architecture

```
Browser (Clinician or Patient)
        │
        ▼
LoadBalancer Service (external IP, port 80)
  │   ClientIP session affinity (PHP sessions)
  ▼
OpenEMR Deployment (GKE Autopilot)
   ├── OpenEMR container (port 80, Apache + PHP-FPM)
   │       ├── Clinical UI and Patient Portal
   │       └── openemr.sh startup orchestration (K8S=yes mode)
   └── Cloud SQL Auth Proxy sidecar (127.0.0.1:3306)
```

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  GKE Autopilot Cluster                                             │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  openemr namespace (appopenemr<tenant><id>)                   │  │ │
│  │  │                                                              │  │  │
│  │  │  OpenEMR Deployment                                          │  │  │
│  │  │    containers: [openemr, cloud-sql-proxy]                    │  │  │
│  │  │    session_affinity: ClientIP                                │  │  │
│  │  │    ephemeral_storage: 8Gi                                    │  │  │
│  │  │                                                              │  │  │
│  │  │  nfs-init Job (gcr.io/cloudsdktool)                          │  │  │
│  │  │  db-init Job (mysql:8.0-debian)                              │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                    │  │
│  │  ┌────────────────┐  ┌────────────────────┐  ┌─────────────────┐  │   │
│  │  │  LoadBalancer  │  │  Workload Identity │  │  Static IP      │  │   │
│  │  │  Service       │  │  (SA → GCP SA IAM) │  │  (reserved)     │  │   │
│  │  └────────────────┘  └────────────────────┘  └─────────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐  ┌───────────┐   │
│  │  Cloud SQL   │  │  NFS Server    │  │  Redis       │  │  Secret   │   │
│  │  MySQL 8.0   │  │  (VM)          │  │  (PHP sess.) │  │  Manager  │   │
│  │  private IP  │  │  /sites dir    │  │  port 6379   │  │  secrets  │   │
│  └──────────────┘  └────────────────┘  └──────────────┘  └───────────┘   │
│                                                                          │
│  Module variable wiring:                                                 │
│    OpenEMR_GKE                                                           │
│      session_affinity = ClientIP  → PHP sessions stick to same pod       │
│      reserve_static_ip = true     → stable external IP                   │
│      enable_nfs = true            → required for OpenEMR sites dir       │
└──────────────────────────────────────────────────────────────────────────┘
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
roles/monitoring.viewer
roles/logging.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
gcloud auth application-default login
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `OpenEMR_GKE` module via the RAD UI. **Prerequisite:** `Services_GCP` must be
deployed first. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `7.0.4` | OpenEMR version |
| `enable_nfs` | `true` | Required for OpenEMR sites directory |
| `enable_redis` | `true` | PHP session management |
| `min_instance_count` | `1` | Minimum pod replicas |
| `max_instance_count` | `1` | Singleton until multi-pod NFS confirmed |
| `cpu_limit` | `2000m` | Minimum 2 vCPU recommended |
| `memory_limit` | `4Gi` | Minimum 4Gi recommended |
| `ephemeral_storage_limit` | `8Gi` | PHP opcache, logs (max 8Gi Autopilot) |

Click **Deploy** and wait for provisioning (approximately 20–35 minutes).

> **What this provisions:** GKE Autopilot namespace, Cloud SQL MySQL 8.0, Cloud SQL Auth Proxy
> sidecar, NFS server (Compute Engine VM) with NFS and DB init Kubernetes Jobs, LoadBalancer
> Service with ClientIP affinity, static external IP, Secret Manager secrets, Workload Identity
> binding, GCS bucket, and Cloud Monitoring uptime check.

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

# Discover admin password secret
export ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openemr AND name~admin" \
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

# Discover the OpenEMR namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appopenemr" | head -1)

echo "OpenEMR namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "OpenEMR URL: http://${EXTERNAL_IP}/openemr"
```

---

## Exercise 1 — Access OpenEMR

### Objective

Verify pod health, wait for the startup probe to pass (first-boot database installation),
retrieve admin credentials, and log in to the OpenEMR clinical dashboard.

### Step 1.1 — Verify Pod Health

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"
# Expected: openemr pod with STATUS=Running and READY=2/2
# (2/2 = openemr container + cloud-sql-proxy sidecar)

kubectl get jobs -n "${NAMESPACE}"
# db-init and nfs-init jobs should show Completed
```

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status, currentNodeCount)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, currentNodeCount}'
```

**Expected result:** OpenEMR pod shows `Running` status with `2/2` ready. The `nfs-init` and
`db-init` jobs should both show `Completed`. Allow 5–10 minutes for first-boot installation.

### Step 1.2 — Get External IP and Check Login Page

```bash
kubectl get svc -n "${NAMESPACE}"

# Wait for EXTERNAL-IP assignment
kubectl get svc -n "${NAMESPACE}" -w

# Check the login page
curl -I "http://${EXTERNAL_IP}/openemr/interface/login/login.php"
# Expected: HTTP/1.1 200 OK
```

### Step 1.3 — View Startup Logs

```bash
# OpenEMR container logs
kubectl logs -n "${NAMESPACE}" \
  -l app=openemr \
  -c openemr \
  --tail=50

# Cloud SQL Auth Proxy sidecar logs
kubectl logs -n "${NAMESPACE}" \
  -l app=openemr \
  -c cloud-sql-proxy \
  --tail=20
```

**Expected result:** Log lines from `openemr.sh` showing: NFS mount, `auto_configure.php`
database initialization, and final Apache + PHP-FPM startup.

### Step 1.4 — Retrieve Admin Credentials

```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openemr" \
  --format="table(name, createTime)"

gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${ADMIN_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 -d
```

### Step 1.5 — Log In and Explore

Navigate to `http://${EXTERNAL_IP}/openemr`:

1. Log in with username `admin` and the retrieved password.
2. Explore the main dashboard: **Patient**, **Fees**, **Reports**, **Modules**, **Administration**.

**Expected result:** The OpenEMR clinical dashboard loads successfully.

---

## Exercise 2 — Patient Management

### Objective

Create a patient record, schedule an appointment, and verify the chart is accessible from
the GKE-hosted OpenEMR instance.

### Step 2.1 — Create a New Patient

1. Navigate to **Patient > New Patient**.
2. Fill in the **Demographics** tab:
   - **First Name:** Jane, **Last Name:** Doe
   - **Date of Birth:** 1985-06-15, **Sex:** Female
   - Address, City, State, ZIP
3. Add primary insurance on the **Insurance** tab.
4. Click **Save**. Note the assigned **PID**.

**Expected result:** Patient record created and accessible via Patient Finder.

### Step 2.2 — Schedule an Appointment

1. From the patient chart, click **New Appointment**.
2. Set: Date/Time (near future), Appointment type: Office Visit, Provider: admin user.
3. Click **Save Appointment**.
4. Navigate to **Modules > Calendar** and confirm the appointment appears.

**Expected result:** Appointment visible in the calendar with the correct patient and provider.

### Step 2.3 — Verify NFS-Backed Document Storage

The OpenEMR `/sites` directory (sqlconf.php, documents, caches) is mounted from NFS:

**kubectl:**
```bash
# Verify the NFS volume mount inside the pod
kubectl exec -n "${NAMESPACE}" \
  $(kubectl get pod -n "${NAMESPACE}" -l app=openemr \
    -o jsonpath='{.items[0].metadata.name}') \
  -c openemr -- \
  ls /var/www/localhost/htdocs/openemr/sites/default/
```

**Expected result:** The sites directory shows `sqlconf.php` (database config), `documents/`,
and cache directories — all served from the Cloud Filestore NFS instance.

### Step 2.4 — View Patient Chart Tabs

Open the patient chart and explore:
- **Summary** — problem list, medications, recent encounters
- **Documents** — uploaded patient documents (stored on NFS)
- **History** — medical history forms

**gcloud (verify NFS access logs):**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   textPayload=~\"nfs|sites|document\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

---

## Exercise 3 — Clinical Documentation

### Objective

Create a clinical encounter, document a SOAP note, write a prescription, add a problem list
entry, and record an immunization.

### Step 3.1 — Create an Encounter

1. From the patient chart, click **Encounter > New Encounter**.
2. Set the date (today) and reason: "Routine follow-up".
3. Click **New Encounter** to open the encounter form.

### Step 3.2 — Document a SOAP Note

In the encounter form, navigate to the **SOAP** section:
- **Subjective:** "Patient presents with mild headache for 3 days. No fever."
- **Objective:** "BP 120/80, HR 72, Temp 98.6°F"
- **Assessment:** "Tension headache"
- **Plan:** "Rest, hydration, ibuprofen 400mg PRN"

Click **Save** to record the encounter note.

**Expected result:** SOAP note saved with timestamp and provider signature.

### Step 3.3 — Write a Prescription

1. Navigate to **Rx > New Prescription**.
2. Set: Drug: Ibuprofen 400mg, Directions: 1 tablet every 6 hours, Quantity: 30, Refills: 0.
3. Click **Save**.

**Expected result:** Prescription recorded in the patient's medication list.

### Step 3.4 — Add to Problem List

1. From the patient chart, navigate to the **Problems** tab.
2. Click **Add Problem**.
3. Search "headache", select ICD-10 code `R51`, Status: Active.
4. Click **Save**.

**Expected result:** Problem appears in the Active Problem List with ICD-10 code.

### Step 3.5 — Record an Immunization

1. From the patient chart, navigate to **Immunizations**.
2. Click **Add Immunization**, select Influenza, add date and lot number.
3. Click **Save**.

**Expected result:** Immunization record added with date and vaccine details.

### Step 3.6 — Verify Encounter Data is Persisted

After saving clinical data, verify persistence by refreshing the page and confirming all
entries remain in the chart.

**gcloud (verify MySQL writes via Auth Proxy):**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   resource.labels.container_name=\"cloud-sql-proxy\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the OpenEMR Kubernetes resources, verify the initialization jobs completed, and
explore the Cloud SQL Auth Proxy sidecar pattern.

### Step 4.1 — Inspect the Deployment

**kubectl:**
```bash
kubectl describe deployment openemr -n "${NAMESPACE}"

# List containers
kubectl get deployment openemr -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[*].name}' | tr ' ' '\n'

# View resource limits
kubectl get deployment openemr -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[0].resources}' | jq .
```

**Expected result:** Deployment shows `openemr` and `cloud-sql-proxy` containers, resource
limits, ephemeral storage limit of 8Gi, and startup/liveness probes.

### Step 4.2 — Inspect Initialization Jobs

**kubectl:**
```bash
# List all jobs
kubectl get jobs -n "${NAMESPACE}"

# Describe db-init job
kubectl describe job \
  $(kubectl get jobs -n "${NAMESPACE}" \
    -o jsonpath='{.items[?(@.metadata.name contains "db-init")].metadata.name}') \
  -n "${NAMESPACE}"

# View db-init job logs
kubectl logs -n "${NAMESPACE}" \
  -l job-name=$(kubectl get jobs -n "${NAMESPACE}" \
    -o jsonpath='{.items[0].metadata.name}')

# Describe nfs-init job
kubectl describe job \
  $(kubectl get jobs -n "${NAMESPACE}" \
    -o jsonpath='{.items[?(@.metadata.name contains "nfs-init")].metadata.name}') \
  -n "${NAMESPACE}" 2>/dev/null || \
  kubectl get jobs -n "${NAMESPACE}" -o wide
```

**Expected result:** Both `db-init` (MySQL user/schema creation) and `nfs-init` (OpenEMR
sites directory setup, sqlconf.php generation) jobs show `Completed` status.

### Step 4.3 — Inspect the Cloud SQL Auth Proxy Sidecar

**kubectl:**
```bash
# Describe the cloud-sql-proxy container spec
kubectl get deployment openemr -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="cloud-sql-proxy")]}' | jq .
```

**Expected result:** The sidecar runs `cloud-sql-proxy` with the Cloud SQL instance connection
name, Unix socket mode, and health check endpoints. OpenEMR connects via `127.0.0.1:3306`.

### Step 4.4 — Inspect the LoadBalancer Service

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}" -o wide

kubectl describe service -n "${NAMESPACE}"
# Note: sessionAffinity: ClientIP — ensures PHP sessions stay on same pod
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --filter="name~openemr"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/addresses" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | select(.name | test("openemr")) | {name, address, status}'
```

**Expected result:** The LoadBalancer service has a static external IP assigned, with
`sessionAffinity: ClientIP` ensuring the same pod handles all requests from a given PHP session.

### Step 4.5 — Check Pod Resource Usage

```bash
kubectl top pods -n "${NAMESPACE}"
```

**Expected result:** OpenEMR pod uses 2–4 vCPU and 2–4 Gi memory at rest, higher during
report generation or bulk patient chart access.

---

## Exercise 5 — Security and HIPAA Compliance Posture

### Objective

Verify Workload Identity binding, inspect Secret Manager secrets, confirm no key files in
pods, and review audit logs for HIPAA compliance evidence.

### Step 5.1 — Verify Workload Identity Annotation

**kubectl:**
```bash
kubectl get serviceaccount -n "${NAMESPACE}" -o yaml \
  | grep -A5 "annotations:"
```

The annotation `iam.gke.io/gcp-service-account` links the Kubernetes SA to a GCP SA for
Workload Identity.

**gcloud:**
```bash
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~openemr" \
  --format="table(email, displayName)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.accounts[] | select(.email | test("openemr")) | {email, displayName}'
```

### Step 5.2 — Verify IAM Bindings

**gcloud:**
```bash
SA_EMAIL=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~openemr" \
  --format="value(email)" \
  --limit=1)

gcloud iam service-accounts get-iam-policy "${SA_EMAIL}" \
  --project="${PROJECT}"
```

**Expected result:** IAM policy shows `roles/iam.workloadIdentityUser` binding for the
Kubernetes service account — no key file required.

### Step 5.3 — Confirm No Key File in Pod

**kubectl:**
```bash
kubectl exec -n "${NAMESPACE}" \
  $(kubectl get pod -n "${NAMESPACE}" -l app=openemr \
    -o jsonpath='{.items[0].metadata.name}') \
  -c openemr -- \
  env | grep -i "google_application_credentials" || \
  echo "No key file env var — Workload Identity active"
```

**Expected result:** No `GOOGLE_APPLICATION_CREDENTIALS` variable — Workload Identity
provides credentials transparently via the metadata server.

### Step 5.4 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openemr" \
  --format="table(name, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aopenemr" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | {name, createTime}'
```

**Expected result:** Admin password and database password secrets. No plaintext credentials
in Kubernetes manifests or container environment variables.

### Step 5.5 — Review Secret Access Audit Logs

**gcloud:**
```bash
gcloud logging read \
  "protoPayload.serviceName=secretmanager.googleapis.com \
   AND protoPayload.methodName=~\"AccessSecretVersion\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {
    timestamp,
    caller: .protoPayload.authenticationInfo.principalEmail,
    resource: .protoPayload.resourceName
  }'
```

**Expected result:** The OpenEMR GCP service account accessing admin and DB secrets during
pod startup — audit trail confirming least-privilege access without key exposure.

> **HIPAA Note:** Enable `enable_audit_logging = true` to capture DATA_READ, DATA_WRITE, and
> ADMIN_READ events for all GCP API calls. This is required for HIPAA audit control compliance
> (§164.312(b)).

### Step 5.6 — Review Cloud SQL Private IP Configuration

**gcloud:**
```bash
DB_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~openemr" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe "${DB_INSTANCE}" \
  --project="${PROJECT}" \
  --format="table(name, databaseVersion, settings.ipConfiguration.privateNetwork, state)"
```

**Expected result:** MySQL 8.0 instance with private IP only — no public IP exposure.

---

## Exercise 6 — Cloud Logging and Monitoring

### Objective

Query GKE container logs for PHP/Apache events, initialization job output, and Auth Proxy
connectivity. Review Cloud Monitoring dashboards for container resource usage and uptime.

### Step 6.1 — View Application Logs in the Console

```bash
echo "https://console.cloud.google.com/logs?project=${PROJECT}"
```

Use the following filters:

**OpenEMR container logs:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="openemr"
```

**Cloud SQL Auth Proxy sidecar logs:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="cloud-sql-proxy"
```

### Step 6.2 — Query Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   resource.labels.container_name=\"openemr\"" \
  --project="${PROJECT}" \
  --limit=100 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"k8s_container\\\" resource.labels.namespace_name=\\\"${NAMESPACE}\\\" resource.labels.container_name=\\\"openemr\\\"\",
    \"pageSize\": 50
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 6.3 — Filter for Apache Access Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   resource.labels.container_name=\"openemr\" \
   textPayload=~\"GET /openemr|POST /openemr|\\\"200\\\"\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Apache access log entries showing clinician requests to the OpenEMR
clinical interface.

### Step 6.4 — Filter for PHP Errors

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   resource.labels.container_name=\"openemr\" \
   textPayload=~\"PHP.*Error|Fatal error|Warning\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

**Expected result:** For a healthy deployment, few or no PHP errors. Any configuration or
database connectivity issues appear here.

### Step 6.5 — Stream Live Logs

```bash
kubectl logs -f \
  -n "${NAMESPACE}" \
  -l app=openemr \
  -c openemr
```

Navigate pages in OpenEMR and observe real-time access log output.

### Step 6.6 — Review Cloud Monitoring Dashboards

```bash
echo "https://console.cloud.google.com/monitoring?project=${PROJECT}"
```

**gcloud (check uptime):**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period)"
```

**REST API (query GKE container CPU):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**kubectl (resource usage):**
```bash
kubectl top pods -n "${NAMESPACE}"
```

**Expected result:** CPU usage spikes during report generation. Memory usage reflects PHP
opcache and OpenEMR's in-memory caches (~2–4 Gi).

### Step 6.7 — Review Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {name, displayName, httpCheck}'
```

**Expected result:** Uptime check polling `/` at 60-second intervals, showing green status
from multiple global probe locations.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `OpenEMR_GKE` deployment. This removes
Kubernetes workloads, Cloud SQL instance, NFS server VM, GCS buckets, Secret Manager secrets,
static IP, and IAM bindings. The GKE cluster managed by `Services_GCP` is not affected.

> **Note:** `enable_purge = true` (default) allows full deletion. For production healthcare
> environments, set `enable_purge = false` to protect patient data.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete static IP
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="name~openemr"
gcloud compute addresses delete <address-name> \
  --region="${REGION}" --project="${PROJECT}" --quiet

# Delete secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openemr" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet

# Delete Cloud SQL instance
gcloud sql instances delete "${DB_INSTANCE}" \
  --project="${PROJECT}" --quiet
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_version` | string | `7.0.4` | OpenEMR version tag |
| `min_instance_count` | number | `1` | Minimum HPA pod replicas |
| `max_instance_count` | number | `1` | Maximum replicas (singleton default) |
| `cpu_limit` | string | `2000m` | Container CPU limit |
| `memory_limit` | string | `4Gi` | Container memory limit |
| `ephemeral_storage_limit` | string | `8Gi` | Ephemeral storage (opcache, logs) |
| `gke_cluster_name` | string | `""` | GKE cluster name (auto-discovered) |
| `db_name` | string | `openemr` | MySQL database name |
| `db_user` | string | `openemr` | MySQL database user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `enable_nfs` | bool | `true` | NFS for OpenEMR sites directory (required) |
| `nfs_mount_path` | string | `/var/www/localhost/htdocs/openemr/sites` | NFS mount path |
| `enable_redis` | bool | `true` | Redis for PHP session storage |
| `redis_host` | string | `""` | Redis host (defaults to NFS server IP) |
| `reserve_static_ip` | bool | `true` | Reserve global static external IP |
| `session_affinity` | string | `ClientIP` | Sticky sessions for PHP |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for automated backups |
| `enable_audit_logging` | bool | `false` | Enable for HIPAA audit trail compliance |
| `manage_storage_kms_iam` | bool | `false` | Enable for CMEK-encrypted storage |

### Key Module Outputs

| Output | Description |
|---|---|
| `service_url` | OpenEMR application URL |
| `service_external_ip` | External LoadBalancer IP |
| `admin_password_secret_id` | Secret Manager secret name for admin password |
| `database_password_secret` | Secret Manager secret name for DB password |
| `namespace` | Kubernetes namespace |
| `nfs_server_ip` | NFS server IP (sensitive) |

### Useful Commands

```bash
# Get external IP
kubectl get svc -n "${NAMESPACE}"

# Check pods
kubectl get pods -n "${NAMESPACE}"

# View OpenEMR logs
kubectl logs -n "${NAMESPACE}" -l app=openemr -c openemr --tail=50

# View Auth Proxy logs
kubectl logs -n "${NAMESPACE}" -l app=openemr -c cloud-sql-proxy --tail=20

# Stream live logs
kubectl logs -f -n "${NAMESPACE}" -l app=openemr

# Check NFS mount inside pod
kubectl exec -n "${NAMESPACE}" \
  $(kubectl get pod -n "${NAMESPACE}" -l app=openemr \
    -o jsonpath='{.items[0].metadata.name}') \
  -c openemr -- ls /var/www/localhost/htdocs/openemr/sites/default/

# Run admin unlock script (if locked out)
kubectl exec -n "${NAMESPACE}" \
  $(kubectl get pod -n "${NAMESPACE}" -l app=openemr \
    -o jsonpath='{.items[0].metadata.name}') \
  -c openemr -- /root/unlock_admin.sh newpassword

# Top pods
kubectl top pods -n "${NAMESPACE}"

# List jobs
kubectl get jobs -n "${NAMESPACE}"

# Check uptime
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

### Further Reading

- [OpenEMR documentation](https://www.open-emr.org/wiki/index.php/OpenEMR_Wiki_Home_Page)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy on GKE](https://cloud.google.com/sql/docs/mysql/connect-kubernetes-engine)
- [HIPAA on Google Cloud](https://cloud.google.com/security/compliance/hipaa)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [Cloud Filestore for GKE](https://cloud.google.com/filestore/docs/accessing-fileshares)
