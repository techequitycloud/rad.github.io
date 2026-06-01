# OpenClaw on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE)**

## Overview

**Estimated time:** 1–2 hours

OpenClaw is an AI agent gateway platform for managing stateful multi-tenant AI agents. It provides agent orchestration, conversation management, tool integration, and per-tenant isolation. This lab deploys OpenClaw on GKE Autopilot with GCS Fuse for persistent agent state, Workload Identity for pod-level IAM, Secret Manager for credential management, and optional Telegram or Slack channel integration.

### What the Module Automates

- GKE Autopilot cluster discovery and namespace provisioning
- GCS workspace bucket and GCS Fuse CSI driver configuration
- Workload Identity binding for pod-level IAM
- Secret Manager secrets for Anthropic API key and integration tokens
- Artifact Registry repository and Cloud Build image pipeline
- Kubernetes Deployment, Service, HPA, and PodDisruptionBudget
- Skills repository sync configuration on pod startup
- Cloud Logging and Cloud Monitoring integration

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Obtain kubectl access and verify OpenClaw pod health
- Log in to the OpenClaw interface and explore the dashboard
- Create and configure an AI agent with a system prompt
- Start test conversations with the agent
- Configure multi-tenant isolation and explore per-tenant API keys
- Verify GCS Fuse state persistence across pod restarts
- Query Cloud Logging for agent and API request logs
- Review Cloud Monitoring service metrics and pod health

---

## CLI and REST API Overview

This lab uses the following CLIs:

| Tool | Purpose |
|---|---|
| `gcloud` | GCP resource management, log queries, secret access |
| `kubectl` | Kubernetes pod inspection, log streaming, exec |
| `curl` | API calls to the OpenClaw gateway |

Configure:

```bash
# Authenticate gcloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Get GKE credentials
gcloud container clusters get-credentials CLUSTER_NAME \
  --region REGION \
  --project YOUR_PROJECT_ID
```

---

## Prerequisites

Before deploying this module:

