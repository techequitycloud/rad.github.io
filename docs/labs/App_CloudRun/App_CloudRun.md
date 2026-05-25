---
title: "App on Cloud Run — Lab Guide"
sidebar_label: "App CloudRun"
---

# App on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun)**

This lab guide walks you through deploying, exploring, and operating the **App_CloudRun**
foundation module on Google Cloud Run v2. You will explore the full infrastructure stack that
powers all Cloud Run application modules: Cloud SQL, Secret Manager, VPC networking, Direct
VPC Egress, Cloud Monitoring uptime checks, and structured Cloud Logging.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access the Application](#exercise-1--access-the-application)
6. [Exercise 2 — Cloud Run Configuration](#exercise-2--cloud-run-configuration)
7. [Exercise 3 — Database Integration](#exercise-3--database-integration)
8. [Exercise 4 — Secret Manager](#exercise-4--secret-manager)
9. [Exercise 5 — Networking](#exercise-5--networking)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring](#exercise-7--cloud-monitoring)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is App_CloudRun?

`App_CloudRun` is the **foundation deployment engine** for all Cloud Run application modules
in the RAD Modules ecosystem. It provisions a production-ready Cloud Run v2 service, including
Cloud SQL (PostgreSQL or MySQL), Cloud Filestore NFS, GCS storage, Secret Manager, Cloud Build
CI/CD, Cloud Monitoring, and optional Cloud Armor WAF. Application wrappers such as
`Wikijs_CloudRun`, `Ghost_CloudRun`, and `Django_CloudRun` call this module with app-specific
configuration.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Cloud Run v2** | Serverless container service with auto-scaling, scale-to-zero, concurrency |
| **Revisions** | Immutable revision model, traffic splitting, rolling updates |
| **Direct VPC Egress** | Private connectivity to Cloud SQL and internal services |
| **Cloud SQL Auth Proxy** | Sidecar-based database connection via Unix socket |
| **Secret Manager** | DB password and app secrets injected at runtime |
| **GCS Storage** | Application bucket with lifecycle management |
| **Cloud Monitoring** | Uptime checks, request metrics, instance count alerts |
| **Cloud Logging** | Structured HTTP request logs and application logs |

---

## 2. Architecture

```
Internet / Client
       │
       ▼ HTTPS (Cloud Run URL)
┌──────────────────────────────────────────────────────────────────┐
│  Cloud Run v2 Service (crapp)                                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Revision: crapp-xxxxx                                    │   │
│  │  Container: application (port 8080)                       │   │
│  │  Resource limits: cpu=1000m, memory=512Mi                 │   │
│  │  Concurrency: 80 (default)                                │   │
│  │  min_instances=0  max_instances=1                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Volumes:                                                        │
│  ├── /cloudsql  (Cloud SQL Auth Proxy socket)                   │
│  ├── /mnt/nfs   (Cloud Filestore NFS, if enabled)               │
│  └── /mnt/gcs   (GCS Fuse, if configured)                      │
└──────────────────────────────────────────────────────────────────┘
       │ Direct VPC Egress (PRIVATE_RANGES_ONLY)
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  VPC Network (Services_GCP)                                      │
│  ├── Cloud SQL PostgreSQL (Auth Proxy Unix socket)               │
│  ├── Cloud Filestore NFS                                         │
│  └── Redis (optional, REDIS_HOST env var injected)              │
└──────────────────────────────────────────────────────────────────┘

Supporting Services:
  Artifact Registry   ← container image (custom or prebuilt)
  Secret Manager      ← database password, app secrets
  GCS Bucket          ← application storage
  Cloud Scheduler     ← cron jobs (backup, etc.)
  Cloud Monitoring    ← uptime check, alert policies
  Cloud Build         ← CI/CD trigger (optional)
```

Module variable wiring:

```
  App_CloudRun
    application_name      = "crapp"       →  Cloud Run service name prefix
    container_image_source = "custom"     →  Cloud Build builds image
    min_instance_count    = 0             →  scale-to-zero
    max_instance_count    = 1             →  cost ceiling
    database_type         = "POSTGRES"    →  Cloud SQL PostgreSQL
    enable_nfs            = true          →  Filestore NFS at /mnt/nfs
    enable_redis          = true          →  REDIS_HOST env var injected
    vpc_egress_setting    = "PRIVATE_RANGES_ONLY"  →  Direct VPC Egress
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
roles/logging.admin
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

Deploy the `App_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `crapp` | Base resource name |
| `application_version` | `1.0.0` | Container image tag |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `1` | Single instance |
| `database_type` | `POSTGRES` | Cloud SQL PostgreSQL |
| `enable_nfs` | `true` | Filestore NFS mount |
| `enable_redis` | `true` | Redis env vars injected |

Click **Deploy** and wait for provisioning to complete (approximately 15–30 minutes).

> **What this provisions:** Cloud Run v2 service with Direct VPC Egress, Cloud SQL PostgreSQL
> with Auth Proxy sidecar, Artifact Registry (custom image build), GCS bucket, Filestore NFS,
> Secret Manager secrets, Cloud Build initialization job, uptime check, and alert policies.

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
  --filter="metadata.name~crapp" \
  --limit=1)

# Get the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~crapp" \
  --format="value(name)" \
  --limit=1)

echo "Application URL: ${SERVICE_URL}"
echo "Service: ${SERVICE}"
echo "DB Secret: ${DB_SECRET}"
```

---

## Exercise 1 — Access the Application

### Objective

Retrieve the Cloud Run service URL, verify the service is healthy, and test the application
health endpoint.

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

**Expected result:** A URL in the form `https://crapp-<hash>-uc.a.run.app`.

### Step 1.2 — Verify Service is Ready

```bash
gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(metadata.name, status.conditions[0].status, status.url)"
```

**Expected result:** The service appears with status `True` (Ready).

### Step 1.3 — Test the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/healthz"
```

**Expected result:** HTTP `200` — the application is running and responsive.

### Step 1.4 — Make a Request to the Application Root

```bash
curl -s "${SERVICE_URL}/"
```

**Expected result:** The application responds with a home page or JSON payload, confirming
the container is serving requests.

### Step 1.5 — List All Cloud Run Services in the Project

**gcloud:**
```bash
gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.services[] | {name, uri: .urls[0], latestReadyRevision}'
```

---

## Exercise 2 — Cloud Run Configuration

### Objective

Inspect the Cloud Run service configuration, explore revisions, view traffic splitting, and
understand scaling and concurrency settings.

### Step 2.1 — Describe the Service Configuration

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, ingress, launchStage, template: {scaling: .template.scaling, containers: [.template.containers[] | {image, resources}]}}'
```

Note:
- Container image, resource limits (cpu, memory)
- `min_instance_count` and `max_instance_count` annotations
- VPC egress setting and Direct VPC Egress attachment

### Step 2.2 — List Revisions

**gcloud:**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(metadata.name, status.conditions[0].status, spec.containerConcurrency, metadata.creationTimestamp)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}/revisions" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.revisions[] | {name, createTime, serviceAccount}'
```

**Expected result:** A list of revisions with their names, ready status, and creation timestamps.

### Step 2.3 — View Traffic Split

```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml(spec.traffic)"
```

**Expected result:** Traffic configuration showing `latestRevision: true` and `percent: 100`,
routing all traffic to the latest revision.

### Step 2.4 — Inspect Scaling and Concurrency Annotations

```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml(spec.template.metadata.annotations)"
```

Key annotations to observe:
- `autoscaling.knative.dev/minScale` — minimum instance count
- `autoscaling.knative.dev/maxScale` — maximum instance count
- `run.googleapis.com/vpc-access-egress` — VPC egress mode
- `run.googleapis.com/execution-environment` — `gen2` for NFS support

### Step 2.5 — Trigger Scale-to-Zero and Cold Start

Allow the service to idle (no requests for 5 minutes), then:

```bash
# Measure cold start latency
time curl -s "${SERVICE_URL}/healthz"
```

Then send concurrent requests to observe scale-up:

```bash
for i in {1..20}; do
  curl -s "${SERVICE_URL}/healthz" &
done
wait
```

**Expected result:** First request is slower (cold start from zero instances); subsequent
requests serve immediately from the warm instance.

---

## Exercise 3 — Database Integration

### Objective

Inspect the Cloud SQL instance, list databases, verify the Cloud SQL Auth Proxy sidecar
configuration, and confirm the database initialisation job completed.

### Step 3.1 — List Cloud SQL Instances

**gcloud:**
```bash
gcloud sql instances list \
  --project="${PROJECT}" \
  --format="table(name, state, databaseVersion, region, settings.tier)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, state, databaseVersion, region}'
```

**Expected result:** A Cloud SQL PostgreSQL instance appears with state `RUNNABLE`.

### Step 3.2 — List Databases in the Instance

```bash
SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --format="value(name)" --limit=1)

gcloud sql databases list \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}/databases" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, charset, collation}'
```

**Expected result:** The application database (`crappdb`) appears in the list.

### Step 3.3 — Verify Cloud SQL Auth Proxy in the Service

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.containers)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.template.containers[] | {name, image, volumeMounts}'
```

