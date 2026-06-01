---
title: "Kestra on GKE Autopilot — Lab Guide"
sidebar_label: "Kestra GKE"
---

# Kestra on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kestra_GKE)**

## Overview

**Estimated time:** 1–2 hours

Kestra is an open-source, Apache 2.0-licensed data orchestration and workflow scheduling platform. It uses YAML-based flow definitions, supports namespaces for organization, and has a rich plugin ecosystem for ETL/ELT pipelines, data pipelines, and API orchestration. This module deploys Kestra in standalone mode on GKE Autopilot — the server, worker, and scheduler run in a single container backed by Cloud SQL PostgreSQL 15 and GCS artifact storage.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (with HPA)
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets for database credentials
- Artifact Registry repository and container image mirroring via Cloud Build
- Cloud Storage bucket for Kestra artifact and internal storage
- GCS Fuse CSI Driver volume mounts
- Workload Identity binding and IAM service accounts
- Kubernetes LoadBalancer Service with session affinity (ClientIP)
- Cloud SQL Auth Proxy sidecar injection
- Optional Cloud Filestore (NFS) instance
- Database initialization jobs
- Automated daily database backups (cron schedule: `0 2 * * *`)
- Cloud Monitoring notification channels

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Access the GKE cluster with kubectl
- Verify Kestra pods are running
- Navigate the Kestra UI and explore namespaces
- Create and execute your first YAML-based flow
- Configure schedule and webhook triggers
- Manage namespaces and namespace-level variables
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

The lab uses the following tools:

- **gcloud** — Google Cloud CLI for cluster access and resource inspection
- **kubectl** — Kubernetes CLI for pod/service management
- **curl** — HTTP client for webhook trigger testing

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

### Variables

Variables are configured in the RAD UI form before deploying. Use the table below to understand what each field controls.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `tenant_deployment_id` | No | `demo` | Unique tenant identifier for resource naming |
| `application_name` | No | `kestra` | Base name for Kubernetes deployment and secrets |
| `application_version` | No | `latest` | Container image version tag (e.g., `0.17.0`) |
| `deploy_application` | No | `true` | Set false to provision infra only without deploying |
| `min_instance_count` | No | `1` | Minimum HPA pod replicas (keep at 1 — JVM cold start is slow) |
| `max_instance_count` | No | `1` | Maximum HPA pod replicas (standalone mode; set to 1 for predictable state) |
| `cpu_limit` | No | `2000m` | CPU limit per container instance |
| `memory_limit` | No | `4Gi` | Memory limit per container instance |
| `gke_cluster_name` | No | `""` | GKE cluster name (auto-discovered if empty) |
| `db_name` | No | `kestra` | PostgreSQL database name |
| `db_user` | No | `kestra` | PostgreSQL user name |
| `database_password_length` | No | `32` | Generated password length (16–64) |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

### Approximate Provisioning Duration

| Resource | Estimated Time |
|---|---|
| GKE Autopilot cluster (if new) | 8–12 min |
| Cloud SQL PostgreSQL 15 instance | 5–8 min |
| Container image build (Cloud Build) | 3–5 min |
| Kubernetes Deployment rollout | 5–10 min (JVM startup) |
| Secret Manager secrets | < 1 min |
| Cloud Storage bucket | < 1 min |
| **Total (existing cluster)** | **~15–20 min** |
| **Total (new cluster)** | **~25–35 min** |

> Note: Kestra uses a Java JVM. The startup probe allows up to ~14 minutes (`initial_delay_seconds=30` + `failure_threshold=40` × `period_seconds=20`). This is normal for a fresh database migration on first boot.

> Note: On the very first deploy of a new inline GKE cluster, `kubernetes_ready` will be `false`. A second deploy may be required to complete Kubernetes resource deployment.

### Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | `http://<external-ip>:8080` |
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
  -o custom-columns=":metadata.name" | grep "^appkestra" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~kestra" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Verify GKE Deployment [MANUAL]

**Objective:** Connect to the GKE cluster and verify the Kestra pod is running.

