---
title: "n8n on GKE — Lab Guide"
sidebar_label: "N8N GKE Lab"
---

# n8n on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_GKE)**

## Overview

**Estimated time:** 1–2 hours

n8n is a fair-code workflow automation platform with a visual canvas editor, 400+ integrations, webhook triggers, HTTP request nodes, and scheduled workflows. This module deploys n8n on GKE Autopilot backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for shared persistence, and optional Redis queue mode for scalable multi-worker execution.

### What the Module Automates

- GKE Autopilot cluster discovery and namespace creation
- Container image mirror to Artifact Registry via Cloud Build
- Kubernetes Deployment, Service (LoadBalancer with session affinity), and HPA
- Cloud SQL PostgreSQL 15 instance, database, and user provisioning
- Cloud SQL Auth Proxy sidecar injection
- Cloud Filestore (NFS) provisioning and GCS Fuse CSI volume mounts
- Secret Manager secrets (encryption key, DB password, SMTP credentials)
- Workload Identity and IAM bindings for the application service account
- Redis host injection (defaults to NFS server IP when `enable_redis = true`)
- Kubernetes initialization jobs for database setup
- Scheduled backup CronJob and backup GCS bucket
- Cloud Monitoring uptime checks and alert policies
- VPC firewall rules and network tags

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Complete the n8n initial account setup on first login
- Create and test workflows, webhook triggers, and credentials
- Examine execution history, error handling, and logging
- Observe HPA scaling behaviour

---

## CLI and REST API Overview

The steps in this guide include equivalent `gcloud` commands and Kubernetes (`kubectl`) commands alongside the console instructions. REST API equivalents are provided for key operations.

**Tools used:**
- `gcloud` CLI — GCP resource management
- `kubectl` — Kubernetes cluster operations
- `curl` — webhook and HTTP testing

---

## Prerequisites

- A GCP project with the Services_GCP platform module already deployed
- `gcloud` CLI authenticated: `gcloud auth login && gcloud config set project PROJECT_ID`
- `kubectl` installed
- Owner or Editor role on the target GCP project
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the N8N_GKE module and fill in the deployment form with the following values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix for resource names |
| `region` | No | `us-central1` | GCP region for deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier (1–20 chars) |
| `application_name` | No | `n8n` | Base name for Kubernetes and Artifact Registry resources |
| `application_version` | No | `2.4.7` | n8n image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | HPA minimum pod replicas |
| `max_instance_count` | No | `3` | HPA maximum pod replicas |
| `cpu_limit` | No | `2000m` | CPU limit per n8n pod |
| `memory_limit` | No | `4Gi` | Memory limit per n8n pod |
| `enable_redis` | No | `true` | Enable Redis queue mode backend |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP when empty) |
| `redis_port` | No | `6379` | Redis server port |
| `db_name` | No | `n8n_db` | PostgreSQL database name |
| `db_user` | No | `n8n_user` | PostgreSQL database username |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS for shared persistence |
| `nfs_mount_path` | No | `/mnt/nfs` | Container mount path for the NFS volume |
| `service_type` | No | `LoadBalancer` | Kubernetes Service type |
| `session_affinity` | No | `ClientIP` | Session stickiness for the Kubernetes Service |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Deploy

Click **Deploy** in the RAD UI. Deployment takes approximately 10–15 minutes.

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `service_url` | Application URL |
| `database_instance_name` | Cloud SQL instance name |
| `nfs_server_ip` | NFS server IP (sensitive) |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

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

# Discover the namespace (pattern: appn8ndemo<deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appn8n" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~n8n" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Configure kubectl and Verify n8n Pod [MANUAL]

### Step 2.1 — Get GKE Credentials

```bash
gcloud container clusters get-credentials <cluster-name> \
  --region <region> \
  --project <project-id>
```

To find the cluster name:
```bash
gcloud container clusters list --project <project-id>
```

