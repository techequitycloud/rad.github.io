---
title: "Temporal on GKE — Lab Guide"
sidebar_label: "Temporal GKE"
---

# Temporal on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Temporal_GKE)**

This lab guide walks you through deploying, exploring, and operating **Temporal** on Google
Kubernetes Engine Autopilot using the **Temporal_GKE** module. You will explore a durable
workflow orchestration platform backed by Cloud SQL PostgreSQL, with the Temporal Web UI,
CLI-driven workflow execution, and full observability via Cloud Logging and Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Temporal Web UI](#exercise-1--access-temporal-web-ui)
6. [Exercise 2 — Explore Namespaces and Workflows](#exercise-2--explore-namespaces-and-workflows)
7. [Exercise 3 — Run a Sample Workflow](#exercise-3--run-a-sample-workflow)
8. [Exercise 4 — Workflow History and Visibility](#exercise-4--workflow-history-and-visibility)
9. [Exercise 5 — Workers and Task Queues](#exercise-5--workers-and-task-queues)
10. [Exercise 6 — Cluster Components](#exercise-6--cluster-components)
11. [Exercise 7 — Database Persistence](#exercise-7--database-persistence)
12. [Exercise 8 — Cloud Logging and Monitoring](#exercise-8--cloud-logging-and-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Temporal?

Temporal is an open-source **durable execution platform** for reliable distributed workflows.
It provides workflow execution with automatic retries, timers, signals, and queries — backed
by PostgreSQL for durable workflow history storage. If a worker crashes mid-workflow, Temporal
replays the event history to restore workflow state on any available worker, guaranteeing
exactly-once semantics. The `Temporal_GKE` module deploys **version 1.25.0** (`temporalio/auto-setup`)
on GKE Autopilot with the Temporal Web UI (`temporal-ui`).

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Durable Execution** | Workflow state persisted in PostgreSQL — survives pod restarts |
| **Event History** | Immutable event log of every workflow state transition |
| **Temporal CLI** | `temporal workflow start/list/describe/show/signal` |
| **Namespace Isolation** | Multiple namespaces for application or environment separation |
| **Web UI** | Visual workflow management, task queue inspection, search |
| **Task Queues** | Worker registration and task dispatch |
| **Kubernetes Integration** | GKE Autopilot, Workload Identity, Cloud SQL Auth Proxy |
| **Observability** | Structured JSON logs in Cloud Logging, pod metrics in Cloud Monitoring |

---

## 2. Architecture

```
Browser / Client
       │
       ▼ HTTP port 8081 (LoadBalancer)
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Namespace: apptemporal<tenant><deploymentid>              │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Pod: temporal-<hash>  (READY 2/2)                    │  │ │
│  │  │  Container: temporalio/auto-setup:1.25.0              │  │ │
│  │  │  ├── Frontend service  (gRPC port 7233)               │  │ │
│  │  │  ├── History service   (workflow state)               │  │ │
│  │  │  ├── Matching service  (task queue dispatch)          │  │ │
│  │  │  └── Worker service    (workflow/activity workers)    │  │ │
│  │  │  Sidecar: cloud-sql-proxy (Unix socket /cloudsql)     │  │ │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Pod: temporal-ui-<hash>  (READY 1/1)                 │  │ │
│  │  │  Container: ubuntu/temporal-ui                        │  │ │
│  │  │  Port: 8080 → LoadBalancer port 8081                  │  │ │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  Services:                                                 │  │
│  │  ├── temporal (ClusterIP port 7233 — gRPC frontend)       │   │
│  │  └── temporal-ui (LoadBalancer port 8081)                 │   │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
       │ Cloud SQL Auth Proxy
       ▼
Cloud SQL PostgreSQL → temporal (persistence) + temporal_vis (visibility)
```

Module variable wiring:

```
  Temporal_GKE
    application_name    = "temporal"         →  Kubernetes resource names
    application_version = "1.25.0"           →  temporalio/auto-setup tag
    num_history_shards  = 4                  →  CANNOT change after deploy
    service_type        = "ClusterIP"        →  gRPC frontend (cluster-internal)
    enable_elasticsearch = false             →  basic visibility mode
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
roles/cloudsql.admin
roles/secretmanager.admin
roles/iam.serviceAccountAdmin
roles/monitoring.admin
roles/logging.admin
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Temporal_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `temporal` | Base resource name |
| `application_version` | `1.25.0` | Temporal server version |
| `num_history_shards` | `4` | Cannot change after deploy |
| `min_instance_count` | `1` | Minimum pod replicas |
| `service_type` | `ClusterIP` | gRPC frontend access |
| `enable_elasticsearch` | `false` | Basic visibility |

Click **Deploy** and wait for provisioning to complete (approximately 9–20 minutes).

> **What this provisions:** GKE namespace, Temporal all-in-one deployment (Frontend, History,
> Matching, Worker services), Temporal Web UI deployment, Cloud SQL databases (persistence +
> visibility), db-init Job, Workload Identity, Secret Manager secret, ClusterIP gRPC service,
> Web UI LoadBalancer service, uptime check.

> **First-deployment note:** `temporalio/auto-setup` runs full schema initialisation on first
> boot. Allow up to 15 minutes for the startup probe to pass.

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

# Discover the DB secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~temporal" \
  --format="value(name)" \
  --limit=1)

echo "Cluster: ${CLUSTER}"
echo "DB Secret: ${DB_SECRET}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info

# Discover the namespace (pattern: apptemporal<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^apptemporal" | head -1)

# Get Web UI external IP
export WEB_UI_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[?(@.spec.ports[0].port==8081)].status.loadBalancer.ingress[0].ip}')

echo "Namespace: ${NAMESPACE}"
echo "Temporal Web UI: http://${WEB_UI_IP}:8081"
```

---

## Exercise 1 — Access Temporal Web UI

### Objective

Retrieve the Web UI external IP, verify both Temporal pods are running, access the Web UI
dashboard, and explore the default namespace.

### Step 1.1 — Verify Pods Are Running

```bash
kubectl get pods -n "${NAMESPACE}"
```

Expected output:
```
NAME                            READY   STATUS    RESTARTS   AGE
temporal-<hash>                 2/2     Running   0          10m
temporal-ui-<hash>              1/1     Running   0          10m
```

The `2/2` for the main pod indicates `temporalio/auto-setup` (all four services) plus the
Cloud SQL Auth Proxy sidecar.

### Step 1.2 — Get the Web UI External IP

```bash
kubectl get svc -n "${NAMESPACE}"
```

**gcloud:**
```bash
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="region:${REGION}" \
  --format="table(name, address, status)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, endpoint}'
```

**Expected result:** The Web UI LoadBalancer Service shows an `EXTERNAL-IP` on port 8081.

### Step 1.3 — Access the Web UI

Open `http://${WEB_UI_IP}:8081` in a browser.

**Expected result:** The Temporal Web UI loads showing the namespace list with `default` and
`temporal-system` namespaces.

### Step 1.4 — Explore the Dashboard

1. Click the **default** namespace.
2. Explore the **Workflows** tab (empty until you run a workflow in Exercise 3).
3. Navigate to **Task Queues** to see available queues.
4. Navigate to **Search Attributes** to see workflow metadata fields.

**Expected result:** Dashboard loads successfully, demonstrating all four Temporal services
(Frontend, History, Matching, Worker) are operational.

### Step 1.5 — View Temporal Service Logs

```bash
TEMPORAL_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  | grep -v temporal-ui | head -1 | awk '{print $1}')

kubectl logs "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" --tail=50
```

**Expected result:** Structured JSON log entries showing Temporal service startup, PostgreSQL
schema initialisation completion, and all four services entering SERVING state.

---

## Exercise 2 — Explore Namespaces and Workflows

### Objective

Connect to the Temporal CLI inside the main pod, list namespaces, verify cluster health, and
explore the default namespace configuration.

### Step 2.1 — Open a Shell in the Temporal Pod

```bash
TEMPORAL_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  | grep -v temporal-ui | head -1 | awk '{print $1}')

kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- bash
```

### Step 2.2 — Check Cluster Health

Inside the pod:
```bash
temporal operator cluster health
```

**Expected result:** `SERVING` — all four Temporal services are healthy.

### Step 2.3 — List Temporal Namespaces

```bash
temporal operator namespace list
```

**Expected result:** Two namespaces appear:
- `default` — for application workflows
- `temporal-system` — for internal Temporal system operations

### Step 2.4 — Describe the Default Namespace

```bash
temporal operator namespace describe --namespace default
```

**Expected result:** Namespace configuration including retention period (default 72 hours),
replication config, registered cluster name, and visibility settings.

### Step 2.5 — List Workflows in the Default Namespace

```bash
temporal workflow list --namespace default
```

**Expected result:** Empty list (no workflows executed yet). You will create one in Exercise 3.

```bash
exit
```

---

## Exercise 3 — Run a Sample Workflow

### Objective

Use the Temporal CLI to submit a workflow execution, observe it in the Web UI, verify it
appears in the visibility database, and explore workflow status.

### Step 3.1 — Open a Shell in the Temporal Pod

```bash
TEMPORAL_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  | grep -v temporal-ui | head -1 | awk '{print $1}')

kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- bash
```

### Step 3.2 — Start a Sample Workflow

```bash
temporal workflow start \
  --task-queue my-task-queue \
  --type MyWorkflow \
  --namespace default \
  --workflow-id my-first-workflow \
  --input '"hello-from-lab"'
```

**Expected result:**
```
Running execution:
  WorkflowId  my-first-workflow
  RunId       <uuid>
  Type        MyWorkflow
  Namespace   default
  TaskQueue   my-task-queue
```

> **Note:** Without a worker connected to `my-task-queue`, the workflow remains in `Running`
> state waiting for a worker. This demonstrates Temporal's durability — the workflow state is
> persisted in PostgreSQL regardless of worker availability.

### Step 3.3 — List Running Workflows

```bash
temporal workflow list --namespace default
```

**Expected result:** `my-first-workflow` appears with status `Running`.

### Step 3.4 — Describe the Workflow

```bash
temporal workflow describe \
  --workflow-id my-first-workflow \
  --namespace default
```

**Expected result:** Workflow metadata including status, task queue, type, start time, and
execution ID.

### Step 3.5 — View in the Web UI

Open `http://${WEB_UI_IP}:8081/namespaces/default/workflows` in a browser.

**Expected result:** `my-first-workflow` appears in the workflow list with status `Running`.
Click the workflow to see its event history and execution details.

### Step 3.6 — Start a Second Workflow

```bash
temporal workflow start \
  --task-queue test-queue \
  --type TestWorkflow \
  --namespace default \
  --workflow-id my-second-workflow
```

```bash
temporal workflow list --namespace default
```

**Expected result:** Two workflows appear in the `Running` state.

```bash
exit
```

---

## Exercise 4 — Workflow History and Visibility

### Objective

Inspect the immutable event history that underpins Temporal's durability guarantees, send
signals to running workflows, and query workflows using the visibility API.

### Step 4.1 — View Full Event History

```bash
TEMPORAL_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  | grep -v temporal-ui | head -1 | awk '{print $1}')

kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal workflow show \
    --workflow-id my-first-workflow \
    --namespace default
```

**Expected result:** A table of all events with sequence numbers, event types
(`WorkflowExecutionStarted`, `WorkflowTaskScheduled`), timestamps, and attributes.

### Step 4.2 — Send a Signal to a Running Workflow

```bash
kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal workflow signal \
    --workflow-id my-first-workflow \
    --namespace default \
    --name my-signal \
    --input '"signal-payload"'
```

**Expected result:** Signal is accepted. In the Web UI, view the workflow event history — a
`WorkflowExecutionSignaled` event appears in the log.

### Step 4.3 — Query Workflows by Status

```bash
kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- bash -c "
  temporal workflow list \
    --namespace default \
    --query 'ExecutionStatus=\"Running\"'
"
```

**Expected result:** Only running workflows appear (filtered from all workflows).

### Step 4.4 — Terminate a Workflow

```bash
kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal workflow terminate \
    --workflow-id my-second-workflow \
    --namespace default \
    --reason "lab cleanup"
```

```bash
# Verify termination
kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal workflow describe \
    --workflow-id my-second-workflow \
    --namespace default \
  | grep -i status
```

**Expected result:** `my-second-workflow` shows status `Terminated`.

### Step 4.5 — View Archived Workflows

```bash
kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal workflow list \
    --namespace default \
    --archived
```

**Expected result:** Both running and terminated workflows appear in the complete list.

---

## Exercise 5 — Workers and Task Queues

### Objective

Explore task queues in the Temporal Web UI, understand worker registration, and observe
task queue polling behaviour.

### Step 5.1 — List Task Queues via Web UI

Open `http://${WEB_UI_IP}:8081/namespaces/default/task-queues` in a browser.

**Expected result:** Task queues `my-task-queue` and `test-queue` appear — they were
registered implicitly when workflows were started targeting them.

### Step 5.2 — Describe a Task Queue via CLI

```bash
TEMPORAL_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  | grep -v temporal-ui | head -1 | awk '{print $1}')

kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal task-queue describe \
    --task-queue my-task-queue \
    --namespace default
```

**Expected result:** Task queue details showing partitions, polling workers (none if no
application worker is connected), and pending task counts.

### Step 5.3 — Observe Task Queue Backlog

```bash
kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal workflow list \
    --namespace default \
    --query 'TaskQueue="my-task-queue"'
```

**Expected result:** All workflows targeting `my-task-queue` appear — they remain in
`Running` state because no worker is polling the queue.

### Step 5.4 — Understand Worker Registration

In Temporal, workers are application processes that:
1. Connect to the Temporal Frontend service on gRPC port 7233
2. Register with a specific task queue and namespace
3. Poll for workflow/activity tasks
4. Execute business logic and report results back to Temporal

The Temporal cluster in this lab has no application workers — only the built-in Temporal
internal worker (for system workflows). External workers connect using the frontend address:

```bash
kubectl exec -it "${TEMPORAL_POD}" -c temporal -n "${NAMESPACE}" -- \
  temporal operator cluster describe
```

**Expected result:** Cluster info including the frontend address (`temporal.<namespace>.svc.cluster.local:7233`)
that SDK workers would use to connect from within the cluster.

---

## Exercise 6 — Cluster Components

### Objective

Inspect the four Temporal service components running in the all-in-one pod, verify GKE
Autopilot node provisioning, and review Kubernetes resources.

### Step 6.1 — View All Namespace Resources

```bash
kubectl get all -n "${NAMESPACE}"
```

Expected resources:
```
NAME                              READY   STATUS    RESTARTS   AGE
pod/temporal-<hash>               2/2     Running   0          15m
pod/temporal-ui-<hash>            1/1     Running   0          15m

NAME                  TYPE           CLUSTER-IP    EXTERNAL-IP    PORT(S)
service/temporal      ClusterIP      10.96.xx.xx   <none>         7233/TCP
service/temporal-ui   LoadBalancer   10.96.yy.yy   34.xx.xx.xx    8081:31234/TCP

NAME                          READY   UP-TO-DATE   AVAILABLE
deployment.apps/temporal         1/1     1            1
deployment.apps/temporal-ui      1/1     1            1
```

### Step 6.2 — Describe the Temporal Deployment

```bash
kubectl describe deployment -l app=temporal -n "${NAMESPACE}"
```

Note:
- Two containers: `temporal` (gRPC 7233) and `cloud-sql-proxy` (Unix socket)
- Environment variables: `DB_PLUGIN=postgres12`, `DB_PORT=5432`, `NUM_HISTORY_SHARDS=4`
- Startup probe: HTTP `/health` with 15-minute timeout window

### Step 6.3 — View Temporal Pod Containers

```bash
TEMPORAL_POD=$(kubectl get pods -n "${NAMESPACE}" --no-headers \
  | grep -v temporal-ui | head -1 | awk '{print $1}')

kubectl get pod "${TEMPORAL_POD}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.containers[*].name}' | tr ' ' '\n'
```

**Expected result:** `temporal` and `cloud-sql-proxy` — the all-in-one image runs all four
Temporal services as goroutines within a single container process.

### Step 6.4 — Check Resource Allocation

```bash
kubectl top pods -n "${NAMESPACE}"
```

**Expected result:** CPU and memory consumption for both the Temporal server pod and Web UI
pod. The Temporal server typically uses 200–600 mCPU and 1–2 GiB memory.

### Step 6.5 — View GKE Node Provisioning

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml(nodeConfig, autoscaling)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, status, autopilot}'
```

**Expected result:** GKE Autopilot configuration showing automatic node management.

---

## Exercise 7 — Database Persistence

### Objective

Inspect the Cloud SQL PostgreSQL databases backing Temporal's durable workflow storage,
verify the db-init job, and understand the persistence and visibility databases.

### Step 7.1 — List Cloud SQL Instances

**gcloud:**
```bash
gcloud sql instances list \
  --project="${PROJECT}" \
  --format="table(name, state, databaseVersion, region)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, state, databaseVersion}'
```

**Expected result:** Cloud SQL PostgreSQL instance with state `RUNNABLE`.

### Step 7.2 — List Temporal Databases

```bash
SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --format="value(name)" --limit=1)

gcloud sql databases list \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}/databases" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name}'
```

**Expected result:** Two Temporal databases appear:
- `temporal` — primary persistence database (workflow history, task queues, timers)
- `temporal_vis` — visibility database (workflow execution records for search and listing)

### Step 7.3 — Verify the db-init Job

```bash
kubectl get jobs -n "${NAMESPACE}"
kubectl logs job/temporal-db-init -n "${NAMESPACE}" 2>/dev/null || \
  kubectl logs -l job-name=temporal-db-init -n "${NAMESPACE}"
```

**Expected result:** Job `COMPLETIONS: 1/1`. Logs show the PostgreSQL role creation with
`CREATEDB` privilege — required before `temporalio/auto-setup` initialises the schema.

### Step 7.4 — Access the DB Password Secret

**gcloud:**
```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 --decode
```

**Expected result:** The database password for the Temporal PostgreSQL user.

### Step 7.5 — Verify Workload Identity

**gcloud:**
```bash
GSA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~temporal" \
  --format="value(email)" --limit=1)

gcloud iam service-accounts get-iam-policy "${GSA}" \
  --project="${PROJECT}" \
  --format="json" | jq '.bindings[] | select(.role == "roles/iam.workloadIdentityUser")'
```

**Expected result:** The Temporal Kubernetes ServiceAccount is bound to the GCP ServiceAccount
via Workload Identity, with `roles/iam.workloadIdentityUser`.

---

## Exercise 8 — Cloud Logging and Monitoring

### Objective

Find Temporal application logs in Cloud Logging, explore structured JSON workflow event logs,
and review pod metrics in Cloud Monitoring.

### Step 8.1 — View Temporal Pod Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"temporal\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format=json | jq '.[].jsonPayload'
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"k8s_container\\\" AND resource.labels.namespace_name=\\\"${NAMESPACE}\\\"\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp, severity, jsonPayload}'
```

### Step 8.2 — Filter for Workflow Events

In the Cloud Console Log Explorer:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="temporal"
jsonPayload.msg=~"workflow|execution|task"
```

**Expected result:** Structured JSON log entries showing gRPC calls for `StartWorkflowExecution`
and `PollWorkflowTaskQueue` from the CLI commands executed in Exercise 3.

### Step 8.3 — Filter for Errors

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** No errors under normal operation. Database connection failures would
appear as `"level":"error"` JSON entries.

### Step 8.4 — View Cloud Monitoring Pod Metrics

**REST API (MQL — CPU):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/cpu/request_utilization' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**REST API (MQL — memory):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/memory/used_bytes' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, memory: .pointData[-1].values[0].int64Value}'
```

### Step 8.5 — Check HPA Scaling Activity

```bash
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA showing current/desired replicas and CPU target (Temporal is a
single-instance all-in-one in this lab configuration).

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Temporal_GKE` deployment. This removes
the Kubernetes namespace, Temporal workloads, Cloud SQL databases (`temporal`, `temporal_vis`)
and user, Secret Manager secret, Workload Identity bindings, and monitoring resources.

> **Note:** If `enable_purge=false`, the Cloud SQL databases are retained after undeploy.
> The Cloud SQL instance itself is managed by `Services_GCP` and is not affected.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete the DB secret
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# Delete Temporal databases from the shared Cloud SQL instance
SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --format="value(name)" --limit=1)

gcloud sql databases delete temporal \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT}" --quiet

gcloud sql databases delete temporal_vis \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT}" --quiet
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `temporal` | Base name for Kubernetes and GCP resources |
| `application_version` | string | `1.25.0` | Temporal server image tag |
| `num_history_shards` | number | `4` | History shard count — cannot change after deploy |
| `min_instance_count` | number | `1` | Minimum pod replicas |
| `max_instance_count` | number | `1` | Maximum pod replicas |
| `cpu_limit` | string | `2000m` | CPU limit per pod (2 vCPU) |
| `memory_limit` | string | `4Gi` | Memory limit per pod |
| `service_type` | string | `ClusterIP` | gRPC frontend service type |
| `enable_elasticsearch` | bool | `false` | Enable Elasticsearch advanced visibility |
| `elasticsearch_url` | string | `""` | Elasticsearch URL (required when enabled) |
| `gke_cluster_name` | string | `""` | Target GKE cluster (auto-discovered when empty) |
| `tenant_deployment_id` | string | `demo` | Tenant identifier in resource names |
| `deploy_application` | bool | `true` | Deploy the Temporal workload |
| `resource_labels` | map | `{}` | Labels applied to all GCP resources |

### Useful Commands

```bash
# Access Temporal CLI inside pod
TEMPORAL_POD=$(kubectl get pods -n ${NAMESPACE} --no-headers | grep -v temporal-ui | head -1 | awk '{print $1}')
kubectl exec -it ${TEMPORAL_POD} -c temporal -n ${NAMESPACE} -- bash

# Inside pod:
temporal operator cluster health
temporal operator namespace list
temporal workflow list --namespace default
temporal workflow start --task-queue q --type T --namespace default --workflow-id wf1
temporal workflow describe --workflow-id wf1 --namespace default
temporal workflow show --workflow-id wf1 --namespace default
temporal workflow signal --workflow-id wf1 --namespace default --name sig --input '"data"'

# Web UI URL
echo "http://$(kubectl get svc -n ${NAMESPACE} -o jsonpath='{.items[?(@.spec.ports[0].port==8081)].status.loadBalancer.ingress[0].ip}'):8081"

# View Temporal logs
kubectl logs -l app=temporal -c temporal -n ${NAMESPACE} --tail=100

# DB secret
gcloud secrets versions access latest --secret="${DB_SECRET}" --project=${PROJECT}
```

### Further Reading

- [Temporal documentation](https://docs.temporal.io/)
- [Temporal `temporalio/auto-setup` image](https://hub.docker.com/r/temporalio/auto-setup)
- [Temporal Web UI](https://github.com/temporalio/ui)
- [Temporal CLI reference](https://docs.temporal.io/cli)
- [Temporal workflow execution model](https://docs.temporal.io/workflows)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
