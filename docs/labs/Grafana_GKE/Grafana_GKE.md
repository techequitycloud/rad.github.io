---
title: "Grafana on GKE Autopilot — Lab Guide"
sidebar_label: "Grafana GKE"
---

# Grafana on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grafana_GKE)**

## Overview

**Estimated time:** 3–4 hours

Grafana is an open-source observability and analytics platform used for unified dashboards, alerting, and visualization. This lab deploys Grafana 11.x on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, Workload Identity, and optional StatefulSet PVC storage for persisting Grafana plugins and data.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (or StatefulSet)
- Cloud SQL PostgreSQL 15 instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- Secret Manager secrets (database credentials)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer), HPA, and PodDisruptionBudget
- GCS storage bucket (`grafana-data`)
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Kubernetes CronJob

### What You Do Manually

- Note the deployment outputs (external IP, namespace) from the RAD UI deployment panel
- Configure `kubectl` with cluster credentials
- Obtain the external load balancer IP and confirm Grafana is reachable
- Log in to Grafana using admin credentials
- Add data sources (Prometheus, Cloud Monitoring, BigQuery, etc.)
- Create dashboards and alerts
- Scale pods and observe HPA behaviour
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
| `application_name` | No | `"grafana"` | Base name used in Kubernetes and GCP resource naming |
| `application_version` | No | `"11.4.0"` | Grafana container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the workload |
| `container_resources` | No | `{ cpu_limit="1000m", memory_limit="2Gi" }` | CPU/memory limits |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `application_database_name` | No | `"grafana"` | PostgreSQL database name |
| `application_database_user` | No | `"grafana"` | PostgreSQL database username |
| `workload_type` | No | `null` | `"Deployment"` or `"StatefulSet"` |
| `stateful_pvc_enabled` | No | `null` | Enable PVC for local data persistence |
| `stateful_pvc_size` | No | `"10Gi"` | PVC size per pod |
| `stateful_pvc_mount_path` | No | `"/var/lib/grafana"` | PVC mount path |
| `stateful_fs_group` | No | `472` | fsGroup (Grafana's UID/GID) |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `enable_resource_quota` | No | `false` | Create Kubernetes ResourceQuota |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| GKE namespace and IAM provisioning | 3–5 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Kubernetes Deployment rollout | 3–5 min |
| **Total** | **19–32 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `external_ip` | External load balancer IP for Grafana |
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

## Phase 2 — Configure kubectl and Access Grafana [MANUAL]

### Step 2.1 — Get Cluster Credentials

```bash
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** kubeconfig is updated with credentials for the GKE cluster.

### Step 2.2 — Verify Pods are Running

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more Grafana pods in `Running` state with `READY 2/2` (main container + Cloud SQL Auth Proxy sidecar).

### Step 2.3 — Get the External IP

```bash
kubectl get service -n ${NAMESPACE} --selector="app=grafana" -o wide
```

**Expected result:** A `LoadBalancer` service with an external IP (may take 2–3 minutes to provision).

```bash
export GRAFANA_IP=$(kubectl get service -n ${NAMESPACE} \
  --selector="app=grafana" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${GRAFANA_IP}:3000"
```

### Step 2.4 — Confirm Grafana is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/health
```

**Expected result:** HTTP `200` with body `{"commit":"...","database":"ok","version":"11.x.x"}`.

---

## Phase 3 — Log In and Explore [MANUAL]

### Step 3.1 — Log In to Grafana

Open a browser and navigate to `${SERVICE_URL}`. Log in with:
- **Username**: `admin`
- **Password**: `admin` (or your configured password — change on first login)

### Step 3.2 — Retrieve Database Password

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

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=labels.app%3Dgrafana"
```

---

## Phase 4 — Configure Data Sources [MANUAL]

### Step 4.1 — Add Cloud Monitoring Data Source

1. In Grafana, navigate to **Connections > Data sources** > **Add new data source**.
2. Select **Google Cloud Monitoring**.
3. Set authentication to **Default GCE service account**.
4. Set **Default project** to your GCP project ID.
5. Click **Save & Test**.

**kubectl — verify the Workload Identity annotation:**
```bash
kubectl describe serviceaccount -n ${NAMESPACE} | grep -A2 "Annotations"
```

**Expected result:** The Kubernetes service account has a Workload Identity annotation linking it to the GCP service account.

### Step 4.2 — Add a Prometheus Data Source (if available)

1. Navigate to **Connections > Data sources** > **Add new data source**.
2. Select **Prometheus**.
3. Set the URL to your Prometheus endpoint (e.g., `http://prometheus-server.monitoring.svc.cluster.local`).
4. Click **Save & Test**.

---

## Phase 5 — Create Dashboards [MANUAL]

### Step 5.1 — Create a GKE Dashboard

1. Navigate to **Dashboards** > **New** > **New dashboard**.
2. Add a panel with a Cloud Monitoring data source.
3. Select metric: `kubernetes.io/container/cpu/core_usage_time`.
4. Filter by `container_name = grafana`.
5. Click **Apply**, then **Save dashboard**.

### Step 5.2 — Import a Pre-built Dashboard

1. Navigate to **Dashboards** > **New** > **Import**.
2. Enter dashboard ID `315` (Kubernetes cluster monitoring by Grafana Labs).
3. Select your data source and click **Import**.

**Expected result:** A pre-built Kubernetes monitoring dashboard appears.

---

## Phase 6 — Observe Kubernetes Behaviour [MANUAL]

### Step 6.1 — Check Pod Details

```bash
kubectl describe pod -n ${NAMESPACE} -l app=grafana | head -80
```

**Expected result:** Pod spec includes the Cloud SQL Auth Proxy as a sidecar container, environment variables from Secret Manager, and `GF_DATABASE_TYPE=postgres`.

### Step 6.2 — View Pod Logs

```bash
kubectl logs -n ${NAMESPACE} -l app=grafana -c grafana --tail=50
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND resource.labels.container_name="grafana"' \
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
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND resource.labels.container_name=\"grafana\"",
    "pageSize": 20
  }'
```

**Expected result:** Grafana startup logs showing database connection and readiness.

### Step 6.3 — Observe HPA Scaling

```bash
kubectl get hpa -n ${NAMESPACE}
```

Generate load:
```bash
for i in $(seq 1 50); do curl -s -o /dev/null ${SERVICE_URL}/api/health; done
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** HPA shows current/desired replicas. Under load, new pods may be scheduled. With `min_instance_count = 1`, at least one pod is always running.

### Step 6.4 — Check the PodDisruptionBudget

```bash
kubectl get pdb -n ${NAMESPACE}
```

**Expected result:** A PDB exists with `MIN AVAILABLE: 1`, preventing all Grafana pods from being disrupted simultaneously during cluster maintenance.

---

## Phase 7 — StatefulSet and PVC (if enabled) [MANUAL]

### Step 7.1 — Verify PVC Binding

If `stateful_pvc_enabled = true`:

```bash
kubectl get pvc -n ${NAMESPACE}
```

**Expected result:** One PVC per pod in `Bound` state, mounted at `/var/lib/grafana`.

### Step 7.2 — Verify fsGroup

```bash
kubectl get pod -n ${NAMESPACE} -l app=grafana -o jsonpath='{.items[0].spec.securityContext}' | jq .
```

**Expected result:** `{"fsGroup": 472}` — ensures the Grafana process (UID 472) can write to the PVC.

---

## Phase 8 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources.

**Approximate undeploy duration:** 15–25 minutes (Cloud SQL and PVC deletion take the longest).

> **Warning:** This permanently deletes all resources including the database and PVCs. Export your dashboards before undeploying using the Grafana HTTP API or the Export JSON function in the Grafana UI.

Resources provisioned by the `Services GCP` module (VPC, GKE cluster, Cloud SQL instance) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and Kubernetes Deployment | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Cloud SQL Auth Proxy sidecar | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Workload Identity and IAM bindings | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| HPA and PodDisruptionBudget | 1 | Yes |
| Configure kubectl credentials | 2 | No |
| Confirm external IP and Grafana reachability | 2 | No |
| Log in to Grafana | 3 | No |
| Add data sources | 4 | No |
| Create dashboards and panels | 5 | No |
| Observe pods, logs, HPA | 6 | No |
| Verify StatefulSet PVC (if enabled) | 7 | No |
| Undeploy infrastructure | 8 | Yes |
