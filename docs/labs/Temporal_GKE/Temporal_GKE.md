---
title: "Temporal on GKE — Lab Guide"
sidebar_label: "Temporal GKE"
---

# Temporal on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Temporal_GKE)**

## Overview

**Estimated time:** 2–3 hours

This lab deploys Temporal, a durable workflow orchestration platform, as a self-hosted service on GKE Autopilot. Temporal provides workflow execution with automatic retries, timers, signals, and queries — backed by PostgreSQL for durable workflow history storage.

### What the Module Automates

- Creates a PostgreSQL database user and two databases (primary persistence and visibility) inside the Services_GCP Cloud SQL instance
- Stores the database password in Secret Manager
- Creates a Kubernetes namespace for Temporal
- Deploys the `temporalio/auto-setup` all-in-one container running all four Temporal services (Frontend, History, Matching, Worker) in a single pod
- Runs a `temporal-db-init` Kubernetes Job to create the PostgreSQL role with `CREATEDB` privilege before the server pod starts
- Deploys the Temporal Web UI (`ubuntu/temporal-ui`) as a separate pod with an external LoadBalancer on port 8081
- Configures Workload Identity for the Temporal service account
- Enables Cloud Logging and Cloud Monitoring for all pods

### What You Do Manually

- Note the deployment outputs (namespace, frontend address, etc.) from the RAD UI deployment panel
- Obtain GKE cluster credentials with `gcloud`
- Verify all Temporal pods are running
- Access the Web UI via its external LoadBalancer IP on port 8081
- Execute a sample workflow using the Temporal CLI inside the main Temporal pod
- Manage Temporal namespaces using operator commands
- Explore workflow event history
- Review structured logs in Cloud Logging
- Inspect workflow metrics in Cloud Monitoring

---

## CLI and REST API Overview

Most interactions with Temporal use `kubectl` to reach the cluster and the `temporal` CLI (available inside the main Temporal pod). GCP-level management uses `gcloud`.

```bash
# Kubernetes
kubectl get pods -n <namespace>
kubectl exec -it <pod-name> -n <namespace> -- bash
kubectl get svc -n <namespace>

# Temporal CLI (inside main Temporal pod)
temporal workflow list --namespace default
temporal operator namespace list

# GCP
gcloud container clusters get-credentials <cluster> --region <region> --project <project>
gcloud logging read 'resource.type="k8s_container"' --project <project>
```

---

## Prerequisites

- Services_GCP deployed in the same GCP project (provides the VPC, GKE Autopilot cluster, and Cloud SQL PostgreSQL instance)
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- `kubectl` installed
- GCP project ID
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Temporal_GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Suffix appended to resource names |
| `region` | No | `us-central1` | GCP region for deployment |
| `tenant_deployment_id` | No | `demo` | Tenant identifier used in resource naming |
| `application_name` | No | `temporal` | Base name for GKE resources |
| `application_version` | No | `1.25.0` | Temporal server image tag (maps to `temporalio/auto-setup`) |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `1` | Maximum pod replicas |
| `cpu_limit` | No | `2000m` | CPU limit per pod |
| `memory_limit` | No | `4Gi` | Memory limit per pod |
| `gke_cluster_name` | No | `""` | Target GKE cluster name (auto-discovered when empty) |
| `num_history_shards` | No | `4` | History shard count — **cannot be changed after deployment**. Use `512` or higher for production |
| `service_type` | No | `ClusterIP` | Kubernetes Service type for the gRPC frontend. Use `LoadBalancer` only if SDK workers connect from outside the cluster |
| `enable_elasticsearch` | No | `false` | Enable Elasticsearch for advanced workflow visibility and full-text search |
| `elasticsearch_url` | No | `""` | Elasticsearch URL (required when `enable_elasticsearch = true`) |
| `elasticsearch_version` | No | `v7` | Elasticsearch major version (`v7` or `v8`) |
| `resource_labels` | No | `{}` | Labels applied to all resources |

> **Note on history shards:** `num_history_shards` must be a power of two and **cannot be changed** after the first deployment. The default value of `4` is suitable for development and demo use. Set to `512` or higher for production workloads with many concurrent workflows.

### Deploy

Click **Deploy** in the RAD UI.

### Estimated Deployment Duration

