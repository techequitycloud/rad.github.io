---
title: "Ghost on GKE — Lab Guide"
sidebar_label: "Ghost GKE"
---

# Ghost on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghost_GKE)**

## Overview

**Estimated time:** 3–4 hours

Ghost is an open-source publishing platform for creating professional online publications — blogs, newsletters, and membership sites. This lab deploys Ghost 6.x on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for content storage, and Redis caching.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment
- Cloud SQL MySQL 8.0 instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- Cloud Filestore (NFS) instance for shared content storage
- GCS Fuse volumes and Cloud Storage buckets
- Secret Manager secrets (admin password, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer), HPA, and PodDisruptionBudget
- Cloud Monitoring uptime checks and alert policies

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Obtain the external load balancer IP and confirm Ghost is reachable
- Configure kubectl with cluster credentials
- Complete the Ghost admin setup wizard
- Create and publish content (posts, pages, tags)
- Configure membership tiers and newsletter settings
- Explore themes and design settings
- Review logs in Cloud Logging and metrics in Cloud Monitoring
- Scale pods and observe HPA behaviour

---

## CLI and REST API Overview

This lab uses two tools to interact with the deployment:

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources |
| `kubectl` | Inspect pods, deployments, and services |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, GKE cluster, Cloud SQL instance, and NFS server).
3. Access to the RAD UI with permission to deploy modules in the target GCP project.
4. The following APIs enabled (Services_GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `file.googleapis.com`
5. `gcloud` authenticated: `gcloud auth application-default login`
6. `kubectl` installed and available in PATH.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Variables are configured in the RAD UI form before deploying. Use the table below to understand what each field controls.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for resources |
| `application_name` | No | `"ghost"` | Base name used in Kubernetes and GCP resource naming |
| `application_version` | No | `"6.14.0"` | Ghost container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `gke_cluster_name` | No | `""` | Target GKE cluster name (auto-discovered if empty) |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `cpu_limit` | No | `"2000m"` | CPU limit per Ghost container |
| `memory_limit` | No | `"4Gi"` | Memory limit per Ghost container |
| `db_name` | No | `"ghost"` | MySQL database name |
| `db_user` | No | `"ghost"` | MySQL database username |
| `enable_redis` | No | `true` | Enable Redis caching |
| `redis_host` | No | `""` | Redis host IP (defaults to NFS server IP) |
| `redis_port` | No | `"6379"` | Redis port |
| `enable_nfs` | No | `true` | Mount Cloud Filestore NFS for content |
| `nfs_mount_path` | No | `"/mnt/nfs"` | NFS mount path inside the container |
| `environment_variables` | No | SMTP defaults | SMTP settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM` |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |
| `resource_labels` | No | `{}` | Labels applied to all resources |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| VPC and networking (via Services_GCP) | Pre-provisioned |
| Cloud SQL MySQL instance creation | 8–12 min |
| GKE namespace and workload identity | 2–3 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Ghost pod start and health checks | 3–5 min |
| **Total** | **18–30 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `service_name` | Kubernetes service name |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `nfs_server_ip` | NFS server IP (Filestore) |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps using discovery commands:

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

# Discover the namespace (pattern: app<appname><tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appghost" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~ghost" \
  --format="value(name)" \
  --limit=1)

export GHOST_URL="http://${EXTERNAL_IP}"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Fetch Cluster Credentials

```bash
gcloud container clusters get-credentials \
  $(gcloud container clusters list --project=${PROJECT} --format="value(name)" | head -1) \
  --region=${REGION} \
  --project=${PROJECT}
```

**gcloud equivalent:**
```bash
gcloud container clusters list --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters"
```

**Expected result:** kubectl is configured and the context is set to your GKE cluster.

### Step 2.2 — Verify Ghost Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get service -n ${NAMESPACE}
```

**Expected result:** The Ghost pod shows `Running` status and `1/1` containers ready. The service shows an `EXTERNAL-IP` address matching the RAD UI output.

Wait until the external IP is assigned (may take 1–2 minutes after deployment):

```bash
kubectl get svc -n ${NAMESPACE} --watch
```

### Step 2.3 — Confirm Ghost is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}
```

**Expected result:** HTTP `200` (or a redirect to Ghost's front page).

---

## Phase 3 — Set Up Ghost Admin [MANUAL]

### Step 3.1 — Access the Admin Setup Wizard

Open a browser and navigate to:

```
http://${EXTERNAL_IP}/ghost
```

Ghost displays a setup wizard on the first visit.

**Expected result:** The Ghost setup wizard appears with fields for site title, admin name, email, and password.

### Step 3.2 — Retrieve Admin Credentials from Secret Manager

If admin credentials were pre-generated by the module, retrieve them:

```bash
# List Ghost-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~ghost"

# Retrieve admin password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

**gcloud equivalent (list secret versions):**
```bash
gcloud secrets versions list ${DB_SECRET} --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access"
```

**Expected result:** The admin password is returned as a base64-encoded payload. Decode with `base64 -d`.

### Step 3.3 — Complete Initial Setup

1. Enter a **site title** (e.g. "My Ghost Blog").
2. Enter your **admin name, email, and password** (or the password retrieved above).
3. Click **Create your account**.
4. Ghost redirects to the Admin dashboard.

**Expected result:** You are logged into the Ghost Admin panel at `/ghost/#/dashboard`.

---

## Phase 4 — Explore the Publishing Platform [MANUAL]

### Step 4.1 — Create a New Post

1. In the Admin panel, click **Posts** in the left sidebar.
2. Click **New post** (top-right button).
3. Enter a title and body text in the editor.
4. Click the settings gear (top-right) to add tags and a featured image.
5. Click **Publish** > **Publish** to confirm.

**Expected result:** The post appears in the **Posts** list with status `Published`. The public site at `http://${EXTERNAL_IP}` shows the post on the front page.

### Step 4.2 — Explore Pages and Tags

1. Navigate to **Pages** in the sidebar — create a static page (e.g. "About").
2. Navigate to **Tags** — create a tag and associate it with a post.

**Expected result:** Tags appear on the front page; the static page is accessible via its slug.

### Step 4.3 — View the Public Site

Open `http://${EXTERNAL_IP}` in a browser.

**Expected result:** The default Ghost Casper theme renders with your published post visible.

---

## Phase 5 — Members and Newsletter Setup [MANUAL]

### Step 5.1 — Configure Membership Settings

1. In Ghost Admin, navigate to **Settings** (gear icon) > **Members**.
2. Review the **Access** setting (Free / Paid tiers).
3. Enable the **Members feature** if not already enabled.

**Expected result:** The Members section is active and shows zero subscribers initially.

### Step 5.2 — Explore Newsletter Settings

1. Navigate to **Settings** > **Email newsletter**.
2. Review the **Sender name** and **Reply-to address** fields.
3. Note the SMTP configuration section — it uses the `SMTP_HOST`, `SMTP_PORT`, and `SMTP_USER` values set in `environment_variables`.

**gcloud — verify SMTP env vars are injected:**
```bash
kubectl describe deployment -n ${NAMESPACE} | grep -A5 "SMTP_HOST"
```

**Expected result:** SMTP settings reflect the values you configured. For newsletters to send, a valid SMTP provider (e.g. Mailgun, SendGrid) must be configured.

### Step 5.3 — Review the Subscription Portal

1. Navigate to **Settings** > **Portal**.
2. Click **Customise** to adjust the sign-up form appearance.
3. Click **Preview** to see the subscription portal.

**Expected result:** A styled sign-up portal overlay appears. Members can subscribe using their email address.

---

## Phase 6 — Theme and Customisation [MANUAL]

### Step 6.1 — Explore Themes

1. Navigate to **Settings** > **Theme**.
2. The default **Casper** theme is active.
3. Click **Change theme** to browse or upload a custom theme.

**Expected result:** The Themes page lists available themes. Casper is active with a tick icon.

### Step 6.2 — Explore Design Settings

1. Navigate to **Settings** > **Design**.
2. Adjust the **accent colour**, **logo**, and **cover image**.
3. Preview changes on the public site.

**Expected result:** Changes appear immediately on the public front page after saving.

### Step 6.3 — Ghost Handlebars Templates (Overview)

Ghost uses the [Handlebars](https://handlebarsjs.com/) templating language. Key template files:
- `index.hbs` — front page
- `post.hbs` — individual post layout
- `default.hbs` — base wrapper

Custom themes are stored in the Ghost content directory, which is on the NFS volume at `${NFS_MOUNT_PATH}/themes/`.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Ghost Application Logs

In the Google Cloud Console, navigate to **Logging > Logs Explorer** (`https://console.cloud.google.com/logs`).

Use the following query to view Ghost pod logs:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="ghost"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, jsonPayload.message)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Ghost startup logs appear, including database connection messages and the Ghost version banner. Look for lines like `Ghost boot 6.x.x` to confirm successful startup.

### Step 7.2 — Filter for Errors

Use the query filter `severity>=ERROR` to surface warnings:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=ERROR
```

**Expected result:** Under normal operation, no critical errors should appear after startup completes.

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### Step 8.1 — View Service Metrics

Navigate to **Monitoring > Metrics Explorer** (`https://console.cloud.google.com/monitoring/metrics-explorer`).

Useful metrics for GKE Ghost deployments:

| Metric | Description |
|---|---|
| `kubernetes.io/container/cpu/usage_time` | CPU usage per container |
| `kubernetes.io/container/memory/used_bytes` | Memory usage per container |
| `kubernetes.io/pod/restart_count` | Pod restart count |
| `loadbalancing.googleapis.com/https/request_count` | Requests per second |

**gcloud equivalent (list metric descriptors):**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project=${PROJECT}
```

**Expected result:** Metrics charts show Ghost CPU and memory usage. With no traffic, CPU should be near zero and memory around 200–400 MB.

### Step 8.2 — Review Uptime Checks

Navigate to **Monitoring > Uptime checks**.

**Expected result:** A preconfigured uptime check (if `uptime_check_config.enabled = true` in variables) runs every 60 seconds and shows **Passing** status.

---

## Phase 9 — Scaling [MANUAL]

### Step 9.1 — Check Current HPA Status

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** The HPA shows current replicas, minimum (`1`), maximum (`5`), and current CPU utilisation.

### Step 9.2 — Manually Scale the Deployment

Scale to 2 replicas manually:

```bash
kubectl scale deployment ghost -n ${NAMESPACE} --replicas=2
```

Observe the new pod starting:

```bash
kubectl get pods -n ${NAMESPACE} --watch
```

**gcloud equivalent (via GKE Workloads console):**
Navigate to **Kubernetes Engine > Workloads**, select the Ghost deployment, click **Actions > Scale**.

**REST API equivalent:**
```bash
curl -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json-patch+json" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}/namespaces/${NAMESPACE}/deployments/ghost" \
  -d '[{"op": "replace", "path": "/spec/replicas", "value": 2}]'
```

**Expected result:** A second Ghost pod starts within 60–90 seconds. Both pods share the same NFS content volume.

### Step 9.3 — Return to Minimum Replicas

```bash
kubectl scale deployment ghost -n ${NAMESPACE} --replicas=1
```

**Expected result:** One pod terminates gracefully; the remaining pod continues serving traffic.

---

## Phase 10 — Undeploy Infrastructure [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–25 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database and NFS content. Ensure you have exported any content you wish to keep (Ghost Admin > Settings > Labs > Export).

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE namespace and workload provisioning | 1 | Yes |
| Cloud SQL MySQL 8.0 database | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Workload Identity and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify Ghost pod running | 2 | No |
| Ghost admin setup wizard | 3 | No |
| Retrieve admin credentials from Secret Manager | 3 | No |
| Create and publish posts | 4 | No |
| Configure membership and newsletter | 5 | No |
| Explore themes and design settings | 6 | No |
| Review application logs | 7 | No |
| Review Cloud Monitoring metrics | 8 | No |
| Scale pod replicas | 9 | No |
| Undeploy infrastructure | 10 | Yes |
