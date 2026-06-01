# Temporal on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Temporal_GKE)**

## Overview

**Estimated time:** 2–3 hours

This lab deploys Temporal, a durable workflow orchestration platform, as a self-hosted cluster on GKE Autopilot. Temporal provides workflow execution with automatic retries, timers, signals, and queries — backed by PostgreSQL for durable workflow history storage.

### What the Module Automates

- Creates a PostgreSQL database user and two databases (`temporal` for persistence, `temporal_visibility` for advanced visibility) inside the Services GCP Cloud SQL instance
- Stores the database password in Secret Manager
- Creates a Kubernetes namespace for Temporal
- Installs the Temporal Helm chart (Frontend, History, Matching, Worker, and optionally Web UI services)
- Runs schema initialisation jobs to set up the Temporal and visibility database schemas
- Configures Workload Identity for the Temporal service account
- Enables Cloud Logging and Cloud Monitoring for all pods

### What You Do Manually

- Note the deployment outputs (namespace, frontend address, etc.) from the RAD UI deployment panel
- Obtain GKE cluster credentials with `gcloud`
- Verify all Temporal pods are running
- Port-forward to the Web UI and explore workflows and namespaces
- Execute a sample workflow using the Temporal CLI inside the admin-tools pod
- Manage Temporal namespaces using operator commands
- Explore workflow event history
- Review structured logs in Cloud Logging
- Inspect workflow metrics in Cloud Monitoring

---

## CLI and REST API Overview

Most interactions with Temporal use `kubectl` to reach the cluster and the `temporal` CLI (embedded in the `admin-tools` pod). GCP-level management uses `gcloud`.

```bash
# Kubernetes
kubectl get pods -n <namespace>
kubectl exec -it deploy/<pod> -n <namespace> -- <command>
kubectl port-forward svc/<service> <local>:<remote> -n <namespace>

# Temporal CLI (inside admin-tools pod)
temporal workflow list --namespace default
temporal operator namespace list

# GCP
gcloud container clusters get-credentials <cluster> --region <region> --project <project>
gcloud logging read 'resource.type="k8s_container"' --project <project>
```

---

## Prerequisites

- Services GCP deployed in the same GCP project (provides the VPC, GKE Autopilot cluster, and Cloud SQL PostgreSQL instance)
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- `kubectl` installed
- `helm` installed (the module uses the Helm provider internally, but having it locally is useful for debugging)
- GCP project ID and the Services GCP outputs: `postgres_instance_name` and `postgres_instance_ip`
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Temporal GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Suffix appended to resource names |
| `tenant_deployment_id` | No | `demo` | Tenant identifier used in resource naming |
| `postgres_instance_name` | Yes | — | Cloud SQL instance name from Services GCP |
| `postgres_instance_ip` | Yes | — | Private IP of Cloud SQL instance from Services GCP |
| `temporal_namespace` | No | `temporal` | Kubernetes namespace for Temporal |
| `temporal_chart_version` | No | `0.73.1` | Temporal Helm chart version |
| `temporal_server_image_tag` | No | `1.25.0` | Temporal server image tag |
| `temporal_frontend_replicas` | No | `1` | Frontend service replica count (1–10) |
| `temporal_history_replicas` | No | `1` | History service replica count (1–10) |
| `temporal_matching_replicas` | No | `1` | Matching service replica count (1–10) |
| `temporal_worker_replicas` | No | `1` | Internal Worker service replica count (1–10) |
| `enable_temporal_web_ui` | No | `true` | Deploy the Temporal Web UI |
| `temporal_web_replicas` | No | `1` | Web UI replica count (1–5) |
| `deploy_application` | No | `true` | Deploy the Helm chart and run schema init |
| `enable_elasticsearch` | No | `false` | Connect to Elasticsearch for advanced visibility |
| `elasticsearch_url` | No | `""` | Elasticsearch URL (required when `enable_elasticsearch = true`) |
| `elasticsearch_version` | No | `v7` | Elasticsearch major version (`v7` or `v8`) |
| `resource_labels` | No | `{}` | Labels applied to all resources |

### Deploy

Click **Deploy** in the RAD UI.

### Estimated Deployment Duration

