# Kestra on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kestra_GKE)**

Kestra is an open-source, declarative, event-driven workflow orchestration platform (Apache 2.0) with
26,000+ GitHub stars, trusted by more than 30,000 organisations. This lab deploys Kestra in
**standalone mode** on GKE Autopilot — the server, worker, and scheduler run in a single container
backed by Cloud SQL PostgreSQL 15 and GCS artifact storage. You will explore kubectl-based access,
YAML flow authoring, scheduling and webhook triggers, plugin integrations, Kubernetes workload
management, Workload Identity, and GCP observability.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Kestra](#exercise-1--access-kestra)
6. [Exercise 2 — Create Flows and Schedules](#exercise-2--create-flows-and-schedules)
7. [Exercise 3 — Plugins and Integrations](#exercise-3--plugins-and-integrations)
8. [Exercise 4 — Kubernetes Workloads](#exercise-4--kubernetes-workloads)
9. [Exercise 5 — Security and Workload Identity](#exercise-5--security-and-workload-identity)
10. [Exercise 6 — Cloud Logging and Monitoring](#exercise-6--cloud-logging-and-monitoring)
11. [Cleanup](#cleanup)
12. [Reference](#reference)

---

## 1. Overview

### What Is Kestra?

Kestra is a **declarative orchestration platform** for data pipelines, ETL/ELT workflows, and
API automation. Every flow is a plain YAML document with tasks, triggers, and namespace-scoped
variables — fully version-controllable. The `Kestra_GKE` module deploys Kestra in standalone
mode on GKE Autopilot with a Kubernetes LoadBalancer service, Cloud SQL Auth Proxy sidecar, and
Workload Identity for secure GCS access.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **kubectl Access** | Cluster credentials, pod inspection, and port-forwarding |
| **YAML Flow Authoring** | Create and execute workflow definitions via the UI and API |
| **Scheduling and Webhooks** | Cron triggers and HTTP-triggered executions |
| **Plugins and Integrations** | GCS, HTTP, and parameterised task integrations |
| **Kubernetes Workloads** | Pod lifecycle, HPA scaling, Cloud SQL sidecar |
| **Workload Identity** | GKE pod-to-GCP resource authentication without key files |
| **GCP Observability** | Cloud Logging structured logs, Cloud Monitoring pod metrics |

---

## 2. Architecture

```
Browser / API Client
       │
       ▼ HTTP:8080 (LoadBalancer)
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Kubernetes Namespace (appkestra<tenant><id>)              │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │  Kestra Pod (2/2 READY)                             │   │  │
│  │  │  ┌─────────────────┐  ┌───────────────────────────┐ │   │  │
│  │  │  │  kestra         │  │  cloud-sql-proxy          │ │   │  │
│  │  │  │  container      │  │  sidecar                  │ │   │  │
│  │  │  │  (JVM server +  │  │  TCP 127.0.0.1:5432       │ │   │  │
│  │  │  │  worker +       │  │  → Cloud SQL              │ │   │  │
│  │  │  │  scheduler)     │  │                           │ │   │  │
│  │  │  └─────────────────┘  └───────────────────────────┘ │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  LoadBalancer Service :8080 → Kestra pod :8080            │  │
│  │  HPA: minReplicas=1, maxReplicas=1                        │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
       │                    │
       ▼                    ▼
┌─────────────────┐  ┌─────────────────────────────────────────┐
│  GCS Bucket     │  │  Cloud SQL PostgreSQL 15                │
│  kestra-storage │  │  Queue + Repository backend             │
│  Workload       │  │  (executions, flows, logs)              │
│  Identity SA    │  └─────────────────────────────────────────┘
└─────────────────┘

Supporting resources:
  Secret Manager     → KESTRA_BASICAUTH_PASSWORD (admin password)
  Artifact Registry  → custom Kestra container image
  Cloud Build        → image build and mirroring
  Workload Identity  → pod SA ↔ GCP SA binding
  Cloud Monitoring   → pod CPU/memory metrics
```

Module variable wiring:

```
Kestra_GKE
  application_name     = "kestra"
  cpu_limit            = "2000m"   → JVM needs ≥ 2 vCPU
  memory_limit         = "4Gi"     → JVM heap + OS overhead
  min_instance_count   = 1         → single replica (standalone mode)
  max_instance_count   = 1         → standalone mode: single pod
  KESTRA_QUEUE_TYPE    = postgres  → PostgreSQL execution queue
  KESTRA_STORAGE_TYPE  = gcs       → GCS artifact storage
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` | Any | System package manager |
| `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
roles/logging.viewer
roles/monitoring.viewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"   # your GCP project ID
export REGION="us-central1"             # region you deployed into
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Kestra_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `kestra` | Base resource name |
| `cpu_limit` | `2000m` | Minimum 2 vCPU for JVM |
| `memory_limit` | `4Gi` | Minimum 4Gi for JVM heap |
| `min_instance_count` | `1` | Single replica for standalone mode |
| `max_instance_count` | `1` | Standalone mode only |

Click **Deploy** and wait for provisioning (approximately 15–35 minutes).

> **What this provisions:** GKE Autopilot namespace and Deployment, Kubernetes LoadBalancer
> Service, Cloud SQL PostgreSQL 15 instance and database, Secret Manager secret for admin
> password, Artifact Registry repository, Cloud Build custom image pipeline, HPA, Workload
> Identity binding, and Cloud Monitoring notification channels.

### 4.2 Configure Shell Environment

```bash
# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)

echo "Cluster: ${CLUSTER}"
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info
kubectl get nodes
```

```bash
# Discover the Kestra namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appkestra" | head -1)

echo "Namespace: ${NAMESPACE}"

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Kestra URL: http://${EXTERNAL_IP}:8080"

# Discover the admin password secret
export ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~kestra.*admin" \
  --format="value(name)" \
  --limit=1)
```

---

## Exercise 1 — Access Kestra

### Objective

Connect to the GKE cluster, verify the Kestra pod is running, and access the Kestra UI via
the LoadBalancer external IP.

### Step 1.1 — Verify the Pod Is Running

```bash
kubectl get pods -n "${NAMESPACE}"
```

**Expected result:** Pod in `Running` status with `2/2` containers ready:
```
NAME                  READY   STATUS    RESTARTS   AGE
kestra-<hash>         2/2     Running   0          8m
```

The `2/2` indicates the Kestra JVM container plus the Cloud SQL Auth Proxy sidecar.

### Step 1.2 — Check the LoadBalancer Service

**kubectl:**
```bash
kubectl get svc -n "${NAMESPACE}"
```

**Expected result:** A `LoadBalancer` service with an `EXTERNAL-IP` assigned and port `8080`.

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{status: .status, nodeCount: .currentNodeCount}'
```

### Step 1.3 — Check the Kestra Health Endpoint

```bash
curl -s "http://${EXTERNAL_IP}:8080/health"
```

**Expected result:** `{"status":"UP"}` JSON response.

> If the endpoint returns a connection error, the pod may still be starting. The JVM startup
> probe allows up to 14 minutes (`initial_delay_seconds=30` + `failure_threshold=40` x
> `period_seconds=20`).

### Step 1.4 — Retrieve the Admin Password

```bash
gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}"
```

**Expected result:** 24-character alphanumeric admin password.

### Step 1.5 — Explore the Kestra UI

Navigate to `http://${EXTERNAL_IP}:8080` in a browser. Log in with:
- Username: `admin`
- Password: (value from Step 1.4)

Explore the main navigation tabs:
- **Flows** — YAML flow definitions
- **Executions** — execution history and task logs
- **Logs** — aggregated system logs
- **Namespaces** — hierarchical namespace management
- **Audit Log** — full activity audit trail

---

## Exercise 2 — Create Flows and Schedules

### Objective

Author YAML flows, add cron and webhook triggers, and verify execution history.

### Step 2.1 — Create a Hello World Flow

In the Kestra UI, navigate to **Flows > Create** and enter:

```yaml
id: hello-world
namespace: company.team
tasks:
  - id: hello
    type: io.kestra.plugin.core.log.Log
    message: "Hello from Kestra on GKE!"
  - id: show_date
    type: io.kestra.plugin.core.log.Log
    message: "Trigger type: {{ trigger.type ?? 'manual' }}"
```

Click **Save** then **Execute**.

**Expected result:** Execution completes with `SUCCESS` state.

### Step 2.2 — Execute via REST API

```bash
curl -s -X POST \
  "http://${EXTERNAL_IP}:8080/api/v1/executions/company.team/hello-world" \
  -H "Content-Type: application/json" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '{id: .id, state: .state.current}'
```

**Expected result:** JSON with execution `id` and `state: "SUCCESS"` or `"RUNNING"`.

### Step 2.3 — Add Schedule and Webhook Triggers

Edit the `hello-world` flow and update it:

```yaml
id: hello-world
namespace: company.team
tasks:
  - id: hello
    type: io.kestra.plugin.core.log.Log
    message: "Triggered by: {{ trigger.type ?? 'manual' }}"
triggers:
  - id: schedule
    type: io.kestra.plugin.core.trigger.Schedule
    cron: "*/5 * * * *"
  - id: webhook
    type: io.kestra.plugin.core.trigger.Webhook
    key: gke-lab-key
```

Click **Save**.

### Step 2.4 — Test the Webhook Trigger

```bash
curl -s -X POST \
  "http://${EXTERNAL_IP}:8080/api/v1/executions/webhook/company.team/hello-world/gke-lab-key" \
  -H "Content-Type: application/json" \
  -d '{"source": "kubectl-lab", "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
```

**Expected result:** JSON with `id` field — the new execution ID.

### Step 2.5 — Verify Executions via kubectl Logs

```bash
kubectl logs -n "${NAMESPACE}" \
  deployment/kestra --tail=30
```

**Expected result:** JVM log lines showing execution events for the triggered flow.

---

## Exercise 3 — Plugins and Integrations

### Objective

Explore the Kestra plugin ecosystem and test HTTP and GCP integrations.

### Step 3.1 — Browse Available Plugins via API

**REST API:**
```bash
curl -s \
  "http://${EXTERNAL_IP}:8080/api/v1/plugins" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '.[].group' | sort | uniq
```

**Expected result:** Plugin groups including `io.kestra.plugin.core`, `io.kestra.plugin.gcp`.

### Step 3.2 — Create a Flow with an HTTP Task

In the Kestra UI, create a new flow:

```yaml
id: http-integration
namespace: lab.experiments
tasks:
  - id: fetch_data
    type: io.kestra.plugin.core.http.Request
    uri: "https://httpbin.org/json"
    method: GET
  - id: log_response
    type: io.kestra.plugin.core.log.Log
    message: "HTTP status: {{ outputs.fetch_data.code }}"
```

Execute the flow and verify `HTTP status: 200` in the task logs.

### Step 3.3 — Create a Parameterised Flow

```yaml
id: parameterised-flow
namespace: lab.experiments
inputs:
  - id: message
    type: STRING
    defaults: "Hello from GKE"
tasks:
  - id: log
    type: io.kestra.plugin.core.log.Log
    message: "{{ inputs.message }}"
```

Execute with a custom input via REST API:

```bash
curl -s -X POST \
  "http://${EXTERNAL_IP}:8080/api/v1/executions/lab.experiments/parameterised-flow" \
  -H "Content-Type: multipart/form-data" \
  -F "message=Custom input from kubectl" \
  -u "admin:$(gcloud secrets versions access latest --secret=${ADMIN_SECRET} --project=${PROJECT})" \
  | jq '{id: .id, state: .state.current}'
```

**Expected result:** Execution succeeds with the custom message in task output.

### Step 3.4 — Inspect Namespace Variables

In the Kestra UI, navigate to **Namespaces > Create** and add namespace `lab.experiments`.

Under **Variables**, add:
- Key: `gcs_bucket`
- Value: the name of your Kestra storage bucket

Add a second variable:
- Key: `environment`
- Value: `gke-lab`

### Step 3.5 — Create a GCS-Aware Flow

```yaml
id: gcs-list
namespace: lab.experiments
tasks:
  - id: list
    type: io.kestra.plugin.gcp.gcs.List
    serviceAccount: "{{ secret('GCS_SERVICE_ACCOUNT') }}"
    projectId: "{{ envs.project_id }}"
    from: "gs://{{ namespace.gcs_bucket }}"
  - id: log_count
    type: io.kestra.plugin.core.log.Log
    message: "Found {{ outputs.list.blobs | length }} objects"
```

> Note: Executing this flow requires GCS credentials configured as a Kestra secret. The
> structure demonstrates how the GCS plugin integrates with namespace variables and secrets.

---

## Exercise 4 — Kubernetes Workloads

### Objective

Inspect the Kestra GKE deployment, understand the pod structure, Cloud SQL sidecar, HPA
configuration, and perform a rolling restart.

### Step 4.1 — Inspect the Deployment

```bash
kubectl describe deployment kestra -n "${NAMESPACE}"
```

Key sections to review:
- **Image**: Artifact Registry custom Kestra image
- **Containers**: `kestra` (JVM) + `cloud-sql-proxy` (sidecar)
- **Resources**: CPU and memory limits
- **Env from**: Secret references

### Step 4.2 — Inspect the Kestra Pod in Detail

```bash
KESTRA_POD=$(kubectl get pod -n "${NAMESPACE}" -l app=kestra \
  -o jsonpath='{.items[0].metadata.name}')

# List containers in the pod
kubectl get pod "${KESTRA_POD}" -n "${NAMESPACE}" \
  -o jsonpath='{.spec.containers[*].name}' | tr ' ' '\n'

# Check resource usage
kubectl top pod "${KESTRA_POD}" -n "${NAMESPACE}"
```

**Expected result:** Two containers: `kestra` and `cloud-sql-proxy`.

### Step 4.3 — Inspect the Cloud SQL Proxy Sidecar

```bash
kubectl logs "${KESTRA_POD}" -n "${NAMESPACE}" -c cloud-sql-proxy --tail=20
```

**Expected result:** Cloud SQL Auth Proxy log lines showing it is listening on
`127.0.0.1:5432` and connected to the Cloud SQL instance.

### Step 4.4 — Check HPA Status

**kubectl:**
```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA showing `MINPODS=1`, `MAXPODS=1`, `REPLICAS=1`.

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.nodeConfig | {machineType, diskSizeGb}'
```

### Step 4.5 — Rolling Restart

```bash
kubectl rollout restart deployment/kestra -n "${NAMESPACE}"
kubectl rollout status deployment/kestra -n "${NAMESPACE}" --timeout=300s
```

**Expected result:** Deployment rolls to a new pod without downtime (session affinity preserves existing connections).

---

## Exercise 5 — Security and Workload Identity

### Objective

Verify Workload Identity bindings between the Kubernetes service account and the GCP service
account, and inspect Secret Manager access patterns.

### Step 5.1 — List Service Accounts in the Namespace

```bash
kubectl get serviceaccounts -n "${NAMESPACE}"
```

**Expected result:** At least one service account for the Kestra workload.

### Step 5.2 — Check Workload Identity Annotation

```bash
kubectl get serviceaccount -n "${NAMESPACE}" \
  -o yaml | grep -A3 "iam.gke.io"
```

**Expected result:** Annotation `iam.gke.io/gcp-service-account` pointing to a GCP service account.

### Step 5.3 — Verify GCP Service Account IAM Binding

**gcloud:**
```bash
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~kestra OR email~appkestra" \
  --format="table(email, displayName)"
```

**REST API:**
```bash
curl -s \
  "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.accounts[] | select(.email | test("kestra")) | {email: .email, displayName: .displayName}'
```

**Expected result:** A service account for the Kestra workload with access to Cloud SQL, GCS, and Secret Manager.

### Step 5.4 — Verify Secret Manager Access

```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~kestra" \
  --format="table(name, createTime)"
```

```bash
# Access the admin password secret (verifies IAM is correct)
gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}"
```

**Expected result:** Admin password value returned — confirms Secret Manager IAM binding is correct.

### Step 5.5 — Inspect Kubernetes Secrets

```bash
kubectl get secrets -n "${NAMESPACE}"
```

```bash
# View the non-sensitive keys (not values) of a secret
kubectl get secret -n "${NAMESPACE}" \
  -o jsonpath='{range .items[*]}{.metadata.name}: {range .data}{.key}{"\t"}{end}{"\n"}{end}'
```

**Expected result:** Kubernetes secrets containing database credentials and Kestra admin password, injected directly from Secret Manager values at deployment time.

---

## Exercise 6 — Cloud Logging and Monitoring

### Objective

View Kestra execution logs in Cloud Logging and review pod-level resource metrics in Cloud
Monitoring.

### Step 6.1 — View Logs in Cloud Logging Console

Navigate to:
```
https://console.cloud.google.com/logs/query?project=${PROJECT}
```

Filter for Kestra pod logs:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="kestra"
```

**Expected result:** JVM startup, database migration, execution events, and scheduler ticks.

### Step 6.2 — Query Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'"' \
  --project="${PROJECT}" \
  --limit=20 \
  --format=json \
  | jq '.[].jsonPayload // .[].textPayload'
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceNames": ["projects/'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "orderBy": "timestamp desc",
    "pageSize": 20
  }' | jq '.entries[] | {timestamp, payload: (.jsonPayload // .textPayload)}'
```

### Step 6.3 — Filter for Flow Execution Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'"${NAMESPACE}"'" AND resource.labels.container_name="kestra" AND severity>=INFO' \
  --project="${PROJECT}" \
  --limit=15
```

**Expected result:** Structured log entries showing flow IDs, execution states, and task outputs.

### Step 6.4 — View Cloud Monitoring Metrics

Navigate to:
```
https://console.cloud.google.com/monitoring?project=${PROJECT}
```

In **Metrics Explorer**, query:
- `kubernetes.io/container/cpu/request_utilization` — CPU usage vs request (JVM: 20–60%)
- `kubernetes.io/container/memory/request_utilization` — JVM heap usage
- `kubernetes.io/pod/network/received_bytes_count` — inbound network traffic

Filter by `resource.namespace_name = "${NAMESPACE}"`.

**gcloud:**
```bash
gcloud monitoring time-series list \
  --project="${PROJECT}" \
  --filter='metric.type="kubernetes.io/container/memory/limit_utilization" AND resource.label.namespace_name="'"${NAMESPACE}"'"'
```

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch k8s_container::kubernetes.io/container/memory/limit_utilization | filter resource.namespace_name = \"'"${NAMESPACE}"'\" | within 30m | group_by [resource.container_name], mean(val())"
  }' | jq '.timeSeriesData[] | {container: .labelValues[0].stringValue, utilization: .pointData[-1].values[0].doubleValue}'
```

### Step 6.5 — Check HPA from Monitoring

```bash
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA status showing current replica count = 1 and scaling thresholds.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Kestra_GKE` deployment. This removes the
Kubernetes workloads, Cloud SQL instance, Secret Manager secrets, GCS bucket, Artifact Registry
images, Workload Identity bindings, and all supporting IAM resources.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Cloud SQL instance
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" --filter="name~kestra" \
  --format="value(name)" --limit=1)
gcloud sql instances delete "${INSTANCE}" --project="${PROJECT}" --quiet

# Delete GCS bucket
BUCKET=$(gcloud storage buckets list --project="${PROJECT}" \
  --filter="name~kestra-storage" --format="value(name)" | head -1)
gcloud storage rm -r "gs://${BUCKET}/"

# Delete secrets
gcloud secrets list --project="${PROJECT}" --filter="name~kestra" \
  --format="value(name)" | \
  xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete GKE namespace workloads:**
```bash
curl -s -X DELETE \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region |
| `application_name` | string | `kestra` | Base name for Kubernetes resources |
| `application_version` | string | `latest` | Container image version tag |
| `gke_cluster_name` | string | `""` | GKE cluster name (auto-discovered if empty) |
| `cpu_limit` | string | `2000m` | CPU limit (JVM needs ≥ 2 vCPU) |
| `memory_limit` | string | `4Gi` | Memory limit (JVM needs ≥ 2Gi) |
| `min_instance_count` | number | `1` | Minimum pod replicas |
| `max_instance_count` | number | `1` | Maximum pod replicas (standalone mode) |
| `db_name` | string | `kestra` | PostgreSQL database name |
| `db_user` | string | `kestra` | PostgreSQL user |
| `database_password_length` | number | `32` | Auto-generated password length |
| `enable_nfs` | bool | `false` | Mount Cloud Filestore NFS |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron (UTC) |
| `backup_retention_days` | number | `7` | Backup retention period |

### Key Environment Variables (Auto-Injected)

| Variable | Value | Purpose |
|---|---|---|
| `KESTRA_QUEUE_TYPE` | `postgres` | PostgreSQL execution queue |
| `KESTRA_REPOSITORY_TYPE` | `postgres` | PostgreSQL flow repository |
| `KESTRA_STORAGE_TYPE` | `gcs` | GCS artifact storage |
| `KESTRA_BASICAUTH_ENABLED` | `true` | Enable basic auth |
| `KESTRA_BASICAUTH_USERNAME` | `admin` | Default admin username |
| `MICRONAUT_SERVER_PORT` | `8080` | Kestra server port |
| `OLLAMA_HOST` | — | N/A (Kestra-specific) |

### Useful Commands

```bash
# Get external IP
kubectl get svc -n "${NAMESPACE}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Check pod health
kubectl get pods -n "${NAMESPACE}"

# View Kestra logs
kubectl logs deployment/kestra -n "${NAMESPACE}" --tail=50

# View Cloud SQL proxy logs
kubectl logs "${KESTRA_POD}" -n "${NAMESPACE}" -c cloud-sql-proxy --tail=20

# Retrieve admin password
gcloud secrets versions access latest --secret="${ADMIN_SECRET}" --project="${PROJECT}"

# Trigger a webhook execution
curl -X POST "http://${EXTERNAL_IP}:8080/api/v1/executions/webhook/<ns>/<flowId>/<key>"

# List all executions
curl -s "http://${EXTERNAL_IP}:8080/api/v1/executions?size=10" -u "admin:<password>"

# Rolling restart
kubectl rollout restart deployment/kestra -n "${NAMESPACE}"

# View GKE logs
gcloud logging read 'resource.type="k8s_container"' --project="${PROJECT}" --limit=20
```

### Further Reading

- [Kestra documentation](https://kestra.io/docs)
- [Kestra plugin index](https://kestra.io/plugins)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy for GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Cloud Logging for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/managing-logs)
