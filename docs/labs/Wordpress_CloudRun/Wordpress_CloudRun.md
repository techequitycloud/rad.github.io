---
title: "WordPress on Cloud Run — Lab Guide"
sidebar_label: "Wordpress CloudRun"
---

# WordPress on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wordpress_CloudRun)**

## Overview

Deploy WordPress, the world's most popular CMS, to Google Cloud Run with managed Cloud SQL (MySQL 8.0), optional Filestore NFS persistence, Redis object caching, Serverless VPC Access, and full observability via Cloud Logging and Cloud Monitoring.

**Estimated time:** 1–2 hours

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL MySQL 8.0 instance, database, and application user
- Serverless VPC Access connector for private Cloud SQL connectivity
- Optional Cloud Filestore (NFS) volume mounted into the service (gen2 execution environment)
- GCS bucket for data storage with optional GCS Fuse mounts
- Artifact Registry repository and Cloud Build image build
- Secret Manager secrets for database password and WordPress auth keys
- IAM bindings for the Cloud Run service account
- Cloud Monitoring uptime checks and notification channels
- Automated database backup Cloud Run Job (daily at 02:00 UTC by default)

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Open WordPress in a browser and complete the install wizard (if required) or log in to wp-admin
- Retrieve admin credentials from Secret Manager
- Create content, upload media, and install plugins
- Explore Cloud SQL database integration via Cloud SQL Auth Proxy
- Explore Cloud Run revision management and traffic splitting
- Review application logs in Cloud Logging
- Explore request and scaling metrics in Cloud Monitoring

---

## CLI and REST API Overview

Set these shell variables before running any `gcloud` or `curl` commands in this guide:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "wordpress")
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
  --filter="name~wordpress" \
  --format="value(name)" \
  --limit=1)
```

---

## Prerequisites

| Requirement | Details |
|---|---|
| gcloud CLI | Authenticated (`gcloud auth application-default login`) |
| GCP project | Billing enabled |
| Services_GCP | Must be deployed first — provides VPC, Serverless VPC Access connector, Cloud SQL instance, and optional Filestore |
| Service account | `roles/owner` on the target project (or a tightly scoped equivalent) |
| RAD UI access | Permission to deploy modules in the target GCP project |

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | GCP project ID. Must match the project where Services_GCP is deployed. |
| `deployment_id` | _(auto-generated)_ | Short suffix appended to all resource names. Leave empty to auto-generate. |
| `region` | `"us-central1"` | GCP region for all resources. |
| `tenant_deployment_id` | `"demo"` | Short environment label (e.g. `"prod"`, `"dev"`). |
| `application_name` | `"wordpress"` | Base name for the Cloud Run service, secrets, and registry. |
| `application_version` | `"latest"` | Container image version tag. |
| `deploy_application` | `true` | Set to `false` to provision infrastructure only without deploying the service. |
| `min_instance_count` | `0` | Minimum instances (0 = scale-to-zero). Set to `1` to avoid cold starts. |
| `max_instance_count` | `1` | Maximum concurrent instances. |
| `cpu_limit` | `"1000m"` | CPU limit per container instance (millicores). |
| `memory_limit` | `"2Gi"` | Memory limit per container instance. |
| `php_memory_limit` | `"512M"` | PHP memory limit inside the container. |
| `upload_max_filesize` | `"64M"` | Maximum single file upload size. |
| `post_max_size` | `"64M"` | Maximum HTTP POST body size (must be >= `upload_max_filesize`). |
| `db_name` | `"wp"` | MySQL database name. |
| `db_user` | `"wp"` | MySQL database user. |
| `enable_nfs` | `true` | Mount a Cloud Filestore NFS share for wp-content persistence. Requires gen2 execution environment. |
| `nfs_mount_path` | `"/mnt/nfs"` | Container path where the NFS share is mounted. |
| `enable_redis` | `true` | Enable Redis object caching for WordPress. |
| `redis_host` | `""` | Redis hostname (leave empty to use auto-discovered Memorystore). |
| `ingress_settings` | `"all"` | Traffic ingress: `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"`. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | VPC egress routing: `"PRIVATE_RANGES_ONLY"` or `"ALL_TRAFFIC"`. |
| `execution_environment` | `"gen2"` | Cloud Run execution environment. Use `"gen2"` for NFS support. |
| `timeout_seconds` | `300` | Request timeout in seconds (max 3600). |
| `backup_schedule` | `"0 2 * * *"` | Cron schedule for automated database backups (UTC). |
| `backup_retention_days` | `7` | Number of days to retain backup files in GCS. |
| `support_users` | `[]` | Email addresses for monitoring alert notifications. |
| `container_resources` | `null` | Structured CPU/memory override (takes precedence over `cpu_limit`/`memory_limit`). |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Deployment Duration

