# Moodle on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_CloudRun)**

## Overview

**Estimated time:** 3–4 hours

Moodle is an open-source Learning Management System (LMS) used by educational institutions worldwide. This lab deploys Moodle 4.5 on Google Cloud Run backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for shared moodledata, GCS Fuse volume mounts, Redis session caching, Cloud Scheduler for cron jobs, and optional Cloud CDN and Cloud Armor for performance and security.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Cloud Filestore (NFS) instance for shared moodledata
- GCS Fuse volume mounts and Cloud Storage buckets
- Secret Manager secrets (admin password, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Scheduler jobs for Moodle cron tasks
- Cloud Monitoring uptime checks and alert policies
- Optional Cloud CDN and Cloud Armor (Global HTTPS Load Balancer)

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Complete the Moodle installation wizard (if required)
- Access Site Administration with admin credentials from Secret Manager
- Create courses and enroll users
- Explore LMS features (Gradebook, Quiz, Assignment, Forum)
- Review Cloud Scheduler cron setup
- Explore Cloud Logging, Cloud Monitoring, and CDN metrics

---

## CLI and REST API Overview

This lab uses two primary tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL, and NFS server).
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `vpcaccess.googleapis.com`
   - `file.googleapis.com`
   - `cloudscheduler.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"moodle"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"4.5.1"` | Moodle container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances |
| `cpu_limit` | No | `"1000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"2Gi"` | Memory per Cloud Run instance |
| `db_name` | No | `"moodle"` | PostgreSQL database name |
| `db_user` | No | `"moodle"` | PostgreSQL database username |
| `enable_redis` | No | `true` | Enable Redis for session caching |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP) |
| `redis_port` | No | `"6379"` | Redis port |
| `enable_nfs` | No | `true` | Mount NFS for moodledata |
| `nfs_mount_path` | No | `"/mnt/nfs"` | NFS mount path inside the container |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress: `"ALL_TRAFFIC"` or `"PRIVATE_RANGES_ONLY"` |
| `enable_cloud_armor` | No | `false` | Enable Cloud Armor WAF with Global HTTPS Load Balancer |
| `enable_cdn` | No | `false` | Enable Cloud CDN (requires `enable_cloud_armor = true`) |
| `application_domains` | No | `[]` | Custom domain names for the load balancer |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initialise and Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Cloud Filestore NFS provisioning | 3–5 min |
| Artifact Registry image build (Cloud Build) | 8–15 min |
| Cloud Run service deployment | 2–4 min |
| Moodle startup and DB schema installation | 5–10 min |
| **Total** | **26–46 min** |

> Note: Moodle performs database schema installation on the first boot. The startup probe is configured with a high `failure_threshold` (20) to allow time for this. Cloud Run will not route traffic until the `/health.php` probe succeeds.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `service_location` | GCP region |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `nfs_server_ip` | NFS server internal IP |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "moodle")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret (filter by app name)
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~moodle" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the Service URL

```bash
echo "Moodle URL: ${SERVICE_URL}"
```

**gcloud equivalent:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.url)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

**Expected result:** A URL in the format `https://<hash>-<hash>.a.run.app` is printed. This is the public Moodle URL.

### Step 2.2 — Confirm Moodle is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}
```

**Expected result:** HTTP `200` or `303` (redirect to the Moodle login page). If you see `503`, Moodle is still performing the initial database installation — wait 60–90 seconds and retry.

### Step 2.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready`. Container configuration shows the Cloud SQL Auth Proxy sidecar, NFS volume mount, and resource limits.

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

**gcloud — list secret versions:**
```bash
gcloud secrets versions list moodle-admin-password --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/moodle-admin-password/versions/latest:access" \
  | jq -r '.payload.data' | base64 -d
```

**Expected result:** The admin password is printed. The default admin username is `admin`.

### Step 3.2 — Access Moodle and Log In

Open `${SERVICE_URL}` in a browser. If an installation wizard appears, follow through:

1. Confirm database settings (pre-populated from environment).
2. Accept the licence agreement.
3. Complete the administrator account setup.
4. Configure the site name, timezone, and language.

If installation ran automatically via the init job, navigate to `${SERVICE_URL}/login` and log in as `admin`.

**Expected result:** You are logged in to the Moodle dashboard as site administrator.

