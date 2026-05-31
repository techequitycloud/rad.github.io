# Directus on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Directus_GKE)**

## Overview

**Estimated time:** 1–2 hours

Directus is a real-time open-source data platform that wraps any SQL database with a dynamic REST and GraphQL API, and provides a no-code Data Studio for managing content. This lab deploys Directus on Google Kubernetes Engine (GKE) Autopilot with Cloud SQL (PostgreSQL 15 + PostGIS), Cloud Filestore NFS for shared asset storage, Redis caching, Workload Identity, and full Cloud Logging and Monitoring integration.

### What the Module Automates

- GKE Autopilot cluster targeting (uses the Services_GCP-managed cluster)
- Kubernetes namespace, Deployment, and LoadBalancer Service
- Cloud SQL PostgreSQL 15 instance with PostGIS extension and dedicated database user
- Secret Manager secrets for Directus KEY, SECRET, ADMIN_PASSWORD, and REDIS credentials
- Cloud Filestore (NFS) provisioning and GCS Fuse volume mounts
- Artifact Registry repository and Cloud Build container image build
- Workload Identity binding for least-privilege pod authentication
- Horizontal Pod Autoscaler (min/max replicas)
- Cloud Monitoring uptime check and alert policies
- Database initialisation Kubernetes Job (runs migrations on first deploy)
- Automated database backup CronJob (daily at 02:00 UTC by default)

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Retrieve the Directus admin password from Secret Manager
- Connect kubectl to the cluster and verify pod health
- Explore the Directus Data Studio (Collections, Content, Files, Insights)
- Create a collection and add content items
- Query the REST and GraphQL APIs
- Upload files and verify GCS storage
- Configure webhooks and observe WebSocket activity
- Query Cloud Logging and Cloud Monitoring dashboards

---

## CLI and REST API Overview

This lab uses three primary interfaces:

| Interface | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, check resources, inspect logs |
| `kubectl` | Connect to the GKE cluster, inspect pods and services |
| Directus REST / GraphQL API | Query and manipulate content programmatically |

---

## Prerequisites

1. **Services_GCP deployed** — this module depends on `Services_GCP`. The VPC network, GKE Autopilot cluster, Cloud SQL instance, Artifact Registry, and shared service accounts must exist before deploying Directus_GKE.
2. **GCP project with billing enabled.**
3. **Access to the RAD UI** with permission to deploy modules in the target GCP project.
4. **gcloud CLI** authenticated: `gcloud auth application-default login`
5. **kubectl** installed and available on your PATH.
6. **Sufficient IAM permissions**: Owner or an equivalent custom role on the target project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. Use the table below to understand what each field controls.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID for all resources |
| `deployment_id` | No | `""` (auto-generated) | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `directus` | Base name used in resource naming |
| `application_version` | No | `11.1.0` | Directus container image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infra only |
| `min_instance_count` | No | `0` | Minimum pod replicas (0 = scale to zero) |
| `max_instance_count` | No | `3` | Maximum pod replicas (HPA ceiling) |
| `gke_cluster_name` | No | `""` | Target GKE cluster name; auto-discovered when empty |
| `cpu_limit` | No | `2000m` | CPU limit per Directus pod |
| `memory_limit` | No | `2Gi` | Memory limit per Directus pod |
| `db_name` | No | `directus` | PostgreSQL database name |
| `db_user` | No | `directus` | PostgreSQL database user |
| `database_type` | No | `POSTGRES_15` | Cloud SQL engine version |
| `enable_postgres_extensions` | No | `true` | Install PostgreSQL extensions |
| `postgres_extensions` | No | `["uuid-ossp"]` | Extensions to install (add `postgis` for geospatial) |
| `enable_redis` | No | `true` | Enable Redis cache and session backend |
| `redis_host` | No | `""` | Redis host IP (defaults to NFS server IP when empty) |
| `redis_port` | No | `6379` | Redis TCP port |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS for shared asset storage |
| `nfs_mount_path` | No | `/mnt/nfs` | NFS mount path inside the container |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |
| `tenant_deployment_id` | No | `demo` | Tenant identifier appended to resource names |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

### Deployment Duration

| Phase | Estimated Time |
|---|---|
| Provider initialisation | 1–2 min |
| Cloud SQL instance creation | 8–12 min |
| Cloud Filestore NFS provisioning | 3–5 min |
| Artifact Registry + Cloud Build | 5–10 min |
| GKE workload rollout | 3–6 min |
| Database migration job | 1–3 min |
| **Total** | **20–38 min** |

### Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | External LoadBalancer IP or URL for Directus |
| `service_name` | Kubernetes service name |
| `deployment_summary` | Human-readable summary of all provisioned resources |
| `kubernetes_ready` | `true` when the cluster endpoint is reachable and all K8s resources are deployed |

> **Note:** On the very first deploy of a new inline GKE cluster, `kubernetes_ready` may be `false` because the cluster endpoint is not yet readable. A second deploy may be required to complete Kubernetes resource deployment.

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
  -o custom-columns=":metadata.name" | grep "^appdirectus" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~directus" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Connect to the GKE Cluster [MANUAL]

1. Retrieve the GKE cluster name from the deployment summary or the GCP Console.

2. Configure kubectl credentials:

   ```bash
   gcloud container clusters get-credentials ${CLUSTER} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **gcloud equivalent:**
   ```bash
   gcloud container clusters list --project ${PROJECT}
   ```

3. Verify the Directus pod is running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:** One or more pods in `Running` state with all containers ready (e.g., `2/2` if the Cloud SQL Auth Proxy sidecar is enabled).

4. Check pod logs for startup messages:

   ```bash
   kubectl logs -n ${NAMESPACE} -l app=directus --tail=50
   ```

   **Expected result:** Log lines showing Directus version, database connection success, and the message `Server started at http://0.0.0.0:8055`.

5. Retrieve the external LoadBalancer IP:

   ```bash
   kubectl get service -n ${NAMESPACE}
   ```

   Note the `EXTERNAL-IP` column. This is your Directus service URL.

   **REST API equivalent:**
   ```bash
   gcloud compute forwarding-rules list --project ${PROJECT}
   ```

---

## Phase 3 — Explore Directus Data Studio [MANUAL]

1. Retrieve the Directus admin password from Secret Manager:

   ```bash
   gcloud secrets versions access latest \
     --secret="${DB_SECRET}" \
     --project=${PROJECT}
   ```

   **REST API equivalent:**
   ```bash
   curl -X POST https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access \
     -H "Authorization: Bearer ${TOKEN}"
   ```

2. Open a browser and navigate to `http://${EXTERNAL_IP}:8055/admin`.

3. Log in with:
   - **Email:** `admin@example.com` (or the value set during deployment)
   - **Password:** retrieved from Secret Manager above

4. Tour the Data Studio:
   - **Content** — view and manage content items across all collections
   - **Users** — manage user accounts and roles
   - **Files** — upload and manage media assets
   - **Insights** — build dashboards and analytics panels
   - **Settings** — configure the platform, data model, roles, and webhooks

---

## Phase 4 — Create Collections and Content [MANUAL]

1. In the Data Studio, navigate to **Settings > Data Model**.

2. Click **Create Collection** and name it `articles`.

3. Add the following fields:
   - `title` — Type: **String**
   - `body` — Type: **Text**
   - `published_date` — Type: **DateTime**
   - `featured_image` — Type: **Image**

4. Click **Save** to apply the schema change (Directus writes to the database immediately — no rebuild required).

5. Switch to the **Content** module in the left sidebar. Select **Articles**.

6. Click **Create Item** and populate the fields. Create two or three sample articles.

7. Publish items by setting their status to **Published**.

   **Expected result:** Items appear in the Content list with a green Published badge.

   **gcloud SQL verification:**
   ```bash
   gcloud sql connect CLOUD_SQL_INSTANCE_NAME \
     --user=directus \
     --database=directus \
     --project=${PROJECT}
   # Inside psql:
   SELECT id, title, status FROM articles LIMIT 5;
   ```

---

## Phase 5 — Explore the REST and GraphQL APIs [MANUAL]

1. Create an API access token in **Settings > Access Tokens**. Click **Create Token**, give it a name, and copy the generated token value.

2. Query the articles collection via the REST API:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://${EXTERNAL_IP}:8055/items/articles
   ```

   **Expected result:** JSON response with an array of article objects.

3. Filter published articles:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "http://${EXTERNAL_IP}:8055/items/articles?filter[status][_eq]=published"
   ```

4. Explore the auto-generated GraphQL API at `http://${EXTERNAL_IP}:8055/graphql`. Open this URL in a browser to access the interactive GraphQL Playground.

5. Run a sample GraphQL query:

   ```graphql
   query {
     articles {
       id
       title
       published_date
       status
     }
   }
   ```

   **Expected result:** GraphQL response with article data matching the REST result.

6. Review the full API documentation at `http://${EXTERNAL_IP}:8055/server/specs/oas` (OpenAPI 3.0 spec).

---

## Phase 6 — File Management and GCS Integration [MANUAL]

1. In the Data Studio, navigate to the **Files** module.

