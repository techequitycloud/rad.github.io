# Nextcloud on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Nextcloud_GKE)**

## Overview

**Estimated time:** 3–4 hours

Nextcloud is the leading open-source self-hosted file sync and collaboration platform, used by governments, healthcare providers, and enterprises as a GDPR-compliant alternative to Google Drive and OneDrive. This lab deploys Nextcloud 30 on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for persistent config and data storage, and Redis caching. GKE Autopilot provides managed Kubernetes with horizontal pod autoscaling and StatefulSet support.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (or StatefulSet)
- Cloud SQL MySQL 8.0 instance, database (utf8mb4), and user (mysql_native_password)
- Cloud SQL Auth Proxy sidecar injection (binds on localhost:3306)
- Cloud Filestore (NFS) instance for shared `config/` and `data/` persistence
- GCS storage bucket provisioning
- Secret Manager secrets (admin password, DB password, root password)
- Artifact Registry repository and Cloud Build custom image pipeline (PHP limits baked in)
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer), HPA, and PodDisruptionBudget
- Cloud Monitoring uptime checks and alert policies
- Automated backup CronJob

### What You Do Manually

- Configure kubectl with cluster credentials
- Confirm Nextcloud is reachable at the external LoadBalancer IP
- Retrieve admin credentials from Secret Manager
- Log in and explore Files, Calendar, and Contacts apps
- Upload files and test WebDAV
- Run `occ` commands via `kubectl exec`
- Review pod logs and inspect Kubernetes resources
- Verify NFS persistence across pod restarts

---

## CLI Tools

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, configure kubectl, view cluster logs |
| `kubectl` | Inspect pods, view logs, exec into containers |
| `curl` | Test Nextcloud status, WebDAV, and OCS API endpoints |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, Cloud SQL instance, GKE cluster, and NFS server).
3. `gcloud` and `kubectl` installed and authenticated.
4. Access to the RAD UI with permission to deploy modules.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"30"` | Nextcloud version tag |
| `nextcloud_admin_user` | No | `"admin"` | Admin account username |
| `php_memory_limit` | No | `"512M"` | PHP memory limit (baked into image) |
| `upload_max_filesize` | No | `"512M"` | Max upload file size |
| `post_max_size` | No | `"512M"` | Max POST body size |
| `cpu_limit` | No | `"2000m"` | CPU per pod |
| `memory_limit` | No | `"4Gi"` | Memory per pod |
| `min_instance_count` | No | `1` | Minimum HPA replicas |
| `max_instance_count` | No | `5` | Maximum HPA replicas |
| `application_database_name` | No | `"gkeappdb"` | MySQL database name |
| `application_database_user` | No | `"gkeappuser"` | MySQL database username |
| `enable_redis` | No | `true` | Enable Redis caching |
| `enable_nfs` | No | `true` | Mount NFS for persistence |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |

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

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `external_ip` | External LoadBalancer IP for Nextcloud |
| `service_url` | Full service URL |
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

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace
export NAMESPACE=$(kubectl get namespaces \
  --no-headers -o custom-columns=NAME:.metadata.name \
  | grep nextcloud | head -1)

echo "Cluster: ${CLUSTER}"
echo "Namespace: ${NAMESPACE}"
```

### Step 1.4 — Confirm Pods Are Running

```bash
kubectl get pods -n ${NAMESPACE} -o wide
```

**Expected result:** One or more `nextcloud-*` pods with status `Running`. If pods are in `Pending`, GKE Autopilot is provisioning nodes — wait 2–3 minutes.

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the External IP

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
  --format="table(name, IPAddress, region)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  | jq '.status'
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
  "version": "30.0.x",
  "versionstring": "30.0.x"
}
```

If `"installed": false`, check pod logs:
```bash
kubectl logs -n ${NAMESPACE} -l app=nextcloud -c nextcloud --tail=100 | grep -E "install|error|ERROR"
```

### Step 2.3 — Retrieve Admin Credentials

```bash
ADMIN_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~admin-password" \
  --format="value(name)" \
  --limit=1)

