---
title: "WordPress on GKE — Lab Guide"
sidebar_label: "Wordpress GKE Lab"
---

# WordPress on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wordpress_GKE)**

## Overview

Deploy WordPress, the world's most popular CMS, to Google Kubernetes Engine (GKE) Autopilot with managed Cloud SQL (MySQL 8.0), Filestore NFS shared storage, GCS Fuse volumes, Redis object caching, and full observability via Cloud Logging and Cloud Monitoring.

**Estimated time:** 1–2 hours

### What the Module Automates

- GKE namespace, Kubernetes Deployment, and LoadBalancer Service
- Cloud SQL MySQL 8.0 instance, database, and user
- Cloud SQL Auth Proxy sidecar injection for secure socket connections
- Cloud Filestore (NFS) volume provisioned and mounted into pods
- GCS bucket for data storage with optional GCS Fuse mounts
- Artifact Registry repository and Cloud Build image build
- Secret Manager secrets for database password and WordPress auth keys
- Workload Identity binding for pod-level GCP API access
- Static external IP reservation for the LoadBalancer
- Kubernetes HPA (min/max replica configuration)
- Cloud Monitoring uptime checks and notification channels
- Automated database backup CronJob (daily at 02:00 UTC by default)

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Configure `kubectl` context to point at the GKE cluster
- Open the WordPress URL in a browser and complete the 5-minute install wizard (if triggered)
- Log in to wp-admin and explore the dashboard
- Create content, upload media, and install plugins
- Verify persistent storage across pod restarts
- Explore Cloud Logging and Cloud Monitoring dashboards
- Test horizontal pod scaling

---

## CLI and REST API Overview

Set these shell variables before running any `gcloud` or `curl` commands in this guide:

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

# Discover the namespace (pattern: appwordpress<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appwordpress" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~wordpress" \
  --format="value(name)" \
  --limit=1)
```

---

## Prerequisites

| Requirement | Details |
|---|---|
| gcloud CLI | Authenticated (`gcloud auth application-default login`) |
| kubectl | Installed and available on `$PATH` |
| GCP project | Billing enabled |
| Services_GCP | Must be deployed first — provides VPC, Cloud SQL instance, Filestore, and GKE cluster |
| RAD UI access | Permission to deploy modules in the target GCP project |
| Service account | `roles/owner` on the target project (or a tightly scoped equivalent) |

---

## Phase 1 — Deploy [AUTOMATED]

### Step 1.1 — Configure Variables

In the RAD UI, open the Wordpress GKE module and fill in the deployment form. The table below covers the key variables you are likely to customise.

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | GCP project ID. Must match the project where Services_GCP is deployed. |
| `deployment_id` | _(auto-generated)_ | Short suffix appended to all resource names. Leave empty to auto-generate. |
| `region` | `"us-central1"` | GCP region for all resources. |
| `tenant_deployment_id` | `"demo"` | Short environment label (e.g. `"prod"`, `"dev"`). |
| `application_name` | `"wordpress"` | Base name for the Kubernetes deployment, secrets, and registry. |
| `application_version` | `"latest"` | Container image version tag. |
| `deploy_application` | `true` | Set to `false` to provision infrastructure only without deploying the pod. |
| `min_instance_count` | `1` | Minimum number of WordPress pod replicas. |
| `max_instance_count` | `1` | Maximum number of WordPress pod replicas. |
| `cpu_limit` | `"1000m"` | CPU limit per WordPress container (millicores). |
| `memory_limit` | `"2Gi"` | Memory limit per WordPress container. |
| `php_memory_limit` | `"512M"` | PHP memory limit inside the container. |
| `upload_max_filesize` | `"64M"` | Maximum single file upload size. |
| `post_max_size` | `"64M"` | Maximum HTTP POST body size (must be >= `upload_max_filesize`). |
| `application_database_name` | `"wp"` | MySQL database name. |
| `application_database_user` | `"wp"` | MySQL database user. |
| `enable_nfs` | `true` | Mount a Cloud Filestore NFS share into the pod for wp-content persistence. |
| `nfs_mount_path` | `"/mnt/nfs"` | Container path where the NFS share is mounted. |
| `enable_redis` | `true` | Enable Redis object caching for WordPress. |
| `redis_host` | `""` | Redis hostname (leave empty to use auto-discovered Memorystore). |
| `gke_cluster_name` | `""` | GKE cluster name. Leave empty to auto-discover. |
| `service_type` | `"LoadBalancer"` | Kubernetes Service type (use `LoadBalancer` for external access). |
| `session_affinity` | `"ClientIP"` | Route requests from the same IP to the same pod. |
| `reserve_static_ip` | `true` | Reserve a static external IP for the LoadBalancer. |
| `backup_schedule` | `"0 2 * * *"` | Cron schedule for automated database backups (UTC). |
| `backup_retention_days` | `7` | Number of days to retain backup files in GCS. |
| `support_users` | `[]` | Email addresses for monitoring alert notifications. |

### Step 1.2 — Deploy

Click **Deploy** in the RAD UI.

| Operation | Typical duration |
|---|---|
| Cloud SQL provisioning (first deploy) | 15–30 minutes |
| GKE workload rollout | 3–6 minutes |
| Subsequent updates | 3–8 minutes |

> **Note:** On the very first deployment of a new GKE cluster, `kubernetes_ready` may be `false` because the cluster endpoint is not yet reachable. Return to the RAD UI and click **Update** to complete Kubernetes resource deployment.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | WordPress site URL |
| `service_external_ip` | LoadBalancer external IP |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Generated deployment suffix |
| `resource_prefix` | Prefix used for all GCP resource names |
| `nfs_mount_path` | NFS mount path inside the container |
| `storage_buckets` | GCS bucket names |
| `container_registry` | Artifact Registry repository |

Run the shell variable setup block from the CLI and REST API Overview section above before continuing.

---

## Phase 2 — Configure kubectl Access [MANUAL]

### Step 2.1 — Get Cluster Credentials

Auto-discover the GKE cluster managed by Services_GCP:

```bash
# List all clusters in the project
gcloud container clusters list \
  --project=${PROJECT} \
  --format='value(name, location)'

