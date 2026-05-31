# Node-RED on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Node-RED is a flow-based programming tool for event-driven applications — originally designed for IoT but now widely used for API integration, data transformation, home automation, and MQTT-based messaging. This lab deploys Node-RED on Cloud Run Gen2 backed by Cloud Filestore NFS for persistent flow storage. No database is required.

### What the Module Automates

- Cloud Run Gen2 service with NFS volume mount
- Cloud Filestore NFS instance mounted at `/data` for persistent flow, credential, and node package storage
- Serverless VPC Access connector for private NFS connectivity
- Cloud Storage bucket for backups and artifacts
- Artifact Registry repository and optional image mirroring from Docker Hub
- Secret Manager secret for the Node-RED credential encryption key (`NODE_RED_CREDENTIAL_SECRET`)
- Cloud Run service account with least-privilege IAM bindings
- Cloud Monitoring uptime checks and alert policies
- Cloud Run Jobs for scheduled NFS backup tasks

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Access the Node-RED editor in your browser
- Explore the editor layout (palette, canvas, debug panel)
- Build a flow that makes an HTTP request and logs the response
- Create an HTTP endpoint and test it with `curl`
- Verify flow persistence across Cloud Run instance restarts (NFS-backed `/data`)
- Check the node-red-dashboard package (if installed)
- Review Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

This lab uses the following CLI tools:

| Tool | Purpose |
|---|---|
| `gcloud` | GCP project and Cloud Run management |
| `curl` | Testing Node-RED HTTP endpoints and health checks |

Key REST APIs exercised:

| API | Description |
|---|---|
| `https://<SERVICE_URL>` | Node-RED editor UI (port 1880 proxied via Cloud Run) |
| `https://<SERVICE_URL>/my-endpoint` | Custom HTTP endpoint created in Phase 5 |
| `https://run.googleapis.com/v2/...` | Cloud Run Service API |

---

## Prerequisites

Before deploying, ensure the following:

1. **Services_GCP** module is deployed (provides VPC, Serverless VPC Access connector, Cloud Filestore NFS).
2. `gcloud` CLI is authenticated: `gcloud auth application-default login`
3. You have a GCP project with billing enabled.
4. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

**Duration:** 8–18 minutes

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `region` | No | `us-central1` | GCP region for deployment |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `tenant_deployment_id` | No | `demo` | Environment identifier (e.g., `prod`, `dev`) |
| `application_name` | No | `nodered` | Internal app identifier (must be lowercase) |
| `application_version` | No | `latest` | Docker Hub tag for `nodered/node-red` (e.g., `4.0.9`) |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Set to `1` to keep Node-RED warm (avoids cold-start delays) |
| `max_instance_count` | No | `1` | Maximum instances (keep low — flows are stateful) |
| `cpu_limit` | No | `1000m` | CPU per Cloud Run instance |
| `memory_limit` | No | `1Gi` | Memory per Cloud Run instance |
| `execution_environment` | No | `gen2` | Must be `gen2` for NFS mount support |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS and mount at `/data` |
| `nfs_mount_path` | No | `/data` | NFS mount path inside the container |
| `ingress_settings` | No | `all` | Traffic sources: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | Route private IPs (NFS/Redis) through VPC |
| `timeout_seconds` | No | `300` | Max seconds Cloud Run waits for a response |
| `create_cloud_storage` | No | `true` | Provision GCS bucket for backups |
| `enable_iap` | No | `false` | Enable Identity-Aware Proxy for Google identity auth |
| `enable_redis` | No | `false` | Enable Redis for Node-RED context storage |
| `redis_host` | No | `""` | Redis server IP (required when `enable_redis = true`) |
| `cpu_always_allocated` | No | `false` | When `true`, CPU is always allocated (needed for background tasks) |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Approximate Phase Durations

