---
title: "NocoDB on Cloud Run — Lab Guide"
sidebar_label: "NocoDB CloudRun Lab"
---

# NocoDB on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/NocoDB_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

NocoDB is an open-source no-code database platform — an Airtable alternative — that transforms any PostgreSQL or MySQL database into a collaborative spreadsheet with a no-code interface, REST and GraphQL APIs, and built-in automations. This lab deploys NocoDB on Google Cloud Run backed by Cloud SQL PostgreSQL 15, GCS storage for file uploads, and serverless auto-scaling to zero.

### What the Module Automates

- Cloud Run service with Cloud SQL private IP TCP connection
- Cloud SQL PostgreSQL 15 instance, database, and user
- GCS bucket for NocoDB file uploads (`GCS_BUCKET_NAME` injected automatically)
- Secret Manager secrets (database password, NC_DB_* env var aliases)
- Artifact Registry repository and Cloud Build custom image pipeline (NC_DB_* mapping)
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks targeting `/api/v1/health`

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Complete the NocoDB account setup
- Create your first base (database) and tables
- Explore the REST and GraphQL API
- Configure external database connections
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL instance).
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
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"nocodb"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"latest"` | NocoDB container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances |
| `cpu_limit` | No | `"1000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"1Gi"` | Memory per Cloud Run instance |
| `application_database_name` | No | `"nocodb"` | PostgreSQL database name |
| `application_database_user` | No | `"nocodb"` | PostgreSQL database username |
| `database_type` | No | `"POSTGRES_15"` | Cloud SQL engine (`POSTGRES_15` or `MYSQL_8_0`) |
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
| Artifact Registry image build (Cloud Build, custom wrapper) | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **15–26 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the NocoDB Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~nocodb" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "NocoDB URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm NocoDB is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/v1/health
```

**Expected result:** HTTP `200` with `{"status":"ok"}`. If you see `503`, Cloud Run may still be starting — wait 30 seconds and retry.

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image, resource limits, and VPC connector details.

---

## Phase 3 — Set Up NocoDB [MANUAL]

### Step 3.1 — Open NocoDB in a Browser

Navigate to `${SERVICE_URL}` in your browser.

**Expected result:** NocoDB displays a sign-up page for the initial admin account.

### Step 3.2 — Create the Admin Account

1. Enter your **email address** and a **strong password**.
2. Click **Sign Up**.
3. NocoDB creates the admin account and redirects to the Home dashboard.

**Expected result:** You are logged into NocoDB. The dashboard shows "No bases yet."

### Step 3.3 — Retrieve Database Credentials from Secret Manager

```bash
# List NocoDB-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~nocodb"

# Retrieve database password
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~nocodb" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

**Expected result:** The database password is returned as a plain-text string.

---

## Phase 4 — Explore NocoDB [MANUAL]

### Step 4.1 — Create a Base

1. On the Home dashboard, click **New Base**.
2. Enter a name (e.g., "My CRM").
3. Click **Create Base**.

**Expected result:** The base is created and opens with an empty table called "Table-1".

### Step 4.2 — Add Fields and Records

1. Click on the default "Name" column to rename it (e.g., "Company").
2. Click **+** to add a new field — select **Single line text**, name it "Contact".
3. Click **+** to add another field — select **Email**, name it "Email".
4. Add a few rows of sample data.

**Expected result:** The table displays your sample records in a spreadsheet-like grid.

### Step 4.3 — Explore Views

1. Click **+ Add View** in the left sidebar.
2. Select **Gallery**, **Kanban**, or **Calendar** view type.
3. The same records appear in the new view layout.

**Expected result:** Your data is displayed in the selected view format.

### Step 4.4 — Access the REST API

NocoDB automatically generates a REST API for every table.

```bash
# Get an API token
export NOCODB_API_TOKEN=$(curl -s -X POST "${SERVICE_URL}/api/v1/auth/user/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | jq -r '.token')

# List all bases
curl -s -H "xc-auth: ${NOCODB_API_TOKEN}" \
  "${SERVICE_URL}/api/v1/db/meta/projects/" | jq '.list[].title'
```

**Expected result:** Your base name(s) are returned in JSON format.

---

## Phase 5 — API & Automations [MANUAL]

### Step 5.1 — Explore the Swagger API Documentation

Navigate to `${SERVICE_URL}/api/v1/swagger` in a browser.

**Expected result:** The Swagger UI displays all NocoDB REST API endpoints, grouped by resource type.

### Step 5.2 — Connect an External Database (Optional)

NocoDB can connect to existing databases:

1. In NocoDB, click **+** to create a new base.
2. Select **Connect to External Database**.
3. Enter the PostgreSQL connection details for an existing database.
4. NocoDB introspects the schema and creates virtual tables.

**Expected result:** NocoDB displays tables from the external database without migrating data.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View NocoDB Application Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** NocoDB startup logs including the database connection confirmation.

### Step 6.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, no warnings appear.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions. The most recent revision serves 100% of traffic.

### Step 7.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check shows **Passing** from multiple global locations. The check targets `/api/v1/health`.

---

## Phase 8 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database and GCS bucket contents. Export your NocoDB data before undeploying: NocoDB UI > Team & Settings > Export.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| GCS uploads bucket | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC connector and IAM | 1 | Yes |
| Container image build (Cloud Build, NC_DB_* mapping) | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Confirm NocoDB is reachable | 2 | No |
| NocoDB admin account setup | 3 | No |
| Retrieve database credentials from Secret Manager | 3 | No |
| Create bases and tables | 4 | No |
| Explore REST API | 4–5 | No |
| Review Cloud Logging | 6 | No |
| Examine revisions and uptime checks | 7 | No |
| Undeploy infrastructure | 8 | Yes |