### Step 3.3 — Access Site Administration

1. Click the user avatar (top-right) > **Site administration**.
2. Explore the dashboard sections: **Users**, **Courses**, **Grades**, **Plugins**, **Server**.

**gcloud — view the Moodle Cloud Run revision environment:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | {name, value}'
```

**Expected result:** The Site Administration panel is accessible. Environment variables such as `DB_HOST`, `DB_NAME`, and `MOODLE_URL` are injected from the module configuration.

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

In the course, click **Turn editing on** (top-right), then click **Add an activity or resource**:

1. **Add a Quiz**: Select Quiz, enter a name, save. Click **Edit quiz** to add questions.
2. **Add a Forum**: Select Forum, name it "General Discussion", set type to "Standard forum", save.
3. **Add an Assignment**: Select Assignment, enter a name and submission settings, save.

**Expected result:** Three activities appear in the course content area.

### Step 4.3 — Create a Test Student User

1. Navigate to **Site administration > Users > Add a new user**.
2. Enter username, first/last name, email, and password.
3. Click **Create user**.

**Expected result:** The new student user appears in the users list.

### Step 4.4 — Enroll the Student

1. From the course page, click **Participants** in the left navigation.
2. Click **Enroll users** (top-right).
3. Search for your test student, set role to **Student**, click **Enroll users**.

**Expected result:** The student appears in the Participants list.

### Step 4.5 — Test the Student View

Log in as the student (use a private browsing window) or use **Switch role to > Student**.

**Expected result:** The student sees the course and its activities without editing controls. They can attempt the quiz, post in the forum, and submit assignments.

---

## Phase 5 — Explore LMS Features [MANUAL]

### Step 5.1 — Gradebook Navigation

1. In the course, click **Grades** in the left navigation.
2. The Gradebook shows students and grades for all graded activities.

**Expected result:** The Grader report shows rows for each student and columns for each graded item.

### Step 5.2 — Quiz Editor

1. Click on the Quiz activity.
2. Click **Edit quiz** > **Add question** > select **Multiple choice**.
3. Enter a question, four options, and the correct answer. Save.
4. Click **Preview quiz** to test.

**Expected result:** The quiz renders and evaluates answers. Grade appears in the Gradebook.

### Step 5.3 — Assignment Submissions

1. Click on the Assignment activity.
2. Click **View all submissions** to see the submissions table.
3. As admin, click **Grade** to enter a score and feedback.

**Expected result:** The grade is recorded and visible in the Gradebook.

### Step 5.4 — Forums

1. Click on the Forum activity.
2. Click **Add a new discussion topic**, enter a subject and message, click **Post to forum**.
3. Reply to the thread.

**Expected result:** The thread and reply appear in the forum. Subscription notifications would be sent via Moodle's email system.

### Step 5.5 — My Courses Dashboard

Click **Home** or **Dashboard** in the top navigation.

**Expected result:** The dashboard aggregates upcoming deadlines, unread forum posts, recently accessed courses, and calendar events across all enrolled courses.

---

## Phase 6 — Scheduled Tasks and Cron [MANUAL]

### Step 6.1 — Navigate to Scheduled Tasks

1. In Site Administration, navigate to **Server > Scheduled tasks**.
2. Review the list of Moodle scheduled tasks and their last run times.

**Expected result:** Tasks such as `Send message digest emails`, `Update course completion status`, and `Run grade_cron()` appear with their schedules and last run timestamps.

### Step 6.2 — Review Cloud Scheduler Cron Jobs

Moodle requires cron to run regularly. This deployment uses Cloud Scheduler to trigger the cron process on Cloud Run.

**gcloud — list Cloud Scheduler jobs:**
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

**Expected result:** A Cloud Scheduler job (e.g. `moodle-cron`) is listed with a schedule (typically `*/5 * * * *` for every 5 minutes) and a target URL pointing to the Cloud Run service's `cron.php` endpoint.

### Step 6.3 — Verify the cron.php Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "${SERVICE_URL}/admin/cron.php"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "${SERVICE_URL}/admin/cron.php"
```

**Expected result:** HTTP `200`. The cron script processes pending scheduled tasks and returns output.

### Step 6.4 — Manually Trigger the Cloud Scheduler Job

