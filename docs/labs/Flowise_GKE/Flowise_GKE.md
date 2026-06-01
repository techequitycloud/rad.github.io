---
title: "Flowise on GKE Autopilot — Lab Guide"
sidebar_label: "Flowise GKE"
---

# Flowise on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Flowise_GKE)**

## Overview

**Estimated time:** 1–2 hours

Flowise is a visual AI workflow builder that lets users create LLM-powered chatflows, agentflows, and assistants using a drag-and-drop interface. This lab deploys Flowise on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL (PostgreSQL 15) and Cloud Storage.

### What the Module Automates

- GKE Autopilot workload (Kubernetes Deployment + Service + HPA)
- Cloud SQL PostgreSQL 15 instance, database, and user
- Cloud Storage bucket for Flowise data
- Artifact Registry repository and container image build (Cloud Build)
- Secret Manager secrets (database password, Flowise credentials)
- Cloud Monitoring uptime checks and notification channels
- Kubernetes namespace, health probes, and optional IAP

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Connect to the cluster with `kubectl`
- Verify the Flowise pod is running
- Access the Flowise UI and log in
- Build chatflows using the drag-and-drop interface
- Test the Flowise REST API
- Browse the Marketplace for flow templates
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

This lab uses three sets of tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Interact with GCP services (secrets, logs, metrics) |
| `kubectl` | Manage Kubernetes workloads and access pods |
| `curl` | Call the Flowise REST API |

---

## Prerequisites

- GCP project with billing enabled
- `Services GCP` module deployed (provides VPC, GKE Autopilot cluster, Cloud SQL instance, Artifact Registry)
- Access to the RAD UI with permission to deploy modules in the target GCP project
- `gcloud` CLI authenticated (`gcloud auth application-default login`)
- `kubectl` configured or configurable via `gcloud container clusters get-credentials`
- An LLM API key (e.g., OpenAI, Google AI) if you want to test live AI nodes

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. Use the table below to understand what each field controls.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for all resource names |
| `region` | No | `us-central1` | GCP region |
| `application_name` | No | `flowise` | Base name for Kubernetes resources and secrets |
| `application_version` | No | `latest` | Container image tag |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `gke_cluster_name` | No | auto-discover | Name of the GKE Autopilot cluster |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `1` | Maximum pod replicas |
| `flowise_username` | No | `admin` | Flowise UI admin username |
| `application_database_name` | No | `flowisedb` | PostgreSQL database name |
| `application_database_user` | No | `flowiseuser` | PostgreSQL database user |
| `database_password_length` | No | `32` | Generated password length (16–64) |
| `database_type` | No | `POSTGRES_15` | Cloud SQL engine |
| `service_type` | No | `LoadBalancer` | Kubernetes Service type |
| `container_resources` | No | `cpu=1000m, mem=1Gi` | Pod CPU and memory limits |
| `enable_iap` | No | `false` | Enable Identity-Aware Proxy |
| `enable_cloud_armor` | No | `false` | Enable Cloud Armor WAF on Ingress |
| `create_cloud_storage` | No | `true` | Provision GCS data bucket |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

### Estimated Deployment Duration

| Step | Estimated Time |
|---|---|
| Cloud Build image build | 5–10 minutes |
| Cloud SQL provisioning | 5–10 minutes |
| GKE Autopilot pod scheduling | 3–5 minutes |
| Secret propagation and health checks | 1–2 minutes |
| **Total** | **15–30 minutes** |

### Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | External URL for the Flowise service |
| `service_external_ip` | LoadBalancer external IP address |
| `namespace` | Kubernetes namespace |
| `service_name` | Kubernetes service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for the DB password |
| `storage_buckets` | Created GCS bucket names |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps using discovery commands:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
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

# Discover the namespace (pattern: app<appname><tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appflowise" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~flowise" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Connect to the Cluster [MANUAL]

**Goal:** Authenticate `kubectl` and verify the Flowise pod is running.

