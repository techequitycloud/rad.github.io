---
title: "Strapi on GKE Autopilot — Lab Guide"
sidebar_label: "Strapi GKE Lab"
---

# Strapi on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Strapi_GKE)**

## Overview

**Estimated time:** 1–2 hours

Strapi is an open-source headless CMS that provides a content management interface and auto-generates REST and GraphQL APIs for your content types. This lab deploys Strapi on Google Kubernetes Engine (GKE) Autopilot with Cloud SQL (PostgreSQL 15), Cloud Filestore NFS for shared media storage, Artifact Registry, Secret Manager, and Cloud Monitoring integration.

### What the Module Automates

- GKE Autopilot cluster targeting (uses the Services_GCP-managed cluster)
- Kubernetes namespace, Deployment, and LoadBalancer Service
- Cloud SQL PostgreSQL 15 instance with dedicated database user
- Secret Manager secrets for Strapi APP_KEYS, JWT_SECRET, API_TOKEN_SALT, ADMIN_JWT_SECRET, and database credentials
- Cloud Filestore (NFS) provisioning for shared media uploads
- Artifact Registry repository and Cloud Build container image build
- Workload Identity binding for least-privilege pod authentication
- Horizontal Pod Autoscaler (min/max replicas)
- Cloud Monitoring uptime check and alert policies
- Database initialisation Kubernetes Job (runs on first deploy)
- Automated database backup CronJob (daily at 02:00 UTC by default)

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Retrieve the Strapi admin credentials from Secret Manager
- Connect kubectl to the cluster and verify pod health
- Complete Strapi first-time setup (or retrieve existing admin credentials)
- Use the Content-Type Builder to create a collection type
- Add content items and publish them via the Content Manager
- Access the auto-generated REST and GraphQL APIs
- Manage media via the Media Library
- Query Cloud Logging and Cloud Monitoring dashboards

---

## CLI and REST API Overview

This lab uses three primary interfaces:

| Interface | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, check resources, inspect logs |
| `kubectl` | Connect to the GKE cluster, inspect pods and services |
| Strapi REST / GraphQL API | Query and manipulate content programmatically |

---

## Prerequisites

1. **Services_GCP deployed** — this module depends on `Services_GCP`. The VPC network, GKE Autopilot cluster, Cloud SQL instance, Artifact Registry, and shared service accounts must exist before deploying Strapi_GKE.
2. **GCP project with billing enabled.**
3. **gcloud CLI** authenticated: `gcloud auth application-default login`
4. **kubectl** installed and available on your PATH.
5. **Access to the RAD UI** with permission to deploy modules in the target GCP project.
6. **Sufficient IAM permissions**: Owner or an equivalent custom role on the target project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Strapi_GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID for all resources |
| `deployment_id` | No | `""` (auto-generated) | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `strapi` | Base name used in resource naming |
| `application_version` | No | `5.0.0` | Strapi container image version tag |
| `deploy_application` | No | `true` | Set to `false` to provision infra only |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `10` | Maximum pod replicas (HPA ceiling) |
| `gke_cluster_name` | No | `""` | Target GKE cluster name; auto-discovered when empty |
| `container_resources` | No | `{cpu_limit="1000m", memory_limit="512Mi"}` | Pod CPU and memory limits |
| `application_database_name` | No | `strapi` | PostgreSQL database name |
| `application_database_user` | No | `strapi` | PostgreSQL database user |
| `database_type` | No | `POSTGRES` | Cloud SQL engine (defaults to latest PostgreSQL) |
| `enable_nfs` | No | `true` | Provision Cloud Filestore NFS for shared media storage |
| `nfs_mount_path` | No | `/mnt/nfs` | NFS mount path inside the container |
| `enable_redis` | No | `false` | Enable Redis session store and cache |
| `redis_host` | No | `""` | Redis host IP (required when `enable_redis = true`) |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |
| `tenant_deployment_id` | No | `demo` | Tenant identifier appended to resource names |

### Deploy

Click **Deploy** in the RAD UI.

### Deployment Duration

