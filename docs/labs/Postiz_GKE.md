---
title: "Postiz on GKE \u2014 Lab Guide"
---

# Postiz on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Postiz_GKE)**

## Overview

**Estimated time:** 1–2 hours

Postiz is an open-source social media scheduling platform supporting 20+ platforms including X/Twitter, LinkedIn, Instagram, TikTok, and Facebook. This lab deploys Postiz on GKE Autopilot with managed PostgreSQL 15 (Cloud SQL), Redis (Memorystore) for job queues and pub/sub, and GCS for media uploads.

### What the Module Automates

- GKE Autopilot cluster discovery and namespace provisioning
- Cloud SQL PostgreSQL 15 instance, database, and user creation
- JWT secret and database password generation in Secret Manager
- GCS bucket for media uploads
- Workload Identity binding for pod-level IAM
- Artifact Registry repository and Cloud Build image pipeline
- Kubernetes Deployment, Service, HPA, and PodDisruptionBudget
- Cloud Logging and Cloud Monitoring integration
- Redis (Memorystore) connection wiring via environment variables

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Register the admin account and explore the dashboard
- Connect social media accounts via OAuth
- Create, schedule, and manage posts
- Explore the Calendar and Analytics views
- Configure team collaboration settings
- Query Cloud Logging for application and worker logs
- Review Cloud Monitoring metrics and Redis queue depth

---

## CLI and REST API Overview

This lab uses the following CLIs:

| Tool | Purpose |
|---|---|
| `gcloud` | GCP resource management, log queries, secret access |
| `kubectl` | Kubernetes pod inspection, log streaming, exec |

Configure:

```bash
# Authenticate gcloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Get GKE credentials
gcloud container clusters get-credentials CLUSTER_NAME \
  --region REGION \
  --project YOUR_PROJECT_ID
```

---

## Prerequisites

Before deploying this module:

1. **Services GCP deployed** — this module depends on `Services GCP` for the VPC, Cloud SQL instance, Memorystore Redis, and GKE Autopilot cluster.
2. **GCP project** with billing enabled.
3. **gcloud CLI** authenticated with Owner or Editor role on the project.
4. **kubectl** installed and configured.
5. **Access to the RAD UI** with permission to deploy modules in the target GCP project.
6. **Redis host** — obtain the Memorystore Redis host IP from the `Services GCP` outputs and set `redis_host`.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Postiz GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (e.g., `my-project-123`) |
| `deployment_id` | No | auto-generated | Short alphanumeric suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `postiz` | Internal identifier used for Kubernetes resources and secrets |
| `application_version` | No | `latest` | Container image tag |
| `deploy_application` | No | `true` | Set to `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum HPA pod replicas |
| `max_instance_count` | No | `5` | Maximum HPA pod replicas |
| `container_resources` | No | `{cpu_limit="2000m", memory_limit="2Gi"}` | CPU and memory limits per pod |
| `gke_cluster_name` | No | `""` | Target GKE cluster name; auto-discovered when empty |
| `db_name` | No | `postiz` | PostgreSQL database name |
| `db_user` | No | `postiz` | PostgreSQL database username |
| `redis_host` | No | `""` | Memorystore Redis host IP or hostname |
| `redis_port` | No | `6379` | Redis port |
| `storage_buckets` | No | `[{name_suffix="data"}]` | GCS bucket configuration for media uploads |
| `backup_schedule` | No | `0 2 * * *` | Cron expression for automated database backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |

### Deploy

Click **Deploy** in the RAD UI.

### Expected Deployment Duration

| Phase | Duration |
|---|---|
| GKE namespace and RBAC setup | ~2 min |
| Secret Manager secrets | ~1 min |
| GCS bucket provisioning | ~1 min |
| Cloud Build image pipeline | ~5–10 min |
| Kubernetes Deployment rollout | ~3–5 min |
| **Total** | **~12–19 min** |

### Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name |
| `service_url` | External URL for the Postiz application |
| `service_external_ip` | LoadBalancer external IP address |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | PostgreSQL database name |
| `database_user` | PostgreSQL username |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `storage_buckets` | GCS bucket names |
| `container_image` | Container image URI deployed |
| `deployment_id` | Unique deployment suffix |

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

# Discover the namespace (pattern: apppostiz<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^apppostiz" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~postiz" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Verify GKE Deployment [MANUAL]

### Steps

1. Configure kubectl to target the GKE cluster:

```bash
gcloud container clusters get-credentials CLUSTER_NAME \
  --region REGION \
  --project YOUR_PROJECT_ID
