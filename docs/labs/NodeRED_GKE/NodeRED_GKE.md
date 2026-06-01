---
title: "Node-RED on GKE Autopilot — Lab Guide"
sidebar_label: "NodeRED GKE"
---

# Node-RED on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_GKE)**

## Overview

**Estimated time:** 1–2 hours

Node-RED is a flow-based programming tool for event-driven applications — originally designed for IoT but now widely used for API integration, data transformation, home automation, and MQTT-based messaging. This lab deploys Node-RED on GKE Autopilot backed by Cloud Filestore NFS for persistent flow storage. No database is required.

### What the Module Automates

- GKE Autopilot cluster (via Services GCP prerequisite)
- Kubernetes namespace, Deployment, and LoadBalancer Service
- Cloud Filestore NFS instance mounted at `/data` for persistent flow storage
- Cloud Storage bucket for backups and artifacts
- Artifact Registry repository and optional container image mirroring
- Secret Manager secret for the Node-RED credential encryption key (`NODE_RED_CREDENTIAL_SECRET`)
- Workload Identity binding for GCS access
- Static external IP reservation
- Cloud Monitoring uptime checks

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Connect `kubectl` to the GKE cluster and verify the Node-RED pod
- Access the Node-RED editor in your browser
- Explore the editor layout (palette, canvas, debug panel)
- Build a flow that makes an HTTP request and logs the response
- Create an HTTP endpoint and test it with `curl`
- Verify flow persistence across pod restarts (NFS-backed `/data`)
- Check the node-red-dashboard package (if installed)
- Review Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

This lab uses the following CLI tools:

| Tool | Purpose |
|---|---|
| `gcloud` | GCP project and cluster management |
| `kubectl` | Kubernetes workload inspection and pod restarts |
| `curl` | Testing Node-RED HTTP endpoints |

Key REST APIs exercised:

| API | Description |
|---|---|
| `http://<EXTERNAL_IP>:1880` | Node-RED editor UI |
| `http://<EXTERNAL_IP>:1880/my-endpoint` | Custom HTTP endpoint created in Phase 5 |
| `https://container.googleapis.com/v1/...` | GKE Cluster API |

---

## Prerequisites

Before deploying, ensure the following:

1. **Services GCP** module is deployed (provides VPC, GKE cluster, Filestore NFS).
2. `gcloud` CLI is authenticated: `gcloud auth application-default login`
3. `kubectl` is installed.
4. You have a GCP project with billing enabled.
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

**Duration:** 10–20 minutes

### Variables

In the RAD UI, open the NodeRED GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `region` | No | `us-central1` | GCP region for deployment |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `tenant_deployment_id` | No | `demo` | Environment identifier (e.g., `prod`, `dev`) |
| `application_name` | No | `nodered` | Internal app identifier (must be lowercase) |
| `application_version` | No | `latest` | Docker Hub tag for `nodered/node-red` (e.g., `4.0.9`) |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum pod replicas (must be at least 1 for GKE) |
| `max_instance_count` | No | `1` | Maximum pod replicas (keep low — flows are stateful) |
| `gke_cluster_name` | No | auto-discovered | Name of the GKE Autopilot cluster |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS and mount at `/data` |
| `nfs_mount_path` | No | `/data` | NFS mount path inside the container |
| `create_cloud_storage` | No | `true` | Provision GCS bucket for backups |
| `enable_iap` | No | `false` | Enable Identity-Aware Proxy for Google identity auth |
| `enable_redis` | No | `false` | Enable Redis for Node-RED context storage |
| `redis_host` | No | `""` | Redis server IP (required when `enable_redis = true`) |
| `container_image_source` | No | `prebuilt` | `prebuilt` deploys the official `nodered/node-red` image |
| `container_resources` | No | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | CPU/memory limits for the Node-RED container |

### Deploy

Click **Deploy** in the RAD UI.

### Approximate Phase Durations