1. **Services GCP deployed** — this module depends on `Services GCP` for the VPC and GKE Autopilot cluster.
2. **GCP project** with billing enabled.
3. **gcloud CLI** authenticated with Owner or Editor role on the project.
4. **kubectl** installed and configured.
5. **Access to the RAD UI** with permission to deploy modules in the target GCP project.
6. **Anthropic API key** — required for LLM-powered agent responses. Obtain from [console.anthropic.com](https://console.anthropic.com).

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the OpenClaw GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `openclaw` | Internal identifier used for Kubernetes resources and secrets |
| `application_version` | No | `latest` | Container image tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum HPA pod replicas |
| `max_instance_count` | No | `3` | Maximum HPA pod replicas |
| `container_resources` | No | `{cpu_limit="2000m", memory_limit="2Gi"}` | CPU and memory limits per pod |
| `gke_cluster_name` | No | `""` | Target GKE cluster name; auto-discovered when empty |
| `anthropic_api_key` | No | `""` | Anthropic API key (stored in Secret Manager) |
| `skills_repo_url` | No | `""` | GitHub URL of a shared skills repository |
| `skills_repo_ref` | No | `main` | Git ref (branch or tag) for the skills repository |
| `enable_telegram` | No | `false` | Enable Telegram bot integration |
| `enable_slack` | No | `false` | Enable Slack bot integration |
| `timeout_seconds` | No | `3600` | Request timeout (1 hour recommended for agent sessions) |
| `backup_schedule` | No | `0 2 * * *` | Cron expression for automated workspace backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |

### Deploy

Click **Deploy** in the RAD UI.

### Expected Deployment Duration

| Phase | Duration |
|---|---|
| GKE namespace and RBAC setup | ~2 min |
| Secret Manager secrets | ~1 min |
| GCS workspace bucket provisioning | ~1 min |
| Cloud Build image pipeline | ~5–10 min |
| Kubernetes Deployment rollout | ~3–5 min |
| **Total** | **~12–19 min** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name |
| `service_url` | External URL for the OpenClaw gateway |
| `service_external_ip` | LoadBalancer external IP address |
| `service_cluster_ip` | ClusterIP of the Kubernetes service |
| `namespace` | Kubernetes namespace |
| `storage_buckets` | GCS bucket names |
| `container_image` | Container image URI deployed |
| `deployment_id` | Unique deployment suffix |
| `network_name` | VPC network name |
| `kubernetes_ready` | Whether all Kubernetes resources were deployed |

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

# Discover the namespace (pattern: appopenclaw<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appopenclaw" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
```

---

## Phase 2 — Verify GKE Deployment [MANUAL]

### Steps

1. Configure kubectl to target the GKE cluster:

```bash
gcloud container clusters get-credentials CLUSTER_NAME \
  --region REGION \
  --project YOUR_PROJECT_ID
```

2. Confirm OpenClaw pods are running:

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** All pods show `Running` status and `1/1` in the READY column. The startup probe allows up to ~3 minutes for Node.js and the 35 bundled plugin packages to stage before the gateway starts.

3. Check the Deployment details:

```bash
kubectl describe deployment openclaw -n ${NAMESPACE}
```

**Expected result:** Deployment shows correct replica count, no error events, and Workload Identity annotations.

4. View the Service and external IP:

```bash
kubectl get service -n ${NAMESPACE}
```

**Expected result:** The Service shows either a `ClusterIP` (default) or `LoadBalancer` external IP depending on the `service_type` configuration.

5. Check pod logs to confirm the gateway started:

```bash
kubectl logs -n ${NAMESPACE} -l app=openclaw --tail=50
```

**Expected result:** Log lines indicating the OpenClaw gateway is listening on port 8080, the GCS Fuse workspace mount is active at `/data`, and the skills repository (if configured) was cloned.

6. Verify the GCS Fuse mount is active inside the pod:

```bash
kubectl exec -n ${NAMESPACE} deploy/openclaw -- ls /data
```

**Expected result:** The `/data` directory contents are listed, backed by the GCS workspace bucket.

### gcloud equivalent

```bash
gcloud container clusters list --project YOUR_PROJECT_ID
```

---

## Phase 3 — Explore the OpenClaw Interface [MANUAL]

### Steps

1. Determine the OpenClaw service endpoint. If `service_type` is `LoadBalancer`, use `${EXTERNAL_IP}`.

   If `service_type` is `ClusterIP` (internal only), use kubectl port-forward:

```bash
kubectl port-forward svc/openclaw 8080:8080 -n ${NAMESPACE}
# Access at: http://localhost:8080
```

2. Open the OpenClaw UI in your browser at the service URL or `http://localhost:8080`.

3. Log in with admin credentials. Retrieve the admin token from Secret Manager:

```bash
gcloud secrets versions access latest \
  --secret="openclaw-admin-token" \
  --project=YOUR_PROJECT_ID
```

**Expected result:** The OpenClaw dashboard loads, showing the main navigation sections: **Agents**, **Conversations**, **Tenants**, **Tools**.

4. Explore each section briefly:
   - **Agents** — lists configured AI agents.
   - **Conversations** — lists active and historical conversations.
   - **Tenants** — tenant management for multi-tenant isolation.
   - **Tools** — available tools and capabilities the agents can use.

### gcloud equivalent

```bash
# Verify the Anthropic API key is stored in Secret Manager
gcloud secrets list \
  --filter="name:openclaw" \
  --project=YOUR_PROJECT_ID
```

---

## Phase 4 — Create an AI Agent [MANUAL]

### Steps

1. Navigate to **Agents** in the OpenClaw dashboard.

2. Click **New Agent** (or the **+** button).

3. Configure the agent:
   - **Name:** `gcp-assistant`
   - **Description:** `A helpful assistant for Google Cloud Platform questions`
   - **System prompt:**
     ```
     You are a helpful Google Cloud Platform expert. You help users understand GCP services,
     best practices, and how to architect cloud-native applications. Always provide concise,
     accurate, and practical answers.
     ```
   - **LLM backend:** Select `Claude` (or configure the Anthropic API key if prompted).
   - **Tools/capabilities:** Leave at defaults for this lab.

4. Click **Save** or **Create Agent**.

**Expected result:** The agent appears in the Agents list with a green status indicator.

5. Note the **Agent ID** shown in the agent details — you will use it in the next phase.

### REST API equivalent

```bash
# Create an agent via the OpenClaw REST API
curl -X POST http://localhost:8080/api/agents \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gcp-assistant",
    "description": "A helpful GCP assistant",
    "system_prompt": "You are a helpful GCP expert.",
    "llm_backend": "anthropic"
  }'
```

---

## Phase 5 — Test Agent Conversations [MANUAL]

### Steps

1. Navigate to **Conversations** in the OpenClaw dashboard.

2. Click **New Conversation** and select the `gcp-assistant` agent created in Phase 4.

3. Send a test message:

```
What is Google Cloud Run?
```

**Expected result:** The agent responds with a concise explanation of Cloud Run, its use cases, and key features.

4. Send a follow-up question:

```
How does GKE Autopilot differ from Standard?
```

**Expected result:** The agent explains the differences between GKE Autopilot (fully managed node pools, per-pod billing) and Standard (manual node management, per-node billing).

5. View the **conversation history** — scroll up to see the full exchange logged with timestamps.

6. Export the conversation transcript by clicking **Export** or **Download** in the conversation toolbar.

**Expected result:** A text or JSON file is downloaded containing the full conversation thread.

### REST API equivalent

```bash
# Send a message to the agent via API
curl -X POST http://localhost:8080/api/conversations \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "AGENT_ID",
    "message": "What is Google Cloud Run?"
  }'
```

---

## Phase 6 — Multi-Tenant Configuration [MANUAL]

### Steps

1. Navigate to **Tenants** in the OpenClaw dashboard.

2. Click **New Tenant** and create a tenant:
   - **Name:** `dev-team`
   - **Description:** `Development team tenant`
   - Click **Create**.

3. Create a second tenant:
   - **Name:** `production-team`
   - **Description:** `Production environment tenant`
   - Click **Create**.

4. Assign the `gcp-assistant` agent to the `dev-team` tenant:
   - Open the `dev-team` tenant.
   - Navigate to **Agents** within the tenant.
   - Click **Assign Agent** and select `gcp-assistant`.

**Expected result:** The `gcp-assistant` agent is now scoped to the `dev-team` tenant. Conversations and history within this tenant are isolated from other tenants.

5. Verify tenant isolation:
   - Switch to the `production-team` tenant context.
   - Navigate to **Agents** — the `gcp-assistant` agent should not appear here unless explicitly assigned.

**Expected result:** Tenant isolation is enforced — agents and conversations scoped to `dev-team` are not visible in `production-team`.

6. Explore **API keys** per tenant:
   - Open a tenant.
   - Navigate to **API Keys** or **Settings**.
   - Generate a tenant-scoped API key.

**Expected result:** A unique API key is generated for the tenant, which can be used to make tenant-scoped API calls.

### REST API equivalent

```bash
# List tenants
curl -X GET http://localhost:8080/api/tenants \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Create a tenant
curl -X POST http://localhost:8080/api/tenants \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "dev-team", "description": "Development team tenant"}'
```

---

## Phase 7 — Explore State Persistence [MANUAL]

### Steps

1. Verify the GCS Fuse workspace mount is active inside the running pod:

```bash
kubectl exec -n ${NAMESPACE} deploy/openclaw -- ls /data
```

**Expected result:** The `/data` directory is mounted and contains the agent workspace files, conversation history, and any skill library cloned from the configured GitHub repository.

2. List the workspace contents in more detail:

```bash
kubectl exec -n ${NAMESPACE} deploy/openclaw -- ls -la /data/workspace/
```

**Expected result:** Workspace files including skill library (if `skills_repo_url` was set), conversation logs, and agent configuration files.

3. Verify the underlying GCS bucket:

```bash
gcloud storage ls gs://GCS_BUCKET_NAME/ \
  --project=YOUR_PROJECT_ID
```

**Expected result:** The same files visible inside the pod are also visible in GCS, confirming GCS Fuse is writing through to the bucket.

4. Test state persistence by restarting a pod:

```bash
kubectl rollout restart deployment/openclaw -n ${NAMESPACE}
```

5. Wait for the new pod to become ready:

```bash
kubectl rollout status deployment/openclaw -n ${NAMESPACE}
```

6. After the pod restarts, verify conversation history is preserved:

```bash
kubectl exec -n ${NAMESPACE} deploy/openclaw -- ls /data/workspace/
```

**Expected result:** The conversation history and workspace files from before the restart are still present, demonstrating that GCS Fuse provides durable state across pod restarts.

### gcloud equivalent (browse workspace in GCS)

```bash
gcloud storage ls --recursive gs://GCS_BUCKET_NAME/workspace/ \
  --project=YOUR_PROJECT_ID
```

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### Steps

1. Open the [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs).

2. Select your project.

3. Query OpenClaw agent logs:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="openclaw"
```

**Expected result:** Log entries from OpenClaw include incoming API requests, agent invocations, LLM API calls to Anthropic, conversation events, and GCS Fuse mount activity.

4. Filter for API request logs:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
textPayload:"POST /api"
```

5. Use kubectl to stream live logs from the pod:

```bash
kubectl logs -f -n ${NAMESPACE} -l app=openclaw
```

6. Filter for error-level logs in Cloud Logging:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=ERROR
```

**Expected result:** Any LLM API errors, authentication failures, or GCS mount issues appear here.

### gcloud equivalent

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=YOUR_PROJECT_ID \
  --limit=50 \
  --format="table(timestamp, severity, textPayload)"
```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

### Steps

1. Open [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Metrics Explorer**.

3. Query GKE pod CPU metrics:
   - **Metric:** `kubernetes.io/container/cpu/usage_time`
   - **Filter:** `namespace_name = ${NAMESPACE}`

**Expected result:** A time-series graph showing OpenClaw pod CPU consumption. Agent workloads spike during LLM API calls.

4. Query pod memory usage:
   - **Metric:** `kubernetes.io/container/memory/used_bytes`
   - **Filter:** `namespace_name = ${NAMESPACE}`

**Expected result:** Memory usage time-series for the OpenClaw pods.

5. Check pod restart counts:
   - **Metric:** `kubernetes.io/container/restart_count`
   - **Filter:** `namespace_name = ${NAMESPACE}`

**Expected result:** Zero restarts for a healthy deployment.

6. Navigate to **Dashboards** and explore the GKE workloads dashboard:
   - Select your cluster and namespace.
   - Review pod health, resource utilization, and network traffic.

7. Check the **Alerting** section to review any alert policies configured by the module.

**Expected result:** All alert policies are visible and in a healthy (no-fire) state.

### gcloud equivalent

```bash
# List GKE workload metrics
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project=YOUR_PROJECT_ID \
  --limit=10
```

---

## Phase 10 — Undeploy [AUTOMATED]

When the lab is complete, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** All Kubernetes resources, GCS workspace bucket, Secret Manager secrets, and IAM bindings created by this module are deleted. The GKE cluster and VPC managed by `Services GCP` are not affected.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Description |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisions GKE workload, GCS workspace, secrets, HPA |
| Phase 2 — Verify GKE | Manual | Confirms pods running, GCS Fuse mount active |
| Phase 3 — Explore Interface | Manual | Admin login and dashboard orientation |
| Phase 4 — Create an AI Agent | Manual | Configure agent with system prompt and LLM backend |
| Phase 5 — Test Conversations | Manual | Agent conversation, history, and transcript export |
| Phase 6 — Multi-Tenant Config | Manual | Tenant creation, agent assignment, isolation verification |
| Phase 7 — State Persistence | Manual | GCS Fuse mount, pod restart, workspace durability |
| Phase 8 — Cloud Logging | Manual | Agent and API request log exploration |
| Phase 9 — Cloud Monitoring | Manual | GKE pod metrics and health |
| Phase 10 — Undeploy | Automated | Tears down all module-managed resources |
