---
title: "Moodle on GKE — Lab Guide"
sidebar_label: "Moodle GKE"
---

# Moodle on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_GKE)**

## Overview

**Estimated time:** 3–4 hours

Moodle is an open-source Learning Management System (LMS) used by educational institutions worldwide. This lab deploys Moodle 4.5 on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for shared moodledata, GCS Fuse volumes, and Redis session caching. Cloud Scheduler triggers the Moodle cron process for scheduled tasks.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment
- Cloud SQL PostgreSQL 15 instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- Cloud Filestore (NFS) instance for shared moodledata
- GCS Fuse volumes and Cloud Storage buckets
- Secret Manager secrets (admin password, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer), HPA, and PodDisruptionBudget
- Cloud Monitoring uptime checks and alert policies
- Kubernetes Gateway API with static IP reservation

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Complete the Moodle installation wizard (if required)
- Access Site Administration with admin credentials from Secret Manager
- Create courses and enroll users
- Explore LMS features (Gradebook, Quiz, Assignment, Forum)
- Review scheduled tasks and cron configuration
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

This lab uses two primary tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources, view logs |
| `kubectl` | Inspect pods, deployments, and services |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, GKE cluster, Cloud SQL instance, and NFS server).
3. The following APIs enabled (Services GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `file.googleapis.com`
   - `cloudscheduler.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` installed and available in PATH.
6. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

In the RAD UI, open the Moodle GKE module and fill in the deployment form. The table below describes the key variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for resources |
| `application_name` | No | `"moodle"` | Base name used in Kubernetes and GCP resource naming |
| `application_version` | No | `"4.5.1"` | Moodle container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `gke_cluster_name` | No | `""` | Target GKE cluster (auto-discovered if empty) |
| `min_instance_count` | No | `0` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `cpu_limit` | No | `"2000m"` | CPU limit per Moodle container |
| `memory_limit` | No | `"4Gi"` | Memory limit per Moodle container |
| `container_resources` | No | `{cpu_limit="1000m", memory_limit="512Mi"}` | Fine-grained resource limits object |
| `database_type` | No | `"POSTGRES"` | Cloud SQL database engine |
| `db_name` | No | `"moodle"` | PostgreSQL database name |
| `db_user` | No | `"moodle"` | PostgreSQL database username |
| `enable_redis` | No | `true` | Enable Redis for session caching |
| `redis_host` | No | `""` | Redis host IP (defaults to NFS server IP) |
| `redis_port` | No | `"6379"` | Redis port |
| `enable_nfs` | No | `true` | Mount Cloud Filestore NFS for moodledata |
| `nfs_mount_path` | No | `"/mnt/nfs"` | NFS mount path inside the container |
| `enable_custom_domain` | No | `true` | Enable Gateway API with static IP |
| `reserve_static_ip` | No | `true` | Reserve a static external IP |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |
| `resource_labels` | No | `{}` | Labels applied to all resources |

### Step 1.2 — Initialise and Deploy

Once the form is filled in, click **Deploy** in the RAD UI. Deployment runs automatically.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| VPC and networking (via Services GCP) | Pre-provisioned |
| Cloud SQL PostgreSQL instance | 8–12 min |
| GKE namespace, workload identity, NFS | 3–5 min |
| Artifact Registry image build (Cloud Build) | 8–15 min |
| Moodle pod start and health checks | 5–8 min |
| **Total** | **24–40 min** |

> Note: Moodle performs database schema installation on first boot, which extends startup time significantly. The startup probe is configured with a high `failure_threshold` to accommodate this.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `service_name` | Kubernetes service name |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for DB password |
| `nfs_server_ip` | NFS server internal IP |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace (pattern: appmoodledemo<deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appmoodle" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~moodle" \
  --format="value(name)" \
  --limit=1)

export MOODLE_URL="http://${EXTERNAL_IP}"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Fetch Cluster Credentials

```bash
gcloud container clusters get-credentials \
  $(gcloud container clusters list --project=${PROJECT} --format="value(name)" | head -1) \
  --region=${REGION} \
  --project=${PROJECT}
```

**gcloud equivalent:**
```bash
gcloud container clusters list --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters"
```

**Expected result:** kubectl is configured and the context is set to your GKE cluster.

### Step 2.2 — Verify Moodle Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get service -n ${NAMESPACE}
```

**Expected result:** The Moodle pod shows `Running` status. The service has an assigned `EXTERNAL-IP`.

Moodle installs its database schema on the first boot. Monitor startup progress:

```bash
kubectl logs -n ${NAMESPACE} -l app=moodle -f
```

**Expected result:** Logs show Moodle's PHP installer running SQL migrations. When complete, you see `Apache/PHP ready` messages.

### Step 2.3 — Confirm Moodle is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}
```

**Expected result:** HTTP `200` or `303` (redirect to login page).

---

## Phase 3 — Complete Moodle Setup [MANUAL]

### Step 3.1 — Retrieve Admin Credentials

The admin password is stored in Secret Manager:

```bash
# List Moodle-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~moodle"

# Retrieve admin password
gcloud secrets versions access latest \
  --secret="moodle-admin-password" \
  --project=${PROJECT}
```

**gcloud equivalent (describe a specific secret):**
```bash
gcloud secrets describe moodle-admin-password --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/moodle-admin-password/versions/latest:access" \
  | jq -r '.payload.data' | base64 -d
```

**Expected result:** The admin password is returned. The default admin username is `admin`.

### Step 3.2 — Access Moodle and Log In

Open a browser and navigate to `http://${EXTERNAL_IP}`. If an installation wizard appears:

1. Confirm the database settings (pre-populated from environment variables).
2. Proceed through each wizard step — Moodle validates the database connection and runs schema installation.
3. Set the site name, admin email, and timezone.

If installation was performed automatically by the init job, navigate directly to:

```
http://${EXTERNAL_IP}/login
```

Log in with username `admin` and the password from Secret Manager.

**Expected result:** You are logged in to the Moodle dashboard as site administrator.

### Step 3.3 — Access Site Administration

1. Click the user menu (top-right) > **Site administration**.
2. Review the **Dashboard**, **Users**, **Courses**, and **Server** sections.

**Expected result:** The Site Administration panel is accessible. Note the Moodle version (4.5.x) and server information.

---

## Phase 4 — Create Courses and Enroll Users [MANUAL]

### Step 4.1 — Create a New Course

1. Navigate to **Site administration > Courses > Add a new course**.
2. Fill in:
   - **Course full name**: e.g. `Introduction to Cloud Computing`
   - **Short name**: e.g. `CLOUD101`
   - **Category**: `Miscellaneous`
   - **Course start date**: today
3. Click **Save and display**.

**Expected result:** The empty course page appears with editing mode enabled.

### Step 4.2 — Add Course Activities

In the new course, click **Turn editing on** (top-right), then click **Add an activity or resource** in any section:

1. **Add a Quiz**: Select Quiz, enter a name, save. Then click **Edit quiz** to add questions.
2. **Add a Forum**: Select Forum, name it "General Discussion", set type to "Standard forum", save.
3. **Add an Assignment**: Select Assignment, enter a name and submission settings, save.

**Expected result:** Three activities appear in the course: a Quiz, a Forum, and an Assignment.

### Step 4.3 — Create a Test Student User

1. Navigate to **Site administration > Users > Add a new user**.
2. Fill in username, first/last name, email, and password.
3. Click **Create user**.

**Expected result:** The new student user appears in the users list.

### Step 4.4 — Enroll the Student in the Course

1. From the course page, click **Participants** in the left navigation.
2. Click **Enroll users** (top-right button).
3. Search for your test student, assign the **Student** role, click **Enroll users**.

**Expected result:** The student appears in the Participants list with the Student role.

### Step 4.5 — Test the Student View

1. Click the user menu > **Switch role to > Student** (or log in as the student in a private browsing window).
2. Navigate to the course from the student's **My courses** dashboard.

**Expected result:** The student sees the course activities but cannot edit content. Quiz and forum links are accessible.

---

## Phase 5 — Explore LMS Features [MANUAL]

### Step 5.1 — Gradebook Navigation

1. In the course, click **Grades** in the left navigation.
2. The Gradebook shows all enrolled students and their grades for each graded activity.

**Expected result:** A table appears with student rows and activity column headers. Grades are empty until submissions are made.

### Step 5.2 — Quiz Editor

1. Click on the Quiz activity created in Phase 4.
2. Click **Edit quiz** > **Add question** > select a question type (e.g. **Multiple choice**).
3. Enter a question and four answer options, mark the correct answer, save.
4. Return to the quiz and click **Preview quiz** to test it.

**Expected result:** The quiz preview renders the multiple-choice question correctly. Grading feedback appears after submission.

### Step 5.3 — Assignment Submissions

1. Click on the Assignment activity.
2. Click **View all submissions** to see the submissions table.
3. As admin, click **Grade** next to a student to enter a manual grade.

**Expected result:** The grading interface shows a text area for feedback and a grade input. The grade appears in the Gradebook after saving.

### Step 5.4 — Forum Posts

1. Click on the Forum activity.
2. Click **Add a new discussion topic**, enter a subject and message, click **Post to forum**.
3. View the thread and add a reply.

**Expected result:** The discussion thread appears in the forum. Students can reply to threads.

### Step 5.5 — Dashboard and My Courses View

1. Click the **Home** or **Dashboard** link in the top navigation.
2. The dashboard shows recently accessed courses, calendar events, and upcoming activities.

**Expected result:** The dashboard aggregates upcoming deadlines, unread forum posts, and course progress across all enrolled courses.

---

## Phase 6 — Scheduled Tasks and Cron [MANUAL]

### Step 6.1 — Navigate to Scheduled Tasks

1. In Site Administration, navigate to **Server > Scheduled tasks**.
2. Review the list of Moodle scheduled tasks — each has a schedule, last run time, and status.

**Expected result:** Tasks such as `Send message digest emails`, `Update course completion status`, and `Clean up log table` appear with their cron schedules.

### Step 6.2 — Review Moodle Cron Setup

Moodle requires its cron process to run regularly. In this deployment, Cloud Scheduler triggers `cron.php` on the Moodle container.

**gcloud — list Cloud Scheduler jobs for this deployment:**
```bash
gcloud scheduler jobs list \
  --project=${PROJECT} \
  --location=${REGION} \
  --filter="name~moodle"
```

**gcloud — describe the cron job:**
```bash
gcloud scheduler jobs describe \
  $(gcloud scheduler jobs list --project=${PROJECT} --location=${REGION} --filter="name~moodle" --format="value(name)" | head -1) \
  --location=${REGION} \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs?filter=name:moodle"
```

**Expected result:** A Cloud Scheduler job appears (e.g. `moodle-cron`) with a schedule of `*/5 * * * *` (every 5 minutes) or similar. The last run time should be recent.

### Step 6.3 — Verify the cron.php Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "http://${EXTERNAL_IP}/admin/cron.php"
```

**Expected result:** HTTP `200` — the cron script responds with `0` or a summary of tasks processed.

### Step 6.4 — Inspect Kubernetes CronJobs

If cron jobs are configured as Kubernetes CronJobs:

```bash
kubectl get cronjobs -n ${NAMESPACE}
kubectl get jobs -n ${NAMESPACE}
```

**Expected result:** A CronJob resource (e.g. `moodle-cron`) appears in the namespace. Recent job completions are listed.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Moodle Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

Use the following query to view Moodle pod logs:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="moodle"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, jsonPayload.message)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** PHP/Apache access logs appear alongside Moodle-specific messages. Database connection logs from the Cloud SQL Auth Proxy sidecar also appear.

### Step 7.2 — Filter PHP Errors

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
textPayload=~"PHP (Warning|Fatal|Error)"
```

**Expected result:** Under normal operation, no PHP fatal errors should appear. PHP notices and deprecation warnings may appear for some plugins.

### Step 7.3 — View Cloud SQL Proxy Logs

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="cloudsql-proxy"
```

**Expected result:** Cloud SQL Auth Proxy connection and health check logs appear, confirming successful database connectivity.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### Step 8.1 — View Service Metrics

Navigate to **Monitoring > Metrics Explorer** in the Cloud Console.

Useful metrics for GKE Moodle deployments:

| Metric | Description |
|---|---|
| `kubernetes.io/container/cpu/usage_time` | CPU usage per container |
| `kubernetes.io/container/memory/used_bytes` | Memory usage per container |
| `kubernetes.io/pod/restart_count` | Pod restarts |
| `kubernetes.io/container/uptime` | Container uptime |
| `cloudsql.googleapis.com/database/cpu/utilization` | Cloud SQL CPU usage |

**gcloud equivalent:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** CPU and memory charts show Moodle's resource consumption. At rest, Moodle typically uses 200–500 MB memory and low CPU.

### Step 8.2 — Review Uptime Checks

Navigate to **Monitoring > Uptime checks**.

**Expected result:** An uptime check (if `uptime_check_config.enabled = true`) runs every 60 seconds against `http://${EXTERNAL_IP}/` and shows **Passing** status from multiple global locations.

**gcloud equivalent:**
```bash
gcloud monitoring uptime list-configs \
  --project=${PROJECT}
```

### Step 8.3 — Cloud SQL Monitoring

Navigate to **SQL > Instances > [your-instance]** in the Cloud Console. Click **Monitoring** to view:
- CPU utilisation
- Active connections
- Storage used

**Expected result:** Connection count shows active Moodle→PostgreSQL connections. Storage usage reflects the Moodle database size.

---

## Phase 9 — Delete [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

**Approximate destroy duration:** 20–30 minutes (Cloud SQL and Cloud Filestore deletion take the longest).

> **Warning:** This permanently deletes all resources including the PostgreSQL database and NFS moodledata. Back up any course content before deleting.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and workload provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Cloud Filestore NFS for moodledata | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Workload Identity and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify Moodle pod running | 2 | No |
| Retrieve admin credentials from Secret Manager | 3 | No |
| Complete Moodle installation wizard | 3 | No |
| Access Site Administration | 3 | No |
| Create course and add activities | 4 | No |
| Create student user and enroll | 4 | No |
| Explore Gradebook, Quiz, Assignment, Forum | 5 | No |
| Review scheduled tasks and cron | 6 | No |
| Review PHP/Apache logs in Cloud Logging | 7 | No |
| Review GKE and Cloud SQL metrics | 8 | No |
| Delete infrastructure | 9 | Yes |