**Expected result:** Volume mount at `/cloudsql` for the Cloud SQL Auth Proxy Unix socket,
confirming private database connectivity.

### Step 3.4 — List Cloud Run Jobs (Init Jobs)

**gcloud:**
```bash
gcloud run jobs list \
  --project="${PROJECT}" \
  --region="${REGION}"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.jobs[] | {name, latestCreatedExecution}'
```

**Expected result:** The `db-init` Cloud Run Job appears, having completed database schema
initialisation on first deployment.

### Step 3.5 — Verify Connection Name in Environment

```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Expected result:** Environment variables include `DB_NAME`, `DB_USER`, and connection
configuration pointing to the Cloud SQL Auth Proxy Unix socket.

---

## Exercise 4 — Secret Manager

### Objective

List secrets created by the module, retrieve the database password, inspect IAM bindings for
the service account, and understand how secrets are injected into the container.

### Step 4.1 — List Secrets for This Deployment

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~crapp" \
  --format="table(name, createTime, replication.automatic)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | select(.name | test("crapp")) | {name, createTime}'
```

**Expected result:** At minimum a database password secret appears (`*-db-password`).

### Step 4.2 — Retrieve the Database Password

**gcloud:**
```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 --decode
```

**Expected result:** The database password is returned (a random 32-character string).