```bash
gcloud scheduler jobs run \
  $(gcloud scheduler jobs list --project=${PROJECT} --location=${REGION} --filter="name~moodle" --format="value(name)" | head -1) \
  --location=${REGION} \
  --project=${PROJECT}
```

**Expected result:** The cron job is triggered immediately. Check the Cloud Run logs to see cron.php execution output.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Moodle Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

Use the following query to view Cloud Run Moodle logs:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** PHP/Apache access logs and Moodle-specific messages appear. Cloud SQL Auth Proxy connection messages also appear. Look for `Apache/2.x` access log lines for each page request.

### Step 7.2 — Filter PHP Errors

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"PHP (Fatal|Error)"
severity>=WARNING
```

**Expected result:** Under normal operation, no fatal PHP errors should appear. Plugin-related notices may appear depending on the Moodle configuration.

### Step 7.3 — View Cron Execution Logs

Filter logs for cron.php requests:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"cron.php"
```

**Expected result:** Each Cloud Scheduler trigger produces a log line for the `cron.php` request with a `200` status code.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### Step 8.1 — View Service Metrics

Navigate to **Monitoring > Metrics Explorer** in the Cloud Console.

Useful metrics for Cloud Run Moodle deployments:

| Metric | Description |
|---|---|
| `run.googleapis.com/request_count` | Requests per second |
| `run.googleapis.com/request_latencies` | Request latency distribution |
| `run.googleapis.com/container/instance_count` | Number of active instances |
| `run.googleapis.com/container/cpu/utilizations` | CPU utilisation per revision |
| `run.googleapis.com/container/memory/utilizations` | Memory utilisation per revision |
| `cloudsql.googleapis.com/database/cpu/utilization` | Cloud SQL CPU usage |

**gcloud equivalent:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com" \
  --project=${PROJECT} \
  --limit=10
```

**Expected result:** Cloud Run metrics charts show request count, latency percentiles, and instance count over time.

### Step 8.2 — Review Uptime Checks

Navigate to **Monitoring > Uptime checks**.

**Expected result:** The uptime check (configured when `uptime_check_config.enabled = true`) runs every 60 seconds against `${SERVICE_URL}/` and shows **Passing** from multiple global regions.

**gcloud equivalent:**
```bash
gcloud monitoring uptime list-configs \
  --project=${PROJECT}
```

### Step 8.3 — CDN Metrics (if Cloud CDN is enabled)

If `enable_cdn = true` and `enable_cloud_armor = true` were configured, navigate to **Network services > Cloud CDN** in the Cloud Console.

**gcloud — list CDN backend services:**
```bash
gcloud compute backend-services list \
  --project=${PROJECT} \
  --global
```

**Expected result:** CDN metrics show cache hit ratio, total requests, and cache bytes served. For Moodle, static assets (CSS, JavaScript, images) should achieve a high cache hit rate.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices"
```

### Step 8.4 — Cloud SQL Monitoring

Navigate to **SQL > Instances > [your-instance] > Monitoring**.

**Expected result:** PostgreSQL connection count shows active Moodle connections. Storage usage reflects Moodle course database size.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate destroy duration:** 15–25 minutes (Cloud SQL and Cloud Filestore deletion take the longest).

> **Warning:** This permanently deletes all resources including the PostgreSQL database, NFS moodledata, and Cloud Scheduler jobs. Export any course content before undeploying using **Site administration > Courses > Restore/Backup**.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Cloud Filestore NFS for moodledata | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Cloud Scheduler cron jobs | 1 | Yes |
| Get Cloud Run service URL | 2 | No |
| Confirm Moodle is reachable | 2 | No |
| Retrieve admin credentials from Secret Manager | 3 | No |
| Complete Moodle installation wizard | 3 | No |
| Access Site Administration | 3 | No |
| Create course and add activities | 4 | No |
| Create student user and enroll | 4 | No |
| Explore Gradebook, Quiz, Assignment, Forum | 5 | No |
| Review Cloud Scheduler cron setup | 6 | No |
| Verify cron.php endpoint | 6 | No |
| Review PHP/Apache logs in Cloud Logging | 7 | No |
| Review Cloud Run and Cloud SQL metrics | 8 | No |
| Review CDN metrics (if enabled) | 8 | No |
| Undeploy infrastructure | 9 | Yes |