# Fetch credentials
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters" \
  | jq '.clusters[].name'
```

**Expected result:** `kubectl` is configured to connect to the cluster. `~/.kube/config` is updated.

### Step 2.2 — Verify the WordPress Pod

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One pod with a name like `wordpress-<hash>` in `Running` state.

```
NAME                         READY   STATUS    RESTARTS   AGE
wordpress-7d9f8c9bc-xk4mp   2/2     Running   0          5m
```

> The pod shows `2/2` containers because the Cloud SQL Auth Proxy runs as a sidecar.

```bash
# Check pod logs
kubectl logs -n ${NAMESPACE} -l app=wordpress -c wordpress --tail=50

# Check Cloud SQL Auth Proxy sidecar logs
kubectl logs -n ${NAMESPACE} -l app=wordpress -c cloud-sql-proxy --tail=20
```

### Step 2.3 — Verify the LoadBalancer

```bash
kubectl get service -n ${NAMESPACE}
```

**Expected result:** The service shows an `EXTERNAL-IP`. This matches the `service_external_ip` output shown in the RAD UI deployment panel.

```
NAME        TYPE           CLUSTER-IP    EXTERNAL-IP     PORT(S)        AGE
wordpress   LoadBalancer   10.96.0.100   34.120.45.67    80:32041/TCP   5m
```

If `EXTERNAL-IP` shows `<pending>`, wait 1–2 minutes and run the command again.

---

## Phase 3 — Complete WordPress Setup [MANUAL]

### Step 3.1 — Open WordPress in a Browser

Navigate to the service URL:

```bash
echo "http://${EXTERNAL_IP}"
```

Open the URL in your browser.

**Expected result:** You see the WordPress 5-minute install page, or the WordPress homepage if the install was completed automatically.

### Step 3.2 — Complete the Install Wizard (If Required)

If the install wizard appears, fill in:

| Field | Value |
|---|---|
| Site Title | Any title (e.g. `My WordPress Site`) |
| Username | Choose an admin username |
| Password | Use a strong password or note the generated one |
| Your Email | Your email address |
| Search Engine Visibility | Leave unchecked for a lab |

Click **Install WordPress**.

### Step 3.3 — Retrieve Admin Credentials from Secret Manager

The WordPress admin password is stored in Secret Manager. Retrieve it:

```bash
# List secrets to find the admin password secret
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~wordpress" \
  --format='value(name)'