| Operation | Typical duration |
|---|---|
| Cloud SQL provisioning | 8–12 minutes |
| Cloud Build image build | 3–5 minutes |
| Cloud Run service deployment | 1–2 minutes |
| **Total (first deploy)** | **10–20 minutes** |
| Subsequent deploys | 2–5 minutes |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | Cloud Run service URL (HTTPS) |
| `service_name` | Name of the Cloud Run service |
| `service_location` | Cloud Run region |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Generated deployment suffix |
| `resource_prefix` | Prefix used for all GCP resource names |
| `nfs_mount_path` | NFS mount path inside the container |
| `storage_buckets` | GCS bucket names |
| `container_registry` | Artifact Registry repository |

Set shell variables for use in later steps (see the CLI and REST API Overview section at the top of this guide).

---

## Phase 2 — Access WordPress [MANUAL]

### Step 2.1 — Open WordPress in a Browser

```bash
echo "WordPress URL: ${SERVICE_URL}"
```

Open the URL in your browser.

**Expected result:** You see the WordPress 5-minute install page, or the WordPress homepage if the install was completed automatically during the Cloud Build/initialization job.

### Step 2.2 — Retrieve Admin Credentials from Secret Manager

The WordPress admin password is stored in Secret Manager. Retrieve it:

```bash
# Retrieve the admin password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

If you do not know the exact secret name, list all secrets with the WordPress prefix:

```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~wordpress" \
  --format='value(name)'
```

**REST API equivalent:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  | jq -r '.payload.data' | base64 -d
```

### Step 2.3 — Complete the Install Wizard (If Required)

If the install wizard appears, fill in:

| Field | Value |
|---|---|
| Site Title | Any title (e.g. `My WordPress Site`) |
| Username | Choose an admin username |
| Password | Use a strong password or note the generated one |
| Your Email | Your email address |
| Search Engine Visibility | Leave unchecked for a lab |

Click **Install WordPress**.

### Step 2.4 — Log in to wp-admin

Navigate to:

```
${SERVICE_URL}/wp-admin
```

Log in with the admin username and the password retrieved in Step 2.2.

**Expected result:** The WordPress administration dashboard appears.

---

## Phase 3 — Explore WordPress Admin [MANUAL]

### Step 3.1 — Create a Test Post

1. Navigate to **Posts > Add New**.
2. Enter a title and some body text in the block editor.
3. Click **Publish**, then **View Post** to confirm the post is live.

### Step 3.2 — Upload a Media File

1. Navigate to **Media > Add New**.
2. Upload an image file (PNG or JPEG, under 64 MB by default).
3. Click the uploaded file to view its URL and metadata.

Media files are written to the NFS-backed `wp-content/uploads` directory (or an alternative GCS Fuse mount if configured), ensuring they persist across container restarts and scaling events.

### Step 3.3 — Install a Plugin

1. Navigate to **Plugins > Add New**.
2. Search for a lightweight plugin such as `Hello Dolly`.
3. Click **Install Now**, then **Activate**.
4. Confirm the plugin appears under **Plugins > Installed Plugins**.

> Plugins are installed into the `wp-content/plugins` directory which is backed by NFS when `enable_nfs = true`, ensuring plugins persist across container revisions.

### Step 3.4 — Explore Theme Management

1. Navigate to **Appearance > Themes**.
2. Click **Add New Theme** to browse the WordPress theme directory.
3. Preview a theme and optionally activate it.

---

## Phase 4 — Explore Database Integration [MANUAL]

### Step 4.1 — Verify Cloud SQL Instance

