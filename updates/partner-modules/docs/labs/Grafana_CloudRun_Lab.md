# Grafana on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grafana_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Grafana is an open-source observability and analytics platform used for unified dashboards, alerting, and visualization of metrics, logs, and traces from any data source. This lab deploys Grafana 11.x on Google Cloud Run backed by Cloud SQL PostgreSQL 15, GCS Fuse storage, and Secret Manager. Cloud Run provides serverless auto-scaling with configurable minimum instances.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets (database credentials)
- Artifact Registry repository and Cloud Build image pipeline
- GCS storage bucket (`grafana-data`)
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Log in to Grafana using the default admin credentials
- Add data sources (Prometheus, BigQuery, Cloud Monitoring, etc.)
- Create dashboards and alerts
- Explore Grafana plugins and configuration
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
| `application_name` | No | `"grafana"` | Base name for Cloud Run service and resources |
| `application_version` | No | `"11.4.0"` | Grafana container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `cpu_limit` | No | `"1000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"2Gi"` | Memory per Cloud Run instance |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances |
| `max_instance_count` | No | `5` | Maximum Cloud Run instances |
| `db_name` | No | `"grafana"` | PostgreSQL database name |
| `db_user` | No | `"grafana"` | PostgreSQL database username |
| `enable_nfs` | No | `false` | Mount NFS for shared plugins and dashboards |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress routing |
| `environment_variables` | No | `{}` | Grafana GF_* configuration variables |
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
| Cloud Run service deployment | 2–4 min |
| **Total** | **15–26 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Grafana Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~grafana" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Grafana URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access Grafana [MANUAL]

### Step 2.1 — Confirm Grafana is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/health
```

**Expected result:** HTTP `200` with body `{"commit":"...","database":"ok","version":"11.x.x"}`. If you see `503`, Cloud Run may still be starting — wait 30 seconds and retry.

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

### Step 2.2 — Retrieve Admin Credentials

The Grafana admin password can be set via `GF_SECURITY_ADMIN_PASSWORD` in `secret_environment_variables`. If not configured, Grafana uses the default `admin` / `admin` credentials (change immediately after first login).

```bash
# List Grafana-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~grafana"

# If a custom admin password secret was configured, retrieve it
gcloud secrets versions access latest \
  --secret="grafana-admin-password" \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=labels.app%3Dgrafana"
```

### Step 2.3 — Log In to Grafana

Open a browser and navigate to `${SERVICE_URL}`. Log in with:
- **Username**: `admin`
- **Password**: `admin` (or your configured password)

**Expected result:** The Grafana home dashboard appears. If using default credentials, Grafana prompts you to change the admin password.

---

## Phase 3 — Configure Data Sources [MANUAL]

### Step 3.1 — Add a Cloud Monitoring Data Source

1. In Grafana, navigate to **Connections > Data sources**.
2. Click **Add new data source**.
3. Search for and select **Google Cloud Monitoring**.
4. Select **Default GCE service account** for authentication (uses the Cloud Run service account's Workload Identity).
5. Set **Default project** to your GCP project ID.
6. Click **Save & Test**.

**Expected result:** "Data source connected and labels found."

**gcloud — verify the Cloud Run service account has Monitoring Viewer:**
```bash
gcloud projects get-iam-policy ${PROJECT} \
  --filter="bindings.role:roles/monitoring.viewer" \
  --format="table(bindings.members)" \
  --flatten="bindings[].members"
```

### Step 3.2 — Add a PostgreSQL Data Source

You can query the Grafana application database directly or connect Grafana to an additional Cloud SQL PostgreSQL instance for dashboarding application data.

1. Navigate to **Connections > Data sources** > **Add new data source**.
2. Select **PostgreSQL**.
3. Configure:
   - **Host**: The Cloud SQL Auth Proxy socket path or internal IP
   - **Database**: Your database name
   - **User**: Your database user
   - **Password**: Retrieved from Secret Manager

**gcloud — retrieve the database password:**
```bash
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~grafana.*password" \
  --format="value(name)" \
  --limit=1)
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

### Step 3.3 — Add a BigQuery Data Source

1. Navigate to **Connections > Data sources** > **Add new data source**.
2. Search for **BigQuery** and install the plugin if not already present.
3. Select **Default GCE service account** for authentication.
4. Click **Save & Test**.

**gcloud — grant the Cloud Run SA BigQuery read access:**
```bash
export CR_SA=$(gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(spec.template.spec.serviceAccountName)")
gcloud projects add-iam-policy-binding ${PROJECT} \
  --member="serviceAccount:${CR_SA}" \
  --role="roles/bigquery.dataViewer"
```

---

## Phase 4 — Create Dashboards [MANUAL]

### Step 4.1 — Create a New Dashboard