| Phase | Duration |
|---|---|
| Cloud SQL database user and secrets | 1–2 min |
| Kubernetes namespace creation | < 1 min |
| Container image mirroring (Cloud Build) | 3–5 min |
| `temporal-db-init` job (create PostgreSQL role) | 1–2 min |
| Temporal server pod startup (schema init on first deploy) | 3–8 min |
| Temporal Web UI pod startup | 1–2 min |
| **Total** | **9–20 min** |

> **Note:** On the first deployment, `temporalio/auto-setup` runs full schema initialisation for both the persistence and visibility databases. This can take several minutes depending on the Cloud SQL tier. The startup probe allows up to 15 minutes (`initial_delay_seconds=30` + `failure_threshold=90` × `period_seconds=10`).

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `temporal_frontend_address` | gRPC address for SDK/worker connections (cluster-internal when `service_type = ClusterIP`) |
| `namespace` | Kubernetes namespace where Temporal is deployed |
| `temporal_db_user` | PostgreSQL user for Temporal databases |
| `temporal_db_name` | Name of the primary persistence database |
| `temporal_visibility_db_name` | Name of the visibility database (`<temporal_db_name>_vis`) |
| `temporal_db_password_secret_id` | Secret Manager secret ID holding the database password |
| `deployment_id` | Generated deployment suffix used in all resource names |
| `kubernetes_ready` | Whether all Kubernetes resources were fully deployed |

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

# Discover the namespace (pattern: apptemporal<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^apptemporal" | head -1)

echo "Namespace: ${NAMESPACE}"
```

---

## Phase 2 — Configure kubectl Access and Verify Pods [MANUAL]

**Objective:** Connect to the GKE cluster and verify all Temporal pods are running.

### Steps

1. Verify kubectl is configured (credentials retrieved in Phase 1):

   ```bash
   kubectl get namespace ${NAMESPACE}
   ```

   **Expected result:** The namespace appears with status `Active`.

2. Verify pods are running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:** Two pods in `Running` status:

   ```
   NAME                            READY   STATUS    RESTARTS   AGE
   temporal-<hash>                 2/2     Running   0          8m
   temporal-ui-<hash>              1/1     Running   0          8m
   ```

   > The `2/2` for the main Temporal pod indicates the `temporalio/auto-setup` container (running all four services: Frontend, History, Matching, Worker) plus the Cloud SQL Auth Proxy sidecar.

3. Check the services:

   ```bash
   kubectl get svc -n ${NAMESPACE}
   ```

   **Expected result:** At minimum two services — the Temporal gRPC service (ClusterIP on port 7233 by default) and the Web UI service (LoadBalancer on port 8081).

4. Retrieve the Web UI external IP:

   ```bash
   export WEB_UI_IP=$(kubectl get svc -n ${NAMESPACE} \
     -o jsonpath='{.items[?(@.spec.ports[0].port==8081)].status.loadBalancer.ingress[0].ip}')
   echo "Temporal Web UI: http://${WEB_UI_IP}:8081"
   ```

   **Expected result:** An external IP address.

5. View logs from the main Temporal pod:

   ```bash
   TEMPORAL_POD=$(kubectl get pods -n ${NAMESPACE} --no-headers | grep -v temporal-ui | head -1 | awk '{print $1}')
   kubectl logs ${TEMPORAL_POD} -c temporal -n ${NAMESPACE} --tail=50
   ```

   **Expected result:** Structured JSON log entries showing Temporal service startup, schema initialisation, and service readiness messages.

   > **REST API equivalent:**
   > ```
   > GET https://container.googleapis.com/v1/projects/{project}/locations/{region}/clusters/{cluster}
   > ```

---

## Phase 3 — Explore the Temporal Web UI [MANUAL]

**Objective:** Access the Temporal Web UI and explore namespaces and workflows.

The Temporal Web UI is deployed as a separate pod and exposed via a LoadBalancer service on port **8081**.

### Steps

1. Open the Web UI in a browser:

   ```
   http://<WEB_UI_IP>:8081
   ```

   Use the `WEB_UI_IP` discovered in Phase 2.

   **Expected result:** The Temporal Web UI loads showing the namespace list.

2. Explore the **Namespaces** section. You will see the `default` namespace created during schema initialisation.

3. Click into the `default` namespace and review the **Workflows** tab. It will be empty until you execute a workflow in Phase 4.

4. Explore the **Task Queues** section to see available queues.

5. Explore **Search Attributes** — these define the metadata fields available for advanced workflow filtering.

---

## Phase 4 — Execute a Sample Workflow [MANUAL]

**Objective:** Use the Temporal CLI inside the main Temporal pod to submit a workflow and observe it in the Web UI.

### Steps

1. Discover the main Temporal pod name and open a shell:

   ```bash
   TEMPORAL_POD=$(kubectl get pods -n ${NAMESPACE} --no-headers | grep -v temporal-ui | head -1 | awk '{print $1}')
   kubectl exec -it ${TEMPORAL_POD} -c temporal -n ${NAMESPACE} -- bash
   ```

2. Verify the Temporal CLI can reach the Frontend service:

   ```bash
   temporal operator cluster health
   ```

   **Expected result:** Health check returns `SERVING`.

3. Start a sample workflow:

   ```bash
   temporal workflow start \
     --task-queue my-task-queue \
     --type MyWorkflow \
     --namespace default \
     --workflow-id my-first-workflow
   ```

   **Expected result:** Output shows the workflow ID and run ID:
   ```
   Running execution:
     WorkflowId  my-first-workflow
     RunId       <uuid>
     Type        MyWorkflow
     Namespace   default
     TaskQueue   my-task-queue
   ```

   > **Note:** Without an application worker connected to `my-task-queue`, the workflow will remain in `Running` state — it is waiting for a worker to pick up the task. This is expected and demonstrates Temporal's durability: the workflow state is persisted in PostgreSQL regardless of whether a worker is available.

4. List running workflows:

   ```bash
   temporal workflow list --namespace default
   ```

   **Expected result:** `my-first-workflow` appears with status `Running`.

5. Open the Web UI at `http://<WEB_UI_IP>:8081` and navigate to the `default` namespace. The workflow appears in the list.

