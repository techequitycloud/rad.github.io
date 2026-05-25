---
title: "Django on Cloud Run — Lab Guide"
sidebar_label: "Django CloudRun"
---

# Django on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Django_CloudRun)**

This lab guide walks you through deploying, exploring, and operating a production-ready **Django** application on Google Cloud Run using the **Django_CloudRun** module. You will explore a Cloud Run service backed by Cloud SQL PostgreSQL, Secret Manager, GCS media storage, and NFS shared storage — including live traffic management, observability, and security practices.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access the Application](#exercise-1--access-the-application)
6. [Exercise 2 — Explore Django Admin](#exercise-2--explore-django-admin)
7. [Exercise 3 — Static Files and Media Storage](#exercise-3--static-files-and-media-storage)
8. [Exercise 4 — Cloud Run Revisions and Traffic Management](#exercise-4--cloud-run-revisions-and-traffic-management)
9. [Exercise 5 — Security and Secret Management](#exercise-5--security-and-secret-management)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring](#exercise-7--cloud-monitoring)
12. [Cleanup](#12-cleanup)
13. [Reference](#13-reference)

---

## 1. Overview

### What Is Django on Cloud Run?

Django is the most mature Python web framework, used by 35,570+ companies including Instagram, Spotify, Dropbox, and NASA. The `Django_CloudRun` module deploys a production-ready Django application on Google Cloud Run v2 (Gen2 execution environment), backed by a managed Cloud SQL PostgreSQL 15 instance, Secret Manager for all credentials, Cloud Filestore NFS for shared media storage, and GCS for object storage.

The module builds a custom container image via Cloud Build using a multi-stage Dockerfile (Python 3.11-slim), runs database initialisation and migration jobs (`db-init` and `db-migrate`) before the service starts, and configures Cloud Monitoring uptime checks and alert policies automatically.

Unlike traditional server deployments, Cloud Run scales the Django service to zero instances when idle and back up when requests arrive. Direct VPC Egress connects Cloud Run to the private VPC where Cloud SQL and Filestore reside.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Cloud Run Gen2** | Serverless Django with Direct VPC Egress, NFS mounts, and GCS Fuse |
| **Cloud SQL Auth Proxy** | Secure Unix socket database connections without public IP |
| **Secret Manager** | Django `SECRET_KEY`, `DB_PASSWORD` stored and injected at runtime |
| **Traffic Splitting** | Canary deployments between Cloud Run revisions |
| **Scale-to-Zero** | Cost-efficient operation with configurable `min_instance_count` |
| **Initialization Jobs** | `db-init` and `db-migrate` Cloud Run Jobs run automatically at deploy time |
| **Cloud Monitoring** | Request latency, instance count, uptime checks, and alert policies |

---

## 2. Architecture

```
Internet
   │
   ▼ HTTPS
Cloud Run Service (Gen2)
   ├── Django container (Gunicorn, port 8080, UID 2000)
   │     ├── Static files: WhiteNoise or GCS backend
   │     ├── Media files: /mnt/nfs (Filestore NFS) or GCS Fuse
   │     └── Settings: django-environ, DATABASE_URL from env
   └── Cloud SQL Auth Proxy sidecar
         └── Unix socket → /cloudsql/PROJECT:REGION:INSTANCE
               │
               ▼
         Cloud SQL (PostgreSQL 15)
               Database: django_db
               User: django_user

Supporting Services:
  Secret Manager  → SECRET_KEY, DB_PASSWORD, ROOT_PASSWORD
  GCS Bucket      → django-media (STANDARD, objectAdmin)
  Filestore NFS   → /mnt/nfs shared across all instances
  Artifact Registry → custom Django image (Cloud Build)
  Cloud Monitoring  → uptime check, alert policies
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────┐
│  Google Cloud                                                │
│                                                              │
│  ┌──────────────────────┐   ┌──────────────────────────┐     │
│  │  Cloud Run (Gen2)    │   │  Secret Manager          │     │
│  │  Django + Auth Proxy │   │  SECRET_KEY, DB_PASSWORD │     │
│  │  Direct VPC Egress   │   └──────────────────────────┘     │
│  └──────────┬───────────┘                                    │
│             │ Private VPC                                    │
│  ┌──────────▼───────────┐   ┌──────────────────────────┐     │
│  │  Cloud SQL (Postgres) │   │  Cloud Filestore NFS     │    │
│  │  PostgreSQL 15        │   │  /mnt/nfs (media files)  │    │
│  └──────────────────────┘   └──────────────────────────┘     │
│                                                              │
│  ┌──────────────────────┐   ┌──────────────────────────┐     │
│  │  GCS Bucket          │   │  Artifact Registry       │     │
│  │  django-media        │   │  Custom Django image     │     │
│  └──────────────────────┘   └──────────────────────────┘     │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │  Cloud Monitoring    │                                    │
│  │  Uptime + Alerts     │                                    │
│  └──────────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install/Command |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` / `jq` | Any | System package manager |
| `gsutil` / `gcloud storage` | Any | Included with gcloud SDK |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
roles/monitoring.admin
roles/logging.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"   # your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Django_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `tenant_deployment_id` | `demo` | Short environment label |
| `application_name` | `django` | Do not change after first deploy |
| `application_version` | `latest` | Pin to a specific tag in production |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `1` | Increase for high-traffic deployments |
| `application_database_name` | `django_db` | PostgreSQL database name |
| `application_database_user` | `django_user` | PostgreSQL application user |
| `enable_nfs` | `true` | NFS shared media storage (gen2 required) |
| `enable_redis` | `false` | Set `true` to enable Redis caching |

Click **Deploy** and wait for provisioning to complete (approximately 15–30 minutes).

> **What this provisions:** Cloud Run service (Gen2), Cloud Build custom Django image, Cloud SQL PostgreSQL 15 instance with `django_db` database and `django_user`, `db-init` and `db-migrate` Cloud Run Jobs, Secret Manager secrets (`SECRET_KEY`, `DB_PASSWORD`, `ROOT_PASSWORD`), GCS media bucket, Cloud Filestore NFS instance, IAM bindings, Cloud Monitoring uptime check, and alert policies.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~django" \
  --limit=1)

# Get the service URL
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

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

echo "Service:     ${SERVICE}"
echo "Service URL: ${SERVICE_URL}"
```

---

## Exercise 1 — Access the Application

### Objective

Retrieve the Django service URL, open the application in a browser, and navigate to the Django Admin interface.

### Step 1.1 — Get the Service URL

**gcloud:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="table(metadata.name, status.url, status.conditions[0].status)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name: .name, uri: .urls[0], latestRevision: .latestReadyRevision}'
```

**Expected result:** The service shows `READY = True` and a URL in the form `https://<hash>-<region>.a.run.app`.

### Step 1.2 — Open the Application

```bash
echo "Navigate to: ${SERVICE_URL}"
```

Open the URL in your browser.

**Expected result:** The Django application home page loads over HTTPS. You should see the Django sample application index page.

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

**Expected result:** The admin password is printed to stdout. Copy it for the next step.

### Step 1.4 — Log In to Django Admin

Navigate to `${SERVICE_URL}/admin` in your browser. Log in with username `admin` and the password retrieved in Step 1.3.

**Expected result:** The Django administration dashboard appears, showing the Authentication and Authorisation section with Users and Groups.

---

## Exercise 2 — Explore Django Admin

### Objective

Use the Django Admin interface to manage users, groups, and application models, and inspect the built-in audit trail.

### Step 2.1 — Manage Users

1. In the Django Admin, click **Users** under **Authentication and Authorisation**.
2. Click **Add User** in the top-right corner.
3. Enter a username (e.g. `labuser`) and a password, then click **Save and continue editing**.
4. In the user detail page, check **Staff status** to grant admin access.
5. Click **Save**.

**Expected result:** The new user appears in the Users table.

### Step 2.2 — Manage Groups and Permissions

1. Click **Groups** under **Authentication and Authorisation**.
2. Click **Add Group**.
3. Name the group `editors` and assign some permissions (e.g. `Can view user`, `Can add user`).
4. Click **Save**.

**Expected result:** The `editors` group is created and listed.

### Step 2.3 — Explore Application Models

Navigate back to the admin dashboard. Depending on the registered Django apps:

1. Click any listed model (e.g. under a custom application section).
2. Create, edit, or delete a model instance using the admin form.
3. Use the built-in search and filter controls to find records.

**Expected result:** The admin interface reflects CRUD operations immediately.

### Step 2.4 — Inspect the Audit Trail

1. Click any object in the admin to open its detail view.
2. Click the **History** button in the top-right.

**Expected result:** The object history page shows a timestamped log of all changes, the user who made them, and what was changed. This audit trail is managed by Django's built-in `LogEntry` model.

### Step 2.5 — Confirm REST API (Optional)

If Django REST Framework is installed and configured:

```bash
curl -s -H "Accept: application/json" "${SERVICE_URL}/api/" | jq .
```

**Expected result:** A JSON object listing available API endpoints.

---

## Exercise 3 — Static Files and Media Storage

### Objective

Inspect the GCS media bucket, test a file upload through Django Admin, and verify the GCS Fuse volume mount configuration.

### Step 3.1 — List the GCS Bucket

**gcloud:**
```bash
gcloud storage buckets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="table(name, location, storageClass)"

# List contents of the media bucket
gcloud storage ls gs://${BUCKET}/
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | select(.name | test("django")) | {name, location, storageClass}'
```

**Expected result:** A GCS bucket named with a `django-media` suffix exists in your deployment region. The bucket may contain media or static file directories.

### Step 3.2 — Inspect GCS Fuse Volume Mount Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.template.spec.volumes)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.template.volumes'
```

**Expected result:** Volume entries appear for the NFS mount (`/mnt/nfs`) and any GCS Fuse volumes. The NFS volume will reference the Filestore instance IP.

### Step 3.3 — Test File Upload Through Django Admin

1. In the Django Admin, navigate to a model that supports file or image fields.
2. Click **Add** and use the file field to upload a test image.
3. Click **Save**.

**Expected result:** The file is saved to the NFS share or GCS bucket and can be served via the application URL.

### Step 3.4 — Verify File in GCS

```bash
# List GCS bucket recursively to see uploaded files
gcloud storage ls -r gs://${BUCKET}/

# Check bucket IAM for the Cloud Run service account
gcloud storage buckets get-iam-policy gs://${BUCKET} \
  --format="json" | jq '.bindings[] | select(.role | test("storage"))'
```

**Expected result:** Uploaded media files appear in the bucket under the media directory path. The Cloud Run service account has `roles/storage.objectAdmin`.

---

## Exercise 4 — Cloud Run Revisions and Traffic Management

### Objective

List Cloud Run revisions, inspect current traffic allocation, split traffic between revisions in a canary deployment pattern, and observe concurrency and scale-to-zero behaviour.

### Step 4.1 — List Revisions

**gcloud:**
```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="table(metadata.name, status.conditions[0].status, spec.containerConcurrency, metadata.creationTimestamp)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}/revisions" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.revisions[] | {name: .name, state: .conditions[0].state, createTime}'
```

**Expected result:** One or more revisions listed with their creation timestamps and ready status.

### Step 4.2 — Inspect Current Traffic Split

**gcloud:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.traffic)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.traffic'
```

**Expected result:** 100% of traffic is routed to `TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST`.

### Step 4.3 — Test Traffic Split (Canary Pattern)

To demonstrate traffic splitting, send requests and observe revision distribution:

1. Note the current revision name from Step 4.1.
2. In the Cloud Console, navigate to **Cloud Run > your service > Edit & Deploy New Revision**.
3. After deploying, go to the **Revisions** tab and click **Manage Traffic**.
4. Set the previous revision to 10% and the latest to 90%.

```bash
# Verify the updated traffic split
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.traffic)"

# Send 10 requests to observe distribution
for i in {1..10}; do
  curl -s -o /dev/null -w "Request ${i}: HTTP %{http_code}\n" "${SERVICE_URL}"
done
```

**Expected result:** Traffic split shows two revision entries. All requests return HTTP 200 regardless of which revision handles them.

### Step 4.4 — Inspect Concurrency and Scaling Settings

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.template.spec.containerConcurrency,spec.template.metadata.annotations)"
```

Key annotations to observe:
- `autoscaling.knative.dev/minScale` — minimum instance count (0 = scale-to-zero)
- `autoscaling.knative.dev/maxScale` — maximum instance count
- `run.googleapis.com/vpc-access-egress` — VPC egress mode (`PRIVATE_RANGES_ONLY`)
- `run.googleapis.com/execution-environment` — `gen2`

### Step 4.5 — Demonstrate Scale-to-Zero

With `min_instance_count = 0`, the service scales to zero after ~5 minutes of inactivity. Observe the cold start:

```bash
# Wait several minutes without sending requests, then:
time curl -s -o /dev/null -w "HTTP %{http_code}, total time: %{time_total}s\n" "${SERVICE_URL}"
```

**Expected result:** First request after idle period takes 3–10 seconds (cold start includes image pull, Django startup, and database connection). Subsequent requests are fast (&lt;200ms).

---

## Exercise 5 — Security and Secret Management

### Objective

Inspect the secrets created for the Django deployment, retrieve the admin password, examine IAM bindings, and verify the Cloud SQL Auth Proxy sidecar.

### Step 5.1 — List Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="table(name, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:django" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | {name: .name, createTime}'
```

**Expected result:** At least three secrets: `SECRET_KEY`, `DB_PASSWORD`, and `ROOT_PASSWORD` (named with your resource prefix).

### Step 5.2 — Retrieve the Admin Password

```bash
# Find the admin password secret
ADMIN_PWD_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~admin-password" \
  --format="value(name)" \
  --limit=1)

# Access the latest version
gcloud secrets versions access latest \
  --secret="${ADMIN_PWD_SECRET}" \
  --project=${PROJECT}
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${ADMIN_PWD_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 --decode
```

### Step 5.3 — Inspect IAM Bindings on the Service

**gcloud:**
```bash
gcloud run services get-iam-policy ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**REST API:**
```bash
curl -s -X POST \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}:getIamPolicy" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.bindings'
```

**Expected result:** The `roles/run.invoker` binding shows `allUsers` for a publicly accessible service. The Cloud Run service account has `roles/secretmanager.secretAccessor` and `roles/cloudsql.client`.

### Step 5.4 — Verify Cloud SQL Auth Proxy Sidecar

```bash
# Inspect the Cloud Run service containers
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" \
  | jq '.template.containers[].name'
```

**Expected result:** Two containers listed: the Django application container and `cloud-sql-proxy`. The proxy sidecar provides a Unix socket connection to Cloud SQL without exposing the database to the public internet.

### Step 5.5 — Check Secret Injection in Service Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Expected result:** The container environment includes `SECRET_KEY` and `DB_PASSWORD` as `secretKeyRef` entries (references to Secret Manager secrets), not plaintext values.

---

## Exercise 6 — Cloud Logging

### Objective

Query Cloud Run structured logs for Django application output, HTTP request logs, error logs, and Cloud SQL Auth Proxy logs.

### Step 6.1 — View All Service Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\"" \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, severity, textPayload, httpRequest.status)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"cloud_run_revision\\\" AND resource.labels.service_name=\\\"${SERVICE}\\\"\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 6.2 — Filter for Structured Django Logs

Use the Cloud Console **Logs Explorer** (`https://console.cloud.google.com/logs/query`) with these queries:

**Django error logs:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
severity>=ERROR
```

**HTTP 4xx/5xx responses:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
httpRequest.status>=400
```

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=ERROR" \
  --project=${PROJECT} \
  --limit=20
```

### Step 6.3 — Query SQL Proxy Logs

The Cloud SQL Auth Proxy sidecar emits startup and connection logs:

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND (textPayload=~\"cloud-sql-proxy\" OR textPayload=~\"listening\")" \
  --project=${PROJECT} \
  --limit=20
```

**Logs Explorer query:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"cloud-sql-proxy|pq:|FATAL"
```

**Expected result:** The proxy startup log shows successful connection to the Cloud SQL instance socket path (`/cloudsql/PROJECT:REGION:INSTANCE`).

### Step 6.4 — Generate Logs and Observe

```bash
# Send several requests to generate access logs
for i in {1..5}; do
  curl -s -o /dev/null -w "Request ${i}: HTTP %{http_code}\n" "${SERVICE_URL}"
done

# Fetch the last 20 HTTP request logs
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND httpRequest.requestUrl:\"*\"" \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, httpRequest.status, httpRequest.requestUrl, httpRequest.latency)"
```

---

## Exercise 7 — Cloud Monitoring

### Objective

View request metrics, monitor active instance count, inspect the uptime check, and create a simple alert policy for error rates.

### Step 7.1 — View Request Metrics

Navigate to the Cloud Console: `https://console.cloud.google.com/run?project=${PROJECT}`

Click your service, then the **Metrics** tab. Explore:
- **Request count** — total HTTP requests per minute
- **Request latencies** — p50, p95, p99 percentiles
- **Container instance count** — active vs. idle instances

**REST API (request count, last 10 minutes):**
```bash
START=$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=metric.type%3D%22run.googleapis.com%2Frequest_count%22%20AND%20resource.labels.service_name%3D%22${SERVICE}%22&interval.startTime=${START}&interval.endTime=${END}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '[.timeSeries[].points[].value.int64Value | tonumber] | add // 0'
```

### Step 7.2 — Monitor Instance Count

Generate traffic to observe scale-up:

```bash
# Send concurrent requests to trigger scaling
for i in {1..30}; do
  curl -s -o /dev/null "${SERVICE_URL}" &
done
wait

echo "Check instance count in Cloud Console Metrics tab"
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/metrics?project=${PROJECT}"
```

**MQL query for Metrics Explorer:**
```
fetch cloud_run_revision
| metric 'run.googleapis.com/container/instance_count'
| filter resource.service_name == '${SERVICE}'
| group_by [metric.state], [value: mean(value.instance_count)]
| every 1m
```

### Step 7.3 — Check Uptime Checks

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project=${PROJECT} \
  --format="table(displayName, httpCheck.path, period, selectedRegions)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {displayName, path: .httpCheck.path, period}'
```

**Expected result:** An uptime check probing your service URL (`/`) from multiple global regions, checking every 60 seconds.

### Step 7.4 — Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project=${PROJECT} \
  --format="table(displayName, conditions[0].displayName)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.alertPolicies[] | {displayName, enabled}'
```

**Expected result:** Alert policies for the Django service. The module provisions an uptime-failure alert by default. You can create additional policies for error rate, latency, or instance count thresholds.

---

## 12. Cleanup

Return to the RAD UI and click **Undeploy** on the `Django_CloudRun` deployment. This removes the Cloud Run service, Cloud Run Jobs, Secret Manager secrets, GCS buckets, Cloud SQL database and user, Artifact Registry images, Filestore NFS instance, and Cloud Monitoring checks.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} --quiet

# Delete secrets (confirm names first)
gcloud secrets list --project=${PROJECT} --filter="name~django"
gcloud secrets delete <secret-name> --project=${PROJECT} --quiet

# Delete GCS bucket
gsutil -m rm -r gs://${BUCKET}

# List and delete uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}
```

**REST API — delete the service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

> **Note:** Resources provisioned by the `Services_GCP` module (VPC, shared Cloud SQL instance, GKE cluster, Filestore) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## 13. Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `tenant_deployment_id` | string | `demo` | Short environment label; embedded in resource names |
| `application_name` | string | `django` | Base resource name; do not change after first deploy |
| `application_version` | string | `latest` | Container image version tag |
| `deploy_application` | bool | `true` | Set `false` for infrastructure-only deployment |
| `min_instance_count` | number | `0` | 0 = scale-to-zero; set ≥1 to eliminate cold starts |
| `max_instance_count` | number | `1` | Increase for high-traffic deployments |
| `container_resources` | object | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits per instance |
| `execution_environment` | string | `gen2` | Gen2 required for NFS and GCS Fuse |
| `timeout_seconds` | number | `300` | Max request duration (max 3600s) |
| `enable_cloudsql_volume` | bool | `true` | Inject Cloud SQL Auth Proxy sidecar |
| `application_database_name` | string | `django_db` | PostgreSQL database name (do not change after deploy) |
| `application_database_user` | string | `django_user` | PostgreSQL application user |
| `enable_nfs` | bool | `true` | NFS shared storage for media files (gen2 required) |
| `nfs_mount_path` | string | `/mnt/nfs` | Container path for NFS mount |
| `enable_redis` | bool | `false` | Inject `REDIS_HOST`/`REDIS_PORT` env vars |
| `redis_host` | string | `""` | Redis server hostname or IP |
| `ingress_settings` | string | `all` | `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | VPC egress routing mode |
| `backup_schedule` | string | `0 2 * * *` | Cron expression for automated backups (UTC) |
| `backup_retention_days` | number | `7` | Days to retain backup files in GCS |

### Useful Commands Reference

```bash
# Get service URL
gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} \
  --format="value(status.url)"

# List revisions
gcloud run revisions list --service=${SERVICE} --region=${REGION} --project=${PROJECT}

# View traffic split
gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} \
  --format="yaml(spec.traffic)"

# List secrets
gcloud secrets list --project=${PROJECT} --filter="name~django"

# Retrieve a secret value
gcloud secrets versions access latest --secret="${ADMIN_SECRET}" --project=${PROJECT}

# View service logs
gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\"" \
  --project=${PROJECT} --limit=50

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# List GCS buckets
gcloud storage buckets list --project=${PROJECT} --filter="name~django"

# Inspect service volumes
gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} \
  --format="yaml(spec.template.spec.volumes)"
```

### Further Reading

- [Django on Cloud Run — Configuration Guide](https://docs.radmodules.dev/docs/modules/Django_CloudRun)
- [Django documentation](https://docs.djangoproject.com/)
- [Cloud Run Gen2 documentation](https://cloud.google.com/run/docs/about-execution-environments)
- [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
- [GCS Fuse on Cloud Run](https://cloud.google.com/run/docs/tutorials/network-filesystems-fuse)
- [Cloud Run traffic splitting](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
- [Secret Manager for Cloud Run](https://cloud.google.com/run/docs/configuring/secrets)