```

2. Confirm the Postiz pods are running:

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** All pods show `Running` status and `1/1` or `2/2` (with Cloud SQL proxy sidecar) in the READY column.

3. Check the Postiz Deployment:

```bash
kubectl describe deployment postiz -n ${NAMESPACE}
```

**Expected result:** Deployment shows the correct replica count and no error events.

4. View the LoadBalancer Service and external IP:

```bash
kubectl get service -n ${NAMESPACE}
```

**Expected result:** The Service of type `LoadBalancer` shows an `EXTERNAL-IP`. This is your Postiz URL.

5. Check pod logs to confirm the application started:

```bash
kubectl logs -n ${NAMESPACE} -l app=postiz --tail=50
```

**Expected result:** Log lines indicating the Postiz server is listening on port 5000, database migrations completed, and worker processes started.

### gcloud equivalent (listing GKE workloads)

```bash
gcloud container clusters list --project YOUR_PROJECT_ID
```

### REST API equivalent

```bash
curl -X GET \
  "https://container.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/REGION/clusters" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Phase 3 — Set Up Postiz [MANUAL]

### Steps

1. Open the Postiz URL in your browser:

```
http://${EXTERNAL_IP}
```

2. On first load, Postiz presents a registration screen. Register your admin account:
   - Enter your email address and a strong password.
   - Click **Register**.

3. If the registration screen is not shown (pre-seeded credentials), retrieve the admin password from Secret Manager:

```bash
gcloud secrets versions access latest \
  --secret="postiz-admin-password" \
  --project=YOUR_PROJECT_ID
```

4. Log in with your admin credentials.

**Expected result:** The Postiz dashboard loads showing the main navigation: **Calendar**, **Posts**, **Analytics**, **Settings**.

5. Explore the dashboard sections to familiarise yourself with the layout.

### gcloud equivalent

```bash
# List secrets related to Postiz
gcloud secrets list \
  --filter="name:postiz" \
  --project=YOUR_PROJECT_ID
```

---

## Phase 4 — Connect Social Media Accounts [MANUAL]

### Steps

1. Navigate to **Settings** in the left sidebar.

2. Select **Social Media Integrations** (or **Channels** depending on Postiz version).

3. Click **Add Channel** and select a platform — for this lab, select **LinkedIn**.

4. Postiz initiates an OAuth flow:
   - A browser popup or redirect opens the LinkedIn OAuth consent screen.
   - Log in with your LinkedIn credentials and grant the requested permissions.
   - You are redirected back to Postiz upon successful authorization.

5. Verify the LinkedIn integration appears in the connected channels list with a green status indicator.

**Expected result:** At least one social media account is connected and listed under active integrations.

**Note:** Full OAuth flows require real social media credentials. The lab demonstrates the connection interface and workflow. You may use a personal or test account. Without real credentials, you can still explore the UI and scheduling features in draft mode.

6. Optionally add a second platform (e.g., X/Twitter or Facebook) following the same OAuth flow.

### gcloud equivalent

There is no direct gcloud equivalent for OAuth flows. You can verify Secret Manager to check if any platform tokens were stored:

```bash
gcloud secrets list \
  --filter="name:postiz" \
  --project=YOUR_PROJECT_ID
```

---

## Phase 5 — Create and Schedule Posts [MANUAL]

### Steps

1. Click **Create Post** (or the **+** button) in the main navigation.

2. In the post editor:
   - Write a test post: `"Testing Postiz on GKE — scheduled post #1 #cloudrun #gcp"`
   - Upload a test image by clicking the image icon and selecting a local file. Postiz stores uploads in the GCS bucket provisioned by this module.

3. In the platform selector, choose the social media account(s) connected in Phase 4.

4. Click the **Schedule** option (rather than Post Now):
   - Use the date/time picker to select a time 30 minutes in the future.
   - Click **Schedule**.

**Expected result:** A confirmation message appears and the post moves to the scheduled queue.

5. Navigate to the **Calendar** view in the left sidebar.

**Expected result:** The scheduled post appears on the calendar at the time you selected.

6. Click the post in the Calendar to view its details and confirm the platform assignment.

### gcloud equivalent (verify GCS upload)

```bash
gcloud storage ls gs://STORAGE_BUCKET_NAME/ \
  --project=YOUR_PROJECT_ID
```

---

## Phase 6 — Explore the Calendar and Analytics [MANUAL]

### Steps

1. Navigate to the **Calendar** view.

