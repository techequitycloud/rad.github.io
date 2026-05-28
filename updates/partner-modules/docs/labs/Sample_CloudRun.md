# Sample Application on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Sample_CloudRun)**

This lab guide walks you through deploying, exploring, and operating the **Sample** reference
Flask application on Google Cloud Run v2 using the **Sample_CloudRun** module. Use this module
to understand the full App_CloudRun module feature set before building production application
modules.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access the Sample App](#exercise-1--access-the-sample-app)
6. [Exercise 2 — Explore Application Routes](#exercise-2--explore-application-routes)
7. [Exercise 3 — Configuration and Secrets](#exercise-3--configuration-and-secrets)
8. [Exercise 4 — Cloud Run Features](#exercise-4--cloud-run-features)
9. [Exercise 5 — Cloud Logging](#exercise-5--cloud-logging)
10. [Exercise 6 — Cloud Monitoring](#exercise-6--cloud-monitoring)
11. [Cleanup](#cleanup)
12. [Reference](#reference)

---

## 1. Overview

### What Is Sample_CloudRun?

`Sample_CloudRun` deploys a minimal **Flask web application** on Cloud Run v2 as a reference
implementation demonstrating the full `App_CloudRun` feature set. The Flask app exposes
several HTTP endpoints for testing database connectivity, secret injection, GCP metadata, NFS
mounts, and Redis — making it ideal for understanding infrastructure patterns before
deploying production applications.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Flask on Cloud Run** | Containerised Python app with auto-scaling and scale-to-zero |
| **Cloud SQL PostgreSQL** | Database connectivity via Cloud SQL Auth Proxy Unix socket |
| **Secret Manager** | `SECRET_KEY` injected at runtime from Secret Manager |
| **Redis Sidecar** | Optional `REDIS_HOST`/`REDIS_PORT` environment variable injection |
| **GCS Fuse** | Application GCS bucket mounted as a filesystem volume |
| **Filestore NFS** | `/mnt/nfs` volume mounted via Cloud Filestore |
| **Traffic Splitting** | Multiple revision management and percentage-based routing |
| **Scale-to-Zero** | Cold start behaviour, scale-up under load |

---

## 2. Architecture

```
Internet / Client
       │
       ▼ HTTPS (Cloud Run URL)
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Run v2 Service (cloudrunapp)                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Revision: cloudrunapp-xxxxx                              │   │
│  │  Container: sample Flask app (port 8080)                  │   │
│  │  SECRET_KEY ← Secret Manager (injected at runtime)       │    │
│  │  REDIS_HOST / REDIS_PORT ← env vars (if enabled)         │    │
│  │  min_instances=0  max_instances=1                         │   │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Volumes:                                                        │
│  ├── /cloudsql  (Cloud SQL Auth Proxy Unix socket)               │
│  ├── /mnt/nfs   (Cloud Filestore NFS)                            │
│  └── /mnt/gcs   (GCS Fuse application bucket)                    │
└──────────────────────────────────────────────────────────────────┘
       │ Direct VPC Egress → VPC
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Cloud SQL PostgreSQL (via Auth Proxy)                           │
│  Database: sampleapp  │  DB password → Secret Manager            │
└──────────────────────────────────────────────────────────────────┘

Flask Endpoints:
  /          → Home page / JSON welcome
  /health    → Health check (used by startup/liveness probes)
  /db        → PostgreSQL connectivity test
  /metadata  → GCP instance metadata
  /env       → Non-sensitive environment variables
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` | Any | System package manager |
| `jq` | 1.6+ | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
roles/monitoring.admin
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set run/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Sample_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `cloudrunapp` | Base resource name |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `1` | Cost ceiling |
| `enable_nfs` | `true` | Filestore NFS mount |
| `enable_redis` | `false` | Redis (optional) |

Click **Deploy** and wait for provisioning to complete (approximately 6–13 minutes).

> **What this provisions:** Cloud Run v2 service, Cloud SQL PostgreSQL with Auth Proxy, `SECRET_KEY`
> in Secret Manager, GCS bucket, Filestore NFS, uptime check, and alert policies.

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
  --filter="metadata.name~cloudrunapp" \
  --limit=1)

# Get the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

# Discover the secret key secret
export SECRET_KEY_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~cloudrunapp OR name~secret-key" \
  --format="value(name)" \
  --limit=1)

echo "Sample App URL: ${SERVICE_URL}"
echo "Service: ${SERVICE}"
```

---

## Exercise 1 — Access the Sample App

### Objective

Retrieve the Cloud Run service URL, verify the Flask home page loads, and confirm the health
check endpoint is responding.

### Step 1.1 — Get the Service URL

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, uri: .urls[0], latestReadyRevision}'
```

**Expected result:** A URL in the form `https://cloudrunapp-<hash>-uc.a.run.app`.

### Step 1.2 — Access the Home Page

```bash
curl -s "${SERVICE_URL}/"
```

**Expected result:** JSON welcome response from the Flask app, including service name and
version information retrieved from Cloud Run environment variables.

### Step 1.3 — Test the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/health"
```

**Expected result:** HTTP `200` — this endpoint is used by the Cloud Run startup and liveness
probes.

### Step 1.4 — Verify Service Status

**gcloud:**
```bash
gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(metadata.name, status.conditions[0].status, status.url)"
```

**Expected result:** The service shows status `True` (Ready) with the service URL.

### Step 1.5 — Open in Browser

Navigate to `${SERVICE_URL}` in a browser to explore the Flask application interface.

**Expected result:** The sample application home page loads, displaying available endpoints
and deployment information.

---

## Exercise 2 — Explore Application Routes

### Objective

Test each available Flask endpoint to verify database connectivity, GCP metadata access,
and environment variable injection.

### Step 2.1 — Test Database Connectivity Endpoint

```bash
curl -s "${SERVICE_URL}/db" | jq
```

**Expected result:** JSON response confirming PostgreSQL connection via the Cloud SQL Auth
Proxy Unix socket:
```json
{
  "status": "ok",
  "database": "sampleapp",
  "user": "cloudrunapp",
  "connection": "cloud-sql-proxy"
}
```

### Step 2.2 — Retrieve GCP Metadata

```bash
curl -s "${SERVICE_URL}/metadata" | jq
```

**Expected result:** JSON response with Cloud Run instance metadata:
```json
{
  "project_id": "your-project",
  "region": "us-central1",
  "service_name": "cloudrunapp-xxxxx",
  "revision": "cloudrunapp-xxxxx-00001"
}
```

This data is fetched from the GCP instance metadata server (`metadata.google.internal`).

### Step 2.3 — View Environment Variables

```bash
curl -s "${SERVICE_URL}/env" | jq
```

**Expected result:** Non-sensitive environment variables injected by Cloud Run including
`DB_NAME`, `DB_USER`, `REDIS_HOST` (if enabled), and resource limits.

### Step 2.4 — Send Concurrent Requests

```bash
for i in {1..10}; do
  curl -s "${SERVICE_URL}/health" &
done
wait
```

**Expected result:** All 10 requests return HTTP `200`. Since `max_instance_count=1`,
Cloud Run serves all requests from a single instance (within concurrency limits).

### Step 2.5 — Test NFS Mount Endpoint (if available)

```bash
curl -s "${SERVICE_URL}/nfs" | jq
```

**Expected result:** JSON response listing files in `/mnt/nfs`, confirming the Cloud
Filestore NFS volume is mounted and readable inside the container.

---

## Exercise 3 — Configuration and Secrets

### Objective

Inspect environment variable injection, access Secret Manager secrets, and verify the Redis
sidecar configuration.

### Step 3.1 — Inspect Environment Variables in the Service

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.template.containers[0].env[] | {name, value: (.value // "SECRET_MANAGER_REF")}'
```

**Expected result:** Environment variables including `DB_NAME`, `DB_USER`, `DB_TYPE`, and
secret references for `SECRET_KEY` and `DB_PASSWORD`.

### Step 3.2 — List Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~cloudrunapp" \
  --format="table(name, createTime)"
```

**Expected result:** Secrets for the database password and Flask `SECRET_KEY`.

### Step 3.3 — Access the Flask Secret Key

```bash
gcloud secrets versions access latest \
  --secret="${SECRET_KEY_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRET_KEY_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 --decode
```

**Expected result:** A 32-character random string used as the Flask `SECRET_KEY` for session
signing — proving Secret Manager injection is working.

### Step 3.4 — Verify Secret IAM Bindings

**gcloud:**
```bash
gcloud secrets get-iam-policy "${SECRET_KEY_SECRET}" \
  --project="${PROJECT}"
```

**Expected result:** The Cloud Run service account has `roles/secretmanager.secretAccessor`.

### Step 3.5 — Check Redis Configuration (if enabled)

```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -A2 "REDIS"
```

**Expected result:** `REDIS_HOST` and `REDIS_PORT` environment variables appear if
`enable_redis=true`. When Redis is disabled, these variables are absent.

---

## Exercise 4 — Cloud Run Features

### Objective

Explore revision management, traffic splitting, scale-to-zero behaviour, and Direct VPC
Egress networking configuration.

### Step 4.1 — List Revisions

**gcloud:**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(metadata.name, status.conditions[0].status, metadata.creationTimestamp)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}/revisions" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.revisions[] | {name, createTime}'
```

**Expected result:** One or more revisions, with the most recent being active.

### Step 4.2 — View Traffic Split

```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml(spec.traffic)"
```

**Expected result:** Traffic configuration showing `latestRevision: true` with `percent: 100`.

### Step 4.3 — Observe Scale-to-Zero

Allow the service to idle (no requests for approximately 5 minutes), then send a request:

```bash
# Measure cold start latency
time curl -s "${SERVICE_URL}/health"
```

**Expected result:** The first request after idle takes 1–3 seconds (cold start). Subsequent
requests are fast (warm instance already running).

### Step 4.4 — Trigger Scale-Up Under Load

```bash
for i in {1..30}; do
  curl -s "${SERVICE_URL}/health" &
done
wait
```

In Cloud Monitoring, observe the instance count metric spike from 0 to 1 as requests arrive.

**Expected result:** Instance count graph shows the service scaling up from zero to handle
the burst of concurrent requests.

### Step 4.5 — View VPC Egress Configuration

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="json" \
  | jq '.template.metadata.annotations | {
      egress: .["run.googleapis.com/vpc-access-egress"],
      env: .["run.googleapis.com/execution-environment"]
    }'
```

**Expected result:** VPC egress shows `PRIVATE_RANGES_ONLY` (Direct VPC Egress), enabling
private connectivity to Cloud SQL and NFS without sending traffic over the public internet.

### Step 4.6 — Inspect Revision Scaling Annotations

```bash
gcloud run revisions describe \
  $(gcloud run revisions list \
    --service="${SERVICE}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --format="value(metadata.name)" --limit=1) \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml(metadata.annotations)"
```

Key annotations:
- `autoscaling.knative.dev/minScale: "0"` — scale-to-zero enabled
- `autoscaling.knative.dev/maxScale: "1"` — cost ceiling
- `run.googleapis.com/execution-environment: gen2` — required for NFS

---

## Exercise 5 — Cloud Logging

### Objective

Query structured Flask application logs via Cloud Logging, filter by severity, and explore
HTTP request logging.

### Step 5.1 — View Recent Application Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp,severity,textPayload,httpRequest.status)"
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

### Step 5.2 — Filter for Flask Application Logs

In the Cloud Console Log Explorer:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"Flask|werkzeug|app"
```

**Expected result:** Flask request log entries showing HTTP method, path, response code, and
response time — these are Flask's structured access logs written to stdout.

### Step 5.3 — Filter for Warning and Error Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=WARNING" \
  --project="${PROJECT}" \
  --limit=20
```

**Expected result:** Under normal operation, only informational startup messages appear. Any
warnings indicate configuration or connectivity issues.

### Step 5.4 — Stream Live Logs

```bash
gcloud beta run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

In another terminal:
```bash
curl -s "${SERVICE_URL}/db"
curl -s "${SERVICE_URL}/metadata"
```

**Expected result:** Log entries appear in the stream for each request, including the endpoint
path, status code, and response time.

### Step 5.5 — View HTTP Request Logs

In the Cloud Console Log Explorer:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
httpRequest.status>=200
```

**Expected result:** Structured HTTP request log entries with `httpRequest` fields: method,
requestUrl, status, responseSize, latency, and userAgent.

---

## Exercise 6 — Cloud Monitoring

### Objective

Explore Cloud Monitoring metrics for the Flask application, inspect the uptime check status,
and observe instance count changes under load.

### Step 6.1 — View Request Count Metrics

**REST API (MQL):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision | metric 'run.googleapis.com/request_count' | filter resource.service_name = '${SERVICE}' | group_by [metric.response_code_class], sum(val()) | within 1h\"
  }" | jq '.timeSeriesData[] | {code: .labelValues[0].stringValue, count: .pointData[-1].values[0].int64Value}'
```

**Expected result:** Request counts broken down by HTTP response code class (2xx, 4xx, 5xx).

### Step 6.2 — View Request Latency

In the Cloud Console, navigate to Cloud Run → your service → **Metrics** tab.

**REST API (MQL — P95 latency):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision | metric 'run.googleapis.com/request_latencies' | filter resource.service_name = '${SERVICE}' | align delta(1m) | every 1m | percentile(95) | within 1h\"
  }" | jq '.timeSeriesData[].pointData[-1]'
```

### Step 6.3 — Check the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(displayName, httpCheck.path, period, selectedRegions)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {displayName, period, httpCheck}'
```

**Expected result:** Uptime check probing the `/health` endpoint from multiple global regions
every 60 seconds with passing status (green).

### Step 6.4 — View Container Memory Utilisation

**REST API (MQL):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision | metric 'run.googleapis.com/container/memory/utilizations' | filter resource.service_name = '${SERVICE}' | within 30m | group_by [], mean(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].doubleValue'
```

**Expected result:** Memory utilisation as a fraction (0.0–1.0) of the configured `memory_limit`.

### Step 6.5 — Review Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --format="table(displayName, enabled, conditions[0].displayName)"
```

**Expected result:** CPU and memory alert policies configured to trigger when utilisation
exceeds 90% for 60 seconds.

### Step 6.6 — View the Cloud Monitoring Dashboard

```bash
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/metrics?project=${PROJECT}"
```

Navigate to the Cloud Run service metrics tab for a pre-configured dashboard showing request
count, latency, instance count, and container CPU/memory for the sample application.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Sample_CloudRun` deployment. This removes
the Cloud Run service, all revisions, Cloud SQL database and user, GCS bucket, NFS Filestore,
Secret Manager secrets, uptime checks, and alert policies.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" --quiet

# Delete secrets
for SECRET in $(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~cloudrunapp" \
  --format="value(name)"); do
  gcloud secrets delete "${SECRET}" \
    --project="${PROJECT}" --quiet
done
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
| `application_name` | string | `cloudrunapp` | Base name for Cloud Run service and resources |
| `application_version` | string | `latest` | Container image version tag |
| `min_instance_count` | number | `0` | Scale-to-zero (0) or always-warm (1+) |
| `max_instance_count` | number | `1` | Maximum instances (cost ceiling) |
| `cpu_limit` | string | `1000m` | CPU per instance |
| `memory_limit` | string | `512Mi` | Memory per instance |
| `application_database_name` | string | `sampleapp` | PostgreSQL database name |
| `application_database_user` | string | `cloudrunapp` | PostgreSQL user |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore at `/mnt/nfs` |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS container mount path |
| `enable_redis` | bool | `false` | Inject Redis env vars |
| `redis_host` | string | `""` | Redis hostname (required when Redis enabled) |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | VPC egress mode |
| `execution_environment` | string | `gen2` | Cloud Run gen (`gen2` required for NFS) |
| `max_revisions_to_retain` | number | `7` | Revision retention count |
| `tenant_deployment_id` | string | `demo` | Tenant identifier in resource names |
| `support_users` | list | `[]` | Email addresses for monitoring alerts |

### Useful Commands

```bash
# Get service URL
gcloud run services describe ${SERVICE} \
  --region=${REGION} --project=${PROJECT} \
  --format="value(status.url)"

# Test health endpoint
curl "${SERVICE_URL}/health"

# Test database connectivity
curl "${SERVICE_URL}/db"

# List revisions
gcloud run revisions list \
  --service=${SERVICE} --region=${REGION} --project=${PROJECT}

# Stream live logs
gcloud beta run services logs tail ${SERVICE} \
  --region=${REGION} --project=${PROJECT}

# Access Flask secret key
gcloud secrets versions access latest \
  --secret="${SECRET_KEY_SECRET}" --project=${PROJECT}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}
```

### Further Reading

- [Flask documentation](https://flask.palletsprojects.com/)
- [Cloud Run auto-scaling](https://cloud.google.com/run/docs/about-instance-autoscaling)
- [Cloud Run traffic splitting](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
- [Direct VPC Egress](https://cloud.google.com/run/docs/configuring/vpc-direct-vpc)
- [Cloud Run scale-to-zero](https://cloud.google.com/run/docs/configuring/min-instances)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Secret Manager with Cloud Run](https://cloud.google.com/run/docs/configuring/secrets)
