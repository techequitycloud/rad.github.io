# Activepieces on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Activepieces_GKE)**

## Overview

**Estimated time:** 1–2 hours

Activepieces is an open-source, Apache 2.0-licensed workflow automation platform (an alternative to Zapier). It provides a visual flow builder, 100+ integration pieces, webhook triggers, and runs workflows automatically. This module deploys Activepieces on GKE Autopilot with a Cloud SQL PostgreSQL 15 backend, GCS Fuse storage, and optional Redis queue mode.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (with HPA)
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets for database credentials and encryption keys
- Artifact Registry repository and container image mirroring via Cloud Build
- Cloud Storage bucket (GCS Fuse CSI mount)
- Workload Identity binding and IAM service accounts
- Kubernetes LoadBalancer Service with session affinity (ClientIP)
- Optional Cloud Filestore (NFS) instance
- Optional Redis configuration for queue mode
- Cloud SQL Auth Proxy sidecar injection
- Database initialization jobs
- Automated daily database backups (cron schedule: `0 2 * * *`)
- Cloud Monitoring notification channels

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Access the GKE cluster with kubectl
- Create the initial Activepieces admin account in the UI
- Build and test your first automation flow
- Explore the pieces catalog and configure integrations
- Add connections for external services
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

The lab uses the following tools:

- **gcloud** — Google Cloud CLI for cluster access and resource inspection
- **kubectl** — Kubernetes CLI for pod/service management
- **curl** — HTTP client for webhook testing

Key gcloud commands used in this lab:

```bash
gcloud container clusters get-credentials <cluster> --region <region> --project <project-id>
gcloud secrets versions access latest --secret=<secret-name> --project=<project-id>
gcloud logging read 'resource.type="k8s_container"' --project=<project-id> --limit=50
```

---

## Prerequisites

1. **Services_GCP deployed** — This module depends on `Services_GCP`. The VPC network, Cloud SQL instance, GKE Autopilot cluster, Artifact Registry, and shared service accounts must already exist in the target project.
2. **GCP project** with billing enabled.
3. **Access to the RAD UI** with permission to deploy modules in the target GCP project.
4. **gcloud CLI** authenticated (`gcloud auth application-default login`).
5. **kubectl** installed.
6. **Permissions** — Owner or equivalent role on the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Configure Variables

Variables are configured in the RAD UI form before deploying. Use the table below to understand what each field controls.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier for resource naming |
| `application_name` | No | `activepieces` | Base name for Kubernetes deployment and secrets |
| `application_version` | No | `latest` | Container image version tag |
| `deploy_application` | No | `true` | Set false to provision infra only without deploying |
| `min_instance_count` | No | `1` | Minimum HPA pod replicas |
| `max_instance_count` | No | `3` | Maximum HPA pod replicas |
| `cpu_limit` | No | `2000m` | CPU limit per container instance |
| `memory_limit` | No | `2Gi` | Memory limit per container instance |
| `enable_redis` | No | `false` | Enable Redis as the workflow queue backend |
| `redis_host` | No | `""` | Redis hostname or IP (leave blank for NFS server IP) |
| `redis_port` | No | `6379` | Redis TCP port |
| `gke_cluster_name` | No | `""` | GKE cluster name (auto-discovered if empty) |
| `db_name` | No | `activepieces_db` | PostgreSQL database name |
| `db_user` | No | `ap_user` | PostgreSQL user name |
| `database_password_length` | No | `32` | Generated password length (16–64) |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

### Approximate Provisioning Duration

| Resource | Estimated Time |
|---|---|
| GKE Autopilot cluster (if new) | 8–12 min |
| Cloud SQL PostgreSQL 15 instance | 5–8 min |
| Container image build (Cloud Build) | 3–5 min |
| Kubernetes Deployment rollout | 3–5 min |
| Secret Manager secrets | < 1 min |
| Cloud Storage bucket | < 1 min |
| **Total (existing cluster)** | **~10–15 min** |
| **Total (new cluster)** | **~20–30 min** |

> Note: On the very first deploy of a new inline GKE cluster, `kubernetes_ready` will be `false`. The CI/CD pipeline (or a second deploy) is required to complete Kubernetes resource deployment.

### Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | External URL for the Activepieces service |
| `service_external_ip` | LoadBalancer IP |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |

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
  -o custom-columns=":metadata.name" | grep "^appactivepieces" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~activepieces" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Verify GKE Deployment [MANUAL]

**Objective:** Connect to the GKE cluster and verify all pods are running.

