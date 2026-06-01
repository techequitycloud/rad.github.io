---
title: "Activepieces on Cloud Run — Lab Guide"
sidebar_label: "Activepieces CloudRun Lab"
---

# Activepieces on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Activepieces_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Activepieces is an open-source, Apache 2.0-licensed workflow automation platform (an alternative to Zapier). It provides a visual flow builder, 100+ integration pieces, webhook triggers, and runs workflows automatically. This module deploys Activepieces on Google Cloud Run with a Cloud SQL PostgreSQL 15 backend, GCS Fuse storage, and optional Redis queue mode. Cloud Run provides serverless scaling — you pay only when flows are executing.

### What the Module Automates

- Cloud Run service with configured CPU/memory limits and scaling bounds
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets for database credentials and encryption keys
- Artifact Registry repository and container image mirroring via Cloud Build
- Cloud Storage bucket (GCS Fuse mount)
- Cloud SQL Auth Proxy sidecar injection
- Serverless VPC Access connector for private network egress
- IAM bindings for Cloud Run service identity
- Cloud Run Jobs for database initialization
- Automated daily database backups (cron schedule: `0 2 * * *`)
- Optional Redis configuration for queue mode
- Cloud Monitoring uptime checks and notification channels

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Create the initial Activepieces admin account in the UI
- Build and test your first automation flow
- Explore the pieces catalog and configure integrations
- Add connections for external services
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

The lab uses the following tools:

- **gcloud** — Google Cloud CLI for service inspection and log access
- **curl** — HTTP client for webhook testing

Key gcloud commands used in this lab:

```bash
gcloud run services describe <service-name> --region <region> --project <project-id>
gcloud secrets versions access latest --secret=<secret-name> --project=<project-id>
gcloud logging read 'resource.type="cloud_run_revision"' --project=<project-id> --limit=50
```

---

## Prerequisites

1. **Services_GCP deployed** — This module depends on `Services_GCP`. The VPC network, Cloud SQL instance, Serverless VPC Access connector, Artifact Registry, and shared service accounts must already exist in the target project.
2. **GCP project** with billing enabled.
3. **gcloud CLI** authenticated (`gcloud auth application-default login`).
4. **Permissions** — Owner or equivalent role on the target GCP project.
5. **Access to the RAD UI** with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Configure the following variables in the RAD UI deployment form before deploying:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier for resource naming |
| `application_name` | No | `activepieces` | Base name for Cloud Run service and secrets |
| `application_version` | No | `latest` | Container image version tag |
| `deploy_application` | No | `true` | Set false to provision infra only without deploying |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale-to-zero) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances |
| `cpu_limit` | No | `2000m` | CPU limit per container instance |
| `memory_limit` | No | `2Gi` | Memory limit per container instance |
| `enable_redis` | No | `false` | Enable Redis as the workflow queue backend |
| `redis_host` | No | `""` | Redis hostname or IP (leave blank for NFS server IP) |
| `redis_port` | No | `6379` | Redis TCP port |
| `db_name` | No | `activepieces_db` | PostgreSQL database name |
| `db_user` | No | `ap_user` | PostgreSQL user name |
| `database_password_length` | No | `32` | Generated password length (16–64) |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

### Approximate Provisioning Duration

| Resource | Estimated Time |
|---|---|
| Cloud SQL PostgreSQL 15 instance | 5–8 min |
| Container image build (Cloud Build) | 3–5 min |
| Cloud Run service deployment | 2–4 min |
| Secret Manager secrets | < 1 min |
| Cloud Storage bucket | < 1 min |
| **Total** | **~10–18 min** |

> Note: The first Cloud Run revision performs database migrations on startup. The startup probe allows up to ~7 minutes (`initial_delay_seconds=120` + `failure_threshold=10` × `period_seconds=30`) for the first boot.

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps using gcloud discovery:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~activepieces" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~activepieces" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get Service URL [MANUAL]

**Objective:** Retrieve the Cloud Run service URL.

1. List Cloud Run services in the project:

   ```bash
   gcloud run services list \
     --project=${PROJECT} \
     --region=${REGION} \
     --format="table(name, status.url)"
   ```

   **Expected result:** A table showing the Activepieces service and its HTTPS URL.

