---
title: "Superset on Cloud Run — Lab Guide"
sidebar_label: "Superset CloudRun"
---

# Superset on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Superset_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Apache Superset is an open-source data visualisation and business intelligence platform. This lab deploys Superset on Google Cloud Run backed by Cloud SQL PostgreSQL 15, with an auto-generated `SUPERSET_SECRET_KEY` and a two-phase init pipeline that creates the database and bootstraps the application schema and admin user.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database (`superset_db`), and user (`superset_user`)
- `SUPERSET_SECRET_KEY` (50-char random) in Secret Manager
- Two-phase init: `db-init` (database creation) + `app-init` (migrations + admin user)
- Artifact Registry repository and Cloud Build image pipeline (psycopg2-binary pre-installed)
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks targeting `/health`
- GCS `superset-data` bucket

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Log in as the initial admin user
- Change the admin password
- Connect data sources and create datasets
- Build charts and dashboards
- Configure email alerts and reports
- Review logs in Cloud Logging

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project.
3. The following APIs enabled:
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI.
6. (Optional) A data source to connect — BigQuery, PostgreSQL, or any SQLAlchemy-compatible database.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"latest"` | Superset image version |
| `deploy_application` | No | `true` | Set `false` for infrastructure-only |
| `cpu_limit` | No | `"2000m"` | CPU per instance |
| `memory_limit` | No | `"2Gi"` | Memory per instance |
| `timeout_seconds` | No | `600` | Max request duration (extended for long queries) |
| `min_instance_count` | No | `1` | Minimum instances |
| `max_instance_count` | No | `5` | Maximum instances |
| `db_name` | No | `"superset_db"` | PostgreSQL database name |
| `db_user` | No | `"superset_user"` | PostgreSQL user |
| `enable_redis` | No | `false` | Enable Redis (recommended for multi-user production) |
| `redis_host` | No | `""` | Redis hostname/IP |
| `redis_port` | No | `6379` | Redis port (number) |
| `support_users` | No | `[]` | Monitoring alert emails |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| SUPERSET_SECRET_KEY provisioning | 1–2 min |
| `db-init` job (database creation) | 2–3 min |
| Container image build (Cloud Build + psycopg2) | 8–15 min |
| `app-init` job (migration + admin creation) | 3–5 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **24–41 min** |

> **Note:** The `app-init` job timeout is 30 minutes. Schema migrations on the first deploy may take several minutes.

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Superset Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~superset" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Superset URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm Superset is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health
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
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

**Expected result:** HTTP `200`. The `/health` endpoint confirms Gunicorn workers are ready.

### Step 2.2 — Verify Secret Key is Injected

```bash
gcloud secrets list --project=${PROJECT} --filter="name~superset-secret-key"
```

**gcloud — view secret metadata:**
```bash
gcloud secrets describe \
  $(gcloud secrets list --project=${PROJECT} --filter="name~superset-secret-key" --format="value(name)" --limit=1) \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3A~superset"
```

**Expected result:** A secret named `{prefix}-secret-key` exists. The value is 50 characters, injected as `SUPERSET_SECRET_KEY` into the Cloud Run service.

---

## Phase 3 — Log In as Admin [MANUAL]

### Step 3.1 — Retrieve Admin Credentials

The `app-init` job creates an initial admin account. Retrieve the credentials from the job execution logs:

```bash
# List Superset-related Cloud Run Jobs
gcloud run jobs list \
  --project=${PROJECT} \
  --region=${REGION} \
  --filter="name~superset"

# View app-init job execution logs
gcloud logging read \
  'resource.type="cloud_run_job" AND labels."run.googleapis.com/job_name"~"app-init"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs"
