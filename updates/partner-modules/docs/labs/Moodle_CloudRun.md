# Moodle on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Moodle 4.5** on
Google Cloud Run with the **Moodle_CloudRun** module. You will explore the world's most popular
open-source LMS running on a serverless runtime, covering course creation, user management,
learning activities, file storage, Cloud Scheduler cron integration, and Google Cloud
observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Moodle](#exercise-1--access-moodle)
6. [Exercise 2 — Create a Course](#exercise-2--create-a-course)
7. [Exercise 3 — Learning Activities](#exercise-3--learning-activities)
8. [Exercise 4 — User Management](#exercise-4--user-management)
9. [Exercise 5 — Files and Media](#exercise-5--files-and-media)
10. [Exercise 6 — Database and Storage](#exercise-6--database-and-storage)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Moodle?

Moodle is the world's most popular open-source Learning Management System (LMS), used by
educational institutions, corporations, and governments worldwide to deliver online courses and
training programs. It supports quizzes, assignments, forums, grading, and rich plugin
ecosystems. The `Moodle_CloudRun` module deploys **Moodle 4.5** on Cloud Run Gen 2, backed by
Cloud SQL PostgreSQL 15, Cloud Filestore NFS for shared moodledata, Redis session caching, and
Cloud Scheduler for automated cron tasks.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Serverless LMS** | Cloud Run Gen 2 hosting Apache + PHP 8.3 + Moodle with startup and health probes |
| **NFS Persistence** | Cloud Filestore NFS for shared moodledata accessible across instances |
| **Private Database** | Cloud SQL PostgreSQL 15 with Cloud SQL Auth Proxy sidecar |
| **Redis Session Cache** | Redis for session storage with `moodle_prod_sess_` key prefix |
| **Cloud Scheduler Cron** | Cloud Scheduler triggering `admin/cron.php` every 5 minutes |
| **Secret Management** | Admin password and SMTP credentials in Secret Manager |
| **Course Management** | Full Moodle LMS: courses, quizzes, assignments, forums, gradebook |
| **Observability** | Cloud Logging (PHP/Apache logs) and Cloud Monitoring with uptime checks |

---

## 2. Architecture

```
Browser / Student / Admin
         │
         ▼
Cloud Run Gen 2 Service (moodle)
  ├── Apache 2 + PHP 8.3 + Moodle 4.5
  ├── Cloud SQL Auth Proxy sidecar
  ├── NFS mount: /mnt (moodledata)
  ├── Startup probe: HTTP /health.php
  ├── Liveness probe: HTTP /health.php
  └── Serverless VPC Access connector
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
         ├── Cloud Storage bucket (moodle-media)
         │     └── GCS Fuse mount for themes/plugins (optional)
         │
         └── Secret Manager
               ├── admin password (moodle-admin-password)
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
│  │  Cloud Run Gen 2                                          │   │
│  │  moodle service → https://<hash>.run.app                  │   │
│  │  min_instances=0 (scale to zero), max_instances=3         │   │
│  └─────────────────────┬────────────────────────────────────┘    │
│                         │ VPC connector (private ranges)         │
│  ┌──────────────────────▼─────────────────────────────────────┐  │
│  │  VPC Network                                                │ │
│  │  ┌──────────────────┐  ┌─────────────┐  ┌──────────────┐  │   │
│  │  │  Cloud SQL        │  │  Filestore  │  │  Redis       │  │  │
│  │  │  PostgreSQL 15    │  │  NFS /mnt   │  │  (sessions)  │  │  │
│  │  │  (Auth Proxy)     │  │             │  │              │  │  │
│  │  └──────────────────┘  └─────────────┘  └──────────────┘  │   │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Secret Manager  │  │  Cloud       │  │  Cloud Scheduler   │  │
│  │  (admin, cron,   │  │  Storage     │  │  (moodle-cron      │  │
│  │   smtp secrets)  │  │  (moodle-    │  │   every 5 min)     │  │
│  │                  │  │   media)     │  │                    │  │
│  └──────────────────┘  └──────────────┘  └────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Cloud Logging   │  │  Cloud Monitoring (request count,    │  │
│  │  (PHP/Apache     │  │   latency, uptime check, instance    │  │
│  │   access logs)   │  │   count, Cloud SQL metrics)          │  │
│  └──────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Moodle_CloudRun
    application_version   = "4.5.1"     → Ubuntu + PHP 8.3 + Moodle 4.5
    enable_nfs            = true         → Cloud Filestore at /mnt
    enable_redis          = true         → Redis session storage
    min_instance_count    = 0            → scale to zero when idle
    max_instance_count    = 3            → horizontal scaling
    enable_cloud_armor    = false        → basic deployment (set true for prod)
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

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~moodle" \
  --limit=1)

# Discover the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

# Discover the admin password secret
export ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~moodle-admin" \
  --format="value(name)" \
  --limit=1)
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Moodle_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `moodle` | Base name for all resources |
| `application_version` | `4.5.1` | Moodle version |
| `min_instance_count` | `0` | Scale to zero when idle |
| `max_instance_count` | `3` | Allow horizontal scaling |
| `cpu_limit` | `1000m` | CPU per instance |
| `memory_limit` | `2Gi` | Memory per instance |
| `db_name` | `moodle` | PostgreSQL database |
| `db_user` | `moodle` | PostgreSQL user |
| `enable_redis` | `true` | Redis session caching |
| `enable_nfs` | `true` | NFS for moodledata |
| `ingress_settings` | `all` | Public HTTPS endpoint |

Click **Deploy** and wait for provisioning to complete (approximately 26–46 minutes — Moodle builds from source).

> **What this provisions:** Cloud Run Gen 2 service with Cloud SQL Auth Proxy sidecar, Cloud SQL
> PostgreSQL 15 with pg_trgm extension, Cloud Filestore NFS for moodledata, Secret Manager
> secrets (admin, cron, SMTP passwords), Cloud Scheduler cron job, GCS bucket, Artifact
> Registry, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

After deployment completes, set the shell variables from Section 3 and verify connectivity:

```bash
# Confirm service is running
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions[0].type)"

# Test connectivity (first request may be slow on scale-to-zero)
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}"
# Expected: 200 or 303
```

---

## Exercise 1 — Access Moodle

### Objective

Retrieve the Cloud Run service URL, verify Moodle is running, retrieve admin credentials from
Secret Manager, and log in to the admin dashboard.

### Step 1.1 — Get the Service URL

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)"

echo "Moodle URL: ${SERVICE_URL}"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, url: .uri, state: .terminalCondition.state}'
```

**Expected result:** A URL in the format `https://<hash>.run.app` is returned with terminal condition `CONTAINER_READY`.

### Step 1.2 — Confirm Moodle is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}"
# Expected: 200 or 303 (redirect to login)
```

If `503`, Moodle is performing initial schema installation — wait 60–90 seconds and retry. On first boot, schema installation takes 5–10 minutes.

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

1. Open `${SERVICE_URL}` in your browser.
2. If an installation wizard appears, follow through: confirm database settings, accept licence, set site name and timezone.
3. Navigate to `${SERVICE_URL}/login` and log in as `admin` with the retrieved password.

**Expected result:** You are logged in to the Moodle dashboard as site administrator.

### Step 1.5 — Explore Site Administration

1. Click the user avatar (top-right) > **Site administration**.
2. Review the dashboard sections: **Users**, **Courses**, **Grades**, **Plugins**, **Server**.
3. Navigate to **Site administration > Server > Moodle info** to confirm version 4.5.x.

**Expected result:** Site Administration panel shows Moodle 4.5, PHP 8.3, and PostgreSQL 15 backend.

---

## Exercise 2 — Create a Course

### Objective

Create a new Moodle course, configure course settings, enrol a student, and explore the
course structure.

### Step 2.1 — Create a New Course

1. Navigate to **Site administration > Courses > Add a new course**.
2. Fill in:
   - **Course full name:** `Introduction to Cloud Computing`
   - **Short name:** `CLOUD101`
   - **Category:** `Miscellaneous`
   - **Course start date:** today
   - **Course format:** Weekly
3. Click **Save and display**.

**Expected result:** The empty course page appears with the first weekly section visible.

### Step 2.2 — Configure Course Settings

1. From the course page, click **Edit settings** (gear icon).
2. Review and configure:
   - **Enrolment methods** — manual enrolment enabled by default
   - **Groups mode** — set to `No groups` for this lab
   - **Completion tracking** — enable for activity completion visibility
3. Save settings.

**Expected result:** Course settings saved. Completion tracking is enabled.

### Step 2.3 — Add Course Activities

Click **Turn editing on** (top-right), then click **Add an activity or resource** in Week 1:

1. **Add a Quiz**: Select Quiz, name it `Week 1 Quiz`, save. Click **Edit quiz** to configure question settings.
2. **Add a Forum**: Select Forum, name it `General Discussion`, type `Standard forum for general use`, save.
3. **Add an Assignment**: Select Assignment, name it `Lab Report`, submission types `Online text`, save.

**Expected result:** Three activities appear in the Week 1 section: a Quiz, a Forum, and an Assignment.

### Step 2.4 — Create a Test Student User

1. Navigate to **Site administration > Users > Add a new user**.
2. Fill in: username `student01`, first name `Test`, last name `Student`, email `student01@example.com`, set a password.
3. Click **Create user**.

**Expected result:** User `student01` appears in the users list.

### Step 2.5 — Enrol the Student

1. From the course page, click **Participants** in the left navigation.
2. Click **Enrol users** (top-right button).
3. Search for `student01`, assign **Student** role, click **Enrol users**.

**Expected result:** Student appears in the Participants list with the Student role and enrolment date.

---

## Exercise 3 — Learning Activities

### Objective

Add questions to the quiz, create an assignment submission, post to the forum, and explore
the gradebook.

### Step 3.1 — Edit the Quiz

1. From the course page, click on **Week 1 Quiz**.
2. Click **Edit quiz** > **Add question** > **Multiple choice**.
3. Enter a question: `What is a virtual machine?`, four options, mark the correct answer.
4. Set **Default mark** to 1.0 and save.
5. Click **Preview quiz** to test the question.

**Expected result:** Quiz preview shows the multiple-choice question. Selecting the correct answer shows a pass result.

### Step 3.2 — Submit an Assignment

1. As `student01` (use private browsing or Switch role), navigate to the course.
2. Click **Lab Report** assignment.
3. Click **Add submission**, enter text: `This is my lab report submission.`
4. Click **Save changes**.

**Expected result:** Submission appears with status `Submitted for grading`.

### Step 3.3 — Grade the Assignment

1. As admin, click **Lab Report** > **View all submissions**.
2. Click **Grade** next to student01's submission.
3. Enter a grade (e.g., 85/100) and feedback comment.
4. Click **Save changes**.

**Expected result:** Grade is recorded and visible in the Gradebook.

### Step 3.4 — Post to the Forum

1. Click on **General Discussion** forum.
2. Click **Add a new discussion topic**.
3. Enter subject `Welcome to CLOUD101` and message body.
4. Click **Post to forum**.
5. Add a reply to the post.

**Expected result:** Discussion thread appears with the post and reply. Subscription notification would be sent via SMTP if configured.

### Step 3.5 — Review the Gradebook

1. In the course, click **Grades** in the left navigation.
2. The Grader report shows student01 with the assignment grade (85).
3. Navigate to **Grader report > Grade letters** to review the grading scale.

**Expected result:** Gradebook shows the quiz (not yet attempted) and assignment grade for student01.

---

## Exercise 4 — User Management

### Objective

Create additional users with different roles, explore cohorts, configure role permissions,
and understand the Moodle user hierarchy.

### Step 4.1 — Create a Teacher User

1. Navigate to **Site administration > Users > Add a new user**.
2. Fill in: username `teacher01`, first name `Lab`, last name `Teacher`, email `teacher01@example.com`.
3. Click **Create user**.
4. Go back to the course Participants page and enrol `teacher01` with the **Teacher** role.

**Expected result:** Teacher appears in Participants with Teacher role. They can edit course content.

### Step 4.2 — Create a Cohort

1. Navigate to **Site administration > Users > Cohorts**.
2. Click **Add new cohort**: name `Cloud 101 Students`, description `Students for the cloud computing course`.
3. Click **Add members** and add `student01` to the cohort.

**Expected result:** Cohort created with student01 as a member.

### Step 4.3 — Configure Role Permissions

1. Navigate to **Site administration > Users > Define roles**.
2. Click on the **Student** role to review its permissions.
3. Note: Students can view content, submit activities, and read forums but cannot edit course content.
4. Review the **Teacher** role — teachers can grade, edit, and manage enrolments.

**Expected result:** Role permission matrix shows the difference between Student and Teacher capabilities.

### Step 4.4 — Explore Authentication Settings

1. Navigate to **Site administration > Plugins > Authentication > Manage authentication**.
2. Review enabled authentication methods: Email-based self-registration, Manual accounts.
3. Note the password policies under **Site administration > Security > Site security settings**.

**Expected result:** Email self-registration and manual account creation are enabled. Password policy requires minimum length and complexity.

### Step 4.5 — View User Activity Reports

1. Navigate to **Site administration > Reports > Activity**.
2. Select the course `CLOUD101` and review student activity.
3. Navigate to **Reports > User list** to see all enrolled users.

**Expected result:** Activity report shows student01's last access time and quiz/forum activity.

---

## Exercise 5 — Files and Media

### Objective

Upload files to a course, manage the file repository, verify NFS persistence for moodledata,
and check GCS storage integration.

### Step 5.1 — Upload a File Resource

1. In the course, click **Turn editing on** > **Add an activity or resource** > **File**.
2. Name the resource `Course Slides`.
3. Click **Add file** (paper icon) in the file picker and upload a PDF or image.
4. Set **Display** to `Embed` and save.

**Expected result:** The file resource appears in the course. Students can view or download it.

### Step 5.2 — Explore the File Repository

1. Click **Add an activity or resource** > any activity > click the file picker icon.
2. Review the available repositories: **Recent files**, **Upload a file**, **URL downloader**, **Server files**.
3. Navigate to **Site administration > Plugins > Repositories** to view configured repositories.

**Expected result:** At least the Upload, Server files, and Recent files repositories are available.

### Step 5.3 — Check NFS Persistence

Moodle's moodledata directory is stored on Cloud Filestore NFS. Verify the mount:

```bash
# Check the NFS volume configuration on the Cloud Run service
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml" | grep -A10 "volumes:"
```

**REST API:**
```bash
curl -s \
  "https://file.googleapis.com/v1/projects/${PROJECT}/locations/-/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.instances[] | {name, state, tier, fileShares}'
```

**Expected result:** The Cloud Run service has an NFS volume mounted at `/mnt`. The Filestore instance shows `READY` state with a file share for moodledata.

### Step 5.4 — Verify GCS Storage Bucket

```bash
# List Moodle GCS buckets
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~moodle"

# REST API
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=moodle" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name, location, storageClass}'
```

**Expected result:** A `moodle-media` bucket exists in STANDARD storage class. This bucket can be used for themes and plugins via GCS Fuse mounts.

### Step 5.5 — Test Scale-to-Zero Persistence

```bash
# Force a new Cloud Run revision (simulates scale-to-zero and new instance)
gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --update-labels "lab-restart=$(date +%s)"

# Wait for new revision
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

1. After the new revision is active, reload the Moodle site.
2. Verify the course, users, and uploaded files are still present.

**Expected result:** All course content, users, and files persist across Cloud Run instance replacement because moodledata is stored on NFS.

---

## Exercise 6 — Database and Storage

### Objective

Inspect the Cloud SQL PostgreSQL instance, review backup configuration, and trigger a manual
database backup via the Moodle admin panel.

### Step 6.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~moodle" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe "${INSTANCE}" \
  --project="${PROJECT}" \
  --format="table(name, databaseVersion, settings.tier, settings.backupConfiguration.enabled)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/sql/v1beta4/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name, version: .databaseVersion, state}'
```

**Expected result:** A PostgreSQL 15 instance exists with automated backups enabled. The database tier shows the configured storage class.

### Step 6.2 — Review Cloud SQL Monitoring

Navigate to **Cloud Console > SQL > Instances > [your-instance] > Monitoring**:

1. Review **CPU utilisation** — shows Moodle's database load.
2. Review **Active connections** — shows active Moodle→PostgreSQL connections via Auth Proxy.
3. Review **Storage used** — reflects the Moodle course database size.

```bash
# Query Cloud SQL CPU utilisation via REST
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloudsql_database::cloudsql.googleapis.com/database/cpu/utilization | filter resource.database_id =~ '${PROJECT}:${INSTANCE}' | within 30m\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**Expected result:** Cloud SQL shows active connections from Moodle's connection pool. CPU is low during idle periods.

### Step 6.3 — Run a Moodle Admin Backup

1. Navigate to **Site administration > Courses > Backups > General backup defaults**.
2. Review the backup settings (automated course backups run on the configured schedule).
3. Navigate to **Site administration > Courses > Backups > Automated backup status**.
4. Click **Run now** to trigger an immediate backup.

**Expected result:** Backup starts immediately. A backup file is created in the course's backup area.

### Step 6.4 — Review Cloud Scheduler Cron

```bash
# List Cloud Scheduler jobs for Moodle
gcloud scheduler jobs list \
  --project="${PROJECT}" \
  --location="${REGION}" \
  --filter="name~moodle"

# Describe the cron job
CRON_JOB=$(gcloud scheduler jobs list \
  --project="${PROJECT}" \
  --location="${REGION}" \
  --filter="name~moodle" \
  --format="value(name)" | head -1)

gcloud scheduler jobs describe "${CRON_JOB}" \
  --location="${REGION}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs?filter=name:moodle" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.jobs[] | {name, schedule, state, lastAttemptTime}'
```

**Expected result:** A `moodle-cron` Cloud Scheduler job runs every 5 minutes, calling `${SERVICE_URL}/admin/cron.php?password=<MOODLE_CRON_PASSWORD>`.

### Step 6.5 — Manually Trigger Cron

```bash
# Trigger the cron job immediately
gcloud scheduler jobs run "${CRON_JOB}" \
  --location="${REGION}" \
  --project="${PROJECT}"

# Verify the cron.php endpoint
curl -s -o /dev/null -w "%{http_code}" \
  "${SERVICE_URL}/admin/cron.php"
# Expected: 200
```

**Expected result:** Cron runs and processes pending scheduled tasks. HTTP 200 returned from cron.php.

---

## Exercise 7 — Cloud Logging

### Objective

Query Moodle PHP/Apache logs, filter for errors, view Cloud SQL Auth Proxy logs, and stream
live logs using gcloud.

### Step 7.1 — View Moodle Logs in Log Explorer

Navigate to **Cloud Console > Logging > Log Explorer** and use this filter:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

**Expected result:** PHP/Apache access logs appear with Moodle page requests, Auth Proxy connection messages, and cron execution entries.

### Step 7.2 — Filter Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
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
    \"filter\": \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp: .timestamp, text: .textPayload}'
```

**Expected result:** Apache access log lines appear (`GET /course/view.php HTTP/1.1 200`). Auth Proxy connection messages confirm database connectivity.

### Step 7.3 — Filter PHP Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"PHP Fatal|PHP Error"' \
  --project="${PROJECT}" \
  --freshness=24h \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Under normal operation, no PHP fatal errors appear. PHP deprecation notices may appear for some plugins.

### Step 7.4 — View Cron Execution Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"cron.php"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Each Cloud Scheduler trigger produces a log line for the `cron.php` request with HTTP 200 status.

### Step 7.5 — Stream Live Logs

```bash
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

Make requests to the Moodle dashboard and observe access log entries in real time.

**Expected result:** Apache access log lines appear within seconds of making Moodle page requests.

---

## Exercise 8 — Cloud Monitoring

### Objective

Explore Cloud Run metrics for Moodle, review the uptime check, inspect Cloud SQL monitoring,
and understand scale-to-zero instance behaviour.

### Step 8.1 — View Cloud Run Metrics in Console

Navigate to **Cloud Console > Cloud Run > Services > moodle** and review the metrics tabs:

| Metric Tab | Key Metrics |
|---|---|
| **Requests** | Request count, latency P50/P95/P99 |
| **Container** | CPU utilisation, memory utilisation |
| **Instances** | Active instance count (scales to zero when idle) |

**Expected result:** Instance count drops to 0 during idle periods (`min_instance_count = 0`). Request count increases as you navigate Moodle.

### Step 8.2 — Review the Uptime Check

```bash
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .displayName, path: .httpCheck.path, period: .period}'
```

**Expected result:** An uptime check targeting the Moodle service root path runs every 60 seconds from multiple global locations with passing status.

### Step 8.3 — Query Request Metrics via REST API

```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**Expected result:** Total request count for the past hour is returned.

### Step 8.4 — Review Cloud SQL Metrics

Navigate to **Cloud Console > SQL > Instances > [your-instance] > Monitoring**:

1. **CPU utilisation** — should be low for this lab workload.
2. **Active connections** — shows Moodle Auth Proxy pooled connections.
3. **Storage** — reflects the moodle database size.

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:cloudsql.googleapis.com" \
  --project="${PROJECT}" \
  | grep -E "cpu|connections|storage"
```

**Expected result:** Cloud SQL shows stable CPU utilisation and consistent connection count from the Auth Proxy pool.

### Step 8.5 — Explore Metrics Explorer

1. Navigate to **Cloud Console > Monitoring > Metrics Explorer**.
2. Select resource type **Cloud Run Revision** and plot:
   - `run.googleapis.com/container/instance_count` — observe scale-to-zero
   - `run.googleapis.com/request_latencies` — note the cold-start latency spike

**Expected result:** Instance count drops to 0 during idle periods. Request latency shows a spike on the first request after scale-to-zero (cold start).

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Moodle_CloudRun` deployment. This removes
the Cloud Run service, Cloud SQL instance, Cloud Filestore NFS, GCS bucket, Secret Manager
secrets, Cloud Scheduler jobs, VPC connector, and all IAM bindings.

> **Warning:** This permanently deletes all data including the PostgreSQL database and NFS
> moodledata. Export any course content before undeploying via **Site administration >
> Courses > Restore/Backup**.

> **Note:** Cloud SQL and Cloud Filestore deletion takes 5–10 minutes each.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --quiet

# Delete the Cloud SQL instance
gcloud sql instances delete "${INSTANCE}" \
  --project="${PROJECT}" --quiet

# Delete Secret Manager secrets
gcloud secrets list --project="${PROJECT}" --filter="name~moodle" \
  --format="value(name)" | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `moodle` | Base name for Cloud Run service and resources |
| `application_version` | string | `4.5.1` | Moodle image version (built from Ubuntu 24.04 + PHP 8.3) |
| `min_instance_count` | number | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | number | `3` | Maximum Cloud Run instances |
| `cpu_limit` | string | `1000m` | CPU per Cloud Run instance |
| `memory_limit` | string | `2Gi` | Memory per Cloud Run instance |
| `db_name` | string | `moodle` | PostgreSQL database name |
| `db_user` | string | `moodle` | PostgreSQL application user |
| `enable_redis` | bool | `true` | Enable Redis for session caching |
| `redis_host` | string | `""` | Redis host IP (defaults to NFS server IP) |
| `redis_port` | string | `6379` | Redis port |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore NFS for moodledata (required) |
| `nfs_mount_path` | string | `/mnt` | NFS mount path inside the container |
| `ingress_settings` | string | `all` | Traffic ingress setting |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `enable_cloud_armor` | bool | `false` | Enable Cloud Armor WAF |
| `enable_cdn` | bool | `false` | Enable Cloud CDN (requires Cloud Armor) |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | number | `7` | Days to retain backup files |

### Useful Commands

```bash
# Get service URL
gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} --format="value(status.url)"

# View environment variables
gcloud run services describe ${SERVICE} --region=${REGION} --format="json" | jq '.spec.template.spec.containers[0].env[]'

# List Cloud SQL instances
gcloud sql instances list --project=${PROJECT} --filter="name~moodle"

# Access admin password secret
gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT}

# Tail Cloud Run logs
gcloud run services logs tail ${SERVICE} --region=${REGION} --project=${PROJECT}

# List Cloud Scheduler jobs
gcloud scheduler jobs list --project=${PROJECT} --location=${REGION} --filter="name~moodle"

# Run cron job now
gcloud scheduler jobs run ${CRON_JOB} --location=${REGION} --project=${PROJECT}

# List Cloud Run revisions
gcloud run revisions list --service=${SERVICE} --region=${REGION} --project=${PROJECT}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# List Filestore instances
gcloud filestore instances list --project=${PROJECT}
```

### Further Reading

- [Moodle official documentation](https://docs.moodle.org/)
- [Moodle Admin Quick Guide](https://docs.moodle.org/405/en/Administration_quick_guide)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Cloud Filestore NFS](https://cloud.google.com/filestore/docs)
- [Cloud Scheduler documentation](https://cloud.google.com/scheduler/docs)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Redis session caching in Moodle](https://docs.moodle.org/405/en/Session_handling)
