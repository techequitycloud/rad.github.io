---
title: "Twenty CRM on Cloud Run — Lab Guide"
sidebar_label: "Twenty CloudRun Lab"
---

# Twenty CRM on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Twenty_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Twenty CRM is an open-source customer relationship management platform with 25,000+ GitHub stars, built as a modern alternative to Salesforce and HubSpot. This lab deploys Twenty on Google Cloud Run backed by Cloud SQL PostgreSQL 15, Secret Manager for `APP_SECRET` management, and automated database initialisation. Cloud Run provides serverless auto-scaling and eliminates infrastructure management overhead.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets (`APP_SECRET`, DB password, root password)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Complete the Twenty CRM first-run workspace setup
- Create contacts, companies, and pipeline opportunities
- Explore custom objects and the data model editor
- Test the REST and GraphQL APIs
- Review logs in Cloud Logging and metrics in Cloud Monitoring
- Examine Cloud Run revisions and scaling behaviour

---

## CLI and REST API Overview

This lab uses two primary tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Call the Twenty REST and GraphQL APIs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC and Cloud SQL instance).
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `vpcaccess.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g., `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"twenty"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"latest"` | Twenty container image version. Pin for production (e.g., `"0.50.0"`) |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `cpu_limit` | No | `"1000m"` | CPU per Cloud Run instance. 2 vCPU recommended for production |
| `memory_limit` | No | `"1Gi"` | Memory per Cloud Run instance. 2 Gi recommended for production |
| `min_instance_count` | No | `1` | Minimum instances (1 = always warm) |
| `max_instance_count` | No | `3` | Maximum concurrent instances |
| `db_name` | No | `"twenty"` | PostgreSQL database name |
| `db_user` | No | `"twenty"` | PostgreSQL database username |
| `enable_redis` | No | `false` | Enable Redis for bull-mq job processing |
| `redis_host` | No | `""` | Redis host (required when `enable_redis = true`) |
| `enable_gcs_storage` | No | `false` | Enable GCS for persistent file attachments |
| `environment_variables` | No | `{}` | Set `SERVER_URL` and `FRONT_BASE_URL` to the public URL |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress routing |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Database initialisation job (db-init) | 1–2 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **16–28 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Twenty Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~twenty" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the APP_SECRET secret
export APP_SECRET_NAME=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~app-secret" \
  --format="value(name)" \
  --limit=1)

echo "Service URL: ${SERVICE_URL}"
echo "Service name: ${SERVICE}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the Service URL

```bash
echo "Twenty CRM URL: ${SERVICE_URL}"
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

**Expected result:** A URL in the format `https://<hash>-<hash>.a.run.app`.

### Step 2.2 — Confirm Twenty is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health
```

**Expected result:** HTTP `200`. If you see `503`, the Cloud Run service is still starting — wait 30 seconds and retry.

### Step 2.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image, resource limits, and VPC connector details.

---

## Phase 3 — Set Up Twenty CRM [MANUAL]

### Step 3.1 — Access the Setup Page

Open a browser and navigate to:

```
${SERVICE_URL}
```

Twenty prompts for workspace creation on first visit.

**Expected result:** The Twenty workspace setup page appears with fields for workspace name and admin account.

### Step 3.2 — Retrieve APP_SECRET from Secret Manager

The `APP_SECRET` is used for JWT signing. You can verify it was generated correctly:

```bash
# List Twenty-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~twenty"

# Retrieve APP_SECRET value
gcloud secrets versions access latest \
  --secret="${APP_SECRET_NAME}" \
  --project=${PROJECT}
```

**gcloud — list all secrets for this deployment:**
```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~twenty" \
  --format="table(name, createTime)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name~twenty"