1. Retrieve cluster credentials:

   ```bash
   gcloud container clusters get-credentials ${CLUSTER} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **Expected result:** `kubeconfig` entry created for the cluster.

   > **gcloud equivalent:**
   > ```bash
   > gcloud container clusters list --project ${PROJECT}
   > ```

2. Verify pods are running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:** Pod in `Running` status, e.g.:
   ```
   NAME                  READY   STATUS    RESTARTS   AGE
   kestra-<hash>         2/2     Running   0          8m
   ```

   > The `2/2` indicates the Kestra container plus the Cloud SQL Auth Proxy sidecar.

3. Check the service and external IP:

   ```bash
   kubectl get svc -n ${NAMESPACE}
   ```

   **Expected result:** A `LoadBalancer` service with an `EXTERNAL-IP` assigned and port `8080` exposed.

   > **REST API equivalent:**
   > ```
   > GET https://container.googleapis.com/v1/projects/{project}/locations/{region}/clusters/{cluster}
   > ```

4. Verify the Kestra health endpoint is responding:

   ```bash
   curl -s "${EXTERNAL_IP}:8080/health"
   ```

   **Expected result:** `{"status":"UP"}` or similar JSON health response.

---

## Phase 3 — Explore the Kestra UI [MANUAL]

**Objective:** Navigate the Kestra interface and understand its core concepts.

1. Open the Kestra UI in a browser:

   Navigate to `http://${EXTERNAL_IP}:8080`.

   **Expected result:** The Kestra dashboard loads showing the main navigation.

2. Explore the main navigation tabs:
   - **Flows** — List and manage YAML flow definitions
   - **Executions** — View execution history, status, and logs per run
   - **Logs** — Aggregated execution and system logs
   - **Namespaces** — Organize flows into logical groups
   - **Audit Log** — Full audit trail of all user and system actions

3. Notice the YAML-based nature of Kestra flows. Unlike GUI-only tools, every flow in Kestra is a plain YAML document that can be version-controlled.

4. Check the **Plugins** section (if visible) to see available plugin categories:
   - Core plugins (Log, HTTP, Script)
   - Data plugins (BigQuery, GCS, PostgreSQL)
   - Cloud plugins (GCP, AWS, Azure)

---

## Phase 4 — Create Your First Flow [MANUAL]

**Objective:** Write and execute a simple YAML flow using the Kestra flow editor.

1. Navigate to **Flows** in the left navigation and click **Create**.

2. In the YAML editor, replace the default content with the following flow definition:

   ```yaml
   id: hello-world
   namespace: company.team
   tasks:
     - id: hello
       type: io.kestra.plugin.core.log.Log
       message: "Hello from Kestra on GCP!"
   ```

   Click **Save**.

   **Expected result:** The flow `hello-world` appears in the `company.team` namespace.

3. Click **Execute** (the play button) to run the flow.

   **Expected result:** A new execution is created and the status transitions from `CREATED` → `RUNNING` → `SUCCESS`.

4. Click on the execution to view the **Execution Graph** — a visual representation of the task topology.

5. Click on the `hello` task in the graph to view its **Logs** tab.

   **Expected result:** The log entry `Hello from Kestra on GCP!` appears in the task output.

   > **gcloud equivalent (check pod logs):**
   > ```bash
   > kubectl logs -n ${NAMESPACE} \
   >   deployment/kestra --tail=50
   > ```

   > **REST API equivalent:**
   > ```
   > POST https://<kestra-host>:8080/api/v1/executions/hello-world
   > {
   >   "namespace": "company.team"
   > }
   > ```

---

## Phase 5 — Triggers and Scheduling [MANUAL]

**Objective:** Add a Schedule trigger and a Webhook trigger to the flow, and test them.

1. Navigate to your `hello-world` flow and click **Edit**.

2. Add a Schedule trigger that runs every 5 minutes:

   ```yaml
   id: hello-world
   namespace: company.team
   tasks:
     - id: hello
       type: io.kestra.plugin.core.log.Log
       message: "Hello from Kestra on GCP!"
   triggers:
     - id: schedule
       type: io.kestra.plugin.core.trigger.Schedule
       cron: "*/5 * * * *"
     - id: webhook
       type: io.kestra.plugin.core.trigger.Webhook
       key: my-secret-key
   ```

   Click **Save**.

   **Expected result:** The flow now shows two triggers in the flow definition.

3. Retrieve the webhook trigger URL. In the Kestra UI, click on the flow then navigate to the **Triggers** tab. The webhook URL will be shown in the form:

   ```
   http://${EXTERNAL_IP}:8080/api/v1/executions/webhook/company.team/hello-world/my-secret-key
   ```

4. Test the webhook trigger with curl:

   ```bash
   curl -X POST \
     "http://${EXTERNAL_IP}:8080/api/v1/executions/webhook/company.team/hello-world/my-secret-key" \
     -H "Content-Type: application/json" \
     -d '{"triggered_by": "lab-test"}'
   ```

   **Expected result:** JSON response with an `executionId` field indicating the triggered execution.

5. Navigate to **Executions** in the Kestra UI.

   **Expected result:** A new execution triggered by the webhook appears in the list with `TRIGGER_SOURCE: WEBHOOK`.

