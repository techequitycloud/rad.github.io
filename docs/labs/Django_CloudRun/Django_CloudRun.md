---
title: "Django on Cloud Run — Lab Guide"
sidebar_label: "Django CloudRun"
---

# Django on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Django_CloudRun)**

## Overview

This module deploys a production-ready Django application on Google Cloud Run (v2). It provisions a Cloud Run service with Cloud SQL (PostgreSQL) for the database, Cloud Filestore (NFS) for shared persistent storage, GCS for media storage, and Secret Manager for credential management. Cloud SQL Auth Proxy runs as a sidecar for secure socket-based database connections. Direct VPC Egress connects the service to private resources in the shared VPC.

**Estimated time:** 1.5–2.5 hours

### What the Module Automates

- Cloud Run service and revision creation with Direct VPC Egress
- Cloud Build image build and push to Artifact Registry
- Cloud SQL database and user provisioning, with Cloud SQL Auth Proxy sidecar configuration
- Secret Manager secrets for database credentials and Django settings
- Cloud Filestore NFS instance provisioning and GCS Fuse volume mount configuration
- Cloud IAM bindings for the Cloud Run service account
- Cloud Run Jobs for database initialisation (`db-init`)
- Cloud Monitoring uptime checks and alert policies

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Retrieve admin credentials from Secret Manager and log in to Django Admin
- Explore the admin panel features and create users
- Inspect GCS bucket for media files and test file uploads
- Explore Cloud Run revisions, traffic splitting, and concurrency settings in the Cloud Console
- Query structured application logs in Cloud Logging
- View request latency, instance count metrics, and uptime checks in Cloud Monitoring

---

## CLI and REST API Overview

Set these shell variables at the start of each session — all gcloud and REST examples below reference them.

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~django" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="value(name)" \
  --limit=1)
```

---

## Prerequisites

| Requirement | Detail |
|---|---|
| gcloud CLI | Authenticated (`gcloud auth login`) |
| GCP project with billing | Active billing account linked |
| Services_GCP module deployed | Provides VPC, Cloud SQL, Artifact Registry, and Filestore |
| Service account | `roles/owner` granted in the target project |
| RAD UI access | Permission to deploy modules in the target GCP project |

The `Services_GCP` module **must** be deployed and healthy before running this module. It supplies the shared VPC, Cloud SQL instance, Artifact Registry repository, and Filestore NFS server that Django_CloudRun discovers automatically at deploy time.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | GCP project ID to deploy into |
| `deployment_id` | _(auto-generated)_ | Short alphanumeric suffix appended to all resource names |
| `region` | `us-central1` | GCP region for resource deployment |
| `tenant_deployment_id` | `demo` | Unique tenant/environment identifier used in resource naming |
| `application_name` | `django` | Base name for the Cloud Run service and associated resources |
| `application_version` | `latest` | Container image version tag |
| `deploy_application` | `true` | Set to `false` to provision supporting infrastructure only |
| `min_instance_count` | `0` | Minimum Cloud Run instances (0 = scale to zero when idle) |
| `max_instance_count` | `1` | Maximum Cloud Run instances; acts as a cost ceiling |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits for each container instance |
| `application_database_name` | `django_db` | PostgreSQL database name created in Cloud SQL |
| `application_database_user` | `django_user` | PostgreSQL user created for the application |
| `enable_redis` | `false` | Enable Redis for Django session storage and caching |
| `redis_host` | `""` | Redis hostname/IP (required when `enable_redis = true`) |
| `redis_port` | `6379` | Redis TCP port |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Expected resource provisioning times:**

| Resource | Typical duration |
|---|---|
| Cloud Build image build | 5–10 minutes |
| Secret Manager secrets | < 1 minute |
| Cloud SQL database and user | 2–5 minutes |
| NFS setup Cloud Run Job | 2–4 minutes |
| Database init Cloud Run Job | 1–3 minutes |
| Cloud Run service deployment | 2–5 minutes |
| Uptime check and alert policies | 1–2 minutes |
| **Total** | **15–30 minutes** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_name` | Name of the deployed Cloud Run service |
| `service_url` | Public HTTPS URL of the Cloud Run service |
| `service_location` | GCP region where the service is running |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | Application database name |
| `database_user` | Application database username |
| `database_password_secret` | Secret Manager secret name for the database password |
| `storage_buckets` | GCS bucket names created for the application |
| `container_registry` | Artifact Registry repository name |
| `deployment_id` | Unique deployment identifier (used in resource naming) |
| `resource_prefix` | Resource naming prefix applied to all resources |
| `initialization_jobs` | Names of Cloud Run initialisation jobs that were created |
| `nfs_setup_job` | Name of the NFS setup Cloud Run Job |
| `uptime_check_names` | Names of the configured uptime checks |
| `deployment_summary` | Human-readable summary of the full deployment |

