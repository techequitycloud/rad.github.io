---
title: "Windmill on GKE — Lab Guide"
sidebar_label: "Windmill GKE"
---

# Windmill on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Windmill_GKE)**

## Overview

**Estimated time:** 3–4 hours

Windmill is an open-source developer platform for building internal tools, workflows, and scripts in Python, TypeScript, Go, Bash, and more. This lab deploys Windmill on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 16.

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
- Configure kubectl with cluster credentials
- Create Windmill admin account and workspaces
- Create scripts, flows, and apps
- Configure SMTP by updating the placeholder secret
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
2. The `Services GCP` module deployed in the same project (provides VPC, GKE cluster, Cloud SQL instance).
3. The following APIs enabled:
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
| `deploy_application` | No | `true` | Set `false` for infrastructure-only |
| `gke_cluster_name` | No | `""` | Target GKE cluster (auto-discovered if empty) |
| `cpu_limit` | No | `"2000m"` | CPU per pod |
| `memory_limit` | No | `"2Gi"` | Memory per pod |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `db_name` | No | `"windmill"` | PostgreSQL database name |
| `db_user` | No | `"windmill"` | PostgreSQL database user |
| `service_url` | No | `""` | Public URL for BASE_URL |
| `support_users` | No | `[]` | Monitoring alert emails |
| `resource_labels` | No | `{}` | Labels applied to all resources |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI. Fill in required variables and click **Deploy**.

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
| `database_password_secret` | Secret Manager secret for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for later steps:

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
  -o custom-columns=":metadata.name" | grep "^appwindmill" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

export WINDMILL_URL="http://${EXTERNAL_IP}"
echo "Windmill URL: ${WINDMILL_URL}"
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

**Expected result:** kubectl is configured and the context is set to your GKE cluster.

### Step 2.2 — Verify Windmill Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get service -n ${NAMESPACE}
```

**Expected result:** The Windmill pod shows `Running` status and `1/1` ready. The service shows an `EXTERNAL-IP`.

Wait for the external IP to be assigned:
```bash
kubectl get svc -n ${NAMESPACE} --watch
```

### Step 2.3 — Confirm Windmill is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}/api/version
```

**Expected result:** HTTP `200` with Windmill version JSON.

### Step 2.4 — Inspect Environment Variables

```bash
kubectl describe deployment -n ${NAMESPACE} | grep -A2 -E "MODE|NUM_WORKERS|DISABLE_NSJAIL|METRICS_ADDR"
```

**Expected result:** Shows `MODE=server,worker`, `NUM_WORKERS=3`, `DISABLE_NSJAIL=true`, `METRICS_ADDR=:9001`.

---

## Phase 3 — Set Up Windmill Admin [MANUAL]

### Step 3.1 — Access the UI

Open `http://${EXTERNAL_IP}` in a browser.

**Expected result:** The Windmill login page appears.

### Step 3.2 — Create an Admin Account

1. Click **Create account** on the login page.
2. Enter an email address and password. The first account is automatically assigned the `super-admin` role.

**Expected result:** You are redirected to the workspace selection page.

### Step 3.3 — Create a Workspace

1. Click **Create workspace**.
2. Enter workspace ID (e.g., `prod`) and display name (e.g., "Production").
3. Click **Create**.

**Expected result:** You are redirected to the workspace home dashboard.

---

## Phase 4 — Explore Windmill Features [MANUAL]

### Step 4.1 — Create a Python Script

1. Click **Scripts** > **New script**.
2. Select **Python 3** as the language.
3. Enter name `hello_world` and write:
   ```python
   def main(name: str = "World"):
       return f"Hello, {name}!"
   ```
4. Click **Save** > **Test**.

**Expected result:** The script executes in a worker and returns `"Hello, World!"`.

### Step 4.2 — Create a TypeScript Script

1. Click **Scripts** > **New script**.
2. Select **Deno** and write:
   ```typescript
   export async function main(url: string) {
     const res = await fetch(url);
     return { status: res.status };
   }
   ```