ADMIN_PASS=$(gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project=${PROJECT})

echo "Admin password retrieved"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Anextcloud" \
  | jq '.secrets[].name'
```

**Expected result:** 24-character alphanumeric admin password.

### Step 2.4 — Log In

Open a browser and navigate to `${SERVICE_URL}`.

- **Username:** your `nextcloud_admin_user` value (default: `admin`)
- **Password:** retrieved in Step 2.3

**Expected result:** Nextcloud Files dashboard appears.

---

## Phase 3 — Explore the Files App [MANUAL]

### Step 3.1 — Upload a File

1. Click **+** → **Upload file** in the Files app.
2. Upload a local file.

**Expected result:** File appears in the list. It is stored on NFS at `/mnt/nfs/nextcloud-data`.

### Step 3.2 — Test WebDAV

```bash
ADMIN_USER="admin"

# List files via WebDAV PROPFIND
curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -X PROPFIND \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/" \
  -H "Depth: 1" 2>&1 | grep "<d:href>"
```

**Expected result:** XML response with HTTP 207 Multi-Status listing files.

### Step 3.3 — Upload via WebDAV

```bash
echo "GKE lab WebDAV test" > /tmp/gke-webdav.txt

curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -T /tmp/gke-webdav.txt \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/gke-webdav.txt"
```

**Expected result:** HTTP 201 Created. File visible in the Nextcloud UI.

### Step 3.4 — Share a File

1. Hover over a file → click **Share** icon.
2. Click **Share link** and copy the URL.

```bash
curl -sI "PASTE_SHARE_LINK" | head -3
```

**Expected result:** HTTP 200 or redirect response.

---

## Phase 4 — Install Apps [MANUAL]

### Step 4.1 — Install Calendar and Contacts

1. Click the grid icon (top-right) → **Apps**.
2. Install **Calendar** and **Contacts**.

**Expected result:** Both apps available in the navigation bar.

### Step 4.2 — Verify App Persistence Across Pod Restarts

```bash
kubectl rollout restart deployment -n ${NAMESPACE}
kubectl rollout status deployment -n ${NAMESPACE}
```

Navigate back to Nextcloud. Apps are still installed because the app data is on NFS.

**Expected result:** Calendar and Contacts remain installed after the pod restart.

---

## Phase 5 — Inspect Kubernetes Resources [MANUAL]

### Step 5.1 — Examine the Deployment

```bash
kubectl describe deployment -n ${NAMESPACE}
```

**Expected result:** Two containers per pod: `nextcloud` (main) and `cloudsql-proxy` (sidecar). NFS volume mounted at `/mnt/nfs`.

### Step 5.2 — Check the HPA

```bash
kubectl get hpa -n ${NAMESPACE}
kubectl describe hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows min/max replicas and current CPU utilisation.

### Step 5.3 — Check the Pod Disruption Budget

```bash
kubectl get pdb -n ${NAMESPACE}
```

**Expected result:** PDB with `MIN AVAILABLE = 1` ensuring at least one pod remains during node upgrades.

### Step 5.4 — Inspect NFS Volume

```bash
POD=$(kubectl get pods -n ${NAMESPACE} -o name | grep nextcloud | head -1)

# Check NFS mount
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- ls -la /mnt/nfs/

# Verify config.php is on NFS via symlink
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- ls -la /var/www/html/config/
```

**Expected result:**
- `/mnt/nfs/nextcloud-config/` and `/mnt/nfs/nextcloud-data/` directories exist.
- `/var/www/html/config` is a symlink to `/mnt/nfs/nextcloud-config`.
- `config.php` is present in the NFS config directory.

### Step 5.5 — View Cloud SQL Auth Proxy Logs

```bash
kubectl logs -n ${NAMESPACE} ${POD} -c cloudsql-proxy --tail=20
```