Set shell variables for use in later steps using gcloud discovery:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~django" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="value(name)" \
  --limit=1)

echo "Application URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Open the Application URL

```bash
echo "Navigate to: ${SERVICE_URL}"
```

Open the URL in your browser.

**Expected result:** The Django application home page loads over HTTPS.

> **gcloud equivalent:**
> ```bash
> gcloud run services describe ${SERVICE} \
>   --region=${REGION} \
>   --project=${PROJECT} \
>   --format="value(status.url)"
> ```
>
> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
>   | jq '{name, uri: .urls[0], latestReadyRevision}'
> ```

### Step 2.2 — Retrieve the Admin Password from Secret Manager

1. Identify the secrets created for your deployment:

```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="table(name)"
```

2. Access the Django admin password secret:

```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

Alternatively, look for a secret named `<resource_prefix>-django-admin-password`:

```bash
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project=${PROJECT} --filter='name~admin-password' --format='value(name)' --limit=1)" \
  --project=${PROJECT}
```

**Expected result:** The admin password is printed to stdout.

> **REST API equivalent:**
> ```bash
> SECRET_NAME="<admin-password-secret-name>"
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRET_NAME}/versions/latest:access" \
>   | jq -r '.payload.data' | base64 --decode
> ```

### Step 2.3 — Log In to Django Admin

1. Navigate to `${SERVICE_URL}/admin` in your browser.
2. Log in with username `admin` and the password retrieved above.

**Expected result:** The Django administration dashboard appears.

---

## Phase 3 — Explore Django Admin [MANUAL]

### Step 3.1 — Navigate the Admin Interface

After logging in to `${SERVICE_URL}/admin`:

1. Click **Users** under **Authentication and Authorisation** to view existing users.
2. Click **Add User** to create a new user, fill in the username and password, and save.
3. Click **Groups** to view or create permission groups.

**Expected result:** New user is created and listed in the Users table.

### Step 3.2 — Manage Application Content

Navigate through the registered Django app models shown in the admin dashboard. Depending on the application configuration:

- Create, edit, and delete model instances.
- Use the built-in filtering and search to find records.
- Use the **History** button on any object to see its audit trail.

### Step 3.3 — Explore the REST API (if configured)

If Django REST Framework is configured, access the browsable API:

```bash
curl -s -H "Accept: application/json" "${SERVICE_URL}/api/" | jq .
```

**Expected result:** JSON list of available API endpoints (if DRF is installed and configured).

---

## Phase 4 — Static Files and Storage [MANUAL]

### Step 4.1 — Explore the GCS Bucket

1. List the GCS buckets created by this module:

```bash
gsutil ls -p ${PROJECT} | grep django
```

2. List the contents of the data bucket:

```bash
BUCKET=$(gcloud storage buckets list --project=${PROJECT} --format="value(name)" --filter="name~django" --limit=1)
gsutil ls gs://${BUCKET}/
```

**Expected result:** Bucket exists. It may contain subdirectories for media files or static assets.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}" \
>   | jq '.items[] | select(.name | contains("django")) | {name, location, storageClass}'
> ```

### Step 4.2 — Test File Upload Through Django Admin

1. In the Django Admin, navigate to a model that has a file or image field.
2. Upload a test file using the admin form.

**Expected result:** The file is saved to the NFS mount or GCS bucket and can be retrieved via the application URL.

### Step 4.3 — Verify GCS Fuse Mount

Cloud Run (gen2) uses GCS Fuse to mount buckets directly as container filesystems. Verify the mount path is configured correctly:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.template.spec.volumes)"
```

**Expected result:** Volume entries appear for the NFS mount and any GCS Fuse volumes.

---

## Phase 5 — Explore Cloud Run Features [MANUAL]

### Step 5.1 — View the Service in the Cloud Console

Navigate to **Cloud Run** in the Google Cloud Console and click on your service (`${SERVICE}`). Review:

- **Overview** tab: service URL, region, last deployed revision
- **Revisions** tab: list of all revisions with traffic split percentages
- **Metrics** tab: request count, latency, and instance count graphs
- **Logs** tab: streaming log view

### Step 5.2 — Examine Revisions

List all revisions of the service:

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="table(metadata.name,status.conditions[0].status,spec.containerConcurrency,metadata.creationTimestamp)"
```

**Expected result:** A table showing revision names, ready status, and creation timestamps.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}/revisions" \
>   | jq '.revisions[] | {name, createTime, serviceAccount}'
> ```

### Step 5.3 — Test Traffic Splitting (Canary Deployment Pattern)

Traffic splitting allows you to send a percentage of traffic to a specific revision. In the Cloud Console:

1. Go to **Cloud Run > your service > Edit & Deploy New Revision**.
2. After deploying, go to the **Revisions** tab.
3. Click **Manage Traffic** and split traffic between two revisions (e.g., 90% latest, 10% previous).
4. Save and use `curl` to send requests and observe which revision responds.

