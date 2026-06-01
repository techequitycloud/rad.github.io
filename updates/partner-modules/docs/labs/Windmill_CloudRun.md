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
2. The `Services GCP` module deployed in the same project.
3. The following APIs enabled (Services GCP handles this):
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
| `service_url` | No | `""` | Public URL for BASE_URL (set after first deploy) |
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

### Step 2.2 — Inspect Cloud Run Environment Variables

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | IN("MODE","NUM_WORKERS","DISABLE_NSJAIL"))'
```

**Expected result:** The output shows:
- `MODE = server,worker`
- `NUM_WORKERS = 3`
- `DISABLE_NSJAIL = true`

---

## Phase 3 — Set Up the Windmill Admin Account [MANUAL]

### Step 3.1 — Access the Windmill UI

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The Windmill login page appears.

### Step 3.2 — Create an Admin Account

1. Click **Create account** on the login page.
2. Enter an email address and password.
3. The first account created automatically receives the `super-admin` role.

**Expected result:** You are redirected to the Windmill workspace selection page.

### Step 3.3 — Create a Workspace

1. Click **Create workspace**.
2. Enter a workspace ID (e.g., `prod`) and a display name (e.g., "Production").
3. Click **Create**.

**Expected result:** The workspace is created and you are redirected to the workspace home dashboard.

---

## Phase 4 — Explore Windmill Features [MANUAL]

### Step 4.1 — Create a Script

1. In the left sidebar, click **Scripts** > **New script**.
2. Select **Python 3** as the language.
3. Enter a name (e.g., `hello_world`).
4. In the editor, write:
   ```python
   def main(name: str = "World"):
       return f"Hello, {name}!"
   ```
5. Click **Save** then **Test**.

**Expected result:** The script executes in a worker and returns `"Hello, World!"` in the result panel. The execution log appears below.

### Step 4.2 — Create a TypeScript Script

1. Click **Scripts** > **New script**.
2. Select **Deno** (TypeScript) as the language.
3. Write:
   ```typescript
   export async function main(url: string) {
     const res = await fetch(url);
     return { status: res.status, ok: res.ok };
   }
   ```
4. Test with `url = "https://www.google.com"`.

**Expected result:** Returns `{ status: 200, ok: true }`.

### Step 4.3 — Create a Flow

1. Click **Flows** > **New flow**.
2. Click **Add step** > **Script** and select the `hello_world` Python script.
3. Click **Add step** > **Approval** to require manual approval before continuing.
4. Click **Save** and then **Test flow**.

**Expected result:** The flow runs the script, pauses at the approval step, and displays an approval link. Click the link to approve and the flow completes.

### Step 4.4 — Create an App (UI Builder)

1. Click **Apps** > **New app**.
2. Drag a **Text Input** component onto the canvas.
3. Drag a **Button** component and connect it to the `hello_world` script.
4. Set the button's input to read from the text input's value.
5. Click **Preview**.

**Expected result:** A browser-based UI renders with the input and button. Clicking the button runs the script and displays the result.

---

## Phase 5 — Configure SMTP [MANUAL]

Windmill sends email notifications for workflow approvals, team invitations, and scheduled job failures.

### Step 5.1 — Retrieve the SMTP Secret Name

```bash
# List Windmill-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~windmill"

export SMTP_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~smtp-password" \
  --format="value(name)" \
  --limit=1)
echo "SMTP secret: ${SMTP_SECRET}"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3A~windmill"
```

### Step 5.2 — Update the SMTP Password

```bash
# Replace the placeholder with your actual SMTP password
echo -n "your-smtp-password-here" | gcloud secrets versions add ${SMTP_SECRET} \
  --data-file=- \
  --project=${PROJECT}
```

**gcloud equivalent (verify the new version was added):**
```bash
gcloud secrets versions list ${SMTP_SECRET} --project=${PROJECT}
```

### Step 5.3 — Configure SMTP in the Windmill UI

1. In Windmill, click the gear icon (top-right corner) > **Instance settings**.
2. Navigate to the **SMTP** section.
3. Enter your SMTP server details:
   - **Host**: Your SMTP server (e.g., `smtp.mailgun.org`)
   - **Port**: `587`
   - **From email**: `windmill@yourdomain.com`
   - **Username**: Your SMTP username
4. Click **Save**.

**Expected result:** Windmill saves the SMTP configuration. The `WINDMILL_SMTP_PASS` environment variable is already injected from Secret Manager.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Windmill Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console and query:

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
  --format="table(timestamp, jsonPayload.message)"
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

**Expected result:** Structured JSON log entries appear (due to `JSON_FMT=true`). Worker pickup messages, script executions, and database connection logs are visible.

### Step 6.2 — Filter for Script Execution Logs

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
jsonPayload.message=~"job"
```

**Expected result:** Script job execution logs appear, showing job IDs, worker assignments, and execution durations.

---

## Phase 7 — Metrics and Monitoring [MANUAL]

### Step 7.1 — Review the Metrics Endpoint

Windmill exposes Prometheus metrics at port 9001. Within the VPC, you can scrape these metrics.

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name=="METRICS_ADDR")'
```

**Expected result:** `METRICS_ADDR = ":9001"` is shown.

### Step 7.2 — Check Cloud Run Instance Count

```bash
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Instance count metrics show current running instances. With `min_instance_count=1`, at least one instance is always active.

### Step 7.3 — Review Uptime Check

Navigate to **Monitoring > Uptime checks**.

**Expected result:** A preconfigured uptime check polling `${SERVICE_URL}/api/version` shows **Passing** from multiple global locations.

---

## Phase 8 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 12–18 minutes.

> **Warning:** Undeploying permanently deletes the database and all Windmill data. Export any scripts, flows, and apps before undeploying (Windmill Settings > Export).

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
| Inspect environment variables | 2 | No |
| Create admin account | 3 | No |
| Create workspace | 3 | No |
| Create Python and TypeScript scripts | 4 | No |
| Create approval flow | 4 | No |
| Build a UI App | 4 | No |
| Configure SMTP secret | 5 | No |
| Review Cloud Logging | 6 | No |
| Review metrics and uptime | 7 | No |
| Undeploy infrastructure | 8 | Yes |