# Retrieve the admin password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  | jq -r '.payload.data' | base64 -d
```

### Step 3.4 — Log in to wp-admin

Navigate to:

```
http://<EXTERNAL_IP>/wp-admin
```

Log in with the admin username and the password retrieved in Step 3.3.

**Expected result:** The WordPress administration dashboard appears.

---

## Phase 4 — Explore WordPress Admin [MANUAL]

### Step 4.1 — Dashboard Overview

From the wp-admin dashboard, explore the left-hand menu:

- **Posts** — create and manage blog posts
- **Media** — upload and manage files
- **Pages** — static pages
- **Plugins** — install and manage plugins
- **Appearance** — themes and customiser
- **Settings** — general site configuration

### Step 4.2 — Create a Test Post

1. Navigate to **Posts > Add New**.
2. Enter a title and some body text.
3. Click **Publish**.
4. Click **View Post** to confirm the post is publicly accessible.

### Step 4.3 — Upload a Media File

1. Navigate to **Media > Add New**.
2. Upload an image file (PNG or JPEG, under 64 MB by default).
3. Click the uploaded file to view its details.
4. Note the file URL — media files are served from the NFS-backed wp-content directory.

**Verify the file reached NFS:**

```bash
# Check NFS mount inside the pod
kubectl exec -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  -c wordpress -- ls /mnt/nfs/
```

**Verify the GCS data bucket:**

```bash
gcloud storage ls --project=${PROJECT} | grep wordpress
```

### Step 4.4 — Install a Plugin

1. Navigate to **Plugins > Add New**.
2. Search for `Hello Dolly` (a lightweight test plugin).
3. Click **Install Now**, then **Activate**.
4. Confirm the plugin appears under **Plugins > Installed Plugins**.

### Step 4.5 — Explore Theme Editor

1. Navigate to **Appearance > Themes**.
2. Browse available themes.
3. Click **Theme Details** on any theme to inspect it.

---

## Phase 5 — Explore Persistent Storage [MANUAL]

### Step 5.1 — Verify GCS Bucket for Data Storage

```bash
# List GCS buckets created for this deployment
gcloud storage ls --project=${PROJECT} | grep wordpress

# List contents of the data bucket (replace BUCKET_NAME with the value from RAD UI outputs)
gcloud storage ls gs://BUCKET_NAME/
```

**REST API equivalent:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=wordpress" \
  | jq '.items[].name'
```

### Step 5.2 — Inspect the NFS Mount

```bash
# Describe the Filestore instance
gcloud filestore instances list \
  --project=${PROJECT} \
  --format='table(name,networks[0].ipAddresses[0],fileShares[0].name,state)'

# Check PVC status in the namespace
kubectl get pvc -n ${NAMESPACE}
```

**Expected PVC output:**
```
NAME           STATUS   VOLUME         CAPACITY   ACCESS MODES   STORAGECLASS   AGE
wordpress-nfs  Bound    pvc-abc12345   1Ti        RWX            standard       10m
```

```bash
# View what is mounted inside the pod
kubectl exec -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  -c wordpress -- df -h | grep nfs
```

### Step 5.3 — Verify Storage Persistence

Confirm that the media file uploaded in Phase 4 persists after a pod restart:

```bash
# Delete the pod to trigger a restart
kubectl delete pod -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')

# Wait for the new pod to be Running
kubectl get pods -n ${NAMESPACE} -w
```

Navigate back to **Media** in wp-admin. The uploaded file should still be present.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View WordPress Logs in Logs Explorer

Open the Google Cloud Console and navigate to **Logging > Logs Explorer**, or use the `gcloud` CLI:

```bash
# View WordPress application logs (last 50 lines)
gcloud logging read \
  "resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE} AND resource.labels.container_name=wordpress" \
  --project=${PROJECT} \
  --limit=50 \
  --format='value(timestamp, textPayload)'
```

### Step 6.2 — View nginx / PHP-FPM Logs

```bash
# Access logs (HTTP requests)
gcloud logging read \
  "resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE} AND resource.labels.container_name=wordpress AND textPayload:\"GET\"" \
  --project=${PROJECT} \
  --limit=30

# PHP error logs
gcloud logging read \
  "resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE} AND resource.labels.container_name=wordpress AND (textPayload:\"PHP\" OR textPayload:\"Fatal\")" \
  --project=${PROJECT} \
  --limit=20
```

### Step 6.3 — View Cloud SQL Auth Proxy Logs

```bash
gcloud logging read \
  "resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE} AND resource.labels.container_name=cloud-sql-proxy" \
  --project=${PROJECT} \
  --limit=20
```

**REST API equivalent (Logs Explorer):**
```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=k8s_container AND resource.labels.namespace_name=${NAMESPACE}\",
    \"pageSize\": 20
  }" | jq '.entries[].textPayload'
```