3. Test with `url = "https://httpbin.org/get"`.

**Expected result:** Returns `{ status: 200 }`.

### Step 4.3 — Create a Flow with Approval Step

1. Click **Flows** > **New flow**.
2. Add a script step using `hello_world`.
3. Add an approval step (requires manual confirmation).
4. Save and run the flow.

**Expected result:** Flow pauses at the approval step. Accept the approval to continue.

### Step 4.4 — Build an App

1. Click **Apps** > **New app**.
2. Add a **Text Input** and a **Button** component.
3. Connect the button to `hello_world`.
4. Click **Preview**.

**Expected result:** A web UI renders with the input and button. Clicking the button executes the script.

---

## Phase 5 — Configure SMTP [MANUAL]

### Step 5.1 — Retrieve the SMTP Secret Name

```bash
gcloud secrets list --project=${PROJECT} --filter="name~windmill"

export SMTP_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~smtp-password" \
  --format="value(name)" \
  --limit=1)
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3A~windmill"
```

### Step 5.2 — Update the SMTP Password

```bash
echo -n "your-actual-smtp-password" | gcloud secrets versions add ${SMTP_SECRET} \
  --data-file=- --project=${PROJECT}
```

**gcloud equivalent (confirm version added):**
```bash
gcloud secrets versions list ${SMTP_SECRET} --project=${PROJECT}
```

### Step 5.3 — Restart the Pod to Pick Up the New Secret

```bash
kubectl rollout restart deployment -n ${NAMESPACE}
kubectl rollout status deployment -n ${NAMESPACE}
```

### Step 5.4 — Configure SMTP in Windmill UI

1. In Windmill, click the gear icon (top-right) > **Instance settings**.
2. Navigate to **SMTP** and enter your server details.
3. Click **Save**.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Windmill Pod Logs

In the Google Cloud Console, navigate to **Logging > Logs Explorer**:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="windmill"
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

**Expected result:** JSON-formatted logs (from `JSON_FMT=true`). Worker startup and job execution logs are visible.

### Step 6.2 — Filter for Worker Logs

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
jsonPayload.message=~"worker"
```

---

## Phase 7 — Scaling [MANUAL]

### Step 7.1 — Check HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current replicas (1), min (1), max (3), and current CPU utilisation.

### Step 7.2 — Scale to 2 Replicas

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

**Expected result:** A second Windmill pod starts within 60–90 seconds.

### Step 7.3 — Return to Minimum Replicas

```bash
kubectl scale deployment windmill -n ${NAMESPACE} --replicas=1
```

---

## Phase 8 — Cloud Monitoring [MANUAL]

### Step 8.1 — View Container Metrics

Navigate to **Monitoring > Metrics Explorer**. Useful metrics:

| Metric | Description |
|---|---|
| `kubernetes.io/container/cpu/usage_time` | CPU usage per container |
| `kubernetes.io/container/memory/used_bytes` | Memory usage per container |
| `kubernetes.io/pod/restart_count` | Pod restart count |

**gcloud equivalent:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project=${PROJECT}
```

### Step 8.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks**.

**Expected result:** A preconfigured uptime check polling `/api/version` shows **Passing** from multiple global locations.

---

## Phase 9 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** Undeploying permanently deletes all resources including the database. Export scripts, flows, and apps from Windmill Settings before undeploying.

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
| Confirm Windmill reachable | 2 | No |
| Inspect environment variables | 2 | No |
| Create admin account and workspace | 3 | No |
| Create Python and TypeScript scripts | 4 | No |
| Create approval flow | 4 | No |
| Build a UI App | 4 | No |
| Configure SMTP secret | 5 | No |
| Restart pod for new secret | 5 | No |
| Review Cloud Logging | 6 | No |
| Scale pod replicas | 7 | No |
| Review Cloud Monitoring | 8 | No |
| Undeploy infrastructure | 9 | Yes |
