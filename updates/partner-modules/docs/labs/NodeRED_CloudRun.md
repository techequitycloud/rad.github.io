# Node-RED on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Node-RED** on Google
Cloud Run with the **NodeRED_CloudRun** module. You will explore a flow-based programming
environment for IoT, API integration, and event-driven automation — running on a serverless
runtime with NFS-backed persistent flow storage, HTTP endpoint creation, MQTT integration,
dashboard nodes, and Google Cloud observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Node-RED](#exercise-1--access-node-red)
6. [Exercise 2 — Create a Basic Flow](#exercise-2--create-a-basic-flow)
7. [Exercise 3 — HTTP Endpoint Flows](#exercise-3--http-endpoint-flows)
8. [Exercise 4 — MQTT and IoT Integration](#exercise-4--mqtt-and-iot-integration)
9. [Exercise 5 — Dashboard Nodes](#exercise-5--dashboard-nodes)
10. [Exercise 6 — Flow Persistence and Storage](#exercise-6--flow-persistence-and-storage)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Node-RED?

Node-RED is a flow-based, low-code programming tool originally created by IBM for wiring
together IoT devices, APIs, and online services. It uses a browser-based visual editor to
build flows by connecting nodes that represent inputs, transformations, outputs, and logic.
It is widely used for IoT automation, API integration, data pipelines, and home automation.
The `NodeRED_CloudRun` module deploys **Node-RED** on Cloud Run Gen 2, backed by Cloud
Filestore NFS for persistent flow storage — ensuring flows, credentials, and installed nodes
survive Cloud Run instance restarts and scale-to-zero cycles.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Serverless Flow Editor** | Cloud Run Gen 2 hosting Node-RED with NFS-backed `/data` persistence |
| **NFS Persistence** | Cloud Filestore NFS keeping flows, credentials, and packages across restarts |
| **Flow Creation** | Visual flow editor: Inject → HTTP Request → Debug pipeline |
| **HTTP Endpoints** | HTTP In → Function → HTTP Response for custom REST APIs |
| **MQTT/IoT Nodes** | MQTT In/Out nodes for subscribe/publish with simulated IoT data |
| **Dashboard UI** | `node-red-dashboard` package with gauge, chart, and form widgets |
| **Secret Management** | `NODE_RED_CREDENTIAL_SECRET` stored in Secret Manager |
| **Observability** | Cloud Logging (Node-RED runtime logs) and Cloud Monitoring (request metrics) |

---

## 2. Architecture

```
Browser (Node-RED Editor)        curl / IoT Device
         │                              │
         ▼                              ▼
Cloud Run Gen 2 Service (nodered)  → port 1880
  ├── Node-RED (nodered/node-red:<version>)
  ├── NFS mount: /data (flow persistence)
  ├── Startup probe: HTTP /, 30s delay
  ├── Liveness probe: HTTP /, 30s delay
  ├── NODE_RED_ENABLE_SAFE_MODE=false
  └── Serverless VPC Access connector
         │
         ├── Cloud Filestore NFS (/data)
         │     ├── flows.json       (flow definitions)
         │     ├── flows_cred.json  (encrypted credentials)
         │     ├── settings.js      (Node-RED configuration)
         │     └── node_modules/    (installed packages)
         │
         └── Secret Manager
               └── NODE_RED_CREDENTIAL_SECRET
                   (credential file encryption key)

Cloud Storage bucket (nodered-storage)
  └── Backups and flow exports
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Cloud Run Gen 2                                          │   │
│  │  nodered service → https://<hash>.run.app                 │   │
│  │  min_instances=0 (scale to zero), max_instances=1         │   │
│  │  execution_environment=gen2 (required for NFS)            │   │
│  └─────────────────────┬────────────────────────────────────┘    │
│                         │ VPC connector (private ranges)         │
│  ┌──────────────────────▼─────────────────────────────────────┐  │
│  │  VPC Network                                                │ │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Cloud Filestore NFS                                  │  │ │
│  │  │  mounted at /data inside Cloud Run container          │  │ │
│  │  │  (flows.json, flows_cred.json, node_modules/)         │  │ │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │  Secret Manager  │  │  Cloud Storage   │  │  Artifact     │   │
│  │  (credential     │  │  (nodered-       │  │  Registry     │   │
│  │   secret key)    │  │   storage)       │  │  (image)      │   │
│  └──────────────────┘  └──────────────────┘  └───────────────┘   │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Cloud Logging   │  │  Cloud Monitoring (request count,    │  │
│  │  (Node-RED       │  │   latency, instance count,           │  │
│  │   runtime logs)  │  │   uptime check)                      │  │
│  └──────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  NodeRED_CloudRun
    application_version     = "latest"   → nodered/node-red:latest
    enable_nfs              = true        → Cloud Filestore at /data
    nfs_mount_path          = "/data"     → Node-RED userDir
    min_instance_count      = 0          → scale to zero
    max_instance_count      = 1          → single stateful instance
    execution_environment   = "gen2"     → required for NFS mounts
    NODE_RED_ENABLE_SAFE_MODE = "false"  → flows execute on startup
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
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

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~nodered" \
  --limit=1)

# Discover the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `NodeRED_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `nodered` | Base name for all resources |
| `application_version` | `latest` | Node-RED image tag |
| `min_instance_count` | `0` | Scale to zero when idle |
| `max_instance_count` | `1` | Single stateful instance |
| `cpu_limit` | `1000m` | CPU per instance |
| `memory_limit` | `1Gi` | Memory per instance |
| `execution_environment` | `gen2` | Required for NFS mounts |
| `enable_nfs` | `true` | NFS for flow persistence |
| `nfs_mount_path` | `/data` | Node-RED userDir |
| `ingress_settings` | `all` | Public HTTPS endpoint |

Click **Deploy** and wait for provisioning to complete (approximately 8–18 minutes).

> **What this provisions:** Cloud Run Gen 2 service, Cloud Filestore NFS instance, Serverless
> VPC Access connector, Secret Manager secret for credential encryption, GCS bucket for
> backups, Artifact Registry repository, and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

After deployment completes, set the shell variables from Section 3 and verify:

```bash
# Confirm service is deployed
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions[0].type)"

# Test connectivity
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/"
# Expected: 200
```

---

## Exercise 1 — Access Node-RED

### Objective

Retrieve the Cloud Run service URL, verify Node-RED is running, and take a tour of the
flow editor — palette, canvas, and debug panel.

### Step 1.1 — Get the Service URL

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)"

echo "Node-RED Editor: ${SERVICE_URL}"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, url: .uri, state: .terminalCondition.state}'
```

**Expected result:** A URL in the format `https://<hash>.run.app` is returned with terminal condition `CONTAINER_READY`.

### Step 1.2 — Verify Node-RED is Running

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/"
# Expected: 200

# View startup logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
  --project="${PROJECT}" \
  --freshness=30m \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** HTTP 200 returned. Startup logs show `Node-RED version: v<VERSION>`, `Starting flows`, `Started flows`.

### Step 1.3 — Explore the Editor Layout

Open `${SERVICE_URL}` in your browser. If authentication is configured, log in.

Tour the editor:
1. **Left panel — Palette:** All available node categories — Input, Output, Function, Network, Sequence, Parser, Storage. Scroll through to see the variety.
2. **Center panel — Canvas:** Where you wire nodes together. Empty on a fresh deployment.
3. **Right panel — Info/Debug:** Toggle between node documentation (Info) and runtime output (Debug).
4. **Top toolbar:** Red Deploy button, hamburger menu for palette management and settings.

**Expected result:** The editor loads with an empty canvas and a populated palette.

### Step 1.4 — Inspect the Service Configuration

```bash
# View NFS volume mount configuration
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml" | grep -A10 "volumes:"

# List service revisions
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].type)"
```

**Expected result:** NFS volume mounted at `/data`. The revision shows `ACTIVE` status.

### Step 1.5 — Inspect the Credential Secret

```bash
# List Node-RED secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~nodered"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | select(.name | test("nodered")) | {name: .name}'
```

**Expected result:** A secret for `NODE_RED_CREDENTIAL_SECRET` is listed. Node-RED uses this key to encrypt `flows_cred.json` on the NFS volume.

---

## Exercise 2 — Create a Basic Flow

### Objective

Build a simple flow that triggers an HTTP request and displays the response in the debug
panel — demonstrating inject, http request, and debug nodes.

### Step 2.1 — Add Nodes to the Canvas

1. From the palette, drag an **inject** node onto the canvas.
2. Drag an **http request** node to the right of the inject node.
3. Drag a **debug** node to the right of the http request node.

### Step 2.2 — Wire the Nodes

Click and drag from the output port (right side) of each node to the input port (left side)
of the next:
- inject → http request
- http request → debug

### Step 2.3 — Configure Each Node

1. **inject node**: Double-click → set Payload to `string` with value `trigger` → set Repeat to `none` → click **Done**.
2. **http request node**: Double-click → set Method to `GET` → set URL to `https://httpbin.org/json` → set Return to `a parsed JSON object` → click **Done**.
3. **debug node**: Double-click → set Output to `msg.payload` → click **Done**.

### Step 2.4 — Deploy and Trigger

1. Click the red **Deploy** button.

**Expected result:** Toolbar shows `Successfully deployed`.

2. Click the button (square icon) on the left side of the inject node.
3. Click the **Debug** tab in the right panel.

**Expected result:** The JSON response from `httpbin.org/json` appears, showing a parsed object with `slideshow` data.

### Step 2.5 — View Flow Deployment in Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"deploy|Started flows"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=5 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries show Node-RED flow deployment events.

---

## Exercise 3 — HTTP Endpoint Flows

### Objective

Create an HTTP input endpoint that processes incoming requests and returns a structured
JSON response — building a simple custom REST API with Node-RED.

### Step 3.1 — Add an HTTP In Node

1. Drag an **http in** node from the Network category in the palette.
2. Double-click to configure:
   - **Method:** `POST`
   - **URL:** `/my-endpoint`
3. Click **Done**.

### Step 3.2 — Add a Function Node

1. Drag a **function** node onto the canvas.
2. Double-click and paste the following JavaScript:

```javascript
msg.payload = {
  received: msg.payload,
  timestamp: new Date().toISOString(),
  message: "Hello from Node-RED on Cloud Run!",
  host: msg.req.hostname
};
return msg;
```

3. Click **Done**.

### Step 3.3 — Add an HTTP Response Node

1. Drag an **http response** node onto the canvas.
2. Double-click → set **Status code** to `200` → click **Done**.
3. Wire: **http in** → **function** → **http response**.
4. Click **Deploy**.

### Step 3.4 — Test the Endpoint

```bash
curl -X POST "${SERVICE_URL}/my-endpoint" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello from the lab"}' \
  | python3 -m json.tool
```

**Expected result:**
```json
{
  "received": {"message": "hello from the lab"},
  "timestamp": "2026-05-25T10:00:00.000Z",
  "message": "Hello from Node-RED on Cloud Run!",
  "host": "<cloud-run-hostname>"
}
```

### Step 3.5 — Test Additional HTTP Methods

Modify the function node to add request method inspection and test with GET:

```bash
# Modify the http in node to accept GET requests
# (change Method to GET in the node config)

curl -s "${SERVICE_URL}/my-endpoint?param=test" | python3 -m json.tool
```

**gcloud (view endpoint request logs):**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"POST /my-endpoint|GET /my-endpoint"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** HTTP requests to `/my-endpoint` are logged in Cloud Logging with status 200.

---

## Exercise 4 — MQTT and IoT Integration

### Objective

Use MQTT nodes to subscribe and publish IoT messages, simulate sensor data with the inject
node, and process the data stream in a flow.

### Step 4.1 — Add an MQTT Out Node

1. From the palette, drag an **mqtt out** node onto the canvas.
2. Double-click to configure:
   - **Server:** `broker.hivemq.com` (public test broker)
   - **Port:** `1883`
   - **Topic:** `nodered/lab/sensor`
3. Click **Done** (and **Add** to create the broker connection).

### Step 4.2 — Add an MQTT In Node

1. Drag an **mqtt in** node onto the canvas.
2. Double-click to configure:
   - **Server:** select `broker.hivemq.com` (same broker)
   - **Topic:** `nodered/lab/sensor`
   - **QoS:** `0`
3. Click **Done**.

### Step 4.3 — Build the Simulation Flow

1. Add an **inject** node configured to:
   - Payload: `JSON` type with value `{"temperature": 22.5, "humidity": 65, "device": "sensor-01"}`
   - Repeat: **interval** every 5 seconds
2. Wire: **inject** → **mqtt out**.
3. Add a **debug** node and wire: **mqtt in** → **debug**.
4. Click **Deploy**.

### Step 4.4 — Observe the MQTT Data Stream

1. Click the **Debug** tab in the right panel.
2. Watch incoming MQTT messages from the subscription.

**Expected result:** Every 5 seconds, a simulated sensor payload appears in the debug panel showing temperature, humidity, and device ID.

### Step 4.5 — Add a Filter Function

1. Add a **function** node between **mqtt in** and **debug**.
2. Configure it to filter high-temperature events:

```javascript
const data = JSON.parse(msg.payload);
if (data.temperature > 22) {
  msg.payload = {
    alert: "High temperature detected",
    value: data.temperature,
    device: data.device,
    time: new Date().toISOString()
  };
  return msg;
}
return null;  // Drop messages below threshold
```

3. Wire: **mqtt in** → **function** → **debug**.
4. Click **Deploy**.

**Expected result:** Only MQTT messages with temperature > 22 appear in the debug panel, demonstrating message filtering.

---

## Exercise 5 — Dashboard Nodes

### Objective

Install the `node-red-dashboard` package, create gauge and chart widgets, and view the
live dashboard UI in the browser.

### Step 5.1 — Install node-red-dashboard

1. In the Node-RED editor, click the hamburger menu (top-right) > **Manage palette**.
2. Click the **Install** tab.
3. Search for `node-red-dashboard`.
4. Click **Install** and wait for confirmation (packages are installed to `/data/node_modules` on NFS).

**Expected result:** Dashboard nodes appear in the palette under a **dashboard** category.

### Step 5.2 — Create a Gauge Widget

1. Drag a **ui_gauge** node onto the canvas.
2. Double-click to configure:
   - Create a **Tab**: `Lab Dashboard`
   - Create a **Group**: `Sensor Data`
   - **Label:** `Temperature (°C)`
   - **Value format:** `{{value}}`
   - **Range:** min `0`, max `50`
3. Click **Done**.
4. Add an **inject** node with payload type `number` and value `22.5`.
5. Wire: **inject** → **ui_gauge**.
6. Click **Deploy**.

### Step 5.3 — Create a Chart Widget

1. Drag a **ui_chart** node onto the canvas.
2. Double-click: use the same Tab and Group, **Label** `Temperature History`, **Type** `Line chart`.
3. Wire the same **inject** node to the **ui_chart** node as well.
4. Click **Deploy**.

### Step 5.4 — View the Dashboard

```
https://${SERVICE_URL}/ui
```

**Expected result:** A dashboard page loads showing the gauge and line chart. Clicking the inject button updates both widgets in real time.

### Step 5.5 — Test Dashboard Persistence

```bash
# Force a new Cloud Run revision
gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --update-labels "lab-restart=$(date +%s)"
```

After the revision change, reload `${SERVICE_URL}/ui`.

**Expected result:** The dashboard UI and its flow definitions persist because they are stored in `/data/flows.json` on the NFS volume.

---

## Exercise 6 — Flow Persistence and Storage

### Objective

Verify that Node-RED flows survive Cloud Run instance restarts, inspect the NFS volume
configuration, export and import flows, and confirm GCS backup storage.

### Step 6.1 — Verify NFS Mount Configuration

```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml" | grep -A15 "volumes:"
```

**REST API:**
```bash
curl -s \
  "https://file.googleapis.com/v1/projects/${PROJECT}/locations/-/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.instances[] | {name, state, tier, fileShares}'
```

**Expected result:** NFS volume mounted at `/data`. Filestore instance shows `READY` state with the flow data share.

### Step 6.2 — Export Flows from Editor

1. In Node-RED, click the hamburger menu > **Export** > **All Flows**.
2. Select **Download** to save `flows.json` locally.
3. This is the same file that Node-RED writes to `/data/flows.json` on NFS.

**Expected result:** A `flows.json` file downloads containing all your flow definitions.

### Step 6.3 — Force a Cloud Run Instance Restart

```bash
# Update a label to trigger a new revision (simulates instance replacement)
gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --update-labels "lab-restart=$(date +%s)"

# Wait for new revision
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].type, metadata.creationTimestamp)"
```

### Step 6.4 — Verify Flow Persistence After Restart

1. After the new revision is active, refresh `${SERVICE_URL}` in your browser.
2. Verify that all flows from Exercises 2, 3, 4, and 5 are still present on the canvas.
3. Trigger the inject node from Exercise 2 to confirm flows are still executing.

**Expected result:** All flows are present and functional. The NFS-backed `/data` directory preserves `flows.json` and all installed packages across instance replacements.

### Step 6.5 — Inspect GCS Backup Storage

```bash
# List Node-RED GCS storage bucket
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~nodered"

# REST API
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=nodered" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name, location, storageClass}'
```

**Expected result:** A `nodered-storage` bucket exists in STANDARD storage class for backups and exports.

---

## Exercise 7 — Cloud Logging

### Objective

Query Node-RED runtime logs, filter for flow deployment events, view HTTP endpoint request
logs, and stream live logs using gcloud.

### Step 7.1 — View Logs in Log Explorer

Navigate to **Cloud Console > Logging > Log Explorer** and use this filter:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

**Expected result:** Node-RED startup messages, flow deployment events, and HTTP request logs appear.

### Step 7.2 — Filter Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
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
    \"filter\": \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp: .timestamp, text: .textPayload}'
```

**Expected result:** Node-RED runtime log entries appear including flow start messages and HTTP request handling.

### Step 7.3 — Filter Flow Deployment Events

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"deploy|Started flows|flow"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entries show each time flows were deployed from the editor.

### Step 7.4 — Filter HTTP Endpoint Requests

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"POST /my-endpoint"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Each `curl` request to `/my-endpoint` appears as a log entry with status 200.

### Step 7.5 — Stream Live Logs

```bash
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

Trigger a flow by clicking the inject button and observe log entries appear in real time.

**Expected result:** Node-RED debug node output and HTTP request logs appear within seconds.

---

## Exercise 8 — Cloud Monitoring

### Objective

Explore Cloud Run metrics for Node-RED, review the uptime check, observe scale-to-zero
instance behaviour, and query metrics via the REST API.

### Step 8.1 — View Cloud Run Metrics in Console

Navigate to **Cloud Console > Cloud Run > Services > nodered** and review the metrics tabs:

| Metric Tab | Key Metrics |
|---|---|
| **Requests** | Request count, latency P50/P95/P99 |
| **Container** | CPU utilisation, memory utilisation |
| **Instances** | Active instance count (scale-to-zero observable) |

**Expected result:** Instance count drops to 0 during idle periods. CPU and memory are low (Node-RED is lightweight).

### Step 8.2 — Review the Uptime Check

```bash
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .displayName, path: .httpCheck.path, period: .period}'
```

**Expected result:** An uptime check targeting the Node-RED root path (`/`) runs every 60 seconds. Note that scale-to-zero may cause brief uptime check failures before the cold start completes.

### Step 8.3 — Query Request Metrics via REST API

```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**Expected result:** Total request count for the past hour (includes editor interaction and endpoint calls).

### Step 8.4 — Observe Scale-to-Zero Behaviour

```bash
# List instance count metric
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com/container/instance_count" \
  --project="${PROJECT}"
```

1. Stop interacting with the editor for 5+ minutes (no requests).
2. Check the instance count metric in Metrics Explorer — it should drop to 0.
3. Make a request to `${SERVICE_URL}/` — observe the cold start latency spike.

**Expected result:** Instance count drops to 0 during idle. First request after cold start shows higher latency (typically 2–5 seconds for Node-RED startup).

### Step 8.5 — Review Alert Policies

```bash
gcloud alpha monitoring policies list --project="${PROJECT}"
```

Navigate to **Cloud Console > Monitoring > Alerting** to view any alert policies configured
for the Node-RED uptime check.

**gcloud (create a latency alert):**
```bash
gcloud alpha monitoring policies create \
  --display-name="Node-RED CloudRun - High Latency" \
  --condition-filter="metric.type=\"run.googleapis.com/request_latencies\" resource.label.\"service_name\"=\"${SERVICE}\"" \
  --condition-threshold-value=5000 \
  --condition-threshold-duration=60s \
  --condition-threshold-comparison=COMPARISON_GT \
  --project="${PROJECT}"
```

**Expected result:** Alert policy created. Fires if Node-RED response latency exceeds 5 seconds (indicating cold start issues).

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `NodeRED_CloudRun` deployment. This removes
the Cloud Run service, Cloud Filestore NFS instance, GCS bucket, Secret Manager secrets,
VPC connector, Artifact Registry images, and Cloud Monitoring uptime checks.

> **Note:** Export your flows before cleanup via the editor's **Export > All Flows** option.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --quiet

# List and delete Filestore instances
gcloud filestore instances list --project="${PROJECT}"
gcloud filestore instances delete <instance-name> \
  --zone="${REGION}-a" --project="${PROJECT}" --quiet

# Delete Secret Manager secrets
gcloud secrets list --project="${PROJECT}" --filter="name~nodered" \
  --format="value(name)" | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
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
| `min_instance_count` | number | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | number | `1` | Maximum instances (stateful — keep at 1) |
| `cpu_limit` | string | `1000m` | CPU per Cloud Run instance |
| `memory_limit` | string | `1Gi` | Memory per Cloud Run instance |
| `execution_environment` | string | `gen2` | Must be `gen2` for NFS mounts |
| `enable_nfs` | bool | `true` | Provision Cloud Filestore NFS at `/data` |
| `nfs_mount_path` | string | `/data` | NFS mount path (Node-RED userDir) |
| `ingress_settings` | string | `all` | Traffic ingress setting |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | VPC egress for NFS connectivity |
| `timeout_seconds` | number | `300` | Cloud Run request timeout |
| `cpu_always_allocated` | bool | `false` | Keep CPU allocated (needed for background tasks) |
| `enable_iap` | bool | `false` | Enable Identity-Aware Proxy |
| `enable_redis` | bool | `false` | Enable Redis for Node-RED context storage |
| `create_cloud_storage` | bool | `true` | Provision GCS bucket for backups |
| `deploy_application` | bool | `true` | Set `false` to provision infra only |

### Useful Commands

```bash
# Get service URL
gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} --format="value(status.url)"

# View NFS mount configuration
gcloud run services describe ${SERVICE} --region=${REGION} --format="yaml" | grep -A10 "volumes:"

# Tail live logs
gcloud run services logs tail ${SERVICE} --region=${REGION} --project=${PROJECT}

# List revisions
gcloud run revisions list --service=${SERVICE} --region=${REGION} --project=${PROJECT}

# Force new revision (simulate restart)
gcloud run services update ${SERVICE} --region=${REGION} --project=${PROJECT} --update-labels restart=$(date +%s)

# List Filestore instances
gcloud filestore instances list --project=${PROJECT}

# List GCS buckets
gcloud storage buckets list --project=${PROJECT} --filter="name~nodered"

# List secrets
gcloud secrets list --project=${PROJECT} --filter="name~nodered"

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}
```

### Further Reading

- [Node-RED documentation](https://nodered.org/docs/)
- [Node-RED flows library](https://flows.nodered.org/)
- [node-red-dashboard package](https://flows.nodered.org/node/node-red-dashboard)
- [MQTT protocol overview](https://mqtt.org/)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud Filestore NFS](https://cloud.google.com/filestore/docs)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [HiveMQ public MQTT broker](https://www.hivemq.com/mqtt/public-mqtt-broker/)
