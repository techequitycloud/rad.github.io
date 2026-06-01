---
title: "Directus on Cloud Run — Lab Guide"
sidebar_label: "Directus CloudRun Lab"
---

# Directus on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Directus_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Directus is a real-time open-source data platform that wraps any SQL database with a dynamic REST and GraphQL API, and provides a no-code Data Studio for managing content. This lab deploys Directus on Google Cloud Run (gen2) with Cloud SQL (PostgreSQL 15 + PostGIS), Cloud Filestore NFS for shared asset storage, Redis caching, Serverless VPC Access, and full Cloud Logging and Monitoring integration.

### What the Module Automates

- Cloud Run service (gen2) with serverless auto-scaling
- Cloud SQL PostgreSQL 15 instance with dedicated database user and secrets
- Secret Manager secrets for Directus KEY, SECRET, ADMIN_PASSWORD, and REDIS credentials
- Cloud Filestore (NFS) provisioning and GCS Fuse volume mounts for asset storage
- Artifact Registry repository and Cloud Build container image build
- Serverless VPC Access connector for private Cloud SQL connectivity
- Cloud Run Jobs for database initialisation (migrations)
- Cloud Monitoring uptime check and automated backup Cloud Run Job (daily at 02:00 UTC)
- Optional Cloud Armor WAF and Cloud CDN via Global HTTPS Load Balancer

### What You Do Manually

- Retrieve the Directus admin password from Secret Manager
- Note the Cloud Run service URL from the RAD UI deployment panel
- Explore the Directus Data Studio (Collections, Content, Files, Insights, Settings)
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
| `gcloud` | Retrieve secrets, inspect service URL, query logs |
| Directus REST / GraphQL API | Query and manipulate content programmatically |

---

## Prerequisites

1. **Services_GCP deployed** — this module depends on `Services_GCP`. The VPC network, Cloud SQL instance, Artifact Registry, and shared service accounts must exist before deploying Directus_CloudRun.
2. **GCP project with billing enabled.**
3. **gcloud CLI** authenticated: `gcloud auth application-default login`
4. **Sufficient IAM permissions**: Owner or an equivalent custom role on the target project.
5. **Access to the RAD UI** with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID for all resources |
| `deployment_id` | No | `""` (auto-generated) | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `directus` | Base name used in resource naming |
| `application_version` | No | `11.1.0` | Directus container image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infra only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances (cost ceiling) |
| `cpu_limit` | No | `1000m` | CPU limit per instance |
| `memory_limit` | No | `2Gi` | Memory limit per instance |
| `db_name` | No | `directus` | PostgreSQL database name |
| `db_user` | No | `directus` | PostgreSQL database user |
| `enable_redis` | No | `true` | Enable Redis cache and rate-limiting backend |
| `redis_host` | No | `""` | Redis host IP (defaults to NFS server IP when empty) |
| `redis_port` | No | `6379` | Redis TCP port |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS for shared asset storage |
| `nfs_mount_path` | No | `/mnt/nfs` | NFS mount path inside the container |
| `ingress_settings` | No | `all` | Traffic sources: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing mode |
| `enable_cloud_armor` | No | `false` | Enable Cloud Armor WAF + Global HTTPS Load Balancer |
| `enable_cdn` | No | `false` | Enable Cloud CDN (requires `enable_cloud_armor = true`) |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |
| `tenant_deployment_id` | No | `demo` | Tenant identifier appended to resource names |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

### Deployment Duration

| Phase | Estimated Time |
|---|---|
| Provider initialisation | 1–2 min |
| Cloud SQL instance creation | 8–12 min |
| Cloud Filestore NFS provisioning | 3–5 min |
| Artifact Registry + Cloud Build | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| Database migration Cloud Run Job | 1–3 min |
| **Total** | **20–36 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `deployment_summary` | Human-readable summary of all provisioned resources |
| `database_password_secret` | Secret Manager secret name for the DB password |

Set shell variables for use in later steps using gcloud discovery:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~directus" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~directus" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

1. Retrieve the Cloud Run service URL with gcloud:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region=${REGION} \
     --project=${PROJECT} \
     --format="value(status.url)"
   ```

2. Verify the service is reachable:

   ```bash
   curl https://${SERVICE_URL}/server/health
   ```

   **Expected result:** JSON response `{"status":"ok"}` indicating Directus is running and connected to the database.

   **REST API equivalent:**
   ```bash
   gcloud run services list \
     --project=${PROJECT} \
     --region=${REGION} \
     --format="table(metadata.name,status.url,status.conditions[0].status)"
   ```

---

## Phase 3 — Explore Directus Data Studio [MANUAL]

1. Retrieve the Directus admin password from Secret Manager:

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project=${PROJECT} --filter='name~directus-admin-password' --format='value(name)' --limit=1)" \
     --project=${PROJECT}
   ```

   **REST API equivalent:**
   ```bash
   curl -X POST \
     "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)"
   ```

