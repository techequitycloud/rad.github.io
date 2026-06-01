---
title: "Strapi on Cloud Run — Lab Guide"
sidebar_label: "Strapi CloudRun"
---

# Strapi on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Strapi_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Strapi is an open-source headless CMS that provides a content management interface and auto-generates REST and GraphQL APIs for your content types. This lab deploys Strapi on Google Cloud Run (gen2) with Cloud SQL (PostgreSQL 15), Cloud Filestore NFS for shared media storage, optional Redis caching, optional Cloud Armor WAF and Cloud CDN, Artifact Registry, Secret Manager, and full Cloud Logging and Monitoring integration with uptime checks.

### What the Module Automates

- Cloud Run service (gen2) with serverless auto-scaling and Direct VPC Egress
- Cloud SQL PostgreSQL 15 instance with Cloud SQL Auth Proxy and dedicated database user
- Secret Manager secrets for Strapi APP_KEYS, JWT_SECRET, API_TOKEN_SALT, ADMIN_JWT_SECRET, and database credentials
- Cloud Filestore (NFS) provisioning for shared media uploads (mounts via gen2 NFS support)
- Artifact Registry repository and Cloud Build container image build
- Cloud Run Jobs for database initialisation (runs on each deployment by default)
- Cloud Monitoring uptime check and automated backup Cloud Run Job (daily at 02:00 UTC)
- Optional Cloud Armor WAF and Cloud CDN via Global HTTPS Load Balancer
- Optional Cloud Memorystore Redis for session caching

### What You Do Manually

- Retrieve the Strapi admin credentials from Secret Manager
- Obtain and verify the Cloud Run service URL
- Complete Strapi first-time superadmin setup
- Use the Content-Type Builder to create a collection type
- Add content items and publish them via the Content Manager
- Configure roles, permissions, and API tokens
- Manage media via the Media Library
- Query Cloud Logging and Cloud Monitoring dashboards (including CDN metrics if enabled)

---

## CLI and REST API Overview

This lab uses two primary interfaces:

| Interface | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, inspect service URL, query logs |
| Strapi REST / GraphQL API | Query and manipulate content programmatically |

---

## Prerequisites

1. **Services_GCP deployed** — this module depends on `Services_GCP`. The VPC network, Cloud SQL instance, Artifact Registry, and shared service accounts must exist before deploying Strapi_CloudRun.
2. **GCP project with billing enabled.**
3. **gcloud CLI** authenticated: `gcloud auth application-default login`
4. **Sufficient IAM permissions**: Owner or an equivalent custom role on the target project.
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID for all resources |
| `deployment_id` | No | `""` (auto-generated) | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `strapi` | Base name used in resource naming |
| `application_version` | No | `5.0.0` | Strapi container image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infra only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances (cost ceiling) |
| `cpu_limit` | No | `2000m` | CPU limit per instance |
| `memory_limit` | No | `2Gi` | Memory limit per instance |
| `application_database_name` | No | `strapidb` | PostgreSQL database name |
| `application_database_user` | No | `strapiuser` | PostgreSQL database user |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS for shared media storage |
| `nfs_mount_path` | No | `/mnt/nfs` | NFS mount path inside the container |
| `enable_redis` | No | `false` | Enable Redis session store and cache (optional) |
| `redis_host` | No | `null` | Redis host IP (required when `enable_redis = true`) |
| `redis_port` | No | `6379` | Redis TCP port |
| `ingress_settings` | No | `all` | Traffic sources: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing mode |
| `enable_cloud_armor` | No | `false` | Enable Cloud Armor WAF + Global HTTPS Load Balancer |
| `enable_cdn` | No | `false` | Enable Cloud CDN (requires `enable_cloud_armor = true`) |
| `application_domains` | No | `[]` | Custom domains for Cloud Armor load balancer |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |
| `tenant_deployment_id` | No | `demo` | Tenant identifier appended to resource names |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Deployment Duration

| Phase | Estimated Time |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| Cloud Filestore NFS provisioning | 3–5 min |
| Artifact Registry + Cloud Build | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| Database initialisation Cloud Run Job | 1–3 min |
| **Total** | **20–36 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `deployment_summary` | Human-readable summary of all provisioned resources |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `nfs_mount_path` | NFS mount path inside the container |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "strapi")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret (filter by app name)
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~strapi" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

