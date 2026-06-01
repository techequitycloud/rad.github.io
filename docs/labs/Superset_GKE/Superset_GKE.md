---
title: "Superset on GKE — Lab Guide"
sidebar_label: "Superset GKE"
---

# Superset on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Superset_GKE)**

## Overview

**Estimated time:** 3–4 hours

Apache Superset is an open-source data visualisation and business intelligence platform. This lab deploys Superset on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, with `ClientIP` session affinity to ensure reliable login sessions across pod replicas.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment
- Cloud SQL PostgreSQL 15 instance, database (`superset_db`), and user (`superset_user`)
- `SUPERSET_SECRET_KEY` (50-char random) in Secret Manager
- Two-phase init: `db-init` (database) + `app-init` (schema migration + admin creation)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer) with `ClientIP` session affinity
- HorizontalPodAutoscaler
- Cloud Monitoring uptime checks targeting `/health`
- GCS `superset-data` bucket

### What You Do Manually

- Note deployment outputs from the RAD UI panel
- Configure kubectl with GKE cluster credentials
- Log in as the initial admin user and change the password
- Connect data sources (BigQuery, PostgreSQL, MySQL, etc.)
- Create datasets, charts, and dashboards
- Configure alerts and scheduled reports
- Review logs in Cloud Logging and metrics in Cloud Monitoring
- Scale pods and observe HPA behaviour

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
2. The `Services GCP` module deployed in the same project.
3. The following APIs enabled:
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` installed and in PATH.
6. (Optional) A data source to connect.

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
| `gke_cluster_name` | No | `""` | GKE cluster name (auto-discovered if empty) |
| `cpu_limit` | No | `"2000m"` | CPU per pod |
| `memory_limit` | No | `"2Gi"` | Memory per pod |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `db_name` | No | `"superset_db"` | PostgreSQL database name |
| `db_user` | No | `"superset_user"` | PostgreSQL user |
| `session_affinity` | No | `"ClientIP"` | Sticky sessions for reliable login |
| `enable_redis` | No | `false` | Enable Redis for Celery (recommended for production) |
| `redis_host` | No | `""` | Redis hostname/IP |
| `redis_port` | No | `"6379"` | Redis port (string in GKE variant) |
| `support_users` | No | `[]` | Monitoring alert emails |
| `resource_labels` | No | `{}` | Labels for all resources |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| GKE namespace and workload identity | 2–3 min |
| SUPERSET_SECRET_KEY provisioning | 1–2 min |
| Container image build (Cloud Build + psycopg2) | 8–15 min |
| `db-init` + `app-init` jobs | 5–10 min |
| Superset pod start | 3–5 min |
| **Total** | **27–47 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `service_name` | Kubernetes service name |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace (pattern: app<appname><tenant><id>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appsuperset" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

export SUPERSET_URL="http://${EXTERNAL_IP}:8088"
echo "Superset URL: ${SUPERSET_URL}"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Fetch Cluster Credentials

```bash
gcloud container clusters get-credentials \
  $(gcloud container clusters list --project=${PROJECT} --format="value(name)" | head -1) \
  --region=${REGION} \
  --project=${PROJECT}
```

**gcloud equivalent:**
```bash
gcloud container clusters list --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters"
```

**Expected result:** kubectl context is set to your GKE cluster.

### Step 2.2 — Verify Superset Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get svc -n ${NAMESPACE}
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** Pod shows `Running`, `1/1` ready. Service shows `EXTERNAL-IP`. HPA shows current/min/max replicas.

Wait for external IP:
```bash
kubectl get svc -n ${NAMESPACE} --watch
```

### Step 2.3 — Confirm Superset is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}:8088/health
```

**Expected result:** HTTP `200`.

### Step 2.4 — Verify Session Affinity

```bash
kubectl get svc -n ${NAMESPACE} -o jsonpath='{.items[0].spec.sessionAffinity}'
```

**Expected result:** `ClientIP` — ensures Superset login sessions are routed consistently to the same pod.

---

## Phase 3 — Log In as Admin [MANUAL]

### Step 3.1 — Retrieve Admin Credentials from app-init Logs

```bash
# List Kubernetes Jobs in the namespace
kubectl get jobs -n ${NAMESPACE}

# View app-init job pod logs
export INIT_POD=$(kubectl get pods -n ${NAMESPACE} \
  --selector="batch.kubernetes.io/job-name=app-init" \
  --output=jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
  kubectl get pods -n ${NAMESPACE} -o name | grep "app-init" | head -1)

kubectl logs ${INIT_POD} -n ${NAMESPACE}
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --limit=100 \
  --format="table(timestamp, textPayload)" | grep -i "admin\|password\|user"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 50
  }'
```