### Step 4.3 — View Secret IAM Bindings

**gcloud:**
```bash
gcloud secrets get-iam-policy "${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}:getIamPolicy" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.bindings'
```

**Expected result:** The Cloud Run service account has `roles/secretmanager.secretAccessor`
binding on the database password secret.

### Step 4.4 — Inspect Secret Volume Mount in Service

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.volumes)"
```

**Expected result:** Secret volumes appear referencing the Secret Manager secrets, mounted
as environment variables or volume files in the container.

### Step 4.5 — List Secret Versions

```bash
gcloud secrets versions list \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}" \
  --format="table(name, state, createTime)"
```

**Expected result:** One or more secret versions with state `ENABLED`.

---

## Exercise 5 — Networking

### Objective

Inspect the VPC egress configuration, verify Direct VPC Egress or Serverless VPC Access
connector, and understand private networking for Cloud SQL and NFS connectivity.

### Step 5.1 — View VPC Egress Configuration

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="json" \
  | jq '.spec.template.metadata.annotations | {
      egress: .["run.googleapis.com/vpc-access-egress"],
      network: .["run.googleapis.com/network-interfaces"],
      env: .["run.googleapis.com/execution-environment"]
    }'
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.template.vpcAccess'
```

**Expected result:** VPC egress shows `PRIVATE_RANGES_ONLY` (or `ALL_TRAFFIC`) and the
network interface configuration for Direct VPC Egress.