1. Note the service URL from the RAD UI deployment panel, or retrieve it with gcloud:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region=${REGION} \
     --project=${PROJECT} \
     --format="value(status.url)"
   ```

2. Verify the service is reachable:

   ```bash
   curl https://${SERVICE_URL}/_health
   ```

   **Expected result:** HTTP 200 response indicating Strapi is running.

   **REST API equivalent:**
   ```bash
   gcloud run services list \
     --project=${PROJECT} \
     --region=${REGION} \
     --format="table(metadata.name,status.url,status.conditions[0].status)"
   ```

---

## Phase 3 — Complete Strapi Setup [MANUAL]

1. Retrieve the Strapi secret keys from Secret Manager:

   ```bash
   # App Keys
   gcloud secrets versions access latest \
     --secret="RESOURCE_PREFIX-strapi-app-keys" \
     --project=${PROJECT}

   # Admin JWT Secret
   gcloud secrets versions access latest \
     --secret="RESOURCE_PREFIX-strapi-admin-jwt-secret" \
     --project=${PROJECT}
   ```

   Replace `RESOURCE_PREFIX` with the value shown in `deployment_summary` (e.g., `appstr-demo-a1b2`).

   **REST API equivalent:**
   ```bash
   curl -X POST \
     "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/RESOURCE_PREFIX-strapi-admin-jwt-secret/versions/latest:access" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)"
   ```

2. List all Strapi-related secrets:

   ```bash
   gcloud secrets list \
     --filter="name:strapi" \
     --project=${PROJECT}
   ```

3. Open a browser and navigate to `https://${SERVICE_URL}/admin`.

4. **First-time setup:** Strapi prompts you to create a superadmin account:
   - **First name / Last name:** your choice
   - **Email:** `admin@example.com` (or your preferred address)
   - **Password:** choose a strong password and save it securely

   > **Note:** If this is not the first deployment or the database already contains admin data, the login screen is displayed instead of the registration form.

5. After logging in, explore the Strapi admin panel:
   - **Content Manager** — view and manage content entries
   - **Content-Type Builder** — define and modify content type schemas
   - **Media Library** — upload and manage media files
   - **Settings** — roles, permissions, API tokens, webhooks

---

## Phase 4 — Content-Type Builder [MANUAL]

1. Navigate to **Content-Type Builder** in the left sidebar.

2. Click **Create new collection type** and enter:
   - **Display name:** `Article`
   - **API ID (singular):** `article` (auto-filled)

3. Add the following fields by clicking **Add another field**:
   - `title` — Type: **Text** (Short text)
   - `content` — Type: **Rich Text**
   - `author` — Type: **Text** (Short text)
   - `publishedAt` — Type: **Date** (Date only or DateTime)

4. Click **Save**. Strapi rebuilds the application automatically and deploys a new Cloud Run revision.

   **Expected result:** A new Cloud Run revision is created and the `Article` type appears in the Content Manager within 2–3 minutes.

5. Monitor the new revision deployment:

   ```bash
   gcloud run revisions list \
     --service=${SERVICE} \
     --region=${REGION} \
     --project=${PROJECT} \
     --format="table(metadata.name,status.conditions[0].type,status.conditions[0].status)"
   ```

---

## Phase 5 — Content Manager and API [MANUAL]

1. Navigate to **Content Manager** in the left sidebar and select **Article**.

2. Click **Create new entry** and fill in the fields. Create two or three sample articles.

3. Click **Publish** for each entry to make it publicly accessible via the API.

   **Expected result:** Entries appear with a green Published badge in the Content Manager.

4. Access the generated REST API:

   ```bash
   curl https://${SERVICE_URL}/api/articles
   ```

   > **Note:** By default the Public role has no API access. If this returns a 403, complete Phase 6 first to configure permissions, then return here.

5. Access the API documentation at `https://${SERVICE_URL}/documentation` (requires the Documentation plugin to be enabled in Strapi settings).

6. Explore the GraphQL playground at `https://${SERVICE_URL}/graphql`:

   ```graphql
   query {
     articles {
       data {
         id
         attributes {
           title
           author
         }
       }
     }
   }
   ```

   **Expected result:** JSON response with the articles you created.

---

## Phase 6 — Roles and Permissions [MANUAL]

1. Navigate to **Settings > Roles & Permissions**.

2. Click the **Public** role to edit it.

3. Under **Article**, enable the following permissions:
   - `find` — allows `GET /api/articles`
   - `findOne` — allows `GET /api/articles/:id`

4. Click **Save**.

5. Re-test the public API:

   ```bash
   curl https://${SERVICE_URL}/api/articles
   ```

   **Expected result:** JSON array of published articles is returned without authentication.

6. Navigate to **Settings > API Tokens**. Click **Create new API Token**:
   - **Name:** `lab-token`
   - **Token type:** Full access (or Read-only for safer testing)
   - **Token duration:** 7 days

7. Copy the generated token and test an authenticated request:

   ```bash
   curl -H "Authorization: Bearer YOUR_API_TOKEN" \
     https://${SERVICE_URL}/api/articles
   ```

   **Expected result:** Same JSON response, now authenticated.

8. Test creating a new article via the API:

   ```bash
   curl -X POST \
     -H "Authorization: Bearer YOUR_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"data":{"title":"API Article","content":"Created via REST API","author":"Lab User"}}' \
     https://${SERVICE_URL}/api/articles
   ```

   **Expected result:** JSON response with the newly created article including its auto-generated `id`.