| Step | Duration |
|---|---|
| NFS Filestore provisioning | 3–5 minutes |
| GKE Deployment rollout | 2–5 minutes |
| Total | **~10–20 minutes** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `kubernetes_ready` | True when all Kubernetes resources are deployed |

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

# Discover the namespace (pattern: appnodereddemo<deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appnodered" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
```

---

## Phase 2 — Connect kubectl and Verify Pod [MANUAL]

**Duration:** 5 minutes

### Steps

1. Fetch GKE credentials:

   ```bash
   gcloud container clusters get-credentials <CLUSTER_NAME> \
     --region <REGION> \
     --project <PROJECT_ID>
   ```

   **gcloud equivalent for listing clusters:**
   ```bash
   gcloud container clusters list --project <PROJECT_ID>
   ```

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://container.googleapis.com/v1/projects/<PROJECT_ID>/locations/<REGION>/clusters"
   ```

2. Find the Node-RED namespace:

   ```bash
   kubectl get namespaces | grep nodered
   ```

3. Verify the pod is running:

   ```bash
   kubectl get pods -n "${NAMESPACE}"
   ```

   **Expected result:** One pod in `Running` state with `1/1` containers ready.

4. Check Node-RED startup logs:

   ```bash
   kubectl logs -n "${NAMESPACE}" -l app=nodered --tail=30
   ```

   Watch for: `Node-RED version: v<VERSION>`, `Starting flows`, `Started flows`.

5. Note the external IP:

   ```bash
   kubectl get service -n "${NAMESPACE}"
   ```

   Copy the `EXTERNAL-IP` value — you will use it throughout the lab.

---

## Phase 3 — Explore the Node-RED Editor [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open your browser and navigate to:

   ```
   http://<EXTERNAL_IP>:1880
   ```

   Node-RED listens on port 1880.

2. If authentication is configured (IAP or Node-RED credentials), log in. By default, no authentication is required.

3. Take a tour of the editor layout:
   - **Left panel (Palette):** All available node categories — Input, Output, Function, Network, Sequence, Parser, Storage, etc. Scroll through to see the variety.
   - **Center panel (Canvas/Flow editor):** Where you wire nodes together into flows. Currently empty on a fresh deployment.
   - **Right panel (Info/Debug):** Switches between node documentation (Info tab) and runtime debug output (Debug tab).
   - **Top toolbar:** Deploy button (red), hamburger menu for settings and palette management.

   **Expected result:** The editor loads with an empty canvas. The palette is populated with all built-in node types.

4. **gcloud logging equivalent** (view Node-RED logs):

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.container_name="nodered"' \
     --project=<PROJECT_ID> \
     --limit=30 \
     --format="table(timestamp,textPayload)"
   ```

---

## Phase 4 — Build Your First Flow [MANUAL]

**Duration:** 10 minutes

In this phase you build a simple flow: trigger an HTTP request and display the response in the debug panel.

### Steps

1. From the palette, drag an **inject** node onto the canvas.

2. Drag an **http request** node onto the canvas to the right of the inject node.

3. Drag a **debug** node onto the canvas to the right of the http request node.

4. Wire them together:
   - Click and drag from the output port (right side) of the inject node to the input port (left side) of the http request node.
   - Click and drag from the output of the http request node to the input of the debug node.

5. Double-click the **inject** node to configure it:
   - Set **Payload** to `string` with value `trigger`
   - Set **Repeat** to `none` (manual trigger only)
   - Click **Done**.

6. Double-click the **http request** node to configure it:
   - Set **Method** to `GET`
   - Set **URL** to `https://httpbin.org/json`
   - Set **Return** to `a parsed JSON object`
   - Click **Done**.

7. Double-click the **debug** node:
   - Set **Output** to `msg.payload`
   - Click **Done**.

8. Click the red **Deploy** button in the top right.

   **Expected result:** The toolbar shows `Successfully deployed`.

9. Click the button (square icon) on the left side of the inject node to trigger the flow.

