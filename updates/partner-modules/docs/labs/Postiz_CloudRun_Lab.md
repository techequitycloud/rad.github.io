# Postiz on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Postiz_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Postiz is an open-source social media scheduling platform supporting 20+ platforms including X/Twitter, LinkedIn, Instagram, TikTok, and Facebook. This lab deploys Postiz on Google Cloud Run with managed PostgreSQL 15 (Cloud SQL), Redis (Memorystore) for job queues and pub/sub, GCS for media uploads (mounted via GCS Fuse), and Serverless VPC Access for private network connectivity.

### What the Module Automates

- Cloud Run service with Gen2 execution environment
- Cloud SQL PostgreSQL 15 connection via Cloud SQL Auth Proxy sidecar
- JWT secret and database password generation in Secret Manager
- GCS bucket for media uploads
- Serverless VPC Access connector provisioning
- Artifact Registry repository and Cloud Build image pipeline
- Cloud Run Jobs for initialization and scheduled backups
- Cloud Logging and Cloud Monitoring uptime checks
- Redis (Memorystore) connection wiring via environment variables

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Register the admin account and explore the dashboard
- Connect social media accounts via OAuth
- Create, schedule, and manage posts
- Explore the Calendar and Analytics views
- Configure team collaboration settings
- Query Cloud Logging for application and worker logs
- Review Cloud Monitoring metrics and Redis queue depth

---

## CLI and REST API Overview

This lab uses the following CLIs:

| Tool | Purpose |
|---|---|
| `gcloud` | GCP resource management, log queries, secret access |

Configure gcloud:

```bash
# Authenticate gcloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

---

## Prerequisites

Before deploying this module:

1. **Services_GCP deployed** — this module depends on `Services_GCP` for the VPC, Cloud SQL instance, Memorystore Redis, and Serverless VPC Access connector.
2. **GCP project** with billing enabled.
3. **gcloud CLI** authenticated with Owner or Editor role on the project.
4. **Redis host** — obtain the Memorystore Redis host IP from the `Services_GCP` outputs and set `redis_host`.
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `postiz` | Internal identifier used for Cloud Run service and secrets |
| `application_version` | No | `latest` | Container image tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale-to-zero) |
| `max_instance_count` | No | not set | Maximum Cloud Run instances |
| `cpu_limit` | No | `2000m` | CPU limit per container instance |
| `memory_limit` | No | `2Gi` | Memory limit per container instance |
| `db_name` | No | `postiz` | PostgreSQL database name |
| `db_user` | No | `postiz` | PostgreSQL database username |
| `redis_host` | No | `""` | Memorystore Redis host IP or hostname |
| `redis_port` | No | `6379` | Redis port |
| `ingress_settings` | No | `all` | Traffic source control: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `storage_buckets` | No | `[{name_suffix="data"}]` | GCS bucket configuration for media uploads |
| `backup_schedule` | No | `0 2 * * *` | Cron expression for automated database backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Expected Deployment Duration

| Phase | Duration |
|---|---|
| Secret Manager secrets | ~1 min |
| GCS bucket provisioning | ~1 min |
| Cloud Build image pipeline | ~5–10 min |
| Cloud Run service deployment | ~2–3 min |
| Database initialization job | ~2–3 min |
| **Total** | **~12–19 min** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name |
| `service_url` | HTTPS URL for the Postiz application |
| `service_location` | Cloud Run region |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | PostgreSQL database name |
| `database_user` | PostgreSQL username |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `storage_buckets` | GCS bucket names |
| `container_image` | Container image URI deployed |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "postiz")
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
  --filter="name~postiz" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

### Steps

1. Note the service URL from the RAD UI deployment panel, or retrieve it directly:

```bash
echo "Postiz URL: ${SERVICE_URL}"
```

2. Alternatively, query the Cloud Run service directly:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.url)"
```

**Expected result:** A URL in the format `https://postiz-HASH-uc.a.run.app` (or your custom domain if configured).