2. Click **Upload** and select an image file from your local machine.

   **Expected result:** The file appears in the Files module with a thumbnail preview.

3. Verify that the file is stored in the GCS bucket (via GCS Fuse mount):

   ```bash
   # List files in the Directus data bucket
   gcloud storage ls --project=${PROJECT} | grep directus
   gcloud storage ls gs://BUCKET_NAME
   ```

4. Retrieve a file via the Directus Files API:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://${EXTERNAL_IP}:8055/files
   ```

5. Explore image transformation by requesting a resized version:

   ```bash
   # Replace FILE_ID with the UUID from the Files API response
   curl -o resized.jpg \
     "http://${EXTERNAL_IP}:8055/assets/FILE_ID?width=300&height=200&fit=cover"
   ```

   **Expected result:** A resized JPEG image is saved locally.

---

## Phase 7 — Webhooks and Real-time [MANUAL]

1. In the Data Studio, navigate to **Settings > Webhooks**.

2. Click **Create Webhook**:
   - **Name:** `article-created`
   - **Method:** POST
   - **URL:** `https://webhook.site/YOUR_UNIQUE_ID` (use [webhook.site](https://webhook.site) for testing)
   - **Collections:** articles
   - **Trigger on:** Create

3. Return to **Content > Articles** and create a new article.

4. Open your webhook.site page and verify a POST request was received with the new article payload.

   **Expected result:** A JSON payload with the new article's data appears on webhook.site within a few seconds.

5. Test WebSocket real-time updates:
   - Open browser developer tools (F12) → Console
   - Run the following snippet to connect to the Directus WebSocket:

   ```javascript
   const ws = new WebSocket('ws://${EXTERNAL_IP}:8055/websocket');
   ws.onopen = () => {
     ws.send(JSON.stringify({
       type: 'auth',
       access_token: 'YOUR_TOKEN'
     }));
   };
   ws.onmessage = (e) => console.log('Received:', e.data);
   ```

   - Create or update an article in the Data Studio
   - **Expected result:** A real-time message appears in the browser console.

6. Review the activity log in **Settings > Activity Log** to see all create, update, and delete events.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

1. Open the [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs).

2. Filter logs for the Directus GKE workload:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="directus"
   ```

3. Observe startup logs, API request logs, and any error messages.

4. Search for a specific API request:

   ```
   resource.type="k8s_container"
   resource.labels.container_name="directus"
   textPayload:"GET /items/articles"
   ```

   **Expected result:** Log entries showing the API requests you made in Phase 5.

5. Use `gcloud` to tail logs from the terminal:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.container_name="directus"' \
     --project=${PROJECT} \
     --limit=20 \
     --format="table(timestamp,textPayload)"
   ```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

1. Open the [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and open the GKE workload dashboard for the Directus namespace.

3. Review key metrics:
   - **CPU utilisation** — compare against the `cpu_limit` (2000m)
   - **Memory utilisation** — compare against the `memory_limit` (2Gi)
   - **Pod restart count** — should be 0 for a healthy deployment
   - **Request latency** — baseline API response times

4. Navigate to **Uptime Checks**. The module provisions an uptime check automatically. Verify it shows a green status.

5. Review alert policies under **Alerting > Policies**. The module creates policies for defined `alert_policies` variables.

6. Use `gcloud` to check uptime check status:

   ```bash
   gcloud monitoring uptime list \
     --project=${PROJECT}
   ```

---

## Phase 10 — Undeploy [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected result:** All Kubernetes workloads, the Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images are removed from the project.

> **Note:** `enable_purge = true` (the default) ensures all resources including GCS buckets and the Cloud SQL instance are deleted. Set `enable_purge = false` before undeploying if you want to retain data.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | Automated | RAD UI provisions GKE workload, Cloud SQL, NFS, secrets |
| Phase 2 — Connect | Manual | Configure kubectl, verify pod health, retrieve LoadBalancer IP |
| Phase 3 — Data Studio | Manual | Log in to Directus, tour Content/Users/Files/Insights/Settings |
| Phase 4 — Collections | Manual | Create Articles collection and add content items |
| Phase 5 — APIs | Manual | Query REST and GraphQL APIs with access token |
| Phase 6 — Files | Manual | Upload files, verify GCS storage, test image transformations |
| Phase 7 — Webhooks | Manual | Create webhook, test WebSocket real-time connection |
| Phase 8 — Logging | Manual | Query Cloud Logging for Directus container logs |
| Phase 9 — Monitoring | Manual | Review GKE metrics, uptime checks, and alert policies |
| Phase 10 — Undeploy | Automated | RAD UI removes all resources |
