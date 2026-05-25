# Sample Application on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Sample_GKE)**

This lab guide walks you through deploying, exploring, and operating the **Sample** reference
Flask application on Google Kubernetes Engine Autopilot using the **Sample_GKE** module. Use
this module to understand the full App_GKE module feature set before building production GKE
application modules.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access the Sample App](#exercise-1--access-the-sample-app)
6. [Exercise 2 — Explore Application Routes](#exercise-2--explore-application-routes)
7. [Exercise 3 — Kubernetes Workloads and HPA](#exercise-3--kubernetes-workloads-and-hpa)
8. [Exercise 4 — Workload Identity and Configuration](#exercise-4--workload-identity-and-configuration)
9. [Exercise 5 — Cloud Logging and Monitoring](#exercise-5--cloud-logging-and-monitoring)
10. [Cleanup](#cleanup)
11. [Reference](#reference)

---

## 1. Overview

### What Is Sample_GKE?

`Sample_GKE` deploys a minimal **Flask web application** on GKE Autopilot as a reference
implementation demonstrating the full `App_GKE` feature set. The Flask app exposes HTTP
endpoints for testing database connectivity, Workload Identity-based GCP metadata access,
NFS mounts, GCS Fuse storage, and Redis — making it ideal for understanding GKE infrastructure
patterns before deploying production applications.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Flask on GKE Autopilot** | Python container in Kubernetes with HPA and rolling updates |
| **Cloud SQL PostgreSQL** | Database connectivity via Auth Proxy sidecar Unix socket |
| **Workload Identity** | KSA → GSA binding; no key files for GCP API access |
| **Secret Manager** | `SECRET_KEY` fetched at init and injected as env var |
| **GCS Fuse CSI** | Application GCS bucket mounted as filesystem inside pod |
| **HPA** | CPU-based auto-scaling between min/max replicas |
| **PodDisruptionBudget** | Availability protection during voluntary disruptions |

---

## 2. Architecture

```
Internet / Client
       │
       ▼ HTTP (LoadBalancer Service)
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                            │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Namespace: appsample<tenant><deploymentid>                │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Pod: sample-<hash>  (READY 2/2)                      │  │  │
│  │  │  ┌─────────────────┐  ┌────────────────────────────┐  │  │  │
│  │  │  │ Container: Flask │  │ Sidecar: cloud-sql-proxy   │  │  │  │
│  │  │  │ Port: 8080       │  │ /cloudsql Unix socket      │  │  │  │
│  │  │  │ SECRET_KEY ← SM  │  └────────────────────────────┘  │  │  │
│  │  │  │ /mnt/nfs (NFS)   │                                   │  │  │
│  │  │  │ /mnt/gcs (Fuse)  │                                   │  │  │
│  │  │  └─────────────────┘                                    │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  Service: LoadBalancer → EXTERNAL_IP:80                   │  │
│  │  HPA: min=1  max=3  │  PDB: maxUnavailable=1              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
       │ Cloud SQL Auth Proxy (private IP)
       ▼
Cloud SQL PostgreSQL → Database: sampledb  │  DB_PASS → Secret Manager
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
roles/storage.admin
roles/iam.serviceAccountAdmin
roles/monitoring.admin
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

Deploy the `Sample_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `sample` | Base resource name |
| `min_instance_count` | `1` | Minimum pod replicas |
| `max_instance_count` | `3` | HPA maximum replicas |
| `enable_nfs` | `true` | Filestore NFS mount |
| `reserve_static_ip` | `true` | Static external IP |

Click **Deploy** and wait for provisioning to complete (approximately 8–16 minutes).

> **What this provisions:** GKE namespace, Deployment, Service, HPA, PodDisruptionBudget,
> Cloud SQL PostgreSQL, Workload Identity, Secret Manager (`SECRET_KEY` and DB password),
> GCS bucket (GCS Fuse), Filestore NFS, static external IP, uptime check, and alert policies.

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
  --filter="name~sample" \
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

# Discover the namespace (pattern: appsample<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appsample" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Namespace: ${NAMESPACE}"
echo "Sample App URL: http://${EXTERNAL_IP}"
```

---

## Exercise 1 — Access the Sample App

### Objective

Get the external IP from the Kubernetes LoadBalancer Service, verify the Flask app is running,
and confirm all pods are in `Running` state.

### Step 1.1 — Get the External IP

**kubectl:**
```bash
kubectl get service -n "${NAMESPACE}"
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
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, address, status}'
```

**Expected result:** LoadBalancer Service shows an `EXTERNAL-IP` address.

### Step 1.2 — Verify Pods Are Running

```bash
kubectl get pods -n "${NAMESPACE}"
```

Expected output:
```
NAME                               READY   STATUS    RESTARTS   AGE
sample-<suffix>-xxxxxxx-xxxxx      2/2     Running   0          5m
```

The `2/2` indicates the Flask app container and Cloud SQL Auth Proxy sidecar are both running.

### Step 1.3 — Access the Flask Home Page

```bash
curl -s "http://${EXTERNAL_IP}/"
```

**Expected result:** JSON welcome response from the Flask app confirming it is alive.

### Step 1.4 — Test the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/health"
```

**Expected result:** HTTP `200` — this endpoint is also used by the Kubernetes liveness probe.

### Step 1.5 — View Pod Startup Logs

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl logs "${POD}" -c sample -n "${NAMESPACE}" --tail=30
```

**Expected result:** Flask startup log showing the application is running on port 8080 and
database connection has been established.

---

## Exercise 2 — Explore Application Routes

### Objective

Test each Flask endpoint to verify database connectivity, GCP metadata retrieval, NFS mount
access, and environment variable injection.

### Step 2.1 — Test Database Connectivity

```bash
curl -s "http://${EXTERNAL_IP}/db" | jq
```

**Expected result:** JSON response confirming PostgreSQL connection:
```json
{
  "status": "ok",
  "database": "sampledb",
  "user": "sampleuser",
  "connection": "cloud-sql-proxy"
}
```

### Step 2.2 — Retrieve GCP Metadata

```bash
curl -s "http://${EXTERNAL_IP}/metadata" | jq
```

**Expected result:** JSON response with GKE instance metadata including project ID, zone,
pod name, node name, and service account email — retrieved via the GKE metadata server.
This confirms Workload Identity is providing the correct GCP service account identity.

### Step 2.3 — View Non-Sensitive Environment Variables

```bash
curl -s "http://${EXTERNAL_IP}/env" | jq
```

**Expected result:** Environment variables including `DB_NAME`, `DB_USER`, `DB_HOST` (pointing
to the Cloud SQL Auth Proxy socket), `REDIS_HOST` (if Redis is enabled), and Kubernetes
downward API values like `POD_NAME` and `POD_NAMESPACE`.

### Step 2.4 — Test NFS Mount

```bash
curl -s "http://${EXTERNAL_IP}/nfs" | jq
```

**Expected result:** JSON response listing files in `/mnt/nfs`, confirming the Filestore NFS
volume is mounted and readable inside the pod.

### Step 2.5 — Send Multiple Requests

```bash
for i in {1..10}; do
  curl -s "http://${EXTERNAL_IP}/health"
  echo ""
done
```

**Expected result:** All 10 requests return `{"status": "ok"}`, demonstrating consistent
availability and database connectivity.

---

## Exercise 3 — Kubernetes Workloads and HPA

### Objective

Inspect the Deployment configuration, exercise the Horizontal Pod Autoscaler, and verify the
PodDisruptionBudget protects availability.

### Step 3.1 — Describe the Deployment

```bash
kubectl describe deployment -l app=sample -n "${NAMESPACE}"
```

Note:
- Two containers: `sample` (port 8080) and `cloud-sql-proxy` (Unix socket at `/cloudsql`)
- Volume mounts: `/cloudsql`, `/mnt/nfs`, GCS Fuse path at `/mnt/gcs`
- Resource requests and limits
- Liveness and readiness probe configuration (HTTP GET `/health`)

### Step 3.2 — View and Trigger the HPA

```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA shows `MINPODS=1`, `MAXPODS=3`, and current CPU utilisation.

Generate load to trigger scale-up:
```bash
for i in {1..60}; do
  curl -s "http://${EXTERNAL_IP}/db" &
done
wait

# Watch HPA activity
kubectl get hpa -n "${NAMESPACE}" -w
```

**Expected result:** Under sustained load, HPA scales the Deployment from 1 to 2+ replicas.

### Step 3.3 — Scale Manually

```bash
# Scale up
kubectl scale deployment -l app=sample -n "${NAMESPACE}" --replicas=3

# Watch pods start
kubectl get pods -n "${NAMESPACE}" -w
```

**Expected result:** Three pods reach `Running` status within 1–2 minutes.

```bash
# Scale back to 1
kubectl scale deployment -l app=sample -n "${NAMESPACE}" --replicas=1
```

### Step 3.4 — Inspect the PodDisruptionBudget

```bash
kubectl get pdb -n "${NAMESPACE}"
kubectl describe pdb -n "${NAMESPACE}"
```

**Expected result:** PDB allowing maximum 1 pod unavailable, ensuring at least 1 replica
remains available during voluntary disruptions (e.g. node drain, rolling update).

### Step 3.5 — Check the Kubernetes Service

```bash
kubectl get service -n "${NAMESPACE}" -o yaml
```

**Expected result:** LoadBalancer service with port 80 → container port 8080, showing the
assigned static external IP in the `status.loadBalancer.ingress` section.

### Step 3.6 — Perform a Rolling Update

```bash
# Trigger a rolling update by adding a restart annotation
kubectl patch deployment -l app=sample -n "${NAMESPACE}" \
  -p '{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}}}}}'

# Watch the rolling update progress
kubectl rollout status deployment -l app=sample -n "${NAMESPACE}"
```

**Expected result:** Rolling update completes: `successfully rolled out`.

---

## Exercise 4 — Workload Identity and Configuration

### Objective

Verify Workload Identity binding, inspect how Secret Manager values are injected into the
pod, and confirm GCS Fuse and NFS mounts are operational.

### Step 4.1 — Inspect the Kubernetes ServiceAccount

```bash
kubectl get serviceaccounts -n "${NAMESPACE}"
kubectl describe serviceaccount \
  $(kubectl get serviceaccount -n "${NAMESPACE}" \
    -o jsonpath='{.items[0].metadata.name}') \
  -n "${NAMESPACE}"
```

**Expected result:** ServiceAccount annotation:
```
iam.gke.io/gcp-service-account: sample-<hash>@<project>.iam.gserviceaccount.com
```

### Step 4.2 — Verify GCP Service Account IAM Binding

**gcloud:**
```bash
GSA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~sample" \
  --format="value(email)" --limit=1)

gcloud iam service-accounts get-iam-policy "${GSA}" \
  --project="${PROJECT}" \
  --format="json" | jq '.bindings[] | select(.role == "roles/iam.workloadIdentityUser")'
```

**Expected result:** The Kubernetes ServiceAccount (`serviceAccount:<project>.svc.id.goog[<namespace>/<ksa>]`) appears with `roles/iam.workloadIdentityUser`.

### Step 4.3 — List Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~sample" \
  --format="table(name, createTime)"
```

**Expected result:** Secrets for the database password and Flask `SECRET_KEY`.

### Step 4.4 — Access the SECRET_KEY

```bash
SECRET_KEY_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~secret-key OR name~sampleapp" \
  --format="value(name)" --limit=1)

gcloud secrets versions access latest \
  --secret="${SECRET_KEY_SECRET}" \
  --project="${PROJECT}"
```

**Expected result:** A 32-character alphanumeric secret key — the Flask application reads
this from Secret Manager at startup via the init container or direct Secret Manager API call,
and injects it as `SECRET_KEY` in the container environment.

### Step 4.5 — Verify GCS Fuse Mount

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec "${POD}" -c sample -n "${NAMESPACE}" -- \
  df -h | grep -E "fuse|gcs"
```

**Expected result:** A GCS Fuse filesystem entry appears mounted at `/mnt/gcs` or the
configured GCS volume path.

### Step 4.6 — Inspect PVC for NFS

```bash
kubectl get pvc -n "${NAMESPACE}"
kubectl describe pvc -n "${NAMESPACE}"
```

**Expected result:** A PersistentVolumeClaim bound to the Filestore NFS share, using
`ReadWriteMany` access mode, confirming all pods can mount the same NFS share simultaneously.

---

## Exercise 5 — Cloud Logging and Monitoring

### Objective

Query structured Flask pod logs via Cloud Logging, inspect GKE metrics in Cloud Monitoring,
and verify the uptime check is active.

### Step 5.1 — View Pod Logs via kubectl

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

# Application container logs
kubectl logs "${POD}" -c sample -n "${NAMESPACE}" --tail=100

# Cloud SQL Auth Proxy sidecar logs
kubectl logs "${POD}" -c cloud-sql-proxy -n "${NAMESPACE}" --tail=50
```

**Expected result:** Flask request logs and Auth Proxy connection messages.

### Step 5.2 — Query Logs in Cloud Logging

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND resource.labels.container_name=\"sample\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp,severity,jsonPayload.message)"
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
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 5.3 — Filter for Errors

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** No error entries under normal operation.

### Step 5.4 — Check the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(displayName, httpCheck.path, period)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {displayName, period, httpCheck}'
```

**Expected result:** Uptime check probing `http://${EXTERNAL_IP}/health` from multiple global
locations every 60 seconds with passing status.

### Step 5.5 — View GKE Pod CPU and Memory Metrics

**REST API (MQL — pod CPU):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/cpu/request_utilization' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**REST API (MQL — pod memory):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/memory/used_bytes' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, memory: .pointData[-1].values[0].int64Value}'
```

### Step 5.6 — Navigate to GKE Observability Tab

In the Cloud Console, navigate to **Kubernetes Engine > Workloads**, select the `sample`
Deployment, and click the **Observability** tab.

```bash
echo "https://console.cloud.google.com/kubernetes/deployment/${REGION}/${CLUSTER}/${NAMESPACE}/sample?project=${PROJECT}"
```

**Expected result:** Built-in GKE observability view showing CPU, memory, and restart charts
for the deployment pods without manual metric configuration.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Sample_GKE` deployment. This removes the
Kubernetes namespace, all workloads, Cloud SQL database and user, GCS bucket, Workload Identity
bindings, Secret Manager secrets, static IP, and monitoring resources.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete secrets
for SECRET in $(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~sample" \
  --format="value(name)"); do
  gcloud secrets delete "${SECRET}" \
    --project="${PROJECT}" --quiet
done

# Release static IP
ADDR=$(gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="region:${REGION} AND name~sample" \
  --format="value(name)" --limit=1)
gcloud compute addresses delete "${ADDR}" \
  --region="${REGION}" \
  --project="${PROJECT}" --quiet
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `sample` | Base name for Kubernetes and GCP resources |
| `application_version` | string | `latest` | Container image tag |
| `min_instance_count` | number | `1` | HPA minimum pod replicas |
| `max_instance_count` | number | `3` | HPA maximum pod replicas |
| `application_database_name` | string | `sampledb` | PostgreSQL database name |
| `application_database_user` | string | `sampleuser` | PostgreSQL user |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore at `/mnt/nfs` |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS container mount path |
| `enable_redis` | bool | `false` | Inject Redis env vars |
| `redis_host` | string | `""` | Redis hostname (required when Redis enabled) |
| `gke_cluster_name` | string | `""` | Target GKE cluster (auto-discovered when empty) |
| `service_type` | string | `LoadBalancer` | Kubernetes Service type |
| `reserve_static_ip` | bool | `true` | Reserve a static external IP |
| `tenant_deployment_id` | string | `demo` | Tenant identifier in resource names |
| `support_users` | list | `[]` | Email addresses for monitoring alerts |
| `resource_labels` | map | `{}` | Labels applied to all GCP resources |

### Useful Commands

```bash
# Get external IP
kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Check pod status
kubectl get pods -n ${NAMESPACE}

# View Flask logs
kubectl logs -l app=sample -n ${NAMESPACE} --tail=100

# View Auth Proxy logs
kubectl logs -l app=sample -c cloud-sql-proxy -n ${NAMESPACE} --tail=50

# View HPA
kubectl get hpa -n ${NAMESPACE}

# Describe deployment
kubectl describe deployment -l app=sample -n ${NAMESPACE}

# Access DB password
gcloud secrets versions access latest --secret="${DB_SECRET}" --project=${PROJECT}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}
```

### Further Reading

- [Flask documentation](https://flask.palletsprojects.com/)
- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [GKE HPA documentation](https://cloud.google.com/kubernetes-engine/docs/concepts/horizontalpodautoscaler)
- [GCS Fuse CSI Driver for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/cloud-storage-fuse-csi-driver)
- [Cloud Logging for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/installing)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/observing)