**Expected result:** `kubeconfig entry generated for <cluster-name>`

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://container.googleapis.com/v1/projects/<project-id>/locations/<region>/clusters"
```

### Step 2.2 — Verify the n8n Pod is Running

```bash
# List all pods across all namespaces to find the n8n namespace
kubectl get pods --all-namespaces | grep n8n

# Or target the namespace directly (format: appn8ndemo<id>)
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** The n8n pod should show `Running` with `2/2` containers ready (application + Cloud SQL Auth Proxy sidecar). Initial startup may take 2–3 minutes while the startup probe waits for database migrations.

```
NAME                      READY   STATUS    RESTARTS   AGE
appn8ndemo<id>-xxx-yyy    2/2     Running   0          3m
```

### Step 2.3 — Get the External IP

```bash
kubectl get service -n ${NAMESPACE}
```

**Expected result:**

```
NAME               TYPE           CLUSTER-IP    EXTERNAL-IP   PORT(S)          AGE
appn8ndemo<id>     LoadBalancer   10.x.x.x      34.x.x.x      5678:XXXXX/TCP   5m
```

The `EXTERNAL-IP` is the address you use to access n8n. Note: if the IP shows `<pending>`, wait another 1–2 minutes for the load balancer to provision.

**gcloud equivalent:**
```bash
gcloud compute forwarding-rules list --project <project-id>
```

---

## Phase 3 — Explore the n8n Workflow Editor [MANUAL]

### Step 3.1 — Access the n8n UI

Open your browser and navigate to:
```
http://<EXTERNAL-IP>:5678
```

Alternatively, use port-forward for local access without exposing an external IP:
```bash
kubectl port-forward service/${NAMESPACE} 5678:5678 -n ${NAMESPACE}
# Then open http://localhost:5678
```

**Expected result:** The n8n welcome page or account creation screen appears.

### Step 3.2 — Create an Admin Account

On first launch, n8n prompts you to create an owner account. Enter:
- **Email:** your admin email address
- **First name / Last name:** your name
- **Password:** a strong password (minimum 8 characters)

Click **Next** and complete the setup wizard. This account becomes the owner of the n8n instance. Credentials are stored in the PostgreSQL database.

**Expected result:** You are redirected to the n8n canvas (workflow editor).

### Step 3.3 — Tour the Canvas

1. **Canvas:** The main drag-and-drop workflow editor. Nodes represent operations; connections define the data flow.
2. **Left sidebar:** Click **Workflows** to see all saved workflows. Click **+ New workflow** to create one.
3. **Template gallery:** Click **Templates** in the left sidebar to browse 1,000+ pre-built workflow templates.
4. **Credentials:** Click the user icon (bottom-left) and select **Settings → Credentials** to manage API keys and auth.

### Step 3.4 — Create a Simple Workflow

1. Click **+ New workflow**.
2. Click the **+** button on the canvas to add a node. Search for **Manual Trigger** and select it.
3. Click the **+** on the right edge of the Manual Trigger node. Search for **HTTP Request** and select it.
   - Set **URL** to `https://httpbin.org/get`
   - Set **Method** to `GET`
4. Click the **+** on the right edge of the HTTP Request node. Search for **Set** and select it.
   - Click **Add Value → String**
   - Set **Name** to `message`
   - Set **Value** to `Workflow executed successfully`
5. Click **Save** (top-right), then click **Execute workflow**.

**Expected result:** The workflow runs. Each node shows a green checkmark. Click any node to inspect its output data in the panel on the right. The Set node output contains `{"message": "Workflow executed successfully"}`.

---

## Phase 4 — Webhooks and Triggers [MANUAL]

### Step 4.1 — Create a Webhook Trigger Workflow

1. Click **+ New workflow**.
2. Add a **Webhook** node as the trigger:
   - Set **HTTP Method** to `POST`
   - Set **Path** to `test-webhook`
   - Copy the **Webhook URL** shown (format: `http://<EXTERNAL-IP>:5678/webhook/test-webhook`)