2. Retrieve the URL directly:

   ```bash
   echo "Activepieces URL: ${SERVICE_URL}"
   ```

   **Expected result:** An HTTPS URL in the form `https://activepieces-<hash>-uc.a.run.app`.

3. Verify the service is responding:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}"
   ```

   **Expected result:** `200` or `302`.

   > **REST API equivalent:**
   > ```
   > GET https://run.googleapis.com/v2/projects/{project}/locations/{region}/services
   > ```

---

## Phase 3 — Set Up Activepieces [MANUAL]

**Objective:** Complete the initial admin account setup in the Activepieces UI.

1. Open the Activepieces UI in a browser using the service URL from Phase 2.

   **Expected result:** The Activepieces onboarding page or sign-in screen.

2. On first visit, Activepieces prompts you to create an admin account. Fill in:
   - Full name
   - Email address
   - Password

   Click **Get Started**.

   **Expected result:** You are redirected to the Activepieces dashboard.

3. Alternatively, if credentials were pre-configured via Secret Manager, retrieve them:

   ```bash
   # List relevant secrets
   gcloud secrets list --project=${PROJECT} --filter="name~activepieces"

   # Access a specific secret
   gcloud secrets versions access latest \
     --secret=${DB_SECRET} \
     --project=${PROJECT}
   ```

   > **REST API equivalent:**
   > ```
   > GET https://secretmanager.googleapis.com/v1/projects/{project}/secrets/{secret}/versions/latest:access
   > ```

4. Explore the dashboard: note the **Flows**, **Connections**, and **Runs** sections in the left navigation.

---

## Phase 4 — Build Your First Flow [MANUAL]

**Objective:** Create a complete automation flow with a Webhook trigger and an HTTP Request action.

1. Click **New Flow** (or the `+` button) in the Flows section.

2. Give the flow a name, e.g., `My First Flow`.

3. Click **Add Trigger** and select **Webhook** from the pieces list.
   - Copy the webhook URL shown in the trigger configuration panel.

   **Expected result:** A webhook URL in the form `https://<service-url>/api/v1/webhooks/<id>`.

4. Add an action: click the `+` after the trigger, search for **HTTP Request**, and configure it:
   - **Method:** GET
   - **URL:** `https://httpbin.org/get`

   **Expected result:** The HTTP Request piece appears in the flow canvas.

5. Add a **Branch / Filter** piece after the HTTP Request to demonstrate conditional logic:
   - Configure a condition, e.g., check that the response status is `200`.

6. Enable the flow by toggling the **Published** switch at the top of the editor.

   **Expected result:** The toggle turns green and the flow status changes to `Enabled`.

7. Test the flow by sending a POST request to the webhook URL:

   ```bash
   WEBHOOK_URL="<paste-webhook-url-here>"
   curl -X POST "${WEBHOOK_URL}" \
     -H "Content-Type: application/json" \
     -d '{"test": "data", "source": "lab"}'
   ```

   **Expected result:** HTTP `200` response from Activepieces.

   > **Note:** If `min_instance_count = 0` (scale-to-zero), the first request after an idle period may experience a cold start delay of 15–30 seconds while Cloud Run provisions a new instance. Set `min_instance_count = 1` to eliminate cold starts for webhooks in production.

8. In the Activepieces UI, navigate to **Runs** to view the execution results. Click the run to see the step-by-step trace.

   > **gcloud equivalent (check Cloud Run logs):**
   > ```bash
   > gcloud logging read \
   >   'resource.type="cloud_run_revision" resource.labels.service_name~"activepieces"' \
   >   --project=${PROJECT} \
   >   --limit=20
   > ```

---

## Phase 5 — Explore the Pieces Catalog [MANUAL]

**Objective:** Browse available integration pieces and understand how they extend Activepieces.

1. In the left navigation, click **Connections** then **Pieces** (or find the pieces catalog from within the flow editor).

2. Browse the available pieces (100+). Filter by category:
   - **Communication:** Slack, Gmail, Discord
   - **Data:** Google Sheets, Airtable, PostgreSQL
   - **Utilities:** HTTP Request, Delay, Branch

3. Search for a GCP-specific piece if available (e.g., search `Google`).

4. Click on any piece to view its configuration options, required connections, and available triggers/actions.

   **Expected result:** Each piece shows a description, version, and the list of actions/triggers it supports.

5. Note that pieces can be used as both triggers (starting a flow) and actions (steps within a flow).

---

