# App on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/App_GKE)**

This lab guide walks you through deploying, exploring, and operating the **App_GKE** foundation
module on Google Kubernetes Engine Autopilot. You will explore the full GKE infrastructure
stack that powers all GKE application modules: Kubernetes workloads, Cloud SQL integration,
Workload Identity, Secret Manager, GCS Fuse, HPA, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access the Application](#exercise-1--access-the-application)
6. [Exercise 2 — Kubernetes Workloads](#exercise-2--kubernetes-workloads)
7. [Exercise 3 — Database Integration](#exercise-3--database-integration)
8. [Exercise 4 — Workload Identity and Secrets](#exercise-4--workload-identity-and-secrets)
9. [Exercise 5 — Networking](#exercise-5--networking)
10. [Exercise 6 — Cloud Logging and Monitoring](#exercise-6--cloud-logging-and-monitoring)
11. [Cleanup](#cleanup)
12. [Reference](#reference)

---

## 1. Overview

### What Is App_GKE?

`App_GKE` is the **foundation deployment engine** for all GKE Autopilot application modules in
the RAD Modules ecosystem. It provisions a production-ready Kubernetes workload, including Cloud
SQL (PostgreSQL or MySQL), Cloud Filestore NFS, GCS Fuse storage, Workload Identity, Secret
Manager, Cloud Build CI/CD, Cloud Monitoring, and optional Cloud Armor WAF. Application wrappers
such as `Wikijs_GKE`, `Ghost_GKE`, and `Django_GKE` call this module with app-specific config.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **GKE Autopilot** | Managed node provisioning, automatic scaling, security hardening |
| **Kubernetes Resources** | Deployment, Service, HPA, ServiceAccount, PodDisruptionBudget |
| **Workload Identity** | KSA → GSA binding, no service account key files needed |
| **Cloud SQL Auth Proxy** | Sidecar-based Unix socket DB connection inside pods |
| **Secret Manager** | Secrets fetched at runtime via Workload Identity |
| **GCS Fuse CSI** | GCS bucket mounted as a filesystem inside pods |
| **HPA** | CPU-based auto-scaling between min/max replica counts |
| **Observability** | Cloud Logging structured JSON, Cloud Monitoring GKE dashboard |

---

## 2. Architecture

```
Internet / Client
       │
       ▼ HTTP (LoadBalancer Service)
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Namespace: app<appname><tenant><deploymentid>             │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Pod: gkeapp-<hash>  (READY 2/2)                      │  │ │
│  │  │  ┌───────────────────┐  ┌────────────────────────┐   │  │  │
│  │  │  │ Container: gkeapp │  │ Sidecar: cloud-sql-proxy│   │  │ │
│  │  │  │ Port: 8080        │  │ /cloudsql Unix socket   │   │  │ │
│  │  │  │ /mnt/nfs (NFS)    │  └────────────────────────┘   │  │  │
│  │  │  │ /mnt/gcs (GCSFuse)│                                │  │ │
│  │  │  └───────────────────┘                                │  │ │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  Service: LoadBalancer → EXTERNAL_IP:80                   │   │
│  │  HPA: min=1  max=3  (CPU-based)                           │   │
│  │  PDB: maxUnavailable=1                                    │   │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
       │ Cloud SQL Auth Proxy (private IP via VPC)
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Cloud SQL PostgreSQL (private IP)                               │
│  Database: gkeappdb  │  User: gkeappuser                         │
│  DB password → Secret Manager                                    │
└──────────────────────────────────────────────────────────────────┘

Supporting Services:
  Workload Identity   ← KSA → GSA binding (no key files)
  Secret Manager      ← database password, app secrets
  GCS Bucket          ← application storage (GCS Fuse CSI)
  Cloud Filestore     ← NFS mount at /mnt/nfs
  Artifact Registry   ← custom container image (Cloud Build)
  Cloud Monitoring    ← uptime check, CPU/memory alerts
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

Deploy the `App_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `gkeapp` | Base resource name |
| `application_version` | `1.0.0` | Container image tag |
| `min_instance_count` | `1` | Minimum pod replicas |
| `max_instance_count` | `3` | HPA maximum replicas |
| `database_type` | `POSTGRES` | Cloud SQL PostgreSQL |
| `enable_nfs` | `true` | Filestore NFS mount |
| `enable_redis` | `true` | Redis env vars injected |
| `reserve_static_ip` | `true` | Static external IP |

Click **Deploy** and wait for provisioning to complete (approximately 15–30 minutes).

> **What this provisions:** GKE namespace, Deployment, Service, HPA, PodDisruptionBudget,
> Cloud SQL PostgreSQL, Workload Identity, Secret Manager secrets, Artifact Registry (custom
> image), GCS Fuse volume, Filestore NFS, static IP, uptime check, and alert policies.

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
  --filter="name~gkeapp" \
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

# Discover the namespace (pattern: app<appname><tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appgkeapp" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Namespace: ${NAMESPACE}"
echo "App URL: http://${EXTERNAL_IP}"
```

---

## Exercise 1 — Access the Application

### Objective

Get the external IP from the Kubernetes LoadBalancer Service, verify pods are running, and
access the application.

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
NAME                       READY   STATUS    RESTARTS   AGE
gkeapp-7d9f8b6c4-xq2pj    2/2     Running   0          5m
```

The `2/2` indicates the application container and Cloud SQL Auth Proxy sidecar are running.

### Step 1.3 — Access the Application

```bash
curl -s "http://${EXTERNAL_IP}/"
```

```bash
# Test health endpoint
curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/healthz"
```

**Expected result:** HTTP `200` — the application is running and connected to the database.

### Step 1.4 — Test Database Connectivity Endpoint

```bash
curl -s "http://${EXTERNAL_IP}/db"
```

**Expected result:** JSON response confirming PostgreSQL connection via the Cloud SQL Auth
Proxy sidecar, showing database name and user.

### Step 1.5 — View Pod Logs

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

kubectl logs "${POD}" -c gkeapp -n "${NAMESPACE}" --tail=50
```

**Expected result:** Application startup logs and incoming request entries.

---

## Exercise 2 — Kubernetes Workloads

### Objective

Inspect the Deployment, Service, HPA, and PodDisruptionBudget resources that form the
Kubernetes workload pattern.

### Step 2.1 — Describe the Deployment

```bash
kubectl describe deployment -l app=gkeapp -n "${NAMESPACE}"
```

Note:
- Two containers: `gkeapp` (port 8080) and `cloud-sql-proxy` (Unix socket at `/cloudsql`)
- Volume mounts: `/cloudsql`, `/mnt/nfs`, GCS Fuse path
- Resource requests/limits: `cpu=1000m`, `memory=512Mi`
- Environment variables: `DB_NAME`, `DB_USER`, `REDIS_HOST`, `REDIS_PORT`

### Step 2.2 — View the HPA

```bash
kubectl get hpa -n "${NAMESPACE}"
kubectl describe hpa -n "${NAMESPACE}"
```

**Expected result:** HPA shows `MINPODS`, `MAXPODS`, and current replica count with CPU target.

### Step 2.3 — Scale the Deployment

```bash
# Scale up to 3 replicas
kubectl scale deployment -n "${NAMESPACE}" --all --replicas=3

# Watch pods come up
kubectl get pods -n "${NAMESPACE}" -w
```

**Expected result:** Three pods reach `Running` status within 1–2 minutes.

```bash
# Scale back to 1
kubectl scale deployment -n "${NAMESPACE}" --all --replicas=1
```

### Step 2.4 — View the Service

```bash
kubectl get service -n "${NAMESPACE}" -o yaml
```

**Expected result:** LoadBalancer service spec showing port 80 → container port 8080 and the
assigned external IP.

### Step 2.5 — Check the PodDisruptionBudget

```bash
kubectl get pdb -n "${NAMESPACE}"
kubectl describe pdb -n "${NAMESPACE}"
```

**Expected result:** PDB allowing at most 1 pod unavailable during voluntary disruptions,
protecting service availability during node drain operations.

### Step 2.6 — Rolling Update

```bash
# Trigger rolling update by patching the deployment annotation
kubectl patch deployment -n "${NAMESPACE}" -l app=gkeapp \
  -p '{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}}}}}'

# Watch the rolling update
kubectl rollout status deployment -l app=gkeapp -n "${NAMESPACE}"
```

**Expected result:** Rollout completes with `successfully rolled out`.

---

## Exercise 3 — Database Integration

### Objective

Inspect the Cloud SQL instance, verify the database initialisation job completed, and confirm
the Auth Proxy sidecar is providing database connectivity.

### Step 3.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
gcloud sql instances list \
  --project="${PROJECT}" \
  --format="table(name, state, databaseVersion, region, settings.tier)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, state, databaseVersion, region}'
```

**Expected result:** A Cloud SQL PostgreSQL instance with state `RUNNABLE`.

### Step 3.2 — Verify the db-init Job Completed

```bash
kubectl get jobs -n "${NAMESPACE}"
```

**Expected result:**
```
NAME      COMPLETIONS   DURATION   AGE
db-init   1/1           45s        10m
```

```bash
# View init job logs
kubectl logs job/db-init -n "${NAMESPACE}"
```

**Expected result:** Logs showing database user creation, database creation, and privilege
grants — confirming the init job ran to completion before the application started.

### Step 3.3 — List Databases in Cloud SQL

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
  | jq '.items[] | {name, charset}'
```

**Expected result:** The application database (`gkeappdb`) appears in the list.

### Step 3.4 — Verify Auth Proxy Sidecar

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

# View Auth Proxy sidecar logs
kubectl logs "${POD}" -c cloud-sql-proxy -n "${NAMESPACE}" --tail=30
```

**Expected result:** Auth Proxy startup messages showing the Cloud SQL instance connection
string and Unix socket path being listened on.

### Step 3.5 — Check Database Connection String in Environment

```bash
kubectl exec "${POD}" -c gkeapp -n "${NAMESPACE}" -- \
  printenv | grep -E "DB_|REDIS_"
```

**Expected result:** Environment variables `DB_NAME`, `DB_USER`, `DB_HOST` (pointing to
the Auth Proxy socket path), `REDIS_HOST`, and `REDIS_PORT`.

---

## Exercise 4 — Workload Identity and Secrets

### Objective

Verify the Workload Identity binding between the Kubernetes ServiceAccount and GCP
ServiceAccount, confirm Secret Manager access, and inspect secret injection.

### Step 4.1 — Inspect the Kubernetes ServiceAccount

```bash
kubectl get serviceaccounts -n "${NAMESPACE}"

# Get the full annotation showing the GCP SA binding
kubectl describe serviceaccount \
  $(kubectl get serviceaccount -n "${NAMESPACE}" \
    -o jsonpath='{.items[0].metadata.name}') \
  -n "${NAMESPACE}"
```

**Expected result:** ServiceAccount annotation:
```
iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com
```

### Step 4.2 — Verify Workload Identity IAM Binding

**gcloud:**
```bash
GSA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~gkeapp" \
  --format="value(email)" --limit=1)

gcloud iam service-accounts get-iam-policy "${GSA}" \
  --project="${PROJECT}"
```

**Expected result:** The Kubernetes ServiceAccount appears as a principal with
`roles/iam.workloadIdentityUser` in the IAM policy.

### Step 4.3 — List and Access Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~gkeapp" \
  --format="table(name, createTime)"
```

```bash
# Access the database password
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

### Step 4.4 — Verify Secret IAM Bindings

**gcloud:**
```bash
gcloud secrets get-iam-policy "${DB_SECRET}" \
  --project="${PROJECT}" \
  --format="json" | jq '.bindings'
```

**Expected result:** The GCP ServiceAccount linked to the KSA has
`roles/secretmanager.secretAccessor` on the secret.

### Step 4.5 — Inspect Kubernetes Secret References

```bash
kubectl get secrets -n "${NAMESPACE}"
```

**Expected result:** Kubernetes Secrets may exist for service account tokens; Secret Manager
secrets are fetched at init time by the db-init job and injected as environment variables —
they are NOT stored as plaintext Kubernetes Secrets.

---

## Exercise 5 — Networking

### Objective

Inspect GKE networking, verify the LoadBalancer Service external IP, and understand VPC
connectivity for Cloud SQL and NFS access.

### Step 5.1 — View the LoadBalancer Service

```bash
kubectl get service -n "${NAMESPACE}" -o wide
```

**gcloud:**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --filter="region:${REGION}" \
  --format="table(name, IPAddress, target)"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/forwardingRules" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, IPAddress, loadBalancingScheme}'
```

**Expected result:** A forwarding rule with the external IP matching `EXTERNAL_IP`.

### Step 5.2 — Verify Static IP Reservation

**gcloud:**
```bash
gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="region:${REGION}" \
  --format="table(name, address, status, addressType)"
```

**Expected result:** A reserved static IP address with status `IN_USE`, assigned to the
LoadBalancer Service.

### Step 5.3 — View the VPC Network

**gcloud:**
```bash
gcloud compute networks list \
  --project="${PROJECT}" \
  --filter="description:managed-by=services-gcp"
```

```bash
gcloud compute networks subnets list \
  --project="${PROJECT}" \
  --filter="region:${REGION} AND description:managed-by=services-gcp" \
  --format="table(name, region, ipCidrRange)"
```

**Expected result:** The Services_GCP-managed VPC network and subnet for the deployed region.

### Step 5.4 — Check Pod-to-Database Connectivity

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

# Check mounted volumes (Cloud SQL socket, NFS, GCS)
kubectl exec "${POD}" -c gkeapp -n "${NAMESPACE}" -- \
  df -h
```

**Expected result:** Filesystems mounted including `/mnt/nfs` (Filestore NFS) and any GCS
Fuse mounts. The Cloud SQL socket at `/cloudsql/` is a directory, not a filesystem mount.

### Step 5.5 — Inspect GKE Cluster Networking

**gcloud:**
```bash
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml(networkConfig, privateClusterConfig, ipAllocationPolicy)"
```

**REST API:**
```bash
curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, network, subnetwork, clusterIpv4Cidr, servicesIpv4Cidr}'
```

**Expected result:** GKE Autopilot cluster networking configuration showing pod CIDR, service
CIDR, and the VPC network name.

---

## Exercise 6 — Cloud Logging and Monitoring

### Objective

Query structured pod logs via Cloud Logging, inspect GKE metrics in Cloud Monitoring, and
verify the uptime check is active.

### Step 6.1 — View Pod Logs via kubectl

```bash
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')

# Application container logs
kubectl logs "${POD}" -c gkeapp -n "${NAMESPACE}" --tail=100

# Cloud SQL Auth Proxy sidecar logs
kubectl logs "${POD}" -c cloud-sql-proxy -n "${NAMESPACE}" --tail=50
```

### Step 6.2 — Query Logs in Cloud Logging

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp,severity,textPayload)"
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

### Step 6.3 — Filter for Errors

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** No error entries under normal operation.

### Step 6.4 — Check the Uptime Check

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

**Expected result:** Uptime check probing the application external IP.

### Step 6.5 — View GKE Pod Metrics

**REST API (MQL — pod CPU utilisation):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/cpu/request_utilization' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, cpu: .pointData[-1].values[0].doubleValue}'
```

**REST API (MQL — pod memory usage):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/memory/used_bytes' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, memory: .pointData[-1].values[0].int64Value}'
```

### Step 6.6 — View Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --format="table(displayName, enabled)"
```

**Expected result:** CPU and memory alert policies for the namespace workloads.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `App_GKE` deployment. This removes the
Kubernetes namespace, all workloads, Cloud SQL database and user, GCS bucket, Workload Identity
bindings, Secret Manager secrets, static IP, and monitoring resources.

### Manual Cleanup (if needed)

**kubectl:**
```bash
kubectl delete namespace "${NAMESPACE}"
```

**gcloud:**
```bash
# Delete Secret Manager secrets
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# Delete the GCP service account
GSA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~gkeapp" \
  --format="value(email)" --limit=1)
gcloud iam service-accounts delete "${GSA}" \
  --project="${PROJECT}" --quiet

# Release static IP
ADDR=$(gcloud compute addresses list \
  --project="${PROJECT}" \
  --filter="region:${REGION} AND name~gkeapp" \
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
| `application_name` | string | `gkeapp` | Base name for Kubernetes and GCP resources |
| `application_version` | string | `1.0.0` | Container image tag |
| `container_image_source` | string | `custom` | `custom` (Cloud Build) or `prebuilt` |
| `min_instance_count` | number | `1` | HPA minimum pod replicas |
| `max_instance_count` | number | `3` | HPA maximum pod replicas |
| `database_type` | string | `POSTGRES` | `POSTGRES`, `MYSQL`, or `NONE` |
| `application_database_name` | string | `gkeappdb` | PostgreSQL database name |
| `application_database_user` | string | `gkeappuser` | PostgreSQL user |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore at `/mnt/nfs` |
| `enable_redis` | bool | `true` | Inject `REDIS_HOST`/`REDIS_PORT` env vars |
| `service_type` | string | `LoadBalancer` | Kubernetes Service type |
| `reserve_static_ip` | bool | `true` | Reserve a static external IP |
| `gke_cluster_name` | string | `""` | Target GKE cluster (auto-discovered when empty) |
| `workload_type` | string | `Deployment` | `Deployment` or `StatefulSet` |
| `tenant_deployment_id` | string | `demo` | Tenant identifier in resource names |
| `support_users` | list | `[]` | Email addresses for monitoring alerts |
| `enable_cloud_armor` | bool | `false` | Cloud Armor WAF + Ingress |
| `enable_iap` | bool | `false` | Identity-Aware Proxy |

### Useful Commands

```bash
# Get external IP
kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Check pod status
kubectl get pods -n ${NAMESPACE}

# View HPA
kubectl get hpa -n ${NAMESPACE}

# View application logs
kubectl logs -l app=gkeapp -n ${NAMESPACE} --tail=100

# View Auth Proxy logs
kubectl logs -l app=gkeapp -c cloud-sql-proxy -n ${NAMESPACE} --tail=50

# Describe deployment
kubectl describe deployment -l app=gkeapp -n ${NAMESPACE}

# Check db-init job
kubectl logs job/db-init -n ${NAMESPACE}

# Access DB password
gcloud secrets versions access latest --secret="${DB_SECRET}" --project=${PROJECT}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}
```

### Further Reading

- [GKE Autopilot overview](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Cloud SQL Auth Proxy for GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [GCS Fuse CSI Driver](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/cloud-storage-fuse-csi-driver)
- [GKE HPA documentation](https://cloud.google.com/kubernetes-engine/docs/concepts/horizontalpodautoscaler)
- [Cloud Logging for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/installing)
- [Cloud Monitoring for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/observing)
