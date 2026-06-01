---
title: "Superset on GKE — Lab Guide"
sidebar_label: "Superset GKE"
---

# Superset on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Superset_GKE)**

## Overview

**Estimated time:** 3–4 hours

Apache Superset is an open-source data visualisation and BI platform. This lab deploys Superset on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, with `ClientIP` session affinity for reliable login sessions and an auto-generated `SUPERSET_SECRET_KEY`.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment
- Cloud SQL PostgreSQL 15 instance, database (`superset_db`), and user (`superset_user`)
- `SUPERSET_SECRET_KEY` (50-char random) in Secret Manager
- Two-phase init: `db-init` + `app-init` (migrations + admin creation)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer) with `ClientIP` session affinity
- Cloud Monitoring uptime checks targeting `/health`
- GCS `superset-data` bucket

### What You Do Manually

- Note deployment outputs from the RAD UI panel
- Configure kubectl with cluster credentials
- Log in as the initial admin user
- Connect data sources and create datasets
- Build charts and dashboards
- Review logs and monitor metrics
- Scale pods and observe HPA

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources |
| `kubectl` | Inspect pods, deployments, services |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project.
3. APIs enabled: `container.googleapis.com`, `sqladmin.googleapis.com`, `secretmanager.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com`
4. `gcloud` authenticated and `kubectl` installed.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"latest"` | Superset version |
| `gke_cluster_name` | No | `""` | GKE cluster name (auto-discovered) |
| `cpu_limit` | No | `"2000m"` | CPU per pod |
| `memory_limit` | No | `"2Gi"` | Memory per pod |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `db_name` | No | `"superset_db"` | Database name |
| `db_user` | No | `"superset_user"` | Database user |
| `session_affinity` | No | `"ClientIP"` | Sticky sessions for login |
| `enable_redis` | No | `false` | Redis for Celery workers |
| `redis_port` | No | `"6379"` | Redis port (string) |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| GKE namespace and workload identity | 2–3 min |
| Container image build + app-init job | 15–20 min |
| Superset pod start | 3–5 min |
| **Total** | **28–40 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance |

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} --format="value(name)" --limit=1)

gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} --project=${PROJECT}

export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appsuperset" | head -1)

export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

export SUPERSET_URL="http://${EXTERNAL_IP}:8088"
echo "Superset URL: ${SUPERSET_URL}"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Verify Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get svc -n ${NAMESPACE}
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

**Expected result:** Pod shows `Running`, `1/1` ready. Service shows `EXTERNAL-IP`.

### Step 2.2 — Confirm Superset is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}:8088/health
```

**Expected result:** HTTP `200`.

---

## Phase 3 — Log In and Explore [MANUAL]

Navigate to `http://${EXTERNAL_IP}:8088`. Log in with the admin credentials created by the `app-init` job.

**gcloud — view app-init logs:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND labels."k8s-pod/batch.kubernetes.io/job-name"~"app-init"' \
  --project=${PROJECT} --limit=50
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND labels.\"k8s-pod/batch.kubernetes.io/job-name\"=~\"app-init\"",
    "pageSize": 20
  }'
```

Change the admin password after first login.

---

## Phase 4 — Connect Data Sources and Create Dashboards [MANUAL]

1. **Settings > Database Connections** > add BigQuery, PostgreSQL, or other connections.
2. **Data > Datasets** > create a dataset from a connected table.
3. **Charts** > create bar, line, or pie charts from datasets.
4. **Dashboards** > assemble charts into a dashboard.

---

## Phase 5 — Explore Logs and Metrics [MANUAL]

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} --limit=50
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

---

## Phase 6 — Scaling [MANUAL]

```bash
kubectl get hpa -n ${NAMESPACE}
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

---

## Phase 7 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** Export dashboards before undeploying (Settings > Export all).

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and workload provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 | 1 | Yes |
| SUPERSET_SECRET_KEY and db-init/app-init | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify pod and service | 2 | No |
| Log in and change password | 3 | No |
| Connect data sources and create dashboards | 4 | No |
| Review logs and metrics | 5 | No |
| Scale pod replicas | 6 | No |
| Undeploy infrastructure | 7 | Yes |