| Step | Duration |
|---|---|
| NFS Filestore provisioning | 3–5 minutes |
| Cloud Run service deployment | 1–3 minutes |
| Total | **~8–18 minutes** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name |
| `service_url` | HTTPS URL for the Cloud Run service |
| `service_location` | GCP region where the service is deployed |
| `project_id` | GCP project ID |
| `deployment_id` | Auto-generated or provided deployment ID |
| `storage_buckets` | GCS bucket names |
| `nfs_server_ip` | NFS server internal IP (sensitive) |
| `nfs_mount_path` | NFS mount path inside the container (`/data`) |
| `container_image` | Full image URI deployed |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "nodered")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")
```

---

## Phase 2 — Get the Service URL [MANUAL]

**Duration:** 2 minutes

### Steps

1. Verify the service is responding:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/"
   ```

   **Expected result:** HTTP status `200`. If you see `503`, wait 30–60 seconds for the Cloud Run startup probe to pass.

2. **gcloud equivalent** (describe the Cloud Run service):

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --format="value(status.url)"
   ```

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
   ```

3. List all Cloud Run revisions:

   ```bash
   gcloud run revisions list \
     --service ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

---

## Phase 3 — Explore the Node-RED Editor [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open your browser and navigate to the service URL:

   ```
   https://${SERVICE_URL}
   ```

   Cloud Run routes traffic to Node-RED on port 1880.

2. If authentication is configured (IAP), log in with your Google account. By default, no authentication is required.

3. Take a tour of the editor layout:
   - **Left panel (Palette):** All available node categories — Input, Output, Function, Network, Sequence, Parser, Storage, etc. Scroll through to see the variety.
   - **Center panel (Canvas/Flow editor):** Where you wire nodes together into flows. Currently empty on a fresh deployment.
   - **Right panel (Info/Debug):** Switches between node documentation (Info tab) and runtime debug output (Debug tab).
   - **Top toolbar:** Deploy button (red), hamburger menu for settings and palette management.

   **Expected result:** The editor loads with an empty canvas. The palette is populated with all built-in node types.

4. **gcloud logging equivalent** (view Node-RED startup logs):

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" resource.labels.service_name="'${SERVICE}'"' \
     --project=${PROJECT} \
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
     message: "Hello from Node-RED on Cloud Run!"
   };
   return msg;
   ```

   Click **Done**.

5. Drag an **http response** node onto the canvas.

6. Wire: **http in** → **function** → **http response**.

7. Click **Deploy**.

8. Test the endpoint with `curl`:

   ```bash
   curl -X POST "$SERVICE_URL/my-endpoint" \
     -H "Content-Type: application/json" \
     -d '{"message": "hello from the lab"}' \
     | python3 -m json.tool
   ```

   **Expected result:**
   ```json
   {
     "received": {"message": "hello from the lab"},
     "timestamp": "2026-05-15T10:00:00.000Z",
     "message": "Hello from Node-RED on Cloud Run!"
   }
   ```

9. Try additional HTTP methods or payload structures by modifying the function node code and redeploying.

---

## Phase 6 — Persistent Flows and NFS Storage [MANUAL]

**Duration:** 10 minutes

In this phase you verify that Node-RED flows survive a Cloud Run instance restart — confirming the NFS-backed `/data` volume is working correctly.

### Steps

1. Confirm the flows you deployed in Phases 4 and 5 are visible on the canvas.

2. Check the NFS mount by inspecting the Cloud Run service configuration:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --format="yaml" | grep -A5 "volumes"
   ```

   **Expected result:** The NFS volume mount at `/data` is listed in the revision spec.

3. Force a new Cloud Run revision to simulate an instance restart (update a label to trigger redeployment):

   ```bash
   gcloud run services update ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --update-labels restart-time=$(date +%s)
   ```

   Wait for the new revision to take traffic:
   ```bash
   gcloud run revisions list \
     --service ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

4. Refresh the Node-RED editor in your browser.

   **Expected result:** Both flows from Phases 4 and 5 are still present on the canvas. This confirms that Node-RED's `/data` directory — which stores `flows.json`, `flows_cred.json`, and installed packages — is persisted on NFS and survives Cloud Run instance replacement.