1. Verify kubectl is configured (credentials retrieved in Phase 1 above).

   **Expected result:** `kubeconfig` entry created for the cluster.

   > **gcloud equivalent:**
   > ```bash
   > gcloud container clusters list --project ${PROJECT}
   > ```

2. Verify pods are running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:** One or more pods in `Running` status, e.g.:
   ```
   NAME                            READY   STATUS    RESTARTS   AGE
   activepieces-<hash>             2/2     Running   0          5m
   ```

   > The `2/2` indicates the main Activepieces container plus the Cloud SQL Auth Proxy sidecar.

3. Check the service and external IP:

   ```bash
   kubectl get svc -n ${NAMESPACE}
   ```

   **Expected result:** A `LoadBalancer` service with an `EXTERNAL-IP` assigned.

   > **REST API equivalent:**
   > ```
   > GET https://container.googleapis.com/v1/projects/{project}/locations/{region}/clusters/{cluster}
   > ```

4. Confirm the service URL is accessible:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}"
   ```

   **Expected result:** `200` or `302` (redirect to login page).

---

## Phase 3 — Set Up Activepieces [MANUAL]

**Objective:** Complete the initial admin account setup in the Activepieces UI.

1. Open the Activepieces UI in a browser:

   Navigate to `http://${EXTERNAL_IP}` (port 80).

   **Expected result:** The Activepieces onboarding page or sign-in screen.

2. On first visit, Activepieces prompts you to create an admin account. Fill in:
   - Full name
   - Email address
   - Password

   Click **Get Started**.

   **Expected result:** You are redirected to the Activepieces dashboard.

3. Alternatively, if credentials were pre-configured via Secret Manager, retrieve them:

   ```bash
   # List relevant secrets
   gcloud secrets list --project=${PROJECT} --filter="name:activepieces"

   # Access a specific secret
   gcloud secrets versions access latest \
     --secret=${DB_SECRET} \
     --project=${PROJECT}
   ```

   > **REST API equivalent:**
   > ```
   > GET https://secretmanager.googleapis.com/v1/projects/{project}/secrets/{secret}/versions/latest:access
   > ```

4. Explore the dashboard: note the **Flows**, **Connections**, and **Runs** sections in the left navigation.

---

## Phase 4 — Build Your First Flow [MANUAL]

**Objective:** Create a complete automation flow with a Webhook trigger and an HTTP Request action.

1. Click **New Flow** (or the `+` button) in the Flows section.

2. Give the flow a name, e.g., `My First Flow`.

3. Click **Add Trigger** and select **Webhook** from the pieces list.
   - Copy the webhook URL shown in the trigger configuration panel.

   **Expected result:** A webhook URL in the form `http://<external-ip>/api/v1/webhooks/<id>`.

4. Add an action: click the `+` after the trigger, search for **HTTP Request**, and configure it:
   - **Method:** GET
   - **URL:** `https://httpbin.org/get`

   **Expected result:** The HTTP Request piece appears in the flow canvas.

5. Add a **Branch / Filter** piece after the HTTP Request to demonstrate conditional logic:
   - Configure a condition, e.g., check that the response status is `200`.

6. Enable the flow by toggling the **Published** switch at the top of the editor.

   **Expected result:** The toggle turns green and the flow status changes to `Enabled`.

7. Test the flow by sending a POST request to the webhook URL:

   ```bash
   WEBHOOK_URL="<paste-webhook-url-here>"
   curl -X POST "${WEBHOOK_URL}" \
     -H "Content-Type: application/json" \
     -d '{"test": "data", "source": "lab"}'
   ```

   **Expected result:** HTTP `200` response from Activepieces.

8. In the Activepieces UI, navigate to **Runs** to view the execution results. Click the run to see the step-by-step trace.

   > **gcloud equivalent (check logs for errors):**
   > ```bash
   > kubectl logs -n ${NAMESPACE} \
   >   deployment/activepieces --tail=50
   > ```

---

## Phase 5 — Explore the Pieces Catalog [MANUAL]

**Objective:** Browse available integration pieces and understand how they extend Activepieces.

1. In the left navigation, click **Connections** then **Pieces** (or find the pieces catalog from within the flow editor).

2. Browse the available pieces (100+). Filter by category:
   - **Communication:** Slack, Gmail, Discord
   - **Data:** Google Sheets, Airtable, PostgreSQL
   - **Utilities:** HTTP Request, Delay, Branch

3. Search for a GCP-specific piece if available (e.g., search `Google`).

