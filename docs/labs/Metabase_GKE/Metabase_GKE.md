---
title: "Metabase on GKE Autopilot — Lab Guide"
sidebar_label: "Metabase GKE"
---

# Metabase on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Metabase_GKE)**

## Overview

**Estimated time:** 3–4 hours

Metabase is an open-source business intelligence platform that enables non-technical users to query and visualize data without SQL. This lab deploys Metabase on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, Workload Identity, and session-affinity-enabled LoadBalancer. A `db-init` Kubernetes Job initializes the PostgreSQL schema before Metabase's first boot.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment
- Cloud SQL PostgreSQL 15 instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- `db-init` Kubernetes Job (creates Metabase database schema before first boot)
- Secret Manager secrets (database credentials)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer) with `ClientIP` session affinity
- HPA and PodDisruptionBudget
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Kubernetes CronJob

### What You Do Manually

- Note the deployment outputs (external IP, namespace) from the RAD UI deployment panel
- Configure `kubectl` with cluster credentials
- Obtain the external load balancer IP and confirm Metabase is reachable
- Wait for Metabase JVM startup (60–120 seconds)
- Complete the Metabase setup wizard
- Connect data sources (BigQuery, Cloud SQL, PostgreSQL, etc.)
- Create questions, dashboards, and collections
- Configure users and permissions
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources |
| `kubectl` | Inspect pods, deployments, and services |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, GKE cluster, Cloud SQL instance).
3. Access to the RAD UI with permission to deploy modules in the target GCP project.
4. The following APIs enabled (Services GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
5. `gcloud` authenticated: `gcloud auth application-default login`
6. `kubectl` installed and available in PATH.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for resources |
| `application_name` | No | `"metabase"` | Base name used in Kubernetes and GCP resource naming |
| `application_version` | No | `"v0.51.3"` | Metabase container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the workload |
| `container_resources` | No | `{ cpu_limit="2000m", memory_limit="4Gi" }` | CPU/memory limits |
| `min_instance_count` | No | `1` | Minimum pod replicas. Keep at `1` for production (eliminates 60–120s JVM cold starts) |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `application_database_name` | No | `"metabase"` | PostgreSQL database name |
| `application_database_user` | No | `"metabase"` | PostgreSQL database username |
| `session_affinity` | No | `"ClientIP"` | Sticky sessions — required to prevent session loss on HPA scale-out |
| `termination_grace_period_seconds` | No | `60` | Seconds Kubernetes waits after SIGTERM before killing pods (allows in-flight queries to complete) |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| `db-init` Kubernetes Job execution | 2–3 min |
| GKE namespace and IAM provisioning | 3–5 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Kubernetes Deployment rollout | 3–5 min |
| **Total** | **21–35 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `external_ip` | External load balancer IP for Metabase |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)
export NAMESPACE=$(kubectl get namespaces \
  --selector="app.kubernetes.io/managed-by=terraform" \
  -o jsonpath='{.items[0].metadata.name}')
```

---

## Phase 2 — Configure kubectl and Access Metabase [MANUAL]

### Step 2.1 — Get Cluster Credentials

```bash
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** kubeconfig is updated with credentials for the GKE cluster.

### Step 2.2 — Verify the db-init Job Completed

```bash
kubectl get jobs -n ${NAMESPACE}
```

**Expected result:** A job named `metabase-db-init` (or similar) with `COMPLETIONS: 1/1` and `STATUS: Complete`. If the job shows `Failed`, check the logs:

```bash
kubectl logs -n ${NAMESPACE} -l job-name=metabase-db-init
```

### Step 2.3 — Verify Pods are Running

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more Metabase pods in `Running` state with `READY 2/2` (main container + Cloud SQL Auth Proxy sidecar).

### Step 2.4 — Get the External IP

```bash
kubectl get service -n ${NAMESPACE} --selector="app=metabase" -o wide
```

**Expected result:** A `LoadBalancer` service with an external IP (may take 2–3 minutes to provision).

```bash
export METABASE_IP=$(kubectl get service -n ${NAMESPACE} \
  --selector="app=metabase" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${METABASE_IP}:3000"
```

### Step 2.5 — Wait for Metabase JVM Startup

Metabase takes 60–120 seconds to fully initialize. Poll the health endpoint:

```bash
until curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/health | grep -q "200"; do
  echo "Waiting for Metabase..."; sleep 10
done
echo "Metabase is ready"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND textPayload:"Metabase Initialization COMPLETE"' \
  --project=${PROJECT} \
  --limit=5
```

### Step 2.6 — Check the Health Endpoint

```bash
curl -s ${SERVICE_URL}/api/health | jq .
```

**Expected result:**
```json
{"status": "ok"}
```

---

## Phase 3 — Complete the Setup Wizard [MANUAL]

### Step 3.1 — Access the Setup Wizard

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The Metabase setup wizard appears. On subsequent visits after setup is complete, the login page is shown instead.

### Step 3.2 — Complete Initial Setup

1. **Select language**: Choose your preferred language and click **Let's get started**.
2. **Admin account**: Enter your name, email, and a strong password.
3. **Add a data source** (optional — skip to connect later):
   - Click **Add your data** or **I'll add my data later**.