| Phase | Duration |
|---|---|
| Cloud SQL databases and Secret Manager secret | 1–2 min |
| Kubernetes namespace creation | < 1 min |
| Helm chart install (all Temporal services) | 3–5 min |
| Schema initialisation jobs | 2–4 min |
| **Total** | **6–12 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `temporal_frontend_address` | gRPC address for SDK/worker connections (`temporal-frontend.<namespace>:7233`) |
| `temporal_namespace` | Kubernetes namespace where Temporal is deployed |
| `temporal_web_ui_address` | Cluster-internal Web UI address (requires port-forward for external access) |
| `temporal_db_user` | PostgreSQL user for Temporal databases |
| `temporal_db_name` | Name of the primary persistence database |
| `temporal_visibility_db_name` | Name of the visibility database |
| `temporal_db_password_secret_id` | Secret Manager secret ID holding the database password |
| `deployment_id` | Generated deployment suffix used in all resource names |

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

# Temporal uses a fixed namespace
export NAMESPACE="temporal"
```

---

## Phase 2 — Configure kubectl Access [MANUAL]

### Steps

1. Obtain GKE cluster credentials:

   ```bash
   gcloud container clusters get-credentials ${CLUSTER} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **gcloud REST equivalent:**
   ```bash
   # List clusters to find the name
   gcloud container clusters list --project ${PROJECT}
   ```

2. Verify the Temporal namespace exists:

   ```bash
   kubectl get namespace temporal
   ```

   **Expected result:** The namespace appears with status `Active`.

3. Verify all Temporal pods are running:

   ```bash
   kubectl get pods -n temporal
   ```

   **Expected result:** You should see pods for each Temporal service with status `Running`:

   ```
   NAME                                    READY   STATUS    RESTARTS   AGE
   temporaltest-admintools-xxx             1/1     Running   0          5m
   temporaltest-frontend-xxx               1/1     Running   0          5m
   temporaltest-history-xxx                1/1     Running   0          5m
   temporaltest-matching-xxx               1/1     Running   0          5m
   temporaltest-web-xxx                    1/1     Running   0          5m
   temporaltest-worker-xxx                 1/1     Running   0          5m
   ```

4. Check the Temporal services:

   ```bash
   kubectl get svc -n temporal
   ```

   **Expected result:** Services for `temporal-frontend` (port 7233), `temporal-web` (port 8080), and internal services for history, matching, and worker are listed.

5. View pod logs for a specific service (e.g., frontend):

   ```bash
   kubectl logs -l app.kubernetes.io/component=frontend -n temporal --tail=50
   ```

---

## Phase 3 — Explore the Temporal Web UI [MANUAL]

### Steps

1. Port-forward the Web UI service to your local machine:

   ```bash
   kubectl port-forward svc/temporaltest-web 8080:8080 -n temporal
   ```

   > Note: The exact service name may vary. Run `kubectl get svc -n temporal` to find it.

   **Expected result:** Output shows `Forwarding from 127.0.0.1:8080 -> 8080`. Keep this terminal open.

2. Open http://localhost:8080 in your browser.

   **Expected result:** The Temporal Web UI loads showing the namespace list.

3. Explore the **Namespaces** section. You will see the `default` namespace created during schema initialisation.

4. Click into the `default` namespace and review the **Workflows** tab. It will be empty until you execute a workflow in Phase 4.

5. Explore the **Task Queues** section to see available queues.

6. Explore **Search Attributes** — these define the metadata fields available for advanced workflow filtering.

   **gcloud equivalent (describe namespace via admin-tools pod):**
   ```bash
   kubectl exec -it deploy/temporaltest-admintools -n temporal -- \
     temporal operator namespace describe --namespace default
   ```

---

## Phase 4 — Execute a Sample Workflow [MANUAL]

### Steps

1. Open a shell inside the Temporal admin-tools pod:

   ```bash
   kubectl exec -it deploy/temporaltest-admintools -n temporal -- bash
   ```

2. Verify the Temporal CLI can reach the Frontend service:

   ```bash
   temporal operator cluster health
   ```

   **Expected result:** Health check returns `SERVING`.

3. Start a sample workflow (note: this requires an application worker to be running for the workflow to complete — it will remain in `Running` state without a worker):

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

4. List running workflows:

   ```bash
   temporal workflow list --namespace default
   ```

   **Expected result:** `my-first-workflow` appears with status `Running`.

5. Open the Web UI at http://localhost:8080 and navigate to the `default` namespace. The workflow appears in the list.

6. Click the workflow to view its **Event History** — every state transition (WorkflowExecutionStarted, WorkflowTaskScheduled, etc.) is recorded in PostgreSQL.

7. Describe the workflow from the CLI:

   ```bash
   temporal workflow describe \
     --workflow-id my-first-workflow \
     --namespace default
   ```

   **Expected result:** Workflow metadata including status, task queue, type, and start time.

8. Exit the admin-tools pod:

   ```bash
   exit
   ```