4. Click on any piece to view its configuration options, required connections, and available triggers/actions.

   **Expected result:** Each piece shows a description, version, and the list of actions/triggers it supports.

5. Note that pieces can be used as both triggers (starting a flow) and actions (steps within a flow).

---

## Phase 6 — Connection Management [MANUAL]

**Objective:** Add an authenticated connection and understand how connections are shared across flows.

1. Navigate to **Connections** in the left navigation.

2. Click **Add Connection** and choose a piece to connect, for example:
   - **HTTP Basic Auth** — choose the HTTP piece and configure with a test endpoint URL, username, and password.
   - Or choose **API Key** authentication with any piece that supports it.

3. Fill in the required credentials and click **Save**.

   **Expected result:** The connection appears in the Connections list with a green status indicator.

4. Return to your flow from Phase 4 and update the HTTP Request piece to use the saved connection.

   **Expected result:** The flow can authenticate using the saved credentials without exposing them in the flow definition.

5. Note that connections are project-wide and can be shared across multiple flows — credentials are stored encrypted in Secret Manager.

   > **Verify secrets in Secret Manager:**
   > ```bash
   > gcloud secrets list --project=${PROJECT} --filter="name:activepieces"
   > ```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

**Objective:** Find Activepieces application logs in Cloud Logging.

1. Open Cloud Logging in the GCP console:
   `https://console.cloud.google.com/logs/query?project=<project-id>`

2. Use the following query to filter Activepieces container logs:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="activepieces"
   ```

   **Expected result:** Application logs showing startup messages, webhook receipts, and flow execution events.

3. Filter for errors:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   severity>=ERROR
   ```

4. From the command line:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --format=json | jq '.[].textPayload'
   ```

   > **REST API equivalent:**
   > ```
   > POST https://logging.googleapis.com/v2/entries:list
   > {
   >   "resourceNames": ["projects/<project-id>"],
   >   "filter": "resource.type=\"k8s_container\" resource.labels.namespace_name=\"<namespace>\"",
   >   "orderBy": "timestamp desc",
   >   "pageSize": 50
   > }
   > ```

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

**Objective:** Review pod-level metrics in Cloud Monitoring.

1. Open Cloud Monitoring in the GCP console:
   `https://console.cloud.google.com/monitoring?project=<project-id>`

2. Navigate to **Metrics Explorer** and explore the following metrics:
   - `kubernetes.io/container/cpu/request_utilization` — CPU usage vs request
   - `kubernetes.io/container/memory/request_utilization` — Memory usage vs request
   - `kubernetes.io/pod/network/received_bytes_count` — Network ingress

3. Filter by:
   - `resource.namespace_name = ${NAMESPACE}`
   - `resource.pod_name =~ activepieces.*`

   **Expected result:** Charts showing CPU and memory consumption for the Activepieces pods.

4. Check HPA scaling activity:

   ```bash
   kubectl describe hpa -n ${NAMESPACE}
   ```

   **Expected result:** HPA status showing current replica count and scaling thresholds.

   > **gcloud equivalent:**
   > ```bash
   > gcloud monitoring time-series list \
   >   --project=${PROJECT} \
   >   --filter='metric.type="kubernetes.io/container/cpu/core_usage_time"'
   > ```

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** All Kubernetes workloads, Cloud SQL instance, Secret Manager secrets, Cloud Storage buckets, and supporting IAM resources are deleted.

> **Note:** If `enable_purge = false`, certain resources such as the database and storage buckets will be retained after undeployment to prevent accidental data loss.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Provision GKE namespace and Deployment | 1 | Yes |
| Create Cloud SQL PostgreSQL 15 instance | 1 | Yes |
| Mirror container image via Cloud Build | 1 | Yes |
| Configure Secret Manager secrets | 1 | Yes |
| Create Cloud Storage bucket (GCS Fuse) | 1 | Yes |
| Configure HPA and pod disruption budget | 1 | Yes |
| Set up Workload Identity and IAM | 1 | Yes |
| Verify kubectl access and pod status | 2 | No |
| Create admin account in UI | 3 | No |
| Build first flow with Webhook + HTTP | 4 | No |
| Test webhook with curl | 4 | No |
| Browse pieces catalog | 5 | No |
| Add a connection (API key / Basic Auth) | 6 | No |
| Explore logs in Cloud Logging | 7 | No |
| Review metrics in Cloud Monitoring | 8 | No |
| Undeploy all resources | 9 | Yes |