4. **Usage data**: Choose whether to allow Metabase to collect anonymized usage data.
5. Click **Take me to Metabase**.

**Expected result:** You are redirected to the Metabase home screen.

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

**gcloud — grant the Metabase GKE service account BigQuery access:**
```bash
export KSA=$(kubectl get serviceaccount -n ${NAMESPACE} \
  -o jsonpath='{.items[0].metadata.name}')
export GSA=$(kubectl get serviceaccount -n ${NAMESPACE} ${KSA} \
  -o jsonpath='{.metadata.annotations.iam\.gke\.io/gcp-service-account}')
gcloud projects add-iam-policy-binding ${PROJECT} \
  --member="serviceAccount:${GSA}" \
  --role="roles/bigquery.dataViewer"
```

**Expected result:** After saving, Metabase syncs BigQuery metadata. Tables appear in the Data Browser within 2–5 minutes.

### Step 4.2 — Connect to Cloud SQL PostgreSQL

1. Navigate to **Admin > Databases** > **Add a database**.
2. Select **PostgreSQL**.
3. Configure:
   - **Host**: Cloud SQL internal IP or the Auth Proxy socket path (`/cloudsql/<instance>`)
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
  --format="value(connectionName)"
```

### Step 4.3 — Verify Data Source Connection

```bash
# List connected databases via Metabase API
curl -s -u admin@example.com:yourpassword \
  ${SERVICE_URL}/api/database \
  | jq '.[].name'
```

**Expected result:** Your connected databases are listed. Metabase begins scanning table metadata in the background.

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

## Phase 6 — Observe Kubernetes Behaviour [MANUAL]

### Step 6.1 — Check Pod Details

```bash
kubectl describe pod -n ${NAMESPACE} -l app=metabase | head -80
```

**Expected result:** Pod spec includes the Cloud SQL Auth Proxy as a sidecar container, environment variables from Secret Manager, and `MB_JETTY_PORT=3000` and `JAVA_TIMEZONE=UTC`.

### Step 6.2 — View Pod Logs

```bash
kubectl logs -n ${NAMESPACE} -l app=metabase -c metabase --tail=50
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND resource.labels.container_name="metabase"' \
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
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND resource.labels.container_name=\"metabase\"",
    "pageSize": 20
  }'
```

**Expected result:** Metabase JVM startup logs, including `Metabase Initialization COMPLETE` after the 60–120 second startup sequence.

### Step 6.3 — Observe HPA and Session Affinity

```bash
kubectl get hpa -n ${NAMESPACE}
```

Verify session affinity is configured:
```bash
kubectl get service -n ${NAMESPACE} --selector="app=metabase" \
  -o jsonpath='{.items[0].spec.sessionAffinity}'
```

**Expected result:** `ClientIP` — requests from the same client IP are routed to the same pod, preventing session loss during scale-out events.

Generate load to trigger scaling:
```bash
for i in $(seq 1 50); do curl -s -o /dev/null ${SERVICE_URL}/api/health; done
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** HPA schedules additional pods. Existing sessions remain on their original pods due to `ClientIP` affinity.

### Step 6.4 — Check the PodDisruptionBudget

```bash
kubectl get pdb -n ${NAMESPACE}
```

**Expected result:** A PDB with `MIN AVAILABLE: 1`, ensuring at least one Metabase pod is always available during cluster maintenance.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — Filter for JVM Warnings

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20
```

**Expected result:** Under normal operation, only informational logs appear.

### Step 7.2 — Review the Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `/api/health` shows **Passing**.

---

## Phase 8 — Configure Metabase [MANUAL]

### Step 8.1 — Set Up Email Notifications

Configure via `environment_variables` in the RAD UI:

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

Or navigate to **Admin > Email** in the Metabase UI.

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

## Phase 9 — Delete [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources.

**Approximate delete duration:** 15–25 minutes (Cloud SQL and PVC deletion take the longest).

> **Warning:** This permanently deletes all resources including the Metabase application database (all questions, dashboards, users, collections). Export your data model before deleting: **Admin > Serialization** (Metabase Pro/Enterprise) or export individual questions as CSV/JSON.

Resources provisioned by the `Services GCP` module (VPC, GKE cluster, Cloud SQL instance) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and Kubernetes Deployment | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| `db-init` Kubernetes Job (schema init) | 1 | Yes |
| Cloud SQL Auth Proxy sidecar | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Workload Identity and IAM bindings | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| HPA and PodDisruptionBudget | 1 | Yes |
| Configure kubectl credentials | 2 | No |
| Confirm external IP and Metabase reachability | 2 | No |
| Complete setup wizard (admin account, language) | 3 | No |
| Connect BigQuery data source | 4 | No |
| Connect Cloud SQL PostgreSQL data source | 4 | No |
| Create questions and dashboards | 5 | No |
| Observe pods, logs, HPA, session affinity | 6 | No |
| Review Cloud Logging | 7 | No |
| Configure SMTP and authentication | 8 | No |
| Delete infrastructure | 9 | Yes |