```bash
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" "${SERVICE_URL}"
done
```

To review current traffic split via gcloud:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.traffic)"
```

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
>   | jq '.traffic'
> ```

### Step 5.4 — Inspect Concurrency and Scaling Settings

Review how the service is configured to handle concurrent requests and scale instances:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.template.spec.containerConcurrency,spec.template.spec.containers[0].resources,spec.template.metadata.annotations)"
```

Key annotations to observe:
- `autoscaling.knative.dev/minScale` — minimum instance count
- `autoscaling.knative.dev/maxScale` — maximum instance count
- `run.googleapis.com/vpc-access-egress` — egress routing mode

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Logs in the Console

Navigate to **Logging > Logs Explorer** in the Cloud Console.

### Step 6.2 — Query Cloud Run Application Logs

**All Cloud Run service logs:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

**Django error logs:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
severity>=ERROR
```

**HTTP request logs (structured):**
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
httpRequest.status>=400
```

**Cloud SQL Auth Proxy connection logs:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"cloud-sql-proxy|pq:"
```

> **gcloud equivalent:**
> ```bash
> gcloud logging read \
>   'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
>   --project=${PROJECT} \
>   --limit=50 \
>   --format="table(timestamp,severity,textPayload,httpRequest.status)"
> ```
>
> **REST API equivalent:**
> ```bash
> curl -s -X POST -H "Authorization: Bearer ${TOKEN}" \
>   -H "Content-Type: application/json" \
>   "https://logging.googleapis.com/v2/entries:list" \
>   -d '{
>     "resourceNames": ["projects/'${PROJECT}'"],
>     "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'${SERVICE}'\"",
>     "orderBy": "timestamp desc",
>     "pageSize": 20
>   }' | jq '.entries[] | {timestamp, severity, textPayload}'
> ```

---

## Phase 7 — Explore Cloud Monitoring [MANUAL]

### Step 7.1 — View Request Metrics in the Metrics Explorer

Navigate to **Monitoring > Metrics Explorer** and query:

**Request count by response code:**
```
fetch cloud_run_revision
| metric 'run.googleapis.com/request_count'
| filter resource.service_name == '${SERVICE}'
| group_by [metric.response_code_class], [value_request_count_aggregate: aggregate(value.request_count)]
| every 1m
```

**Request latencies (p50/p99):**
```
fetch cloud_run_revision
| metric 'run.googleapis.com/request_latencies'
| filter resource.service_name == '${SERVICE}'
| align delta(1m)
| every 1m
| percentile(99)
```

### Step 7.2 — Monitor Instance Count

**Active container instance count:**
```
fetch cloud_run_revision
| metric 'run.googleapis.com/container/instance_count'
| filter resource.service_name == '${SERVICE}'
| group_by [metric.state], [value: mean(value.instance_count)]
| every 1m
```

Generate load to observe scale-up behaviour:

```bash
for i in {1..50}; do
  curl -s -o /dev/null "${SERVICE_URL}" &
done
wait
```

Then watch instance count in the Metrics Explorer or in the Cloud Run console **Metrics** tab.

### Step 7.3 — Check Uptime Checks

Navigate to **Monitoring > Uptime checks** to view the uptime check configured by the module.

**Expected result:** The check shows passing status, probing your service URL from multiple global locations.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
>   | jq '.uptimeCheckConfigs[] | {displayName, httpCheck, period, selectedRegions}'
> ```

> **gcloud equivalent:**
> ```bash
> gcloud monitoring uptime list-configs --project=${PROJECT}
> ```

---

## Phase 8 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected undeploy times:**

| Resource | Typical duration |
|---|---|
| Cloud Run service and revisions | 1–2 minutes |
| Cloud Run Jobs | < 1 minute |
| Secret Manager secrets | < 1 minute |
| GCS buckets | 1–2 minutes |
| Cloud SQL database and user | 1–2 minutes |
| Artifact Registry images | 1–2 minutes |
| Uptime checks and alert policies | < 1 minute |
| **Total** | **6–12 minutes** |

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Configure variables in RAD UI | 1.1 | Manual |
| Build image and deploy Django to Cloud Run | 1.2 | Automated |
| Note outputs from RAD UI deployment panel | 1.3 | Manual |
| Access application URL | 2 | Manual |
| Retrieve admin password from Secret Manager | 2 | Manual |
| Log in to Django Admin | 2–3 | Manual |
| Explore admin panel and create users | 3 | Manual |
| Inspect GCS media bucket and test file upload | 4 | Manual |
| Explore revisions, traffic splitting, concurrency | 5 | Manual |
| Query structured logs in Cloud Logging | 6 | Manual |
| View request latency, instance count, uptime checks | 7 | Manual |
| Undeploy all module resources | 8 | Automated |