3. Verify the service is healthy by sending a health check request:

```bash
curl -I ${SERVICE_URL}
```

**Expected result:** HTTP 200 or 301 response from the Postiz application.

4. View recent Cloud Run service logs to confirm startup completed:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Log lines indicating the server is listening on port 5000 and database migrations completed.

### gcloud equivalent

```bash
# List all Cloud Run services
gcloud run services list \
  --region=${REGION} \
  --project=${PROJECT}
```

### REST API equivalent

```bash
curl -X GET \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Phase 3 — Set Up Postiz [MANUAL]

### Steps

1. Open the Postiz URL in your browser:

```
${SERVICE_URL}
```

2. On first load, Postiz presents a registration screen. Register your admin account:
   - Enter your email address and a strong password.
   - Click **Register**.

3. If the registration screen is not shown (pre-seeded credentials), retrieve the admin password from Secret Manager:

```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

4. Log in with your admin credentials.

**Expected result:** The Postiz dashboard loads showing the main navigation: **Calendar**, **Posts**, **Analytics**, **Settings**.

5. Explore the dashboard sections to familiarise yourself with the layout.

### gcloud equivalent

```bash
# List secrets related to Postiz
gcloud secrets list \
  --filter="name:postiz" \
  --project=${PROJECT}
```

---

## Phase 4 — Connect Social Media Accounts [MANUAL]

### Steps

1. Navigate to **Settings** in the left sidebar.

2. Select **Social Media Integrations** (or **Channels** depending on Postiz version).

3. Click **Add Channel** and select a platform — for this lab, select **LinkedIn**.

4. Postiz initiates an OAuth flow:
   - A browser popup or redirect opens the LinkedIn OAuth consent screen.
   - Log in with your LinkedIn credentials and grant the requested permissions.
   - You are redirected back to Postiz upon successful authorization.

5. Verify the LinkedIn integration appears in the connected channels list with a green status indicator.

**Expected result:** At least one social media account is connected and listed under active integrations.

**Note:** Full OAuth flows require real social media credentials. The lab demonstrates the connection interface and workflow. You may use a personal or test account. Without real credentials, you can still explore the UI and scheduling features in draft mode.

6. Optionally add a second platform (e.g., X/Twitter or Facebook) following the same OAuth flow.

### gcloud equivalent

There is no direct gcloud equivalent for OAuth flows. Verify Secret Manager to check if any platform tokens were stored:

```bash
gcloud secrets list \
  --filter="name:postiz" \
  --project=${PROJECT}
```

---

## Phase 5 — Create and Schedule Posts [MANUAL]

### Steps

1. Click **Create Post** (or the **+** button) in the main navigation.

2. In the post editor:
   - Write a test post: `"Testing Postiz on Cloud Run — scheduled post #1 #cloudrun #gcp"`
   - Upload a test image by clicking the image icon and selecting a local file. Postiz stores uploads in the GCS bucket provisioned by this module, mounted via GCS Fuse.

3. In the platform selector, choose the social media account(s) connected in Phase 4.

4. Click the **Schedule** option (rather than Post Now):
   - Use the date/time picker to select a time 30 minutes in the future.
   - Click **Schedule**.

**Expected result:** A confirmation message appears and the post moves to the scheduled queue.

5. Navigate to the **Calendar** view in the left sidebar.

**Expected result:** The scheduled post appears on the calendar at the time you selected.

6. Click the post in the Calendar to view its details and confirm the platform assignment.

### gcloud equivalent (verify GCS upload)

```bash
gcloud storage ls gs://STORAGE_BUCKET_NAME/ \
  --project=${PROJECT}
```

---

## Phase 6 — Explore the Calendar and Analytics [MANUAL]

### Steps

1. Navigate to the **Calendar** view.

2. Use the view toggle to switch between **Day**, **Week**, and **Month** views.

**Expected result:** Scheduled posts appear as entries in the calendar at their scheduled time, color-coded by platform.

3. Click a scheduled post to edit or reschedule it — drag it to a new time slot if your version supports drag-and-drop.

