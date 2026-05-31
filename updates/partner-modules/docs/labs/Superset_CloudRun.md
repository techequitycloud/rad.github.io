# Superset on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Superset_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Apache Superset is an open-source data visualisation and business intelligence platform. This lab deploys Superset on Google Cloud Run backed by Cloud SQL PostgreSQL 15, with a two-phase initialisation pipeline (database creation + schema migration/admin setup) and a 50-character `SUPERSET_SECRET_KEY` auto-generated in Secret Manager.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database (`superset_db`), and user (`superset_user`)
- `SUPERSET_SECRET_KEY` (50-char random) in Secret Manager
- Two-phase init: `db-init` + `app-init` (migration + admin creation)
- Artifact Registry repository and Cloud Build image pipeline (with psycopg2-binary)
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks targeting `/health`
- GCS `superset-data` bucket

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Log in as the initial admin user
- Connect data sources (BigQuery, PostgreSQL, etc.)
- Create datasets, charts, and dashboards
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
2. The `Services_GCP` module deployed in the same project.
3. The following APIs enabled:
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"latest"` | Superset image version |
| `cpu_limit` | No | `"2000m"` | CPU per instance |
| `memory_limit` | No | `"2Gi"` | Memory per instance |
| `min_instance_count` | No | `1` | Minimum instances |
| `max_instance_count` | No | `5` | Maximum instances |
| `db_name` | No | `"superset_db"` | Database name |
| `db_user` | No | `"superset_user"` | Database user |
| `timeout_seconds` | No | `600` | Max request duration |
| `enable_redis` | No | `false` | Enable Redis (recommended for production) |
| `redis_host` | No | `""` | Redis host (if `enable_redis = true`) |
| `redis_port` | No | `6379` | Redis port (number) |
| `support_users` | No | `[]` | Monitoring alert emails |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| Secret creation and db-init job | 2–3 min |
| Container image build (Cloud Build + psycopg2) | 8–15 min |
| app-init job (migration + admin) | 3–5 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **23–39 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Superset Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for the DB password |

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

**Expected result:** HTTP `200`. Superset's `/health` endpoint returns `OK`.

---

## Phase 3 — Log In as Admin [MANUAL]

### Step 3.1 — Retrieve Default Admin Credentials

The `app-init` job creates an initial admin user. Default credentials are typically set in the `app-init.sh` script (commonly `admin`/`admin`). Check the init job logs:

```bash
gcloud run jobs list --project=${PROJECT} --region=${REGION} --filter="name~superset"
```

**gcloud — view app-init execution logs:**
```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name~"app-init"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs"
```

### Step 3.2 — Log In to Superset

Navigate to `${SERVICE_URL}` and log in with the admin credentials.

**Expected result:** The Superset dashboard loads. You are logged in as the admin user.

### Step 3.3 — Change the Admin Password

1. Click the user icon (top-right) > **Profile**.
2. Navigate to **Security** > **Reset my password**.
3. Enter a new strong password.

---

## Phase 4 — Connect Data Sources [MANUAL]

### Step 4.1 — Add a Database Connection

1. Click **Settings** (top-right gear) > **Database Connections** > **+ Database**.
2. Select your database type (e.g., **BigQuery**, **PostgreSQL**, **MySQL**).
3. Enter the connection string or use the guided form.
4. Click **Test connection**.

**Expected result:** Connection test succeeds. The database appears in the connections list.

### Step 4.2 — Add a Dataset

1. Click **Data** > **Datasets** > **+ Dataset**.
2. Select the database and schema.
3. Choose a table and click **Create dataset and create chart**.

**Expected result:** The dataset is created and the chart editor opens.

---

## Phase 5 — Create Charts and Dashboards [MANUAL]

### Step 5.1 — Create a Chart

1. Select a chart type (e.g., **Bar Chart**, **Line Chart**).
2. Configure dimensions, metrics, and filters.
3. Click **Update chart**.
4. Click **Save** and give the chart a name.

### Step 5.2 — Create a Dashboard

1. Click **Dashboards** > **+ Dashboard**.
2. Click **Edit dashboard** and drag charts onto the canvas.
3. Resize and arrange charts.
4. Click **Save**.

**Expected result:** A dashboard is created with your charts.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Superset Logs

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

**Expected result:** Gunicorn access logs and SQLAlchemy query logs appear.

---

## Phase 7 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 12–18 minutes.

> **Warning:** Undeploying permanently deletes all resources. Export dashboards and charts via Superset Settings > Export before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| SUPERSET_SECRET_KEY in Secret Manager | 1 | Yes |
| db-init and app-init jobs | 1 | Yes |
| Confirm Superset reachable | 2 | No |
| Log in as admin | 3 | No |
| Change admin password | 3 | No |
| Connect data sources | 4 | No |
| Create datasets | 4 | No |
| Create charts and dashboards | 5 | No |
| Review Cloud Logging | 6 | No |
| Undeploy infrastructure | 7 | Yes |