| Phase | Estimated Time |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| Cloud Filestore NFS provisioning | 3–5 min |
| Artifact Registry + Cloud Build | 5–10 min |
| GKE workload rollout | 3–6 min |
| Database initialisation job | 1–3 min |
| **Total** | **21–38 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | External LoadBalancer IP or URL for Strapi |
| `service_name` | Kubernetes service name |
| `service_external_ip` | External IP of the LoadBalancer service |
| `deployment_summary` | Human-readable summary of all provisioned resources |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `kubernetes_ready` | `true` when all K8s resources are deployed |

> **Note:** On the very first deployment of a new inline GKE cluster, `kubernetes_ready` may be `false` because the cluster endpoint is not yet readable. Return to the RAD UI and click **Update** to complete the Kubernetes resource deployment.

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

# Discover the namespace (pattern: appstrapi<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appstrapi" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~strapi" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Connect to the GKE Cluster [MANUAL]

1. Retrieve the GKE cluster name from the GCP Console.

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

3. Verify the Strapi pod is running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:** One or more pods in `Running` state with all containers ready (e.g., `2/2` if the Cloud SQL Auth Proxy sidecar is enabled).

4. Check pod logs for startup messages:

   ```bash
   kubectl logs -n ${NAMESPACE} -l app=strapi --tail=50
   ```

   **Expected result:** Strapi startup log messages including `Strapi started successfully` and the admin URL.

5. Retrieve the external LoadBalancer IP:

   ```bash
   kubectl get service -n ${NAMESPACE}
   ```

   Note the `EXTERNAL-IP` column. This is your Strapi service endpoint.

   **gcloud equivalent:**
   ```bash
   gcloud compute forwarding-rules list --project ${PROJECT}
   ```

---

## Phase 3 — Complete Strapi Setup [MANUAL]

1. Retrieve Strapi secret keys from Secret Manager (these are set automatically by the module):

   ```bash
   # Admin JWT Secret
   gcloud secrets versions access latest \
     --secret="RESOURCE_PREFIX-strapi-admin-jwt-secret" \
     --project=${PROJECT}

   # API Token Salt
   gcloud secrets versions access latest \
     --secret="RESOURCE_PREFIX-strapi-api-token-salt" \
     --project=${PROJECT}
   ```

   Replace `RESOURCE_PREFIX` with the value shown in `deployment_summary` from the RAD UI.

   **REST API equivalent:**
   ```bash
   curl -X POST \
     "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/RESOURCE_PREFIX-strapi-admin-jwt-secret/versions/latest:access" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)"
   ```

2. Open a browser and navigate to `http://${EXTERNAL_IP}:1337/admin`.

3. **First-time setup:** Strapi prompts you to create a superadmin account:
   - **First name / Last name:** your choice
   - **Email:** `admin@example.com` (or your preferred address)
   - **Password:** choose a strong password and save it securely

   > **Note:** If this is not the first deployment or the database already contains admin data, the login screen is displayed instead of the registration form.

4. After logging in, explore the Strapi admin panel:
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

4. Click **Save**. Strapi rebuilds the application automatically and restarts.

   **Expected result:** The pod restarts within 30–60 seconds and the `Article` type appears in the Content Manager.

5. Verify the rebuilt pod:

   ```bash
   kubectl rollout status deployment/strapi -n ${NAMESPACE}
   ```

---

## Phase 5 — Content Manager and API [MANUAL]

1. Navigate to **Content Manager** in the left sidebar and select **Article**.

2. Click **Create new entry** and fill in the fields. Create two or three sample articles.

3. Click **Publish** for each entry to make it publicly accessible via the API.

   **Expected result:** Entries appear with a green Published badge in the Content Manager.

4. Access the generated REST API:

   ```bash
   curl http://${EXTERNAL_IP}:1337/api/articles
   ```

   > **Note:** By default the Public role has no API access. If this returns a 403, complete Phase 6 first to configure permissions, then return here.

5. Review the auto-generated API documentation at `http://${EXTERNAL_IP}:1337/documentation` (requires the Documentation plugin to be enabled in Strapi settings).

