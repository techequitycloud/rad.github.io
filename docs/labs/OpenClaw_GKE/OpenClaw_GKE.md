---
title: "OpenClaw on GKE — Lab Guide"
sidebar_label: "OpenClaw GKE"
---

# OpenClaw on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE)**

OpenClaw is an open-source AI agent gateway that takes actions — not just generates responses.
It manages stateful, multi-tenant AI agents with conversation history, tool integration, and
per-tenant isolation. The `OpenClaw_GKE` module deploys OpenClaw on GKE Autopilot with GCS
Fuse CSI driver for persistent agent workspace, Workload Identity for pod-level IAM, and HPA
for horizontal scaling.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Application](#exercise-1--access-application)
6. [Exercise 2 — Core Features](#exercise-2--core-features)
7. [Exercise 3 — Kubernetes Workloads](#exercise-3--kubernetes-workloads)
8. [Exercise 4 — Security and Workload Identity](#exercise-4--security-and-workload-identity)
9. [Exercise 5 — Cloud Logging and Monitoring](#exercise-5--cloud-logging-and-monitoring)
10. [Cleanup](#cleanup)
11. [Reference](#reference)

---

## 1. Overview

### What Is OpenClaw?

OpenClaw is an **open-source local AI agent gateway** built for multi-tenant deployments. It
orchestrates AI agents powered by Anthropic's Claude, maintains per-session conversation history,
supports tool/skill integration, and provides per-tenant isolation. The `OpenClaw_GKE` module
deploys it on GKE Autopilot with the GCS Fuse CSI driver mounting the agent workspace at `/data`
for durable state across pod restarts.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **AI Agent Orchestration** | Stateful Claude-powered agents with tool use and conversation history |
| **Multi-Tenant Isolation** | Per-tenant agent scoping, API keys, and conversation isolation |
| **GCS Fuse CSI** | Agent workspace durability across pod restarts (GKE CSI driver) |
| **GKE Autopilot** | Managed Kubernetes with Workload Identity and auto-provisioned nodes |
| **Workload Identity** | Pod-level IAM binding — no service account key files |
| **HPA** | Horizontal pod autoscaling for multi-tenant deployments |
| **Cloud Logging** | Agent invocation, LLM API call, and workspace activity logs |
| **Cloud Monitoring** | Pod metrics, uptime check, and alert policy dashboards |

---

## 2. Architecture

```
Browser / API Client / Messaging Bot
        │
        ▼
LoadBalancer Service (external IP or ClusterIP)
  │
  ▼
OpenClaw Deployment (GKE Autopilot)
   ├── OpenClaw container (port 8080, Node.js)
   │       ├── Agent orchestration (Claude API calls)
   │       ├── Conversation management (per-tenant, per-session)
   │       ├── REST API (/api/agents, /api/conversations, /api/tenants)
   │       └── GCS Fuse CSI mount at /data
   └── HPA (min=1, max=3)
```

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  GKE Autopilot Cluster                                             │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  openclaw namespace (appopenclaw<tenant><id>)                 │  │ │
│  │  │                                                              │  │  │
│  │  │  OpenClaw Deployment                                         │  │  │
│  │  │    containers: [openclaw]                                    │  │  │
│  │  │    GCS Fuse CSI volume at /data                              │  │  │
│  │  │    HPA: min=1, max=3 replicas                               │  │   │
│  │  │                                                              │  │  │
│  │  │  PodDisruptionBudget (minAvailable=1)                        │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                    │  │
│  │  ┌──────────────────────┐  ┌───────────────────────────────────┐  │   │
│  │  │  Workload Identity   │  │  LoadBalancer / ClusterIP Service │  │   │
│  │  │  (SA → GCP SA IAM)   │  │  (port 8080)                      │  │   │
│  │  └──────────────────────┘  └───────────────────────────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────┐  ┌───────────────────────────────────────┐ │
│  │  GCS Bucket              │  │  Secret Manager                       │ │
│  │  <prefix>-storage        │  │  - anthropic-api-key                  │ │
│  │  mounted via GCS Fuse    │  │  - (telegram/slack if enabled)        │ │
│  │  at /data uid=1000       │  │                                       │ │
│  └──────────────────────────┘  └───────────────────────────────────────┘ │
│                                                                          │
│  Module variable wiring:                                                 │
│    OpenClaw_GKE                                                          │
│      min_instance_count = 1  → always at least one pod                   │
│      max_instance_count = 3  → HPA scale-out for multi-tenant load       │
│      enable_nfs = false      → GCS Fuse replaces NFS                     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
roles/secretmanager.admin
roles/storage.admin
roles/iam.serviceAccountAdmin
roles/monitoring.viewer
roles/logging.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
gcloud auth application-default login
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `OpenClaw_GKE` module via the RAD UI. **Prerequisite:** `Services_GCP` must be
deployed first. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `anthropic_api_key` | `sk-ant-...` | Required for agent responses |
| `min_instance_count` | `1` | Minimum pod replicas |
| `max_instance_count` | `3` | HPA maximum replicas |
| `cpu_limit` | `2000m` | Default |
| `memory_limit` | `2Gi` | Default |

Click **Deploy** and wait for provisioning (approximately 12–19 minutes).

> **What this provisions:** GKE Autopilot namespace, Kubernetes Deployment with HPA and
> PodDisruptionBudget, GCS workspace bucket with GCS Fuse CSI mount, Workload Identity binding,
> Secret Manager secret for the Anthropic API key, Artifact Registry repository, and custom
> container image built via Cloud Build.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

echo "GKE cluster: ${CLUSTER}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes

# Discover the OpenClaw namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appopenclaw" | head -1)

echo "OpenClaw namespace: ${NAMESPACE}"

# Discover the external IP (if service_type=LoadBalancer)
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null)

# Or port-forward if service_type=ClusterIP
if [ -z "${EXTERNAL_IP}" ]; then
  echo "No external IP — use port-forward:"
  echo "kubectl port-forward svc/openclaw 8080:8080 -n ${NAMESPACE}"
  export SERVICE_URL="http://localhost:8080"
else
  export SERVICE_URL="http://${EXTERNAL_IP}:8080"
  echo "OpenClaw URL: ${SERVICE_URL}"
fi
```

---

## Exercise 1 — Access Application

### Objective

Verify OpenClaw pod health, obtain the service endpoint, retrieve admin credentials, and
explore the main dashboard sections.

### Step 1.1 — Verify Pod Health

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"

kubectl describe deployment openclaw -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status, currentNodeCount)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, currentNodeCount}'
```

**Expected result:** OpenClaw pod shows `Running` status with `1/1` ready containers.
Allow 3–5 minutes after deployment for the startup probe to pass.

### Step 1.2 — Get Service Endpoint

```bash
kubectl get service -n "${NAMESPACE}"

# If using port-forward
kubectl port-forward svc/openclaw 8080:8080 -n "${NAMESPACE}" &

# Health check
curl -s "${SERVICE_URL}/health"
# Expected: {"status": "ok"}
```

### Step 1.3 — Verify GCS Fuse Mount

```bash
kubectl exec -n "${NAMESPACE}" deploy/openclaw -- ls /data

kubectl exec -n "${NAMESPACE}" deploy/openclaw -- ls -la /data/workspace/
```

**Expected result:** The `/data` directory is mounted and writable, backed by the GCS workspace
bucket. The `workspace/` subdirectory contains agent state files.

### Step 1.4 — Retrieve Admin Credentials

```bash
ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}"
```

### Step 1.5 — Explore the Dashboard

Navigate to `${SERVICE_URL}` in your browser. Log in with the admin credentials.

Explore: **Agents**, **Conversations**, **Tenants**, **Tools**.

**Expected result:** The dashboard loads with empty sections on a fresh deployment.

---

## Exercise 2 — Core Features

### Objective

Create an AI agent, start conversations, verify multi-tenant isolation, and test state
persistence across pod restarts.

### Step 2.1 — Create an AI Agent

1. Navigate to **Agents** > **New Agent**.
2. Configure:
   - **Name:** `gcp-assistant`
   - **System prompt:** `You are a helpful Google Cloud Platform expert.`
   - **LLM backend:** `Claude`
3. Click **Save**.

**REST API:**
```bash
export ADMIN_TOKEN="<your-admin-token>"

curl -s -X POST "${SERVICE_URL}/api/agents" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gcp-assistant",
    "system_prompt": "You are a helpful GCP expert.",
    "llm_backend": "anthropic"
  }' | jq '{id, name}'
```

**Expected result:** The agent appears in the Agents list with a green status indicator.

### Step 2.2 — Start a Conversation

1. Navigate to **Conversations** > **New Conversation**.
2. Select `gcp-assistant` and send: `What is GKE Autopilot?`

**REST API:**
```bash
AGENT_ID=$(curl -s "${SERVICE_URL}/api/agents" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  | jq -r '.[] | select(.name=="gcp-assistant") | .id')

curl -s -X POST "${SERVICE_URL}/api/conversations" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"${AGENT_ID}\", \"message\": \"What is GKE Autopilot?\"}" \
  | jq '.response'
```

**Expected result:** A contextual explanation from Claude about GKE Autopilot.

### Step 2.3 — Configure Multi-Tenant Isolation

1. Create two tenants: `dev-team` and `production-team`.
2. Assign `gcp-assistant` to `dev-team` only.
3. Verify the agent is not visible in `production-team`.

```bash
# Create tenants
curl -s -X POST "${SERVICE_URL}/api/tenants" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "dev-team"}' | jq '{id, name}'

curl -s -X POST "${SERVICE_URL}/api/tenants" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "production-team"}' | jq '{id, name}'
```

**Expected result:** Tenant isolation is enforced — agents scoped to `dev-team` are not
visible in `production-team`.

### Step 2.4 — Test State Persistence Across Pod Restarts

Restart the pod and verify conversation history is preserved:

```bash
# Trigger pod restart
kubectl rollout restart deployment/openclaw -n "${NAMESPACE}"

# Watch rollout
kubectl rollout status deployment/openclaw -n "${NAMESPACE}"

# Verify workspace is still present after restart
kubectl exec -n "${NAMESPACE}" deploy/openclaw -- ls /data/workspace/
```

**Expected result:** After the pod restarts, all conversations and agent configurations are
still accessible because state is stored in GCS (not the pod's ephemeral filesystem).

---

## Exercise 3 — Kubernetes Workloads

### Objective

Inspect Kubernetes resources, scale the deployment, observe GKE Autopilot node provisioning,
and verify the HPA and PodDisruptionBudget.

### Step 3.1 — Inspect the Deployment

**kubectl:**
```bash
kubectl describe deployment openclaw -n "${NAMESPACE}"

# Check container spec and volumes
kubectl get deployment openclaw -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[0].resources}' | jq .

# View GCS Fuse CSI volume spec
kubectl get deployment openclaw -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.volumes}' | jq .
```

**Expected result:** Deployment shows OpenClaw container with GCS Fuse CSI volume at `/data`,
resource limits (`cpu_limit`, `memory_limit`), and startup/liveness probes targeting `/health`.

### Step 3.2 — Inspect the Service

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}" -o wide

kubectl describe service -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --filter="name~openclaw"
```

### Step 3.3 — Scale the Deployment

```bash
kubectl scale deployment openclaw \
  --replicas=2 \
  -n "${NAMESPACE}"

kubectl get pods -n "${NAMESPACE}" -w
```

**Expected result:** GKE Autopilot automatically provisions a node for the second pod.

> **Note:** Multiple OpenClaw replicas will split workspace access for the same tenant.
> In production, keep `max_instance_count = 1` per tenant or implement sticky routing.

Scale back to 1 after observing:
```bash
kubectl scale deployment openclaw --replicas=1 -n "${NAMESPACE}"
```

### Step 3.4 — Inspect the HPA

**kubectl:**
```bash
kubectl get hpa -n "${NAMESPACE}"

kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA configured with min=1, max=3 replicas. CPU-based autoscaling will
trigger when pod CPU utilization exceeds the target threshold.

### Step 3.5 — Inspect the PodDisruptionBudget

**kubectl:**
```bash
kubectl get pdb -n "${NAMESPACE}"

kubectl describe pdb -n "${NAMESPACE}"
```

**Expected result:** PDB with `minAvailable=1` ensures at least one OpenClaw pod is always
running during voluntary disruptions (node maintenance, rolling updates).

### Step 3.6 — Perform a Rolling Update

```bash
# Trigger rolling update (simulates version change)
kubectl set env deployment/openclaw \
  RESTART_TRIGGER=$(date +%s) \
  -n "${NAMESPACE}"

# Watch rollout
kubectl rollout status deployment/openclaw -n "${NAMESPACE}"

# Rollback if needed
kubectl rollout undo deployment/openclaw -n "${NAMESPACE}"
```

**Expected result:** Rolling update completes with zero downtime — the PDB ensures one replica
stays live during the update.

---

## Exercise 4 — Security and Workload Identity

### Objective

Verify Workload Identity binding, inspect Secret Manager credentials, confirm pods access
GCP APIs without key files, and review audit logs.

### Step 4.1 — Verify Workload Identity Annotation

**kubectl:**
```bash
kubectl get serviceaccount -n "${NAMESPACE}" -o yaml \
  | grep -A5 "annotations:"
```

The annotation `iam.gke.io/gcp-service-account` links the Kubernetes SA to a GCP SA.

**gcloud:**
```bash
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~openclaw" \
  --format="table(email, displayName)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.accounts[] | select(.email | test("openclaw")) | {email, displayName}'
```

**Expected result:** A dedicated GCP service account for OpenClaw with the annotation binding
to the Kubernetes service account in the namespace.

### Step 4.2 — Verify IAM Bindings

**gcloud:**
```bash
SA_EMAIL=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~openclaw" \
  --format="value(email)" \
  --limit=1)

gcloud iam service-accounts get-iam-policy "${SA_EMAIL}" \
  --project="${PROJECT}"
```

**Expected result:** The IAM policy shows `roles/iam.workloadIdentityUser` binding for the
Kubernetes service account in the OpenClaw namespace.

### Step 4.3 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="table(name, createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aopenclaw" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.secrets[] | {name, createTime}'
```

**Expected result:** At minimum, the Anthropic API key secret. Telegram/Slack secrets if those
integrations were enabled.

### Step 4.4 — Confirm No Key File in Pod

**kubectl:**
```bash
# Verify no service account key JSON is mounted
kubectl exec -n "${NAMESPACE}" deploy/openclaw -- \
  env | grep -i "google_application_credentials\|service_account" || \
  echo "No key file env vars — Workload Identity is active"
```

**Expected result:** No `GOOGLE_APPLICATION_CREDENTIALS` environment variable in the pod.
The Workload Identity binding provides credentials transparently via the metadata server.

### Step 4.5 — Review Secret Manager Audit Logs

**gcloud:**
```bash
gcloud logging read \
  "protoPayload.serviceName=secretmanager.googleapis.com \
   AND protoPayload.methodName=~\"AccessSecretVersion\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {
    timestamp,
    caller: .protoPayload.authenticationInfo.principalEmail,
    resource: .protoPayload.resourceName
  }'
```

**Expected result:** The OpenClaw GCP service account accessing the Anthropic API key secret
during pod startup — no direct key references needed.

---

## Exercise 5 — Cloud Logging and Monitoring

### Objective

Query GKE container logs for agent activity, review Cloud Monitoring dashboards for pod
resource utilization, and verify uptime check status.

### Step 5.1 — View Application Logs in the Console

```bash
echo "https://console.cloud.google.com/logs?project=${PROJECT}"
```

Use the following filter:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="openclaw"
```

### Step 5.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   resource.labels.container_name=\"openclaw\"" \
  --project="${PROJECT}" \
  --limit=100 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"k8s_container\\\" resource.labels.namespace_name=\\\"${NAMESPACE}\\\"\",
    \"pageSize\": 50
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 5.3 — Filter for Agent Invocations

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   resource.labels.namespace_name=\"${NAMESPACE}\" \
   textPayload=~\"agent|conversation|anthropic|POST /api\"" \
  --project="${PROJECT}" \
  --limit=30 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries showing agent invocations and outbound Anthropic Claude API
calls for each conversation message.

### Step 5.4 — Stream Live Logs with kubectl

```bash
kubectl logs -f -n "${NAMESPACE}" -l app=openclaw
```

Send a conversation message and observe the real-time Claude API call logs.

### Step 5.5 — Review Cloud Monitoring Pod Metrics

```bash
echo "https://console.cloud.google.com/monitoring?project=${PROJECT}"
```

**REST API (query pod CPU):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**gcloud (query memory):**
```bash
kubectl top pods -n "${NAMESPACE}"
```

**Expected result:** CPU spikes during Anthropic API calls; memory usage is relatively stable.

### Step 5.6 — Review Uptime Checks

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {name, displayName, httpCheck}'
```

**Expected result:** Uptime check polling `/health` at 60-second intervals showing green
status from multiple global probe locations.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `OpenClaw_GKE` deployment. This removes
all Kubernetes resources, GCS workspace bucket, Secret Manager secrets, and IAM bindings.
The GKE cluster managed by `Services_GCP` is not affected.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Secret Manager secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet

# Delete GCS workspace bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~openclaw" \
  --format="value(name)" --limit=1)
gcloud storage rm --recursive "gs://${BUCKET}/"
gcloud storage buckets delete "gs://${BUCKET}"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_version` | string | `latest` | OpenClaw image tag |
| `anthropic_api_key` | string | `""` | Anthropic API key (stored in Secret Manager) |
| `cpu_limit` | string | `2000m` | CPU limit per pod |
| `memory_limit` | string | `2Gi` | Memory limit per pod |
| `min_instance_count` | number | `1` | Minimum HPA pod replicas |
| `max_instance_count` | number | `3` | Maximum HPA pod replicas |
| `gke_cluster_name` | string | `""` | GKE cluster name (auto-discovered when empty) |
| `skills_repo_url` | string | `""` | GitHub URL of shared skills repository |
| `skills_repo_ref` | string | `main` | Git ref for skills repository |
| `enable_telegram` | bool | `false` | Enable Telegram bot integration |
| `enable_slack` | bool | `false` | Enable Slack bot integration |
| `timeout_seconds` | number | `3600` | Request timeout for long agent sessions |
| `backup_schedule` | string | `0 2 * * *` | Workspace backup cron schedule |
| `backup_retention_days` | number | `7` | Days to retain backup files |

### Useful Commands

```bash
# Get pods
kubectl get pods -n "${NAMESPACE}"

# Stream live logs
kubectl logs -f -n "${NAMESPACE}" -l app=openclaw

# Exec into pod
kubectl exec -it -n "${NAMESPACE}" deploy/openclaw -- sh

# Check GCS Fuse mount
kubectl exec -n "${NAMESPACE}" deploy/openclaw -- ls /data

# Scale deployment
kubectl scale deployment openclaw --replicas=2 -n "${NAMESPACE}"

# Rolling restart
kubectl rollout restart deployment/openclaw -n "${NAMESPACE}"

# Watch rollout
kubectl rollout status deployment/openclaw -n "${NAMESPACE}"

# Port-forward for access
kubectl port-forward svc/openclaw 8080:8080 -n "${NAMESPACE}"

# View HPA
kubectl get hpa -n "${NAMESPACE}"

# View PDB
kubectl get pdb -n "${NAMESPACE}"

# Top pods
kubectl top pods -n "${NAMESPACE}"
```

### Further Reading

- [OpenClaw GitHub repository](https://github.com/openclaw/openclaw)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [GCS Fuse CSI driver on GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/cloud-storage-fuse-csi-driver)
- [HPA documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
