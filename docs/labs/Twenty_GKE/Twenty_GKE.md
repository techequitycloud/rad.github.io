---
title: "Twenty CRM on GKE Autopilot — Lab Guide"
sidebar_label: "Twenty GKE"
---

# Twenty CRM on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Twenty_GKE)**

## Overview

**Estimated time:** 2–3 hours

Twenty CRM is an open-source customer relationship management platform with 25,000+ GitHub stars. This lab deploys Twenty on Google Kubernetes Engine Autopilot backed by Cloud SQL PostgreSQL 15, Secret Manager for `APP_SECRET` management, and Workload Identity for secure GCP access. GKE Autopilot manages node provisioning and infrastructure automatically.

### What the Module Automates

- GKE Autopilot Deployment with Cloud SQL Auth Proxy sidecar
- Kubernetes Service (LoadBalancer) with optional static IP
- Cloud SQL PostgreSQL 15 instance, database, and user
- Kubernetes namespace and RBAC configuration
- Secret Manager secrets (`APP_SECRET`, DB password, root password)
- Workload Identity Federation for pod-level GCP access
- Artifact Registry repository and Cloud Build image pipeline
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Kubernetes Job

### What You Do Manually

- Note the Kubernetes Service external IP from the RAD UI deployment panel
- Complete the Twenty CRM first-run workspace setup
- Create contacts, companies, and pipeline opportunities
- Explore custom objects and the data model editor
- Test the REST and GraphQL APIs using kubectl and curl
- Review logs in Cloud Logging and pod status via kubectl
- Examine scaling and pod disruption behaviour

---

## CLI and REST API Overview

This lab uses three primary tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect GKE cluster, view logs |
| `kubectl` | Inspect pods, deployments, services, and jobs |
| `curl` | Call the Twenty REST and GraphQL APIs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project with a GKE Autopilot cluster.
3. The following APIs enabled (Services_GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` configured: `gcloud container clusters get-credentials <cluster-name> --region=${REGION} --project=${PROJECT}`
6. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g., `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for GKE and Cloud SQL |
| `application_name` | No | `"twenty"` | Base name for Kubernetes resources and secrets |
| `application_version` | No | `"latest"` | Twenty container image version. Pin for production (e.g., `"0.50.0"`) |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying |
| `container_resources` | No | `{ cpu_limit = "1000m", memory_limit = "1Gi" }` | Pod resource limits |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `application_database_name` | No | `"twenty"` | PostgreSQL database name |
| `application_database_user` | No | `"twenty"` | PostgreSQL database username |
| `enable_redis` | No | `false` | Enable Redis for bull-mq job processing |
| `redis_host` | No | `""` | Redis host (required when `enable_redis = true`) |
| `enable_gcs_storage` | No | `false` | Enable GCS for persistent file attachments |
| `environment_variables` | No | `{}` | Set `SERVER_URL` and `FRONT_BASE_URL` to the external service IP |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `reserve_static_ip` | No | `true` | Reserve a global static IP for the load balancer |
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
| GKE namespace and workload deployment | 3–5 min |
| Database initialisation job (db-init) | 1–2 min |
| **Total** | **17–29 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | External URL of the Kubernetes LoadBalancer service |
| `service_name` | Kubernetes Service name |
| `namespace` | Kubernetes namespace |
| `gke_cluster_name` | GKE cluster name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables and configure kubectl:

```bash
export PROJECT="your-gcp-project-id"   # set this first
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Get the GKE cluster name
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace
export NAMESPACE=$(kubectl get namespaces \
  --selector="app=twenty" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
  kubectl get namespaces -o jsonpath='{.items[*].metadata.name}' | tr ' ' '\n' | grep twenty | head -1)

# Get the external service IP
export SERVICE_IP=$(kubectl get svc -n ${NAMESPACE} \
  --selector="app=twenty" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

export SERVICE_URL="http://${SERVICE_IP}:3000"

echo "Namespace: ${NAMESPACE}"
echo "Service IP: ${SERVICE_IP}"
echo "Service URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Verify the Service External IP

```bash
kubectl get svc -n ${NAMESPACE}
```

**gcloud equivalent:**
```bash
gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION}
```

**Expected result:** The Twenty service shows an EXTERNAL-IP. If `<pending>`, the load balancer is still being provisioned — wait 1–2 minutes.

### Step 2.2 — Confirm Twenty is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health
```