6. Click the workflow to view its **Event History** — every state transition (`WorkflowExecutionStarted`, `WorkflowTaskScheduled`, etc.) is recorded durably in PostgreSQL.

7. Describe the workflow from the CLI:

   ```bash
   temporal workflow describe \
     --workflow-id my-first-workflow \
     --namespace default
   ```

   **Expected result:** Workflow metadata including status, task queue, type, and start time.

8. Exit the pod:

   ```bash
   exit
   ```

---

## Phase 5 — Namespace Management [MANUAL]

**Objective:** Create and manage Temporal namespaces to understand isolation between applications.

Temporal namespaces provide isolation between different applications or environments sharing the same cluster.

### Steps

1. Open a shell inside the main Temporal pod:

   ```bash
   TEMPORAL_POD=$(kubectl get pods -n ${NAMESPACE} --no-headers | grep -v temporal-ui | head -1 | awk '{print $1}')
   kubectl exec -it ${TEMPORAL_POD} -c temporal -n ${NAMESPACE} -- bash
   ```

2. List all Temporal namespaces:

   ```bash
   temporal operator namespace list
   ```

   **Expected result:** The `default` namespace and the `temporal-system` namespace are listed.

3. Create a new namespace:

   ```bash
   temporal operator namespace create \
     --namespace my-namespace \
     --retention 7d \
     --description "Lab namespace for testing"
   ```

   **Expected result:** `Namespace my-namespace successfully registered.`

4. Describe the new namespace to see its configuration:

   ```bash
   temporal operator namespace describe --namespace my-namespace
   ```

   **Expected result:** Namespace details including retention period (7 days), replication config, and registered cluster name.

5. Update the namespace retention period:

   ```bash
   temporal operator namespace update \
     --namespace my-namespace \
     --retention 14d
   ```

6. Exit the pod:

   ```bash
   exit
   ```

---

## Phase 6 — Explore Workflow History [MANUAL]

**Objective:** Inspect the immutable event history that underpins Temporal's durability guarantees.

Temporal persists every workflow state transition as an immutable event in PostgreSQL. This is the foundation of Temporal's durability — if a worker crashes mid-workflow, Temporal can replay the history to restore workflow state on any available worker.

### Steps

1. Open a shell inside the main Temporal pod:

   ```bash
   TEMPORAL_POD=$(kubectl get pods -n ${NAMESPACE} --no-headers | grep -v temporal-ui | head -1 | awk '{print $1}')
   kubectl exec -it ${TEMPORAL_POD} -c temporal -n ${NAMESPACE} -- bash
   ```

2. List workflows by status:

   ```bash
   # List running workflows
   temporal workflow list --namespace default --query 'ExecutionStatus="Running"'

   # List all workflows (any status)
   temporal workflow list --namespace default --archived
   ```