## Phase 6 — Connection Management [MANUAL]

**Objective:** Add an authenticated connection and understand how connections are shared across flows.

1. Navigate to **Connections** in the left navigation.

2. Click **Add Connection** and choose a piece to connect, for example:
   - **HTTP Basic Auth** — choose the HTTP piece and configure with a test endpoint URL, username, and password.
   - Or choose **API Key** authentication with any piece that supports it.

3. Fill in the required credentials and click **Save**.

   **Expected result:** The connection appears in the Connections list with a green status indicator.

4. Return to your flow from Phase 4 and update the HTTP Request piece to use the saved connection.

   **Expected result:** The flow can authenticate using the saved credentials without exposing them in the flow definition.

5. Note that connections are project-wide and can be shared across multiple flows — credentials are stored encrypted in Secret Manager.

   > **Verify secrets in Secret Manager:**
   > ```bash
   > gcloud secrets list --project=${PROJECT} --filter="name~activepieces"
   > ```

   > **REST API equivalent:**
   > ```
   > GET https://secretmanager.googleapis.com/v1/projects/{project}/secrets?filter=name:activepieces
   > ```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

**Objective:** Find Activepieces application logs in Cloud Logging.

1. Open Cloud Logging in the GCP console:
   `https://console.cloud.google.com/logs/query?project=<project-id>`

2. Use the following query to filter Activepieces Cloud Run logs:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name=~"activepieces"
   ```

   **Expected result:** Application logs showing startup messages, webhook receipts, and flow execution events.

3. Filter for errors:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name=~"activepieces"
   severity>=ERROR
   ```

4. From the command line:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name=~"activepieces"' \
     --project=${PROJECT} \
     --limit=50 \
     --format=json | jq '.[].textPayload // .[].jsonPayload'
   ```

   > **REST API equivalent:**
   > ```
   > POST https://logging.googleapis.com/v2/entries:list
   > {
   >   "resourceNames": ["projects/&lt;project-id>"],
   >   "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=~\"activepieces\"",
   >   "orderBy": "timestamp desc",
   >   "pageSize": 50
   > }
   > ```

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

**Objective:** Review Cloud Run metrics in Cloud Monitoring.

1. Open Cloud Monitoring in the GCP console:
   `https://console.cloud.google.com/monitoring?project=<project-id>`

2. Navigate to **Metrics Explorer** and explore the following Cloud Run metrics:
   - `run.googleapis.com/request_count` — Requests served per revision
   - `run.googleapis.com/request_latencies` — Request latency percentiles
   - `run.googleapis.com/container/cpu/utilizations` — CPU utilization
   - `run.googleapis.com/container/memory/utilizations` — Memory utilization
   - `run.googleapis.com/container/instance_count` — Active instance count

3. Filter by:
   - `resource.service_name = activepieces-<suffix>`
   - `resource.location = <region>`

   **Expected result:** Charts showing request volume, latency, and resource consumption.

4. Check the uptime check (configured by the module):

   ```bash
   gcloud monitoring uptime list-configs --project=${PROJECT}
   ```

   **Expected result:** An uptime check for the Activepieces service endpoint.

   > **REST API equivalent:**
   > ```
   > GET https://monitoring.googleapis.com/v3/projects/{project}/uptimeCheckConfigs
   > ```

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** All Cloud Run services, Cloud SQL instance, Secret Manager secrets, Cloud Storage buckets, and supporting IAM resources are deleted.

> **Note:** If `enable_purge = false`, certain resources such as the database and storage buckets will be retained after undeployment to prevent accidental data loss.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Provision Cloud Run service | 1 | Yes |
| Create Cloud SQL PostgreSQL 15 instance | 1 | Yes |
| Mirror container image via Cloud Build | 1 | Yes |
| Configure Secret Manager secrets | 1 | Yes |
| Create Cloud Storage bucket | 1 | Yes |
| Configure Serverless VPC Access | 1 | Yes |
| Set up IAM bindings | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Create admin account in UI | 3 | No |
| Build first flow with Webhook + HTTP | 4 | No |
| Test webhook with curl | 4 | No |
| Browse pieces catalog | 5 | No |
| Add a connection (API key / Basic Auth) | 6 | No |
| Explore logs in Cloud Logging | 7 | No |
| Review metrics in Cloud Monitoring | 8 | No |
| Undeploy all resources | 9 | Yes |