**Expected result:** The logs show the admin user was created. Default credentials are defined in `app-init.sh` in `Superset_Common/scripts/`.

### Step 3.2 — Log In to Superset

Navigate to `http://${EXTERNAL_IP}:8088` and log in.

**Expected result:** The Superset home page loads with the navigation toolbar.

### Step 3.3 — Change the Admin Password

1. Click the user icon (top-right) > **Profile** > **Reset my password**.
2. Enter a strong password.

---

## Phase 4 — Connect Data Sources and Build Dashboards [MANUAL]

### Step 4.1 — Add a Database Connection

1. **Settings** (gear icon) > **Database Connections** > **+ Database**.
2. Select your database type.
3. Fill in connection parameters. Click **Test connection** > **Connect**.

**Expected result:** Connection appears in the database list.

### Step 4.2 — Create a Dataset

1. **Data** > **Datasets** > **+ Dataset**.
2. Select database, schema, and table.
3. Click **Create dataset and create chart**.

### Step 4.3 — Create Charts

Create bar, line, and pie charts from your dataset. Save each chart.

### Step 4.4 — Build a Dashboard

1. **Dashboards** > **+ Dashboard** > **Edit dashboard**.
2. Drag charts onto the canvas, resize, and save.

---

## Phase 5 — Configure Alerts [MANUAL]

1. **Settings** > **Alerts and Reports** > **+ Alert**.
2. Select a chart, set a condition, and choose a notification channel.
3. Enable the alert.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Superset Pod Logs

In **Logging > Logs Explorer**:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="superset"
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
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Gunicorn access logs and Superset application messages appear.

---

## Phase 7 — Scaling [MANUAL]

### Step 7.1 — Check HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
```

### Step 7.2 — Scale to 2 Replicas

```bash
kubectl scale deployment superset -n ${NAMESPACE} --replicas=2
kubectl get pods -n ${NAMESPACE} --watch
```

**gcloud equivalent (via GKE Workloads console):**
Navigate to **Kubernetes Engine > Workloads**, select the Superset deployment, click **Actions > Scale**.

**REST API equivalent:**
```bash
curl -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json-patch+json" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/namespaces/${NAMESPACE}/deployments/superset" \
  -d '[{"op": "replace", "path": "/spec/replicas", "value": 2}]'
```

**Expected result:** A second Superset pod starts. Both pods share the same PostgreSQL metadata database.

### Step 7.3 — Verify Session Consistency

Log out and log in again. Your session should remain consistent due to `ClientIP` session affinity.

### Step 7.4 — Return to Minimum Replicas

```bash
kubectl scale deployment superset -n ${NAMESPACE} --replicas=1
```

---

## Phase 8 — Cloud Monitoring [MANUAL]

### Step 8.1 — View Container Metrics

Navigate to **Monitoring > Metrics Explorer**.

| Metric | Description |
|---|---|
| `kubernetes.io/container/cpu/usage_time` | CPU usage |
| `kubernetes.io/container/memory/used_bytes` | Memory usage |
| `kubernetes.io/pod/restart_count` | Pod restarts |

**gcloud equivalent:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project=${PROJECT}
```

### Step 8.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks**.

**Expected result:** A check polling `http://${EXTERNAL_IP}:8088/health` shows **Passing**.

---

## Phase 9 — Delete [AUTOMATED]

Return to the RAD UI and click **Delete**.

**Approximate delete duration:** 15–20 minutes.

> **Warning:** Deleting permanently deletes all resources including the metadata database with all dashboards, charts, and datasets. Export everything via **Settings > Export all** before deleting.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and workload provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| SUPERSET_SECRET_KEY in Secret Manager | 1 | Yes |
| db-init and app-init jobs | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify pod, service, HPA | 2 | No |
| Confirm Superset reachable | 2 | No |
| Verify session affinity | 2 | No |
| Retrieve admin credentials | 3 | No |
| Log in and change password | 3 | No |
| Connect data sources | 4 | No |
| Create datasets, charts, dashboards | 4 | No |
| Configure alerts | 5 | No |
| Review Cloud Logging | 6 | No |
| Scale pod replicas | 7 | No |
| Verify session consistency | 7 | No |
| View Cloud Monitoring metrics | 8 | No |
| Review uptime check | 8 | No |
| Delete infrastructure | 9 | Yes |
