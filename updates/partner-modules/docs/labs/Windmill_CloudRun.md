# Windmill on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Windmill_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Windmill is an open-source developer platform for building internal tools, workflows, and scripts in Python, TypeScript, Go, Bash, and more. This lab deploys Windmill on Google Cloud Run backed by Cloud SQL PostgreSQL 16, with both the API server and script execution workers running in a combined process.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 16 instance, database, and user
- Secret Manager secrets (database password, SMTP password placeholder)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks targeting `/api/version`
- GCS `windmill-data` bucket for workflow outputs
- `db-init` Cloud Run Job for database schema initialisation

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Create a Windmill admin account via the UI
- Create workspaces, scripts, and flows
- Connect data sources and third-party integrations
- Configure SMTP by replacing the placeholder secret in Secret Manager
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
2. The `Services_GCP` module deployed in the same project.
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"latest"` | Windmill image version |
| `deploy_application` | No | `true` | Set `false` for infrastructure-only |
| `cpu_limit` | No | `"2000m"` | CPU per instance |
| `memory_limit` | No | `"2Gi"` | Memory per instance |
| `min_instance_count` | No | `1` | Minimum instances |
| `max_instance_count` | No | `3` | Maximum instances |
| `db_name` | No | `"windmill"` | PostgreSQL database name |
| `db_user` | No | `"windmill"` | PostgreSQL database user |
| `service_url` | No | `""` | Public URL for BASE_URL (set to Cloud Run URL after first deploy) |
| `environment_variables` | No | `{}` | Additional env vars |
| `support_users` | No | `[]` | Monitoring alert emails |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL 16 instance creation | 8–12 min |
| Secret Manager secret creation | 1–2 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **16–28 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Windmill Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL PostgreSQL 16 instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~windmill" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Windmill URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm Windmill is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/version
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

**Expected result:** HTTP `200` with a JSON body containing the Windmill version (e.g., `{"version":"1.xxx.x"}`).

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready`. Verify the environment variables include `MODE=server,worker`, `NUM_WORKERS=3`, and `DISABLE_NSJAIL=true`.

---

## Phase 3 — Set Up the Windmill Admin Account [MANUAL]

### Step 3.1 — Access the Windmill UI

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The Windmill login page appears.

### Step 3.2 — Create an Admin Account

1. Click **Create account** on the login page.
2. Enter an email address and password.
3. The first account created is automatically assigned the `super-admin` role.

**Expected result:** You are redirected to the Windmill workspace selection page.

### Step 3.3 — Create a Workspace

1. Click **Create workspace**.
2. Enter a workspace ID (e.g., `prod`) and display name.
3. Click **Create**.

**Expected result:** The workspace is created and you are redirected to the workspace home dashboard.

---

## Phase 4 — Explore Windmill Features [MANUAL]

### Step 4.1 — Create a Script

1. In the left sidebar, click **Scripts** > **New script**.
2. Select **Python 3** as the language.
3. Enter a name (e.g., `hello_world`).
4. In the editor, enter:
   ```python
   def main(name: str = "World"):
       return f"Hello, {name}!"
   ```
5. Click **Save** > **Test**.

**Expected result:** The script executes and returns `"Hello, World!"` in the result panel.

### Step 4.2 — Create a Flow

1. Click **Flows** > **New flow**.
2. Add a script step using the `hello_world` script from the previous step.
3. Add an approval step requiring manual confirmation.
4. Click **Save** > **Test flow**.

**Expected result:** The flow runs the script step, pauses for approval, and resumes after confirmation.

### Step 4.3 — Explore Apps

1. Click **Apps** > **New app**.
2. Use the drag-and-drop UI builder to add a text input and a button.
3. Connect the button to the `hello_world` script.
4. Click **Preview**.

**Expected result:** A simple web application renders with the text input and button.

---

## Phase 5 — Configure SMTP [MANUAL]

Windmill sends email notifications for workflow approvals, scheduled job failures, and team invitations. The SMTP password is stored as a placeholder in Secret Manager.

### Step 5.1 — Update the SMTP Password Secret

```bash
# List Windmill-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~windmill"

# Update the SMTP password with your actual password
echo -n "your-smtp-password" | gcloud secrets versions add \
  $(gcloud secrets list --project=${PROJECT} --filter="name~smtp-password" --format="value(name)" --limit=1) \
  --data-file=-
```

**gcloud equivalent (list secret versions):**
```bash
gcloud secrets versions list \
  $(gcloud secrets list --project=${PROJECT} --filter="name~smtp-password" --format="value(name)" --limit=1) \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/$(gcloud secrets list --project=${PROJECT} --filter='name~smtp-password' --format='value(name)' --limit=1):addVersion" \
  -d '{"payload": {"data": "'$(echo -n "your-smtp-password" | base64)'"}}'
```

### Step 5.2 — Configure SMTP Settings in Windmill

1. In Windmill Admin, click **Settings** (top-right) > **Instance settings**.
2. Navigate to the **SMTP** section.
3. Enter your SMTP host, port, sender email, and username.
4. Click **Save**.

**Expected result:** Windmill sends test email notifications. Check Cloud Run logs for SMTP connection messages.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Windmill Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

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

**Expected result:** JSON-formatted logs appear (due to `JSON_FMT=true`). Look for worker pickup messages and script execution logs.

### Step 6.2 — Filter Worker Logs

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
jsonPayload.message=~"worker"
```

**Expected result:** Worker startup messages appear, including `NUM_WORKERS=3` confirmation.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — View the Version Endpoint

```bash
curl ${SERVICE_URL}/api/version
```

**Expected result:** JSON response with the Windmill version. This is the same endpoint used by health probes.

### Step 7.2 — Check Scaling Behaviour

```bash
# Send concurrent requests to trigger scaling
for i in $(seq 1 20); do curl -s -o /dev/null ${SERVICE_URL}/api/version & done; wait

# Check instance count
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Cloud Run scales up instances to handle concurrent requests.

### Step 7.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** An uptime check polling `/api/version` shows **Passing** from multiple global locations.

---

## Phase 8 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 12–18 minutes.

> **Warning:** Undeploying permanently deletes the database and all workflow data. Export any workflows, scripts, or apps before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 16 database | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Artifact Registry image build | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Confirm Windmill is reachable | 2 | No |
| Create admin account | 3 | No |
| Create workspace | 3 | No |
| Create and test scripts | 4 | No |
| Create and test flows | 4 | No |
| Configure SMTP secret | 5 | No |
| Review Cloud Logging | 6 | No |
| Check scaling behaviour | 7 | No |
| Review uptime checks | 7 | No |
| Undeploy infrastructure | 8 | Yes |