```

**Expected result:** Two or more secrets listed: the app secret and the database password.

### Step 3.3 — Create a Workspace

1. Enter a **workspace name** (e.g., "Acme Corp").
2. Enter your **admin email address** and **password**.
3. Click **Create workspace**.
4. Twenty redirects to the main CRM dashboard.

**Expected result:** The Twenty CRM dashboard is visible with empty contacts, companies, and deals sections.

---

## Phase 4 — Explore Twenty CRM Features [MANUAL]

### Step 4.1 — Create a Contact

1. In the left sidebar, click **People**.
2. Click **+ New** (top-right button).
3. Enter a first name, last name, and email address.
4. Click **Save**.

**Expected result:** The contact appears in the People list with the details you entered.

### Step 4.2 — Create a Company

1. Click **Companies** in the left sidebar.
2. Click **+ New**.
3. Enter a company name and domain (e.g., "acme.com").
4. Associate the contact created in Step 4.1 with this company.
5. Click **Save**.

**Expected result:** The company appears with the linked contact in the relationship panel.

### Step 4.3 — Create an Opportunity

1. Click **Opportunities** (or **Pipeline**) in the left sidebar.
2. Click **+ New**.
3. Set a name, amount, and stage (e.g., "Acme Deal — $5,000 — Qualified").
4. Associate the opportunity with the company from Step 4.2.
5. Click **Save**.

**Expected result:** The opportunity appears in the pipeline view at the correct stage.

### Step 4.4 — Explore the Data Model Editor

1. Navigate to **Settings** > **Data model**.
2. Review the standard objects: People, Companies, Opportunities, Activities.
3. Click **+ Add a custom object** to explore custom object creation.

**Expected result:** The data model editor shows the standard CRM schema. Custom object fields can be added and linked using Twenty's flexible metadata system.

---

## Phase 5 — API Exploration [MANUAL]

### Step 5.1 — Test the Health Endpoint

```bash
curl -s ${SERVICE_URL}/health | jq .
```

**Expected result:** JSON response indicating server status and database connectivity.

### Step 5.2 — Obtain an API Token

Twenty uses JWT-based authentication. After logging in via the UI, an API token can be retrieved from Settings > API.

1. Navigate to **Settings** > **API**.
2. Click **+ Create token** and give it a name.
3. Copy the API key.

```bash
export TWENTY_API_KEY="your-api-key-here"
```

### Step 5.3 — Query the REST API

```bash
# List all people
curl -s \
  -H "Authorization: Bearer ${TWENTY_API_KEY}" \
  "${SERVICE_URL}/api/people" | jq .
```

**Expected result:** A JSON array of people objects containing the contact created in Phase 4.

### Step 5.4 — Query the GraphQL API

Twenty exposes a GraphQL API at `/api`:

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${TWENTY_API_KEY}" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/api" \
  -d '{"query": "{ people { edges { node { id name { firstName lastName } } } } }"}' | jq .
```

**Expected result:** GraphQL response with the people list.

### Step 5.5 — Inspect Environment Variables

Verify the Twenty-specific variables are correctly injected:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | {name: .name, value: .value}'
```

**Expected result:** `MESSAGE_QUEUE_TYPE`, `STORAGE_TYPE`, and other configuration variables appear. `APP_SECRET` appears as a Secret Manager reference (not plaintext).

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Twenty Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

Use the following query to view Cloud Run Twenty logs:

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

**Expected result:** Twenty startup logs including the NestJS server bootstrap message, database migration output, and `Application is running on port 3000`.

### Step 6.2 — Filter for Errors

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
severity>=WARNING
```

**Expected result:** Under normal operation, only informational logs appear.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions with traffic percentage. The most recent revision serves 100% of traffic.

### Step 7.2 — View Traffic Splitting Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.traffic'
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.traffic'
```

**Expected result:** Traffic shows `100%` directed to the latest revision.

### Step 7.3 — Check Scaling Behaviour

```bash
# Send 10 requests
for i in $(seq 1 10); do curl -s -o /dev/null ${SERVICE_URL}/health; done

# Check current instance count
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Cloud Run maintains at least 1 instance (`min_instance_count = 1`). Under sustained load, additional instances scale up.

### Step 7.4 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check for `/health` shows **Passing** from multiple global locations.

---

## Phase 8 — Background Jobs [MANUAL]

### Step 8.1 — Inspect the Job Queue Type

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name == "MESSAGE_QUEUE_TYPE")'
```

**Expected result:** `"value": "pg-boss"` (default) or `"value": "bull-mq"` if Redis is enabled.

### Step 8.2 — View the db-init Cloud Run Job

```bash
gcloud run jobs list \
  --project=${PROJECT} \
  --region=${REGION} \
  --filter="metadata.name~db-init"
```

**Expected result:** The `db-init` job appears with its last execution status. The job should show `SUCCEEDED`.

### Step 8.3 — View Job Execution Logs

```bash
export JOB=$(gcloud run jobs list \
  --project=${PROJECT} \
  --region=${REGION} \
  --filter="metadata.name~db-init" \
  --format="value(metadata.name)" \
  --limit=1)

gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="'${JOB}'"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Database initialisation log lines showing user creation and database grant operations.

---

## Phase 9 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database. Export your Twenty data before undeploying: in the Twenty API, use the metadata export or take a database snapshot via Cloud SQL before undeploying.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

> **Note:** If the destroy fails with a serverless IPv4 address error, wait 20–30 minutes and re-run the destroy — GCP releases serverless IP addresses asynchronously after the Cloud Run service is deleted.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager (APP_SECRET, DB password) | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Database initialisation job (db-init) | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Confirm Twenty is reachable | 2 | No |
| Create workspace and admin account | 3 | No |
| Retrieve APP_SECRET from Secret Manager | 3 | No |
| Create contacts, companies, opportunities | 4 | No |
| Explore data model editor | 4 | No |
| Test REST and GraphQL APIs | 5 | No |
| Review Cloud Logging | 6 | No |
| Examine revisions and traffic splitting | 7 | No |
| Review uptime checks | 7 | No |
| Inspect background job queue | 8 | No |
| Undeploy infrastructure | 9 | Yes |
