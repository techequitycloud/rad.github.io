# Metabase on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Metabase_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Metabase is an open-source business intelligence platform that enables non-technical users to query and visualize data without SQL. This lab deploys Metabase on Google Cloud Run backed by Cloud SQL PostgreSQL 15. Cloud Run provides serverless scaling; an automated `db-init` Cloud Run Job initializes the Metabase PostgreSQL schema before first boot.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- `db-init` Cloud Run Job (creates Metabase database schema before first boot)
- Secret Manager secrets (database credentials)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Complete the Metabase setup wizard
- Connect data sources (BigQuery, Cloud SQL, PostgreSQL, etc.)
- Create questions, dashboards, and collections
- Configure users and permissions
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
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"metabase"` | Base name for Cloud Run service and resources |
| `application_version` | No | `"v0.51.3"` | Metabase container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance (minimum 1 vCPU for JVM) |
| `memory_limit` | No | `"4Gi"` | Memory per Cloud Run instance (minimum 2 Gi for JVM) |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances. Set `1` for production (eliminates 60–120s cold starts) |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances |
| `db_name` | No | `"metabase"` | PostgreSQL database name |
| `db_user` | No | `"metabase"` | PostgreSQL database username |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress routing |
| `environment_variables` | No | `{}` | Metabase MB_* configuration variables |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| `db-init` Cloud Run Job execution | 2–3 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **17–29 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Metabase Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~metabase" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Metabase URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access Metabase [MANUAL]

### Step 2.1 — Wait for Metabase to Start

Metabase JVM startup takes 60–120 seconds. Monitor the health endpoint:

```bash
# Poll until Metabase is ready
until curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/health | grep -q "200"; do
  echo "Waiting for Metabase..."; sleep 10
done
echo "Metabase is ready"
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

### Step 2.2 — Check the Health Endpoint

```bash
curl -s ${SERVICE_URL}/api/health | jq .
```

**Expected result:**
```json
{"status": "ok"}
```

### Step 2.3 — Inspect Cloud Run Service Details

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with container image, resource limits (2 vCPU, 4 Gi), and VPC connector details.

---

## Phase 3 — Complete the Setup Wizard [MANUAL]

### Step 3.1 — Access the Setup Wizard

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The Metabase setup wizard appears. On subsequent visits after setup, the login page is shown.

### Step 3.2 — Complete Initial Setup

1. **Add your data**: Select your language and click **Let's get started**.
2. **Admin account**: Enter your name, email, and a strong password.
3. **Add a data source** (optional — skip to connect later):
   - Click **Add your data** or **I'll add my data later**.
4. **Usage data**: Choose whether to allow Metabase to collect anonymized usage data.
5. Click **Take me to Metabase**.

**Expected result:** You are redirected to the Metabase home screen with your first collection empty.

### Step 3.3 — Retrieve Database Password (if needed)

```bash
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~metabase.*password" \
  --format="value(name)" \
  --limit=1)
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=labels.app%3Dmetabase"
```

---

## Phase 4 — Connect Data Sources [MANUAL]

### Step 4.1 — Connect to BigQuery

1. In Metabase, navigate to **Admin** (gear icon) > **Databases** > **Add a database**.
2. Select **BigQuery** as the database type.
3. Configure:
   - **Project ID**: Your GCP project ID
   - **Dataset filters**: Optionally restrict to specific datasets
   - **Service Account JSON**: Paste a service account key JSON, or use the Cloud Run SA via Workload Identity (recommended)
4. Click **Save**.

**gcloud — grant Cloud Run SA BigQuery access:**
```bash
export CR_SA=$(gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(spec.template.spec.serviceAccountName)")
gcloud projects add-iam-policy-binding ${PROJECT} \
  --member="serviceAccount:${CR_SA}" \
  --role="roles/bigquery.dataViewer"
```

**Expected result:** After saving, Metabase syncs BigQuery metadata. Tables appear in the Data Browser within 2–5 minutes.

### Step 4.2 — Connect to Cloud SQL PostgreSQL

1. Navigate to **Admin > Databases** > **Add a database**.
2. Select **PostgreSQL**.
3. Configure:
   - **Host**: Cloud SQL internal IP (from the `Services_GCP` stack) or the Auth Proxy socket path
   - **Port**: `5432`
   - **Database**: Your database name
   - **Username**: Your PostgreSQL user
   - **Password**: Retrieved from Secret Manager
4. Click **Save**.