---

## Phase 5 — Namespace Management [MANUAL]

Temporal namespaces provide isolation between different applications or environments sharing the same cluster.

### Steps

1. Open a shell inside the admin-tools pod:

   ```bash
   kubectl exec -it deploy/temporaltest-admintools -n temporal -- bash
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

6. Exit the admin-tools pod:

   ```bash
   exit
   ```

---

## Phase 6 — Explore Workflow History [MANUAL]

Temporal persists every workflow state transition as an immutable event in PostgreSQL. This is the foundation of Temporal's durability guarantees.

### Steps

1. Open a shell inside the admin-tools pod:

   ```bash
   kubectl exec -it deploy/temporaltest-admintools -n temporal -- bash
   ```

2. List workflows, filtering by status:

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

4. Query a running workflow (requires the workflow to implement a query handler — this demonstrates the capability):

   ```bash
   temporal workflow query \
     --workflow-id my-first-workflow \
     --namespace default \
     --type my-query-type
   ```

5. Send a signal to a running workflow:

   ```bash
   temporal workflow signal \
     --workflow-id my-first-workflow \
     --namespace default \
     --name my-signal \
     --input '"signal-data"'
   ```

6. Exit the admin-tools pod:

   ```bash
   exit
   ```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

Each Temporal service (frontend, history, matching, worker) emits structured JSON logs to Cloud Logging via the GKE node logging agent.

### Steps

1. In the Google Cloud Console, navigate to **Logging > Log Explorer**.

2. Filter logs to the Temporal namespace. Use this filter:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="temporal"
   ```

3. To filter by a specific Temporal service (e.g., History service):

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="temporal"
   resource.labels.container_name=~"history"
   ```

4. Using the `gcloud` CLI:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="temporal"' \
     --project=${PROJECT} \
     --limit=50 \
     --format=json
   ```

5. Look for log entries containing `"level":"error"` to identify any issues with database connections or schema initialisation.

6. Filter for workflow execution events:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="temporal"
   jsonPayload.msg=~"workflow"
   ```

   **Expected result:** Log entries from the Frontend and History services showing incoming gRPC calls and workflow state changes.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

Temporal emits Prometheus-format metrics which GKE Autopilot scrapes and forwards to Cloud Monitoring.

### Steps

1. In the Google Cloud Console, navigate to **Monitoring > Metrics Explorer**.

2. Search for Temporal-related metrics using the prefix `kubernetes.io/`:

   - **Pod CPU usage:** `kubernetes.io/container/cpu/request_utilization`
   - **Pod memory usage:** `kubernetes.io/container/memory/used_bytes`

3. Filter by namespace label `temporal` to scope metrics to the Temporal pods.

4. Check GKE workload metrics for the Temporal History service (the most resource-intensive component):

   ```bash
   # View pod resource usage from kubectl
   kubectl top pods -n temporal
   ```

   **Expected result:** CPU and memory usage for each Temporal pod.

5. In the Cloud Console, navigate to **Monitoring > Dashboards** and explore the **GKE** dashboard. Filter by namespace `temporal`.

6. Create an uptime check or alert policy for the Temporal Frontend deployment to be notified if the service becomes unavailable:

   ```bash
   gcloud monitoring uptime create \
     --display-name="Temporal Frontend" \
     --resource-type=k8s_container \
     --project=${PROJECT}
   ```

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module: the Helm release, Kubernetes namespace, Cloud SQL databases and user, and the Secret Manager secret.

> **Note:** The Cloud SQL PostgreSQL instance itself is managed by Services GCP and is not affected. Resources provisioned by the `Services GCP` module must be undeployed via their own RAD UI deployment entry.

**Expected duration:** 3–6 minutes.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | Automated | RAD UI deployment provisions databases, Helm chart, schema init |
| Phase 2 — kubectl Access | Manual | `gcloud container clusters get-credentials`, verify pods |
| Phase 3 — Web UI | Manual | Port-forward to port 8080, explore namespaces and workflows |
| Phase 4 — Execute Workflow | Manual | `temporal workflow start` via admin-tools pod |
| Phase 5 — Namespace Management | Manual | Create and configure Temporal namespaces |
| Phase 6 — Workflow History | Manual | `temporal workflow show`, inspect event history |
| Phase 7 — Cloud Logging | Manual | Filter GKE container logs by namespace `temporal` |
| Phase 8 — Cloud Monitoring | Manual | Review pod metrics and GKE dashboards |
| Phase 9 — Undeploy | Automated | RAD UI removes all module resources |
