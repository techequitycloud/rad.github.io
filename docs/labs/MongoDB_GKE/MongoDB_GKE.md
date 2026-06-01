---
title: "MongoDB on GKE — Lab Guide"
sidebar_label: "MongoDB GKE"
---

# MongoDB on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/MongoDB_GKE)**

## Overview

**Estimated time:** 2–3 hours

MongoDB is the world's most popular NoSQL document database, used for flexible document storage across content management, IoT data, mobile backends, and AI/ML feature stores. This lab deploys MongoDB on GKE Autopilot as a StatefulSet with an SSD-backed persistent volume, auto-generated root credentials, and internal cluster access via ClusterIP.

### What the Module Automates

- GKE Autopilot StatefulSet with SSD-backed PVC (20 Gi, mounted at `/data/db`)
- Auto-generated MongoDB root password stored in Secret Manager
- Artifact Registry repository and image mirroring pipeline
- Kubernetes Service (ClusterIP by default), namespace, and Workload Identity
- TCP health probes on port 27017 (MongoDB wire protocol)
- Cloud Monitoring alerts (when `support_users` is configured)

### What You Do Manually

- Note the Kubernetes Service cluster DNS name from outputs
- Connect to MongoDB using `mongosh` via `kubectl port-forward`
- Create databases, collections, and documents
- Explore MongoDB queries and aggregation pipelines
- Review logs in Cloud Logging

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, view logs, describe GKE clusters |
| `kubectl` | Port-forward, inspect pods and StatefulSets |
| `mongosh` | MongoDB shell for querying and administration |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/) | [mongosh](https://www.mongodb.com/docs/mongodb-shell/install/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, GKE Autopilot cluster).
3. The following APIs enabled (Services_GCP handles this):
   - `container.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region for GKE |
| `application_name` | No | `"mongodb"` | Base name for Kubernetes resources and secrets |
| `application_version` | No | `"7.0"` | MongoDB image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `mongo_root_username` | No | `"admin"` | Root username (`MONGO_INITDB_ROOT_USERNAME`) |
| `mongo_initdb_database` | No | `"admin"` | Initial database name |
| `stateful_pvc_size` | No | `"20Gi"` | Storage size for the MongoDB data PVC |
| `cpu_limit` | No | `"1000m"` | CPU per pod |
| `memory_limit` | No | `"2Gi"` | Memory per pod |
| `service_type` | No | `"ClusterIP"` | Kubernetes Service type (`ClusterIP` or `LoadBalancer`) |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| GKE Autopilot node provisioning | 5–10 min |
| PVC provisioning (SSD, `standard-rwo`) | 1–3 min |
| StatefulSet pod startup (image pull + mongod init) | 3–8 min |
| **Total** | **9–21 min** |

> **Note:** The startup probe allows up to ~8 minutes (`failure_threshold = 45`, 10-second period) for GKE Autopilot to provision the node, attach the PVC, and pull the MongoDB image before the pod is considered failed.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name |
| `service_url` | Internal cluster URL of the MongoDB Service |
| `mongo_root_password_secret` | Secret Manager secret name for the root password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export CLUSTER="your-gke-cluster-name"

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Find the MongoDB namespace
export NS=$(kubectl get namespaces \
  -o jsonpath='{.items[*].metadata.name}' \
  | tr ' ' '\n' | grep mongodb)

echo "Namespace: ${NS}"

# Retrieve the root password from Secret Manager
export MONGO_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~mongo-root-password" \
  --format="value(name)" \
  --limit=1)

export MONGO_PASSWORD=$(gcloud secrets versions access latest \
  --secret="${MONGO_SECRET}" \
  --project=${PROJECT})

echo "Root password retrieved (${#MONGO_PASSWORD} chars)"
```

---

## Phase 2 — Access MongoDB [MANUAL]

### Step 2.1 — Verify the StatefulSet is Ready

```bash
kubectl get statefulsets -n ${NS}
kubectl get pods -n ${NS}
```

**Expected result:** The StatefulSet shows `1/1` ready. The pod shows `Running` status.

### Step 2.2 — Connect via Port-Forward

```bash
kubectl port-forward -n ${NS} svc/mongodb 27017:27017 &
export PF_PID=$!
echo "Port-forward PID: ${PF_PID}"
```

**Expected result:** Port-forward is established. MongoDB is now accessible at `localhost:27017`.

### Step 2.3 — Connect with mongosh

```bash
mongosh "mongodb://admin:${MONGO_PASSWORD}@localhost:27017/admin"
```

**Expected result:** `mongosh` connects and displays the MongoDB version and a prompt (`test>`).

---

## Phase 3 — Explore MongoDB [MANUAL]

### Step 3.1 — Check Server Status

```javascript
db.adminCommand({ serverStatus: 1 })
```

**Expected result:** Server status object including uptime, connections, memory usage, and WiredTiger cache statistics.

### Step 3.2 — Create a Database and Collection

```javascript
use myapp

db.users.insertMany([
  { name: "Alice", email: "alice@example.com", role: "admin" },
  { name: "Bob",   email: "bob@example.com",   role: "user"  },
  { name: "Carol", email: "carol@example.com",  role: "user"  }
])
```

**Expected result:** Three documents inserted with auto-generated `_id` fields.

### Step 3.3 — Query Documents

```javascript
// Find all users
db.users.find()

// Find by role
db.users.find({ role: "user" })

// Find with projection
db.users.find({ role: "user" }, { name: 1, email: 1, _id: 0 })
```

**Expected result:** Documents matching the filter are returned. Projection controls which fields appear.

### Step 3.4 — Create an Index

```javascript
db.users.createIndex({ email: 1 }, { unique: true })
db.users.getIndexes()
```

**Expected result:** The email index is created. `getIndexes()` lists both the default `_id` index and the new email index.

### Step 3.5 — Run an Aggregation Pipeline

```javascript
db.users.aggregate([
  { $group: { _id: "$role", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])
```

**Expected result:** User counts grouped by role, sorted descending.

---

## Phase 4 — Inspect Storage [MANUAL]

### Step 4.1 — Verify the PVC

```bash
kubectl get pvc -n ${NS}
kubectl describe pvc -n ${NS}
```

**Expected result:** The PVC shows `Bound` status, `standard-rwo` StorageClass (SSD-backed), and the configured size.

### Step 4.2 — Check Data Directory in the Pod

```bash
kubectl exec -n ${NS} statefulset/mongodb -- df -h /data/db
```

**Expected result:** The `/data/db` mount point shows the PVC with available storage.

---

## Phase 5 — Explore Cloud Logging [MANUAL]

### Step 5.1 — View MongoDB Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app"=~"mongodb"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** MongoDB startup logs including `mongod` initialization, WiredTiger cache configuration, and `Waiting for connections` message.

### Step 5.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app"=~"mongodb" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, no warnings appear.

---

## Phase 6 — GKE Features [MANUAL]

### Step 6.1 — Examine the StatefulSet

```bash
kubectl describe statefulset -n ${NS}
```

**Expected result:** The StatefulSet description shows the pod template, PVC template (`standard-rwo`, `/data/db`), resource limits, and security context (`fsGroup: 999`).

### Step 6.2 — Review Pod Security Context

```bash
kubectl get pod -n ${NS} -o jsonpath='{.items[0].spec.securityContext}'
```

**Expected result:** The security context includes `fsGroup: 999` — MongoDB's UID/GID. Kubernetes chowns the PVC mount to this GID on attach.

---

## Phase 7 — Clean Up [MANUAL]

```bash
# Stop port-forward
kill ${PF_PID}
```

---

## Phase 8 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 5–10 minutes.

> **Warning:** This permanently deletes the StatefulSet, PVC, and all MongoDB data. Export your data using `mongodump` before undeploying:
> ```bash
> mongodump --uri="mongodb://admin:${MONGO_PASSWORD}@localhost:27017/admin" --out=/tmp/mongodb-backup
> ```

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Autopilot StatefulSet provisioning | 1 | Yes |
| SSD PVC (`standard-rwo`, 20 Gi) | 1 | Yes |
| Root password generation and Secret Manager storage | 1 | Yes |
| Artifact Registry image mirroring | 1 | Yes |
| Kubernetes Service (ClusterIP) | 1 | Yes |
| Note service URL and secret name from RAD UI | 1 | No |
| Retrieve root password from Secret Manager | 1 | No |
| Verify StatefulSet is ready | 2 | No |
| Connect via port-forward and mongosh | 2 | No |
| Create databases, collections, and indexes | 3 | No |
| Run aggregation pipelines | 3 | No |
| Inspect PVC and storage | 4 | No |
| Review Cloud Logging | 5 | No |
| Examine StatefulSet and security context | 6 | No |
| Export data with mongodump | 8 | No |
| Undeploy infrastructure | 8 | Yes |