---

## Phase 7 — Media Library [MANUAL]

1. Navigate to **Media Library** in the left sidebar.

2. Click **Upload** and select one or more image files from your local machine.

   **Expected result:** Uploaded files appear in the Media Library with previews.

3. Verify that files are stored on the NFS mount:

   ```bash
   # Check the NFS mount via Cloud Logging
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND textPayload:"uploads"' \
     --project=${PROJECT} \
     --limit=10
   ```

4. List the GCS data bucket to verify any GCS-backed storage:

   ```bash
   gcloud storage ls --project=${PROJECT} | grep strapi
   gcloud storage ls gs://BUCKET_NAME
   ```

5. Access uploaded media via the REST API:

   ```bash
   curl -H "Authorization: Bearer YOUR_API_TOKEN" \
     https://${SERVICE_URL}/api/upload/files
   ```

   **Expected result:** JSON list of uploaded media files with their URLs and metadata.

6. Retrieve a file directly:

   ```bash
   # Replace FILE_PATH with the url field from the upload/files response
   curl -o downloaded_image.jpg "https://${SERVICE_URL}/FILE_PATH"
   ```

---

## Phase 8 — Explore Cloud Logging [MANUAL]

1. Open the [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs).

2. Filter logs for the Strapi Cloud Run service:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   ```

3. Observe Node.js startup logs, HTTP request logs from Strapi, and any error messages.

4. Search for a specific API request:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   httpRequest.requestUrl:"/api/articles"
   ```

   **Expected result:** Log entries showing the API requests made in Phase 5.

5. Use `gcloud` to query logs from the terminal:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
     --project=${PROJECT} \
     --limit=20 \
     --format="table(timestamp,httpRequest.requestUrl,httpRequest.status)"
   ```

6. Check for the database initialisation job logs:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_job"' \
     --project=${PROJECT} \
     --limit=10 \
     --format="table(timestamp,textPayload)"
   ```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

1. Open the [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and open the Cloud Run dashboard for the Strapi service.

3. Review key metrics:
   - **Request count** — total requests served per minute
   - **Request latency** — P50, P95, P99 response times
   - **Instance count** — observe auto-scaling (should reach 0 when idle if `min_instance_count = 0`)
   - **Container memory utilisation** — compare against the `memory_limit` (2Gi)
   - **Container CPU utilisation** — compare against the `cpu_limit` (2000m)

4. Navigate to **Uptime Checks**. The module provisions an uptime check automatically. Verify it shows a green status.

5. If Cloud CDN is enabled (`enable_cdn = true`):
   - Navigate to **Dashboards** and look for the Cloud CDN dashboard.
   - Review **Cache hit rate** — a high hit rate (>80%) indicates CDN is effectively serving cached content.
   - Review **Origin requests** — these are requests that bypassed the cache and hit Cloud Run directly.
   - Review **CDN egress bytes** — total data served by the CDN edge nodes.

6. Review alert policies under **Alerting > Policies**.

7. Use `gcloud` to check uptime check status:

   ```bash
   gcloud monitoring uptime list \
     --project=${PROJECT}
   ```

8. Use `gcloud` to inspect Cloud Run service metrics:

   ```bash
   gcloud monitoring metrics list \
     --filter="metric.type:run.googleapis.com" \
     --project=${PROJECT} \
     --limit=10
   ```

---

## Phase 10 — Undeploy [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

> **Note:** `enable_purge = true` (the default) ensures all resources including GCS buckets, the Cloud SQL instance, and Cloud Run services are deleted. Set `enable_purge = false` before deploying if you want to retain data after undeployment.

**Expected result:** The Cloud Run service and jobs, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, Artifact Registry images, and (if enabled) Cloud Armor policy and CDN configuration are all removed from the project.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | Automated | RAD UI deploys Cloud Run, Cloud SQL, NFS, secrets |
| Phase 2 — Service URL | Manual | Retrieve and verify Cloud Run service URL |
| Phase 3 — Setup | Manual | Create superadmin or log in; explore admin panel |
| Phase 4 — Content-Type Builder | Manual | Create Article collection type with fields |
| Phase 5 — Content Manager | Manual | Add articles, publish entries, access REST and GraphQL APIs |
| Phase 6 — Roles & Permissions | Manual | Configure Public role access and create API token |
| Phase 7 — Media Library | Manual | Upload images, verify NFS/GCS storage |
| Phase 8 — Logging | Manual | Query Cloud Logging for Strapi Node.js request logs |
| Phase 9 — Monitoring | Manual | Review Cloud Run metrics, uptime checks, CDN metrics (if enabled) |
| Phase 10 — Undeploy | Automated | RAD UI removes all resources |
