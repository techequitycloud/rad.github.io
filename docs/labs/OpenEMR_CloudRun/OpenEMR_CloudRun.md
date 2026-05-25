---
title: "OpenEMR on Cloud Run — Lab Guide"
sidebar_label: "OpenEMR CloudRun"
---

# OpenEMR on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenEMR_CloudRun)**

OpenEMR is a HIPAA-compliant, open-source Electronic Health Records (EHR) and medical practice
management application trusted by clinics worldwide. The `OpenEMR_CloudRun` module deploys
version **7.0.4** on Cloud Run Gen2 backed by Cloud SQL MySQL 8.0 (accessed via Unix socket
with Cloud SQL Auth Proxy), NFS storage for the patient sites directory, Redis for PHP session
management, and Direct VPC Egress for private networking.

> **Healthcare Security Note:** All database credentials are stored in Secret Manager, all
> storage uses enforced public access prevention, and service accounts are scoped to minimum
> required permissions. For production HIPAA deployments, also enable `enable_audit_logging =
> true`, `manage_storage_kms_iam = true`, and `ingress_settings = "internal-and-cloud-load-
> balancing"`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access OpenEMR](#exercise-1--access-openemr)
6. [Exercise 2 — Patient Management](#exercise-2--patient-management)
7. [Exercise 3 — Appointments and Scheduling](#exercise-3--appointments-and-scheduling)
8. [Exercise 4 — Clinical Documentation](#exercise-4--clinical-documentation)
9. [Exercise 5 — Administration](#exercise-5--administration)
10. [Exercise 6 — Database and Security](#exercise-6--database-and-security)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is OpenEMR?

OpenEMR is an open-source **Electronic Health Records (EHR) and medical practice management**
platform. It provides patient records, appointment scheduling, clinical documentation (SOAP
notes, prescriptions, problem lists), billing workflows, and a patient-facing portal. The
`OpenEMR_CloudRun` module deploys version 7.0.4 on Cloud Run Gen2 with a multi-step startup
sequence that performs automatic database installation on first boot.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Patient Records** | Full demographic, insurance, and clinical chart management |
| **Appointment Scheduling** | Calendar-based scheduling with appointment types and providers |
| **Clinical Documentation** | SOAP notes, prescriptions, problem list, immunizations |
| **Billing Workflow** | Fee sheets, CPT/ICD-10 coding, insurance eligibility, claim generation |
| **Patient Portal** | Secure patient-facing access to health records and messaging |
| **HIPAA Security Posture** | Secret Manager credentials, NFS-backed sites, audit logging |
| **Cloud Logging** | PHP/Apache access logs and database connectivity events |
| **Cloud Monitoring** | Request metrics, latency, uptime check, and Redis session metrics |

---

## 2. Architecture

```
Browser (Clinician or Patient)
        │
        ▼
Cloud Run Gen2 Service (min=1 instance)
   ├── OpenEMR container (port 80, Apache + PHP-FPM + OpenEMR 7.0.4)
   │       ├── Clinical UI (/openemr/interface/...)
   │       ├── Patient Portal (/openemr/portal/...)
   │       └── openemr.sh startup orchestration
   └── Cloud SQL Auth Proxy sidecar (Unix socket at /cloudsql)
```

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                            │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Cloud Run Gen2 (OpenEMR)                                          │  │
│  │  ingress: all  ·  min=1  ·  execution_environment: gen2            │  │
│  │  TCP startup probe (allows 120s for first-boot DB install)         │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│           │  Serverless VPC Access / Direct VPC Egress                   │
│  ┌────────┴──────────────────────────────────────────────────────────┐   │
│  │  Private VPC                                                      │   │
│  │  ┌──────────────────┐  ┌────────────────────┐  ┌───────────────┐  │   │
│  │  │  Cloud SQL MySQL │  │  NFS Server (VM)   │  │  Redis        │  │   │
│  │  │  8.0 (private IP)│  │  /sites directory  │  │  (PHP session)│  │   │
│  │  │  Auth Proxy sock │  │  sqlconf.php       │  │  port 6379    │  │   │
│  │  └──────────────────┘  └────────────────────┘  └───────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────┐  ┌───────────────────────┐  ┌───────────────────┐  │
│  │  Secret Manager  │  │  GCS Bucket           │  │  Artifact Registry│  │
│  │  admin-password  │  │  data + backups       │  │  Custom image     │  │
│  │  db-password     │  │                       │  │  (Alpine + PHP83) │  │
│  └──────────────────┘  └───────────────────────┘  └───────────────────┘  │
│                                                                          │
│  Module variable wiring:                                                 │
│    OpenEMR_CloudRun                                                      │
│      enable_nfs   = true  → NFS required for OpenEMR sites directory     │
│      enable_redis = true  → PHP session storage                          │
│      min_instance_count = 1 → avoids cold starts for clinicians          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
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

Deploy the `OpenEMR_CloudRun` module via the RAD UI. **Prerequisite:** `Services_GCP` must be
deployed first. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `7.0.4` | OpenEMR version |
| `enable_nfs` | `true` | Required for OpenEMR sites directory |
| `enable_redis` | `true` | PHP session management |
| `min_instance_count` | `1` | Avoid cold starts for clinicians |
| `max_instance_count` | `1` | Singleton until NFS multi-instance confirmed |
| `cpu_limit` | `2000m` | Minimum 2 vCPU recommended |
| `memory_limit` | `4Gi` | Minimum 4Gi recommended |
| `ingress_settings` | `all` | Allow direct access for this lab |

Click **Deploy** and wait for provisioning (approximately 15–25 minutes, including Cloud Build
for the custom Alpine + PHP 8.3 image).

> **What this provisions:** Cloud Run Gen2 service, Cloud SQL MySQL 8.0, Cloud SQL Auth Proxy
> sidecar, NFS server (Compute Engine VM) with NFS init Cloud Run Job, Redis session store,
> Secret Manager secrets for admin and DB passwords, Serverless VPC Access, GCS bucket, and
> Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~openemr" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "OpenEMR service: ${SERVICE}"
echo "OpenEMR URL: ${SERVICE_URL}"

# Discover the admin password secret
export ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openemr AND name~admin" \
  --format="value(name)" \
  --limit=1)
```

---

## Exercise 1 — Access OpenEMR

### Objective

Retrieve the service URL, wait for the startup probe to pass (first-boot database installation),
retrieve admin credentials from Secret Manager, and log in to the OpenEMR dashboard.

### Step 1.1 — Verify Service Status

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{url: .uri, state: .terminalCondition.state}'
```

**Check the login page:**
```bash
curl -I "${SERVICE_URL}/openemr/interface/login/login.php"
# Expected: HTTP/2 200
```

> **First-boot note:** Allow 5–10 minutes after the initial deployment for the startup probe
> to pass. OpenEMR runs `auto_configure.php` on first boot to initialize the MySQL database.
> A PHP built-in health probe server serves stub responses during this window.

**Expected result:** HTTP 200 from the login page confirms the first-boot installation is
complete and OpenEMR is serving requests.

### Step 1.2 — Retrieve Admin Credentials

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openemr" \
  --format="table(name, createTime)"

# Access the admin password
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

**Expected result:** The admin password is returned. The admin username is `admin`.

### Step 1.3 — Log In and Explore the Dashboard

Navigate to `${SERVICE_URL}/openemr` in your browser:

1. Log in with username `admin` and the retrieved password.
2. Review the main dashboard:
   - **Patient Summary** widgets (appointments, messages, alerts)
   - **Top navigation:** Patient, Fees, Reports, Modules, Administration
   - **Calendar** view for appointment scheduling

**Expected result:** The OpenEMR main clinical dashboard loads. The system is ready for use.

### Step 1.4 — Review Administration Settings

1. Navigate to **Administration > Globals** to review site-level settings.
2. Under **Administration > Users**, confirm the admin user is configured correctly.

---

## Exercise 2 — Patient Management

### Objective

Create a patient record with demographics and insurance information, and verify the patient
chart is properly created.

### Step 2.1 — Create a New Patient

1. Navigate to **Patient > New Patient** (or click **New Patient** in the top navigation).
2. Fill in the **Demographics** tab:
   - **First Name:** Jane
   - **Last Name:** Doe
   - **Date of Birth:** 1985-06-15
   - **Sex:** Female
   - **Address, City, State, ZIP**
3. Navigate to the **Insurance** tab:
   - Add a primary insurance plan
   - Enter the policy holder name and policy number
4. Click **Save** to create the patient record.
5. Note the auto-assigned **PID** (Patient ID).

**Expected result:** Patient record is created and a chart is available with tabs for Summary,
Demographics, Documents, Insurance, and History.

### Step 2.2 — Search and Open the Patient Chart

1. Navigate to **Patient > Patient Finder**.
2. Search for "Doe".
3. Click the patient name to open the full chart.

**Expected result:** Full patient chart opens showing all tabs and the patient's demographic
information.

### Step 2.3 — Review Chart Navigation

From the patient chart, explore:
- **Summary** — recent encounters, problem list, medications, and allergies
- **Documents** — uploaded patient documents
- **History** — medical history and family history forms

**gcloud (verify NFS is serving patient data):**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"nfs|sites|documents\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

---

## Exercise 3 — Appointments and Scheduling

### Objective

Schedule a patient appointment, view it in the calendar, and explore appointment management.

### Step 3.1 — Schedule an Appointment

1. From the patient chart (Jane Doe), click **New Appointment**.
2. Set the appointment details:
   - **Date/Time:** select a near-future slot
   - **Appointment type:** Office Visit
   - **Provider:** select the admin user or a configured provider
   - **Duration:** 30 minutes
3. Click **Save Appointment**.

**Expected result:** Appointment is saved and appears in the provider's calendar.

### Step 3.2 — View the Calendar

1. Navigate to **Modules > Calendar** (or click the Calendar shortcut on the dashboard).
2. Locate the appointment just created.
3. Click the appointment to view details.

**Expected result:** The calendar view shows the scheduled appointment with patient name,
appointment type, and duration.

### Step 3.3 — Manage Appointment Status

From the calendar:
1. Right-click (or click) the appointment to view options.
2. Note the available status transitions: Scheduled → Arrived → In Room → Complete.

**Expected result:** Appointment workflow status options are available for clinic staff to
track patient progress through the visit.

### Step 3.4 — View Provider Schedule

1. In the Calendar, use the provider selector to view a specific provider's schedule.
2. Review the appointment slots and availability.

**gcloud (verify Cloud Run is handling session state):**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"redis|session\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

---

## Exercise 4 — Clinical Documentation

### Objective

Create a clinical encounter with a SOAP note, write a prescription, add a problem list entry,
and record an immunization.

### Step 4.1 — Create an Encounter

1. From the patient chart, click **Encounter > New Encounter**.
2. Set the encounter date (today) and reason for visit: "Routine follow-up".
3. Click **New Encounter** to open the encounter form.

**Expected result:** The encounter form opens with sections for SOAP, vitals, assessments, and
plan documentation.

### Step 4.2 — Document a SOAP Note

In the encounter form, navigate to the **SOAP** section:
- **Subjective:** "Patient presents with mild headache for 3 days. No fever."
- **Objective:** "BP 120/80, HR 72, Temp 98.6°F, Weight 68 kg"
- **Assessment:** "Tension headache, rule out hypertension"
- **Plan:** "Rest, hydration, ibuprofen 400mg PRN, follow-up in 2 weeks"

Click **Save** to record the encounter note.

**Expected result:** SOAP note is saved with timestamp and provider signature.

### Step 4.3 — Write a Prescription

1. From within the encounter or patient chart, navigate to **Rx > New Prescription**.
2. Fill in prescription details:
   - **Drug:** Ibuprofen 400mg
   - **Directions:** 1 tablet every 6 hours as needed
   - **Quantity:** 30 tablets
   - **Refills:** 0
3. Click **Save**.

**Expected result:** Prescription is recorded and appears in the patient's medication list.

### Step 4.4 — Add a Problem List Entry

1. From the patient chart, navigate to the **Problems** tab.
2. Click **Add Problem**.
3. Search for "headache" to find ICD-10 code `R51`.
4. Select the code, set **Status** to `Active`.
5. Click **Save**.

**Expected result:** The problem appears in the Active Problem List with the ICD-10 code.

### Step 4.5 — Record an Immunization

1. From the patient chart, navigate to **Immunizations**.
2. Click **Add Immunization**.
3. Select vaccine type: Influenza.
4. Fill in the administration date and lot number.
5. Click **Save**.

**Expected result:** The immunization record is added with date, vaccine type, and lot number.

---

## Exercise 5 — Administration

### Objective

Explore administration settings for users, roles, practice configuration, and fee schedules.

### Step 5.1 — User and Role Management

1. Navigate to **Administration > Users**.
2. Review the admin user's role and permissions.
3. Click **Add User** to see the user creation form (do not save).
4. Note role options: Administrator, Doctor, Nurse, Medical Assistant, Receptionist.

**Expected result:** User management interface shows granular role-based access controls for
HIPAA-compliant least-privilege access.

### Step 5.2 — Practice Settings

1. Navigate to **Administration > Globals**.
2. Review key settings:
   - **Practice Name** and contact information
   - **Default Language** and locale
   - **Time zone** configuration
   - **Session timeout** settings (security-relevant for HIPAA)

**gcloud (verify admin login created a Cloud Run request):**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.observedGeneration, status.latestCreatedRevisionName)"
```

### Step 5.3 — Fee Schedules

1. Navigate to **Administration > Fee Schedules**.
2. Review or create a fee schedule.
3. Navigate to **Fees > Billing Manager** to see the billing workflow.

**Expected result:** Fee schedule management is available for CPT code pricing and insurance
rate configuration.

### Step 5.4 — Explore Backup Configuration

Review the Cloud Run Job that handles automated backups:

**gcloud:**
```bash
# List Cloud Run Jobs
gcloud run jobs list \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --filter="name~openemr"

# Describe the backup job
gcloud run jobs describe \
  $(gcloud run jobs list \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --filter="name~openemr AND name~backup" \
    --format="value(name)" --limit=1) \
  --region="${REGION}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.jobs[] | select(.name | test("openemr")) | {name, latestCreatedExecution}'
```

**Expected result:** A backup Cloud Run Job configured with a daily cron schedule
(`0 2 * * *`) for automated MySQL dumps and NFS directory archives.

---

## Exercise 6 — Database and Security

### Objective

Inspect the Cloud SQL instance, review HIPAA-relevant Secret Manager secrets, and examine
audit logs for access control verification.

### Step 6.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
DB_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~openemr" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe "${DB_INSTANCE}" \
  --project="${PROJECT}" \
  --format="table(name, databaseVersion, settings.tier, region, state)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${DB_INSTANCE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, databaseVersion, state, region}'
```

**Expected result:** Cloud SQL MySQL 8.0 instance in `RUNNABLE` state with private IP and the
database `openemr` accessible via Cloud SQL Auth Proxy Unix socket.

### Step 6.2 — Review Secret Manager Secrets

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

**Expected result:** At minimum, secrets for the admin password and the database user password.
These are injected into the Cloud Run service via Secret Manager references.

### Step 6.3 — Verify Cloud SQL Auth Proxy Connectivity

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"cloudsql|proxy|mysql|socket\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries confirming Cloud SQL Auth Proxy established the Unix socket
connection to MySQL at `/cloudsql`, and OpenEMR successfully connected on first boot.

### Step 6.4 — Review IAM and Audit Logs

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

**Expected result:** The OpenEMR Cloud Run service account accessing the admin and database
password secrets during startup — no hardcoded credentials in the container.

> **HIPAA Note:** Enable `enable_audit_logging = true` in the module configuration to capture
> all DATA_READ, DATA_WRITE, and ADMIN_READ events. This is required for HIPAA audit trail
> requirements.

---

## Exercise 7 — Cloud Logging

### Objective

Query Cloud Run structured logs for PHP/Apache access events, database connectivity
confirmations, and error-level entries.

### Step 7.1 — View Application Logs in the Console

```bash
echo "https://console.cloud.google.com/logs?project=${PROJECT}"
```

Use the following filter:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

### Step 7.2 — Query Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\"" \
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
    \"filter\": \"resource.type=\\\"cloud_run_revision\\\" resource.labels.service_name=\\\"${SERVICE}\\\"\",
    \"pageSize\": 50
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 7.3 — Filter for PHP and Apache Events

**gcloud:**
```bash
# Apache access logs
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"GET /openemr|POST /openemr|Apache\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"

# PHP errors
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"PHP.*Error|Fatal error|Warning\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

**Expected result:** Apache access log entries for clinician logins and chart accesses, and
PHP-FPM process logs confirming request routing.

### Step 7.4 — View First-Boot Installation Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   textPayload=~\"auto_configure|install|database|setup\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries from the `openemr.sh` startup sequence showing the
`auto_configure.php` database installation, the health probe server startup, and the final
Apache + PHP-FPM startup.

### Step 7.5 — Tail Live Logs

```bash
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

While tailing, navigate pages in OpenEMR and observe the real-time access log output.

### Step 7.6 — Filter for Error Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   resource.labels.service_name=\"${SERVICE}\" \
   severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=20 \
  --freshness=6h
```

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Run service metrics, inspect the uptime check, and view Redis session metrics
in Cloud Monitoring.

### Step 8.1 — View Cloud Run Metrics in the Console

```bash
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/metrics?project=${PROJECT}"
```

Review:
- **Requests** — request count and latency (watch P99 during report generation)
- **Container** — CPU and memory utilization
- **Instances** — active instance count

### Step 8.2 — Query Request Count

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type=starts_with(\"run.googleapis.com\")" \
  --project="${PROJECT}" \
  --format="table(metric.type)" | grep -E "request|instance|cpu|memory"
```

### Step 8.3 — Review the Uptime Check

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

**Expected result:** An uptime check polling `/` at 60-second intervals from multiple global
probe locations, showing green (passing) status.

### Step 8.4 — Query Request Latency

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_latencies | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], percentile(val(), 99)\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].distributionValue'
```

**Expected result:** P99 latency is higher during report generation or large patient chart loads
compared to simple navigation requests.

### Step 8.5 — Review Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --filter="displayName~openemr" \
  --format="table(name, displayName, enabled)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.alertPolicies[] | {name, displayName, enabled}'
```

**Expected result:** Alert policies configured by the module for uptime check failures and
high error rates.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `OpenEMR_CloudRun` deployment. This removes
the Cloud Run service and revisions, Cloud SQL instance, NFS server VM, GCS buckets, Secret
Manager secrets, Serverless VPC Access connector, Cloud Scheduler jobs, and IAM bindings.

> **Note:** `enable_purge = true` (default) allows full deletion. For production healthcare
> environments, consider setting `enable_purge = false` to protect against accidental deletion
> of patient data.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --quiet

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

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_version` | string | `7.0.4` | OpenEMR version tag |
| `min_instance_count` | number | `1` | Minimum Cloud Run instances (1 avoids cold starts) |
| `max_instance_count` | number | `1` | Maximum instances (1 until NFS multi-instance confirmed) |
| `cpu_limit` | string | `2000m` | Container CPU limit (min 2 vCPU recommended) |
| `memory_limit` | string | `4Gi` | Container memory limit (min 4Gi recommended) |
| `db_name` | string | `openemr` | MySQL database name |
| `db_user` | string | `openemr` | MySQL database user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `enable_nfs` | bool | `true` | NFS for OpenEMR sites directory (required) |
| `nfs_mount_path` | string | `/var/www/localhost/htdocs/openemr/sites` | NFS mount path |
| `enable_redis` | bool | `true` | Redis for PHP session storage |
| `redis_host` | string | `""` | Redis host (defaults to NFS server IP) |
| `redis_port` | string | `6379` | Redis port |
| `ingress_settings` | string | `all` | Traffic source: `all`, `internal`, `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | VPC egress for private NFS and DB |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for daily backups |
| `backup_retention_days` | number | `7` | Days to retain backup files in GCS |
| `enable_audit_logging` | bool | `false` | Set `true` for HIPAA audit trail compliance |

### Key Module Outputs

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `admin_password_secret_id` | Secret Manager secret name for admin password |
| `database_password_secret` | Secret Manager secret name for DB password |
| `database_instance_name` | Cloud SQL instance name |
| `nfs_server_ip` | NFS server internal IP (sensitive) |

### Useful Commands

```bash
# Get service URL
gcloud run services describe ${SERVICE} \
  --region="${REGION}" --project="${PROJECT}" \
  --format="value(status.url)"

# Get admin password
gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" --project="${PROJECT}"

# View live logs
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}"

# List Cloud Run jobs
gcloud run jobs list \
  --region="${REGION}" --project="${PROJECT}" \
  --filter="name~openemr"

# Trigger backup job manually
gcloud run jobs execute <backup-job-name> \
  --region="${REGION}" --project="${PROJECT}"

# List Cloud SQL instances
gcloud sql instances list --project="${PROJECT}" --filter="name~openemr"

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~openemr"

# Check uptime
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

### Further Reading

- [OpenEMR documentation](https://www.open-emr.org/wiki/index.php/OpenEMR_Wiki_Home_Page)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Auth Proxy on Cloud Run](https://cloud.google.com/sql/docs/mysql/connect-run)
- [HIPAA on Google Cloud](https://cloud.google.com/security/compliance/hipaa)
- [Secret Manager documentation](https://cloud.google.com/secret-manager/docs)
- [Cloud Monitoring uptime checks](https://cloud.google.com/monitoring/uptime-checks)