3. Add a **Set** node after the webhook:
   - Add a string value: Name = `received`, Value = `={{ $json.body }}`
4. Click **Save**.
5. Click **Listen for Test Event** in the Webhook node to activate the test listener.

### Step 4.2 — Test the Webhook

In a new terminal, send a POST request:

```bash
curl -X POST http://${EXTERNAL_IP}:5678/webhook/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"hello": "from curl", "timestamp": "2026-05-15"}'
```

**Expected result:** The n8n UI shows the webhook received the data. The Webhook node turns green and displays the payload. The Set node output contains `{"received": {"hello": "from curl", "timestamp": "2026-05-15"}}`.

**REST API note:** The webhook URL IS the REST API endpoint — n8n exposes webhooks as HTTP endpoints natively. Production webhooks (with the workflow active) use the path prefix `/webhook/` instead of `/webhook-test/`.

### Step 4.3 — Explore a Scheduled Trigger

1. Create a new workflow.
2. Add a **Schedule Trigger** node:
   - Set **Trigger Interval** to `Minutes` and **Minutes Between Triggers** to `1`
3. Add an **HTTP Request** node targeting `https://httpbin.org/uuid`.
4. **Save** and **Activate** the workflow (toggle in the top-right).

**Expected result:** The workflow appears in the **Workflows** list with an active status indicator. After 1 minute, an execution appears in the workflow's execution history.

Deactivate the workflow after testing to avoid unnecessary polling.

---

## Phase 5 — Credential Management [MANUAL]

### Step 5.1 — Add an HTTP Basic Auth Credential

1. In any workflow, add an **HTTP Request** node.
2. Click **Authentication → Basic Auth**.
3. Click **Create New Credential**.
4. Enter a username and password. Click **Save**.

**Expected result:** The credential is saved and listed under **Settings → Credentials**. It is encrypted using the n8n encryption key stored in Secret Manager.

### Step 5.2 — View Credentials in Secret Manager

Verify that n8n's encryption key is stored securely:

```bash
gcloud secrets list --project <project-id> | grep n8n
```

**Expected result:** Secrets named `appn8ndemo<id>-encryption-key` and `appn8ndemo<id>-db-password` appear in the list. The plaintext values are never stored in Terraform state.

### Step 5.3 — Explore Credential Sharing

Go to **Settings → Credentials**. Click any credential. The **Sharing** tab controls which n8n users can use this credential in their workflows. This is useful for team deployments where multiple users share the same n8n instance.

---

## Phase 6 — Workflow History and Error Handling [MANUAL]

### Step 6.1 — View Execution History

1. Open a workflow that has been executed.
2. Click **Executions** (clock icon) in the top bar.

**Expected result:** A list of all executions for that workflow, showing status (success/error), start time, and duration.

**gcloud equivalent (view n8n pod logs for execution events):**
```bash
kubectl logs -n ${NAMESPACE} deployment/${NAMESPACE} -c ${NAMESPACE} --tail=100
```

### Step 6.2 — Examine a Successful Execution

Click any green (successful) execution. The workflow canvas highlights each node in green, and clicking a node shows the input/output data at that step.

### Step 6.3 — Add Error Handling

1. Open the simple HTTP Request workflow from Phase 3.
2. Click **+** and add an **Error Trigger** node (this node activates only when a workflow errors).
3. Connect the Error Trigger to a **Set** node that records `error = true`.
4. In the HTTP Request node settings, change the URL to an invalid address (e.g., `https://invalid.example.invalid`) to force an error.
5. Execute the workflow.

**Expected result:** The workflow fails, and the Error Trigger branch activates. The execution history shows the error path was taken.

### Step 6.4 — Retry Settings

On any node, click the three-dot menu and select **Settings**. Under **On Error**, choose **Retry on Fail** and set **Max Tries** to `3`. This makes n8n automatically retry the node on transient failures before triggering the error branch.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View n8n Logs in Cloud Logging