6. Wait 5 minutes and verify that the schedule trigger fires automatically.

   **Expected result:** A new execution appears with `TRIGGER_SOURCE: SCHEDULE`.

   > **REST API equivalent (list executions):**
   > ```
   > GET https://<kestra-host>:8080/api/v1/executions?namespace=company.team&flowId=hello-world
   > ```

---

## Phase 6 — Namespace Management [MANUAL]

**Objective:** Create a new namespace, organize flows within it, and explore namespace-level settings.

1. Navigate to **Namespaces** in the left navigation.

2. Click **Create Namespace** and enter a new namespace name, e.g., `lab.experiments`.

   **Expected result:** The namespace `lab.experiments` appears in the namespace list.

3. Create a new flow in the new namespace by navigating to **Flows > Create** and setting:

   ```yaml
   id: namespace-test
   namespace: lab.experiments
   tasks:
     - id: log
       type: io.kestra.plugin.core.log.Log
       message: "Running in lab.experiments namespace"
   ```

   Click **Save**.

4. In the **Namespaces** view, click on `lab.experiments` and explore:
   - **Variables** — Namespace-level key-value pairs shared across all flows in the namespace
   - **Secrets** — Namespace-scoped secrets (backed by Secret Manager in this deployment)
   - **Permissions** — Access control for the namespace

5. Add a namespace variable:
   - Click **Variables > Add Variable**
   - Key: `environment`, Value: `lab`

   **Expected result:** The variable is saved and can be referenced in flows as `{{ namespace.environment }}`.

6. Verify namespace-level permissions — note that namespaces provide organizational isolation, allowing different teams to manage their own flows without interfering with others.

   > **REST API equivalent (list namespaces):**
   > ```
   > GET https://<kestra-host>:8080/api/v1/namespaces
   > ```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

**Objective:** Find Kestra execution and system logs in Cloud Logging.

1. Open Cloud Logging in the GCP console:
   `https://console.cloud.google.com/logs/query?project=${PROJECT}`

2. Use the following query to filter Kestra container logs:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="kestra"
   ```

   **Expected result:** Application logs showing JVM startup, flow execution events, and scheduler ticks.

3. Filter for execution-related log entries:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="kestra"
   jsonPayload.flow_id="hello-world"
   ```

4. Filter for errors:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   severity>=ERROR
   ```

5. From the command line:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --format=json | jq '.[].jsonPayload // .[].textPayload'
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

**Objective:** Review pod-level and execution metrics in Cloud Monitoring.

1. Open Cloud Monitoring in the GCP console:
   `https://console.cloud.google.com/monitoring?project=${PROJECT}`

2. Navigate to **Metrics Explorer** and explore the following metrics:
   - `kubernetes.io/container/cpu/request_utilization` — CPU usage vs request (JVM typically holds 20–60%)
   - `kubernetes.io/container/memory/request_utilization` — Memory usage vs request (Kestra JVM heap)
   - `kubernetes.io/pod/network/received_bytes_count` — Inbound network traffic

3. Filter by:
   - `resource.namespace_name = ${NAMESPACE}`
   - `resource.pod_name =~ kestra.*`

   **Expected result:** Charts showing JVM CPU and memory consumption for the Kestra pod.

4. Check HPA status:

   ```bash
   kubectl describe hpa -n ${NAMESPACE}
   ```

   **Expected result:** HPA status showing current replica count = 1 and scaling thresholds.

5. Check queue depth — with Kestra standalone mode, the execution queue depth can be approximated by counting `RUNNING` executions in the Kestra UI **Executions** tab.

   > **gcloud equivalent:**
   > ```bash
   > gcloud monitoring time-series list \
   >   --project=${PROJECT} \
   >   --filter='metric.type="kubernetes.io/container/memory/limit_utilization"'
   > ```

   > **REST API equivalent:**
   > ```
   > GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries
   >   ?filter=metric.type="kubernetes.io/container/cpu/request_utilization"
   > ```

---

## Phase 9 — Undeploy [AUTOMATED]

When you are done with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

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
| Create Cloud Storage bucket | 1 | Yes |
| Configure HPA and pod disruption budget | 1 | Yes |
| Set up Workload Identity and IAM | 1 | Yes |
| Verify kubectl access and pod status | 2 | No |
| Explore Kestra UI tabs | 3 | No |
| Create and execute hello-world flow | 4 | No |
| Add schedule and webhook triggers | 5 | No |
| Test webhook trigger with curl | 5 | No |
| Create and configure a new namespace | 6 | No |
| Add namespace-level variables | 6 | No |
| Explore logs in Cloud Logging | 7 | No |
| Review metrics in Cloud Monitoring | 8 | No |
| Undeploy all resources | 9 | Yes |