```bash
# Discover the Cloud SQL instance name
export DB_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="name~wordpress" \
  --format="value(name)" \
  --limit=1)

# Describe the Cloud SQL instance
gcloud sql instances describe ${DB_INSTANCE} \
  --project=${PROJECT} \
  --format='table(name,databaseVersion,settings.tier,ipAddresses[0].ipAddress,state)'
```

**Expected result:** A MySQL 8.0 instance in `RUNNABLE` state.

**REST API equivalent:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://sqladmin.googleapis.com/sql/v1beta4/projects/${PROJECT}/instances/${DB_INSTANCE}" \
  | jq '{name: .name, version: .databaseVersion, state: .state}'
```

### Step 4.2 — Verify Database and User

```bash
# List databases in the Cloud SQL instance
gcloud sql databases list \
  --instance=${DB_INSTANCE} \
  --project=${PROJECT}

# List database users
gcloud sql users list \
  --instance=${DB_INSTANCE} \
  --project=${PROJECT}
```

**Expected result:** A database named `wp` and a user named `wp` are present.

### Step 4.3 — Verify Cloud SQL Auth Proxy Sidecar

The Cloud Run service uses the Cloud SQL Auth Proxy as a sidecar container to provide secure Unix socket connections to Cloud SQL. This avoids exposing the database over a public IP.

```bash
# Inspect the Cloud Run service configuration
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format='json' | jq '.spec.template.spec.containers[].name'
```

**Expected result:** Two containers — `wordpress` and `cloud-sql-proxy`.

### Step 4.4 — Retrieve Database Password from Secret Manager

```bash
# Retrieve the database password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

The database password is injected into the WordPress container as an environment variable sourced from Secret Manager — the plaintext value is never stored in deployment state.

---

## Phase 5 — Explore Cloud Run Features [MANUAL]

### Step 5.1 — View Service Revisions

Each deployment that changes the container configuration creates a new Cloud Run revision.

```bash
# List revisions
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format='table(name,status.conditions[0].status,spec.containerConcurrency,metadata.annotations."autoscaling.knative.dev/minScale",metadata.annotations."autoscaling.knative.dev/maxScale")'
```

**REST API equivalent:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}/revisions" \
  | jq '.revisions[] | {name: .name, state: .conditions[0].state}'
```

### Step 5.2 — Inspect Traffic Allocation

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format='json' | jq '.status.traffic'
```

**Expected result:** 100% of traffic is routed to the latest revision.

### Step 5.3 — Traffic Splitting (Canary Deployment)

You can split traffic between revisions using the `traffic_split` variable in the RAD UI. This is useful for canary or blue-green deployments.

Example configuration (set via the RAD UI `traffic_split` variable):

- Latest revision: 90%
- Previous revision (e.g. `wordpress-00001-abc`): 10%

To update traffic splits, modify the `traffic_split` variable in the RAD UI and redeploy.

To verify the current traffic allocation:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format='json' | jq '.status.traffic'
```

### Step 5.4 — Concurrency and Scaling

Cloud Run scales horizontally by launching additional container instances when concurrent requests exceed the configured concurrency limit.

```bash
# View current instance count (requires a few seconds of traffic)
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format='value(status.observedGeneration,status.conditions[0].status)'
```

WordPress is not naturally concurrency-safe when sharing the same `wp-content` directory from multiple instances. The default `max_instance_count = 1` prevents split-brain issues. Increase this only when NFS or GCS Fuse shared storage is confirmed.

### Step 5.5 — Scale to Zero

With `min_instance_count = 0`, the Cloud Run service scales to zero after a period of inactivity. The next request triggers a cold start.

To demonstrate scale-to-zero:

```bash
# Wait a few minutes without sending requests, then:
curl -w "\nTotal time: %{time_total}s\n" -s -o /dev/null ${SERVICE_URL}/
```

A cold start typically adds 5–15 seconds on first request. Set `min_instance_count = 1` in the RAD UI to eliminate cold starts in production.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View WordPress Application Logs

```bash
# View WordPress logs (Apache/PHP output) — last 50 entries
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND resource.labels.location=${REGION}" \
  --project=${PROJECT} \
  --limit=50 \
  --format='value(timestamp, textPayload)'