4. Navigate to **Analytics** in the left sidebar.

**Expected result:** The Analytics dashboard loads. If posts have been published, engagement metrics (impressions, clicks, shares) appear. For a fresh deployment, the dashboard shows empty state or zero metrics.

5. Explore the **reporting** section to see the metric breakdown by platform and time range.

**Expected result:** Charts and tables are displayed, even if empty, confirming the analytics pipeline is functioning.

---

## Phase 7 — Team Collaboration [MANUAL]

### Steps

1. Navigate to **Settings** > **Team** (or **Workspace** depending on the Postiz version).

2. Click **Invite Team Member**:
   - Enter an email address for the team member.
   - Select a role: **Admin**, **Manager**, or **User**.
   - Click **Send Invite**.

**Expected result:** An invitation is queued (email delivery requires SMTP configuration; the UI confirms the invite was recorded).

3. Review the **Team Members** list to see current members and their role assignments.

4. Explore **Workspace Settings**:
   - Review the workspace name and timezone settings.
   - Note the API key section if present — Postiz exposes an API for programmatic access.

**Expected result:** The team management interface loads and the invited member appears as pending.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### Steps

1. Open the [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs).

2. Select your project.

3. Query Postiz Cloud Run logs:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

**Expected result:** Log entries from Postiz include HTTP request logs, queue job processing events, database query logs, and social media API calls.

4. Filter for worker process logs:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload:"worker"
```

5. Use the gcloud CLI to query logs from the terminal:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, severity, textPayload)"
```

6. Filter for error-level logs:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=ERROR' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Any errors during scheduling or social media API calls appear here.

### REST API equivalent

```bash
curl -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

### Steps

1. Open [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Metrics Explorer**.

3. Query Cloud Run request metrics:
   - **Metric:** `run.googleapis.com/request_count`
   - **Filter:** `service_name = ${SERVICE}`

**Expected result:** A time-series graph showing incoming request counts to the Postiz service.

4. Query request latency:
   - **Metric:** `run.googleapis.com/request_latencies`
   - **Filter:** `service_name = ${SERVICE}`

**Expected result:** Latency percentiles (p50, p95, p99) for the Postiz application.

5. Query Redis (Memorystore) queue depth metrics:
   - **Metric:** `redis.googleapis.com/stats/memory/usage_ratio`
   - **Filter:** Select your Memorystore instance.

**Expected result:** Redis memory usage metrics appear, indicating the queue is active.

6. Navigate to **Uptime Checks** to review the uptime check configured by the module.

**Expected result:** The uptime check shows a green (passing) status from multiple global probe locations.

7. Check the **Alerting** section to review any alert policies configured by the module.

### gcloud equivalent

```bash
# Describe the Cloud Run service and view traffic metrics
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

---

## Phase 10 — Undeploy [AUTOMATED]

When the lab is complete, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** The Cloud Run service, Cloud SQL database, GCS buckets, Secret Manager secrets, and IAM bindings created by this module are deleted.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Description |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisions Cloud Run service, Cloud SQL, GCS, secrets, Cloud Build |
| Phase 2 — Get Service URL | Manual | Retrieves and verifies the Cloud Run HTTPS endpoint |
| Phase 3 — Set Up Postiz | Manual | Admin registration and dashboard orientation |
| Phase 4 — Connect Social Media | Manual | OAuth integration with LinkedIn and other platforms |
| Phase 5 — Create and Schedule Posts | Manual | Post creation, image upload, and scheduling |
| Phase 6 — Calendar and Analytics | Manual | Calendar views and engagement metrics |
| Phase 7 — Team Collaboration | Manual | Invite team members and manage roles |
| Phase 8 — Cloud Logging | Manual | Application and worker log exploration |
| Phase 9 — Cloud Monitoring | Manual | Cloud Run metrics, uptime checks, and Redis queue depth |
| Phase 10 — Undeploy | Automated | Tears down all module-managed resources |