5. **gcloud equivalent** (describe the Filestore instance):

   ```bash
   gcloud filestore instances list --project=${PROJECT}
   ```

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://file.googleapis.com/v1/projects/${PROJECT}/locations/-/instances"
   ```

---

## Phase 7 — Dashboard (If Installed) [MANUAL]

**Duration:** 5–10 minutes

The `node-red-dashboard` package provides UI widgets that render at `/ui`. This phase is optional and depends on whether the dashboard package is installed.

### Steps

1. In the Node-RED editor, click the hamburger menu (top right) and select **Manage palette**.

2. Click the **Install** tab and search for `node-red-dashboard`.

3. If it appears in the installed list (or if you install it now), click **Install** and wait for confirmation.

   > **Note for Cloud Run:** Installed packages are written to `/data/node_modules` (on NFS), so they persist across instance restarts. However, Cloud Run instances that have not yet received a request since the package was installed may need to restart for the package to be available.

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
   https://${SERVICE_URL}/ui
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
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   ```

   **gcloud equivalent:**
   ```bash
   gcloud logging read \
     "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${SERVICE}\"" \
     --project=${PROJECT} \
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

6. Filter for NFS mount activity:

   ```
   textPayload=~"nfs|/data"
   ```

   **Expected result:** Log entries showing Node-RED startup, NFS mount success, flow deployments, and HTTP request handling. Debug node output is also visible in the logs.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

**Duration:** 5 minutes

### Steps

1. Open the [Cloud Monitoring console](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and look for Cloud Run service dashboards.

3. View key Cloud Run metrics for the Node-RED service:

   ```bash
   # gcloud equivalent: list available Cloud Run metrics
   gcloud monitoring metrics list \
     --filter="metric.type=starts_with(\"run.googleapis.com\")" \
     --project=${PROJECT}
   ```

4. Check key metrics in the console:
   - `run.googleapis.com/request_count` — total requests served (includes editor activity)
   - `run.googleapis.com/request_latencies` — response time distribution
   - `run.googleapis.com/container/cpu/utilizations` — CPU usage per revision
   - `run.googleapis.com/container/memory/utilizations` — memory usage

5. Review the uptime check status (configured with `path = "/"`):

   **REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs"
   ```

6. Note the `run.googleapis.com/container/instance_count` metric — with `min_instance_count = 0`, this drops to zero when there are no requests, confirming scale-to-zero behavior.

   **Expected result:** Request count increases as you interact with the editor. With `min_instance_count = 0`, the instance count metric drops to 0 during idle periods and rises back to 1 when you make a request (cold start).

---

## Phase 10 — Undeploy [AUTOMATED]

**Duration:** 5–10 minutes

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**What is removed:** Cloud Run service and revisions, Cloud Filestore NFS instance, GCS bucket, Secret Manager secrets, Artifact Registry images, Cloud Monitoring uptime checks.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action | Duration |
|---|---|---|---|
| 1 — Deploy | Automated | RAD UI deploys Cloud Run, NFS, GCS, Artifact Registry | 8–18 min |
| 2 — Get Service URL | Manual | Verify HTTP 200 from service URL | 2 min |
| 3 — Explore Editor | Manual | Navigate palette, canvas, and debug panel | 5 min |
| 4 — First Flow | Manual | Wire inject → HTTP request → debug, deploy and trigger | 10 min |
| 5 — HTTP Endpoints | Manual | Create POST endpoint, test with `curl` | 10 min |
| 6 — NFS Persistence | Manual | Force new revision, verify flows survive, inspect NFS | 10 min |
| 7 — Dashboard | Manual | Install node-red-dashboard, add gauge widget | 5–10 min |
| 8 — Cloud Logging | Manual | Query Cloud Run logs and HTTP request events | 5 min |
| 9 — Cloud Monitoring | Manual | Review Cloud Run metrics, scale-to-zero behavior | 5 min |
| 10 — Undeploy | Automated | RAD UI removes all module resources | 5–10 min |