### Step 5.2 — List Serverless VPC Access Connectors (if applicable)

**gcloud:**
```bash
gcloud compute networks vpc-access connectors list \
  --region="${REGION}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://vpcaccess.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/connectors" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.connectors[] | {name, state, network, ipCidrRange}'
```

**Expected result:** A connector appears if the deployment uses Serverless VPC Access, or the
response is empty if Direct VPC Egress is used (the newer approach).

### Step 5.3 — Verify Private Network Connectivity

```bash
# Test the database endpoint (via Auth Proxy)
curl -s "${SERVICE_URL}/db"
```

**Expected result:** JSON response confirming successful PostgreSQL database connection via the
Cloud SQL Auth Proxy Unix socket (`/cloudsql/...`).

### Step 5.4 — View VPC Networks and Subnets

**gcloud:**
```bash
gcloud compute networks list \
  --project="${PROJECT}" \
  --filter="description:managed-by=services-gcp"
```

```bash
gcloud compute networks subnets list \
  --project="${PROJECT}" \
  --filter="description:managed-by=services-gcp" \
  --format="table(name, region, ipCidrRange, network)"
```

**Expected result:** A VPC network managed by `Services_GCP` appears with subnets in the
deployed region.

### Step 5.5 — Check Firewall Rules

**gcloud:**
```bash
gcloud compute firewall-rules list \
  --project="${PROJECT}" \
  --format="table(name, direction, sourceRanges, targetTags, allowed)"
```

**Expected result:** Firewall rules allowing Cloud Run (via VPC egress tags) to reach Cloud
SQL on port 5432 and NFS on port 2049.

---

## Exercise 6 — Cloud Logging

### Objective

Query structured Cloud Run logs via Cloud Logging, filter by severity and resource labels, and
view HTTP request logs.

### Step 6.1 — View Recent Cloud Run Logs

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

### Step 6.2 — Filter for Error Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=20
```

In the Cloud Console Log Explorer:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
severity>=ERROR
```

**Expected result:** Under normal operation, no error entries appear.

### Step 6.3 — View HTTP Request Logs

In the Cloud Console Log Explorer:
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
   AND httpRequest.status>=400" \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** HTTP request log entries with method, path, response code, latency, and
revision name.

### Step 6.4 — Stream Live Logs

```bash
gcloud beta run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

In another terminal, generate traffic:
```bash
for i in {1..5}; do
  curl -s "${SERVICE_URL}/healthz"
done
```

**Expected result:** Log entries stream in real time showing each incoming request.

### Step 6.5 — View Cloud SQL Auth Proxy Logs

In the Cloud Console Log Explorer:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"cloud-sql-proxy|pq:"
```

**Expected result:** Auth Proxy startup and connection establishment messages from the sidecar.

---

## Exercise 7 — Cloud Monitoring

### Objective

Explore Cloud Monitoring metrics for the Cloud Run service, inspect the uptime check, view
request latency percentiles, and verify alert policies.

### Step 7.1 — View Request Metrics

Navigate to Cloud Monitoring Metrics Explorer:
```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

**REST API (MQL — request count by response code):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision | metric 'run.googleapis.com/request_count' | filter resource.service_name = '${SERVICE}' | group_by [metric.response_code_class], sum(val()) | within 1h\"
  }" | jq '.timeSeriesData[] | {labels: .labelValues, count: .pointData[-1].values[0].int64Value}'
```

### Step 7.2 — View Request Latency (P99)

**REST API (MQL — P99 latency):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision | metric 'run.googleapis.com/request_latencies' | filter resource.service_name = '${SERVICE}' | align delta(1m) | every 1m | percentile(99) | within 1h\"
  }" | jq '.timeSeriesData[].pointData[-1].values[0].distributionValue'
```

**Expected result:** P99 latency values for requests in the last hour.

### Step 7.3 — Check the Uptime Check

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
  | jq '.uptimeCheckConfigs[] | {displayName, period, httpCheck, selectedRegions}'
```

