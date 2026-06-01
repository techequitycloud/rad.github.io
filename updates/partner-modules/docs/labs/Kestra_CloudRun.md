# Kestra on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kestra_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Kestra is an open-source, Apache 2.0-licensed data orchestration and workflow scheduling platform. It uses YAML-based flow definitions, supports namespaces for organization, and has a rich plugin ecosystem for ETL/ELT pipelines, data pipelines, and API orchestration. This module deploys Kestra in standalone mode on Google Cloud Run — the server, worker, and scheduler run in a single container backed by Cloud SQL PostgreSQL 15 and GCS artifact storage.

### What the Module Automates

- Cloud Run service with configured CPU/memory limits and scaling bounds
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets for database credentials
- Artifact Registry repository and container image mirroring via Cloud Build
- Cloud SQL Auth Proxy sidecar injection
- Serverless VPC Access connector for private network egress
- IAM bindings for Cloud Run service identity
- Cloud Run Jobs for database initialization
- Optional Cloud Filestore (NFS) instance
- Automated daily database backups (cron schedule: `0 2 * * *`)
- Cloud Monitoring uptime checks and notification channels

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Verify Kestra is healthy and accessible
- Navigate the Kestra UI and explore namespaces
- Create and execute your first YAML-based flow
- Configure schedule and webhook triggers
- Manage namespaces and namespace-level variables
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

The lab uses the following tools:

- **gcloud** — Google Cloud CLI for service inspection and log access
- **curl** — HTTP client for API and webhook testing

Key gcloud commands used in this lab:

```bash
gcloud run services describe <service-name> --region <region> --project <project-id>
gcloud secrets versions access latest --secret=<secret-name> --project=<project-id>
gcloud logging read 'resource.type="cloud_run_revision"' --project=<project-id> --limit=50
```

---

## Prerequisites

1. **Services GCP deployed** — This module depends on `Services GCP`. The VPC network, Cloud SQL instance, Serverless VPC Access connector, Artifact Registry, and shared service accounts must already exist in the target project.
2. **GCP project** with billing enabled.
3. **gcloud CLI** authenticated (`gcloud auth application-default login`).
4. **Permissions** — Owner or equivalent role on the target GCP project.
5. **Access to the RAD UI** with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier for resource naming |
| `application_name` | No | `kestra` | Base name for Cloud Run service and secrets |
| `application_version` | No | `latest` | Container image version tag (e.g., `0.17.0`) |
| `deploy_application` | No | `true` | Set false to provision infra only without deploying |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (set to 1 — JVM cold start is slow) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances (standalone mode) |
| `cpu_limit` | No | `2000m` | CPU limit per container instance |
| `memory_limit` | No | `4Gi` | Memory limit per container instance |
| `db_name` | No | `kestra` | PostgreSQL database name |
| `db_user` | No | `kestra` | PostgreSQL user name |
| `database_password_length` | No | `32` | Generated password length (16–64) |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

### Approximate Provisioning Duration

| Resource | Estimated Time |
|---|---|
| Cloud SQL PostgreSQL 15 instance | 5–8 min |
| Container image build (Cloud Build) | 3–5 min |
| Cloud Run service deployment | 3–5 min |
| Kestra JVM startup + DB migration | 5–14 min (first boot) |
| Secret Manager secrets | < 1 min |
| **Total** | **~15–25 min** |

> Note: Kestra uses a Java JVM and runs database migrations on first boot. The startup probe allows up to ~14 minutes (`initial_delay_seconds=30` + `failure_threshold=40` × `period_seconds=20`). Subsequent cold starts are faster because migrations are already applied.

> Note: `cpu_always_allocated = true` is set by default — Kestra keeps the CPU allocated at all times for background scheduler and worker processing.

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
  --filter="metadata.name~kestra" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~kestra" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get Service URL [MANUAL]

**Objective:** Retrieve the Cloud Run service URL and verify Kestra is healthy.

1. List Cloud Run services in the project:

   ```bash
   gcloud run services list \
     --project=${PROJECT} \
     --region=${REGION} \
     --format="table(name, status.url)"
   ```

   **Expected result:** A table showing the Kestra service and its HTTPS URL.

2. Confirm the service URL:

   ```bash
   echo "Kestra URL: ${SERVICE_URL}"
   ```

   **Expected result:** An HTTPS URL in the form `https://kestra-<hash>-uc.a.run.app`.

3. Check the Kestra health endpoint:

   ```bash
   curl -s "${SERVICE_URL}/health"
   ```

   **Expected result:** `{"status":"UP"}` JSON response.

   > If Cloud Run returns a `503` immediately after deployment, Kestra's JVM may still be initializing. Wait 2–3 minutes and retry. The startup probe gives up to 14 minutes total.

4. Check the Cloud Run revision status:

   ```bash
   gcloud run revisions list \
     --service=${SERVICE} \
     --region=${REGION} \
     --project=${PROJECT} \
     --format="table(name, status.observedGeneration, status.conditions[0].type)"
   ```

   **Expected result:** The latest revision shows `Ready: True`.

   > **REST API equivalent:**
   > ```
   > GET https://run.googleapis.com/v2/projects/{project}/locations/{region}/services
   > ```