2. Use the view toggle to switch between **Day**, **Week**, and **Month** views.

**Expected result:** Scheduled posts appear as entries in the calendar at their scheduled time, color-coded by platform.

3. Click a scheduled post to edit or reschedule it — drag it to a new time slot if your version supports drag-and-drop.

4. Navigate to **Analytics** in the left sidebar.

**Expected result:** The Analytics dashboard loads. If posts have been published, engagement metrics (impressions, clicks, shares) appear. For a fresh deployment, the dashboard shows empty state or zero metrics.

5. Explore the **reporting** section to see the metric breakdown by platform and time range.

**Expected result:** Charts and tables are displayed, even if empty, confirming the analytics pipeline is functioning.

---

## Phase 7 — Team Collaboration [MANUAL]

### Steps

1. Navigate to **Settings** > **Team** (or **Workspace** depending on the Postiz version).

2. Click **Invite Team Member**:
   - Enter an email address for the team member.
   - Select a role: **Admin**, **Manager**, or **User**.
   - Click **Send Invite**.

**Expected result:** An invitation is queued (email delivery requires SMTP configuration; the UI confirms the invite was recorded).

3. Review the **Team Members** list to see current members and their role assignments.

4. Explore **Workspace Settings**:
   - Review the workspace name and timezone settings.
   - Note the API key section if present — Postiz exposes an API for programmatic access.

**Expected result:** The team management interface loads and the invited member appears as pending.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### Steps

1. Open the [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs).

2. Select your project.

3. Query Postiz application logs:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="postiz"
```

4. Filter for worker logs:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
labels."k8s-pod/app"="postiz"
```

**Expected result:** Log entries from Postiz include HTTP request logs, queue job processing events, database query logs, and social media API calls.

5. Use the gcloud CLI to stream live logs:

```bash
kubectl logs -f -n ${NAMESPACE} -l app=postiz
```

6. Filter for error-level logs in Cloud Logging:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=ERROR
```

**Expected result:** Any errors during scheduling or social media API calls appear here.

### gcloud equivalent

```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=YOUR_PROJECT_ID \
  --limit=50 \
  --format="table(timestamp, severity, textPayload)"
```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

### Steps

1. Open [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Metrics Explorer**.

3. Query GKE pod CPU and memory metrics:
   - **Metric:** `kubernetes.io/container/cpu/usage_time`
   - **Filter:** `namespace_name = ${NAMESPACE}`

**Expected result:** A time-series graph showing Postiz pod CPU consumption.

4. Query Redis (Memorystore) queue depth metrics:
   - **Metric:** `redis.googleapis.com/stats/memory/usage_ratio`
   - **Filter:** Select your Memorystore instance.

**Expected result:** Redis memory usage metrics appear, indicating the queue is active.

5. Navigate to **Dashboards** and look for any pre-built GKE dashboards:
   - **GKE** > select your cluster > explore pod health, resource usage, and restart counts.

6. Check the **Alerting** section to review any alert policies configured by the module.

**Expected result:** The monitoring dashboard reflects live resource consumption and any configured alert policies are visible.

### gcloud equivalent

```bash
# List available metric types for GKE
gcloud monitoring metrics list \
  --filter="metric.type:kubernetes.io/container" \
  --project=YOUR_PROJECT_ID \
  --limit=20
```

---

## Phase 10 — Undeploy [AUTOMATED]

When the lab is complete, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** All Kubernetes resources, Cloud SQL database, GCS buckets, Secret Manager secrets, and IAM bindings created by this module are deleted. The GKE cluster and VPC managed by `Services GCP` are not affected.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Description |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisions GKE workload, Cloud SQL, GCS, secrets, HPA |
| Phase 2 — Verify GKE | Manual | Confirms pods are running and service URL is reachable |
| Phase 3 — Set Up Postiz | Manual | Admin registration and dashboard orientation |
| Phase 4 — Connect Social Media | Manual | OAuth integration with LinkedIn and other platforms |
| Phase 5 — Create and Schedule Posts | Manual | Post creation, image upload, and scheduling |
| Phase 6 — Calendar and Analytics | Manual | Calendar views and engagement metrics |
| Phase 7 — Team Collaboration | Manual | Invite team members and manage roles |
| Phase 8 — Cloud Logging | Manual | Application and worker log exploration |
| Phase 9 — Cloud Monitoring | Manual | GKE pod metrics and Redis queue depth |
| Phase 10 — Undeploy | Automated | Tears down all module-managed resources |