```

**Expected result:** The app-init logs show the admin username and that the user was created successfully. Default credentials are set in the init script (commonly `admin` / `admin` — check the `app-init.sh` script in `Superset_Common/scripts/`).

### Step 3.2 — Log In to Superset

Navigate to `${SERVICE_URL}` and log in with the admin credentials.

**Expected result:** The Superset home page loads with the toolbar and navigation menu.

### Step 3.3 — Change the Admin Password

1. Click the user icon (top-right corner) > **Profile**.
2. Click **Reset my password** or navigate to **Security** > **List Users**.
3. Set a strong password.

**Expected result:** Password is updated. You remain logged in.

---

## Phase 4 — Connect a Data Source [MANUAL]

### Step 4.1 — Add a Database Connection

1. Click **Settings** (gear icon, top-right) > **Database Connections**.
2. Click **+ Database**.
3. Select a database type:
   - **BigQuery**: Use a service account JSON key.
   - **PostgreSQL**: Enter hostname, port, database, username, password.
   - **SQLite**: Enter the file path (for testing).
4. Click **Test connection** to verify connectivity.
5. Click **Connect**.

**Expected result:** The database connection is saved and appears in the list.

### Step 4.2 — Create a Dataset

1. Click **Data** > **Datasets** > **+ Dataset**.
2. Select the database and schema from the dropdowns.
3. Select a table.
4. Click **Create dataset and create chart**.

**Expected result:** The dataset is created and the chart editor opens automatically.

---

## Phase 5 — Create Charts and a Dashboard [MANUAL]

### Step 5.1 — Create a Bar Chart

1. In the chart editor, select **Bar Chart** as the chart type.
2. Set **Dimensions** (X-axis) and **Metrics** (Y-axis) from the dataset columns.
3. Add a **Time filter** if the dataset contains timestamp data.
4. Click **Update chart**.
5. Click **Save** and name the chart.

**Expected result:** A bar chart renders with your data.

### Step 5.2 — Create a Line Chart

1. Click **Charts** > **+ Chart**.
2. Select your dataset and choose **Line Chart**.
3. Configure the time column, metrics, and granularity.
4. Save the chart.

### Step 5.3 — Build a Dashboard

1. Click **Dashboards** > **+ Dashboard**.
2. Click **Edit dashboard** to open the editor.
3. Drag charts from the right panel onto the canvas.
4. Resize and position charts.
5. Add **Text** and **Divider** components for labels.
6. Click **Save**.

**Expected result:** The dashboard is saved and viewable without edit mode.

---

## Phase 6 — Configure Alerts and Reports [MANUAL]

### Step 6.1 — Explore Alerts

1. Click **Settings** > **Alerts and Reports**.
2. Click **+ Alert** to create a new alert.
3. Select a chart or dashboard, set conditions (e.g., metric > threshold), and configure the notification channel.

> **Note:** Email alerts require SMTP configuration via `environment_variables`.

### Step 6.2 — Schedule a Dashboard Report

1. Click **+ Report** to schedule a periodic report.
2. Select a dashboard and set the schedule (e.g., daily at 08:00).
3. Choose recipients.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Superset Application Logs

In **Logging > Logs Explorer**:

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
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Gunicorn access logs and Flask application logs appear. Slow SQL queries produce entries in the log.

### Step 7.2 — Check Startup Probe Behaviour

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"Booting worker"
```

**Expected result:** Gunicorn worker boot messages. The startup probe (`/health`) allows up to 60 seconds initial delay and 12 retries — Superset has up to 180 seconds total startup tolerance.

### Step 7.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks**.

**Expected result:** A preconfigured uptime check polling `${SERVICE_URL}/health` shows **Passing**.

---

## Phase 8 — Cloud Run Scaling [MANUAL]

### Step 8.1 — Check Instance Count

```bash
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** With `min_instance_count=1`, at least one instance is always running.

### Step 8.2 — Simulate Load

```bash
# Send concurrent requests
for i in $(seq 1 20); do curl -s -o /dev/null ${SERVICE_URL}/health & done; wait
```

**Expected result:** Cloud Run scales up instances to handle the load, up to `max_instance_count=5`.

---

## Phase 9 — Delete [AUTOMATED]

Return to the RAD UI and click **Delete**.

**Approximate delete duration:** 12–18 minutes.

> **Warning:** Deleting permanently deletes all resources including the Superset metadata database (dashboards, charts, datasets). Export dashboards via **Settings > Export all** before deleting.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| SUPERSET_SECRET_KEY in Secret Manager | 1 | Yes |
| db-init and app-init jobs | 1 | Yes |
| Confirm Superset reachable | 2 | No |
| Verify secret key injection | 2 | No |
| Retrieve admin credentials | 3 | No |
| Log in and change password | 3 | No |
| Connect a data source | 4 | No |
| Create datasets | 4 | No |
| Create bar and line charts | 5 | No |
| Build a dashboard | 5 | No |
| Configure alerts and reports | 6 | No |
| Review Cloud Logging | 7 | No |
| Check scaling behaviour | 8 | No |
| Delete infrastructure | 9 | Yes |