---

## Phase 3 — Explore the Kestra UI [MANUAL]

**Objective:** Navigate the Kestra interface and understand its core concepts.

1. Open the Kestra UI in a browser using the service URL from Phase 2.

   **Expected result:** The Kestra dashboard loads showing the main navigation.

   > Note: The Kestra UI is served on the root path `/` of the Cloud Run service URL. The API is at `/api/v1/`.

2. Explore the main navigation tabs:
   - **Flows** — List and manage YAML flow definitions
   - **Executions** — View execution history, status, and logs per run
   - **Logs** — Aggregated execution and system logs
   - **Namespaces** — Organize flows into logical groups
   - **Audit Log** — Full audit trail of all user and system actions

3. Notice the YAML-based nature of Kestra flows. Unlike GUI-only tools, every flow in Kestra is a plain YAML document that can be version-controlled.

4. Check the **Plugins** section (if visible) to see available plugin categories:
   - Core plugins (Log, HTTP, Script)
   - Data plugins (BigQuery, GCS, PostgreSQL)
   - Cloud plugins (GCP, AWS, Azure)

---

## Phase 4 — Create Your First Flow [MANUAL]

**Objective:** Write and execute a simple YAML flow using the Kestra flow editor.

1. Navigate to **Flows** in the left navigation and click **Create**.

2. In the YAML editor, replace the default content with the following flow definition:

   ```yaml
   id: hello-world
   namespace: company.team
   tasks:
     - id: hello
       type: io.kestra.plugin.core.log.Log
       message: "Hello from Kestra on GCP!"
   ```

   Click **Save**.

   **Expected result:** The flow `hello-world` appears in the `company.team` namespace.

3. Click **Execute** (the play button) to run the flow.

   **Expected result:** A new execution is created and the status transitions from `CREATED` → `RUNNING` → `SUCCESS`.

4. Click on the execution to view the **Execution Graph** — a visual representation of the task topology.

5. Click on the `hello` task in the graph to view its **Logs** tab.

   **Expected result:** The log entry `Hello from Kestra on GCP!` appears in the task output.

   > **gcloud equivalent (check Cloud Run logs for execution):**
   > ```bash
   > gcloud logging read \
   >   'resource.type="cloud_run_revision" AND resource.labels.service_name=~"kestra"' \
   >   --project=${PROJECT} \
   >   --limit=20
   > ```

   > **REST API equivalent:**
   > ```
   > POST https://<service-url>/api/v1/executions/hello-world
   > {
   >   "namespace": "company.team"
   > }
   > ```

---

## Phase 5 — Triggers and Scheduling [MANUAL]

**Objective:** Add a Schedule trigger and a Webhook trigger to the flow, and test them.

1. Navigate to your `hello-world` flow and click **Edit**.

2. Add a Schedule trigger that runs every 5 minutes and a Webhook trigger:

   ```yaml
   id: hello-world
   namespace: company.team
   tasks:
     - id: hello
       type: io.kestra.plugin.core.log.Log
       message: "Hello from Kestra on GCP!"
   triggers:
     - id: schedule
       type: io.kestra.plugin.core.trigger.Schedule
       cron: "*/5 * * * *"
     - id: webhook
       type: io.kestra.plugin.core.trigger.Webhook
       key: my-secret-key
   ```

   Click **Save**.

   **Expected result:** The flow now shows two triggers in the flow definition.

3. Retrieve the webhook trigger URL. In the Kestra UI, click on the flow then navigate to the **Triggers** tab. The webhook URL will be shown in the form:

   ```
   https://<service-url>/api/v1/executions/webhook/company.team/hello-world/my-secret-key
   ```

4. Test the webhook trigger with curl:

   ```bash
   curl -X POST \
     "${SERVICE_URL}/api/v1/executions/webhook/company.team/hello-world/my-secret-key" \
     -H "Content-Type: application/json" \
     -d '{"triggered_by": "lab-test"}'
   ```

   **Expected result:** JSON response with an `id` field containing the new execution ID.

5. Navigate to **Executions** in the Kestra UI.

   **Expected result:** A new execution triggered by the webhook appears in the list with trigger source `WEBHOOK`.

6. Wait 5 minutes and verify that the schedule trigger fires automatically.

   **Expected result:** A new execution appears with trigger source `SCHEDULE`.

   > **REST API equivalent (list executions):**
   > ```
   > GET https://<service-url>/api/v1/executions?namespace=company.team&flowId=hello-world
   > ```

---

## Phase 6 — Namespace Management [MANUAL]

**Objective:** Create a new namespace, organize flows within it, and explore namespace-level settings.

1. Navigate to **Namespaces** in the left navigation.

2. Click **Create Namespace** and enter a new namespace name, e.g., `lab.experiments`.

   **Expected result:** The namespace `lab.experiments` appears in the namespace list.