1. In Grafana, navigate to **Dashboards** > **New** > **New dashboard**.
2. Click **Add visualization**.
3. Select a data source (e.g., Cloud Monitoring).
4. Build a panel: choose a metric type, time range, and visualization type.
5. Click **Apply** to add the panel.
6. Click **Save dashboard** and give it a name.

**Expected result:** The dashboard appears in the Dashboards list with your configured panels.

### Step 4.2 — Explore Metrics in Cloud Monitoring

In a Cloud Monitoring panel, explore the following metric families:
- `run.googleapis.com/request_count` — Cloud Run request volume
- `run.googleapis.com/container/cpu/utilizations` — CPU usage
- `cloudsql.googleapis.com/database/cpu/utilization` — Cloud SQL CPU

**gcloud — verify Cloud Run metrics are available:**
```bash
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/request_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=5
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=metric.type%3D%22run.googleapis.com%2Frequest_count%22"
```

### Step 4.3 — Set Up Alerts

1. Navigate to **Alerting** > **Alert rules** > **New alert rule**.
2. Set a condition (e.g., Cloud Run error rate > 1% for 5 minutes).
3. Configure a notification channel under **Alerting > Contact points**.

---

## Phase 5 — Explore Cloud Logging [MANUAL]

### Step 5.1 — View Grafana Application Logs

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

**Expected result:** Grafana startup logs appear, including the database connection line and `logger=infra.usagestats t=...` metrics reporting.

### Step 5.2 — Check Health Endpoint Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND textPayload:"/api/health"' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Periodic health check requests from Cloud Run are visible.

---

## Phase 6 — Cloud Run Features [MANUAL]

### Step 6.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions with traffic percentages. The most recent revision serves 100% of traffic.

### Step 6.2 — Check Scaling Behaviour

```bash
# Send 20 requests to trigger scaling
for i in $(seq 1 20); do curl -s -o /dev/null ${SERVICE_URL}/api/health; done

# Check current instance count
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** With `min_instance_count = 1`, at least one instance is always running. Additional instances scale up under load and scale back down (but not below `min_instance_count`).

### Step 6.3 — Review the Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check shows **Passing** from multiple global locations. The check targets `/api/health`.

### Step 6.4 — Verify GF_DATABASE_TYPE is Set

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name == "GF_DATABASE_TYPE")'
```

**Expected result:** `{"name": "GF_DATABASE_TYPE", "value": "postgres"}`. This variable is injected automatically — without it, Grafana would fall back to SQLite.

---

## Phase 7 — Grafana Configuration [MANUAL]

### Step 7.1 — Configure SMTP for Alerting

Set SMTP settings via `environment_variables` in your deployment configuration:

```hcl
environment_variables = {
  GF_SMTP_ENABLED  = "true"
  GF_SMTP_HOST     = "smtp.sendgrid.net:587"
  GF_SMTP_USER     = "apikey"
  GF_SMTP_FROM     = "grafana@example.com"
}
secret_environment_variables = {
  GF_SMTP_PASSWORD = "grafana-smtp-password"
}
```

### Step 7.2 — Install a Plugin

Grafana plugins can be installed via `GF_INSTALL_PLUGINS` environment variable:

```hcl
environment_variables = {
  GF_INSTALL_PLUGINS = "grafana-clock-panel,grafana-worldmap-panel"
}
```

After updating the variable in the RAD UI and redeploying, the plugins are available in Grafana.

### Step 7.3 — Configure OAuth Authentication

For team deployments, configure Google OAuth via environment variables:

```hcl
environment_variables = {
  GF_AUTH_GOOGLE_ENABLED             = "true"
  GF_AUTH_GOOGLE_ALLOW_SIGN_UP       = "true"
  GF_AUTH_GOOGLE_ALLOWED_DOMAINS     = "example.com"
  GF_AUTH_GOOGLE_CLIENT_ID           = "..."
}
secret_environment_variables = {
  GF_AUTH_GOOGLE_CLIENT_SECRET = "grafana-google-oauth-secret"
}
```

---

## Phase 8 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database (dashboards, users, organizations) and storage buckets. Export your dashboards before undeploying: **Dashboards > Export JSON** or use the Grafana HTTP API.

```bash
# Export all dashboards via Grafana API
curl -s -u admin:password ${SERVICE_URL}/api/search?type=dash-db \
  | jq '.[].uid' \
  | xargs -I {} curl -s -u admin:password ${SERVICE_URL}/api/dashboards/uid/{} \
  | jq '.dashboard' > dashboards-backup.json
```

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Confirm Grafana is reachable | 2 | No |
| Log in to Grafana | 2 | No |
| Add data sources (Cloud Monitoring, BigQuery, PostgreSQL) | 3 | No |
| Create dashboards and panels | 4 | No |
| Set up alerts and notification channels | 4 | No |
| Review Cloud Logging | 5 | No |
| Examine revisions and scaling | 6 | No |
| Review uptime checks | 6 | No |
| Configure SMTP, plugins, OAuth | 7 | No |
| Undeploy infrastructure | 8 | Yes |