```

### Step 6.2 — Filter for HTTP Requests

```bash
# View HTTP access log entries
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND httpRequest.status:*" \
  --project=${PROJECT} \
  --limit=30 \
  --format='value(timestamp, httpRequest.status, httpRequest.requestUrl)'
```

### Step 6.3 — Filter for PHP Errors

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND (textPayload:\"PHP\" OR textPayload:\"Fatal\" OR textPayload:\"Warning\")" \
  --project=${PROJECT} \
  --limit=20
```

### Step 6.4 — View Logs in Cloud Console

Navigate to **Cloud Console > Logging > Logs Explorer**. Use the pre-built query:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

**REST API equivalent:**
```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[].textPayload'
```

---

## Phase 7 — Explore Cloud Monitoring [MANUAL]

### Step 7.1 — Request Metrics

In the Google Cloud Console, navigate to **Cloud Run > Services > ${SERVICE} > Metrics**. Explore:

- **Request count** — total requests per minute
- **Request latencies** — p50, p95, p99 percentiles
- **Container instance count** — number of running instances

```bash
# Fetch request count via Monitoring API (last 10 minutes)
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=metric.type%3D%22run.googleapis.com%2Frequest_count%22%20AND%20resource.labels.service_name%3D%22${SERVICE}%22&interval.endTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)&interval.startTime=$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
  | jq '[.timeSeries[].points[0].value.int64Value | tonumber] | add'
```

### Step 7.2 — Uptime Checks

```bash
# List uptime checks
gcloud monitoring uptime list-configs \
  --project=${PROJECT} \
  --format='table(displayName, httpCheck.path, period, selectedRegions)'
```

The WordPress service URL is monitored every 60 seconds from multiple global locations. An alert fires if the endpoint becomes unreachable or returns a non-2xx status.

### Step 7.3 — Error Rate Monitoring

```bash
# Check for 5xx errors in the last hour
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND httpRequest.status>=500" \
  --project=${PROJECT} \
  --freshness=1h \
  --limit=10 \
  --format='value(timestamp, httpRequest.status, textPayload)'
```

### Step 7.4 — Instance Scaling Events

```bash
# View instance count over time
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND logName:\"requests\"" \
  --project=${PROJECT} \
  --limit=20 \
  --format='table(timestamp, resource.labels.revision_name)'
```

Each unique revision name in the log output corresponds to a running container instance.

---

## Phase 8 — Undeploy [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Typical duration:** 8–15 minutes

> **Warning:** This permanently deletes the Cloud Run service, Cloud SQL database, GCS buckets, NFS Filestore instance, Artifact Registry images, and all associated secrets. Ensure any data you want to keep has been exported or backed up before undeploying.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Action | Mode |
|---|---|---|
| Phase 1 | Deploy infrastructure via RAD UI | Automated |
| Phase 2 | Access WordPress and retrieve admin credentials from Secret Manager | Manual |
| Phase 3 | Explore WordPress admin: posts, media, plugins, themes | Manual |
| Phase 4 | Explore Cloud SQL MySQL 8.0 integration and Auth Proxy sidecar | Manual |
| Phase 5 | Explore Cloud Run revisions, traffic splitting, concurrency, scale-to-zero | Manual |
| Phase 6 | Explore Cloud Logging: WordPress logs, HTTP access, PHP errors | Manual |
| Phase 7 | Explore Cloud Monitoring: request metrics, error rates, uptime checks | Manual |
| Phase 8 | Undeploy all infrastructure via RAD UI | Automated |

| Resource | Notes |
|---|---|
| Cloud Run | Serverless — billed per request and CPU/memory during active execution |
| Cloud SQL MySQL 8.0 | Managed — patching and backups handled by GCP |
| Cloud SQL Auth Proxy | Sidecar provides secure Unix socket connections; no public DB IP required |
| Serverless VPC Access | Routes Cloud Run egress through the private VPC |
| Cloud Filestore NFS | Optional shared persistent storage for wp-content (gen2 required) |
| Cloud Storage | GCS bucket for data and backups |
| Secret Manager | Database password and WordPress auth keys |
| Cloud Build | Builds the custom WordPress Docker image |
| Artifact Registry | Stores the built container image |
| Cloud Monitoring | Uptime checks, request metrics, alerting |