3. Create a new flow in the new namespace by navigating to **Flows > Create** and setting:

   ```yaml
   id: namespace-test
   namespace: lab.experiments
   tasks:
     - id: log
       type: io.kestra.plugin.core.log.Log
       message: "Running in lab.experiments namespace"
   ```

   Click **Save**.

4. In the **Namespaces** view, click on `lab.experiments` and explore:
   - **Variables** — Namespace-level key-value pairs shared across all flows in the namespace
   - **Secrets** — Namespace-scoped secrets (backed by Secret Manager in this deployment)
   - **Permissions** — Access control for the namespace

5. Add a namespace variable:
   - Click **Variables > Add Variable**
   - Key: `environment`, Value: `lab`

   **Expected result:** The variable is saved and can be referenced in flows as `{{ namespace.environment }}`.

6. Verify namespace-level permissions — note that namespaces provide organizational isolation, allowing different teams to manage their own flows without interfering with others.

   > **REST API equivalent (list namespaces):**
   > ```
   > GET https://<service-url>/api/v1/namespaces
   > ```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

**Objective:** Find Kestra execution and system logs in Cloud Logging.

1. Open Cloud Logging in the GCP console:
   `https://console.cloud.google.com/logs/query?project=<project-id>`

2. Use the following query to filter Kestra Cloud Run logs:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name=~"kestra"
   ```

   **Expected result:** Application logs showing JVM startup, flow execution events, and scheduler ticks.

3. Filter for execution-related log entries (Kestra emits structured JSON logs):

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name=~"kestra"
   jsonPayload.flow.id="hello-world"
   ```

4. Filter for errors:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name=~"kestra"
   severity>=ERROR
   ```

5. From the command line:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name=~"kestra"' \
     --project=${PROJECT} \
     --limit=50 \
     --format=json | jq '.[].jsonPayload // .[].textPayload'
   ```

   > **REST API equivalent:**
   > ```
   > POST https://logging.googleapis.com/v2/entries:list
   > {
   >   "resourceNames": ["projects/<project-id>"],
   >   "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=~\"kestra\"",
   >   "orderBy": "timestamp desc",
   >   "pageSize": 50
   > }
   > ```

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

**Objective:** Review Cloud Run metrics and flow execution health in Cloud Monitoring.

1. Open Cloud Monitoring in the GCP console:
   `https://console.cloud.google.com/monitoring?project=<project-id>`

2. Navigate to **Metrics Explorer** and explore the following Cloud Run metrics:
   - `run.googleapis.com/request_count` — Requests served (UI access + API calls)
   - `run.googleapis.com/request_latencies` — Request latency (Kestra JVM latency is typically 20–200ms for UI)
   - `run.googleapis.com/container/cpu/utilizations` — CPU utilization (JVM typically 5–30% at idle)
   - `run.googleapis.com/container/memory/utilizations` — Memory utilization (JVM heap, expect 60–80% of 4Gi)
   - `run.googleapis.com/container/instance_count` — Active instance count

3. Filter by:
   - `resource.service_name = kestra-<suffix>`
   - `resource.location = <region>`

   **Expected result:** Charts showing request volume and JVM resource consumption.

4. Check the uptime check (configured by the module to probe `/health`):

   ```bash
   gcloud monitoring uptime list-configs --project=${PROJECT}
   ```

   **Expected result:** An uptime check for the Kestra health endpoint.

5. Monitor flow execution throughput — the queue depth can be approximated by checking the **Executions** tab in the Kestra UI for `RUNNING` executions.

   > **gcloud equivalent:**
   > ```bash
   > gcloud monitoring time-series list \
   >   --project=${PROJECT} \
   >   --filter='metric.type="run.googleapis.com/container/memory/utilizations"'
   > ```

   > **REST API equivalent:**
   > ```
   > GET https://monitoring.googleapis.com/v3/projects/{project}/uptimeCheckConfigs
   > ```

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** All Cloud Run services and jobs, Cloud SQL instance, Secret Manager secrets, Cloud Storage buckets, and supporting IAM resources are deleted.

> **Note:** If `enable_purge = false`, certain resources such as the database and storage buckets will be retained after undeployment to prevent accidental data loss.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Provision Cloud Run service | 1 | Yes |
| Create Cloud SQL PostgreSQL 15 instance | 1 | Yes |
| Mirror container image via Cloud Build | 1 | Yes |
| Configure Secret Manager secrets | 1 | Yes |
| Configure Serverless VPC Access | 1 | Yes |
| Set up IAM bindings | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Verify Kestra /health endpoint | 2 | No |
| Explore Kestra UI tabs | 3 | No |
| Create and execute hello-world flow | 4 | No |
| Add schedule and webhook triggers | 5 | No |
| Test webhook trigger with curl | 5 | No |
| Create and configure a new namespace | 6 | No |
| Add namespace-level variables | 6 | No |
| Explore logs in Cloud Logging | 7 | No |
| Review metrics in Cloud Monitoring | 8 | No |
| Undeploy all resources | 9 | Yes |