**gcloud — retrieve a Cloud SQL connection string:**
```bash
gcloud sql instances describe \
  $(gcloud sql instances list --project=${PROJECT} --format="value(name)" --limit=1) \
  --project=${PROJECT} \
  --format="value(ipAddresses[0].ipAddress)"
```

### Step 4.3 — Verify Data Source Connection

```bash
# List connected databases via Metabase API
curl -s -u admin@example.com:yourpassword \
  ${SERVICE_URL}/api/database \
  | jq '.[].name'
```

**Expected result:** Your connected databases are listed. Metabase will begin scanning table metadata in the background.

---

## Phase 5 — Create Questions and Dashboards [MANUAL]

### Step 5.1 — Create a New Question

1. Click **+ New** > **Question**.
2. Select a data source and table.
3. Use the GUI query builder to filter, group, and summarize data without SQL.
4. Click **Visualize** to see the results.
5. Click **Save** to save the question to a collection.

**Expected result:** The question appears in your collection with a visualization type automatically selected.

### Step 5.2 — Write a Native SQL Query

1. Click **+ New** > **Question** > **Native query**.
2. Select your data source.
3. Write a SQL query:
   ```sql
   SELECT date_trunc('day', created_at) as day, count(*) as events
   FROM my_table
   WHERE created_at > now() - interval '30 days'
   GROUP BY 1 ORDER BY 1
   ```
4. Click **Run query** and then **Visualize**.

### Step 5.3 — Build a Dashboard

1. Click **+ New** > **Dashboard**.
2. Click **Add a question** to add saved questions.
3. Resize and arrange cards on the dashboard canvas.
4. Add text, images, or filter widgets.
5. Click **Save**.

**Expected result:** A shareable dashboard with multiple visualizations from your data sources.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Metabase Application Logs

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

**Expected result:** Metabase JVM startup logs appear, including `Metabase Initialization COMPLETE` after the 60–120 second startup sequence.

### Step 6.2 — Filter for JVM Warnings

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Under normal operation, only informational logs appear.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — Examine Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

### Step 7.2 — Check Scaling

With `min_instance_count = 0`, Metabase scales to zero when idle:

```bash
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Instance count drops to 0 after idle timeout. The next request triggers a cold start (60–120 seconds for JVM initialization).

**Production recommendation:** Set `min_instance_count = 1` to keep the JVM warm and eliminate cold start latency.

### Step 7.3 — Verify Fixed Environment Variables

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | startswith("MB_JETTY") or startswith("JAVA_"))'
```

**Expected result:** `MB_JETTY_PORT = "3000"` and `JAVA_TIMEZONE = "UTC"` are present — injected automatically by `Metabase_Common`.

### Step 7.4 — Review the Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `/api/health` shows **Passing**.

---

## Phase 8 — Configure Metabase [MANUAL]

### Step 8.1 — Set Up Email Notifications

Configure SMTP in the Metabase Admin panel:

1. Navigate to **Admin** > **Email**.
2. Or, configure via `environment_variables` in the RAD UI:

```hcl
environment_variables = {
  MB_EMAIL_SMTP_HOST     = "smtp.sendgrid.net"
  MB_EMAIL_SMTP_PORT     = "587"
  MB_EMAIL_FROM_ADDRESS  = "metabase@example.com"
}
secret_environment_variables = {
  MB_EMAIL_SMTP_PASSWORD = "metabase-smtp-password"
}
```

### Step 8.2 — Configure User Authentication

Metabase supports SSO via Google, SAML, or LDAP (Enterprise Edition). For Google OAuth:

1. Navigate to **Admin > Authentication > Google**.
2. Enter your Google Client ID.
3. Configure allowed domains.

### Step 8.3 — Enable Public Sharing

To allow dashboard public sharing:

1. Navigate to **Admin > Public sharing**.
2. Enable **Enable public sharing**.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the Metabase application database (all questions, dashboards, users, collections). Export your data model before undeploying: **Admin > Serialization** (Metabase Pro/Enterprise) or export individual questions as CSV/JSON.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| `db-init` Cloud Run Job (schema init) | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Wait for Metabase JVM startup | 2 | No |
| Complete setup wizard (admin account, language) | 3 | No |
| Connect BigQuery data source | 4 | No |
| Connect Cloud SQL PostgreSQL data source | 4 | No |
| Create questions and dashboards | 5 | No |
| Review Cloud Logging | 6 | No |
| Examine revisions and scaling | 7 | No |
| Configure SMTP and authentication | 8 | No |
| Undeploy infrastructure | 9 | Yes |
