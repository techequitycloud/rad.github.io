# Windmill on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Windmill_GKE)**

## Overview

**Estimated time:** 3–4 hours

Windmill is an open-source developer platform for building internal tools, workflows, and scripts. This lab deploys Windmill on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 16, with both the API server and script execution workers running as a combined Kubernetes Deployment.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment
- Cloud SQL PostgreSQL 16 instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- Secret Manager secrets (database password, SMTP password placeholder)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer), HPA, and PodDisruptionBudget
- GCS `windmill-data` bucket for workflow outputs
- `db-init` Kubernetes Job for schema initialisation
- Cloud Monitoring uptime checks targeting `/api/version`

### What You Do Manually

- Note deployment outputs from the RAD UI panel
- Obtain the external load balancer IP and confirm Windmill is reachable
- Configure kubectl with cluster credentials
- Create Windmill admin account and workspaces
- Create scripts, flows, and apps
- Configure SMTP by updating the placeholder secret
- Review logs and metrics

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
2. The `Services_GCP` module deployed in the same project (provides VPC, GKE cluster, Cloud SQL instance).
3. The following APIs enabled (Services_GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` installed and available in PATH.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"latest"` | Windmill image version |
| `gke_cluster_name` | No | `""` | Target GKE cluster (auto-discovered if empty) |
| `cpu_limit` | No | `"2000m"` | CPU per pod |
| `memory_limit` | No | `"2Gi"` | Memory per pod |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `db_name` | No | `"windmill"` | PostgreSQL database name |
| `db_user` | No | `"windmill"` | PostgreSQL database user |
| `service_url` | No | `""` | Public URL for BASE_URL (set to load balancer IP) |
| `support_users` | No | `[]` | Monitoring alert emails |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL 16 instance creation | 8–12 min |
| GKE namespace and workload identity | 2–3 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Windmill pod start and health checks | 2–4 min |
| **Total** | **17–29 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `service_name` | Kubernetes service name |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
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

# Discover the namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appwindmill" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

export WINDMILL_URL="http://${EXTERNAL_IP}"
echo "Windmill URL: ${WINDMILL_URL}"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Verify Windmill Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get service -n ${NAMESPACE}
```

**Expected result:** The Windmill pod shows `Running` status and `1/1` containers ready. The service shows an `EXTERNAL-IP`.

### Step 2.2 — Confirm Windmill is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}/api/version
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

**Expected result:** HTTP `200` with Windmill version JSON.

### Step 2.3 — Inspect Environment Variables

```bash
kubectl describe deployment -n ${NAMESPACE} | grep -A3 -E "MODE|NUM_WORKERS|DISABLE_NSJAIL"
```

**Expected result:** Shows `MODE=server,worker`, `NUM_WORKERS=3`, `DISABLE_NSJAIL=true`.

---

## Phase 3 — Set Up Windmill Admin [MANUAL]

### Step 3.1 — Access the UI

Open `http://${EXTERNAL_IP}` in a browser.

### Step 3.2 — Create Admin Account

1. Click **Create account**.
2. Enter email and password. The first account is automatically `super-admin`.
3. Create a workspace (e.g., ID `prod`, display name "Production").

**Expected result:** You are logged into the Windmill workspace dashboard.

---

## Phase 4 — Explore Features [MANUAL]

### Step 4.1 — Create and Run a Script

1. Click **Scripts** > **New script** > **Python 3**.
2. Write a simple script and click **Save** > **Test**.

**Expected result:** The script executes in a worker and returns results.

### Step 4.2 — Create a Flow

1. Click **Flows** > **New flow** > add script and approval steps.
2. Test the flow to observe multi-step execution.

### Step 4.3 — Build an App

1. Click **Apps** > **New app** to use the drag-and-drop UI builder.
2. Connect components to scripts.

---

## Phase 5 — Configure SMTP [MANUAL]

```bash
# Update the SMTP password secret
export SMTP_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~smtp-password" \
  --format="value(name)" \
  --limit=1)

echo -n "your-smtp-password" | gcloud secrets versions add ${SMTP_SECRET} \
  --data-file=- --project=${PROJECT}
```

In the Windmill UI: **Settings** > **Instance settings** > **SMTP** — enter server, port, and sender details.

---

## Phase 6 — Explore Logs [MANUAL]

### Step 6.1 — View Pod Logs

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
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
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

---

## Phase 7 — Scaling [MANUAL]

### Step 7.1 — Check HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
```

### Step 7.2 — Scale Manually

```bash
kubectl scale deployment windmill -n ${NAMESPACE} --replicas=2
kubectl get pods -n ${NAMESPACE} --watch
```

**gcloud equivalent (via GKE Workloads console):**
Navigate to **Kubernetes Engine > Workloads**, select the Windmill deployment, click **Actions > Scale**.

**REST API equivalent:**
```bash
curl -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json-patch+json" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/namespaces/${NAMESPACE}/deployments/windmill" \
  -d '[{"op": "replace", "path": "/spec/replicas", "value": 2}]'
```

---

## Phase 8 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** Undeploying permanently deletes all resources. Export scripts and flows before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and workload provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 16 database | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Container image build | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify pod running | 2 | No |
| Create admin account and workspace | 3 | No |
| Create scripts, flows, and apps | 4 | No |
| Configure SMTP | 5 | No |
| Review logs | 6 | No |
| Scale pod replicas | 7 | No |
| Undeploy infrastructure | 8 | Yes |