2. Open a browser and navigate to `https://${SERVICE_URL}/admin`.

3. Log in with:
   - **Email:** `admin@example.com` (or the value configured at deploy time)
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

4. Click **Save** to apply the schema change (Directus writes to the database immediately — no container rebuild required).

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
     https://${SERVICE_URL}/items/articles
   ```

   **Expected result:** JSON response with an array of article objects.

3. Filter published articles:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://${SERVICE_URL}/items/articles?filter[status][_eq]=published"
   ```

4. Explore the auto-generated GraphQL API at `https://${SERVICE_URL}/graphql`. Open this URL in a browser to access the interactive GraphQL Playground.

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

6. Review the full API specification at `https://${SERVICE_URL}/server/specs/oas` (OpenAPI 3.0).

---

## Phase 6 — File Management and GCS Integration [MANUAL]

1. In the Data Studio, navigate to the **Files** module.

2. Click **Upload** and select an image file from your local machine.

   **Expected result:** The file appears in the Files module with a thumbnail preview.

3. Verify that the file is stored in the GCS bucket (via GCS Fuse mount):

   ```bash
   # List GCS buckets for this deployment
   gcloud storage ls --project=${PROJECT} | grep directus

   # List objects in the Directus data bucket
   BUCKET=$(gcloud storage buckets list --project=${PROJECT} --format="value(name)" --filter="name~directus" --limit=1)
   gcloud storage ls gs://${BUCKET}
   ```

4. Retrieve the list of files via the Directus Files API:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://${SERVICE_URL}/files
   ```

5. Explore image transformation by requesting a resized version:

   ```bash
   # Replace FILE_ID with the UUID from the Files API response
   curl -o resized.jpg \
     "https://${SERVICE_URL}/assets/FILE_ID?width=300&height=200&fit=cover"
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
   const ws = new WebSocket('wss://SERVICE_URL/websocket');
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

2. Filter logs for the Directus Cloud Run service:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   ```

3. Observe startup logs, API request logs, and any error messages from Directus.

4. Search for a specific API request:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   httpRequest.requestUrl:"/items/articles"
   ```

   **Expected result:** Log entries matching the API calls you made in Phase 5.

5. Use `gcloud` to query logs from the terminal:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
     --project=${PROJECT} \
     --limit=20 \
     --format="table(timestamp,httpRequest.requestUrl,httpRequest.status)"
   ```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

1. Open the [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and open the Cloud Run dashboard for the Directus service.

3. Review key metrics:
   - **Request count** — total requests served per minute
   - **Request latency** — P50, P95, P99 response times
   - **Instance count** — observe auto-scaling (should reach 0 when idle if `min_instance_count = 0`)
   - **Container memory utilisation** — compare against the `memory_limit` (2Gi)
   - **Container CPU utilisation** — compare against the `cpu_limit` (1000m)

4. Navigate to **Uptime Checks**. The module provisions an uptime check automatically. Verify it shows a green status.

5. Navigate to **Alerting > Policies** to review any configured alert policies.

6. Use `gcloud` to list Cloud Run metrics:

   ```bash
   gcloud monitoring metrics list \
     --filter="metric.type:run.googleapis.com" \
     --project=${PROJECT} \
     --limit=10
   ```

---

## Phase 10 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

> **Note:** `enable_purge = true` (the default) ensures all resources including GCS buckets, the Cloud SQL instance, and Cloud Run services are deleted. Set `enable_purge = false` before undeploying if you want to retain data.

**Expected result:** The Cloud Run service, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images are all removed from the project.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | Automated | RAD UI deployment provisions Cloud Run, Cloud SQL, NFS, secrets |
| Phase 2 — Service URL | Manual | Retrieve and verify Cloud Run service URL |
| Phase 3 — Data Studio | Manual | Log in to Directus, tour Content/Users/Files/Insights/Settings |
| Phase 4 — Collections | Manual | Create Articles collection and add content items |
| Phase 5 — APIs | Manual | Query REST and GraphQL APIs with access token |
| Phase 6 — Files | Manual | Upload files, verify GCS storage, test image transformations |
| Phase 7 — Webhooks | Manual | Create webhook, test WebSocket real-time connection |
| Phase 8 — Logging | Manual | Query Cloud Logging for Cloud Run request and application logs |
| Phase 9 — Monitoring | Manual | Review Cloud Run metrics, uptime checks, and alert policies |
| Phase 10 — Undeploy | Automated | RAD UI Undeploy removes all resources |