10. Click the **Debug** tab in the right panel.

    **Expected result:** The JSON response from `httpbin.org/json` appears in the debug panel, showing a parsed object with `slideshow` data.

---

## Phase 5 — HTTP Endpoints [MANUAL]

**Duration:** 10 minutes

In this phase you create an HTTP input endpoint and test it with `curl`.

### Steps

1. Drag an **http in** node onto the canvas (from the Network category in the palette).

2. Double-click it to configure:
   - **Method:** `POST`
   - **URL:** `/my-endpoint`
   - Click **Done**.

3. Drag a **function** node onto the canvas next to the http in node.

4. Double-click the **function** node and paste the following code:

   ```javascript
   msg.payload = {
     received: msg.payload,
     timestamp: new Date().toISOString(),
     message: "Hello from Node-RED on GKE!"
   };
   return msg;
   ```

   Click **Done**.

5. Drag an **http response** node onto the canvas.

6. Wire: **http in** → **function** → **http response**.

7. Click **Deploy**.

8. Test the endpoint with `curl`:

   ```bash
   curl -X POST "http://${EXTERNAL_IP}:1880/my-endpoint" \
     -H "Content-Type: application/json" \
     -d '{"message": "hello from the lab"}' \
     | python3 -m json.tool
   ```

   **Expected result:**
   ```json
   {
     "received": {"message": "hello from the lab"},
     "timestamp": "2026-05-15T10:00:00.000Z",
     "message": "Hello from Node-RED on GKE!"
   }
   ```

9. Try additional HTTP methods or payload structures by modifying the function node code and redeploying.

---

## Phase 6 — Persistent Flows and NFS Storage [MANUAL]

**Duration:** 10 minutes

In this phase you verify that Node-RED flows survive a pod restart — confirming the NFS-backed `/data` volume is working correctly.

### Steps

1. Confirm the flows you deployed in Phases 4 and 5 are visible on the canvas.

2. Inspect the NFS PersistentVolumeClaim used by the Deployment:

   ```bash
   kubectl get pvc -n "${NAMESPACE}"
   kubectl describe pvc -n "${NAMESPACE}"
   ```

   **Expected result:** A PVC bound to the Cloud Filestore NFS instance appears in `Bound` state.

3. Restart the Node-RED pod to simulate a pod restart or node eviction:

   ```bash
   kubectl rollout restart deployment/nodered -n "${NAMESPACE}"
   # Wait for the new pod to be ready:
   kubectl rollout status deployment/nodered -n "${NAMESPACE}"
   ```

   **Expected result:** A new pod starts (the old one terminates). After 30–60 seconds, the new pod is `Running`.

4. Refresh the Node-RED editor in your browser (`http://<EXTERNAL_IP>:1880`).

   **Expected result:** Both flows from Phases 4 and 5 are still present on the canvas. This confirms that Node-RED's `/data` directory — which stores `flows.json`, `flows_cred.json`, and installed packages — is persisted on NFS.