---

## Phase 7 — Explore Cloud Monitoring [MANUAL]

### Step 7.1 — GKE Dashboards

In the Google Cloud Console, navigate to **Monitoring > Dashboards** and open the **GKE** dashboard. Explore:

- Pod CPU and memory utilisation
- Node-level metrics
- Container restart counts

### Step 7.2 — Uptime Checks

```bash
# List uptime checks configured for this deployment
gcloud monitoring uptime list-configs \
  --project=${PROJECT} \
  --format='table(displayName, httpCheck.path, period, selectedRegions)'
```

The WordPress site URL is checked every 60 seconds from multiple global locations. An alert fires if the endpoint becomes unreachable.

### Step 7.3 — Pod Metrics via kubectl

```bash
# Pod resource usage (requires Metrics Server — available by default on GKE Autopilot)
kubectl top pods -n ${NAMESPACE}

# Node-level resource summary
kubectl top nodes
```

### Step 7.4 — HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected output:**

```
NAME        REFERENCE              TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
wordpress   Deployment/wordpress   15%/80%   1         1         1          15m
```

**REST API equivalent:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=metric.type%3D%22kubernetes.io%2Fcontainer%2Fcpu%2Frequest_utilization%22&interval.endTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)&interval.startTime=$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
  | jq '.timeSeries[0].points[0].value'
```

---

## Phase 8 — Scaling and Performance [MANUAL]

### Step 8.1 — Scale WordPress Pods

To test horizontal scaling, return to the RAD UI, update `max_instance_count` to `3`, and click **Update**. Then monitor the rollout:

```bash
kubectl rollout status deployment/wordpress -n ${NAMESPACE}
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** A second and third WordPress pod start within 60–90 seconds.

Alternatively, patch the deployment directly for temporary testing (the RAD UI will revert this on the next update):

```bash
kubectl scale deployment wordpress \
  --replicas=2 \
  -n ${NAMESPACE}

kubectl get pods -n ${NAMESPACE} -w
```

### Step 8.2 — Verify Session Persistence

Because `session_affinity = "ClientIP"`, requests from the same browser are routed to the same pod. Verify this by checking which pod handled your request:

```bash
# Watch access logs across all pods
kubectl logs -n ${NAMESPACE} -l app=wordpress -c wordpress --follow --tail=5
```

Open the WordPress site in your browser and perform a few actions. All log output should appear from the same pod.

### Step 8.3 — Test Concurrent Access

Use `curl` to send a burst of requests and verify WordPress returns HTTP 200:

```bash
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "Request ${i}: HTTP %{http_code}\n" http://${EXTERNAL_IP}/
done
```

**Expected result:** All requests return `HTTP 200`.

### Step 8.4 — Scale Back Down

Return to the RAD UI, set `max_instance_count` back to `1`, and click **Update**.

---

## Phase 9 — Undeploy [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

> **Warning:** This permanently deletes the GKE namespace, Cloud SQL database, Filestore instance, GCS buckets, and all associated secrets. Ensure any data you want to keep has been exported or backed up before undeploying.

**Typical duration:** 10–20 minutes

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Action | Mode |
|---|---|---|
| Phase 1 | Deploy infrastructure via RAD UI | Automated |
| Phase 2 | Configure kubectl and verify pod health | Manual |
| Phase 3 | Complete WordPress setup and log in via wp-admin | Manual |
| Phase 4 | Explore WordPress admin: posts, media, plugins, themes | Manual |
| Phase 5 | Verify NFS persistence and GCS storage | Manual |
| Phase 6 | Explore Cloud Logging: WordPress, nginx, PHP-FPM logs | Manual |
| Phase 7 | Explore Cloud Monitoring: dashboards, uptime checks, pod metrics | Manual |
| Phase 8 | Scale pods, verify session affinity, test concurrency | Manual |
| Phase 9 | Undeploy all infrastructure via RAD UI | Automated |

| Resource | Notes |
|---|---|
| GKE Autopilot | Serverless — billed by actual pod resource consumption |
| Cloud SQL MySQL 8.0 | Managed — patching and backups handled by GCP |
| Cloud Filestore NFS | Shared persistent storage across all WordPress pods |
| Cloud Storage | GCS bucket for data and backups |
| Secret Manager | Database password and WordPress auth keys |
| Cloud Build | Builds the custom WordPress Docker image |
| Artifact Registry | Stores the built container image |
| Cloud Monitoring | Uptime checks, HPA metrics, alerting |