**Expected result:** An uptime check probing the service URL from multiple global locations,
with `period = 60s`.

### Step 7.4 — View Instance Count Metric

Generate load and observe scaling:

```bash
for i in {1..50}; do
  curl -s "${SERVICE_URL}/healthz" &
done
wait
```

**REST API (MQL — instance count):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision | metric 'run.googleapis.com/container/instance_count' | filter resource.service_name = '${SERVICE}' | group_by [metric.state], mean(val()) | within 10m\"
  }" | jq '.timeSeriesData[] | {state: .labelValues[0].stringValue, count: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** Instance count rises from 0 to 1 as requests arrive.

### Step 7.5 — Review Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --format="table(displayName, enabled, conditions[0].displayName)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.alertPolicies[] | {displayName, enabled: .enabled}'
```

**Expected result:** Alert policies for CPU and memory utilisation with email notification
channels configured for `support_users`.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `App_CloudRun` deployment. This removes
the Cloud Run service, all revisions, Cloud SQL database and user, GCS bucket, NFS Filestore,
Secret Manager secrets, Cloud Run Jobs, uptime checks, and alert policies.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" --quiet

# Delete the database password secret
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# List and delete Cloud Run Jobs
gcloud run jobs list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" | \
  xargs -I{} gcloud run jobs delete {} \
    --region="${REGION}" \
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
| `application_name` | string | `crapp` | Base name for Cloud Run service and resources |
| `application_version` | string | `1.0.0` | Container image tag |
| `container_image_source` | string | `custom` | `custom` (Cloud Build) or `prebuilt` (existing image) |
| `min_instance_count` | number | `0` | Scale-to-zero (set to `1` to eliminate cold starts) |
| `max_instance_count` | number | `1` | Maximum instances (cost ceiling) |
| `database_type` | string | `POSTGRES` | `POSTGRES`, `MYSQL`, or `NONE` |
| `application_database_name` | string | `crappdb` | PostgreSQL database name |
| `application_database_user` | string | `crappuser` | PostgreSQL user |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore at `/mnt/nfs` |
| `enable_redis` | bool | `true` | Inject `REDIS_HOST`/`REDIS_PORT` env vars |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | `ALL_TRAFFIC` or `PRIVATE_RANGES_ONLY` |
| `ingress_settings` | string | `all` | `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `enable_cloud_armor` | bool | `false` | Cloud Armor WAF + Global HTTPS LB |
| `enable_iap` | bool | `false` | Identity-Aware Proxy |
| `tenant_deployment_id` | string | `demo` | Tenant identifier in resource names |
| `support_users` | list | `[]` | Email addresses for monitoring alerts |

### Useful Commands

```bash
# Get service URL
gcloud run services describe ${SERVICE} \
  --region=${REGION} --project=${PROJECT} \
  --format="value(status.url)"

# List revisions
gcloud run revisions list \
  --service=${SERVICE} --region=${REGION} --project=${PROJECT}

# Stream live logs
gcloud beta run services logs tail ${SERVICE} \
  --region=${REGION} --project=${PROJECT}

# Access DB password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" --project=${PROJECT}

# List Cloud Run Jobs
gcloud run jobs list --project=${PROJECT} --region=${REGION}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# View request metrics
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com" --project=${PROJECT}
```

### Further Reading

- [Cloud Run v2 documentation](https://cloud.google.com/run/docs)
- [Direct VPC Egress](https://cloud.google.com/run/docs/configuring/vpc-direct-vpc)
- [Cloud SQL Auth Proxy for Cloud Run](https://cloud.google.com/sql/docs/postgres/connect-run)
- [Secret Manager with Cloud Run](https://cloud.google.com/run/docs/configuring/secrets)
- [Cloud Run auto-scaling](https://cloud.google.com/run/docs/about-instance-autoscaling)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Cloud Logging for Cloud Run](https://cloud.google.com/run/docs/logging)