3. View the full event history for the workflow started in Phase 4:

   ```bash
   temporal workflow show \
     --workflow-id my-first-workflow \
     --namespace default
   ```

   **Expected result:** A table of all events with sequence numbers, event types (e.g., `WorkflowExecutionStarted`, `WorkflowTaskScheduled`), timestamps, and attributes.

4. Send a signal to the running workflow:

   ```bash
   temporal workflow signal \
     --workflow-id my-first-workflow \
     --namespace default \
     --name my-signal \
     --input '"signal-data"'
   ```

5. Exit the pod:

   ```bash
   exit
   ```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

**Objective:** Find Temporal application logs in Cloud Logging.

The `temporalio/auto-setup` container emits structured JSON logs. All four Temporal services (Frontend, History, Matching, Worker) log to stdout and are captured by the GKE node logging agent.

### Steps

1. In the Google Cloud Console, navigate to **Logging > Log Explorer**.

2. Filter logs to the Temporal namespace:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="temporal"
   ```

3. Filter for errors:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   severity>=ERROR
   ```

4. Using the `gcloud` CLI:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --format=json | jq '.[].jsonPayload'
   ```

   > **REST API equivalent:**
   > ```
   > POST https://logging.googleapis.com/v2/entries:list
   > {
   >   "resourceNames": ["projects/&lt;project-id>"],
   >   "filter": "resource.type=\"k8s_container\" resource.labels.namespace_name=\"&lt;namespace>\"",
   >   "orderBy": "timestamp desc",
   >   "pageSize": 50
   > }
   > ```

5. Look for log entries containing `"level":"error"` to identify any issues with database connections or schema initialisation.

6. Filter for workflow execution events from the Frontend service:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   jsonPayload.msg=~"workflow"
   ```

   **Expected result:** Log entries showing incoming gRPC calls and workflow state changes.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

**Objective:** Review pod-level metrics in Cloud Monitoring.

### Steps

1. Open Cloud Monitoring in the GCP console:
   `https://console.cloud.google.com/monitoring?project=<project-id>`

2. Navigate to **Metrics Explorer** and explore the following metrics:
   - `kubernetes.io/container/cpu/request_utilization` — CPU usage vs request
   - `kubernetes.io/container/memory/request_utilization` — Memory usage vs request
   - `kubernetes.io/pod/network/received_bytes_count` — Network ingress

3. Filter by:
   - `resource.namespace_name = ${NAMESPACE}`
   - `resource.pod_name =~ temporal.*`

   **Expected result:** Charts showing CPU and memory consumption for the Temporal pods.

4. Check HPA scaling activity:

   ```bash
   kubectl describe hpa -n ${NAMESPACE}
   ```

5. View pod resource usage:

   ```bash
   kubectl top pods -n ${NAMESPACE}
   ```

   **Expected result:** CPU and memory usage for the Temporal server pod and Web UI pod.

   > **gcloud equivalent:**
   > ```bash
   > gcloud monitoring time-series list \
   >   --project=${PROJECT} \
   >   --filter='metric.type="kubernetes.io/container/cpu/core_usage_time"'
   > ```

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module: the Kubernetes namespace and workloads, Cloud SQL databases and user, and the Secret Manager secret.

**Expected result:** All Kubernetes workloads, Cloud SQL databases, Secret Manager secrets, and supporting IAM resources are deleted.

> **Note:** If `enable_purge = false`, certain resources such as the database will be retained after undeployment to prevent accidental data loss.

> The Cloud SQL PostgreSQL instance itself is managed by Services_GCP and is not affected. Resources provisioned by the `Services_GCP` module must be undeployed via their own RAD UI deployment entry.

**Expected duration:** 3–6 minutes.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Provision GKE namespace and Temporal deployment | 1 | Yes |
| Create Cloud SQL databases and Secret Manager secret | 1 | Yes |
| Run `temporal-db-init` job (PostgreSQL role creation) | 1 | Yes |
| Run schema initialisation (`temporalio/auto-setup`) | 1 | Yes |
| Deploy Temporal Web UI (`ubuntu/temporal-ui`) | 1 | Yes |
| Set up Workload Identity and IAM | 1 | Yes |
| Verify kubectl access and pod status | 2 | No |
| Access Web UI via external IP on port 8081 | 3 | No |
| Execute sample workflow via Temporal CLI | 4 | No |
| Create and configure Temporal namespaces | 5 | No |
| Inspect workflow event history | 6 | No |
| Explore logs in Cloud Logging | 7 | No |
| Review metrics in Cloud Monitoring | 8 | No |
| Undeploy all resources | 9 | Yes |