**Expected result:** HTTP `200`. If the pod is still starting, wait 60 seconds (database migrations run on first boot).

### Step 2.3 — Inspect the Pods

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more pods in `Running` state. The Cloud SQL Auth Proxy sidecar appears as a second container in each pod.

```bash
# Describe the Twenty pod for details
kubectl describe pod -n ${NAMESPACE} -l app=twenty | head -80
```

---

## Phase 3 — Set Up Twenty CRM [MANUAL]

### Step 3.1 — Access the Setup Page

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The Twenty workspace setup page appears.

### Step 3.2 — Retrieve APP_SECRET from Secret Manager

```bash
# List Twenty-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~twenty"

# Get the app secret name
export APP_SECRET_NAME=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~app-secret" \
  --format="value(name)" \
  --limit=1)

# Access the value
gcloud secrets versions access latest \
  --secret="${APP_SECRET_NAME}" \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name~twenty"
```

**Expected result:** `APP_SECRET` is a 32-character alphanumeric string. This is used for JWT signing — keep it secure.

### Step 3.3 — Create a Workspace

1. Enter a **workspace name** and **admin email address**.
2. Set a strong admin password.
3. Click **Create workspace**.

**Expected result:** The Twenty CRM dashboard is displayed with empty records.

---

## Phase 4 — Explore Twenty CRM Features [MANUAL]

### Step 4.1 — Create a Contact

1. Click **People** in the left sidebar.
2. Click **+ New**.
3. Enter name and email details.
4. Click **Save**.

**Expected result:** The contact appears in the People list.

### Step 4.2 — Create a Company and Opportunity

1. Click **Companies** > **+ New** — create a company.
2. Click **Opportunities** > **+ New** — create an opportunity linked to the company.

**Expected result:** Company and opportunity records appear in their respective views.

### Step 4.3 — Explore the Data Model Editor

1. Navigate to **Settings** > **Data model**.
2. Review standard objects: People, Companies, Opportunities, Activities.
3. Explore custom object creation.

---

## Phase 5 — API Exploration [MANUAL]

### Step 5.1 — Test the Health Endpoint

```bash
curl -s ${SERVICE_URL}/health | jq .
```

### Step 5.2 — Obtain an API Token

1. In Twenty, navigate to **Settings** > **API**.
2. Click **+ Create token** and name it.
3. Copy the API key.

```bash
export TWENTY_API_KEY="your-api-key-here"
```

### Step 5.3 — Query the REST API

```bash
curl -s \
  -H "Authorization: Bearer ${TWENTY_API_KEY}" \
  "${SERVICE_URL}/api/people" | jq .
```

**Expected result:** A JSON array of people objects.

### Step 5.4 — Query the GraphQL API

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${TWENTY_API_KEY}" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/api" \
  -d '{"query": "{ people { edges { node { id name { firstName lastName } } } } }"}' | jq .