1. Get credentials for the GKE cluster:

   ```bash
   gcloud container clusters get-credentials ${CLUSTER} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **Expected result:** `kubeconfig entry generated for <cluster-name>`

2. Find the Flowise namespace:

   ```bash
   kubectl get namespaces | grep flowise
   ```

3. Verify the pod is running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:** A pod with name starting `flowise-` in `Running` status.

4. Describe the pod for detailed status:

   ```bash
   kubectl describe pod -l app=flowise -n ${NAMESPACE}
   ```

5. Get the LoadBalancer external IP:

   ```bash
   kubectl get service -n ${NAMESPACE}
   ```

   **Expected result:** The `EXTERNAL-IP` column shows a routable IP address.

**gcloud equivalent — list GKE workloads:**

```bash
gcloud container clusters describe ${CLUSTER} \
  --region ${REGION} \
  --format="value(status)"
```

---

## Phase 3 — Explore the Flowise Interface [MANUAL]

**Goal:** Access the Flowise web UI and navigate its main sections.

1. Open a browser and navigate to the Flowise service URL:

   ```
   http://${EXTERNAL_IP}:3000
   ```

   Or use the `service_url` output from the RAD UI deployment panel if a domain is configured.

2. If authentication is enabled, retrieve your credentials from Secret Manager:

   ```bash
   gcloud secrets versions access latest \
     --secret="${DB_SECRET}" \
     --project=${PROJECT}
   ```

   Log in with username `admin` (or your configured `flowise_username`) and the retrieved password.

   **Expected result:** The Flowise dashboard loads.

3. Explore the main navigation tabs:

   - **Chatflows** — visual LLM pipeline builder
   - **Agentflows** — multi-step agent orchestration
   - **Assistants** — OpenAI Assistants integration
   - **Marketplace** — pre-built flow templates

4. Click **Chatflows** and note the empty canvas — this is where you build AI pipelines.

**gcloud equivalent — list secrets:**

```bash
gcloud secrets list --project=${PROJECT} --filter="name~flowise"
```

---

## Phase 4 — Build a Simple Chatflow [MANUAL]

**Goal:** Create a working AI chatflow using drag-and-drop nodes.

1. Navigate to **Chatflows** and click **Add New**.

2. In the node panel on the right, search for and drag a **Chat Model** node onto the canvas (e.g., `ChatOpenAI` or `ChatGoogleGenerativeAI`).

3. Configure the Chat Model node:
   - Set your API key (or reference a Secret Manager secret)
   - Choose a model (e.g., `gpt-3.5-turbo` or `gemini-1.5-flash`)

4. Search for and drag a **Conversation Chain** node onto the canvas.

5. Connect the Chat Model output to the **Language Model** input of the Conversation Chain.

6. Search for and drag a **Buffer Memory** node onto the canvas.

7. Connect the Buffer Memory output to the **Memory** input of the Conversation Chain.

8. Click **Save** and name your chatflow (e.g., `My First Chatflow`).

9. Click the **Chat** icon (speech bubble) in the top right to open the chat preview.

10. Type a few messages:
    - `Hello, how are you?`
    - `What is Kubernetes?`
    - `Remember that I prefer short answers.`

    **Expected result:** The model responds and retains context across messages (demonstrating Buffer Memory).

11. Close the chat preview and note the **Chatflow ID** in the URL bar — you will use it in the next phase.

---

## Phase 5 — Explore the API [MANUAL]

**Goal:** Use the Flowise REST API to send predictions programmatically.

1. Navigate to your chatflow and copy the **Chatflow ID** from the URL:

   ```
   http://${EXTERNAL_IP}:3000/chatflows/<chatflow-id>
   ```

2. Send a prediction using the public API:

   ```bash
   curl -X POST http://${EXTERNAL_IP}:3000/api/v1/prediction/<chatflow-id> \
     -H "Content-Type: application/json" \
     -d '{"question": "What is GCP?"}'
   ```

   **Expected result:** A JSON response containing the model's answer.

3. Create an API key for authenticated access:
   - In the Flowise UI, navigate to **Settings > API Keys**
   - Click **Add New Key**, name it `lab-key`
   - Copy the generated API key

4. Test authenticated API access:

   ```bash
   curl -X POST http://${EXTERNAL_IP}:3000/api/v1/prediction/<chatflow-id> \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <your-api-key>" \
     -d '{"question": "Summarize what Flowise does in one sentence."}'
   ```

   **Expected result:** A JSON response identical in structure to the unauthenticated call.

5. List all available chatflows via API:

   ```bash
   curl http://${EXTERNAL_IP}:3000/api/v1/chatflows \
     -H "Authorization: Bearer <your-api-key>"
   ```

**REST API reference:** `http://${EXTERNAL_IP}:3000/api/v1/` (Swagger UI available at `/api/v1/`)