6. Explore the GraphQL playground at `http://${EXTERNAL_IP}:1337/graphql`:

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
   curl http://${EXTERNAL_IP}:1337/api/articles
   ```

   **Expected result:** JSON array of published articles is returned without authentication.

6. Navigate to **Settings > API Tokens**. Click **Create new API Token**:
   - **Name:** `lab-token`
   - **Token type:** Full access (or Read-only for safer testing)
   - **Token duration:** 7 days

7. Copy the generated token and test an authenticated request:

   ```bash
   curl -H "Authorization: Bearer YOUR_API_TOKEN" \
     http://${EXTERNAL_IP}:1337/api/articles
   ```

   **Expected result:** Same JSON response, now authenticated.

   **gcloud equivalent for listing Secret Manager secrets:**
   ```bash
   gcloud secrets list \
     --filter="name:strapi" \
     --project=${PROJECT}
   ```

---

## Phase 7 — Media Library [MANUAL]

1. Navigate to **Media Library** in the left sidebar.

2. Click **Upload** and select one or more image files from your local machine.

   **Expected result:** Uploaded files appear in the Media Library with previews.

3. Verify that files are stored on the NFS mount (and optionally in GCS):

   ```bash
   # Access the pod to check the NFS mount
   kubectl exec -n ${NAMESPACE} -it $(kubectl get pod -n ${NAMESPACE} -l app=strapi -o name | head -1) -- ls /mnt/nfs
   ```

   **Expected result:** Uploaded files or directories are visible under `/mnt/nfs`.

4. List the GCS data bucket to verify any GCS-backed storage:

   ```bash
   gcloud storage ls --project=${PROJECT} | grep strapi
   gcloud storage ls gs://BUCKET_NAME
   ```

5. Use an uploaded image in an Article:
   - Open the **Content Manager**, select an Article, and add the `featured_image` field (if you added one in Phase 4).
   - Use the **Media Library picker** to attach the uploaded image.
   - Save and publish.

6. Access the image via the REST API:

   ```bash
   curl http://${EXTERNAL_IP}:1337/api/upload/files
   ```

   **Expected result:** JSON list of uploaded media files with their URLs.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

1. Open the [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs).

2. Filter logs for the Strapi GKE workload:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="strapi"
   ```

3. Observe Node.js startup logs, HTTP request logs from Strapi, and any error messages.

4. Search for a specific API request:

   ```
   resource.type="k8s_container"
   resource.labels.container_name="strapi"
   textPayload:"GET /api/articles"
   ```

   **Expected result:** Log entries showing the API requests made in Phase 5.

5. Use `gcloud` to tail logs from the terminal:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.container_name="strapi"' \
     --project=${PROJECT} \
     --limit=20 \
     --format="table(timestamp,textPayload)"
   ```

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

1. Open the [Google Cloud Console Monitoring](https://console.cloud.google.com/monitoring).

2. Navigate to **Dashboards** and open the GKE workload dashboard for the Strapi namespace.

3. Review key metrics:
   - **CPU utilisation** — compare against the configured `cpu_limit`
   - **Memory utilisation** — compare against the configured `memory_limit`
   - **Pod restart count** — should be 0 for a healthy deployment
   - **Network bytes in/out** — observe traffic volume from API requests

4. Navigate to **Uptime Checks**. The module provisions an uptime check automatically. Verify it shows a green status.

5. Review alert policies under **Alerting > Policies**.

6. Use `gcloud` to check the uptime check status:

   ```bash
   gcloud monitoring uptime list \
     --project=${PROJECT}
   ```

---

## Phase 10 — Undeploy [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

> **Note:** `enable_purge = true` (the default) ensures all resources including GCS buckets and the Cloud SQL instance are deleted. Set `enable_purge = false` before deploying if you want to retain data after undeployment.

**Expected result:** All Kubernetes workloads, the Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images are removed from the project.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | Automated | RAD UI deployment provisions GKE workload, Cloud SQL, NFS, secrets |
| Phase 2 — Connect | Manual | Configure kubectl, verify pod health, retrieve LoadBalancer IP |
| Phase 3 — Setup | Manual | Create superadmin or log in with existing credentials |
| Phase 4 — Content-Type Builder | Manual | Create Article collection type with fields |
| Phase 5 — Content Manager | Manual | Add articles, publish entries, access REST and GraphQL APIs |
| Phase 6 — Roles & Permissions | Manual | Configure Public role access and create API token |
| Phase 7 — Media Library | Manual | Upload images, verify NFS/GCS storage, use in content |
| Phase 8 — Logging | Manual | Query Cloud Logging for Strapi Node.js container logs |
| Phase 9 — Monitoring | Manual | Review GKE metrics, uptime checks, and alert policies |
| Phase 10 — Undeploy | Automated | RAD UI removes all resources |