```

**Expected result:** GraphQL response with the people list.

---

## Phase 6 — Kubernetes Inspection [MANUAL]

### Step 6.1 — View Pod Logs

```bash
kubectl logs -n ${NAMESPACE} -l app=twenty --tail=50
```

**Expected result:** Twenty NestJS startup logs including database migration output and `Application is running on port 3000`.

### Step 6.2 — Inspect the Cloud SQL Auth Proxy Sidecar

```bash
kubectl logs -n ${NAMESPACE} -l app=twenty -c cloud-sql-proxy --tail=20
```

**Expected result:** Cloud SQL Auth Proxy connection logs showing successful connection to the PostgreSQL instance.

### Step 6.3 — View the Deployment

```bash
kubectl describe deployment -n ${NAMESPACE} -l app=twenty
```

**REST API equivalent (via kubectl proxy):**
```bash
kubectl proxy &
curl -s "http://localhost:8001/apis/apps/v1/namespaces/${NAMESPACE}/deployments" | jq '.items[0].metadata.name'
```

**Expected result:** Deployment details including replica count, container image, resource limits, and readiness probe configuration.

### Step 6.4 — Verify Workload Identity

```bash
# Get the Kubernetes Service Account
export KSA=$(kubectl get serviceaccounts -n ${NAMESPACE} \
  -o jsonpath='{.items[0].metadata.name}')

# Check Workload Identity annotation
kubectl get serviceaccount ${KSA} -n ${NAMESPACE} \
  -o jsonpath='{.metadata.annotations}'
```

**Expected result:** The annotation `iam.gke.io/gcp-service-account` is present, linking the Kubernetes SA to a GCP SA for Secret Manager access.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Twenty Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

Use the following query:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="twenty"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
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
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Twenty application logs including startup messages and API request logs.

### Step 7.2 — Filter for Errors

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=WARNING
```

---

## Phase 8 — Scaling & Reliability [MANUAL]

### Step 8.1 — Check Pod Replica Count

```bash
kubectl get deployment -n ${NAMESPACE}
```

**Expected result:** Desired and available replica counts match. Default is `min_instance_count = 1`.

### Step 8.2 — Review the Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The Twenty uptime check shows **Passing** from multiple global locations.

### Step 8.3 — View the Initialisation Job

```bash
kubectl get jobs -n ${NAMESPACE}
```

**Expected result:** The `db-init` job shows `COMPLETE` with 1/1 completions.

```bash
# View db-init job logs
export INIT_POD=$(kubectl get pods -n ${NAMESPACE} \
  --selector="job-name=$(kubectl get jobs -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')" \
  -o jsonpath='{.items[0].metadata.name}')
kubectl logs -n ${NAMESPACE} ${INIT_POD} --tail=30
```

**Expected result:** Database initialisation log lines showing successful user and database creation.

### Step 8.4 — Inspect the Background Job Queue

```bash
kubectl get pods -n ${NAMESPACE} \
  -o jsonpath='{.items[*].spec.containers[*].env[?(@.name=="MESSAGE_QUEUE_TYPE")].value}'
```

**Expected result:** `pg-boss` (default) or `bull-mq` if Redis is enabled.

---

## Phase 9 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources.

**Approximate undeploy duration:** 15–25 minutes.

> **Warning:** This permanently deletes all resources including the PostgreSQL database. Export any important Twenty data before undeploying.

Resources provisioned by `Services_GCP` (VPC, GKE cluster, Cloud SQL) are managed separately.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Autopilot Deployment and Service | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager (APP_SECRET, DB password) | 1 | Yes |
| Workload Identity bindings | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Database initialisation job (db-init) | 1 | Yes |
| Configure kubectl context | 1 | No |
| Note service external IP | 2 | No |
| Confirm Twenty is reachable | 2 | No |
| Create workspace and admin account | 3 | No |
| Retrieve APP_SECRET from Secret Manager | 3 | No |
| Create contacts, companies, opportunities | 4 | No |
| Explore data model editor | 4 | No |
| Test REST and GraphQL APIs | 5 | No |
| Inspect pods and Cloud SQL proxy sidecar | 6 | No |
| Verify Workload Identity annotation | 6 | No |
| Review Cloud Logging | 7 | No |
| Check scaling and uptime checks | 8 | No |
| Inspect initialisation job | 8 | No |
| Undeploy infrastructure | 9 | Yes |