5. **gcloud equivalent** (describe the Filestore instance):

   ```bash
   gcloud filestore instances list --project=<PROJECT_ID>
   ```

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://file.googleapis.com/v1/projects/<PROJECT_ID>/locations/-/instances"
   ```

---

## Phase 7 — Dashboard (If Installed) [MANUAL]

**Duration:** 5–10 minutes

The `node-red-dashboard` package provides UI widgets that render at `/ui`. This phase is optional and depends on whether the dashboard package is installed.

### Steps

1. In the Node-RED editor, click the hamburger menu (top right) and select **Manage palette**.

2. Click the **Install** tab and search for `node-red-dashboard`.

3. If it appears in the installed list (or if you install it now), click **Install** and wait for confirmation.

4. After the palette reloads, look for the **dashboard** category in the left palette panel.

5. Drag a **ui_gauge** node onto the canvas.

6. Double-click it:
   - Create or select a **Tab** (e.g., `Home`).
   - Create or select a **Group** (e.g., `Metrics`).
   - Set **Label** to `Temperature`.
   - Set **Value format** to `{{value}}`.
   - Click **Done**.

7. Wire a **inject** node to the **ui_gauge** (set payload to a number, e.g., `42`).

8. Click **Deploy**.

9. Navigate to:

   ```
   http://<EXTERNAL_IP>:1880/ui
   ```

   **Expected result:** A dashboard page loads showing the gauge at the value injected. Clicking the inject button updates the gauge in real time.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open the [Cloud Logging console](https://console.cloud.google.com/logs).

2. Set the project to your GCP project.

3. Query Node-RED runtime logs:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="<NAMESPACE>"
   resource.labels.container_name="nodered"
   ```

   **gcloud equivalent:**
   ```bash
   gcloud logging read \
     "resource.type=\"k8s_container\" resource.labels.namespace_name=\"${NAMESPACE}\"" \
     --project=<PROJECT_ID> \
     --limit=100 \
     --format="table(timestamp,severity,textPayload)"
   ```

4. Filter for flow deployment events:

   ```
   textPayload=~"deploy|flow|Started"
   ```

5. Filter for HTTP endpoint requests made during Phase 5:

   ```
   textPayload=~"POST /my-endpoint"
   ```

   **Expected result:** Log entries showing Node-RED startup, flow deployments, and HTTP request handling. Debug node output is also visible in the logs.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open the [Cloud Monitoring console](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and look for the GKE workload dashboard.

3. Check key metrics for the Node-RED pod:

   ```bash
   # gcloud equivalent: list available GKE metrics
   gcloud monitoring metrics list \
     --filter="metric.type=starts_with(\"kubernetes.io/container\")" \
     --project=<PROJECT_ID>
   ```

4. View in the console:
   - `kubernetes.io/container/cpu/limit_utilization` — Node-RED is lightweight; should remain below 10%
   - `kubernetes.io/container/memory/limit_utilization` — depends on installed nodes and active flows
   - `kubernetes.io/pod/network/received_bytes_count` — traffic from HTTP requests

5. Review the uptime check (configured with `path = "/"`):

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://monitoring.googleapis.com/v3/projects/<PROJECT_ID>/uptimeCheckConfigs"
   ```

   **Expected result:** The uptime check shows passing status against the Node-RED editor root path. CPU and memory utilization are low, confirming Node-RED's lightweight footprint on GKE Autopilot.

---

## Phase 10 — Undeploy [AUTOMATED]

**Duration:** 5–10 minutes

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**What is removed:** Kubernetes Deployment, Service, namespace, Cloud Filestore NFS instance, GCS bucket, Secret Manager secrets, Artifact Registry images, static IP, Cloud Monitoring uptime checks.

**What is not removed:** The GKE cluster itself (managed by Services GCP), the VPC (managed by Services GCP).

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action | Duration |
|---|---|---|---|
| 1 — Deploy | Automated | RAD UI deployment provisions GKE workload, NFS, GCS, Artifact Registry | 10–20 min |
| 2 — Verify Pod | Manual | `kubectl get pods`, check logs, note external IP | 5 min |
| 3 — Explore Editor | Manual | Navigate palette, canvas, and debug panel | 5 min |
| 4 — First Flow | Manual | Wire inject → HTTP request → debug, deploy and trigger | 10 min |
| 5 — HTTP Endpoints | Manual | Create POST endpoint, test with `curl` | 10 min |
| 6 — NFS Persistence | Manual | Restart pod, verify flows survive, inspect PVC | 10 min |
| 7 — Dashboard | Manual | Install node-red-dashboard, add gauge widget | 5–10 min |
| 8 — Cloud Logging | Manual | Query container logs and HTTP request events | 5 min |
| 9 — Cloud Monitoring | Manual | Review GKE metrics and uptime checks | 5 min |
| 10 — Undeploy | Automated | RAD UI removes all module resources | 5–10 min |