---

## Phase 6 — Marketplace and Templates [MANUAL]

**Goal:** Discover and import pre-built chatflow templates.

1. Navigate to **Marketplace** in the left sidebar.

2. Browse the available templates. Look for categories such as:
   - RAG (Retrieval-Augmented Generation)
   - Agent templates
   - Memory chatflows

3. Click a template (e.g., a **RAG chatflow** or a **ReAct Agent**) to preview it.

4. Click **Use Template** to import it into your Chatflows.

5. Open the imported flow and explore its nodes:
   - Identify the data source node (e.g., PDF Loader, URL Loader)
   - Identify the vector store node (e.g., Chroma, Pinecone)
   - Identify the LLM node

6. Note how the nodes are pre-wired — Marketplace templates give you a working starting point.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

**Goal:** View Flowise application logs in Cloud Logging.

1. Open the Cloud Console Logs Explorer:

   ```
   https://console.cloud.google.com/logs/query?project=${PROJECT}
   ```

2. Query Flowise container logs:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="flowise"
   ```

3. Look for log entries showing:
   - Flowise server startup: `Flowise Server: Running`
   - Database connection events
   - API prediction requests
   - Any error messages

4. Using gcloud CLI:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --format="table(timestamp,jsonPayload.message)"
   ```

**Expected result:** Log entries showing the Flowise Node.js server running and handling requests.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

**Goal:** Inspect service-level metrics for the Flowise deployment.

1. Open the Cloud Console Monitoring dashboard:

   ```
   https://console.cloud.google.com/monitoring?project=${PROJECT}
   ```

2. Navigate to **Metrics Explorer** and query:

   - Metric: `kubernetes.io/container/cpu/request_utilization`
   - Filter by `namespace_name = ${NAMESPACE}`

3. Check Kubernetes workload metrics:

   ```bash
   gcloud monitoring metrics list \
     --filter="metric.type=starts_with('kubernetes.io/container')" \
     --project=${PROJECT}
   ```

4. View HPA (Horizontal Pod Autoscaler) status:

   ```bash
   kubectl get hpa -n ${NAMESPACE}
   ```

5. Check uptime check status (if configured):

   ```bash
   gcloud monitoring uptime list --project=${PROJECT}
   ```

**Expected result:** CPU and memory utilization graphs for the Flowise pod, and uptime check passing.

---

## Phase 9 — Delete [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

**What is removed:**
- Kubernetes Deployment, Service, and namespace
- Cloud SQL instance, database, and user
- GCS storage bucket (if `enable_purge = true`)
- Secret Manager secrets
- Artifact Registry images
- Cloud Monitoring uptime checks and alert policies

**Estimated time:** 10–20 minutes

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Learned |
|---|---|---|
| Phase 1 — Deploy | Automated | RAD UI provisions GKE workload, Cloud SQL, GCS, and secrets |
| Phase 2 — Connect to Cluster | Manual | `kubectl` authentication and pod verification |
| Phase 3 — Explore the UI | Manual | Flowise dashboard navigation and authentication via Secret Manager |
| Phase 4 — Build a Chatflow | Manual | Drag-and-drop LLM pipeline with memory |
| Phase 5 — Explore the API | Manual | REST API predictions and API key management |
| Phase 6 — Marketplace | Manual | Importing pre-built flow templates |
| Phase 7 — Cloud Logging | Manual | Viewing Flowise container logs in GKE |
| Phase 8 — Cloud Monitoring | Manual | CPU/memory metrics and HPA status |
| Phase 9 — Delete | Automated | Clean teardown of all resources |
