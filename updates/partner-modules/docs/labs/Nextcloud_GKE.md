# Nextcloud on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Nextcloud_GKE)**

## Overview

**Estimated time:** 3–4 hours

Nextcloud is the leading open-source self-hosted file sync and collaboration platform. This lab deploys Nextcloud 30 on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for persistent config and data storage, and Redis caching. GKE Autopilot provides managed Kubernetes with horizontal pod autoscaling and StatefulSet support for reliable persistent-storage workloads.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (or StatefulSet)
- Cloud SQL MySQL 8.0 instance, database (utf8mb4), and user (mysql_native_password)
- Cloud SQL Auth Proxy sidecar injection
- Cloud Filestore (NFS) instance for shared `config/` and `data/` persistence
- GCS storage bucket provisioning
- Secret Manager secrets (admin password, DB password)
- Artifact Registry repository and Cloud Build custom image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer), HPA, and PodDisruptionBudget
- Cloud Monitoring uptime checks and alert policies
- Automated backup CronJob

### What You Do Manually

- Note deployment outputs (external IP, namespace, cluster) from the RAD UI deployment panel
- Configure `kubectl` with cluster credentials
- Confirm Nextcloud is reachable at the LoadBalancer IP
- Log in with admin credentials from Secret Manager
- Upload files, install apps, and explore Nextcloud features
- Review pod logs with `kubectl logs`
- Inspect the StatefulSet/Deployment and persistent volumes

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, configure kubectl, view cluster logs |
| `kubectl` | Inspect pods, view logs, exec into containers |
| `curl` | Test Nextcloud status and WebDAV endpoints |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL instance, GKE cluster, and NFS server).
3. The following APIs enabled (Services_GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `file.googleapis.com`
4. `gcloud` and `kubectl` installed and authenticated.
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier (e.g. `"prod"`) |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"30"` | Nextcloud version tag |
| `nextcloud_admin_user` | No | `"admin"` | Admin account username |
| `php_memory_limit` | No | `"512M"` | PHP memory limit |
| `upload_max_filesize` | No | `"512M"` | Max upload file size |
| `post_max_size` | No | `"512M"` | Max POST body size |
| `cpu_limit` | No | `"2000m"` | CPU per pod |
| `memory_limit` | No | `"4Gi"` | Memory per pod |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `application_database_name` | No | `"gkeappdb"` | MySQL database name |
| `application_database_user` | No | `"gkeappuser"` | MySQL database username |
| `enable_redis` | No | `true` | Enable Redis caching |
| `enable_nfs` | No | `true` | Mount NFS for persistence |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `backup_schedule` | No | `"0 2 * * *"` | Backup cron schedule |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| GKE Autopilot cluster (if new) | 10–15 min |
| Cloud SQL MySQL instance creation | 8–12 min |
| Cloud Build image build | 5–10 min |
| Kubernetes Deployment and pod readiness | 5–10 min |
| **Total (new cluster)** | **28–47 min** |
| **Total (existing cluster)** | **18–32 min** |

> **First-boot note:** `occ maintenance:install` runs synchronously inside the pod before Apache starts. On a cold Cloud SQL instance this can take 2–5 minutes. The startup probe allows up to 6 minutes of startup tolerance.

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `external_ip` | External LoadBalancer IP for Nextcloud |
| `service_url` | Full URL (e.g. `http://<IP>`) |
| `namespace` | Kubernetes namespace |
| `cluster_name` | GKE cluster name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

export NAMESPACE=$(kubectl get namespaces \
  --no-headers -o custom-columns=NAME:.metadata.name \
  | grep nextcloud | head -1)

echo "Cluster: ${CLUSTER}"
echo "Namespace: ${NAMESPACE}"
```

### Step 1.4 — Configure kubectl

```bash
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Verify connectivity
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more `nextcloud-*` pods listed with status `Running`.

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the External IP

```bash
kubectl get service -n ${NAMESPACE} -o wide
```

**Expected result:** A `LoadBalancer` service with an external IP in the `EXTERNAL-IP` column.

```bash
export SERVICE_IP=$(kubectl get service -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${SERVICE_IP}"
echo "Nextcloud URL: ${SERVICE_URL}"
```

**gcloud equivalent:**
```bash
gcloud compute forwarding-rules list \
  --project=${PROJECT} \
  --filter="description~nextcloud" \
  --format="table(name, IPAddress)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}"
```

### Step 2.2 — Check the Status Endpoint

```bash
curl -s "${SERVICE_URL}/status.php" | jq .
```

**Expected result:**
```json
{
  "installed": true,
  "maintenance": false,
  "needsDbUpgrade": false,
  "version": "30.0.x"
}
```

If `"installed": false`, the pod is still initialising. Check pod logs:
```bash
kubectl logs -n ${NAMESPACE} -l app=nextcloud --tail=50
```

### Step 2.3 — Retrieve Admin Credentials

```bash
# Find admin password secret
ADMIN_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~admin-password" \
  --format="value(name)" \
  --limit=1)

ADMIN_PASS=$(gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project=${PROJECT})

echo "Admin password: ${ADMIN_PASS}"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Anextcloud" \
  | jq '.secrets[].name'
```

**Expected result:** 24-character alphanumeric admin password.

### Step 2.4 — Log In to Nextcloud

Open a browser and navigate to `${SERVICE_URL}`.

- **Username:** your `nextcloud_admin_user` value (default: `admin`)
- **Password:** retrieved in Step 2.3

**Expected result:** The Nextcloud Files dashboard appears.

---

## Phase 3 — Explore the Files App [MANUAL]

### Step 3.1 — Upload a File

1. Click **+** (New) in the Files app.
2. Select **Upload file**.
3. Upload a local file.

**Expected result:** File appears in the list. It is stored on NFS at `/mnt/nfs/nextcloud-data`.

### Step 3.2 — Test WebDAV Access

```bash
ADMIN_USER="admin"

curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -X PROPFIND \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/" \
  -H "Depth: 1" 2>&1 | grep "<d:href>"
```

**Expected result:** WebDAV XML response with HTTP 207 Multi-Status listing files.

### Step 3.3 — Upload via WebDAV

```bash
echo "GKE WebDAV test file" > /tmp/gke-test.txt

curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -T /tmp/gke-test.txt \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/gke-test.txt"
```

**Expected result:** HTTP 201 Created. File appears in the Nextcloud Files UI.

---

## Phase 4 — Install Apps [MANUAL]

### Step 4.1 — Install Calendar and Contacts

1. Click the grid icon (top-right) → **Apps**.
2. Search for **Calendar** → **Download and enable**.
3. Search for **Contacts** → **Download and enable**.

**Expected result:** Both apps appear in the navigation bar.

### Step 4.2 — Verify App Persistence Across Pod Restarts

```bash
# Simulate a pod restart
kubectl rollout restart deployment -n ${NAMESPACE}
kubectl rollout status deployment -n ${NAMESPACE}
```

Navigate back to Nextcloud and verify Calendar and Contacts are still installed.

**Expected result:** Apps persist because the Nextcloud `apps/` directory is stored on NFS.

---

## Phase 5 — Inspect Kubernetes Resources [MANUAL]

### Step 5.1 — List Pods

```bash
kubectl get pods -n ${NAMESPACE} -o wide
```

**Expected result:** One or more `nextcloud-*` pods in `Running` state. Each pod has the Cloud SQL Auth Proxy sidecar.

### Step 5.2 — Describe the Pod

```bash
POD=$(kubectl get pods -n ${NAMESPACE} -o name | grep nextcloud | head -1)
kubectl describe ${POD} -n ${NAMESPACE}
```

**Expected result:** Pod details show two containers: the main Nextcloud container and the `cloudsql-proxy` sidecar. NFS volume mount at `/mnt/nfs` is listed.

### Step 5.3 — View Pod Logs

```bash
# Main container logs
kubectl logs -n ${NAMESPACE} -l app=nextcloud -c nextcloud --tail=50

# Cloud SQL Auth Proxy sidecar logs
kubectl logs -n ${NAMESPACE} -l app=nextcloud -c cloudsql-proxy --tail=20
```

**Expected result:** Nextcloud startup log messages including NFS mount detection, DB host override, MySQL readiness wait, and `occ maintenance:install` status.

### Step 5.4 — Check HPA

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA resource with current/desired replica count. Min replicas = `min_instance_count`, max = `max_instance_count`.

### Step 5.5 — Check Pod Disruption Budget

```bash
kubectl get pdb -n ${NAMESPACE}
```

**Expected result:** PDB with `MIN AVAILABLE = 1`, ensuring at least one Nextcloud pod remains running during node upgrades.

### Step 5.6 — Inspect NFS Volume Mount

```bash
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- ls -la /mnt/nfs/
```

**Expected result:** Two directories: `nextcloud-config/` and `nextcloud-data/`. The config directory contains `config.php`.

```bash
# Verify config.php is on NFS
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- ls -la /var/www/html/config/
```

**Expected result:** `/var/www/html/config` is a symlink pointing to `/mnt/nfs/nextcloud-config`. `config.php` is present.

---

## Phase 6 — Administration [MANUAL]

### Step 6.1 — Access Administration Settings

1. Log in as admin.
2. Click username (top-right) → **Administration settings**.

**Expected result:** Administration panel with Overview, Basic settings, Security sections.

### Step 6.2 — Create a User

1. Navigate to **Users**.
2. Click **New user** and create `testuser`.

**Expected result:** User created and listed.

### Step 6.3 — Run an OCC Command via kubectl exec

```bash
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- \
  php occ status
```

**Expected result:** Nextcloud installation status output:
```
  - installed: true
  - version: 30.0.x
  - versionstring: 30.0.x
  - edition: Community
```

### Step 6.4 — List Enabled Apps via OCC

```bash
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- \
  php occ app:list --enabled 2>&1 | head -30
```

**Expected result:** List of enabled Nextcloud apps including `files`, `calendar`, `contacts`.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Nextcloud Pod Logs in Cloud Logging

Navigate to **Cloud Console > Logging > Logs Explorer**:

```
resource.type="k8s_container"
resource.labels.cluster_name="${CLUSTER}"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="nextcloud"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.cluster_name="'${CLUSTER}'" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.cluster_name=\"'"${CLUSTER}"'\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Nextcloud startup and runtime logs.

### Step 7.2 — View db-init Job Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.container_name="db-init"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Database initialisation log messages from `db-init.sh`.

### Step 7.3 — Filter for Errors

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=WARNING
```

**Expected result:** Under normal operation, no warnings appear after initial startup.

---

## Phase 8 — Nextcloud API Exploration [MANUAL]

### Step 8.1 — Query the OCS API

```bash
# List all installed apps
curl -s \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v2.php/apps?format=json" \
  | jq '.ocs.data.apps | length'
```

### Step 8.2 — List Users

```bash
curl -s \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v1.php/cloud/users?format=json" \
  | jq '.ocs.data.users[]'
```

**Expected result:** Array containing `admin` and `testuser`.

### Step 8.3 — Check Storage Usage

```bash
curl -s \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v1.php/cloud/users/${ADMIN_USER}?format=json" \
  | jq '.ocs.data | {quota, used: .quota.used}'
```

**Expected result:** Quota and used storage for the admin user.

---

## Phase 9 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy**.

**Approximate undeploy duration:** 20–30 minutes.

> **Warning:** This permanently deletes all resources including the database, NFS volume, and all uploaded files. Export important data before undeploying: Administration settings > Export.

Resources provisioned by the `Services_GCP` module (VPC, GKE cluster, Cloud SQL instance) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Autopilot cluster preparation | 1 | Yes |
| Cloud SQL MySQL 8.0 (utf8mb4) | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Workload Identity and IAM bindings | 1 | Yes |
| Cloud Build image pipeline | 1 | Yes |
| Configure kubectl | 1 | No |
| Get external IP and confirm Nextcloud reachable | 2 | No |
| Retrieve admin credentials from Secret Manager | 2 | No |
| Log in to Nextcloud | 2 | No |
| Upload files and test WebDAV | 3 | No |
| Install Calendar and Contacts apps | 4 | No |
| Verify app persistence across pod restarts | 4 | No |
| Inspect pods, HPA, PDB, NFS volume | 5 | No |
| Run occ commands via kubectl exec | 6 | No |
| Review Cloud Logging | 7 | No |
| Query the OCS API | 8 | No |
| Undeploy infrastructure | 9 | Yes |