Navigate to Cloud Logging in the GCP Console, or use the CLI:

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project <project-id> \
  --limit 50 \
  --format "value(timestamp, jsonPayload.message)"
```

**Expected result:** Log lines from the n8n application, including database connection events, workflow execution start/stop events, and webhook registration messages.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/<project-id>"],
    "filter": "resource.type=k8s_container AND resource.labels.namespace_name='${NAMESPACE}'",
    "pageSize": 20
  }'
```

### Step 7.2 — Query for Workflow Execution Events

```bash
gcloud logging read \
  'resource.type="k8s_container" AND jsonPayload.message=~"Workflow" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project <project-id> \
  --limit 20
```

**Expected result:** Log entries showing workflow execution events — start, completion, and any errors.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### Step 8.1 — View Pod Metrics in Cloud Monitoring

Navigate to **Cloud Monitoring → Metrics Explorer** in the GCP Console.

Select the following metric:
- **Resource type:** `k8s_container`
- **Metric:** `kubernetes.io/container/cpu/core_usage_time`
- **Filter:** `namespace_name = ${NAMESPACE}`

**Expected result:** A time-series chart shows CPU usage for the n8n pod(s).

**gcloud equivalent:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes" \
  --project <project-id>
```

### Step 8.2 — Check the Uptime Monitor

If `uptime_check_config.enabled = true` was set during deployment, an uptime check was created automatically.

```bash
gcloud monitoring uptime list-configs --project <project-id>
```

**Expected result:** An uptime check named after the deployment appears, with a status of `Healthy`.

### Step 8.3 — View Notifications Channels

```bash
gcloud beta monitoring channels list --project <project-id>
```

If `support_users` was configured, a notification channel for each email address was created to receive alert notifications.

---

## Phase 9 — Scaling [MANUAL]

### Step 9.1 — Examine HPA Configuration

The Horizontal Pod Autoscaler controls the number of n8n replicas based on CPU usage.

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:**
```
NAME             REFERENCE                    TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
appn8ndemo<id>   Deployment/appn8ndemo<id>   15%/80%   1         3         1          10m
```

### Step 9.2 — Describe the HPA

```bash
kubectl describe hpa -n ${NAMESPACE}
```

**Expected result:** Details showing the CPU utilization target (default 80%), current utilization, and scaling events. When CPU exceeds the target, Kubernetes automatically adds pods up to `max_instance_count`.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://container.googleapis.com/v1/projects/<project-id>/locations/<region>/clusters/<cluster-name>"
```

### Step 9.3 — Manually Scale Workers

To temporarily override the HPA and set a specific replica count:

```bash
kubectl scale deployment/${NAMESPACE} --replicas=2 -n ${NAMESPACE}
```

**Expected result:** A second pod starts. After ~1 minute, the HPA resumes control and may scale back down if CPU is low.

```bash
# Watch scaling in real time
kubectl get pods -n ${NAMESPACE} -w
```

---

## Phase 10 — Undeploy [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module. This removes all Kubernetes resources, Cloud SQL instance, NFS Filestore, GCS buckets, secrets, and IAM bindings created by this module.

**Note:** If `enable_purge = false` was set, some resources (database, buckets) are retained after undeployment to protect against accidental data loss.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Activity | Method |
|---|---|---|
| 1 | Deploy n8n on GKE Autopilot | Automated (RAD UI) |
| 2 | Configure kubectl, verify pod | Manual (gcloud, kubectl) |
| 3 | Access UI, create first workflow | Manual (browser) |
| 4 | Webhooks and scheduled triggers | Manual (browser + curl) |
| 5 | Credential management | Manual (browser) |
| 6 | Execution history, error handling | Manual (browser) |
| 7 | Cloud Logging — query workflow events | Manual (gcloud / console) |
| 8 | Cloud Monitoring — pod metrics | Manual (console) |
| 9 | HPA scaling configuration | Manual (kubectl) |
| 10 | Undeploy all resources | Automated (RAD UI) |