**Expected result:** Auth Proxy startup and connection accept messages. The proxy listens on `127.0.0.1:3306` (the `MYSQL_HOST` value in the Nextcloud container).

---

## Phase 6 — Administration [MANUAL]

### Step 6.1 — Run OCC Commands

```bash
POD=$(kubectl get pods -n ${NAMESPACE} -o name | grep nextcloud | head -1)

# Check installation status
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- php occ status
```

**Expected result:**
```
  - installed: true
  - version: 30.0.x
  - edition: Community
```

### Step 6.2 — List Enabled Apps

```bash
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- \
  php occ app:list --enabled 2>&1 | head -20
```

**Expected result:** Enabled apps including `files`, `calendar`, `contacts`.

### Step 6.3 — Add Missing Database Indices (Maintenance)

```bash
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- \
  php occ db:add-missing-indices
```

**Expected result:** Index check completes. New indices are added if missing.

### Step 6.4 — Create a User via OCC

```bash
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- \
  php occ user:add --password-from-env occuser
```

> Note: Set `OC_PASS` environment variable first:
```bash
kubectl exec -n ${NAMESPACE} -it ${POD} -c nextcloud -- \
  env OC_PASS=MySecurePassword123 php occ user:add --password-from-env occuser
```

**Expected result:** User `occuser` created and visible in the Nextcloud Users panel.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Nextcloud Pod Logs

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
  'resource.type="k8s_container" AND resource.labels.cluster_name="'${CLUSTER}'" AND resource.labels.namespace_name="'${NAMESPACE}'" AND resource.labels.container_name="nextcloud"' \
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

**Expected result:** Startup logs including:
- `Nextcloud Container Startup`
- `NFS mount detected at /mnt/nfs`
- `MYSQL_HOST set from DB_HOST: 127.0.0.1`
- `OVERWRITECLIURL` and `NEXTCLOUD_TRUSTED_DOMAINS` values

### Step 7.2 — View db-init Job Logs

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.container_name="db-init"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:**
- `✓ MySQL is ready`
- `✓ Database created`
- `✓ User created with privileges`
- `✓ Nextcloud database initialization complete`
- `✓ Cloud SQL Proxy shutdown signal sent`

### Step 7.3 — Filter for Errors

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=WARNING
```

**Expected result:** No warnings under normal operation.

---

## Phase 8 — Nextcloud API Exploration [MANUAL]

### Step 8.1 — Query the OCS API

```bash
# List installed apps
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

**Expected result:** Array of users including `admin`, `testuser`, `occuser`.

### Step 8.3 — Get Server Capabilities

```bash
curl -s \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v1.php/cloud/capabilities?format=json" \
  | jq '.ocs.data.capabilities | keys[]'
```

**Expected result:** List of enabled Nextcloud capability modules.

---

## Phase 9 — Undeploy [AUTOMATED]

When finished, return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 20–30 minutes.

> **Warning:** Undeploy permanently deletes the database, NFS volume, and all uploaded files. Export important data before undeploying: Administration settings > Export.

Resources provisioned by `Services GCP` (VPC, GKE cluster, Cloud SQL instance) must be undeployed separately.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Autopilot namespace and workload | 1 | Yes |
| Cloud SQL MySQL 8.0 (utf8mb4) | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Workload Identity and IAM | 1 | Yes |
| Cloud Build image pipeline | 1 | Yes |
| Configure kubectl | 1 | No |
| Get external IP | 2 | No |
| Confirm `/status.php` response | 2 | No |
| Retrieve admin credentials | 2 | No |
| Log in and explore Files | 3 | No |
| Test WebDAV upload and listing | 3 | No |
| Install Calendar and Contacts | 4 | No |
| Verify persistence after pod restart | 4 | No |
| Inspect pods, HPA, PDB, NFS symlink | 5 | No |
| Run occ commands via kubectl exec | 6 | No |
| Review Cloud Logging | 7 | No |
| Query OCS API | 8 | No |
| Undeploy infrastructure | 9 | Yes |
