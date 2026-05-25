# Node-RED on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_GKE)**

This lab guide walks you through deploying, exploring, and operating **Node-RED** on Google
Kubernetes Engine Autopilot with the **NodeRED_GKE** module. You will explore a flow-based
programming environment on Kubernetes, including flow creation, HTTP endpoint building,
Kubernetes workload management, Workload Identity, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Node-RED](#exercise-1--access-node-red)
6. [Exercise 2 — Create a Basic Flow](#exercise-2--create-a-basic-flow)
7. [Exercise 3 — HTTP Endpoint Flows](#exercise-3--http-endpoint-flows)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging](#exercise-6--cloud-logging)
11. [Exercise 7 — Cloud Monitoring and Scaling](#exercise-7--cloud-monitoring-and-scaling)
12. [Cleanup](#cleanup)
13. [Reference](#reference)

---

## 1. Overview

### What Is Node-RED?

Node-RED is a flow-based, low-code programming tool originally created by IBM for wiring
together IoT devices, APIs, and online services. It uses a browser-based visual editor to
build flows by connecting nodes representing inputs, transformations, outputs, and logic.
The `NodeRED_GKE` module deploys **Node-RED** on GKE Autopilot, backed by Cloud Filestore
NFS for persistent flow storage, Workload Identity for keyless GCP access, a LoadBalancer
Service with static external IP, and Cloud Monitoring for observability.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot Runtime** | Managed Kubernetes hosting Node-RED with NFS-backed `/data` persistence |
| **NFS Persistence** | Cloud Filestore NFS keeping flows, credentials, and packages across pod restarts |
| **Workload Identity** | Keyless GCP access for Node-RED to read secrets and write to GCS |
| **Static IP Service** | LoadBalancer Service with reserved static external IP |
| **Flow Creation** | Visual flow editor: Inject → HTTP Request → Debug pipeline |
| **HTTP Endpoints** | HTTP In → Function → HTTP Response for custom REST APIs |
| **Secret Management** | `NODE_RED_CREDENTIAL_SECRET` stored in Secret Manager via Workload Identity |
| **Observability** | Cloud Logging (GKE container logs) and Cloud Monitoring (K8s metrics, uptime) |

---

## 2. Architecture

```
Browser (Node-RED Editor)         curl / IoT Device
         │                               │
         ▼                               ▼
LoadBalancer Service (nodered, port 1880)
  └── static external IP (reserved)
         │
         ▼
GKE Autopilot Pod (nodered)
  ├── Node-RED (nodered/node-red:<version>)
  ├── NFS volume mount: /data (flow persistence)
  ├── Startup probe: HTTP /, 30s delay
  ├── Liveness probe: HTTP /, 30s delay
  ├── NODE_RED_ENABLE_SAFE_MODE=false
  └── Workload Identity (GCP SA binding)
         │
         ├── Cloud Filestore NFS (/data)
         │     ├── flows.json       (flow definitions)
         │     ├── flows_cred.json  (encrypted credentials)
         │     ├── settings.js      (Node-RED configuration)
         │     └── node_modules/    (installed packages)
         │
         └── Secret Manager
               └── NODE_RED_CREDENTIAL_SECRET
                   (accessed via Workload Identity)

Cloud Storage bucket (nodered-storage)
  └── Backups and flow exports
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  GKE Autopilot Cluster                                    │   │
│  │                                                           │   │
│  │  ┌───────────────────────────────────────────────────┐   │    │
│  │  │  appnodered<tenant><id> namespace                  │   │   │
│  │  │  ┌────────────────────────────────────────────┐   │   │    │
│  │  │  │  Deployment: nodered                        │   │   │   │
│  │  │  │  replicas: 1 (stateful — one instance)       │   │   │  │
│  │  │  │  NFS volume mount: /data                     │   │   │  │
│  │  │  │  ServiceAccount: nodered (Workload Identity) │   │   │  │
│  │  │  └────────────────────────────────────────────┘   │   │    │
│  │  │  ┌────────────────────────────────────────────┐   │   │    │
│  │  │  │  Service: nodered (LoadBalancer, port 1880)  │   │   │  │
│  │  │  │  static external IP reserved                │   │   │   │
│  │  │  └────────────────────────────────────────────┘   │   │    │
│  │  └───────────────────────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │  Cloud Filestore │  │  Secret Manager  │  │  Cloud        │   │
│  │  NFS (/data)     │  │  (credential     │  │  Storage      │   │
│  │                  │  │   secret)        │  │  (nodered-    │   │
│  │                  │  │                  │  │   storage)    │   │
│  └──────────────────┘  └──────────────────┘  └───────────────┘   │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Cloud Logging   │  │  Cloud Monitoring (GKE container      │ │
│  │  (k8s_container) │  │   metrics, uptime check, alerts)      │ │
│  └──────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  NodeRED_GKE
    application_version     = "latest"   → nodered/node-red:latest
    enable_nfs              = true        → Cloud Filestore at /data
    nfs_mount_path          = "/data"     → Node-RED userDir
    min_instance_count      = 1          → always-running pod (stateful)
    max_instance_count      = 1          → single stateful instance
    reserve_static_ip       = true        → persistent external IP
    NODE_RED_ENABLE_SAFE_MODE = "false"  → flows execute on startup
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
roles/file.editor
roles/secretmanager.admin
roles/iam.serviceAccountAdmin
roles/monitoring.admin
roles/logging.admin
roles/storage.admin
```

### Environment Variables

```bash
export PROJECT="${PROJECT_ID}"   # your GCP project ID
export REGION="us-central1"      # region you deployed into

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

# Discover the Node-RED namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appnodered" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `NodeRED_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `nodered` | Base name for all resources |
| `application_version` | `latest` | Node-RED image tag |
| `min_instance_count` | `1` | Keep pod running (stateful) |
| `max_instance_count` | `1` | Single stateful instance |
| `enable_nfs` | `true` | NFS for flow persistence |
| `nfs_mount_path` | `/data` | Node-RED userDir |
| `create_cloud_storage` | `true` | GCS bucket for backups |
| `container_resources` | `{cpu_limit="500m", memory_limit="512Mi"}` | Lightweight |

Click **Deploy** and wait for provisioning to complete (approximately 10–20 minutes).

> **What this provisions:** GKE namespace and Deployment, Cloud Filestore NFS instance,
> LoadBalancer Service with static IP, Workload Identity IAM bindings, Secret Manager
> credential secret, GCS bucket, Artifact Registry repository, and Cloud Monitoring
> uptime check.

### 4.2 Configure Shell Environment

```bash
# Configure kubectl access
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
```

### 4.3 Configure kubectl

```bash
# Discover namespace after deployment
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appnodered" | head -1)
echo "Namespace: ${NAMESPACE}"

# Verify pods
kubectl get pods -n "${NAMESPACE}"

# Get external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "Node-RED URL: http://${EXTERNAL_IP}:1880"
```

---

## Exercise 1 — Access Node-RED

### Objective

Use kubectl to find the external IP, verify the Node-RED pod is running, check startup logs,
and tour the flow editor.

### Step 1.1 — Verify Pod and Service

**kubectl:**
```bash
kubectl get pods -n "${NAMESPACE}"
# Expected: nodered-xxxxxxxxx-xxxxx  1/1  Running

kubectl get svc -n "${NAMESPACE}"
# Copy the EXTERNAL-IP column value

kubectl get all -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="name~nodered"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("nodered")) | {name, address, status}'
```

**Expected result:** One pod in `Running` state with `1/1` containers ready. Service shows a public external IP on port 1880.

### Step 1.2 — Check Startup Logs

```bash
kubectl logs -n "${NAMESPACE}" -l app=nodered --tail=30
```

Watch for:
- `Node-RED version: v<VERSION>`
- `Starting flows`
- `Started flows`

**Expected result:** Node-RED started successfully and loaded flows from `/data/flows.json`.

### Step 1.3 — Test Connectivity

```bash
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}:1880/"
# Expected: 200
```

### Step 1.4 — Explore the Editor Layout

Open `http://${EXTERNAL_IP}:1880` in your browser.

Tour the editor:
1. **Left panel — Palette:** All available node categories. Scroll through to see Input, Output, Function, Network, Sequence, Parser, Storage.
2. **Center panel — Canvas:** Where you wire nodes. Empty on fresh deployment.
3. **Right panel — Info/Debug:** Toggle between documentation and runtime debug output.
4. **Top toolbar:** Red Deploy button, hamburger menu for palette management.

**Expected result:** The editor loads with an empty canvas and populated palette.

### Step 1.5 — Inspect the Deployment

```bash
kubectl describe deployment nodered -n "${NAMESPACE}"

# View container spec
kubectl get deployment nodered -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[0].name}'

# Check NFS volume mount
kubectl get deployment nodered -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.volumes}' | jq '.'
```

**Expected result:** Deployment shows 1 replica, NFS volume mounted at `/data`, startup and liveness probes targeting `/`, and resource limits.

---

## Exercise 2 — Create a Basic Flow

### Objective

Build a simple flow that triggers an HTTP request and displays the response in the debug
panel — demonstrating inject, http request, and debug nodes on GKE.

### Step 2.1 — Add and Wire Nodes

1. Drag an **inject** node, an **http request** node, and a **debug** node onto the canvas.
2. Wire: inject → http request → debug.

### Step 2.2 — Configure Each Node

1. **inject**: Payload = `string`, value = `trigger`, Repeat = `none`. Click **Done**.
2. **http request**: Method = `GET`, URL = `https://httpbin.org/json`, Return = `a parsed JSON object`. Click **Done**.
3. **debug**: Output = `msg.payload`. Click **Done**.

### Step 2.3 — Deploy and Trigger

1. Click the red **Deploy** button.

**Expected result:** `Successfully deployed` shown in the toolbar.

2. Click the inject button (square icon on the left of the inject node).
3. Click the **Debug** tab in the right panel.

**Expected result:** The JSON response from `httpbin.org/json` appears in the debug panel showing `slideshow` data.

### Step 2.4 — Verify in Logs

```bash
# View Node-RED logs from GKE
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND resource.labels.container_name="nodered"' \
  --project="${PROJECT}" \
  --freshness=30m \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries show flow deployment and the HTTP request made to httpbin.org.

### Step 2.5 — Add an Error Handler

1. Add a **catch** node from the palette (Input category).
2. Configure it to catch errors from `All nodes`.
3. Wire a **debug** node to the catch node to log any errors.
4. Click **Deploy**.

**Expected result:** Error handling is now in place. Any node failures will be captured and visible in the debug panel.

---

## Exercise 3 — HTTP Endpoint Flows

### Objective

Create an HTTP input endpoint, process the request with a Function node, and return a
structured JSON response — building a custom REST API with Node-RED on GKE.

### Step 3.1 — Build the HTTP Endpoint Flow

1. Drag an **http in** node onto the canvas (Network category).
2. Configure: Method = `POST`, URL = `/my-endpoint`. Click **Done**.
3. Drag a **function** node and configure with this code:

```javascript
msg.payload = {
  received: msg.payload,
  timestamp: new Date().toISOString(),
  message: "Hello from Node-RED on GKE!",
  pod: process.env.HOSTNAME || "unknown"
};
return msg;
```

4. Drag an **http response** node. Configure: Status code = `200`.
5. Wire: **http in** → **function** → **http response**.
6. Add a **debug** node wired to the **function** output as well (for logging).
7. Click **Deploy**.

### Step 3.2 — Test the Endpoint

```bash
curl -X POST "http://${EXTERNAL_IP}:1880/my-endpoint" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello from the GKE lab"}' \
  | python3 -m json.tool
```

**Expected result:**
```json
{
  "received": {"message": "hello from the GKE lab"},
  "timestamp": "2026-05-25T10:00:00.000Z",
  "message": "Hello from Node-RED on GKE!",
  "pod": "nodered-xxxxxxxxx-xxxxx"
}
```

Note: The `pod` field shows the pod hostname, confirming which GKE pod handled the request.

### Step 3.3 — Test Multiple Request Types

```bash
# Test with different content types
curl -X POST "http://${EXTERNAL_IP}:1880/my-endpoint" \
  -H "Content-Type: text/plain" \
  -d "plain text payload"

# Test missing body
curl -X POST "http://${EXTERNAL_IP}:1880/my-endpoint" \
  -H "Content-Type: application/json"
```

**Expected result:** All requests return valid JSON responses. Malformed or missing bodies are handled gracefully by the function node.

### Step 3.4 — View Endpoint Requests in Cloud Logging

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND textPayload=~"POST /my-endpoint"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Each curl request appears as a log entry in Cloud Logging.

### Step 3.5 — Create a Health Check Endpoint

1. Add another **http in** → **function** → **http response** flow.
2. Configure: URL = `/health`, Method = `GET`.
3. Function code:

```javascript
msg.payload = {
  status: "ok",
  uptime: process.uptime(),
  timestamp: new Date().toISOString()
};
msg.statusCode = 200;
return msg;
```

4. Click **Deploy** and test:

```bash
curl -s "http://${EXTERNAL_IP}:1880/health" | python3 -m json.tool
```

**Expected result:** Health endpoint returns status `ok` and Node-RED process uptime in seconds.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Explore the GKE Deployment, Service, PVC, and understand how Kubernetes manages the
Node-RED application lifecycle including pod restarts and NFS persistence.

### Step 4.1 — Inspect the Node-RED Deployment

```bash
kubectl describe deployment nodered -n "${NAMESPACE}"

# View resource limits
kubectl get deployment nodered -n "${NAMESPACE}" \
  -o jsonpath='{.spec.template.spec.containers[0].resources}' | jq '.'
```

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, currentNodeCount, status)"
```

**Expected result:** Deployment shows 1 replica with configured resource limits (500m CPU, 512Mi memory), startup and liveness probes on `/`, and the NFS volume mount.

### Step 4.2 — Inspect the LoadBalancer Service

```bash
kubectl get svc -n "${NAMESPACE}" -o wide
kubectl describe svc nodered -n "${NAMESPACE}"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, status: .status, endpoint: .endpoint}'
```

**Expected result:** Service type is LoadBalancer on port 1880 with the assigned static external IP.

### Step 4.3 — Inspect the NFS PersistentVolumeClaim

```bash
kubectl get pvc -n "${NAMESPACE}"
kubectl describe pvc -n "${NAMESPACE}"
```

**REST API (Filestore):**
```bash
curl -s \
  "https://file.googleapis.com/v1/projects/${PROJECT}/locations/-/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.instances[] | {name, state, tier, fileShares}'
```

**Expected result:** PVC is in `Bound` state, backed by the Cloud Filestore NFS instance.

### Step 4.4 — Restart the Pod and Verify Persistence

```bash
# Restart the Node-RED pod
kubectl rollout restart deployment/nodered -n "${NAMESPACE}"

# Watch the rollout
kubectl rollout status deployment/nodered -n "${NAMESPACE}"

# Wait for new pod
kubectl get pods -n "${NAMESPACE}" -w
```

1. After the new pod is `Running`, refresh `http://${EXTERNAL_IP}:1880`.
2. Verify all flows from Exercises 2 and 3 are still present on the canvas.
3. Click the inject button from Exercise 2 to confirm flows are still executing.

**Expected result:** All flows persist. The NFS-backed `/data` directory preserves `flows.json` across pod restarts.

### Step 4.5 — View Node-RED Pod Resource Usage

```bash
# View pod resource requests and limits
kubectl describe pod -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=nodered -o jsonpath='{.items[0].metadata.name}')" \
  | grep -A10 "Limits:"

# Check Node-RED process inside the pod
kubectl exec -n "${NAMESPACE}" \
  "$(kubectl get pod -n "${NAMESPACE}" -l app=nodered -o jsonpath='{.items[0].metadata.name}')" \
  -- ps aux
```

**Expected result:** The pod shows CPU/memory limits and the Node-RED process running as the main process.

---

## Exercise 5 — Security and Workload Identity

### Objective

Explore Workload Identity for the Node-RED pod, verify Secret Manager access, and confirm
the GCS storage bucket is accessible via the pod's GCP identity.

### Step 5.1 — Inspect Workload Identity Annotation

```bash
# List service accounts in the namespace
kubectl get serviceaccounts -n "${NAMESPACE}"

# View the Workload Identity annotation
kubectl get serviceaccount nodered -n "${NAMESPACE}" -o yaml \
  | grep -A3 "annotations:"
```

**Expected result:** `iam.gke.io/gcp-service-account` annotation points to the Node-RED GCP service account.

### Step 5.2 — Verify GCP Service Account

```bash
NODERED_SA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~nodered" \
  --format="value(email)" \
  --limit=1)

echo "Node-RED GCP SA: ${NODERED_SA}"

# View IAM roles
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${NODERED_SA}" \
  --format="table(bindings.role)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.accounts[] | select(.email | test("nodered")) | {name, email}'
```

**Expected result:** The Node-RED SA has `secretmanager.secretAccessor` and `storage.objectAdmin` roles.

### Step 5.3 — Verify Secret Manager Access

```bash
# List Node-RED secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~nodered"

# Describe the credential secret
CRED_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~nodered" \
  --format="value(name)" \
  --limit=1)

gcloud secrets describe "${CRED_SECRET}" --project="${PROJECT}"

# Check IAM binding on the secret
gcloud secrets get-iam-policy "${CRED_SECRET}" --project="${PROJECT}"
```

**Expected result:** The `NODE_RED_CREDENTIAL_SECRET` secret exists. The Node-RED SA (via Workload Identity) has `secretmanager.secretAccessor` binding.

### Step 5.4 — Verify GCS Access from Pod

```bash
NODERED_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=nodered \
  -o jsonpath='{.items[0].metadata.name}')

# Check if Node-RED environment includes the credential secret
kubectl exec -n "${NAMESPACE}" "${NODERED_POD}" -- \
  env | grep "NODE_RED_CREDENTIAL"

echo "Credential secret is injected — flows_cred.json will be encrypted"
```

**Expected result:** `NODE_RED_CREDENTIAL_SECRET` is set in the pod's environment. All flow credentials stored in `/data/flows_cred.json` on NFS are encrypted with this key.

### Step 5.5 — Review Network Security

```bash
# List network policies (if any)
kubectl get networkpolicies -n "${NAMESPACE}" 2>/dev/null || \
  echo "No NetworkPolicies (default GKE Autopilot)"

# Confirm Filestore NFS is private (no public IP)
gcloud filestore instances list \
  --project="${PROJECT}" \
  --format="table(name, state, networks[0].ipAddresses[0])"
```

**Expected result:** Cloud Filestore NFS has only a private IP. All NFS traffic stays within the VPC.

---

## Exercise 6 — Cloud Logging

### Objective

Query Node-RED container logs from GKE, filter for flow deployment events, view HTTP
endpoint requests, and stream live logs.

### Step 6.1 — View Logs in Log Explorer

Navigate to **Cloud Console > Logging > Log Explorer** and use this filter:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="nodered"
```

**Expected result:** Node-RED startup messages, flow deployment events, and HTTP access logs appear.

### Step 6.2 — Filter Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND resource.labels.container_name="nodered"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=50 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectIds\": [\"${PROJECT}\"],
    \"filter\": \"resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE} AND resource.labels.container_name=nodered\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp: .timestamp, text: .textPayload}'
```

**Expected result:** Node-RED log entries including `Started flows`, debug output, and HTTP request handling.

### Step 6.3 — Filter Flow Deployment Events

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND textPayload=~"deploy|Started flows"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries showing each flow deployment made from the editor.

### Step 6.4 — Filter HTTP Endpoint Requests

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND textPayload=~"POST /my-endpoint|GET /health"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Each curl request from Exercise 3 appears as a log entry.

### Step 6.5 — Stream Live Logs

```bash
kubectl logs -n "${NAMESPACE}" -l app=nodered -f --tail=20
```

Trigger a flow by clicking the inject button and observe entries appear in real time.

**Expected result:** Debug node output and flow execution messages appear within seconds.

---

## Exercise 7 — Cloud Monitoring and Scaling

### Objective

Explore GKE workload metrics for Node-RED, review the uptime check, understand the
single-instance constraint for stateful flows, and set up an alerting policy.

### Step 7.1 — View GKE Workload Metrics

Navigate to **Cloud Console > Kubernetes Engine > Workloads > nodered** and review
the metrics panel for CPU, memory, and network traffic.

```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project="${PROJECT}" \
  | grep -E "cpu|memory|network"
```

**Expected result:** Node-RED is lightweight — CPU utilisation is low (< 5% during idle). Memory reflects the Node.js runtime plus installed nodes (typically 100–300 MB).

### Step 7.2 — Query GKE Metrics via REST API

**REST API — CPU limit utilisation:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container::kubernetes.io/container/cpu/limit_utilization | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.container_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**Expected result:** Node-RED CPU utilisation returned as a decimal fraction (e.g., 0.02 = 2% of the 500m limit).

### Step 7.3 — Review the Uptime Check

```bash
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .displayName, period: .period}'
```

**Expected result:** An uptime check targeting the Node-RED LoadBalancer IP runs every 60 seconds with passing status.

### Step 7.4 — Understand the Single-Instance Constraint

Node-RED is stateful — flows are loaded from disk once at startup, and all flow state is
kept in memory. Running multiple replicas would cause each pod to have independent state.

```bash
# Show the current replica count
kubectl get deployment nodered -n "${NAMESPACE}" \
  -o jsonpath='{.spec.replicas}'

# Demonstrate why scaling up causes issues
kubectl scale deployment nodered --replicas=2 -n "${NAMESPACE}"
kubectl get pods -n "${NAMESPACE}" -w

# Second pod starts with the same flows.json but independent in-memory state
echo "Warning: Two pods = split state. Revert to 1 replica."
kubectl scale deployment nodered --replicas=1 -n "${NAMESPACE}"
kubectl rollout status deployment/nodered -n "${NAMESPACE}"
```

**Expected result:** Two pods start successfully, but each maintains independent flow state. Revert to 1 replica to maintain consistency. For high availability, use Node-RED's built-in project-based versioning instead of horizontal scaling.

### Step 7.5 — Create an Alert Policy

**gcloud:**
```bash
gcloud alpha monitoring policies create \
  --display-name="Node-RED GKE - Pod Restart Alert" \
  --condition-filter="metric.type=\"kubernetes.io/container/restart_count\" resource.label.\"namespace_name\"=\"${NAMESPACE}\"" \
  --condition-threshold-value=3 \
  --condition-threshold-duration=300s \
  --condition-threshold-comparison=COMPARISON_GT \
  --project="${PROJECT}"
```

**REST API — create uptime alert:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"displayName\": \"Node-RED GKE - Uptime Failure\",
    \"conditions\": [{
      \"displayName\": \"Uptime check failure\",
      \"conditionThreshold\": {
        \"filter\": \"metric.type=monitoring.googleapis.com/uptime_check/check_passed\",
        \"comparison\": \"COMPARISON_LT\",
        \"thresholdValue\": 1,
        \"duration\": \"120s\"
      }
    }],
    \"combiner\": \"OR\"
  }" | jq '{name: .name, displayName: .displayName}'
```

**Expected result:** Alert policy created. Fires if Node-RED pod restarts more than 3 times in 5 minutes, indicating flow errors or resource pressure.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `NodeRED_GKE` deployment. This removes
the Kubernetes namespace and workloads, Cloud Filestore NFS instance, GCS bucket, Secret
Manager secrets, static IP, Artifact Registry images, and Cloud Monitoring uptime checks.

> **Note:** Export your flows before cleanup via the editor's **Export > All Flows** option.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# List and delete Filestore instances
gcloud filestore instances list --project="${PROJECT}" --filter="name~nodered"
gcloud filestore instances delete <instance-name> \
  --zone="${REGION}-a" --project="${PROJECT}" --quiet

# Delete Secret Manager secrets
gcloud secrets list --project="${PROJECT}" --filter="name~nodered" \
  --format="value(name)" | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet

# Release static IP
gcloud compute addresses list --project="${PROJECT}" --filter="name~nodered"
gcloud compute addresses delete <address-name> \
  --region="${REGION}" --project="${PROJECT}" --quiet
```

**REST API — get cluster status:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, status: .status}'
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `nodered` | Base name for all resources |
| `application_version` | string | `latest` | Docker Hub tag for `nodered/node-red` |
| `min_instance_count` | number | `1` | Minimum pod replicas (must be ≥ 1 for GKE) |
| `max_instance_count` | number | `1` | Maximum replicas (single stateful instance) |
| `gke_cluster_name` | string | auto | Target GKE cluster (auto-discovers if empty) |
| `enable_nfs` | bool | `true` | Provision Cloud Filestore NFS at `/data` |
| `nfs_mount_path` | string | `/data` | NFS mount path (Node-RED userDir) |
| `create_cloud_storage` | bool | `true` | Provision GCS bucket for backups |
| `enable_iap` | bool | `false` | Enable Identity-Aware Proxy |
| `enable_redis` | bool | `false` | Enable Redis for Node-RED context storage |
| `container_resources` | object | `{cpu_limit="500m", memory_limit="512Mi"}` | Container resource limits |
| `container_image_source` | string | `prebuilt` | Use the official `nodered/node-red` image |
| `deploy_application` | bool | `true` | Set `false` to provision infra only |

### Useful Commands

```bash
# Get all resources in namespace
kubectl get all -n ${NAMESPACE}

# View pod logs (live)
kubectl logs -n ${NAMESPACE} -l app=nodered -f --tail=20

# Get external IP
kubectl get svc -n ${NAMESPACE} -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Restart the deployment
kubectl rollout restart deployment/nodered -n ${NAMESPACE}

# View PVC status
kubectl get pvc -n ${NAMESPACE}

# List Filestore instances
gcloud filestore instances list --project=${PROJECT}

# List secrets
gcloud secrets list --project=${PROJECT} --filter="name~nodered"

# View Workload Identity annotation
kubectl get sa nodered -n ${NAMESPACE} -o yaml | grep iam.gke.io

# List GCS buckets
gcloud storage buckets list --project=${PROJECT} --filter="name~nodered"

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}
```

### Further Reading

- [Node-RED documentation](https://nodered.org/docs/)
- [Node-RED flows library](https://flows.nodered.org/)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity documentation](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud Filestore NFS](https://cloud.google.com/filestore/docs)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke)
- [Node-RED security guide](https://nodered.org/docs/user-guide/runtime/securing-node-red)
- [Kubernetes StatefulSets vs Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/)
